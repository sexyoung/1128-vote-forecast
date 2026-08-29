import { useQuery } from '@tanstack/react-query';
import { type AdminOverview, getAdminOverview } from './api';

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="admin-stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}

function HealthDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`admin-health-dot ${ok ? 'ok' : 'down'}`}>
      <i />
      {label}
    </span>
  );
}

function summarizePredictions(overview: AdminOverview) {
  const active = overview.predictions.byStatus.ACTIVE ?? 0;
  const invalidated = overview.predictions.byStatus.INVALIDATED ?? 0;
  return `使用中 ${active.toLocaleString()} ／ 已失效 ${invalidated.toLocaleString()}`;
}

export function OverviewPage() {
  const overview = useQuery({
    queryKey: ['admin', 'overview'],
    queryFn: getAdminOverview,
    staleTime: 0,
  });

  if (overview.isPending) return <p className="admin-note">載入中…</p>;
  if (overview.isError)
    return (
      <p className="admin-note admin-note-error">
        總覽讀取失敗：
        {overview.error instanceof Error ? overview.error.message : '未知錯誤'}
      </p>
    );

  const data = overview.data;

  return (
    <div className="admin-section">
      <h1>總覽</h1>

      <div className="admin-stat-grid">
        <StatCard
          label="預測"
          value={data.predictions.total.toLocaleString()}
          hint={summarizePredictions(data)}
        />
        <StatCard
          label="有資料的選區"
          value={`${data.contestsWithData.toLocaleString()} / ${data.totalContests.toLocaleString()}`}
        />
        <StatCard
          label="候選人覆蓋率"
          value={`${data.candidateCoverage.contestsWithCandidates.toLocaleString()} / ${data.candidateCoverage.totalContests.toLocaleString()}`}
          hint="已有候選人資料的選區數"
        />
        <StatCard
          label="趨勢快照"
          value={data.snapshot.latestCapturedOn ?? '尚無快照'}
          hint={data.snapshot.capturedToday ? '今天已經抄過' : '今天還沒抄'}
        />
      </div>

      <div className="admin-health-row">
        <HealthDot label="Redis" ok={data.redis.reachable} />
        <HealthDot label="資料庫" ok={data.database.reachable} />
      </div>
    </div>
  );
}
