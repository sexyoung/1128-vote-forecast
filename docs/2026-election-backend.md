# 2026 地方選舉預測 — 後端設計

這份文件描述前端已經做完之後，後端要長成什麼樣子。它取代不了
`2026-election-postgres-prisma.md`，而是接在它後面：那份談的是「固定選舉資料留在
Git、動態資料進 PostgreSQL」的分界，這份把分界落到具體的 schema、Redis 用法、
身份辨識與上傳流程。

前提條件有三個，會反覆出現在下面的設計裡：

1. **不需要登入**。使用者靠瀏覽器指紋與 cookie 辨識。
2. **一個人對一個選區只能預測一次**，改預測是覆蓋，不是新增。
3. **瀏覽量會集中在少數幾個端點**（地圖首頁、熱門選區），所以聚合結果要事先算好。

---

## 一、選區 ID 與選區清冊

前端的選區代號已經是穩定字串，全部由官方代碼推導，可以直接當資料庫的 key，
不需要另外建一張 districts 表：

| 形狀                             | 例                             | 來源                   |
| -------------------------------- | ------------------------------ | ---------------------- |
| `{縣市}-EXECUTIVE-1`             | `TPE-EXECUTIVE-1`              | `mock-election.ts`     |
| `{縣市}-COUNCIL-{n}`             | `NTP-COUNCIL-2`                | `council-districts.ts` |
| `town-{TOWNCODE}-TOWNSHIP`       | `town-10008010-TOWNSHIP`       | 鄉鎮市區圖資           |
| `town-{TOWNCODE}-REPRESENTATIVE` | `town-10008010-REPRESENTATIVE` | 鄉鎮市區圖資           |
| `vill-{VILLCODE}-VILLAGE`        | `vill-10008010001-VILLAGE`     | 村里圖資               |

但伺服器**必須**有一份選區清冊，否則無法驗證兩件事：這個 `contestId` 是否存在、
這一場應選幾席（複數席次要檢查勾選數量）。

因此 build 時產生 `election-contests.json`，伺服器啟動時載入記憶體並寫進 Redis：

```jsonc
{
  "id": "TPE-COUNCIL-1",
  "jurisdictionId": "TPE",
  "type": "COUNCIL",
  "name": "議員第 1 選舉區",
  "area": "北投區、士林區",
  "seats": 12,
  "seatsSource": "OFFICIAL",
}
```

`seatsSource` 只有兩個值：

- `OFFICIAL` — 席次有官方依據。
- `PLACEHOLDER` — 席次是估的，畫面上要標明，統計要另外看待。

### 各選舉種類的席次來源

| 選舉種類                                   | 席次       | 來源                                       | 狀態              |
| ------------------------------------------ | ---------- | ------------------------------------------ | ----------------- |
| 直轄市長、縣（市）長                       | 1          | 法定                                       | `OFFICIAL`        |
| 直轄市議員、縣（市）議員                   | 1–13       | 中選務字第 1153150253 號公告（2026-08-20） | `OFFICIAL`        |
| 鄉（鎮、市）長、山地原住民區長             | 1          | 法定                                       | `OFFICIAL`        |
| 村（里）長                                 | 1          | 法定                                       | `OFFICIAL`        |
| **鄉（鎮、市）民代表、山地原住民區民代表** | **估計值** | **尚未取得**                               | **`PLACEHOLDER`** |

議員席次已與 `council-districts.ts` 逐筆核對過公告，兩邊一致（221 個選舉區：
161 個區域、23 個平地原住民、37 個山地原住民）。

代表的名額由各縣市選舉委員會依地方制度法第 33 條按人口劃分，不在中選會那份公告
裡。`buildRepresentativeContest()` 目前用 `5 + (seed % 4) * 2` 產生暫定值，取得
正式公告前一律標 `PLACEHOLDER`。**這是上線前必須補齊的資料缺口。**

### 山地原住民區

直轄市的市轄區沒有區長選舉，但地方制度法第 83-2 條把五個山地原住民區改制為地方
自治團體，區長與區民代表都是民選：

| 區       | TOWNCODE | 所屬直轄市 |
| -------- | -------- | ---------- |
| 復興區   | 68000130 | 桃園市     |
| 和平區   | 66000290 | 臺中市     |
| 茂林區   | 64000360 | 高雄市     |
| 桃源區   | 64000370 | 高雄市     |
| 那瑪夏區 | 64000380 | 高雄市     |

清冊產生器與前端共用 `map-shapes.ts` 的 `indigenousDistricts`，直轄市只會列出這
五個區，縣則列出全部鄉鎮市。

### 選區總量

