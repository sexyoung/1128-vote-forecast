# 候選人匯入（後端第 9 步）

中選會預定 2026-11-12／11-17 公告候選人名單。這份文件是那天要做的事，寫在事前是
因為現在存進資料庫的預測已經預留了對接的欄位，做法一旦改掉就對不回去。

前八步的設計見 `2026-election-backend.md`，這裡只講第九步。

---

## 一、現在長什麼樣子

名單還沒公告，所以「候選人」是程式產生的佔位人選：

- `src/client/mock-election.ts` 的 `getMockCandidates(contest)` 依選區產生固定的
  名單（`國民黨候選人 1`、`民進黨候選人 1`…）。單一席次是四個政黨各一位，複數
  席次是 `seatCount + 4` 位輪流分配政黨。
- `src/server/prediction-targets.ts` 匯入同一支函式，所以伺服器與畫面看到的名單
  一定一樣。裡面有一個常數：

  ```ts
  /** 名單還沒進來。之後這裡會變成「這個選區有沒有 Candidate 資料」。 */
  const candidatesPublished = false;
  ```

- 使用者送出的 `PredictionPick` 長這樣：

  ```
  targetType = CANDIDATE
  targetId   = 'TPE-EXECUTIVE-1-CANDIDATE-1'   ← 佔位 id
  partyId    = 'KMT'                            ← 伺服器自己算出來的黨籍
  ```

**`partyId` 就是這一步的接點。** 佔位 id 在名單公告後沒有意義，但黨籍有：使用者
按下去的當下，畫面上寫的是「國民黨候選人」，他表達的是「我認為國民黨在這一區
勝出」。名單進來後把那一票對到該黨的真候選人，是忠於原意的轉換。

---

## 二、需要拿到的資料

| 欄位     | 用途                                         | 備註                                            |
| -------- | -------------------------------------------- | ----------------------------------------------- |
| 選舉區   | 對到 `election-contests.json` 的 `contestId` | 公告是文字（「臺北市第 1 選舉區」），要自己對照 |
| 姓名     | 顯示                                         |                                                 |
| 政黨     | 對到 `PredictionPick.partyId`                | 無黨籍是 `IND`                                  |
| 號次     | 顯示與排序                                   | 抽籤後才有                                      |
| 英文拼音 | 照片檔名                                     | 公告不一定有，可能要自己補                      |

還缺的兩份公告：

1. **鄉鎮市民代表與山地原住民區民代表的應選名額**。中選會 2026-08-20 另有一份
   涵蓋鄉鎮市長、代表、村里長的公告；拿到後把清冊裡的 `seatsSource` 從
   `PLACEHOLDER` 換成 `OFFICIAL`（見第六節）。
2. **候選人名單本身**。

---

## 三、Schema

加一張表，不動既有的任何一張：

```prisma
enum CandidateStatus {
  REGISTERED
  CONFIRMED
  WITHDRAWN
  DISQUALIFIED
}

/// 中選會公告的候選人。選區代號對到 election-contests.json，不下外鍵。
model Candidate {
  id        String @id @default(cuid())
  contestId String
  partyId   String?

  name     String  @db.VarChar(40)
  /// 英文拼音，照片檔名用（見 public/avatars/README.md）。
  nameEn   String? @db.VarChar(80)
  ballotNo Int?
  photoKey String?

  status    CandidateStatus @default(REGISTERED)
  createdAt DateTime        @default(now())
  updatedAt DateTime        @updatedAt

  /// 一個選區同一個政黨只會有一位候選人，遷移就是靠這個前提。
  @@unique([contestId, partyId])
  @@unique([contestId, ballotNo])
  @@index([contestId])
}
```

`@@unique([contestId, partyId])` 是遷移能成立的前提，寫進 schema 讓資料庫替我們
守著。無黨籍是例外——同一區可以有好幾位無黨籍，所以 `partyId` 為 `null` 的列不受
這個唯一鍵限制（PostgreSQL 的 unique 不管 null）。無黨籍的舊預測因此對不到單一
候選人，處理方式見第五節。

---

## 四、匯入腳本

`scripts/import-candidates.ts`，跟 `build-election-contests.ts` 同一個模式：

```
npm run data:candidates -- docs/candidates-2026.csv
```

CSV 欄位：`contest_id,party,name,name_en,ballot_no,status`。

腳本要做的檢查，缺一不可：

1. 每個 `contest_id` 都在清冊裡（`getRegisteredContest`），否則整批中止。
2. 同一選區同一政黨不重複（無黨籍除外）。
3. 每個選區的候選人數 ≥ 應選席次，否則那一區的預測選不滿。
4. `status` 在列舉值內。

先全部驗完再寫入，不要邊驗邊寫——中途失敗會留下一半的名單，那比完全沒匯入更難
處理。

---

## 五、把舊預測接到真候選人

這是整步唯一不可逆的部分，**先備份**：

