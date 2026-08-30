import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError } from '../api';
import { avatarUrl } from '../avatars';
import {
  type AdminCandidate,
  getAdminCandidates,
  importCandidateCsv,
  previewCandidateCsv,
} from './api';

function errorMessage(error: unknown) {
  return error instanceof ApiError ? error.message : '處理失敗，請稍後再試。';
}

const changeLabels: Record<string, string> = {
  name: '姓名',
  partyId: '政黨',
  ballotNo: '號次',
  status: '狀態',
};

function imageExists(src: string) {
  return new Promise<boolean>((resolve) => {
    const image = new Image();
    const done = (exists: boolean) => {
      clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      resolve(exists);
    };
    const timeout = setTimeout(() => done(false), 10_000);
    image.onload = () => done(true);
    image.onerror = () => done(false);
    image.src = `${src}?photo-check=${Date.now()}`;
  });
}

export async function findMissingCandidatePhotos(
  candidates: AdminCandidate[],
  check = (candidate: AdminCandidate) => imageExists(avatarUrl(candidate.id) ?? ''),
) {
  const missing: AdminCandidate[] = [];
  for (let index = 0; index < candidates.length; index += 8) {
    const batch = candidates.slice(index, index + 8);
    const results = await Promise.all(batch.map(check));
    missing.push(...batch.filter((_, offset) => !results[offset]));
  }
  return missing;
}

