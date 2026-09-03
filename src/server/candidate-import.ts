import { parse } from 'csv-parse/sync';
import { parties } from '../shared/candidates.js';
import { getRegisteredContest } from './contest-registry.js';
import { prisma } from './db.js';
import { refreshCandidates } from './prediction-targets.js';
import { cacheDelete } from './redis.js';
import {
  candidateDataKey,
  battlegroundRankingsKey,
  keysAffectedBy,
  partyCandidatesKey,
  partyCountsKey,
} from './snapshot-keys.js';

const headers = ['code', 'contestId', 'name', 'partyId', 'ballotNo', 'status'] as const;
const statuses = ['REGISTERED', 'CONFIRMED', 'WITHDRAWN', 'DISQUALIFIED'] as const;
const partyIds = new Set<string>(parties.map(({ id }) => id));
const placeholderMarker = '-CANDIDATE-';

export type CandidateImportRow = {
  code: string;
  contestId: string;
  name: string;
  partyId: string;
  ballotNo: number | null;
  status: (typeof statuses)[number];
};

/** 後台匯出的欄位與匯入器完全共用，讓下載後的檔案可直接再上傳。 */
export function serializeCandidateCsv(
  rows: Array<{
    id: string;
    contestId: string;
    name: string;
    partyId: string | null;
    ballotNo: number | null;
    status: CandidateImportRow['status'];
  }>,
) {
  const escape = (value: string | number | null) => {
    const text = value === null ? '' : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const lines = rows.map(({ id, contestId, name, partyId, ballotNo, status }) =>
    [id, contestId, name, partyId ?? 'IND', ballotNo, status].map(escape).join(','),
  );
  return `${headers.join(',')}\n${lines.join('\n')}\n`;
}

export class CandidateImportRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CandidateImportRejected';
  }
}

function reject(row: number, message: string): never {
  throw new CandidateImportRejected(`第 ${row} 列：${message}`);
}

export function parseCandidateCsv(csv: string): CandidateImportRow[] {
  let records: string[][];
  try {
    records = parse(csv, { bom: true, skip_empty_lines: true, trim: true });
  } catch {
    throw new CandidateImportRejected('CSV 格式無法解析。');
  }
  if (records.length < 2) throw new CandidateImportRejected('CSV 沒有候選人資料。');
  if (
    records[0].length !== headers.length ||
    records[0].some((value, index) => value !== headers[index])
  )
    throw new CandidateImportRejected(`第一列必須是：${headers.join(',')}`);

  const seenCodes = new Set<string>();
  const seenNames = new Set<string>();
  const seenBallots = new Set<string>();

  return records.slice(1).map((values, index) => {
    const rowNumber = index + 2;
    if (values.length !== headers.length) reject(rowNumber, `必須有 ${headers.length} 個欄位。`);
    const [code, contestId, name, partyId, ballotValue, statusValue] = values;
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(code) || code.includes(placeholderMarker))
      reject(rowNumber, 'code 只能使用 1–80 個英文字母、數字、底線或連字號。');
    if (seenCodes.has(code)) reject(rowNumber, `code「${code}」重複。`);
    if (!getRegisteredContest(contestId)) reject(rowNumber, `找不到選區「${contestId}」。`);
    if (!name || name.length > 40) reject(rowNumber, 'name 必須是 1–40 個字。');
    if (!partyIds.has(partyId)) reject(rowNumber, `找不到政黨「${partyId}」。`);
    if (!statuses.includes(statusValue as CandidateImportRow['status']))
      reject(rowNumber, `status「${statusValue}」不正確。`);

    const ballotNo = ballotValue === '' ? null : Number(ballotValue);
    if (ballotNo !== null && (!Number.isInteger(ballotNo) || ballotNo < 1))
      reject(rowNumber, 'ballotNo 必須是正整數或留空。');

    const nameKey = `${contestId}\0${name}`;
    const ballotKey = ballotNo === null ? null : `${contestId}\0${ballotNo}`;
    if (seenNames.has(nameKey)) reject(rowNumber, `同一選區的 name「${name}」重複。`);
    if (ballotKey && seenBallots.has(ballotKey))
      reject(rowNumber, `同一選區的 ballotNo「${ballotNo}」重複。`);

    seenCodes.add(code);
    seenNames.add(nameKey);
    if (ballotKey) seenBallots.add(ballotKey);
    return {
      code,
      contestId,
      name,
      partyId,
      ballotNo,
      status: statusValue as CandidateImportRow['status'],
    };
  });
}