```bash
pg_dump --table=Prediction --table=PredictionPick --table=ContestTally \
        --table=ContestSummary > backup-before-candidates.sql
```

一個 transaction 內：

1. 對每一筆 `PredictionPick`：
   - `partyId` 對得到該選區的 `Candidate` → 把 `targetId` 換成真候選人 id。
   - 該黨在這一區沒有推人 → 整筆 `Prediction` 標
     `status = INVALIDATED`、`invalidReason = PARTY_HAS_NO_CANDIDATE`，**不要刪**。
   - `partyId` 是 `IND` 且該區有多位無黨籍 → 同樣標 `INVALIDATED`，理由用
     `PARTY_HAS_NO_CANDIDATE`（意思是「對不到唯一的人」）。這個情況要單獨統計出來
     報告，因為它是我們自己選項 B 的代價，不是使用者的錯。
2. 舊的那一版收進 `PredictionRevision`，跟使用者自己改預測的處理一致。
3. 清空並重算 `ContestTally` 與 `ContestSummary`：

   ```sql
   TRUNCATE "ContestTally";
   INSERT INTO "ContestTally" ("contestId", "targetType", "targetId", "count", "updatedAt")
   SELECT p."contestId", pk."targetType", pk."targetId", COUNT(*), now()
   FROM "PredictionPick" pk
   JOIN "Prediction" p ON p.id = pk."predictionId"
   WHERE p.status = 'ACTIVE'
   GROUP BY p."contestId", pk."targetType", pk."targetId";
   ```

   `ContestSummary` 再依 tally 重算領先者與百分比。

4. `ContestTallySnapshot` **不要動**。那是歷史，歷史上那幾天押的就是佔位人選。
   趨勢圖會在換名單那天出現一個斷點，這是事實，不是 bug——真要處理就在圖上標一條
   分隔線，不要竄改資料。

5. 清掉所有 Redis 快照：`snap:*`。

---

## 六、切換名單來源

`src/server/prediction-targets.ts`：

- `candidatesPublished` 從常數改成「這個選區有沒有 `Candidate` 列」。
- `getPredictionTargets(contest)` 有名單就讀資料表，沒有就維持 `getMockCandidates`。
  兩者可以並存：中選會的公告是分批的，沒公告的選區照舊用佔位名單。
- `describeTarget()` 一併改成從資料表查名字與黨籍。

清冊那邊，代表的名額公告如果同時拿到了：

- `scripts/build-election-contests.ts` 的 `toEntry()` 改成從那份資料查名額，
  `seatsSource` 給 `OFFICIAL`。
- 重跑 `npm run data:contests`，然後檢查 `src/server/contest-registry.test.ts` 裡
  「只有代表是 PLACEHOLDER」那條測試——它會失敗，那時候要改成「全部都是
  OFFICIAL」。

前端不用改。名單、席次、分布本來就都是伺服器給的。

---

## 七、照片

`public/avatars/README.md` 有檔名規則，`src/client/avatars.ts` 有 `avatarUrl()`。
名單進來後：

1. 依 `nameEn` 產生檔名，把照片放進 `public/avatars/`。
2. `getPredictionTargets()` 回傳的目標加上 `photoUrl`。
3. 前端的 `CandidateList`、`CardCover`、`ForecastForm` 的頭像位置都已經留好，只要
   把 `photoUrl` 傳進去，版面不用動。

照片的授權要一併記進 `public/avatars/sources.csv`。

---

## 八、順序與檢查點

```
1. 取得公告            → 人工核對選區對照表
2. 匯入 Candidate      → npm run data:candidates（只驗證，先不寫）
3. 備份                → pg_dump
4. 正式匯入            → 寫入 Candidate
5. 遷移舊預測          → 一個 transaction，輸出報告
6. 重算 tally/summary  → SQL
7. 清 Redis            → snap:*
8. 切換名單來源        → prediction-targets.ts
9. 補照片              → public/avatars/
10. 抽查               → 隨機 20 個選區，人工對照公告
```

第 5 步要輸出一份報告，至少包含：

- 成功對應的 pick 數
- 因為該黨沒推人而失效的預測數（依選區列出）
- 因為多位無黨籍而對不到的預測數

失效的使用者應該被告知——他們的預測還在，但那一區要重新押。這是產品決定，不是
技術決定，做之前先確認要不要在畫面上提示。

---

## 九、不要做的事

- **不要刪掉對不到的預測。** 標 `INVALIDATED` 保留，那是稽核資料，也是「有多少人
  在名單公布前就押了某黨」這個問題的唯一答案。
- **不要竄改 `ContestTallySnapshot`。** 趨勢的斷點是事實。
- **不要為了讓每個政黨都有人而建立假候選人。** 某黨在某區沒推人是真實的資訊。
- **不要在同一次部署裡同時換名單與改別的東西。** 出問題時要能一眼看出是哪一邊。