export function CandidateImportPage() {
  const queryClient = useQueryClient();
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [decisions, setDecisions] = useState<Record<string, boolean>>({});
  const [missingPhotos, setMissingPhotos] = useState<AdminCandidate[] | null>(null);
  const candidates = useQuery({
    queryKey: ['admin', 'candidates'],
    queryFn: getAdminCandidates,
  });
  const photoAudit = useMutation({
    mutationFn: () => findMissingCandidatePhotos(candidates.data?.candidates ?? []),
    onSuccess: setMissingPhotos,
  });
  const preview = useMutation({
    mutationFn: () => previewCandidateCsv(csv),
    onSuccess: () => setDecisions({}),
  });
  const apply = useMutation({
    mutationFn: () =>
      importCandidateCsv(
        csv,
        Object.entries(decisions).flatMap(([code, replace]) => (replace ? [code] : [])),
      ),
    onSuccess: async () => {
      setMissingPhotos(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin', 'overview'] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'candidates'] }),
      ]);
    },
  });
  const summary = preview.data?.summary;
  const updates = preview.data?.updates ?? [];
  const hasUndecided = updates.some(({ code }) => decisions[code] === undefined);

  return (
    <div className="admin-section">
      <h1>候選人 CSV 匯入</h1>
      <p className="admin-note">
        固定欄位為 code、contestId、name、partyId、ballotNo、status。code
        會成為候選人的永久識別碼，圖片請 commit 到<code> public/avatars/&#123;code&#125;.webp</code>
        。第一次匯入某選區會移除該區全部假候選人，因此 CSV 必須包含該選區目前已知的完整正式名單。
      </p>
      <pre className="admin-csv-example">
        code,contestId,name,partyId,ballotNo,status{`\n`}
        TPE-MAYOR-001,TPE-EXECUTIVE-1,王小明,DPP,1,CONFIRMED
      </pre>

      <div className="admin-import-box">
        <input
          accept=".csv,text/csv"
          aria-label="候選人 CSV"
          onChange={(event) => {
            const file = event.target.files?.[0];
            preview.reset();
            apply.reset();
            setDecisions({});
            setFileName(file?.name ?? '');
            void file?.text().then(setCsv);
          }}
          type="file"
        />
        {fileName && <span>{fileName}</span>}
        <button
          className="button button-ghost button-small"
          disabled={!csv || preview.isPending}
          onClick={() => preview.mutate()}
          type="button"
        >
          {preview.isPending ? '驗證中…' : '驗證並預覽'}
        </button>
      </div>

      {preview.isError && (
        <p className="admin-note admin-note-error">{errorMessage(preview.error)}</p>
      )}
      {summary && (
        <>
          <div className="admin-stat-grid">
            <div className="admin-stat-card">
              <span>候選人</span>
              <strong>{summary.candidates}</strong>
            </div>
            <div className="admin-stat-card">
              <span>選區</span>
              <strong>{summary.contests}</strong>
            </div>
            <div className="admin-stat-card">
              <span>新增</span>
              <strong>{summary.create}</strong>
            </div>
            <div className="admin-stat-card">
              <span>更新</span>
              <strong>{summary.update}</strong>
            </div>
            <div className="admin-stat-card">
              <span>完全相同</span>
              <strong>{summary.unchanged}</strong>
            </div>
            <div className="admin-stat-card">
              <span>移除假資料</span>
              <strong>{summary.removePlaceholders}</strong>
            </div>
          </div>
          {updates.length > 0 && (
            <section className="admin-replacement-list">
              <h2>逐筆確認取代</h2>
              <p className="admin-note">相同 code 的資料必須逐筆確認；取消會保留資料庫原值。</p>
              {updates.map((update) => (
                <article className="admin-report-row" key={update.code}>
                  <strong>
                    {update.name} · {update.code}
                  </strong>
                  <ul className="admin-change-list">
                    {update.changes.map((change) => (
                      <li key={change.field}>
                        <b>{changeLabels[change.field] ?? change.field}</b>
                        <span>{change.before ?? '空白'}</span>
                        <span>→</span>
                        <span>{change.after ?? '空白'}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="admin-action-row">
                    <button
                      className={`button button-small ${decisions[update.code] === true ? 'button-dark' : 'button-ghost'}`}
                      onClick={() =>
                        setDecisions((current) => ({ ...current, [update.code]: true }))
                      }
                      type="button"
                    >
                      確認取代
                    </button>
                    <button
                      className={`button button-small ${decisions[update.code] === false ? 'button-dark' : 'button-ghost'}`}
                      onClick={() =>
                        setDecisions((current) => ({ ...current, [update.code]: false }))
                      }
                      type="button"
                    >
                      取消此筆
                    </button>
                  </div>
                </article>
              ))}
            </section>
          )}
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>code</th>
                  <th>選區</th>
                  <th>姓名</th>
                  <th>政黨</th>
                  <th>號次</th>
                  <th>狀態</th>
                </tr>
              </thead>
              <tbody>
                {preview.data?.rows?.map((row) => (
                  <tr key={row.code}>
                    <td>{row.code}</td>
                    <td>{row.contestId}</td>
                    <td>{row.name}</td>
                    <td>{row.partyId}</td>
                    <td>{row.ballotNo ?? '—'}</td>
                    <td>{row.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {summary.candidates > 100 && <p className="admin-note">預覽只顯示前 100 筆。</p>}
          <button
            className="button button-dark"
            disabled={hasUndecided || apply.isPending || apply.isSuccess}
            onClick={() => apply.mutate()}
            type="button"
          >
            {hasUndecided
              ? '請先逐筆確認'
              : apply.isPending
                ? '匯入中…'
                : apply.isSuccess
                  ? '匯入完成'
                  : '確認匯入'}
          </button>
        </>
      )}
      {apply.isError && <p className="admin-note admin-note-error">{errorMessage(apply.error)}</p>}
      {apply.isSuccess && (
        <p className="admin-note">
          資料已寫入。圖片 commit 並重新部署後，所有執行個體都會載入新名單。
        </p>
      )}

      <section className="admin-photo-audit">
        <h2>候選人照片</h2>
        {candidates.isPending ? (
          <p className="admin-note">讀取候選人…</p>
        ) : candidates.isError ? (
          <p className="admin-note admin-note-error">{errorMessage(candidates.error)}</p>
        ) : (
          <>
            <p className="admin-note">
              共 {candidates.data.candidates.length.toLocaleString()} 位會顯示在前台的真實候選人。
            </p>
            <button
              className="button button-ghost button-small"
              disabled={photoAudit.isPending || candidates.data.candidates.length === 0}
              onClick={() => photoAudit.mutate()}
              type="button"
            >
              {photoAudit.isPending ? '檢查中…' : '檢查缺少照片'}
            </button>
          </>
        )}
        {missingPhotos &&
          (missingPhotos.length ? (
            <>
              <p className="admin-note admin-note-error">缺少 {missingPhotos.length} 張照片。</p>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>code</th>
                      <th>姓名</th>
                      <th>政黨</th>
                      <th>選舉</th>
                    </tr>
                  </thead>
                  <tbody>
                    {missingPhotos.map((candidate) => (
                      <tr key={candidate.id}>
                        <td>{candidate.id}</td>
                        <td>{candidate.name}</td>
                        <td>{candidate.partyId ?? '無黨籍'}</td>
                        <td>{candidate.contestName}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="admin-note">照片已齊全。</p>
          ))}
      </section>
    </div>
  );
}
