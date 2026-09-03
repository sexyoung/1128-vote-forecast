import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { parties } from '../../shared/candidates';
import { ApiError } from '../api';
import { avatarUrl } from '../avatars';
import {
  type AdminCandidate,
  approveCandidateContribution,
  deleteAdminCandidate,
  exportCandidateCsv,
  getCandidateContributions,
  getCandidateVisibility,
  getAdminCandidates,
  importCandidateCsv,
  previewCandidateCsv,
  rejectCandidateContribution,
  saveCandidateVisibility,
  updateAdminCandidate,
} from './api';

function errorMessage(error: unknown) {
  return error instanceof ApiError ? error.message : '處理失敗，請稍後再試。';
}

const changeLabels: Record<string, string> = {
  code: 'code',
  name: '姓名',
  partyId: '政黨',
  ballotNo: '號次',
  status: '狀態',
};

const contestTypeLabels = {
  EXECUTIVE: '縣市長',
  COUNCIL: '議員',
  TOWNSHIP: '鄉鎮市長',
  REPRESENTATIVE: '代表',
  VILLAGE: '村里長',
};

const candidateTabs = [
  ['manage', '候選人管理'],
  ['import', 'CSV 匯入'],
  ['contributions', '待審提案'],
  ['photos', '候選人照片'],
  ['settings', '顯示設定'],
] as const;
type CandidateTab = (typeof candidateTabs)[number][0];

