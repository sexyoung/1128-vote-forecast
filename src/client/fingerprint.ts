/**
 * 瀏覽器指紋。它只有一個用途：使用者清掉 cookie 之後把身份認回來。
 *
 * 刻意手寫而不是裝 FingerprintJS——那種函式庫追求「盡可能唯一」，會去讀字型、
 * 音訊、WebGL 這些跟辨識無關的東西，換來的是更難解釋的隱私成本。這裡只取幾個
 * 穩定又低敏感度的訊號；撞號本來就是預期內的事，伺服器對到兩個身份時不會猜。
 */

const signals = () => [
  navigator.userAgent,
  navigator.language,
  navigator.languages?.join(',') ?? '',
  navigator.hardwareConcurrency?.toString() ?? '',
  screen.width.toString(),
  screen.height.toString(),
  screen.colorDepth.toString(),
  new Intl.DateTimeFormat().resolvedOptions().timeZone ?? '',
];

let cached: string | null = null;

/** 區網 HTTP 不是 secure context，Safari／Chrome 不提供 crypto.subtle。 */
export function fallbackFingerprint(value: string) {
  return [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35]
    .map((seed) => {
      let hash = seed;
      for (const character of value) {
        hash ^= character.charCodeAt(0);
        hash = Math.imul(hash, 0x01000193);
      }
      return (hash >>> 0).toString(16).padStart(8, '0');
    })
    .join('');
}

export async function getFingerprint() {
  if (typeof window === 'undefined') throw new Error('getFingerprint() 只能在瀏覽器呼叫。');
  if (cached) return cached;
  const raw = signals().join('|');
  if (!globalThis.crypto?.subtle) {
    cached = fallbackFingerprint(raw);
    return cached;
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  cached = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
  return cached;
}
