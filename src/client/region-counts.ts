// 由 public/maps/townships/*.svg 與 public/maps/villages/*.svg 數出來的筆數。
// 選舉種類分頁上的數量要在切進去之前就顯示，但村里圖資一個縣市 280KB，
// 不能為了一個數字先載進來，所以把數字固定在這裡。圖資換版時要一起更新。
export const regionCounts: Record<string, { townships: number; villages: number }> = {
  'changhua-county': { townships: 26, villages: 591 },
  'chiayi-city': { townships: 2, villages: 84 },
  'chiayi-county': { townships: 18, villages: 358 },
  'hsinchu-city': { townships: 3, villages: 122 },
  'hsinchu-county': { townships: 13, villages: 193 },
  'hualien-county': { townships: 13, villages: 178 },
  'kaohsiung-city': { townships: 38, villages: 893 },
  'keelung-city': { townships: 7, villages: 157 },
  'kinmen-county': { townships: 6, villages: 37 },
  'lienchiang-county': { townships: 4, villages: 22 },
  'miaoli-county': { townships: 18, villages: 277 },
  'nantou-county': { townships: 13, villages: 263 },
  'new-taipei-city': { townships: 29, villages: 1039 },
  'penghu-county': { townships: 6, villages: 96 },
  'pingtung-county': { townships: 33, villages: 442 },
  'taichung-city': { townships: 29, villages: 625 },
  'tainan-city': { townships: 37, villages: 650 },
  'taipei-city': { townships: 12, villages: 456 },
  'taitung-county': { townships: 16, villages: 139 },
  'taoyuan-city': { townships: 13, villages: 529 },
  'yilan-county': { townships: 12, villages: 237 },
  'yunlin-county': { townships: 20, villages: 392 },
};
