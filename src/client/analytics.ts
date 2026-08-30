import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * 量測的唯一入口。頁面只認得 track() 與 usePageViews()，不認得 GA 或 PostHog——
 * 兩家之後誰先拿到金鑰、誰被換掉，頁面都不用動。
 *
 * 金鑰還沒給的時候整個模組是空轉的：不載廠商的程式、不發任何請求、不印任何東西。
 */

// import.meta.env 在 build 時會被換成字面值，但這個模組會跟著頁面一起被伺服器端
// 渲染載進去，而伺服器是用 tsx 直接跑的，那裡沒有 import.meta.env，直接讀屬性會炸。
const buildEnv = import.meta.env ?? ({} as ImportMetaEnv);
const gaMeasurementId = buildEnv.VITE_GA_MEASUREMENT_ID ?? '';
const posthogKey = buildEnv.VITE_POSTHOG_KEY ?? '';
const posthogHost = buildEnv.VITE_POSTHOG_HOST ?? 'https://us.i.posthog.com';
const enabled = Boolean(gaMeasurementId || posthogKey);

/** 事件名一律 snake_case：GA4 只收得下這種，PostHog 兩種都收。 */
export type EventName =
  | 'forecast_sheet_opened'
  | 'forecast_submitted'
  | 'forecast_failed'
  | 'map_area_selected'
  | 'map_level_changed'
  | 'map_reset'
  | 'map_inspector_toggled'
  | 'map_contest_switched'
  | 'map_search_toggled'
  | 'contest_tab_changed'
  | 'comment_posted'
  | 'comment_failed'
  | 'report_submitted'
  | 'region_view_changed'
  | 'town_filter_changed'
  | 'identity_dialog_opened'
  | 'display_name_saved'
  | 'search_used'
  | 'announcement_shown'
  | 'announcement_dismissed';

type EventProps = Record<string, string | number | boolean | null | undefined>;
type Hit =
  | { kind: 'pageview'; path: string; title: string }
  | { kind: 'event'; name: EventName; props: EventProps };

let ga: typeof import('react-ga4').default | null = null;
let ph: typeof import('posthog-js').posthog | null = null;
let started = false;
let ready = false;
let loading = 0;
// 廠商是閒置時才載的，載完之前送出的事件先排隊。上限只是保險：正常情況排不到十筆，
// 排到五十筆表示出事了，寧可丟掉也不要讓佇列無限長。
const pending: Hit[] = [];
const pendingLimit = 50;

function whenIdle(run: () => void) {
  // 首頁一掛上就去抓好幾百 KB 的縣市圖（ElectionHomePage.tsx 的 loadCountyShapes），
  // 量測不該跟它搶頻寬。
  if (typeof window.requestIdleCallback === 'function')
    window.requestIdleCallback(run, { timeout: 4000 });
  else window.setTimeout(run, 2000);
}

function settle() {
  loading -= 1;
  if (loading > 0) return;
  ready = true;
  for (const hit of pending.splice(0)) deliver(hit);
}

function loadVendors() {
  if (gaMeasurementId) {
    loading += 1;
    void import('react-ga4')
      .then(({ default: reactGA }) => {
        reactGA.initialize(gaMeasurementId, {
          // 換頁一律由 usePageViews 發。不關掉 gtag 自己那一次，第一次載入會算兩份。
          gtagOptions: { send_page_view: false },
        });
        ga = reactGA;
      })
      // 量測載不起來是量測的事，不是使用者的事：安靜地不做，不要在 console 留東西。
      .catch(() => {})
      .finally(settle);
  }

  if (posthogKey) {
    loading += 1;
    void import('posthog-js')
      .then(({ posthog }) => {
        posthog.init(posthogKey, {
          api_host: posthogHost,
          // 這裡不設 SSR 相關的選項，因為不需要：整段 init 是在 hydration 完成之後
          // 的閒置時間才跑的（見 whenIdle），伺服器端那一輪根本不會走到這裡。
          // 村里層光是 role="button" 的 <path> 就有幾千個（ElectionHomePage.tsx 的
          // 村里 layer），autocapture 會把每一次點地圖都變成一筆高基數的雜訊事件，
          // 也會把留言框的 textContent 一起記走。要量什麼由下面的事件表決定。
          autocapture: false,
          capture_pageview: false,
          capture_pageleave: true,
          disable_session_recording: true,
          disable_surveys: true,
          // 這個站沒有登入，也刻意不建立認得出人的檔案。'never' 是硬保證：
          // 以後有人手滑寫了 identify() 也建不出來（見下方 privacy 決策）。
          person_profiles: 'never',
          // 身份 cookie 只有一個（vf_fid），不要為了量測再放一個。
          persistence: 'localStorage',
          respect_dnt: true,
          // 沒有用 feature flag、實驗與問卷，關掉可以省下每次載入的那一次 /flags 請求。
          advanced_disable_flags: true,
        });
        ph = posthog;
      })
      .catch(() => {})
      .finally(settle);
  }
}

function start() {
  if (started || !enabled || typeof window === 'undefined') return;
  started = true;
  whenIdle(loadVendors);
}

function deliver(hit: Hit) {
  if (hit.kind === 'pageview') {
    ga?.send({ hitType: 'pageview', page: hit.path, title: hit.title });
    // PostHog 自己從 DOM 讀 $current_url，這裡是 effect，網址已經換好了。
    ph?.capture('$pageview');
    return;
  }
  ga?.event(hit.name, hit.props);
  ph?.capture(hit.name, hit.props);
}

function dispatch(hit: Hit) {
  if (!enabled || typeof window === 'undefined') return;
  start();
  if (!ready) {
    if (pending.length < pendingLimit) pending.push(hit);
    return;
  }
  deliver(hit);
}

export function track(name: EventName, props: EventProps = {}) {
  dispatch({ kind: 'event', name, props });
}

// 後台是同一個人在用，混進漏斗只會拉低每一個轉換率——不算數的雜訊，直接不送。
function isAdminPath(pathname: string) {
  return pathname.startsWith('/admin');
}

// 同一個路徑不重送。兩件事靠它：React 19 的 StrictMode 會把 effect 跑兩次，而
// 分頁與鄉鎮的切換走的是 setSearchParams(..., { replace: true })（ContestPage、
// JurisdictionPage 都是），那些是事件不是換頁，不該灌進 page view。
let lastPath = '';

export function usePageViews() {
  const { pathname, search } = useLocation();
  useEffect(() => {
    // effect 不在伺服器端跑，所以 SSR 那一輪什麼都不會發生；這裡第一次執行就是
    // hydration 之後，第一個 page view 剛好只有一次。
    if (pathname === lastPath) return;
    lastPath = pathname;
    if (isAdminPath(pathname)) return;
    dispatch({ kind: 'pageview', path: pathname + search, title: document.title });
  }, [pathname, search]);
}
