import { createHash } from 'node:crypto';
import { access, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Prisma } from '../src/generated/prisma/client.js';
import { parties } from '../src/shared/candidates.js';
import { candidateIdPrefix, isCanonicalCandidateId } from '../src/server/candidate-ids.js';
import { getRegisteredContest } from '../src/server/contest-registry.js';
import { prisma } from '../src/server/db.js';
import { cacheDelete, disconnectRedis } from '../src/server/redis.js';
import {
  candidateDataKey,
  candidateRankingsKey,
  keysAffectedBy,
  partyCandidatesKey,
  partyCountsKey,
} from '../src/server/snapshot-keys.js';

type Entry = { from: string; to: string };
type Mapping = { entries: Entry[] };

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mappingPath = join(root, 'src/server/data/candidate-id-migration.json');
const avatarDirectory = join(root, 'public/avatars');
const mode = process.argv[2];

function migratedId(id: string, partyId: string | null, contestId: string) {
  const suffix = createHash('sha256').update(id).digest('hex').slice(0, 8).toUpperCase();
  return `${candidateIdPrefix(partyId, contestId)}${suffix}`;
}

async function buildMapping(): Promise<Mapping> {
  const candidates = await prisma.candidate.findMany({
    where: { NOT: { id: { contains: '-CANDIDATE-' } } },
    select: { id: true, contestId: true, partyId: true },
    orderBy: { id: 'asc' },
  });
  const entries = candidates
    .filter(({ id, contestId, partyId }) => !isCanonicalCandidateId(id, partyId, contestId))
    .map(({ id, contestId, partyId }) => ({
      from: id,
      to: migratedId(id, partyId, contestId),
    }));
  const ids = new Set(candidates.map(({ id }) => id));
  const destinations = new Set<string>();
  for (const { from, to } of entries) {
    if (ids.has(to) || destinations.has(to)) throw new Error(`候選人 ID 衝突：${from} → ${to}`);
    destinations.add(to);
  }
  return { entries };
}

function remapRevisionPicks(value: Prisma.JsonValue, ids: Map<string, string>) {
  if (!Array.isArray(value)) return { changed: false, value };
  let changed = false;
  const next = value.map((pick) => {
    if (!pick || Array.isArray(pick) || typeof pick !== 'object') return pick;
    const targetId = typeof pick.targetId === 'string' ? ids.get(pick.targetId) : null;
    if (!targetId || pick.targetType !== 'CANDIDATE') return pick;
    changed = true;
    return { ...pick, targetId };
  });
  return { changed, value: next };
}

async function migrateDatabase(entries: Entry[]) {
  return prisma.$transaction(
    async (tx) => {
      const existing = new Set(
        (
          await tx.candidate.findMany({
            where: { id: { in: entries.flatMap(({ from, to }) => [from, to]) } },
            select: { id: true },
          })
        ).map(({ id }) => id),
      );
      const active = entries.filter(({ from, to }) => existing.has(from) && !existing.has(to));
      for (const { from, to } of entries)
        if (!existing.has(from) && !existing.has(to)) throw new Error(`找不到候選人：${from}`);
        else if (existing.has(from) && existing.has(to))
          throw new Error(`新舊 ID 同時存在：${from}`);

      const activeIds = new Map(active.map(({ from, to }) => [from, to]));
      const revisions = await tx.predictionRevision.findMany({ select: { id: true, picks: true } });
      for (const revision of revisions) {
        const picks = remapRevisionPicks(revision.picks, activeIds);
        if (picks.changed)
          await tx.predictionRevision.update({
            where: { id: revision.id },
            data: { picks: picks.value as Prisma.InputJsonValue },
          });
      }

      for (const { from, to } of active) {
        await tx.predictionPick.updateMany({
          where: { targetType: 'CANDIDATE', targetId: from },
          data: { targetId: to },
        });
        await tx.contestTally.updateMany({
          where: { targetType: 'CANDIDATE', targetId: from },
          data: { targetId: to },
        });
        await tx.contestTallySnapshot.updateMany({
          where: { targetType: 'CANDIDATE', targetId: from },
          data: { targetId: to },
        });
        await tx.contestSummary.updateMany({
          where: { leaderType: 'CANDIDATE', leaderId: from },
          data: { leaderId: to },
        });
        await tx.candidateContribution.updateMany({
          where: { candidateId: from },
          data: { candidateId: to },
        });
        await tx.candidate.update({ where: { id: from }, data: { id: to } });
      }
      return active.length;
    },
    { timeout: 300_000 },
  );
}

