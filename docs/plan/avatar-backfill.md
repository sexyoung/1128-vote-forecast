# 候選人大頭照補齊（571 人）

## 現況

正式候選人 857 人，2026-08-31 這一輪補完後仍缺 **395 張**（原本缺 571 張）。
名單見 `docs/candidates-missing-avatar.csv`，指令見下方「重算缺照名單」。

本輪從各議會官網補上 176 張：

| 縣市 | 補上 | 仍缺 | 可用頁面 |
| --- | --- | --- | --- |
| 臺中市 | 29 | 16 | `tccc.gov.tw/wb_introduction01.asp`（`ConnThumb.asp` 把 LW/LH 開大到 400×520 才是原圖 138×192） |
| 臺北市 | 25 | 19 | `tcc.gov.tw/cp.aspx?n=13898`（原圖僅 178×198） |
| 桃園市 | 24 | 18 | `tycc.gov.tw/TC/councilor-all.aspx?mid=39&area=1..14`（圖片路徑用反斜線 `file\person\app`） |
| 高雄市 | 24 | 22 | `kcc.gov.tw/Member_List3.aspx?n=39&sms=9028`（`alt="姓名_大頭照"`，去掉 `@50x67`） |
| 新北市 | 17 | 40 | `ntp.gov.tw/councilor-all?program=37` → 逐頁 `councilor-detail` |
| 新竹縣 | 14 | 8 | `hcc.gov.tw/member-content?program=190&C=30..80` |
| 新竹市 | 13 | 8 | `hsinchu-cc.gov.tw/tc/councilor.aspx?mid=39&c=1..60`（名字取自 `<title>`） |
| 基隆市 | 11 | 7 | `kmc.gov.tw/index.php/mac/mi` |
| 南投縣 | 9 | 3 | `ntcc.gov.tw/tw/rep/index.aspx` |
| 連江縣 | 6 | 1 | `mtcc.gov.tw/ch/counciler_index/7176` |
| 花蓮縣 | 4 | 11 | `hlcc.gov.tw/councillor-data.php?index_no=N` |

掃過但拿不到照片的站：

| 縣市 | 情況 |
| --- | --- |
| 彰化縣 | 議員頁只有姓名與臉書連結，站上沒有照片 |
| 屏東縣 | `ptcc.gov.tw` 議員個人頁沒有照片 |
| 臺南市 | 現任議員上一輪已補完，這次剩下的 29 人都不是現任 |
| 宜蘭縣 | 舊 frameset 網站，議員頁掃不到 |
| 雲林縣 | `ylcc.gov.tw` 議員頁是 SPA，HTML 內沒有資料 |
| 臺東縣 | `taitungcc.gov.tw` 用 axios 打自家 API，未找到端點 |
| 嘉義縣 | Vue 樣板（`item.FirstPicFullPath`），資料來自 API |
| 嘉義市／金門縣 | 名單頁掃不到照片；金門先前誤抓到選區地圖，已刪除 |

## 管線

1. **重算缺照名單**：連 DB 取 `Candidate`，濾掉 id 含 `-CANDIDATE-` 的佔位資料，
   再比對 `public/avatars/{id}.webp` 是否存在，輸出 `missing.json`。
2. **找照片**：`scripts/avatars/scrape-council.py <JID> <議會首頁>` 會從首頁找「議員」
   相關連結、跟進細節頁，用「圖片前後 600 字內出現姓名」的鄰近法配對，輸出
   `src_{JID}.json`。各議會版型差異大，通用法命中率有限，通常要針對該站補一段
   專屬解析（新北是逐頁抓 `img[alt="○○○議員大頭照"]`）。
3. **裁切**：`python3 scripts/avatars/build-avatars.py <jobs.json>`。jobs 是
   `[{code,name,url,licence,attribution,source_url}]`。用 OpenCV 的 YuNet 找臉，
   再照 `TPE-MAYOR-001.webp` 的比例（臉高佔 57%、臉中心在 51%/53%）回推方框，
   輸出最長邊 512 的 webp。找不到臉就退回「直式照從頂端往下 6%」，程式會把這些
   code 印出來要人工確認。模型第一次執行會自動下載到 `node_modules/.cache/avatars/`。
   （舊的 `build-avatars.mjs` 只有固定比例裁切，南投那種帶標語的競選照會裁歪，已改用 py 版。）
4. **記來源**：每張照片在 `public/avatars/sources.csv` 補一列（授權、出處、來源網址）。

## 覆蓋率的現實

議會官網只有**現任議員**，而 2026 的提名名單裡有大量新人與挑戰者：
臺北市 44 人只對得到 25 人、新北市 57 人只對得到 17 人。
照這個比例，22 個議會全掃完大約只能補到 200～250 張，剩下 300 多人
（新人、鄉鎮市長參選人）官方來源沒有照片。

剩下這批只能靠個人臉書／競選網站／新聞照，牽涉兩個問題，需要專案擁有者決定：

- **授權**：新聞照多半有版權，跟現有 `sources.csv` 全部是政府或政黨官方素材的作法不一致。
- **正確性**：同名同姓風險高，逐人比對無法完全自動化，貼錯臉是對真實人物的實質傷害。

專案擁有者已決定：**官方來源之外，可以再用候選人自己的粉專／競選網站的形象照**，
但不採用新聞照。每一張一樣要在 `sources.csv` 記下來源網址。

## 下一步

1. 剩下的議會多半是 SPA／API 站（雲林、臺東、嘉義縣、宜蘭），要各自找出 XHR 端點；
   彰化、屏東官網確定沒有照片，直接歸到粉專那一批。
2. 鄉鎮市長 84 人：現任者從各鄉鎮公所官網「首長介紹」抓。
3. 立委轉戰者（謝龍介、柯志恩等）用立法院官網或 Wikimedia Commons。
4. 其餘新人依專案擁有者的決定，用候選人自己的粉專／競選網站形象照，逐張記來源。
5. 每做完一批就重算缺照名單並更新 `docs/candidates-missing-avatar.csv`。
