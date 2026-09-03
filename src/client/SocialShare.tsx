type SharePlatform = 'facebook' | 'line' | 'threads' | 'twitter';

const labels: Record<SharePlatform, string> = {
  facebook: 'Facebook',
  line: 'LINE',
  threads: 'Threads',
  twitter: 'Twitter',
};
const platforms: SharePlatform[] = ['facebook', 'threads', 'twitter', 'line'];
// 分享預覽仍要定期更新，但不能每次點擊都產生全新的 CDN cache key；五分鐘一個版本。
const shareCacheWindowMs = 5 * 60 * 1000;

function SocialIcon({ platform }: { platform: SharePlatform }) {
  const paths = {
    facebook: (
      <path d="M14 21v-8h3l.5-3H14V8.5c0-1 .4-1.5 1.8-1.5H18V4.2c-.7-.1-1.7-.2-2.8-.2-2.8 0-4.7 1.7-4.7 4.8V10H8v3h2.5v8" />
    ),
    threads: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M16 12.5c0 2.8-1.4 4.6-3.8 4.6-2 0-3.4-1.1-3.4-2.7 0-1.7 1.4-2.7 3.7-2.7 1.5 0 2.7.4 3.5 1.1-.2-3.5-1.7-5-4.4-5-1.3 0-2.4.4-3.3 1.2" />
      </>
    ),
    twitter: <path d="M5 4 19 20M19 4 5 20" />,
    line: (
      <>
        <path d="M20 11.3c0 4.1-3.6 7.4-8 7.4-.8 0-1.6-.1-2.3-.3L5 21l1.4-4C4.9 15.7 4 13.6 4 11.3 4 7.2 7.6 4 12 4s8 3.2 8 7.3Z" />
        <path d="M8 9.5v4h2m1-4v4m2-4v4m0-4 3 4v-4" />
      </>
    ),
  };
  return (
    <svg
      aria-hidden="true"
      className="social-icon"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
    >
      {paths[platform]}
    </svg>
  );
}

export function buildSocialShareUrl(
  platform: SharePlatform,
  pageUrl: string,
  text: string,
  timestamp: number,
) {
  const page = new URL(pageUrl);
  page.hash = '';
  page.searchParams.set(
    't',
    String(Math.floor(timestamp / shareCacheWindowMs) * shareCacheWindowMs),
  );

  if (platform === 'facebook') {
    const share = new URL('https://www.facebook.com/sharer/sharer.php');
    share.searchParams.set('u', page.toString());
    return share.toString();
  }
  if (platform === 'threads') {
    const share = new URL('https://www.threads.com/intent/post');
    share.searchParams.set('text', `${text}\n${page}`);
    return share.toString();
  }
  if (platform === 'line') {
    const share = new URL('https://social-plugins.line.me/lineit/share');
    share.searchParams.set('url', page.toString());
    share.searchParams.set('text', text);
    return share.toString();
  }
  const share = new URL('https://twitter.com/intent/tweet');
  share.searchParams.set('text', text);
  share.searchParams.set('url', page.toString());
  return share.toString();
}

export function SocialShare({
  className = '',
  pageUrl,
  text,
}: {
  className?: string;
  /** 傳相對路徑即可；點擊時才依目前網域組成完整分享網址。 */
  pageUrl?: string;
  text?: string;
}) {
  return (
    <section aria-label="分享這個頁面" className={`social-share ${className}`.trim()}>
      <span>分享</span>
      {platforms.map((platform) => (
        <button
          aria-label={`分享到${labels[platform]}`}
          className={platform}
          key={platform}
          onClick={() => {
            const sharedPage = pageUrl
              ? new URL(pageUrl, window.location.origin).toString()
              : window.location.href;
            window.open(
              buildSocialShareUrl(platform, sharedPage, text ?? document.title, Date.now()),
              '_blank',
              'noopener,noreferrer,width=720,height=720',
            );
          }}
          type="button"
        >
          <SocialIcon platform={platform} />
          <span>{labels[platform]}</span>
        </button>
      ))}
    </section>
  );
}
