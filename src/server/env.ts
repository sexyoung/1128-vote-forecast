import 'dotenv/config';

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`缺少 ${name}，請先由 .env.example 建立 .env。`);
  return value;
}

function optional(name: string, fallback: string) {
  return process.env[name] || fallback;
}

export const env = {
  isProduction: process.env.NODE_ENV === 'production',
  port: Number(optional('PORT', '8787')),
  databaseUrl: required('DATABASE_URL'),
  redisUrl: optional('REDIS_URL', ''),

  /**
   * 指紋與 IP 的 HMAC pepper。換掉等於所有辨識線索重來，使用者會被當成新人，
   * 已送出的預測不會消失但也認不回來，所以正式環境要當成長期密鑰保管。
   */
  forecasterPepper: required('FORECASTER_PEPPER'),

  turnstileSiteKey: optional('TURNSTILE_SITE_KEY', ''),
  turnstileSecretKey: optional('TURNSTILE_SECRET_KEY', ''),

  adminToken: optional('ADMIN_TOKEN', ''),

  s3Endpoint: optional('S3_ENDPOINT', ''),
  s3Region: optional('S3_REGION', 'us-east-1'),
  s3Bucket: optional('S3_BUCKET', ''),
  s3AccessKeyId: optional('S3_ACCESS_KEY_ID', ''),
  s3SecretAccessKey: optional('S3_SECRET_ACCESS_KEY', ''),
  s3PublicBaseUrl: optional('S3_PUBLIC_BASE_URL', ''),
};

/**
 * Turnstile 沒設定就整個關掉，而不是擋住所有寫入。開發環境不必為了送一筆預測
 * 先去申請金鑰；正式環境沒設定會在啟動檢查時被擋下來。
 */
export const turnstileEnabled = Boolean(env.turnstileSecretKey);

/** 正式環境不能少的設定，啟動時就檢查，不要等到第一個請求才炸。 */
export function assertProductionEnv() {
  if (!env.isProduction) return;
  const missing: string[] = [];
  if (!env.redisUrl) missing.push('REDIS_URL');
  if (!env.turnstileSecretKey) missing.push('TURNSTILE_SECRET_KEY');
  if (!env.adminToken) missing.push('ADMIN_TOKEN');
  if (!env.s3Bucket) missing.push('S3_BUCKET');
  if (env.forecasterPepper === 'change-me') missing.push('FORECASTER_PEPPER（還是預設值）');
  if (missing.length > 0) throw new Error(`正式環境缺少設定：${missing.join('、')}`);
}
