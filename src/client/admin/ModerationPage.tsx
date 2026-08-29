import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError } from '../api';
import {
  type AdminReport,
  blockForecaster,
  dismissReport,
  getReports,
  hideComment,
  restoreComment,
  unblockForecaster,
} from './api';

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

function RecoveryButton({
  action,
  label,
  pendingLabel,
}: {
  action: () => Promise<unknown>;
  label: string;
  pendingLabel: string;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const mutation = useMutation({
    mutationFn: action,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'reports'] }),
    onError: (failure) => setError(failure instanceof ApiError ? failure.message : '操作失敗'),
  });

  return (
    <>
      <button
        className="button button-ghost button-small"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate()}
        type="button"
      >
        {mutation.isPending ? pendingLabel : label}
      </button>
      {error && <span className="admin-note admin-note-error">{error}</span>}
    </>
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

  const { reports: items, hiddenComments, blockedForecasters } = reports.data;

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

      <h2>已隱藏留言</h2>
      {hiddenComments.length === 0 && <p className="admin-note">目前沒有已隱藏留言。</p>}
      <div className="admin-report-list">
        {hiddenComments.map((comment) => (
          <article className="admin-report-row" key={comment.id}>
            <blockquote className="admin-report-comment">
              <p>{comment.body}</p>
              <cite>
                {comment.forecaster.displayName ?? '預測者'} · {comment.forecaster.code} · 選區{' '}
                {comment.contestId}
              </cite>
            </blockquote>
            <div className="admin-action-row">
              <RecoveryButton
                action={() => restoreComment(comment.id)}
                label="恢復留言"
                pendingLabel="恢復中…"
              />
            </div>
          </article>
        ))}
      </div>

      <h2>已封鎖身份</h2>
      {blockedForecasters.length === 0 && <p className="admin-note">目前沒有已封鎖身份。</p>}
      <div className="admin-report-list">
        {blockedForecasters.map((forecaster) => (
          <article className="admin-report-row" key={forecaster.id}>
            <header>
              <strong>{forecaster.displayName ?? '預測者'}</strong>
              <time>封鎖於 {new Date(forecaster.blockedAt).toLocaleString('zh-TW')}</time>
            </header>
            <p className="admin-note">身份編號 {forecaster.code}</p>
            <div className="admin-action-row">
              <RecoveryButton
                action={() => unblockForecaster(forecaster.id)}
                label="解除封鎖"
                pendingLabel="解除中…"
              />
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
