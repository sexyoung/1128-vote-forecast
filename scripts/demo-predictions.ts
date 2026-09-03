import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import registry from '../src/server/data/election-contests.json' with { type: 'json' };

const apiBase = 'http://127.0.0.1:8787';
const batchWindowMs = 1000;
const predictionsPerSecond = 30;
const sessionPoolSize = predictionsPerSecond * 4;
const mayorContestIds = registry.contests
  .filter(({ type }) => type === 'EXECUTIVE')
  .map(({ id }) => id);

type Target = { targetId: string; label: string };
type Contest = { contestId: string; targets: Target[] };

function randomItem<T>(items: T[]) {
  if (!items.length) throw new Error('沒有可用項目。');
  return items[randomInt(items.length)]!;
}

async function request<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `${response.status} ${response.statusText}`);
  return body;
}

async function createSessionCookie() {
  const session = await fetch(`${apiBase}/api/session`);
  if (!session.ok) throw new Error(`${session.status} ${session.statusText}`);
  const cookie = session.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('本機 API 沒有建立匿名身份。');
  return cookie;
}

async function main() {
  const ids = encodeURIComponent(mayorContestIds.join(','));
  const { tallies } = await request<{
    tallies: Record<string, { targets: Target[] }>;
  }>(`${apiBase}/api/contests?ids=${ids}`);
  const contests: Contest[] = Object.entries(tallies).flatMap(([contestId, { targets }]) =>
    targets.length ? [{ contestId, targets }] : [],
  );
  if (!contests.length) throw new Error('目前沒有可預測的縣市長候選人。');

  console.log(`正在建立 ${sessionPoolSize} 個本機匿名 session…`);
  const cookies = await Promise.all(
    Array.from({ length: sessionPoolSize }, () => createSessionCookie()),
  );
  console.log(`開始每秒送出 ${predictionsPerSecond} 筆縣市長預測；按 Ctrl+C 停止。`);

  let count = 0;
  let cookieIndex = 0;
  for (;;) {
    const startedAt = Date.now();
    const labels = await Promise.all(
      Array.from({ length: predictionsPerSecond }, async () => {
        const contest = randomItem(contests);
        const target = randomItem(contest.targets);
        const cookie = cookies[cookieIndex % cookies.length]!;
        cookieIndex += 1;
        await new Promise((resolve) => setTimeout(resolve, randomInt(batchWindowMs)));
        await request(`${apiBase}/api/contests/${contest.contestId}/prediction`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            cookie,
          },
          body: JSON.stringify({ targetIds: [target.targetId] }),
        });
        return `${contest.contestId} → ${target.label}`;
      }),
    );
    count += labels.length;
    console.log(
      `#${count - labels.length + 1}–${count}（${Date.now() - startedAt}ms）：${labels.slice(0, 3).join('、')}…`,
    );
  }
}

if (process.argv.includes('--check')) {
  assert.equal(apiBase, 'http://127.0.0.1:8787');
  assert.equal(batchWindowMs, 1000);
  assert.equal(predictionsPerSecond, 30);
  assert(sessionPoolSize >= predictionsPerSecond * 3);
  assert.equal(mayorContestIds.length, 22);
  assert(mayorContestIds.every((id) => id.endsWith('-EXECUTIVE-1')));
  console.log('demo prediction self-check passed');
} else {
  await main();
}
