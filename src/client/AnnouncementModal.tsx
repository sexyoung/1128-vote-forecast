import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { getAnnouncement } from './api';
import { track } from './analytics';
import { Icon } from './pages/ElectionPrototypeShared';

const seenKey = 'vf_announcement_seen';

function readSeenVersion(): number | null {
  try {
    const raw = window.localStorage.getItem(seenKey);
    const parsed = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    // 有些隱私模式讀 localStorage 直接丟例外，當作「還沒關過」處理，不要讓一個
    // 讀取失敗擋住整個頁面。
    return null;
  }
}

function writeSeenVersion(version: number) {
  try {
    window.localStorage.setItem(seenKey, String(version));
  } catch {
    // 寫不進去頂多下次重整再跳一次，不是需要中斷使用者的錯誤。
  }
}

/**
 * 全站公告 modal。掛在 App 裡、跟 <Routes> 平行，所以任何網址進站都看得到；
 * SSR 頁面是公開頁快取、在不同訪客之間共用，伺服器不知道「這個瀏覽器關過沒」，
 * 所以第一次 render（含伺服器那一輪）一律回 null，等 effect 讀完 localStorage
 * 才決定要不要跳出來——這樣 hydration 兩邊的輸出才會一致。
 */
export function AnnouncementModal() {
  const { pathname } = useLocation();
  // 後台只有站長自己在看，不需要被自己寫的公告打斷。
  const isAdmin = pathname.startsWith('/admin');

  const { data } = useQuery({
    queryKey: ['announcement'],
    queryFn: getAnnouncement,
    enabled: !isAdmin,
  });
  const announcement = data?.announcement ?? null;

  const [loaded, setLoaded] = useState(false);
  const [seenVersion, setSeenVersion] = useState<number | null>(null);
  useEffect(() => {
    setSeenVersion(readSeenVersion());
    setLoaded(true);
  }, []);

  const visible =
    loaded && !isAdmin && announcement !== null && seenVersion !== announcement.version;

  function close() {
    if (!announcement) return;
    writeSeenVersion(announcement.version);
    setSeenVersion(announcement.version);
    track('announcement_dismissed', { version: announcement.version });
  }

  // 跟 IdentityDialog 同一套對話框行為：Escape 關閉、開著的時候鎖住背景捲動。
  useEffect(() => {
    if (!visible) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', closeOnEscape);
    document.body.classList.add('sheet-open');
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.body.classList.remove('sheet-open');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // 同一版只回報一次「跳出來了」，不因為別的 re-render（例如 query refetch）
  // 又送一筆重複事件。
  const trackedVersion = useRef<number | null>(null);
  useEffect(() => {
    if (!visible || !announcement || trackedVersion.current === announcement.version) return;
    trackedVersion.current = announcement.version;
    track('announcement_shown', { version: announcement.version });
  }, [visible, announcement]);

  if (!visible || !announcement) return null;

  return (
    <div className="sheet-backdrop centered" onMouseDown={close} role="presentation">
      <section
        aria-labelledby="announcement-title"
        aria-modal="true"
        className="announcement-card"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header>
          <h2 id="announcement-title">{announcement.title}</h2>
          <button aria-label="關閉" className="icon-button" onClick={close} type="button">
            <Icon name="close" />
          </button>
        </header>
        <p className="announcement-body">{announcement.body}</p>
        {announcement.linkUrl && (
          <a
            className="button button-dark button-wide"
            href={announcement.linkUrl}
            onClick={close}
            rel="noreferrer"
            target="_blank"
          >
            {announcement.linkLabel || '了解更多'}
          </a>
        )}
      </section>
    </div>
  );
}
