import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../api';
import {
  type AdminForecasterSort,
  type SortDirection,
  blockForecaster,
  getAdminForecasters,
  unblockForecaster,
} from './api';
import { inferredLocation } from './location';

const sortLabels: Record<AdminForecasterSort, string> = {
  predictionCount: '預測數',
  commentCount: '留言數',
  lastIp: '最近 IP',
  lastLocation: '推測位置',
  status: '狀態',
  createdAt: '建立時間',
  lastSeenAt: '最近活動',
};

const defaultDirections: Record<AdminForecasterSort, SortDirection> = {
  predictionCount: 'desc',
  commentCount: 'desc',
  lastIp: 'asc',
  lastLocation: 'asc',
  status: 'asc',
  createdAt: 'desc',
  lastSeenAt: 'desc',
};

function shortDateTime(value: string) {
  return new Intl.DateTimeFormat('zh-TW', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function humanizedActivity(value: string) {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  if (elapsed < 60_000) return '剛剛';
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} 分鐘前`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} 小時前`;
  return shortDateTime(value);
}

function SortHeader({
  sortKey,
  sort,
  direction,
  onSort,
}: {
  sortKey: AdminForecasterSort;
  sort: AdminForecasterSort;
  direction: SortDirection;
  onSort: (sort: AdminForecasterSort) => void;
}) {
  const active = sort === sortKey;
  return (
    <th aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        aria-pressed={active}
        className="admin-sort-button"
        onClick={() => onSort(sortKey)}
        type="button"
      >
        {sortLabels[sortKey]} {active ? (direction === 'asc' ? '↑' : '↓') : '↕'}
      </button>
    </th>
  );
}

export function ForecastersPage() {
  const queryClient = useQueryClient();
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const [sort, setSort] = useState<AdminForecasterSort>('lastSeenAt');
  const [direction, setDirection] = useState<SortDirection>('desc');
  const forecasters = useInfiniteQuery({
    queryKey: ['admin', 'forecasters', sort, direction],
    queryFn: ({ pageParam }) => getAdminForecasters(pageParam, sort, direction),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined,
  });
  const data = forecasters.data;
  const items = data?.pages.flatMap((page) => page.items) ?? [];
  const total = data?.pages[0]?.total;
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = forecasters;
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

  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || !hasNextPage) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !isFetchingNextPage) void fetchNextPage();
      },
      { rootMargin: '320px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  function changeSort(nextSort: AdminForecasterSort) {
    if (nextSort === sort) setDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
    else {
      setSort(nextSort);
      setDirection(defaultDirections[nextSort]);
    }
  }

  return (
    <section className="admin-section">
      <h1>預測使用者</h1>
      <p className="admin-note">
        {total === undefined
          ? '載入中…'
          : `共 ${total.toLocaleString()} 位，已載入 ${items.length.toLocaleString()} 位。`}
      </p>
      {block.isError && (
        <p className="admin-note admin-note-error">
          {block.error instanceof ApiError ? block.error.message : '封鎖操作失敗。'}
        </p>
      )}

      {forecasters.isError ? (
        <p className="admin-note admin-note-error">使用者清單載入失敗。</p>
      ) : items.length === 0 && !forecasters.isPending ? (
        <p className="admin-note">目前沒有使用者。</p>
      ) : items.length > 0 ? (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>顯示名稱</th>
                <th>身份編號</th>
                <SortHeader
                  direction={direction}
                  onSort={changeSort}
                  sort={sort}
                  sortKey="predictionCount"
                />
                <SortHeader
                  direction={direction}
                  onSort={changeSort}
                  sort={sort}
                  sortKey="commentCount"
                />
                <SortHeader
                  direction={direction}
                  onSort={changeSort}
                  sort={sort}
                  sortKey="lastIp"
                />
                <SortHeader
                  direction={direction}
                  onSort={changeSort}
                  sort={sort}
                  sortKey="lastLocation"
                />
                <SortHeader
                  direction={direction}
                  onSort={changeSort}
                  sort={sort}
                  sortKey="status"
                />
                <th>最新投給誰</th>
                <SortHeader
                  direction={direction}
                  onSort={changeSort}
                  sort={sort}
                  sortKey="createdAt"
                />
                <SortHeader
                  direction={direction}
                  onSort={changeSort}
                  sort={sort}
                  sortKey="lastSeenAt"
                />
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((forecaster) => (
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
                  <td title={forecaster.latestVote?.contestId}>
                    {forecaster.latestVote?.labels.join('、') || '—'}
                  </td>
                  <td title={new Date(forecaster.createdAt).toLocaleString('zh-TW')}>
                    {shortDateTime(forecaster.createdAt)}
                  </td>
                  <td title={new Date(forecaster.lastSeenAt).toLocaleString('zh-TW')}>
                    {humanizedActivity(forecaster.lastSeenAt)}
                  </td>
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

      <div aria-live="polite" className="admin-infinite-status" ref={loadMoreRef}>
        {forecasters.isPending || forecasters.isFetchingNextPage
          ? '載入更多使用者…'
          : hasNextPage
            ? '往下捲動以載入更多'
            : total
              ? '已載入全部使用者。'
              : null}
      </div>
    </section>
  );
}
