import { prisma } from './db.js';

/**
 * 全站公告固定只有一列，用常數 id upsert，不必另外查「有沒有這一列」再決定
 * create 還是 update。
 */
const announcementId = 'singleton';

export class AnnouncementRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnnouncementRejected';
  }
}

export type AnnouncementInput = {
  title: string;
  body: string;
  linkUrl: string | null;
  linkLabel: string | null;
  published: boolean;
};

export type PublicAnnouncement = {
  version: number;
  title: string;
  body: string;
  linkUrl: string | null;
  linkLabel: string | null;
};

/**
 * 每一支 HTML 路由都會經過 src/server/html.ts 的 send()，而 send() 會呼叫這支，
 * 所以它實際上是「每渲染一個頁面就往資料庫跑一趟」——為了一列幾乎不會變的資料。
 * 這個站的其他熱路徑（快照、統計）全都擋在快取後面就是為了避免這件事。
 *
 * 在行程內記十秒。Vercel 上每個 instance 各記各的，最壞情況是站長改完公告後有
 * 十秒看到舊的；而公開頁面在 CDN 本來就還有 60 秒的 s-maxage，這十秒相對不算什麼。
 * 站長自己那台會在 saveAnnouncement() 裡被清掉，後台預覽不受影響。
 */
const publicCacheTtlMs = 10_000;
let publicCache: { value: PublicAnnouncement | null; at: number } | null = null;

/** 寫入之後手動清掉。測試直接塞資料列時也用得上。 */
export function resetAnnouncementCache() {
  publicCache = null;
}

/** 首頁與其他公開頁面看到的樣子：沒有列、或還沒發布，一律當作沒有公告。 */
export async function getPublicAnnouncement(): Promise<PublicAnnouncement | null> {
  if (publicCache && Date.now() - publicCache.at < publicCacheTtlMs) return publicCache.value;

  const row = await prisma.announcement.findUnique({ where: { id: announcementId } });
  const value =
    !row || !row.published
      ? null
      : {
          version: row.version,
          title: row.title,
          body: row.body,
          linkUrl: row.linkUrl,
          linkLabel: row.linkLabel,
        };

  publicCache = { value, at: Date.now() };
  return value;
}

/** 後台看到的樣子：包含未發布的草稿與目前版本號。 */
export function getAdminAnnouncement() {
  return prisma.announcement.findUnique({ where: { id: announcementId } });
}

function normalizeInput(input: AnnouncementInput): AnnouncementInput {
  const title = input.title.trim();
  const body = input.body.trim();
  const linkUrl = input.linkUrl?.trim() || null;
  const linkLabel = input.linkLabel?.trim() || null;

  if (!title) throw new AnnouncementRejected('請輸入標題。');
  if (title.length > 80) throw new AnnouncementRejected('標題最多 80 個字。');
  if (!body) throw new AnnouncementRejected('請輸入內容。');
  if (body.length > 2000) throw new AnnouncementRejected('內容最多 2000 個字。');
  if (linkUrl && linkUrl.length > 300) throw new AnnouncementRejected('連結網址太長。');
  if (linkUrl) {
    try {
      new URL(linkUrl);
    } catch {
      throw new AnnouncementRejected('連結網址格式不正確。');
    }
  }
  if (linkLabel && linkLabel.length > 40) throw new AnnouncementRejected('連結文字最多 40 個字。');
  // 只填連結文字沒有網址就沒有地方可以按，乾脆視為沒填。
  return {
    title,
    body,
    linkUrl,
    linkLabel: linkUrl ? linkLabel : null,
    published: input.published,
  };
}

/** 存進去的內容跟現有的列有沒有差別，決定要不要多發一次公告。 */
function contentChanged(
  existing: { title: string; body: string; linkUrl: string | null; linkLabel: string | null },
  next: AnnouncementInput,
) {
  return (
    existing.title !== next.title ||
    existing.body !== next.body ||
    existing.linkUrl !== next.linkUrl ||
    existing.linkLabel !== next.linkLabel
  );
}

/**
 * 版號只在文字內容真的變了的時候才 +1；只是切換 published 或原封不動存一次，
 * 不應該讓已經關掉公告的人再被跳一次——不然站長每次手滑重存都會打擾所有訪客。
 */
export async function saveAnnouncement(rawInput: AnnouncementInput) {
  const input = normalizeInput(rawInput);
  const existing = await prisma.announcement.findUnique({ where: { id: announcementId } });
  const versionBumped = !existing || contentChanged(existing, input);

  const data = {
    title: input.title,
    body: input.body,
    linkUrl: input.linkUrl,
    linkLabel: input.linkLabel,
    published: input.published,
  };

  const row = await prisma.announcement.upsert({
    where: { id: announcementId },
    create: { id: announcementId, version: 1, ...data },
    update: versionBumped ? { ...data, version: { increment: 1 } } : data,
  });

  // 寫完才清，順序反過來的話會有一瞬間把還沒 commit 的狀態記進快取。
  resetAnnouncementCache();
  return { row, versionBumped };
}
