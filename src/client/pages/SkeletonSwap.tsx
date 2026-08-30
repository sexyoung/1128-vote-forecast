import { type ReactNode, useEffect, useRef, useState } from 'react';

// 從 JurisdictionPage 的骨架狀態機抽出來，PartiesPage 的三個內層畫面
// （政黨一覽、行政區清單、候選人清單）都要用同一套，不重寫三次。
// JurisdictionPage 本身先不改用這個檔案，避免跟同時在改那個檔案的另一個改動撞在一起。
type SkeletonPhase = 'loading' | 'resetting' | 'revealed';

// resetKey 變動代表「換了一批要載的東西」（換政黨、換分頁、換行政區……）。
// 這時不能讓 CSS 直接從 revealed 淡回骨架再淡出，那樣兩段動畫接在一起會
// 往回播、很突兀；所以先無動畫地退回骨架（resetting，關掉 transition），
// 下一個 frame 才進 loading、恢復 transition，讓新一輪的淡出正常播放。
export function useSkeletonSwap(pending: boolean, resetKey: unknown = null) {
  // 初始相位直接看「現在有沒有資料」。這一頁的資料多半在 SSR 就 seed 進 query
  // cache 了（見 src/server/html.ts），第一次 render 的 pending 就是 false——
  // 那種情況一格骨架都不該出現。只有真的在等，才從 loading 開始。
  const [phase, setPhase] = useState<SkeletonPhase>(pending ? 'loading' : 'revealed');
  const skeletonRef = useRef<HTMLDivElement>(null);
  const resetFrameRef = useRef<number | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    // 掛載那一次不算「切換」，第一次載入本來就會是骨架，不必跑重置動畫。
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    // 換到已經讀過的資料時什麼都不做。TanStack Query 命中快取的那一輪 pending
    // 直接就是 false，沒有任何東西要等；照樣跑重置的話，會把已經有資料的畫面
    // 退回骨架再等滿一個 --pulse-dur 才揭露——使用者看到的是讀過的頁面莫名其妙
    // 又閃一次骨架。骨架是給「還沒有資料」用的。
    if (!pending) return;
    setPhase('resetting');
    if (resetFrameRef.current !== null) cancelAnimationFrame(resetFrameRef.current);
    resetFrameRef.current = requestAnimationFrame(() => {
      setPhase('loading');
      resetFrameRef.current = null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  // 這是整個機制的不變式：相位只有在「真的在等」的時候才離開 revealed。
  // 少了這一條，任何把相位推去 loading 的路徑（resetKey 改變、StrictMode 在開發
  // 模式下把 effect 跑第二次）都會讓已經有資料的畫面莫名其妙退回骨架。
  useEffect(() => {
    if (pending) setPhase((current) => (current === 'revealed' ? 'loading' : current));
  }, [pending]);

  useEffect(() => {
    // 資料還沒到就不急著算揭露時間；等資料到了，骨架至少要脈動完一輪，
    // 不然資料秒到時畫面只是閃一下，使用者根本看不到骨架在做什麼。
    if (phase !== 'loading' || pending) return;
    const root = skeletonRef.current;
    const styles = getComputedStyle(root ?? document.documentElement);
    const duration = Number.parseFloat(styles.getPropertyValue('--pulse-dur')) || 1000;
    const count = Number.parseFloat(styles.getPropertyValue('--pulse-count')) || 1;
    const timer = window.setTimeout(() => setPhase('revealed'), duration * count);
    return () => window.clearTimeout(timer);
  }, [phase, pending]);

  useEffect(
    () => () => {
      if (resetFrameRef.current !== null) cancelAnimationFrame(resetFrameRef.current);
    },
    [],
  );

  const loading = phase !== 'revealed' || pending;
  const swapState = phase === 'resetting' ? 'is-resetting' : loading ? '' : 'is-revealed';
  return { loading, swapState, skeletonRef };
}

// t-skel 兩層（骨架／內容）的通用外殼。wrapperClassName 預設用
// skel-grid-swap：兩層疊在同一個 grid 儲存格，容器高度跟著較高的那層走，
// 不必事先知道內容高度（跟 JurisdictionPage 的 region-contest-swap 同一招）。
export function SkeletonSwap({
  pending,
  resetKey,
  wrapperClassName = 'skel-grid-swap',
  skeletonClassName = '',
  skeleton,
  children,
}: {
  pending: boolean;
  resetKey?: unknown;
  wrapperClassName?: string;
  skeletonClassName?: string;
  skeleton: ReactNode;
  children: ReactNode;
}) {
  const { loading, swapState, skeletonRef } = useSkeletonSwap(pending, resetKey);
  return (
    <div
      aria-busy={loading}
      className={`t-skel ${wrapperClassName} ${swapState}`.trim()}
      ref={skeletonRef}
    >
      <div
        aria-hidden="true"
        className={`${skeletonClassName} t-skel-skeleton ${loading ? 'is-pulsing' : ''}`.trim()}
      >
        {skeleton}
      </div>
      <div aria-hidden={loading} className="t-skel-content">
        {children}
      </div>
    </div>
  );
}
