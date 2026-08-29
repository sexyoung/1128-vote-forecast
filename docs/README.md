# 2026 九合一選舉預測系統 Foundation

本資料夾提供 Codex 開發的第一版基礎文件。

## Files

- `2026-election-fixed.json`
  - 固定選舉 metadata
  - 9 種選舉類型
  - 22 個縣市/直轄市 jurisdiction
  - 行政區型的市長、縣市長、山地原住民區長選區
  - 政黨 master data
  - 明確標示尚未逐筆官方核對的細分選區不可自行猜測

- `2026-election-backend.md`
  - 現行後端資料流、API 與待補官方資料

## Important

不要把 JSON 中不存在的選區、政黨參選狀態或候選人自行推測補入。

正式候選人資料與各縣市細分選區應以 2026-08-20 中選會及各縣市選委會正式公告為 source of truth。
