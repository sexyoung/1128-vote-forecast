import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ApiError } from '../api';
import {
  type AdminActivityPage,
  type AdminForecasterComment,
  type AdminForecasterPrediction,
  blockForecaster,
  getAdminForecaster,
  getAdminForecasterComments,
  getAdminForecasterPredictions,
  unblockForecaster,
} from './api';
import { inferredLocation } from './location';

type ActivityTab = 'predictions' | 'comments';

function dateTime(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-TW') : '—';
}

function ActivityTabs({
  value,
  onChange,
}: {
  value: ActivityTab;
  onChange: (tab: ActivityTab) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);

  const moveToActive = useCallback((animate: boolean) => {
    const bar = barRef.current;
    const pill = bar?.querySelector<HTMLElement>('.t-tabs-pill');
    const tab = bar?.querySelector<HTMLElement>('.t-tab[aria-selected="true"]');
    if (!pill || !tab) return;
    if (!animate) {
      const previous = pill.style.transition;
      pill.style.transition = 'none';
      pill.style.transform = `translateX(${tab.offsetLeft}px)`;
      pill.style.width = `${tab.offsetWidth}px`;
      void pill.offsetWidth;
      pill.style.transition = previous;
      return;
    }
    pill.style.transform = `translateX(${tab.offsetLeft}px)`;
    pill.style.width = `${tab.offsetWidth}px`;
  }, []);

  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => {
      moveToActive(initialized.current);
      initialized.current = true;
    });
    return () => cancelAnimationFrame(frame);
  }, [moveToActive, value]);

  useEffect(() => {
    const resize = () => moveToActive(false);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [moveToActive]);

  return (
    <div aria-label="使用者活動" className="t-tabs admin-activity-tabs" ref={barRef} role="tablist">
      <span aria-hidden="true" className="t-tabs-pill" />
      {(
        [
          ['predictions', '預測'],
          ['comments', '留言'],
        ] as const
      ).map(([id, label]) => (
        <button
          aria-selected={value === id}
          className="t-tab"
          key={id}
          onClick={() => onChange(id)}
          role="tab"
          type="button"
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function ActivityPagination({
  data,
  forecasterId,
  tab,
}: {
  data: AdminActivityPage<unknown>;
  forecasterId: string;
  tab: ActivityTab;
}) {
  if (data.totalPages <= 1) return null;
  const href = (page: number) => `/admin/forecasters/${forecasterId}?tab=${tab}&page=${page}`;
  return (
    <nav aria-label={`${tab === 'predictions' ? '預測' : '留言'}分頁`} className="admin-pagination">
      {data.page > 1 && <Link to={href(data.page - 1)}>上一頁</Link>}
      <span>
        第 {data.page} / {data.totalPages} 頁
      </span>
      {data.page < data.totalPages && <Link to={href(data.page + 1)}>下一頁</Link>}
    </nav>
  );
}

function Predictions({ data }: { data: AdminActivityPage<AdminForecasterPrediction> }) {
  if (!data.items.length) return <p className="admin-note">這個身份尚未送出預測。</p>;
  return (
    <div className="admin-activity-list">
      {data.items.map((prediction) => (
        <article className="admin-activity-card" key={prediction.id}>
          <header>
            <div>
              <Link to={`/contest/${prediction.contestId}`}>
                {prediction.contest?.name ?? prediction.contestId}
              </Link>
              <small>{prediction.contest?.area ?? '選區資料已移除'}</small>
            </div>
            <span className={prediction.status === 'ACTIVE' ? 'is-active' : 'is-invalid'}>
              {prediction.status === 'ACTIVE' ? '有效' : '已失效'}
            </span>
          </header>
          <ul className="admin-pick-list">
            {prediction.picks.map((pick) => (
              <li key={`${pick.targetType}-${pick.targetId}`}>
                <i style={{ background: pick.color ?? '#9aa19d' }} />
                {pick.label}
                <small>{pick.targetType === 'PARTY' ? '政黨' : '候選人'}</small>
              </li>
            ))}
          </ul>
          <footer>
            <span>版本 {prediction.version}</span>
            <span>更新 {dateTime(prediction.updatedAt)}</span>
            {prediction.invalidReason && <span>{prediction.invalidReason}</span>}
          </footer>
        </article>
      ))}
    </div>
  );
}

function Comments({ data }: { data: AdminActivityPage<AdminForecasterComment> }) {
  if (!data.items.length) return <p className="admin-note">這個身份尚未留言。</p>;
  return (
    <div className="admin-activity-list">
      {data.items.map((comment) => (
        <article className="admin-activity-card" key={comment.id}>
          <header>
            <div>
              <Link to={`/contest/${comment.contestId}`}>
                {comment.contest?.name ?? comment.contestId}
              </Link>
              <small>{comment.contest?.area ?? '選區資料已移除'}</small>
            </div>
            <span className={comment.status === 'VISIBLE' ? 'is-active' : 'is-invalid'}>
              {comment.status === 'VISIBLE'
                ? '顯示中'
                : comment.status === 'HIDDEN'
                  ? '已隱藏'
                  : '已刪除'}
            </span>
          </header>
          <p>{comment.body}</p>
          <footer>
            <span>{dateTime(comment.createdAt)}</span>
            {comment.parentId && <span>回覆留言</span>}
            <span>{comment.replyCount} 則回覆</span>
          </footer>
        </article>
      ))}
    </div>
  );
}

const signalLabels = { COOKIE: 'Cookie', FINGERPRINT: '裝置指紋', IP: 'IP' } as const;

export function ForecasterDetailPage() {
  const { forecasterId = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const tab: ActivityTab = searchParams.get('tab') === 'comments' ? 'comments' : 'predictions';
  const requestedPage = Number.parseInt(searchParams.get('page') ?? '1', 10);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const profile = useQuery({
    queryKey: ['admin', 'forecaster', forecasterId],
    queryFn: () => getAdminForecaster(forecasterId),
  });
  const predictions = useQuery({
    queryKey: ['admin', 'forecaster', forecasterId, 'predictions', page],
    queryFn: () => getAdminForecasterPredictions(forecasterId, page),
    enabled: tab === 'predictions',
  });
  const comments = useQuery({
    queryKey: ['admin', 'forecaster', forecasterId, 'comments', page],
    queryFn: () => getAdminForecasterComments(forecasterId, page),
    enabled: tab === 'comments',
  });
  const blocking = useMutation({
    mutationFn: (blocked: boolean) =>
      blocked ? unblockForecaster(forecasterId) : blockForecaster(forecasterId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin', 'forecaster', forecasterId] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'forecasters'] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'reports'] }),
      ]);
    },
  });

  if (profile.isPending) return <p className="admin-note">載入使用者…</p>;
  if (profile.isError)
    return (
      <p className="admin-note admin-note-error">
        {profile.error instanceof ApiError ? profile.error.message : '使用者載入失敗。'}
      </p>
    );

  const forecaster = profile.data.forecaster;
  const activity = tab === 'predictions' ? predictions : comments;

  function changeTab(next: ActivityTab) {
    const params = new URLSearchParams(searchParams);
    if (next === 'predictions') params.delete('tab');
    else params.set('tab', next);
    params.delete('page');
    setSearchParams(params, { replace: true });
  }

  return (
    <section className="admin-section">
      <Link className="admin-back-link" to="/admin/forecasters">
        ← 返回預測使用者
      </Link>
      <div className="admin-profile-heading">
        <div>
          <h1>{forecaster.displayName ?? '預測者'}</h1>
          <p className="admin-note">
            {forecaster.code} · {forecaster.id}
          </p>
        </div>
        <button
          className="button button-ghost button-small"
          disabled={blocking.isPending}
          onClick={() => blocking.mutate(Boolean(forecaster.blockedAt))}
          type="button"
        >
          {blocking.isPending ? '處理中…' : forecaster.blockedAt ? '解除封鎖' : '封鎖使用者'}
        </button>
      </div>
      {blocking.isError && (
        <p className="admin-note admin-note-error">
          {blocking.error instanceof ApiError ? blocking.error.message : '封鎖操作失敗。'}
        </p>
      )}

      <div className="admin-stat-grid admin-profile-stats">
        <div className="admin-stat-card">
          <span>狀態</span>
          <strong>{forecaster.blockedAt ? '已封鎖' : '正常'}</strong>
          <small>
            {forecaster.blockedAt ? dateTime(forecaster.blockedAt) : '可正常預測與留言'}
          </small>
        </div>
        <div className="admin-stat-card">
          <span>最後上線</span>
          <strong>{dateTime(forecaster.lastSeenAt)}</strong>
          <small>建立於 {dateTime(forecaster.createdAt)}</small>
        </div>
        <div className="admin-stat-card">
          <span>活動</span>
          <strong>{forecaster.counts.predictions} 預測</strong>
          <small>
            {forecaster.counts.comments} 留言 · {forecaster.counts.reports} 檢舉
          </small>
        </div>
        <div className="admin-stat-card">
          <span>真人驗證</span>
          <strong>{forecaster.humanVerifiedAt ? '已通過' : '未驗證'}</strong>
          <small>{dateTime(forecaster.humanVerifiedAt)}</small>
        </div>
        <div className="admin-stat-card admin-network-card">
          <span>最近 IP／推測位置</span>
          <strong>{forecaster.lastIp ?? '尚無資料'}</strong>
          <small>{inferredLocation(forecaster)}</small>
          <small>
            {forecaster.lastGeoSource ?? '無 edge 定位資料'} · {dateTime(forecaster.lastIpAt)}
          </small>
        </div>
      </div>

      <section className="admin-signal-section">
        <h2>身份訊號</h2>
        <p className="admin-note">
          下列識別碼是不可逆 HMAC 前 12 碼，用來比對重複來源；原始指紋仍不保存。
        </p>
        {forecaster.signals.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>類型</th>
                  <th>識別碼</th>
                  <th>首次出現</th>
                  <th>最後出現</th>
                  <th>次數</th>
                </tr>
              </thead>
              <tbody>
                {forecaster.signals.map((signal) => (
                  <tr key={signal.id}>
                    <td>{signalLabels[signal.kind]}</td>
                    <td>{signal.code}</td>
                    <td>{dateTime(signal.firstSeenAt)}</td>
                    <td>{dateTime(signal.lastSeenAt)}</td>
                    <td>{signal.seenCount.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="admin-note">沒有身份訊號。</p>
        )}
      </section>

      <section className="admin-activity-section">
        <ActivityTabs onChange={changeTab} value={tab} />
        {activity.isPending ? (
          <p className="admin-note">載入{tab === 'predictions' ? '預測' : '留言'}…</p>
        ) : activity.isError ? (
          <p className="admin-note admin-note-error">
            {activity.error instanceof ApiError ? activity.error.message : '活動載入失敗。'}
          </p>
        ) : tab === 'predictions' ? (
          <>
            <Predictions data={predictions.data!} />
            <ActivityPagination data={predictions.data!} forecasterId={forecasterId} tab={tab} />
          </>
        ) : (
          <>
            <Comments data={comments.data!} />
            <ActivityPagination data={comments.data!} forecasterId={forecasterId} tab={tab} />
          </>
        )}
      </section>
    </section>
  );
}
