import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError } from '../api';
import { blockForecaster, getAdminForecasters, unblockForecaster } from './api';
import { inferredLocation } from './location';

function dateTime(value: string) {
  return new Date(value).toLocaleString('zh-TW');
}

export function ForecastersPage() {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const requestedPage = Number.parseInt(searchParams.get('page') ?? '1', 10);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const forecasters = useQuery({
    queryKey: ['admin', 'forecasters', page],
    queryFn: () => getAdminForecasters(page),
  });
  const data = forecasters.data;
  const block = useMutation({
    mutationFn: ({ id, blocked }: { id: string; blocked: boolean }) =>
      blocked ? unblockForecaster(id) : blockForecaster(id),
    onSuccess: async (_, { id }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin', 'forecasters'] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'forecaster', id] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'reports'] }),
      ]);
    },
  });

  return (
    <section className="admin-section">
      <h1>預測使用者</h1>
      <p className="admin-note">
        {data ? `共 ${data.total.toLocaleString()} 位，每頁 ${data.pageSize} 筆。` : '載入中…'}
      </p>
      {block.isError && (
        <p className="admin-note admin-note-error">
          {block.error instanceof ApiError ? block.error.message : '封鎖操作失敗。'}
        </p>
      )}

      {forecasters.isError ? (
        <p className="admin-note admin-note-error">使用者清單載入失敗。</p>
      ) : data?.items.length === 0 ? (
        <p className="admin-note">這一頁沒有使用者。</p>
      ) : data ? (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>顯示名稱</th>
                <th>身份編號</th>
                <th>預測數</th>
                <th>留言數</th>
                <th>最近 IP</th>
                <th>推測位置</th>
                <th>狀態</th>
                <th>建立時間</th>
                <th>最近活動</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((forecaster) => (
                <tr key={forecaster.id}>
                  <td>
                    <Link to={`/admin/forecasters/${forecaster.id}`}>
                      {forecaster.displayName ?? '預測者'}
                    </Link>
                  </td>
                  <td title={forecaster.id}>
                    <Link to={`/admin/forecasters/${forecaster.id}`}>{forecaster.code}</Link>
                  </td>
                  <td>{forecaster.predictionCount.toLocaleString()}</td>
                  <td>{forecaster.commentCount.toLocaleString()}</td>
                  <td>{forecaster.lastIp ?? '—'}</td>
                  <td>{inferredLocation(forecaster)}</td>
                  <td>{forecaster.blockedAt ? '已封鎖' : '正常'}</td>
                  <td>{dateTime(forecaster.createdAt)}</td>
                  <td>{dateTime(forecaster.lastSeenAt)}</td>
                  <td>
                    <button
                      className="button button-ghost button-small"
                      disabled={block.isPending && block.variables?.id === forecaster.id}
                      onClick={() =>
                        block.mutate({ id: forecaster.id, blocked: Boolean(forecaster.blockedAt) })
                      }
                      type="button"
                    >
                      {block.isPending && block.variables?.id === forecaster.id
                        ? '處理中…'
                        : forecaster.blockedAt
                          ? '解除封鎖'
                          : '封鎖'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {data && data.totalPages > 1 && (
        <nav aria-label="預測使用者分頁" className="admin-pagination">
          {data.page > 1 && <Link to={`?page=${data.page - 1}`}>上一頁</Link>}
          <span>
            第 {data.page} / {data.totalPages} 頁
          </span>
          {data.page < data.totalPages && <Link to={`?page=${data.page + 1}`}>下一頁</Link>}
        </nav>
      )}
    </section>
  );
}
