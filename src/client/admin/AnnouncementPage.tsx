import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../api';
import {
  type AdminAnnouncement,
  type AnnouncementDraft,
  getAdminAnnouncement,
  saveAnnouncement,
} from './api';

function errorMessage(error: unknown) {
  return error instanceof ApiError ? error.message : '儲存失敗，請稍後再試。';
}

const emptyDraft: AnnouncementDraft = {
  title: '',
  body: '',
  linkUrl: null,
  linkLabel: null,
  published: false,
};

function toDraft(row: AdminAnnouncement | null): AnnouncementDraft {
  if (!row) return emptyDraft;
  return {
    title: row.title,
    body: row.body,
    linkUrl: row.linkUrl,
    linkLabel: row.linkLabel,
    published: row.published,
  };
}

/**
 * 跟 src/server/announcement.ts 的 normalizeInput／contentChanged 是同一套判斷，
 * 純粹是為了在存檔前就把「這次會不會 +1」講清楚——真正拍板的還是伺服器那一份，
 * 這裡算錯了頂多提示文字不準，不會讓資料庫存進不一致的版本號。
 */
function wouldBumpVersion(existing: AdminAnnouncement | null, draft: AnnouncementDraft) {
  const linkUrl = draft.linkUrl?.trim() || null;
  const linkLabel = linkUrl ? draft.linkLabel?.trim() || null : null;
  if (!existing) return true;
  return (
    existing.title !== draft.title.trim() ||
    existing.body !== draft.body.trim() ||
    existing.linkUrl !== linkUrl ||
    existing.linkLabel !== linkLabel
  );
}

export function AnnouncementPage() {
  const queryClient = useQueryClient();
  const announcement = useQuery({
    queryKey: ['admin', 'announcement'],
    queryFn: getAdminAnnouncement,
    staleTime: 0,
  });

  const [draft, setDraft] = useState<AnnouncementDraft>(emptyDraft);
  // 只在第一次讀到資料時把草稿蓋成伺服器的內容；之後 refetch（例如存檔成功後）
  // 不該把使用者正在打的字沖掉。
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current || !announcement.isSuccess) return;
    initialized.current = true;
    setDraft(toDraft(announcement.data.announcement));
  }, [announcement.isSuccess, announcement.data]);

  const save = useMutation({
    mutationFn: () => saveAnnouncement(draft),
    onSuccess: (result) => {
      queryClient.setQueryData(['admin', 'announcement'], { announcement: result.announcement });
    },
  });

  if (announcement.isPending) return <p className="admin-note">載入中…</p>;
  if (announcement.isError)
    return <p className="admin-note admin-note-error">{errorMessage(announcement.error)}</p>;

  const existing = announcement.data.announcement;
  const bump = wouldBumpVersion(existing, draft);
  const hasLink = Boolean(draft.linkUrl?.trim());

  return (
    <div className="admin-section">
      <h1>全站公告</h1>
      <p className="admin-note">
        發布後，第一次進站的訪客（不分入口）會看到一個
        modal；使用者關掉之後不會再跳出來，除非之後又改了標題、內容或連結。純文字，不支援排版標籤。
      </p>

      {existing && (
        <p className="admin-announcement-status">
          目前版本 v{existing.version} ・{existing.published ? ' 已發布' : ' 未發布'} ・ 最後更新於
          {new Date(existing.updatedAt).toLocaleString('zh-TW')}
        </p>
      )}

      <form
        className="admin-announcement-form"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <div className="admin-field">
          <label htmlFor="announcement-title">標題</label>
          <input
            id="announcement-title"
            maxLength={80}
            onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
            required
            value={draft.title}
          />
        </div>

        <div className="admin-field">
          <label htmlFor="announcement-body">內容</label>
          <textarea
            id="announcement-body"
            maxLength={2000}
            onChange={(event) => setDraft((current) => ({ ...current, body: event.target.value }))}
            required
            value={draft.body}
          />
        </div>

        <div className="admin-field-row">
          <div className="admin-field">
            <label htmlFor="announcement-link-url">連結網址（選填）</label>
            <input
              id="announcement-link-url"
              onChange={(event) =>
                setDraft((current) => ({ ...current, linkUrl: event.target.value }))
              }
              placeholder="https://…"
              type="url"
              value={draft.linkUrl ?? ''}
            />
          </div>
          <div className="admin-field">
            <label htmlFor="announcement-link-label">連結文字（選填）</label>
            <input
              disabled={!hasLink}
              id="announcement-link-label"
              maxLength={40}
              onChange={(event) =>
                setDraft((current) => ({ ...current, linkLabel: event.target.value }))
              }
              placeholder="了解更多"
              value={draft.linkLabel ?? ''}
            />
          </div>
        </div>

        <div className="admin-toggle-row">
          <input
            checked={draft.published}
            id="announcement-published"
            onChange={(event) =>
              setDraft((current) => ({ ...current, published: event.target.checked }))
            }
            type="checkbox"
          />
          <label htmlFor="announcement-published">
            發布（關閉時不會有人看到，也不會佔用版本號）
          </label>
        </div>

        <p className={`admin-announcement-hint ${bump ? 'bump' : 'no-bump'}`}>
          {bump
            ? '儲存後所有人會再看到一次（版本會 +1）。'
            : '只改了顯示狀態或內容跟現在一樣，不會重新跳出（版本不變）。'}
        </p>

        {save.isError && <p className="admin-note admin-note-error">{errorMessage(save.error)}</p>}
        {save.isSuccess && <p className="admin-note">已儲存。</p>}

        <button
          className="button button-dark button-wide"
          disabled={!draft.title.trim() || !draft.body.trim() || save.isPending}
          type="submit"
        >
          {save.isPending ? '儲存中…' : '儲存'}
        </button>
      </form>

      <section className="admin-announcement-preview">
        <h2>預覽</h2>
        <p className="admin-note">前台的 modal 會長這樣（純文字，換行照保留）。</p>
        <div className="admin-announcement-preview-frame">
          <section aria-hidden="true" className="announcement-card">
            <header>
              <h2>{draft.title || '（標題）'}</h2>
              <span aria-hidden="true" className="icon-button">
                ×
              </span>
            </header>
            <p className="announcement-body">{draft.body || '（內容）'}</p>
            {hasLink && (
              <span className="button button-dark button-wide">
                {draft.linkLabel || '了解更多'}
              </span>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}
