import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError } from '../api';
import { type AdminReport, blockForecaster, dismissReport, getReports, hideComment } from './api';

const reasonLabels: Record<string, string> = {
  SPAM: '垃圾內容',
  ABUSE: '騷擾',
  ADULT: '色情',
  ILLEGAL: '違法',
  OTHER: '其他',
};

function ReportRow({ report }: { report: AdminReport }) {
  const queryClient = useQueryClient();
  const [busyAction, setBusyAction] = useState<'hide' | 'dismiss' | 'block' | null>(null);
  const [actionError, setActionError] = useState('');

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'reports'] });

  const hide = useMutation({
    mutationFn: () => hideComment(report.targetId),
    onMutate: () => setBusyAction('hide'),
    onSuccess: refresh,
    onError: (error) => setActionError(error instanceof ApiError ? error.message : '操作失敗'),
    onSettled: () => setBusyAction(null),
  });
  const dismiss = useMutation({
    mutationFn: () => dismissReport(report.id),
    onMutate: () => setBusyAction('dismiss'),
    onSuccess: refresh,
    onError: (error) => setActionError(error instanceof ApiError ? error.message : '操作失敗'),
    onSettled: () => setBusyAction(null),
  });
  const block = useMutation({
    mutationFn: () => blockForecaster(report.comment?.forecaster.id ?? ''),
    onMutate: () => setBusyAction('block'),
    onSuccess: refresh,
    onError: (error) => setActionError(error instanceof ApiError ? error.message : '操作失敗'),
    onSettled: () => setBusyAction(null),
  });

  const busy = busyAction !== null;

  return (
    <article className="admin-report-row">
      <header>
        <span className="admin-report-reason">{reasonLabels[report.reason] ?? report.reason}</span>
        <time>{new Date(report.createdAt).toLocaleString('zh-TW')}</time>
      </header>
      {report.note && <p className="admin-note">檢舉附註：{report.note}</p>}
      {report.comment ? (
        <blockquote className="admin-report-comment">
          <p>{report.comment.body}</p>
          <cite>
            {report.comment.forecaster.displayName ?? '預測者'} · {report.comment.forecaster.code} ·
            選區 {report.comment.contestId} · 目前狀態 {report.comment.status}
          </cite>
        </blockquote>
      ) : (
        <p className="admin-note">留言已經不存在了（可能已被刪除）。</p>
      )}
      {actionError && <p className="admin-note admin-note-error">{actionError}</p>}
      <div className="admin-action-row">
        <button
          className="button button-ghost button-small"
          disabled={busy || report.comment?.status === 'HIDDEN'}
          onClick={() => hide.mutate()}
          type="button"
        >
          {busyAction === 'hide' ? '隱藏中…' : '隱藏'}
        </button>
        <button
          className="button button-ghost button-small"
          disabled={busy}
          onClick={() => dismiss.mutate()}
          type="button"
        >
          {busyAction === 'dismiss' ? '駁回中…' : '駁回'}
        </button>
        <button
          className="button button-ghost button-small"
          disabled={busy || !report.comment}
          onClick={() => block.mutate()}
          type="button"
        >
          {busyAction === 'block' ? '封鎖中…' : '封鎖這個身份'}
        </button>
      </div>
    </article>
  );
}

export function ModerationPage() {
  const reports = useQuery({ queryKey: ['admin', 'reports'], queryFn: getReports });

  if (reports.isPending) return <p className="admin-note">載入中…</p>;
  if (reports.isError)
    return (
      <p className="admin-note admin-note-error">
        讀取失敗：{reports.error instanceof ApiError ? reports.error.message : '未知錯誤'}
      </p>
    );

  const items = reports.data.reports;

  return (
    <div className="admin-section">
      <h1>檢舉／留言審核</h1>
      <p className="admin-note">共 {items.length} 筆待處理檢舉。</p>
      {items.length === 0 && <p className="admin-note">目前沒有待處理的檢舉。</p>}
      <div className="admin-report-list">
        {items.map((report) => (
          <ReportRow key={report.id} report={report} />
        ))}
      </div>
    </div>
  );
}
