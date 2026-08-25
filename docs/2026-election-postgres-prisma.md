# 2026 九合一選舉預測系統 — PostgreSQL / Prisma 設計

## 目的

本文件只描述「會隨使用者操作、預測狀態、候選人狀態而變動」的資料。

**不要把固定選舉主資料強制塞進 PostgreSQL。**

固定資料建議由 Git 管理，例如：

- `2026-election-fixed.json`
- 後續可拆成 `election.json` / `districts.json` / `parties.json` / `candidates.json`

PostgreSQL 主要保存：

- 使用者
- 使用者預測
- 預測歷史
- 候選人狀態快照（若候選人資料需要後台管理）
- 選區預測聚合快取（可選）

---

## 一、最重要的資料原則

### 1. Party 不代表該黨一定在該選區參選

不要在 `Party` 上建立：

```text
party.hasCandidateInDistrict
```

因為這是「選區 + 選舉 + 候選人」才能決定的事。

例如：

```text
TPP
  ├── 臺北市長：有候選人
  └── 某議員選區：沒有候選人
```

因此是否參選應由 Candidate 關聯推導。

### 2. 候選人未公布時，不建立虛構 Candidate

此階段 Prediction 可以：

```text
targetType = PARTY
targetId   = KMT
```

候選人正式名單建立後才可以：

```text
targetType = CANDIDATE
targetId   = candidate UUID
```

### 3. 歷史預測不能因候選人後來不存在而刪除

例如使用者在 2026-08-25 預測：

```text
新北市某選區 → 民眾黨
```

之後正式候選人名單公布，該選區沒有民眾黨候選人。

原預測仍應保留，並標記：

```text
INVALIDATED
reason = PARTY_HAS_NO_CANDIDATE
```

這是重要的稽核資料。

---

# 二、資料關係

```text
User
 │
 └──< Prediction >── District
           │
           ├── targetType = PARTY
           │       └── Party
           │
           └── targetType = CANDIDATE
                   └── Candidate ── Party

Election
 │
 └── District

District
 │
 └──< Candidate

Party
 │
 └──< Candidate
```

固定的 `Election / District / Party` 可以由 JSON 提供。

如果未來需要完整後台管理，再將它們 mirror 到 DB。

---

# 三、Prisma Schema

> 以下 schema 是「動態資料核心」。固定選舉 JSON 不必因此被迫存進 DB。

```prisma
enum PredictionTargetType {
  PARTY
  CANDIDATE
}

enum PredictionStatus {
  ACTIVE
  INVALIDATED
  LOCKED
}

enum PredictionInvalidReason {
  PARTY_HAS_NO_CANDIDATE
  CANDIDATE_WITHDRAWN
  CANDIDATE_DISQUALIFIED
  DISTRICT_CHANGED
  ELECTION_CANCELLED
  ADMIN_INVALIDATED
}

enum CandidateStatus {
  REGISTERED
  CONFIRMED
  WITHDRAWN
  DISQUALIFIED
}

model User {
  id          String       @id @default(cuid())
  email       String?      @unique
  displayName String?
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt

  predictions Prediction[]
}

model Prediction {
  id                 String                    @id @default(cuid())

  userId             String
  electionId         String
  districtId         String

  targetType         PredictionTargetType
  targetId           String

  status             PredictionStatus          @default(ACTIVE)
  invalidReason      PredictionInvalidReason?

  createdAt          DateTime                  @default(now())
  updatedAt          DateTime                  @updatedAt

  user               User                      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([electionId, districtId])
  @@index([userId, electionId])
  @@index([districtId, targetType, targetId])
  @@index([status])
}
```

---

# 四、為什麼 Prediction 不直接 FK 到 Party / Candidate？

因為：

```text
targetType + targetId
```

是一個 polymorphic reference。

例如：

```json
{
  "targetType": "PARTY",
  "targetId": "KMT"
}
```

或：

```json
{
  "targetType": "CANDIDATE",
  "targetId": "candidate-uuid"
}
```

PostgreSQL 原生 FK 無法同時指向兩張不同的 table。

**第一版建議保持簡單。**

後端 service layer 必須驗證：

```text
targetType = PARTY
→ targetId 必須存在於 Party

targetType = CANDIDATE
→ targetId 必須存在於 Candidate
→ Candidate 必須屬於 districtId
→ Candidate 必須屬於 electionId
```

---

# 五、如果未來需要 DB 管理候選人

如果 Codex 後續決定候選人資料也需要 PostgreSQL，加入：

```prisma
model Candidate {
  id           String          @id @default(cuid())

  electionId   String
  districtId   String
  partyId      String?

  name         String
  status       CandidateStatus @default(REGISTERED)

  candidateNo  Int?

  createdAt    DateTime        @default(now())
  updatedAt    DateTime        @updatedAt

  party        Party?          @relation(fields: [partyId], references: [id])

  @@index([electionId, districtId])
  @@index([districtId, partyId])
  @@index([partyId])
  @@unique([electionId, districtId, candidateNo])
}

model Party {
  id          String      @id
  name        String
  shortName   String
  status      String      @default("active")

  candidates  Candidate[]
}
```

---

