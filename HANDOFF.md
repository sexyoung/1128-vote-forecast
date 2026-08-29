# HANDOFF — 2026 九合一選舉預測

最後更新：2026-08-29

本檔是目前操作依據。程式碼是最終事實；已刪除一次性 `docs/plan/` 設計稿。

## 目前進度

| 項目       | 狀態     | 備註                                                |
| ---------- | -------- | --------------------------------------------------- |
| SSR        | 完成     | production 由單一 Hono 服務提供 API 與 SSR HTML     |
| SEO        | 完成     | route metadata、canonical、robots、sitemap、JSON-LD |
| 政黨頁     | 完成     | 政黨人數 → 行政區卡 → 職務 TAB → 候選人卡           |
| 候選人排行 | 完成     | `/rankings` 依預測次數列出前 50 位有效候選人        |
| 後台精簡   | 完成     | 只留登入、總覽、留言／檢舉審核                      |
| Analytics  | 未開始   | GA4、PostHog 尚未接                                 |
| Vercel     | 部分完成 | workflow 與 `vercel.json` 已有，runtime 尚缺        |

沒有實際部署。

## 開發與 production 架構

本機固定兩個服務：

- Vite：`5173`
- Hono API：`8787`
- Vite 將 `/api/*` proxy 到 `http://127.0.0.1:8787`
- `npm run dev` 同時啟動兩者

production 固定一個服務：Hono 同時掛 `/api/*` 與 SSR HTML。

測試固定使用同一個 PostgreSQL 的 `vote_forecast_test` schema；啟動測試時自動 migration，
不再清除本機開發資料。

相關檔案：

- `src/client/entry-client.tsx`：有 SSR markup 時 `hydrateRoot`，否則 `createRoot`
- `src/client/entry-server.tsx`：`StaticRouter` + `renderToString`
- `src/server/html.ts`：SSR query seed、HTML、robots、sitemap
- `src/server/render-prod.ts`：載入 production SSR bundle
- `src/server/index.ts`：production 掛上 SSR renderer
- `vite.config.ts`：client + SSR 雙 build；本機 `/api` proxy

2026-08-29 驗證：`npm run build` 同時產出 `dist/client` 與
`dist/server/entry-server.js`；production server 的 `/regions` 回傳已填入 React markup
的 `#root`。SSR 仍在，未被後台精簡移除。

## SEO 決定

- Preview 與未設定正式網域時強制 `noindex,nofollow`。
- 正式網域之後填 `PUBLIC_SITE_URL`。
- 預設 OG 圖之後補；目前不輸出不存在的圖片。
- 選區若有唯一最高票真候選人且有照片，使用該候選人照片作 OG 圖。
- `/admin/*`、`/mine` 不收錄。

## 後台現況

前端只有三個路由：

- `/admin/login`
- `/admin`
- `/admin/moderation`

後端只有七支端點：session 2、overview 1、留言／檢舉管理 4。

候選人放 PostgreSQL。`prisma/seed.ts` 會寫入涵蓋全部選區的假姓名與黨籍；偵測到正式
候選人資料時會停止，不會覆蓋。正式名單收到後直接替換 Candidate。政黨與假名規則集中在
`src/shared/candidates.ts`，後端不再 import 前端 mock 模組。

原型的假預測份數、領先政黨與百分比不寫入後端，避免被誤認為使用者預測；正式 API
在尚無預測時回傳 0。
應選席次 PDF 收到後更新 `scripts/build-election-contests.ts`，再執行
`npm run data:contests` 重產選區清冊。

資料庫 migration `20261112010000_simplify_admin_data` 已套到本機：保留 Candidate，
移除匯入批次、舊預測遷移紀錄、席次覆寫與 `Candidate.batchId`。

## 尚未完成

### Analytics

尚未實作。沒有 analytics env 時必須完全不載入、不送 request。

### Vercel runtime

已有：

- `.github/workflows/deploy-preview.yml`
- `.github/workflows/deploy-production.yml`
- `vercel.json`

仍缺：

- `api/server.ts`
- `npm run vercel-build`
- `/api/cron/hot-snapshots`
- `/api/cron/daily-trend`
- `CRON_SECRET` 驗證

正式部署前還需要 Vercel、Supabase、Upstash、Turnstile 與 GitHub secrets。

## 使用者之後提供

- 正式網域
- 預設 OG 圖
- 正式候選人名單
- 應選席次 PDF

## 驗證狀態

2026-08-29：

- `npm run check`：通過
- `npm run build`：通過，client 與 SSR bundle 都產生
- `npm run db:seed`：重建全部選區的假候選人；若已有正式候選人會安全略過
- `/api/parties/DPP/contests`：回傳 2,584 個參選選區，分 26 頁
- 排除既有 Redis 測試後：116/116
- 唯一失敗：`snapshots.test.ts > rebuilds only what was read this round`
- 原因：本機 Redis tracking set 不可用；不是本次後台或文件精簡造成

## 保留文件

- `README.md`：本機啟動
- `docs/README.md`：資料來源索引
- `docs/2026-election-backend.md`：目前後端資料流與待補官方資料
- `public/avatars/README.md`：候選人靜態照片規格
