import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { getAdminForecasters } from './api';

function dateTime(value: string) {
  return new Date(value).toLocaleString('zh-TW');
}

export function ForecastersPage() {
  const [searchParams] = useSearchParams();
  const requestedPage = Number.parseInt(searchParams.get('page') ?? '1', 10);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const forecasters = useQuery({
    queryKey: ['admin', 'forecasters', page],
    queryFn: () => getAdminForecasters(page),
  });
  const data = forecasters.data;

  return (
    <section className="admin-section">
      <h1>預測使用者</h1>
      <p className="admin-note">
        {data ? `共 ${data.total.toLocaleString()} 位，每頁 ${data.pageSize} 筆。` : '載入中…'}
      </p>

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
                <th>狀態</th>
                <th>建立時間</th>
                <th>最近活動</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((forecaster) => (
                <tr key={forecaster.id}>
                  <td>{forecaster.displayName ?? '預測者'}</td>
                  <td title={forecaster.id}>{forecaster.code}</td>
                  <td>{forecaster.predictionCount.toLocaleString()}</td>
                  <td>{forecaster.blockedAt ? '已封鎖' : '正常'}</td>
                  <td>{dateTime(forecaster.createdAt)}</td>
                  <td>{dateTime(forecaster.lastSeenAt)}</td>
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