async function buildCandidatePlan(rows: CandidateImportRow[]) {
  if (!rows.length)
    return {
      rows,
      contestIds: [] as string[],
      placeholderContestIds: [] as string[],
      existingIds: new Set<string>(),
      updates: [],
      replacements: [],
      summary: {
        candidates: 0,
        contests: 0,
        create: 0,
        update: 0,
        unchanged: 0,
        removePlaceholders: 0,
      },
    };
  const codes = rows.map(({ code }) => code);
  const contestIds = [...new Set(rows.map(({ contestId }) => contestId))];
  const [existingCodes, existingCandidates, placeholders] = await Promise.all([
    prisma.candidate.findMany({
      where: { id: { in: codes } },
      select: {
        id: true,
        contestId: true,
        name: true,
        partyId: true,
        ballotNo: true,
        status: true,
      },
    }),
    prisma.candidate.findMany({
      where: {
        contestId: { in: contestIds },
        NOT: { id: { contains: placeholderMarker } },
      },
      select: {
        id: true,
        contestId: true,
        name: true,
        partyId: true,
        ballotNo: true,
        status: true,
      },
    }),
    prisma.candidate.findMany({
      where: {
        contestId: { in: contestIds },
        id: { contains: placeholderMarker },
      },
      select: { id: true, contestId: true },
    }),
  ]);
  const importedCodes = new Set(codes);
  for (const existing of existingCodes) {
    const incoming = rows.find(({ code }) => code === existing.id);
    if (incoming && incoming.contestId !== existing.contestId)
      throw new CandidateImportRejected(`code「${existing.id}」不能移到其他選區。`);
  }

  const existingById = new Map(existingCodes.map((candidate) => [candidate.id, candidate]));
  const existingByName = new Map(
    existingCandidates.map((candidate) => [`${candidate.contestId}\0${candidate.name}`, candidate]),
  );
  const comparableFields = ['name', 'partyId', 'ballotNo', 'status'] as const;
  const updates = rows.flatMap((row) => {
    const existing =
      existingById.get(row.code) ?? existingByName.get(`${row.contestId}\0${row.name}`);
    if (!existing) return [];
    const changes = [
      ...(existing.id === row.code
        ? []
        : [{ field: 'code', before: existing.id, after: row.code }]),
      ...comparableFields.flatMap((field) =>
        existing[field] === row[field]
          ? []
          : [{ field, before: existing[field], after: row[field] }],
      ),
    ];
    return changes.length
      ? [{ code: row.code, name: row.name, replacesCode: existing.id, changes }]
      : [];
  });
  const replacedCodes = new Set(
    updates.flatMap(({ code, replacesCode }) => (code === replacesCode ? [] : [replacesCode])),
  );

  const finalCandidates = [
    ...existingCandidates.filter(({ id }) => !importedCodes.has(id) && !replacedCodes.has(id)),
    ...rows.map(({ code: id, contestId, name, ballotNo }) => ({
      id,
      contestId,
      name,
      ballotNo,
    })),
  ];
  const names = new Set<string>();
  const ballots = new Set<string>();
  for (const candidate of finalCandidates) {
    const nameKey = `${candidate.contestId}\0${candidate.name}`;
    const ballotKey =
      candidate.ballotNo === null ? null : `${candidate.contestId}\0${candidate.ballotNo}`;
    if (names.has(nameKey))
      throw new CandidateImportRejected(
        `選區「${candidate.contestId}」已有同名候選人「${candidate.name}」。`,
      );
    if (ballotKey && ballots.has(ballotKey))
      throw new CandidateImportRejected(
        `選區「${candidate.contestId}」已有重複號次「${candidate.ballotNo}」。`,
      );
    names.add(nameKey);
    if (ballotKey) ballots.add(ballotKey);
  }

  const existingIds = new Set(existingCodes.map(({ id }) => id));
  return {
    rows,
    contestIds,
    placeholderContestIds: [...new Set(placeholders.map(({ contestId }) => contestId))],
    existingIds,
    updates,
    replacements: updates.flatMap(({ code, replacesCode }) =>
      code === replacesCode ? [] : [{ code, replacesCode }],
    ),
    summary: {
      candidates: rows.length,
      contests: contestIds.length,
      create: rows.filter(
        ({ code }) => !existingIds.has(code) && !updates.some((update) => update.code === code),
      ).length,
      update: updates.length,
      unchanged: rows.filter(
        ({ code }) => existingIds.has(code) && !updates.some((update) => update.code === code),
      ).length,
      removePlaceholders: placeholders.length,
    },
  };
}

