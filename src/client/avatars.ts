const candidateCode = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;

/** 正式候選人的圖片固定為 `[候選人 code].webp`；假候選人不送出必定 404 的網址。 */
export function avatarFileName(code: string) {
  return `${code}.webp`;
}

export function avatarUrl(code: string) {
  if (!candidateCode.test(code) || code.includes('-CANDIDATE-')) return null;
  return `/avatars/${avatarFileName(code)}`;
}
