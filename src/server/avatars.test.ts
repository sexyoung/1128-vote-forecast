import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vite-plus/test';
import { app } from './app.js';
import { commitAvatar } from './avatars.js';
import { prisma } from './db.js';
import { forecasterCookieName } from './identity.js';
import { disconnectRedis } from './redis.js';
import { getObjectBytes, putObject, storageEnabled } from './storage.js';

const forecasters: string[] = [];

afterAll(async () => {
  if (forecasters.length > 0) {
    await prisma.forecaster.deleteMany({ where: { id: { in: forecasters } } });
  }
  await prisma.$disconnect();
  await disconnectRedis();
});

/** 每個訪客一個不重複的來源 IP：同一個 IP 每小時只能開 30 個身份，測試檔跑在
    一起時很容易撞到那個上限。 */
function randomIp() {
  const octet = () => Math.floor(Math.random() * 254) + 1;
  return `10.${octet()}.${octet()}.${octet()}`;
}

async function newVisitor() {
  const response = await app.request('/api/session', {
    headers: { 'x-forwarded-for': randomIp() },
  });
  const body = (await response.json()) as { forecaster: { id: string } };
  forecasters.push(body.forecaster.id);
  const cookie = /vf_fid=([^;]+)/.exec(response.headers.get('set-cookie') ?? '')?.[1] ?? '';
  return {
    id: body.forecaster.id,
    headers: { 'Content-Type': 'application/json', cookie: `${forecasterCookieName}=${cookie}` },
  };
}

/** 一張長寬不同、帶 EXIF 的 JPEG，用來確認輸出真的被裁成正方的 webp。 */
async function sampleJpeg() {
  return sharp({
    create: { width: 600, height: 400, channels: 3, background: { r: 200, g: 40, b: 40 } },
  })
    .withExif({ IFD0: { Copyright: 'test' } })
    .jpeg()
    .toBuffer();
}

describe('display name', () => {
  it('saves a name and clears it again', async () => {
    const visitor = await newVisitor();

    const saved = await app.request('/api/me', {
      method: 'PUT',
      headers: visitor.headers,
      body: JSON.stringify({ displayName: '  選情觀察  ' }),
    });
    expect(await saved.json()).toEqual({ displayName: '選情觀察' });

    const cleared = await app.request('/api/me', {
      method: 'PUT',
      headers: visitor.headers,
      body: JSON.stringify({ displayName: '' }),
    });
    expect(await cleared.json()).toEqual({ displayName: null });
  });

  it('rejects a name longer than the column', async () => {
    const visitor = await newVisitor();
    const response = await app.request('/api/me', {
      method: 'PUT',
      headers: visitor.headers,
      body: JSON.stringify({ displayName: '一'.repeat(25) }),
    });
    expect(response.status).toBe(400);
  });
});

describe('avatar upload', () => {
  it('refuses a file type we would have to serve blindly', async () => {
    const visitor = await newVisitor();
    const response = await app.request('/api/me/avatar/upload-url', {
      method: 'POST',
      headers: visitor.headers,
      body: JSON.stringify({ contentType: 'image/svg+xml' }),
    });

    expect(response.status).toBe(400);
  });

  it('hands out an upload url for a real image type', async () => {
    const visitor = await newVisitor();
    const response = await app.request('/api/me/avatar/upload-url', {
      method: 'POST',
      headers: visitor.headers,
      body: JSON.stringify({ contentType: 'image/jpeg' }),
    });
    const body = (await response.json()) as { key: string; uploadUrl: string };

    expect(response.status).toBe(200);
    expect(body.key).toContain(`staging/${visitor.id}/`);
    expect(body.uploadUrl).toContain('X-Amz-Signature');
  });

  it('refuses to commit someone else’s staged file', async () => {
    const visitor = await newVisitor();
    await expect(commitAvatar(visitor.id, 'staging/someone-else/1')).rejects.toThrow(
      '不是你上傳的',
    );
  });

  it('re-encodes the upload into a square webp without EXIF', async () => {
    const visitor = await newVisitor();
    const key = `staging/${visitor.id}/${crypto.randomUUID()}`;
    await putObject(key, await sampleJpeg(), 'image/jpeg');

    const response = await app.request('/api/me/avatar/commit', {
      method: 'POST',
      headers: visitor.headers,
      body: JSON.stringify({ key }),
    });
    const body = (await response.json()) as { avatarUrl: string };
    expect(response.status).toBe(200);

    const stored = await prisma.forecaster.findUnique({ where: { id: visitor.id } });
    const bytes = await getObjectBytes(stored?.avatarKey ?? '');
    const meta = await sharp(bytes as Buffer).metadata();

    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(256);
    expect(meta.height).toBe(256);
    // 相機的 GPS 就藏在 EXIF 裡，重新編碼把它丟掉。
    expect(meta.exif).toBeUndefined();
    expect(body.avatarUrl).toContain(stored?.avatarKey ?? '');

    // 原檔沒有用了，不該留在 bucket 裡。
    expect(await getObjectBytes(key).catch(() => null)).toBeNull();
  });

  it('rejects a file that is not an image at all', async () => {
    const visitor = await newVisitor();
    const key = `staging/${visitor.id}/${crypto.randomUUID()}`;
    await putObject(key, Buffer.from('<script>alert(1)</script>'), 'image/png');

    const response = await app.request('/api/me/avatar/commit', {
      method: 'POST',
      headers: visitor.headers,
      body: JSON.stringify({ key }),
    });

    expect(response.status).toBe(400);
  });

  it('removes the avatar on request', async () => {
    const visitor = await newVisitor();
    const key = `staging/${visitor.id}/${crypto.randomUUID()}`;
    await putObject(key, await sampleJpeg(), 'image/jpeg');
    await app.request('/api/me/avatar/commit', {
      method: 'POST',
      headers: visitor.headers,
      body: JSON.stringify({ key }),
    });

    const response = await app.request('/api/me/avatar', {
      method: 'DELETE',
      headers: visitor.headers,
    });
    expect(await response.json()).toEqual({ avatarUrl: null });

    const stored = await prisma.forecaster.findUnique({ where: { id: visitor.id } });
    expect(stored?.avatarKey).toBeNull();
  });
});

// 沒設定物件儲存時上傳整組關掉，而不是丟 500。
describe('storage configuration', () => {
  it('is on in development, so the tests above mean something', () => {
    expect(storageEnabled).toBe(true);
  });
});
