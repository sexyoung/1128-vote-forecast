# VoteScope starter

以 Vite+、React + TypeScript、Tailwind CSS、React Router、TanStack Query、Hono 與 Prisma 組成的全端基礎架構。

## 開始使用

先安裝 [Vite+ CLI](https://viteplus.dev/guide/)（只需安裝一次），再執行：

```bash
vp install
cp .env.example .env
docker compose up -d
vp exec prisma migrate deploy
vp run db:seed
vp run dev
```

開啟 <http://localhost:5173>。首頁刻意保持空白，無樣式的工具示意頁位於
<http://localhost:5173/tools>。Vite 會將 `/api` 代理到在 <http://localhost:8787>
執行的 Hono server。

此專案預設在 Dev Container 中開發，因此 API 透過 `host.docker.internal:5435`
連到宿主機上的 Compose PostgreSQL；`5435` 是宿主機 port，容器內仍使用標準的
`5432`。

## 常用指令

```bash
vp run dev          # 同時啟動 React 與 Hono
vp check            # 格式、lint、型別檢查
vp test --run       # API 測試
vp build            # 前端 production build
vp run db:migrate   # 建立 Prisma migration
vp run db:studio    # 開啟 Prisma Studio
```

## PostgreSQL

開發資料庫由 `compose.yaml` 提供 PostgreSQL 17，資料保存在具名 volume `postgres_data`：

```bash
docker compose up -d                 # 啟動
docker compose ps                    # 查看健康狀態
docker compose logs -f postgres      # 查看資料庫日誌
docker compose down                  # 停止（保留資料）
docker compose down -v               # 停止並刪除開發資料
```

正式環境請以 secret 注入 `DATABASE_URL`，不要沿用 Compose 裡的開發帳密。
