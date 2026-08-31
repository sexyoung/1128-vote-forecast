import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';
import { candidateParties } from '../shared/candidates.js';
import { avatarFileName } from '../client/avatars.js';
import { prisma } from './db.js';
import { createCandidateId } from './candidate-ids.js';
import { getRegisteredContest } from './contest-registry.js';
import { refreshCandidates } from './prediction-targets.js';

const maxPhotoBytes = 10_000_000;
const imageTimeoutMs = 15_000;
const avatarDirectory = resolve(process.cwd(), 'public', 'avatars');

export type CandidateContributionInput = {
  kind: 'NEW_CANDIDATE' | 'PHOTO_UPDATE';
  candidateId?: unknown;
  candidateName?: unknown;
  partyId?: unknown;
  photoUrl?: unknown;
};

export class CandidateContributionRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CandidateContributionRejected';
  }
}

function requiredText(value: unknown, label: string, maxLength: number) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new CandidateContributionRejected(`請填寫${label}。`);
  if (text.length > maxLength)
    throw new CandidateContributionRejected(`${label}最多 ${maxLength} 個字。`);
  return text;
}

function validPhotoUrl(value: unknown) {
  const text = requiredText(value, '照片網址', 2_000);
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new CandidateContributionRejected('照片網址格式不正確。');
  }
  if (url.protocol !== 'https:')
    throw new CandidateContributionRejected('照片網址必須使用 https。');
  return url.toString();
}

function optionalParty(value: unknown) {
  if (value === '' || value === null || value === undefined) return null;
  if (typeof value !== 'string' || !candidateParties.some(({ id }) => id === value))
    throw new CandidateContributionRejected('請選擇有效政黨。');
  return value;
}

/** 建立提案時就寫出 candidateId。新候選人批准後直接沿用，圖片檔名不會變。 */
export async function createCandidateContribution(
  forecasterId: string,
  contestId: string,
  input: CandidateContributionInput,
) {
  if (!getRegisteredContest(contestId)) throw new CandidateContributionRejected('找不到這個選區。');
  if (input.kind !== 'NEW_CANDIDATE' && input.kind !== 'PHOTO_UPDATE')
    throw new CandidateContributionRejected('提案類型不正確。');

  const photoUrl = validPhotoUrl(input.photoUrl);
  if (input.kind === 'NEW_CANDIDATE') {
    const candidateName = requiredText(input.candidateName, '候選人姓名', 40);
    const partyId = optionalParty(input.partyId);
    const existing = await prisma.candidate.findUnique({
      where: { contestId_name: { contestId, name: candidateName } },
      select: { id: true },
    });
    if (existing) throw new CandidateContributionRejected('此選區已有同名候選人，請改用補照片。');

    return prisma.candidateContribution.create({
      data: {
        kind: input.kind,
        contestId,
        candidateId: createCandidateId(partyId, contestId),
        candidateName,
        partyId,
        photoUrl,
        forecasterId,
      },
    });
  }

  const candidateId = requiredText(input.candidateId, '候選人', 80);
  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: { id: true, contestId: true },
  });
  if (!candidate || candidate.contestId !== contestId)
    throw new CandidateContributionRejected('這位候選人不在此選區。');

  return prisma.candidateContribution.create({
    data: { kind: input.kind, contestId, candidateId, photoUrl, forecasterId },
  });
}

async function downloadAsWebp(photoUrl: string) {
  const signal = AbortSignal.timeout(imageTimeoutMs);
  let response: Response;
  try {
    response = await fetch(photoUrl, { redirect: 'follow', signal });
  } catch {
    throw new CandidateContributionRejected('無法下載照片網址。');
  }
  if (!response.ok) throw new CandidateContributionRejected(`照片下載失敗（${response.status}）。`);
  if (new URL(response.url).protocol !== 'https:')
    throw new CandidateContributionRejected('重新導向後的照片網址必須使用 https。');
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (contentLength > maxPhotoBytes)
    throw new CandidateContributionRejected('照片檔案不可超過 10 MB。');

  const source = Buffer.from(await response.arrayBuffer());
  if (source.byteLength === 0 || source.byteLength > maxPhotoBytes)
    throw new CandidateContributionRejected('照片檔案不可超過 10 MB。');
  try {
    return await sharp(source, { limitInputPixels: 30_000_000, failOn: 'error' })
      .rotate()
      .resize(512, 512, { fit: 'cover', position: 'attention' })
      .webp({ quality: 82, effort: 4 })
      .toBuffer();
  } catch {
    throw new CandidateContributionRejected('照片無法轉換為 WebP。');
  }
}

/**
 * 圖片檔是 Git 工作樹的一部分，不放進 PostgreSQL。批准時先把圖片轉完寫進暫存檔，
 * 再更新資料庫，最後原子替換 `{candidateId}.webp`，讓管理者能直接 git add／commit。
 */
export async function approveCandidateContribution(contributionId: string, reviewedBy = 'admin') {
  const contribution = await prisma.candidateContribution.findUnique({
    where: { id: contributionId },
  });
  if (!contribution) throw new CandidateContributionRejected('找不到這筆提案。');
  if (contribution.status !== 'PENDING')
    throw new CandidateContributionRejected('這筆提案已處理。');

  const webp = await downloadAsWebp(contribution.photoUrl);
  const filePath = resolve(avatarDirectory, avatarFileName(contribution.candidateId));
  // candidateId 來自 cuid 或既有 Candidate id；仍確認最終路徑在 avatars 目錄內。
  if (dirname(filePath) !== avatarDirectory)
    throw new CandidateContributionRejected('候選人圖片檔名不正確。');
  await mkdir(avatarDirectory, { recursive: true });
  const tempPath = `${filePath}.${contribution.id}.tmp`;
  await writeFile(tempPath, webp);

  try {
    await prisma.$transaction(async (tx) => {
      const current = await tx.candidateContribution.findUnique({ where: { id: contribution.id } });
      if (!current || current.status !== 'PENDING')
        throw new CandidateContributionRejected('這筆提案已處理。');

      if (current.kind === 'NEW_CANDIDATE') {
        if (!current.candidateName) throw new CandidateContributionRejected('候選人姓名遺失。');
        const duplicate = await tx.candidate.findUnique({
          where: { contestId_name: { contestId: current.contestId, name: current.candidateName } },
          select: { id: true },
        });
        if (duplicate) throw new CandidateContributionRejected('此選區已有同名候選人。');
        await tx.candidate.create({
          data: {
            id: current.candidateId,
            contestId: current.contestId,
            name: current.candidateName,
            partyId: current.partyId,
            status: 'REGISTERED',
          },
        });
      } else {
        const candidate = await tx.candidate.findUnique({
          where: { id: current.candidateId },
          select: { contestId: true },
        });
        if (!candidate || candidate.contestId !== current.contestId)
          throw new CandidateContributionRejected('原候選人已不存在或不在此選區。');
      }

      await tx.candidateContribution.update({
        where: { id: current.id },
        data: { status: 'APPROVED', reviewedAt: new Date(), reviewedBy },
      });
    });
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }

  await refreshCandidates(true);
  return {
    contributionId: contribution.id,
    candidateId: contribution.candidateId,
    photoFile: avatarFileName(contribution.candidateId),
  };
}

export async function rejectCandidateContribution(contributionId: string, reviewedBy = 'admin') {
  const changed = await prisma.candidateContribution.updateMany({
    where: { id: contributionId, status: 'PENDING' },
    data: { status: 'REJECTED', reviewedAt: new Date(), reviewedBy },
  });
  if (changed.count === 0) throw new CandidateContributionRejected('找不到待處理的提案。');
}