| 選舉種類                 | 筆數     |
| ------------------------ | -------- |
| 縣市長                   | 22       |
| 議員                     | 221      |
| 鄉鎮市長／山地原住民區長 | 約 250   |
| 鄉鎮市民代表／區民代表   | 約 250   |
| 村里長                   | 7,780    |
| 合計                     | 約 8,500 |

這個量級對 PostgreSQL 沒有壓力，但會決定 Redis 快照的切法（見第五節）。

---

## 二、身份：cookie 為主，指紋為輔

指紋不能單獨當身份。同型號同版本的手機會產生相同的指紋，指紋也可以偽造。所以
指紋只是「cookie 被清掉之後的復原線索」與「防灌票的訊號」，真正保證「一人一區
一次」的是資料庫的唯一鍵。

辨識流程：

1. 請求帶著 httpOnly cookie 裡的 token，命中就是那個身份。
2. 沒有 cookie，但指紋在近期出現過而且只對應到一個身份，就復用它並補發 cookie。
3. 都不成立就建立新身份。

指紋與 IP 一律以 HMAC（伺服器 pepper）儲存，不留原值。

```prisma
model Forecaster {
  id              String    @id @default(cuid())
  displayName     String?   @db.VarChar(24)
  avatarKey       String?   // 物件儲存的 key，不存二進位內容
  avatarBlockedAt DateTime? // 頭像被下架的時間
  humanVerifiedAt DateTime? // 最近一次通過 Turnstile
  blockedAt       DateTime?
  createdAt       DateTime  @default(now())
  lastSeenAt      DateTime  @default(now())

  signals     ForecasterSignal[]
  predictions Prediction[]
  comments    Comment[]

  @@index([lastSeenAt])
}

enum SignalKind {
  COOKIE
  FINGERPRINT
  IP
}

model ForecasterSignal {
  id           String     @id @default(cuid())
  forecasterId String
  kind         SignalKind
  hash         String // HMAC(pepper, 原值)
  firstSeenAt  DateTime   @default(now())
  lastSeenAt   DateTime   @default(now())
  seenCount    Int        @default(1)

  forecaster Forecaster @relation(fields: [forecasterId], references: [id], onDelete: Cascade)

  @@unique([forecasterId, kind, hash])
  // 刻意不是 unique：一個指紋可能對應到多個身份（同型號裝置）。
  @@index([kind, hash])
}
```

### Turnstile

寫入端點（送出預測、留言）需要 Cloudflare Turnstile。驗證策略是**首次寫入驗一
次**，通過後 12 小時內信任同一個身份，不是每次送出都驗。這樣 UX 好得多，而防護
效果幾乎相同，因為要擋的是自動化腳本，不是人。

驗證通過時寫 `Forecaster.humanVerifiedAt`。

### 誠實的限制

這套組合擋得住一般使用者重複投票與簡單腳本，擋不住刻意清除 cookie、換瀏覽器或
換裝置的人。要更硬只剩下簡訊或第三方登入，那會違反「不用登入」的前提。防線因此
是分層的：cookie 與指紋負責一般情況，Turnstile 擋自動化，Redis 速率限制擋量產，
資料庫唯一鍵是最後保證。

---

## 三、預測

一個人對一個選區只有一筆 `Prediction`；議員那種複數席次會有多個 `PredictionPick`。
改預測時整組替換，舊的收進 `PredictionRevision`。

```prisma
enum PredictionTargetType {
  PARTY
  CANDIDATE
}

enum PredictionStatus {
  ACTIVE
  INVALIDATED
}

enum PredictionInvalidReason {
  PARTY_HAS_NO_CANDIDATE
  CANDIDATE_WITHDRAWN
  CANDIDATE_DISQUALIFIED
  DISTRICT_CHANGED
  ADMIN_INVALIDATED
}

model Prediction {
  id            String                   @id @default(cuid())
  forecasterId  String
  contestId     String
  seatCount     Int // 送出當下的應選席次，之後改制也查得回來
  status        PredictionStatus         @default(ACTIVE)
  invalidReason PredictionInvalidReason?
  version       Int                      @default(1)
  createdAt     DateTime                 @default(now())
  updatedAt     DateTime                 @updatedAt

  forecaster Forecaster           @relation(fields: [forecasterId], references: [id], onDelete: Cascade)
  picks      PredictionPick[]
  revisions  PredictionRevision[]

  // 一人一區只有一筆。這是「不能重複預測」的實際保證。
  @@unique([forecasterId, contestId])
  @@index([contestId, status])
}

model PredictionPick {
  predictionId String
  targetType   PredictionTargetType
  targetId     String // 'KMT' 或 candidate id

  prediction Prediction @relation(fields: [predictionId], references: [id], onDelete: Cascade)

  @@id([predictionId, targetType, targetId])
  @@index([targetType, targetId])
}

model PredictionRevision {
  id           String   @id @default(cuid())
  predictionId String
  version      Int
  picks        Json
  createdAt    DateTime @default(now())

  prediction Prediction @relation(fields: [predictionId], references: [id], onDelete: Cascade)

  @@unique([predictionId, version])
}
```