async function exists(path: string) {
  return access(path).then(
    () => true,
    () => false,
  );
}

async function csvFiles(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) => {
        const child = join(path, entry.name);
        return entry.isDirectory()
          ? csvFiles(child)
          : Promise.resolve(child.endsWith('.csv') ? [child] : []);
      }),
    )
  ).flat();
}

async function migrateFiles(entries: Entry[]) {
  let avatars = 0;
  for (const { from, to } of entries) {
    const source = join(avatarDirectory, `${from}.webp`);
    const destination = join(avatarDirectory, `${to}.webp`);
    if (await exists(source)) {
      if (await exists(destination)) throw new Error(`新舊圖片同時存在：${from}`);
      await rename(source, destination);
      avatars++;
    }
  }

  let csvs = 0;
  const replacements = [...entries].sort((a, b) => b.from.length - a.from.length);
  for (const path of await csvFiles(join(root, 'docs')).then(async (files) => [
    ...files,
    ...(await csvFiles(avatarDirectory)),
  ])) {
    const original = await readFile(path, 'utf8');
    const migrated = replacements.reduce(
      (text, { from, to }) => text.replaceAll(from, to),
      original,
    );
    if (migrated !== original) {
      await writeFile(path, migrated);
      csvs++;
    }
  }
  return { avatars, csvs };
}

async function invalidate(entries: Entry[]) {
  const contests = new Set(
    (
      await prisma.candidate.findMany({
        where: { id: { in: entries.map(({ to }) => to) } },
        select: { contestId: true },
      })
    ).map(({ contestId }) => contestId),
  );
  await cacheDelete(
    candidateDataKey,
    candidateRankingsKey(),
    partyCountsKey(),
    ...parties.map(({ id }) => partyCandidatesKey(id)),
    ...[...contests].flatMap((contestId) => {
      const contest = getRegisteredContest(contestId);
      return contest ? keysAffectedBy(contest.id, contest.jurisdictionId) : [];
    }),
  );
}

try {
  const stored = JSON.parse(await readFile(mappingPath, 'utf8')) as Mapping;
  const pending = await buildMapping();
  const known = new Set(stored.entries.flatMap(({ from, to }) => [from, to]));
  const mapping = {
    entries: [
      ...stored.entries,
      ...pending.entries.filter(({ from, to }) => !known.has(from) && !known.has(to)),
    ],
  };
  if (mode !== '--apply' && mode !== '--rollback') {
    console.log(`預覽：${pending.entries.length} 位真實候選人需要改 ID；加 --apply 套用。`);
  } else {
    const entries =
      mode === '--rollback'
        ? mapping.entries.map(({ from, to }) => ({ from: to, to: from }))
        : mapping.entries;
    if (mode === '--apply' && mapping.entries.length !== stored.entries.length)
      await writeFile(mappingPath, `${JSON.stringify(mapping)}\n`);
    const database = await migrateDatabase(entries);
    const files = await migrateFiles(entries);
    await invalidate(entries);
    console.log(
      `${mode === '--apply' ? '完成' : '回滾完成'}：資料庫 ${database} 位、圖片 ${files.avatars} 張、CSV ${files.csvs} 份。`,
    );
  }
} finally {
  await prisma.$disconnect();
  await disconnectRedis();
}