# 六、如果 Election / District 也進 DB

只有在需要後台管理、管理員編輯、歷屆選舉查詢或 API 全部資料庫化時才建議加入。

```prisma
model Election {
  id            String     @id
  year          Int
  rocYear       Int
  name          String
  electionDate  DateTime
  status        String

  districts     District[]

  @@index([year])
}

model District {
  id             String     @id
  electionId     String
  electionTypeId String
  jurisdictionId String

  name           String
  districtNo     Int?
  seats          Int

  election       Election   @relation(fields: [electionId], references: [id], onDelete: Cascade)

  candidates     Candidate[]

  @@index([electionId, electionTypeId])
  @@index([jurisdictionId])
}
```

---

# 七、預測統計

不要每次使用者進頁面都：

```sql
COUNT(*) GROUP BY target
```

如果使用者很多，可以建立 aggregation table 或 cache。

第一版可以先直接 query：

```sql
SELECT target_type, target_id, COUNT(*)
FROM "Prediction"
WHERE district_id = ?
  AND status = 'ACTIVE'
GROUP BY target_type, target_id;
```

流量變大後再建立：

```prisma
model PredictionAggregate {
  id          String   @id @default(cuid())

  electionId  String
  districtId  String
  targetType  PredictionTargetType
  targetId    String

  predictionCount Int @default(0)
  percentage      Float?

  updatedAt   DateTime @updatedAt

  @@unique([electionId, districtId, targetType, targetId])
  @@index([districtId])
}
```

---

# 八、推薦 API

## 讀取固定選區

```http
GET /api/elections/2026/districts
GET /api/elections/2026/districts/:districtId
```

資料來源可以直接是 JSON。

## 取得某選區目前可預測目標

```http
GET /api/elections/2026/districts/:districtId/prediction-options
```

API 應依候選人狀態回傳：

```json
{
  "mode": "party",
  "parties": [...]
}
```

或：

```json
{
  "mode": "candidate",
  "candidates": [...]
}
```

## 建立預測

```http
POST /api/predictions
```

```json
{
  "electionId": "TW-LOCAL-2026",
  "districtId": "2026-TPE-MAYOR",
  "targetType": "PARTY",
  "targetId": "KMT"
}
```

---

# 九、候選人公布後的資料流程

```text
候選人尚未公布
        │
        ▼
prediction mode = PARTY
        │
        │ 使用者預測
        ▼
Prediction(targetType=PARTY)
        │
        ▼
候選人正式名單公布
        │
        ▼
建立 Candidate
        │
        ├── KMT → Candidate A
        ├── DPP → Candidate B
        └── TPP → 無 Candidate
                    │
                    ▼
        TPP 的舊 Prediction
        status = INVALIDATED
        reason = PARTY_HAS_NO_CANDIDATE
```

---

# 十、不要做的事情

### 不要

```json
{
  "party": "TPP",
  "hasCandidate": false
}
```

因為這是衍生資料。

### 不要

```json
{
  "candidate": {
    "name": "待公布"
  }
}
```

因為這會污染正式候選人資料。

### 不要

候選人不存在就刪除使用者原本的預測。

應該保留歷史並 invalidated。

---

# 十一、固定 JSON 與 PostgreSQL 的邊界

```text
Git / JSON
│
├── election
├── election types
├── jurisdictions
├── districts
├── parties
└── candidates（如果選擇 Git 管理）
│
▼
Application
│
├── 顯示選區
├── 顯示候選人
├── 判斷目前 prediction mode
│
▼
PostgreSQL
│
├── users
├── predictions
├── prediction history
└── prediction aggregates（需要時）
```

---

# 十二、Codex 實作順序

建議 Codex 嚴格依序：

1. 建立固定 election JSON
2. 建立選區查詢 domain/service
3. 完成選區瀏覽 UI
4. 建立 User / Prediction Prisma schema
5. 實作 PARTY prediction
6. 實作 prediction statistics
7. 匯入正式 Candidate data
8. 啟用 CANDIDATE prediction
9. 處理 PARTY → INVALIDATED 的歷史預測
10. 最後才做排行榜、地圖與預測結果視覺化

**不要一開始就做候選人資料庫。**

先讓「選區 → 政黨預測 → 統計」完整跑起來，再接候選人，是風險最低的開發順序。

---

## 資料來源與完整性注意事項

2026 年 8 月 20 日中選會已正式公告直轄市長、縣市長、直轄市議員、縣市議員的選舉區、名額等事項；同日也公告鄉鎮市長、山地原住民區長、鄉鎮市民代表、山地原住民區民代表及村里長的選舉公告。citeturn4search1turn0search3

因此這份基礎文件**刻意不把我無法從目前官方可檢索內容逐筆核對的數千個基層細分選區硬塞進 JSON**。尤其鄉鎮市民代表選區由各縣市選委會劃分，而村里長則以各村里為選舉區；法律上兩者的劃分機關與層級不同。citeturn6search3turn1search2

這比產生一份看似完整、實際上混入 2022 舊選區的 JSON 更安全。官方公告本身也明確指出本次選舉公告包含各選舉種類、名額與選舉區劃分。citeturn4search2