`targetType + targetId` 是 polymorphic reference，不下外鍵——PostgreSQL 的外鍵無法
同時指向兩張表。改由 service layer 驗證：

- `PARTY` — `targetId` 必須是已知政黨。
- `CANDIDATE` — 候選人必須存在，而且屬於這個選區。

候選人名單公布後，某政黨在該選區沒有推人的舊預測標 `INVALIDATED`
（`PARTY_HAS_NO_CANDIDATE`），不刪除。這是稽核資料。

### 寫入流程

單一 PostgreSQL transaction：

1. 依 `(forecasterId, contestId)` upsert `Prediction`，`version` 加一。
2. 比對新舊 `picks`。
3. 對每個異動的目標調整 `ContestTally.count`（±1）。
4. 重算 `ContestSummary`（總數、領先者、百分比）。
5. 追加 `PredictionRevision`。

commit 之後才去清 Redis 快照。順序反過來的話，快照會抓到還沒 commit 的舊值。

---

## 四、統計的物化表

地圖首頁一次需要 22 個縣市的領先者與比例，下鑽還要幾百個選區。不能每次
`COUNT(*) GROUP BY`。

```prisma
model ContestTally {
  contestId  String
  targetType PredictionTargetType
  targetId   String
  count      Int      @default(0)
  updatedAt  DateTime @updatedAt

  @@id([contestId, targetType, targetId])
  @@index([contestId])
}

model ContestSummary {
  contestId        String                @id
  jurisdictionId   String
  totalPredictions Int                   @default(0)
  leaderType       PredictionTargetType?
  leaderId         String?
  leaderPercent    Int?
  updatedAt        DateTime              @updatedAt

  @@index([jurisdictionId])
}

model ContestTallySnapshot {
  contestId  String
  capturedOn DateTime             @db.Date
  targetType PredictionTargetType
  targetId   String
  count      Int

  @@id([contestId, capturedOn, targetType, targetId])
}
```

`ContestSummary` 是地圖著色唯一需要的東西，一個選區一列。
`ContestTallySnapshot` 由每日 cron 寫入，是趨勢分頁的資料來源；只寫「有預測的
選區」，否則 8,500 個選區 × 4 個目標 × 365 天會累積到千萬列而且大半是零。

---

## 五、Redis

Redis 在這裡不是被動快取，而是**主動快照**：一支 cron 把重運算的結果算好寫進去，
請求路徑只讀 Redis。Redis 沒有資料時才回頭讀 PostgreSQL 的物化表，所以 Redis 掛掉
只會變慢，不會壞掉。

### 快照（60 秒 cron）

| key                       | 內容               | 為什麼要快照        |
| ------------------------- | ------------------ | ------------------- |
| `snap:map:national`       | 22 個縣市摘要      | 首頁必打，最熱      |
| `snap:map:{jid}:township` | 該縣市所有鄉鎮市區 | 下鑽必打            |
| `snap:map:{jid}:village`  | 該縣市所有村里     | 新北 1,039 筆，最貴 |
| `snap:contest:{id}`       | 單一選區的完整分布 | 抽屜與卡片          |
| `snap:trend:{id}:30`      | 30 日走勢          | 每次算都要掃快照表  |
| `snap:comments:{id}:p1`   | 留言第一頁         | 讀多寫少            |

村里層的 payload 最大，快照時就壓成前端真正要的最小欄位
（`id` / `leaderId` / `percent`），不要回傳整份 tally。

### 其他用途

| key                         | 內容             | TTL      |
| --------------------------- | ---------------- | -------- |
| `sess:{token}`              | forecasterId     | 30 天    |
| `fp:{hash}`                 | forecasterId     | 90 天    |
| `rl:newid:{ipHash}`         | 每小時新身份上限 | 1 小時   |
| `rl:pred:{forecasterId}`    | 預測寫入速率     | 滑動視窗 |
| `rl:comment:{forecasterId}` | 留言速率         | 滑動視窗 |
| `idem:{key}`                | POST 重送去重    | 24 小時  |

預測是低頻寫入（一個人對一個選區只寫一次），不需要 Redis 計數器緩衝，直接寫
PostgreSQL 就好。

### 降級

- 讀取：Redis 沒有就讀 `ContestSummary` / `ContestTally`，順便回填。
- 速率限制：Redis 不可用時放行，因為唯一鍵仍然擋得住重複預測；留言則退回較嚴格
  的資料庫層計數。

