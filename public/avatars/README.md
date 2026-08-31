# 候選人照片

候選人 CSV 的 `code` 是永久識別碼，也是照片檔名：

```text
public/avatars/{code}.webp
```

例如候選人代碼是 `TPE-MAYOR-001`：

```text
public/avatars/TPE-MAYOR-001.webp
```

- 只使用 `.webp`
- 正方形，短邊至少 208px
- 單張建議 60KB 以內
- 前台提案可提供遠端照片網址；後台批准時會下載、裁為 512 × 512 並轉成 WebP。
  產生的檔案仍須由管理者 commit 並重新部署；資料庫不保存圖片。
- 放入前需確認照片來源與授權，記錄在 `sources.csv`

沒有檔案時，畫面顯示淺灰人物圖示。
