import type { Prisma } from '../generated/prisma/client.js';
import { avatarUrl } from './avatars.js';
import { prisma } from './db.js';

/** 顯示用的短碼。系統配發、改不了，名字重複時靠它分辨。 */
export function forecasterCode(id: string) {
  return `#${id.slice(-4).toUpperCase()}`;
}

export class CommentRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommentRejected';
  }
}

const maxBodyLength = 1000;
const pageSize = 20;

type CommentWithAuthor = Prisma.CommentGetPayload<{ include: { forecaster: true } }>;

function toPublicComment(comment: CommentWithAuthor) {
  return {
    id: comment.id,
    parentId: comment.parentId,
    body: comment.body,
    createdAt: comment.createdAt,
    author: {
      id: comment.forecasterId,
      code: forecasterCode(comment.forecasterId),
      displayName: comment.forecaster.displayName,
      avatarUrl: avatarUrl(comment.forecaster.avatarKey, comment.forecaster.avatarBlockedAt),
    },
  };
}

/**
 * 一頁留言。用 createdAt 當游標而不是 offset：留言會一直進來，offset 分頁翻到
 * 第二頁時第一頁的東西已經往下擠，會重複也會漏。
 */
export async function listComments(contestId: string, before?: Date) {
  const comments = await prisma.comment.findMany({
    where: {
      contestId,
      status: 'VISIBLE',
      ...(before ? { createdAt: { lt: before } } : {}),
    },
    include: { forecaster: true },
    orderBy: { createdAt: 'desc' },
    take: pageSize + 1,
  });

  const page = comments.slice(0, pageSize);
  return {
    comments: page.map(toPublicComment),
    // 多撈一筆只為了知道還有沒有下一頁，不用另外 count。
    nextCursor: comments.length > pageSize ? page[page.length - 1].createdAt.toISOString() : null,
  };
}

export async function createComment(
  forecasterId: string,
  contestId: string,
  body: string,
  parentId: string | null,
) {
  const trimmed = body.trim();
  if (!trimmed) throw new CommentRejected('留言不能是空的。');
  if (trimmed.length > maxBodyLength) throw new CommentRejected('留言最多 1000 個字。');

  if (parentId) {
    const parent = await prisma.comment.findUnique({ where: { id: parentId } });
    // 回覆必須落在同一個選區，否則討論串會跨區被搬走。
    if (!parent || parent.contestId !== contestId)
      throw new CommentRejected('找不到要回覆的留言。');
    // 只允許一層回覆：兩層以上在手機上排版會變成無止盡的縮排。
    if (parent.parentId) throw new CommentRejected('只能回覆最上層的留言。');
  }

  const comment = await prisma.comment.create({
    data: { forecasterId, contestId, body: trimmed, parentId },
    include: { forecaster: true },
  });
  return toPublicComment(comment);
}

/** 自己刪自己的。留紀錄不真的刪除，檢舉處理時還查得到。 */
export async function deleteOwnComment(forecasterId: string, commentId: string) {
  const comment = await prisma.comment.findUnique({ where: { id: commentId } });
  if (!comment || comment.forecasterId !== forecasterId)
    throw new CommentRejected('找不到這則留言。');

  await prisma.comment.update({ where: { id: commentId }, data: { status: 'DELETED' } });
}
