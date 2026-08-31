/**
 * 上版紀錄。頁尾的版號與 /changelog 都讀這一份，package.json 的 version 要跟著
 * 第一筆一致（changelog.test.ts 會擋）。發版時在最前面加一筆，不要改舊的。
 *
 * 這是給訪客看的：只寫使用者在站上感覺得到的改動。後台、部署、重構那些不寫。
 */

export type Release = {
  version: string;
  /** 上版日期，YYYY-MM-DD。 */
  date: string;
  changes: string[];
};

export const releases: Release[] = [
  {
    version: '0.1.1',
    date: '2026-08-31',
    changes: ['改善社群分享預覽，以及搜尋引擎與 AI 服務對網站內容的辨識。'],
  },
  {
    version: '0.1.0',
    date: '2026-08-31',
    changes: [
      '全臺 22 縣市的預測地圖，從縣市長一路看到村里長。',
      '免登入就能預測：一個裝置在一個選區只留一份，隨時可以改。',
      '預測送出後即時彙總，地圖與各選區的分布跟著更新。',
      '各選區的趨勢圖，看得到預測分布每天的變化。',
      '各選區的留言區，看到違規內容可以檢舉。',
      '政黨頁與熱門候選人排行。',
      '縣市長候選人照片。',
      '分享按鈕，分享出去的預覽圖會帶上該選區目前最多人預測的人選。',
      '隱私權政策與使用條款。',
    ],
  },
];

export const currentVersion = releases[0].version;