function selectedCandidateTab(value: string | null): CandidateTab {
  return candidateTabs.some(([tab]) => tab === value) ? (value as CandidateTab) : 'manage';
}

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
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = selectedCandidateTab(searchParams.get('tab'));
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [decisions, setDecisions] = useState<Record<string, boolean>>({});
  const [missingPhotos, setMissingPhotos] = useState<AdminCandidate[] | null>(null);
  const [candidateSearch, setCandidateSearch] = useState('');
  const candidates = useQuery({
    queryKey: ['admin', 'candidates'],
    queryFn: getAdminCandidates,
    enabled: tab === 'manage' || tab === 'photos',
  });
  const candidateVisibility = useQuery({
    queryKey: ['admin', 'candidate-visibility'],
    queryFn: getCandidateVisibility,
    enabled: tab === 'settings',
  });
  const contributions = useQuery({
    queryKey: ['admin', 'candidate-contributions'],
    queryFn: getCandidateContributions,
    enabled: tab === 'contributions',
  });
  const updateCandidateVisibility = useMutation({
    mutationFn: saveCandidateVisibility,
    onSuccess: async () => {
      await candidateVisibility.refetch();
    },
  });
  const photoAudit = useMutation({
    mutationFn: () => findMissingCandidatePhotos(candidates.data?.candidates ?? []),
    onSuccess: setMissingPhotos,
  });
  const exportCsv = useMutation({
    mutationFn: exportCandidateCsv,
    onSuccess: ({ blob, fileName }) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(url);
    },
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
  const approveContribution = useMutation({
    mutationFn: approveCandidateContribution,
    onSuccess: async ({ blob, photoFile }) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = photoFile;
      link.click();
      URL.revokeObjectURL(url);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['admin', 'candidate-contributions'],
        }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'candidates'] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'overview'] }),
      ]);
    },
  });
  const rejectContribution = useMutation({
    mutationFn: rejectCandidateContribution,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['admin', 'candidate-contributions'],
      });
    },
  });
  const updateCandidate = useMutation({
    mutationFn: updateAdminCandidate,
    onSuccess: async () => {
      setMissingPhotos(null);
      await queryClient.invalidateQueries({
        queryKey: ['admin', 'candidates'],
      });
    },
  });
  const deleteCandidate = useMutation({
    mutationFn: deleteAdminCandidate,
    onSuccess: async () => {
      setMissingPhotos(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin', 'candidates'] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'overview'] }),
      ]);
    },
  });
  const summary = preview.data?.summary;
  const updates = preview.data?.updates ?? [];
  const hasUndecided = updates.some(({ code }) => decisions[code] === undefined);

  function changeTab(nextTab: CandidateTab) {
    const params = new URLSearchParams(searchParams);
    if (nextTab === 'manage') params.delete('tab');
    else params.set('tab', nextTab);
    setSearchParams(params, { replace: true });
  }

  return (
    <div className="admin-section">
      <h1>候選人</h1>
      <nav aria-label="候選人功能" className="admin-section-tabs">
        {candidateTabs.map(([tabId, label]) => (
          <button
            aria-current={tab === tabId ? 'page' : undefined}
            className={tab === tabId ? 'is-active' : undefined}
            key={tabId}
            onClick={() => changeTab(tabId)}
            type="button"
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === 'import' && (
        <>
          <h2>候選人 CSV 匯入</h2>
          <p className="admin-note">
            固定欄位為 code、contestId、name、partyId、ballotNo、status。code
            會成為候選人的永久識別碼，圖片請 commit 到
            <code> public/avatars/&#123;code&#125;.webp</code>
            。第一次匯入某選區會移除該區全部假候選人，因此 CSV
            必須包含該選區目前已知的完整正式名單。
          </p>
          <pre className="admin-csv-example">
            code,contestId,name,partyId,ballotNo,status{`\n`}
            TPE-MAYOR-001,TPE-EXECUTIVE-1,王小明,DPP,1,CONFIRMED
          </pre>
          <div className="admin-action-row">
            <button
              className="button button-ghost button-small"
              disabled={exportCsv.isPending}
              onClick={() => exportCsv.mutate()}
              type="button"
            >
              {exportCsv.isPending ? '匯出中…' : '匯出目前名單 CSV'}
            </button>
          </div>
          {exportCsv.isError && (
            <p className="admin-note admin-note-error">{errorMessage(exportCsv.error)}</p>
          )}
        </>
      )}

      {tab === 'settings' && (
        <section className="admin-visibility-setting">
          <label>
            <input
              checked={candidateVisibility.data?.hidePlaceholderCandidates ?? false}
              disabled={candidateVisibility.isPending || updateCandidateVisibility.isPending}
              onChange={(event) => updateCandidateVisibility.mutate(event.target.checked)}
              type="checkbox"
            />
            前台隱藏假候選人
          </label>
          <p className="admin-note">
            開啟後，ID 含 <code>-CANDIDATE-</code> 的佔位資料不會出現在前台選區、地圖、政黨與排行。
            {candidateVisibility.data
              ? `目前共有 ${candidateVisibility.data.placeholderCount.toLocaleString()} 位假候選人。`
              : ''}
          </p>
          {candidateVisibility.isError || updateCandidateVisibility.isError ? (
            <p className="admin-note admin-note-error">
              {errorMessage(candidateVisibility.error ?? updateCandidateVisibility.error)}
            </p>
          ) : updateCandidateVisibility.isSuccess ? (
            <p className="admin-note">設定已儲存。</p>
          ) : null}
        </section>
      )}

      {tab === 'contributions' && (
        <section className="admin-contribution-queue">
          <h2>待批准的候選人提案</h2>
          <p className="admin-note">
            批准會下載照片、裁成 512 × 512 WebP 並由瀏覽器下載；請將檔案放進{' '}
            <code>public/avatars/</code> 後 commit、部署。資料庫不保存圖片檔。
          </p>
          {contributions.isPending ? (
            <p className="admin-note">讀取提案…</p>
          ) : contributions.isError ? (
            <p className="admin-note admin-note-error">{errorMessage(contributions.error)}</p>
          ) : contributions.data.contributions.length === 0 ? (
            <p className="admin-note">目前沒有待批准提案。</p>
          ) : (
            <div className="admin-contribution-list">
              {contributions.data.contributions.map((contribution) => {
                const working = approveContribution.isPending || rejectContribution.isPending;
                const isApproving =
                  approveContribution.isPending &&
                  approveContribution.variables === contribution.id;
                const isRejecting =
                  rejectContribution.isPending && rejectContribution.variables === contribution.id;
                return (
                  <article className="admin-contribution" key={contribution.id}>
                    <div>
                      <strong>
                        {contribution.kind === 'NEW_CANDIDATE' ? '新增候選人' : '補充候選人照片'}
                      </strong>
                      <span>
                        {contribution.contestName} · {contribution.candidateName}
                      </span>
                      <small>
                        {contribution.partyId ?? '無黨籍'} ·{' '}
                        {contribution.forecaster.displayName ?? '預測者'}{' '}
                        {contribution.forecaster.code} ·{' '}
                        {new Date(contribution.createdAt).toLocaleString()}
                      </small>
                      <code>{contribution.candidateId}.webp</code>
                      <a href={contribution.photoUrl} rel="noreferrer" target="_blank">
                        開啟來源照片
                      </a>
                    </div>
                    <div className="admin-action-row">
                      <button
                        className="button button-dark button-small"
                        disabled={working}
                        onClick={() => approveContribution.mutate(contribution.id)}
                        type="button"
                      >
                        {isApproving ? '下載並轉檔中…' : '批准'}
                      </button>
                      <button
                        className="button button-ghost button-small"
                        disabled={working}
                        onClick={() => rejectContribution.mutate(contribution.id)}
                        type="button"
                      >
                        {isRejecting ? '處理中…' : '駁回'}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          {(approveContribution.isError || rejectContribution.isError) && (
            <p className="admin-note admin-note-error">
              {errorMessage(approveContribution.error ?? rejectContribution.error)}
            </p>
          )}
        </section>
      )}

      {tab === 'import' && (
        <>
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
                  <p className="admin-note">
                    相同 code 或同選區同名的資料必須逐筆確認；取消會保留資料庫原值。
                  </p>
                  <div className="admin-action-row">
                    <button
                      className="button button-dark button-small"
                      onClick={() =>
                        setDecisions(Object.fromEntries(updates.map(({ code }) => [code, true])))
                      }
                      type="button"
                    >
                      全部確認
                    </button>
                    <button
                      className="button button-ghost button-small"
                      onClick={() =>
                        setDecisions(Object.fromEntries(updates.map(({ code }) => [code, false])))
                      }
                      type="button"
                    >
                      全部取消
                    </button>
                  </div>
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
                            setDecisions((current) => ({
                              ...current,
                              [update.code]: true,
                            }))
                          }
                          type="button"
                        >
                          確認取代
                        </button>
                        <button
                          className={`button button-small ${decisions[update.code] === false ? 'button-dark' : 'button-ghost'}`}
                          onClick={() =>
                            setDecisions((current) => ({
                              ...current,
                              [update.code]: false,
                            }))
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
          {apply.isError && (
            <p className="admin-note admin-note-error">{errorMessage(apply.error)}</p>
          )}
          {apply.isSuccess && (
            <p className="admin-note">
              資料已寫入。圖片 commit 並重新部署後，所有執行個體都會載入新名單。
            </p>
          )}
        </>
      )}

      {tab === 'manage' && (
        <section className="admin-candidate-manager">
          <h2>候選人管理</h2>
          <p className="admin-note">
            候選人 ID
            與照片檔名不會因改名或改選區而變更。改選區或刪除會撤銷曾選到該候選人的有效預測。
          </p>
          <div className="admin-field">
            <label htmlFor="candidate-search">搜尋候選人</label>
            <input
              id="candidate-search"
              onChange={(event) => setCandidateSearch(event.target.value)}
              placeholder="輸入姓名、ID 或選區代號"
              type="search"
              value={candidateSearch}
            />
          </div>
          {candidates.isPending ? (
            <p className="admin-note">讀取候選人…</p>
          ) : candidates.isError ? (
            <p className="admin-note admin-note-error">{errorMessage(candidates.error)}</p>
          ) : (
            <div className="admin-candidate-grid">
              {candidates.data.candidates
                .filter((candidate) => {
                  const query = candidateSearch.trim().toLocaleLowerCase();
                  return (
                    !query ||
                    candidate.name.toLocaleLowerCase().includes(query) ||
                    candidate.id.toLocaleLowerCase().includes(query) ||
                    candidate.contestId.toLocaleLowerCase().includes(query) ||
                    candidate.contestName.toLocaleLowerCase().includes(query)
                  );
                })
                .slice(0, 100)
                .map((candidate) => {
                  const working = updateCandidate.isPending || deleteCandidate.isPending;
                  const party = parties.find(({ id }) => id === (candidate.partyId ?? 'IND'));
                  return (
                    <article className="admin-candidate-card" key={candidate.id}>
                      <div className="admin-candidate-avatar">
                        <span aria-hidden="true" />
                        {avatarUrl(candidate.id) && (
                          <img
                            alt={`${candidate.name}大頭照`}
                            onError={(event) => (event.currentTarget.hidden = true)}
                            src={avatarUrl(candidate.id) ?? undefined}
                          />
                        )}
                      </div>
                      <div className="admin-candidate-info">
                        <h3>{candidate.name}</h3>
                        <dl>
                          <div>
                            <dt>政黨</dt>
                            <dd>{party?.shortName ?? candidate.partyId ?? '無黨籍'}</dd>
                          </div>
                          <div>
                            <dt>職位</dt>
                            <dd>
                              {candidate.contestType
                                ? contestTypeLabels[candidate.contestType]
                                : '未知職位'}
                            </dd>
                          </div>
                          <div>
                            <dt>選區</dt>
                            <dd>{candidate.contestName}</dd>
                          </div>
                        </dl>
                        <code title={candidate.id}>{candidate.id}</code>
                      </div>
                      <div className="admin-action-row">
                        <button
                          className="button button-ghost button-small"
                          disabled={working}
                          onClick={() => {
                            const name = window.prompt('候選人姓名', candidate.name);
                            if (name === null) return;
                            const partyCode = window.prompt(
                              '政黨代號（無黨籍請填 IND）',
                              candidate.partyId ?? 'IND',
                            );
                            if (partyCode === null) return;
                            const contestId = window.prompt('選區代號', candidate.contestId);
                            if (contestId === null) return;
                            if (
                              contestId.trim() !== candidate.contestId &&
                              !window.confirm('改選區會撤銷曾選到此候選人的有效預測，確定繼續？')
                            )
                              return;
                            updateCandidate.mutate({
                              id: candidate.id,
                              name,
                              partyId:
                                partyCode.trim().toUpperCase() === 'IND'
                                  ? null
                                  : partyCode.trim().toUpperCase(),
                              contestId,
                            });
                          }}
                          type="button"
                        >
                          修改
                        </button>
                        <button
                          className="button button-ghost button-small"
                          disabled={working}
                          onClick={() => {
                            if (window.confirm(`確定刪除「${candidate.name}」？此動作無法復原。`))
                              deleteCandidate.mutate(candidate.id);
                          }}
                          type="button"
                        >
                          刪除
                        </button>
                      </div>
                    </article>
                  );
                })}
            </div>
          )}
          {(updateCandidate.isError || deleteCandidate.isError) && (
            <p className="admin-note admin-note-error">
              {errorMessage(updateCandidate.error ?? deleteCandidate.error)}
            </p>
          )}
        </section>
      )}

      {tab === 'photos' && (
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
      )}
    </div>
  );
}
