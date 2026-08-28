import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from './env.js';

/**
 * 使用者上傳的檔案不進 PostgreSQL，走物件儲存。開發用 compose 裡的 MinIO，
 * 正式環境換成 R2 或 S3——除了 endpoint 之外沒有差別。
 */

export const storageEnabled = Boolean(env.s3Bucket && env.s3AccessKeyId);

let client: S3Client | null = null;

function getClient() {
  if (!storageEnabled) return null;
  client ??= new S3Client({
    credentials: { accessKeyId: env.s3AccessKeyId, secretAccessKey: env.s3SecretAccessKey },
    endpoint: env.s3Endpoint || undefined,
    // MinIO 沒有 bucket 的 DNS 名稱，路徑式定址是唯一走得通的。
    forcePathStyle: Boolean(env.s3Endpoint),
    region: env.s3Region,
  });
  return client;
}

let bucketReady = false;

/** 開發環境第一次用到時把 bucket 開起來，省得每個人手動進 MinIO 建一次。 */
export async function ensureBucket() {
  const s3 = getClient();
  if (!s3 || bucketReady) return;
  try {
    await s3.send(new HeadBucketCommand({ Bucket: env.s3Bucket }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: env.s3Bucket })).catch(() => {});
  }
  bucketReady = true;
}

export async function createUploadUrl(key: string, contentType: string, expiresIn = 300) {
  const s3 = getClient();
  if (!s3) throw new Error('沒有設定物件儲存。');
  await ensureBucket();
  return getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: env.s3Bucket, Key: key, ContentType: contentType }),
    { expiresIn },
  );
}

export async function headObject(key: string) {
  const s3 = getClient();
  if (!s3) return null;
  try {
    const result = await s3.send(new HeadObjectCommand({ Bucket: env.s3Bucket, Key: key }));
    return { size: result.ContentLength ?? 0, contentType: result.ContentType ?? '' };
  } catch {
    return null;
  }
}

export async function getObjectBytes(key: string) {
  const s3 = getClient();
  if (!s3) return null;
  const result = await s3.send(new GetObjectCommand({ Bucket: env.s3Bucket, Key: key }));
  const bytes = await result.Body?.transformToByteArray();
  return bytes ? Buffer.from(bytes) : null;
}

export async function putObject(key: string, body: Buffer, contentType: string) {
  const s3 = getClient();
  if (!s3) throw new Error('沒有設定物件儲存。');
  await ensureBucket();
  await s3.send(
    new PutObjectCommand({ Bucket: env.s3Bucket, Key: key, Body: body, ContentType: contentType }),
  );
}

export async function deleteObject(key: string) {
  const s3 = getClient();
  if (!s3) return;
  await s3.send(new DeleteObjectCommand({ Bucket: env.s3Bucket, Key: key })).catch(() => {});
}

/** 前端拿得到的網址。CDN 有設就走 CDN，否則直接指向 bucket。 */
export function publicUrl(key: string) {
  const base = env.s3PublicBaseUrl || `${env.s3Endpoint}/${env.s3Bucket}`;
  return `${base.replace(/\/$/, '')}/${key}`;
}
