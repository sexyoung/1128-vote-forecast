import { afterAll, beforeEach, describe, expect, it } from 'vite-plus/test';
import { app } from './app.js';
import { databaseSchema, prisma } from './db.js';
import { getPublicAnnouncement, saveAnnouncement } from './announcement.js';
import { disconnectRedis } from './redis.js';

// 公告永遠只有一列固定 id 的資料，測試前後都要清乾淨，不然會跟其他測試檔
// （或下一次跑測試）搶同一列。
async function reset() {
  await prisma.announcement.deleteMany({});
}

beforeEach(reset);

afterAll(async () => {
  if (databaseSchema !== 'vote_forecast_test') throw new Error('拒絕清除非測試資料庫。');
  await reset();
  await prisma.$disconnect();
  await disconnectRedis();
});

describe('saveAnnouncement 版號規則', () => {
  it('第一次建立算一次版本', async () => {
    const { row, versionBumped } = await saveAnnouncement({
      title: '公告標題',
      body: '公告內容',
      linkUrl: null,
      linkLabel: null,
      published: false,
    });
    expect(versionBumped).toBe(true);
    expect(row.version).toBe(1);
  });

  it('標題或內容改變會 +1', async () => {
    await saveAnnouncement({
      title: '原標題',
      body: '原內容',
      linkUrl: null,
      linkLabel: null,
      published: true,
    });

    const changedTitle = await saveAnnouncement({
      title: '新標題',
      body: '原內容',
      linkUrl: null,
      linkLabel: null,
      published: true,
    });
    expect(changedTitle.versionBumped).toBe(true);
    expect(changedTitle.row.version).toBe(2);

    const changedBody = await saveAnnouncement({
      title: '新標題',
      body: '新內容',
      linkUrl: null,
      linkLabel: null,
      published: true,
    });
    expect(changedBody.versionBumped).toBe(true);
    expect(changedBody.row.version).toBe(3);
  });

  it('連結網址或文字改變也算內容改變', async () => {
    await saveAnnouncement({
      title: '標題',
      body: '內容',
      linkUrl: 'https://example.com/a',
      linkLabel: '看看',
      published: true,
    });

    const changed = await saveAnnouncement({
      title: '標題',
      body: '內容',
      linkUrl: 'https://example.com/b',
      linkLabel: '看看',
      published: true,
    });
    expect(changed.versionBumped).toBe(true);
    expect(changed.row.version).toBe(2);
  });

  it('內容完全相同的重存不會 +1', async () => {
    const first = await saveAnnouncement({
      title: '一樣的標題',
      body: '一樣的內容',
      linkUrl: null,
      linkLabel: null,
      published: true,
    });
    expect(first.row.version).toBe(1);

    const same = await saveAnnouncement({
      title: '一樣的標題',
      body: '一樣的內容',
      linkUrl: null,
      linkLabel: null,
      published: true,
    });
    expect(same.versionBumped).toBe(false);
    expect(same.row.version).toBe(1);
  });

  it('只切換 published 不會 +1', async () => {
    const first = await saveAnnouncement({
      title: '標題',
      body: '內容',
      linkUrl: null,
      linkLabel: null,
      published: false,
    });
    expect(first.row.version).toBe(1);

    const toggled = await saveAnnouncement({
      title: '標題',
      body: '內容',
      linkUrl: null,
      linkLabel: null,
      published: true,
    });
    expect(toggled.versionBumped).toBe(false);
    expect(toggled.row.version).toBe(1);
    expect(toggled.row.published).toBe(true);
  });
});

describe('GET /api/announcement', () => {
  it('沒有公告時回 null', async () => {
    const response = await app.request('/api/announcement');
    const body = (await response.json()) as { announcement: unknown };
    expect(response.status).toBe(200);
    expect(body.announcement).toBeNull();
  });

  it('未發布的草稿不會外流', async () => {
    await saveAnnouncement({
      title: '還沒公開的公告',
      body: '草稿內容',
      linkUrl: null,
      linkLabel: null,
      published: false,
    });

    const response = await app.request('/api/announcement');
    const body = (await response.json()) as { announcement: unknown };
    expect(body.announcement).toBeNull();
    // 直接查 getPublicAnnouncement 確認同一個結論，不只是靠 API 這一層。
    expect(await getPublicAnnouncement()).toBeNull();
  });

  it('發布後回傳前台需要的欄位，不含 published／id', async () => {
    await saveAnnouncement({
      title: '公開公告',
      body: '大家都看得到',
      linkUrl: 'https://example.com',
      linkLabel: '前往',
      published: true,
    });

    const response = await app.request('/api/announcement');
    const body = (await response.json()) as {
      announcement: { version: number; title: string; body: string } | null;
    };
    expect(body.announcement).toEqual({
      version: 1,
      title: '公開公告',
      body: '大家都看得到',
      linkUrl: 'https://example.com',
      linkLabel: '前往',
    });
  });
});