---

## 六、圖片上傳

使用者頭像不進 PostgreSQL，走物件儲存（R2 / S3 / MinIO 皆可）：

1. `POST /api/me/avatar/upload-url` — 驗證 MIME 與大小上限（5 MB），回傳 presigned
   PUT，key 落在 `staging/{forecasterId}/{uuid}`。
2. 前端直接 PUT 到物件儲存。
3. `POST /api/me/avatar/commit` — 伺服器用 sharp 重新編碼成 256×256 webp，順便清掉
   EXIF 與可能夾帶的酬載，寫到 `avatars/{forecasterId}.webp`，刪掉 staging 物件，
   更新 `Forecaster.avatarKey`。

重新編碼不是可選項：直接把使用者上傳的檔案原樣公開，等於把任意二進位內容掛在
自己的網域下。

候選人照片仍由 Git 管理（`public/avatars/`，檔名規則見該目錄的 README）。等中選會
公布正式名單後再考慮搬進 `Candidate.photoKey`。

---

## 七、留言與檢舉

```prisma
enum CommentStatus {
  VISIBLE
  HIDDEN
  DELETED
}

model Comment {
  id           String        @id @default(cuid())
  contestId    String
  forecasterId String
  parentId     String?
  body         String        @db.VarChar(1000)
  status       CommentStatus @default(VISIBLE)
  createdAt    DateTime      @default(now())

  forecaster Forecaster @relation(fields: [forecasterId], references: [id], onDelete: Cascade)

  @@index([contestId, status, createdAt])
  @@index([parentId])
}

enum ReportTargetType {
  COMMENT
  AVATAR
}

enum ReportReason {
  SPAM
  ABUSE
  ADULT
  ILLEGAL
  OTHER
}

enum ReportStatus {
  OPEN
  ACTIONED
  DISMISSED
}

model Report {
  id         String           @id @default(cuid())
  targetType ReportTargetType
  targetId   String // commentId 或 forecasterId
  reporterId String
  reason     ReportReason
  note       String?          @db.VarChar(500)
  status     ReportStatus     @default(OPEN)
  handledBy  String?
  handledAt  DateTime?
  createdAt  DateTime         @default(now())

  @@index([targetType, targetId])
  @@index([status, createdAt])
}
```

留言與使用者頭像都是使用者產生的內容，v1 至少要有檢舉入口與後台下架。後台端點用
獨立的 admin token 保護，不共用一般身份。

---

## 八、API

```
GET  /api/session                        身份、暱稱、頭像、已預測數
PUT  /api/me                             改暱稱
POST /api/me/avatar/upload-url
POST /api/me/avatar/commit

GET  /api/map/national                   22 縣市摘要
GET  /api/map/:jurisdictionId?level=     鄉鎮市區／村里層

GET  /api/contests/:id                   分布 ＋ 我的預測
POST /api/contests/:id/prediction        upsert，body 是 picks[]
GET  /api/contests/:id/trend?days=30
GET  /api/me/predictions

GET  /api/contests/:id/comments
POST /api/contests/:id/comments
POST /api/reports

POST /api/admin/comments/:id/hide        admin token
POST /api/admin/forecasters/:id/block    admin token
```

`POST /api/contests/:id/prediction` 的驗證順序：選區存在 → 勾選數等於 `seats` →
目標型別與名單相符 → Turnstile → 速率限制 → 寫入。

---

## 九、實作順序

1. **選區清冊**：build script 產生 `election-contests.json`，帶 `seatsSource`。
2. **Prisma schema 與 migration**：本文件所有 model。
3. **身份層**：cookie 發放、指紋 HMAC 回收、Turnstile、Redis 速率限制。
4. **預測寫入**：單一 transaction 的 upsert ＋ tally ＋ summary ＋ revision。
5. **讀取 API 與快照 cron**：第五節的六個 key。
6. **頭像上傳**：presigned PUT ＋ sharp 重編碼。
7. **留言、檢舉、後台**。
8. **趨勢每日 cron**。

前端接線在每個階段結束時各接一段，不要等後端全部做完才開始接。

---

## 十、待補

- **鄉鎮市民代表與山地原住民區民代表的名額**。中選會 2026-08-20 另有一份涵蓋鄉鎮
  市長、代表與村里長的公告，取得後把 `seatsSource` 從 `PLACEHOLDER` 換成
  `OFFICIAL`。在那之前這兩種選舉的席次是估的。
- **候選人名單**。中選會預定 2026-11 公告，在那之前前端用
  `getMockCandidates()` 產生的佔位名稱（「國民黨候選人 1」）。名單進來後才會有
  `CANDIDATE` 型別的預測目標，以及舊 `PARTY` 預測的失效處理。