export async function prepareCandidateImport(csv: string) {
  return buildCandidatePlan(parseCandidateCsv(csv));
}

export async function importCandidates(csv: string, replaceCodes: string[]) {
  const preview = await prepareCandidateImport(csv);
  const updateCodes = new Set(preview.updates.map(({ code }) => code));
  if (replaceCodes.some((code) => !updateCodes.has(code)))
    throw new CandidateImportRejected('取代確認包含不在預覽清單中的 code。');
  const confirmed = new Set(replaceCodes);
  const plan = await buildCandidatePlan(
    preview.rows.filter(({ code }) => !updateCodes.has(code) || confirmed.has(code)),
  );
  const replacing = new Set(plan.placeholderContestIds);

  await prisma.$transaction(
    async (tx) => {
      for (const { code, replacesCode } of plan.replacements) {
        await tx.predictionPick.updateMany({
          where: { targetType: 'CANDIDATE', targetId: replacesCode },
          data: { targetId: code },
        });
        await tx.contestTally.updateMany({
          where: { targetType: 'CANDIDATE', targetId: replacesCode },
          data: { targetId: code },
        });
        await tx.contestTallySnapshot.updateMany({
          where: { targetType: 'CANDIDATE', targetId: replacesCode },
          data: { targetId: code },
        });
        await tx.contestSummary.updateMany({
          where: { leaderId: replacesCode },
          data: { leaderId: code },
        });
        await tx.candidateContribution.updateMany({
          where: { candidateId: replacesCode },
          data: { candidateId: code },
        });
        await tx.candidate.delete({ where: { id: replacesCode } });
      }

      if (replacing.size) {
        const contestIds = [...replacing];
        await tx.prediction.updateMany({
          where: { contestId: { in: contestIds }, status: 'ACTIVE' },
          data: { status: 'INVALIDATED', invalidReason: 'ADMIN_INVALIDATED' },
        });
        await tx.contestTally.deleteMany({
          where: { contestId: { in: contestIds } },
        });
        await tx.contestSummary.deleteMany({
          where: { contestId: { in: contestIds } },
        });
        await tx.contestTallySnapshot.deleteMany({
          where: { contestId: { in: contestIds } },
        });
        await tx.candidate.deleteMany({
          where: {
            contestId: { in: contestIds },
            id: { contains: placeholderMarker },
          },
        });
      }

      const data = plan.rows.map(({ code: id, ...row }) => ({ id, ...row }));
      const existing = data.filter(({ id }) => plan.existingIds.has(id));
      // 號次互換時先腾空舊值，避免第一筆 update 暂時撞到 unique constraint。
      if (existing.length)
        await tx.candidate.updateMany({
          where: { id: { in: existing.map(({ id }) => id) } },
          data: { ballotNo: null },
        });
      for (const { id, ...candidate } of existing)
        await tx.candidate.update({ where: { id }, data: candidate });
      await tx.candidate.createMany({
        data: data.filter(({ id }) => !plan.existingIds.has(id)),
      });
    },
    { timeout: 300_000 },
  );

  await cacheDelete(
    candidateDataKey,
    battlegroundRankingsKey(),
    partyCountsKey(),
    ...parties.map(({ id }) => partyCandidatesKey(id)),
    ...plan.contestIds.flatMap((contestId) => {
      const contest = getRegisteredContest(contestId);
      return contest ? keysAffectedBy(contest.id, contest.jurisdictionId) : [];
    }),
  );
  await refreshCandidates();
  return plan.summary;
}
