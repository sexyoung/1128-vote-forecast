import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { deleteObject, getObjectBytes, headObject, publicUrl, putObject } from './storage.js';

/**
 * 頭像的上傳分兩段：前端先用 presigned URL 把原檔丟到 staging，再叫伺服器
 * commit。commit 一定會重新編碼——把使用者上傳的位元組原樣公開，等於把任意內容
 * 掛在自己的網域下；重編碼順便清掉 EXIF（相機的 GPS 就在裡面）。
 */

const maxUploadBytes = 5 * 1024 * 1024;
const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const avatarSize = 256;

export class AvatarRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AvatarRejected';
  }
}

export function stagingKey(forecasterId: string) {
  return `staging/${forecasterId}/${randomUUID()}`;
}

export function avatarKey(forecasterId: string, version: string) {
  // 檔名帶版本：頭像換了但網址一樣的話，CDN 與瀏覽器會繼續給舊的那張。
  return `avatars/${forecasterId}-${version}.webp`;
}

export function assertUploadableType(contentType: string) {
  if (!allowedTypes.has(contentType)) throw new AvatarRejected('只接受 JPEG、PNG 或 WebP 圖片。');
}

/**
 * 把 staging 的原檔轉成正式頭像。回傳新的 key，呼叫端負責寫進 Forecaster。
 */
export async function commitAvatar(forecasterId: string, key: string) {
  if (!key.startsWith(`staging/${forecasterId}/`))
    throw new AvatarRejected('這個檔案不是你上傳的。');

  const head = await headObject(key);
  if (!head) throw new AvatarRejected('找不到上傳的檔案，請重新上傳。');
  if (head.size > maxUploadBytes) throw new AvatarRejected('圖片超過 5 MB。');

  const original = await getObjectBytes(key);
  if (!original) throw new AvatarRejected('找不到上傳的檔案，請重新上傳。');

  let webp: Buffer;
  try {
    webp = await sharp(original)
      .rotate() // 依 EXIF 轉正，之後 EXIF 會被丟掉
      .resize(avatarSize, avatarSize, { fit: 'cover', position: 'top' })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    throw new AvatarRejected('這個檔案不是能處理的圖片。');
  }

  const finalKey = avatarKey(forecasterId, randomUUID().slice(0, 8));
  await putObject(finalKey, webp, 'image/webp');
  // staging 的原檔沒有用了，留著只是多一份使用者上傳的內容。
  await deleteObject(key);
  return finalKey;
}

export function avatarUrl(key: string | null, blockedAt: Date | null) {
  if (!key || blockedAt) return null;
  return publicUrl(key);
}
