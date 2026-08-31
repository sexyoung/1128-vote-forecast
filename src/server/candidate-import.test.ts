import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';
import { getMockCandidates } from '../shared/candidates.js';
import {
  CandidateImportRejected,
  importCandidates,
  parseCandidateCsv,
  prepareCandidateImport,
} from './candidate-import.js';
import { databaseSchema, prisma } from './db.js';
import { refreshCandidates } from './prediction-targets.js';
import { disconnectRedis } from './redis.js';

const contestId = 'PEN-EXECUTIVE-1';
const code = 'TEST-PEN-MAYOR-001';
const header = 'code,contestId,name,partyId,ballotNo,status';

async function restorePlaceholders() {
  await prisma.candidate.deleteMany({ where: { contestId } });
  await prisma.candidate.createMany({
    data: getMockCandidates({ id: contestId, seatCount: 1 }).map((candidate) => ({
      id: candidate.id,
      contestId,
      partyId: candidate.partyId,
      name: candidate.name,
      ballotNo: candidate.number,
    })),
  });
  await refreshCandidates(true);
}

beforeAll(async () => {
  if (databaseSchema !== 'vote_forecast_test') throw new Error('拒絕寫入非測試資料庫。');
  await restorePlaceholders();
});

afterAll(async () => {
  await restorePlaceholders();
  await prisma.$disconnect();
  await disconnectRedis();
});

describe('candidate CSV import', () => {
  it('parses quoted CSV fields and rejects duplicate codes', () => {
    expect(
      parseCandidateCsv(`${header}\n${code},${contestId},"王小,明",DPP,1,CONFIRMED`)[0].name,
    ).toBe('王小,明');
    expect(() =>
      parseCandidateCsv(
        `${header}\n${code},${contestId},王小明,DPP,1,CONFIRMED\n${code},${contestId},陳小華,KMT,2,CONFIRMED`,
      ),
    ).toThrow(CandidateImportRejected);
  });

  it('creates new codes but replaces existing codes only after confirmation', async () => {
    const original = `${header}\n${code},${contestId},王小明,DPP,1,CONFIRMED`;
    const preview = await prepareCandidateImport(original);
    expect(preview.summary).toMatchObject({ create: 1, update: 0 });
    expect(preview.summary.removePlaceholders).toBeGreaterThan(0);

    await importCandidates(original, []);
    expect(await prisma.candidate.findUnique({ where: { id: code } })).toMatchObject({
      name: '王小明',
      partyId: 'DPP',
    });

    const changed = `${header}\n${code},${contestId},王小華,KMT,2,CONFIRMED`;
    const changedPreview = await prepareCandidateImport(changed);
    expect(changedPreview.updates[0].changes.map(({ field }) => field)).toEqual([
      'name',
      'partyId',
      'ballotNo',
    ]);

    await importCandidates(changed, []);
    expect(await prisma.candidate.findUnique({ where: { id: code } })).toMatchObject({
      name: '王小明',
      partyId: 'DPP',
    });

    await importCandidates(changed, [code]);
    expect(await prisma.candidate.findUnique({ where: { id: code } })).toMatchObject({
      name: '王小華',
      partyId: 'KMT',
      ballotNo: 2,
    });

    const secondCode = 'TEST-PEN-MAYOR-002';
    await importCandidates(
      `${header}\n${code},${contestId},王小華,KMT,2,CONFIRMED\n${secondCode},${contestId},陳小明,DPP,1,CONFIRMED`,
      [],
    );
    const swapped = `${header}\n${code},${contestId},王小華,KMT,1,CONFIRMED\n${secondCode},${contestId},陳小明,DPP,2,CONFIRMED`;
    await importCandidates(swapped, [code, secondCode]);
    expect(
      await prisma.candidate.findMany({
        where: { id: { in: [code, secondCode] } },
        orderBy: { id: 'asc' },
        select: { ballotNo: true },
      }),
    ).toEqual([{ ballotNo: 1 }, { ballotNo: 2 }]);

    const replacementCode = 'TEST-PEN-MAYOR-003';
    const sameName = `${header}\n${replacementCode},${contestId},王小華,KMT,1,CONFIRMED`;
    const sameNamePreview = await prepareCandidateImport(sameName);
    expect(sameNamePreview.updates[0].changes[0]).toEqual({
      field: 'code',
      before: code,
      after: replacementCode,
    });

    await importCandidates(sameName, []);
    expect(await prisma.candidate.findUnique({ where: { id: code } })).not.toBeNull();

    await importCandidates(sameName, [replacementCode]);
    expect(await prisma.candidate.findUnique({ where: { id: code } })).toBeNull();
    expect(await prisma.candidate.findUnique({ where: { id: replacementCode } })).toMatchObject({
      name: '王小華',
      partyId: 'KMT',
    });
  });
});
