import { useWindowVirtualizer } from '@tanstack/react-virtual';
import {
  type CSSProperties,
  type ReactElement,
  type RefCallback,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

const mobileQuery = '(max-width: 720px)';
const useIsomorphicLayoutEffect = typeof document === 'undefined' ? useEffect : useLayoutEffect;

function subscribeToMobile(change: () => void) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const query = window.matchMedia(mobileQuery);
  query.addEventListener('change', change);
  return () => query.removeEventListener('change', change);
}

function isMobile() {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.(mobileQuery).matches);
}

/**
 * SSR 先輸出完整清單，確保搜尋引擎、無 JS 與 hydration 都有完整內容；hydration 後
 * 手機改成真正的 window virtualization。之後從底部選單切頁時，一開始就只建立
 * 可見項目與 overscan，不會先把整頁 DOM 做完再隱藏。
 */
function useMobileViewport() {
  return useSyncExternalStore(subscribeToMobile, isMobile, () => false);
}

export type VirtualItemProps = {
  'data-index': number;
  ref: RefCallback<HTMLElement>;
  style: CSSProperties;
};

export function VirtualWindowList<T>({
  as = 'div',
  className,
  estimateSize,
  gap = 12,
  getKey,
  items,
  minimum = 12,
  renderItem,
}: {
  as?: 'div' | 'ol';
  className: string;
  estimateSize: number;
  gap?: number;
  getKey: (item: T) => string | number;
  items: readonly T[];
  minimum?: number;
  renderItem: (item: T, index: number, virtual: VirtualItemProps | null) => ReactElement;
}) {
  const mobile = useMobileViewport();
  const enabled = mobile && items.length >= minimum;
  const listRef = useRef<HTMLElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  const getItemKey = useCallback((index: number) => getKey(items[index]), [getKey, items]);
  const virtualizer = useWindowVirtualizer<HTMLElement>({
    count: items.length,
    enabled,
    estimateSize: () => estimateSize,
    gap,
    getItemKey,
    // 跨頁時不要以舊頁的 window.scrollY 當成新清單初始位置；全站換頁一律回頂。
    initialOffset: 0,
    overscan: 4,
    scrollMargin,
    // React 19 在生命週期內 flushSync 會警告；這種一般清單允許 React 批次更新。
    useFlushSync: false,
  });

  useIsomorphicLayoutEffect(() => {
    if (!enabled) return;
    const updateMargin = () => {
      const list = listRef.current;
      if (list) setScrollMargin(list.getBoundingClientRect().top + window.scrollY);
    };
    updateMargin();
    window.addEventListener('resize', updateMargin);
    return () => window.removeEventListener('resize', updateMargin);
  }, [enabled]);

  if (!enabled) {
    const children = items.map((item, index) => renderItem(item, index, null));
    return as === 'ol' ? (
      <ol className={className}>{children}</ol>
    ) : (
      <div className={className}>{children}</div>
    );
  }

  const children = virtualizer.getVirtualItems().map((virtualItem) =>
    renderItem(items[virtualItem.index], virtualItem.index, {
      'data-index': virtualItem.index,
      ref: virtualizer.measureElement,
      style: {
        left: 0,
        position: 'absolute',
        top: virtualItem.start - scrollMargin,
        width: '100%',
      },
    }),
  );
  const style = { height: virtualizer.getTotalSize(), position: 'relative' } as const;
  const virtualClassName = `${className} virtual-window-list`;

  return as === 'ol' ? (
    <ol
      className={virtualClassName}
      ref={(node) => {
        listRef.current = node;
      }}
      style={style}
    >
      {children}
    </ol>
  ) : (
    <div
      className={virtualClassName}
      ref={(node) => {
        listRef.current = node;
      }}
      style={style}
    >
      {children}
    </div>
  );
}
