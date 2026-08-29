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
  const [phase, setPhase] = useState<SkeletonPhase>('revealed');
  const skeletonRef = useRef<HTMLDivElement>(null);
  const resetFrameRef = useRef<number | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    // 掛載那一次不算「切換」，第一次載入本來就會是骨架，不必跑重置動畫。
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    setPhase('resetting');
    if (resetFrameRef.current !== null) cancelAnimationFrame(resetFrameRef.current);
    resetFrameRef.current = requestAnimationFrame(() => {
      setPhase('loading');
      resetFrameRef.current = null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

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
