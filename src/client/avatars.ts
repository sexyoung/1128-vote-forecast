// 候選人照片放在 public/avatars/，檔名規則與那裡的 README.md 是同一份，
// 改這裡要一起改（avatars.test.ts 會比對兩邊的例子）。
//
// 目前沒有任何檔案：中選會要到 2026-11-12／11-17 才公告候選人名單（候選人
// 2026-08-31 才開始登記），在那之前 getMockCandidates() 產生的是「民進黨候選人 1」
// 這種佔位名稱，沒有真實姓名就沒有拼音，檔名的第三個欄位湊不出來。

export const avatarExtensions = ['jpg', 'webp', 'png'] as const;

export type AvatarExtension = (typeof avatarExtensions)[number];

/** 「陳美玲」的拼音 `Chen Mei-Ling` → `chen-mei-ling`。 */
export function toAvatarSlug(romanizedName: string) {
  return romanizedName
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** `[選區代號]-[政黨英文簡稱]-[候選人英文拼音].[副檔名]` */
export function avatarFileName(
  contestId: string,
  partyId: string,
  romanizedName: string,
  extension: AvatarExtension = 'jpg',
) {
  return `${contestId}-${partyId}-${toAvatarSlug(romanizedName)}.${extension}`;
}

/**
 * 傳進 CardCover 的 photo。名字還沒公告（或那個人還沒有照片）就回 null，
 * 封面自動退回名字第一個字的色塊，不會送出 404。
 */
export function avatarUrl(
  contestId: string,
  partyId: string,
  romanizedName?: string,
  extension: AvatarExtension = 'jpg',
) {
  const slug = romanizedName ? toAvatarSlug(romanizedName) : '';
  // 至少要有一個拉丁字母才算拼音。只檢查非空是不夠的：佔位名稱「民進黨候選人 1」
  // 中文被濾光之後會剩下 "1"，就會拼出 -DPP-1.jpg 這種必定 404 的網址。
  if (!/[a-z]/.test(slug)) return null;
  return `/avatars/${avatarFileName(contestId, partyId, slug, extension)}`;
}
