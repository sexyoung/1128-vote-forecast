# D. react-ga4 + PostHog

> 2026-08-28 設計 workflow 的產物，未經獨立審查。
> 注意：這份設計是對照**當時**的頁面寫的，之後新增了 CandidateRankingsPage、
> PartiesPage、NotFoundPage，而且已經改成 SSR（entry-client/entry-server）。
> 事件清單的 file:line 要自己重新對照現在的程式碼。

---

## packages

RECOMMENDATION: use `react-ga4@3.0.1`, NOT `react-ga`. This is a deviation from what the user named by hand, and the user must be told.

EVIDENCE (run in this repo, npm registry reachable):

- `npm view react-ga version time.modified time.created` -> version = '3.3.1', time.modified = '2022-06-25T22:21:52.805Z', time.created = '2015-03-30T14:00:19.222Z'. Last publish is over four years old (today is 2026-08-28). It is NOT formally deprecated (`npm view react-ga deprecated` returns nothing), it is just abandoned.
- `npm view react-ga4 version time.modified` -> version = '3.0.1', time.modified = '2026-03-24T22:19:46.194Z'. Five months old, actively maintained.
- `npm view posthog-js version time.modified` -> version = '1.422.2', time.modified = '2026-08-28T10:53:35.638Z'. Published today.

WHY react-ga cannot work at all, not merely "old": I unpacked the tarball. Its own README says "It is designed to work with Universal Analytics and will not support the older ga.js implementation", its package.json keywords list "Universal Analytics", and `package/dist/esm/utils/loadGA.js` hardcodes `var gaAddress = 'https://www.google-analytics.com/analytics.js'` and installs the `window.ga` command queue. Universal Analytics properties stopped processing data in 2023; a GA4 measurement ID (`G-XXXXXXXXXX`) is not a UA property ID (`UA-XXXXXXX-X`) and analytics.js will not accept it. Wiring react-ga to the ID the user is about to supply would produce a page that loads a dead script and reports zero data. There is no configuration that fixes this.

WHAT react-ga4 IS: a thin, zero-dependency wrapper over gtag.js. Package facts from the 3.0.1 tarball: `"type": "module"`, ESM-only (`exports: { ".": "./dist/index.mjs" }`), ships its own `.d.mts` types, no runtime dependencies. Measured: `dist/index.mjs` is 10,402 bytes raw / 3,178 bytes gzipped. It is small enough that the alternative — writing the ~30 lines of gtag bootstrap by hand and skipping the dependency — is also defensible; I recommend the package only because it gets the `gtag('js', new Date())` / `gtag('config', id)` ordering and the pre-init queue right for free, and because the user asked for a react-ga-shaped thing.

PostHog: `posthog-js@1.422.2`. Do NOT add `posthog-js/react` — its `PostHogProvider` / `usePostHog` exist to leak the vendor into component code, which is exactly what the single-module design forbids here. Import the bare SDK inside the analytics module only.

Bundle cost, measured from the tarballs (raw / gzip):

- `posthog-js/dist/module.js` (the default entry): 273,177 / 87,804 bytes.
- `posthog-js/dist/module.slim.js`: 133,228 / 45,371 bytes.
  Because both vendors are loaded with a dynamic `import()` inside an effect, neither lands in the entry chunk; the PostHog chunk is emitted into `dist/` but is never requested while `VITE_POSTHOG_KEY` is empty. Follow-up worth considering once the key arrives: since this design disables autocapture, session recording and surveys, the slim build would save ~42 KB gzip. I am NOT recommending it for the first cut: `posthog-js` publishes no `exports` map (verified: the field is absent from package.json), so `posthog-js/dist/module.slim.js` is an undocumented deep path that can move on any minor release. Take it later, deliberately, with a pinned version.

## initialization

Single module, path `src/client/analytics.ts` — matches the existing flat client-module convention (`src/client/api.ts`, `src/client/fingerprint.ts`, `src/client/search.ts`). It exports exactly two things to the rest of the app: `track(name, props)` and `usePageViews()`. No page ever imports `react-ga4` or `posthog-js`.

=== src/client/analytics.ts (new file) ===

```ts
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
  | 'region_view_changed'
  | 'town_filter_changed'
  | 'identity_dialog_opened'
  | 'display_name_saved'
  | 'search_used';

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
  // 首頁一掛上就去抓 468 KB 的縣市圖（ElectionHomePage.tsx:606），量測不該跟它搶頻寬。
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
          // 這組日期同時把 external_scripts_inject_target 設成 'head'，官方型別註記
          // 寫明那是為了避開 SSR 的 hydration 錯誤，這個站正好要 SSR。
          defaults: '2026-08-30',
          // 村里層光是 role="button" 的 <path> 就有幾千個（ElectionHomePage.tsx:1385），
          // autocapture 會把每一次點地圖都變成一筆高基數的雜訊事件。要量什麼由事件表決定。
          autocapture: false,
          capture_pageview: false,
          capture_pageleave: true,
          disable_session_recording: true,
          disable_surveys: true,
          // 這個站沒有登入，也刻意不建立認得出人的檔案。'never' 是硬保證：
          // 以後有人手滑寫了 identify() 也建不出來。
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

// 同一個路徑不重送。兩件事靠它：React 19 的 StrictMode 會把 effect 跑兩次，而
// 分頁與鄉鎮的切換走的是 setSearchParams(..., { replace: true })（ContestPage.tsx:246、
// JurisdictionPage.tsx:253），那些是事件不是換頁，不該灌進 page view。
let lastPath = '';

export function usePageViews() {
  const { pathname, search } = useLocation();
  useEffect(() => {
    // effect 不在伺服器端跑，所以 SSR 那一輪什麼都不會發生；這裡第一次執行就是
    // hydration 之後，第一個 page view 剛好只有一次。
    if (pathname === lastPath) return;
    lastPath = pathname;
    dispatch({ kind: 'pageview', path: pathname + search, title: document.title });
  }, [pathname, search]);
}
```

=== src/client/App.tsx (modify — the only wiring the router needs) ===

```tsx
import { Route, Routes } from 'react-router-dom';
import { usePageViews } from './analytics';
import { ContestPage } from './pages/ContestPage';
// …其餘 import 不變

export function App() {
  usePageViews();
  return <Routes>{/* 不變 */}</Routes>;
}
```

App is rendered inside `BrowserRouter` today (src/client/main.tsx:31) and will be inside the server router after the SSR conversion; `useLocation()` works under both, and the effect only ever runs in the browser. `src/client/main.tsx` needs no change at all, which is deliberate: that file is being rewritten by the SSR agent and I do not want to collide with it.

=== src/client/vite-env.d.ts (modify) ===

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GA_MEASUREMENT_ID?: string;
  readonly VITE_POSTHOG_KEY?: string;
  readonly VITE_POSTHOG_HOST?: string;
}
```

=== example call site, src/client/pages/ContestPage.tsx (modify) ===

```tsx
// 分頁寫在網址上，但那是 replace 的，不算換頁；要知道有沒有人看趨勢與留言只能靠這裡。
const setActiveTab = (tab: ContestTab) => {
  track('contest_tab_changed', { contest_id: contest.id, contest_type: contest.view, tab });
  setSearchParams(/* 不變 */);
};
```

## pageViews

MECHANISM: `usePageViews()` (in `src/client/analytics.ts`) calls `useLocation()` and fires from a `useEffect`. It is called once, from `App()` in src/client/App.tsx:8. Nothing else in the app fires page views.

WHY A HOOK IN App AND NOT A LISTENER: react-router-dom 7 has no imperative "history changed" subscription that survives the `BrowserRouter` -> server-router swap the SSR agent is making. `useLocation()` is the one API that reads correctly under `BrowserRouter`, under the server router during `renderToString`, and under hydration. Putting it in `App` also means the SSR agent can rewrite `main.tsx` freely without touching analytics.

DEDUPE KEY IS `pathname`, NOT the full URL. This is the single most important decision here, and it is forced by real code:

- src/client/pages/ContestPage.tsx:239-247 — `setActiveTab` writes `?tab=` with `{ replace: true }`.
- src/client/pages/JurisdictionPage.tsx:249-254 — `updateParams` writes `?view=` and `?town=` with `{ replace: true }`.
  Three of the five routes mutate their own query string as ordinary in-page interaction. Keying page views on the full URL would turn every tab click and every 鄉鎮 pill into a page view and wreck both the GA "Pages and screens" report and PostHog's pageview counts. Those interactions are events (`contest_tab_changed`, `region_view_changed`, `town_filter_changed`), not navigations. The effect's dependency array still includes `search` so the URL sent is current at fire time; the `pathname === lastPath` guard makes the extra runs no-ops.

FIRST VIEW FIRES EXACTLY ONCE AFTER HYDRATION:

- During `renderToString` on the server, effects do not run. Zero page views are emitted server-side.
- On the client, `hydrateRoot` runs the effect once after commit. That IS the first page view — there is no separate "initial pageview" call to double up with.
- React 19 StrictMode (src/client/main.tsx:29 today) double-invokes effects in dev. The module-level `lastPath` absorbs the second invocation.
- Both vendors are configured to NOT send their own initial view: react-ga4 gets `gtagOptions: { send_page_view: false }` (verified against the tarball: `initialize` merges `gtagOptions` into the `gtag('config', id, …)` call, src/ga4.ts:196-205), and PostHog gets `capture_pageview: false`. Without both of those, the first load produces two GA hits and two PostHog `$pageview`s.
- Note that PostHog's `defaults: '2026-08-30'` implies `capture_pageview: 'history_change'` (verified in @posthog/types posthog-config.d.ts:1219), which would fire on every `replace:true` query change described above. The explicit `capture_pageview: false` override is not optional.

BACK/FORWARD: a POP to a different path changes `pathname` and fires. A POP that returns to the same path you are already on cannot happen. A→B→back-to-A fires, because `lastPath` was B at that moment.

WHAT GETS SENT:

- GA4: `ReactGA.send({ hitType: 'pageview', page, title })`. Verified against react-ga4 3.0.1 source: `_gaCommandSendPageview` (src/ga4.ts:299) emits `gtag('event','page_view',{ page_path, page_title })`; unknown keys pass through `_toGtagOptions` unchanged (src/ga4.ts:138-149), so `title` really does become `page_title`.
- PostHog: `posthog.capture('$pageview')` with no properties. PostHog reads `$current_url` from the DOM at capture time, and the effect runs after react-router has already updated `window.location`.
- `document.title` is read at fire time, so the per-page `<title>` the SSR agent is adding is what lands in GA. One ordering caveat worth handing to that agent: if per-page titles end up being set client-side (a `useEffect` in each page) rather than server-rendered into the HTML, the analytics effect in `App` may run before the page's own title effect and record the previous title. Server-rendered `<title>` has no such race — another reason for that track to render titles on the server rather than patch them after mount.

## events

**1.**

- **name**: forecast_submitted
- **trigger**: 預測送出成功。這是整個站唯一的轉換事件——其他所有事件存在的目的都是為了解釋這一個的分子與分母。
- **location**: src/client/pages/ForecastSheet.tsx:99 (submit mutation onSuccess)
- **properties**: contest_id, contest_type (detail.data.contest.type), jurisdiction_id (detail.data.contest.jurisdictionId), seats (detail.data.contest.seats), seats_source ('OFFICIAL'|'PLACEHOLDER'，ForecastSheet.tsx:153 已經在用它改文案), picks (selected.length), is_update (送出前先算 Boolean(detail.data?.mine)，onSuccess 時 detail 已被 invalidate，當場再讀會永遠是 true), surface ('contest_page'|'map_inspector')。surface 需要在 ForecastForm 的 props 加一個欄位：同一個表單掛在兩處，ContestPage.tsx:322 走 ForecastSheet，ElectionHomePage.tsx:388 直接掛在地圖抽屜裡，不分開就分不出地圖上的預測佔多少。

**2.**

- **name**: forecast_failed
- **trigger**: 預測送不出去。跟 forecast_submitted 是一對，沒有它就不知道漏斗末端掉的是興趣還是錯誤。
- **location**: src/client/pages/ForecastSheet.tsx:111 (submit mutation onError)
- **properties**: contest_id, status (ApiError.status), needs_turnstile (ApiError.needsTurnstile, api.ts:75), surface。不要送 failure.message：那是給人看的中文字串，會變成高基數的維度。

**3.**

- **name**: forecast_sheet_opened
- **trigger**: 按下「送出預測／修改預測」按鈕，表單打開。forecast_submitted 的分母。
- **location**: src/client/pages/ContestPage.tsx:313 (ForecastButton onClick) 與 src/client/pages/ElectionHomePage.tsx:1456 (onForecast)，按鈕本體在 src/client/pages/ElectionPrototypeShared.tsx:343
- **properties**: contest_id, contest_type, jurisdiction_id, seats, surface, is_update (地圖那一側已經有現成的旗標：ElectionHomePage.tsx:512 傳 editing={Boolean(detail.data?.mine)})

**4.**

- **name**: map_area_selected
- **trigger**: 在地圖上點一個區域。四種層級合成一個事件，用 level 分；拆成四個事件只會讓 GA 的報表多三列而分析時還要相加。
- **location**: 縣市 src/client/pages/ElectionHomePage.tsx:1272 (→ selectJurisdictionFromMap, :788)；離島標籤 :1429；鄉鎮市區 :1316；議員選區的村里 :1351；村里 :1393
- **properties**: level ('county'|'township'|'council_village'|'village'), jurisdiction_id, contest_id, contest_type (contest.view), town_code (township/village 兩層有，取 township.townCode／village.townCode), source ('county_path'|'island_inset'，只有 county 層需要——離島是浮動標籤按鈕，跟點圖不是同一件事)

**5.**

- **name**: map_level_changed
- **trigger**: 地圖層級改變（全臺→鄉鎮市區→村里）。這是「地圖到底有沒有人往下鑽」的唯一指標。
- **location**: src/client/pages/ElectionHomePage.tsx:765-774 (mapLevelView 是推導值)。不要去改那五個 setDetailMode 的呼叫點（:800、:863、:913、:942、:1181）——層級是從 villageMode／selectedVillageId／detailMode 推出來的，逐一插入必然漏掉滾輪那條路。正確作法是加一個 useEffect 盯著 mapLevelView，用 ref 記住上一個值，不同才發。
- **properties**: level (mapLevelView), previous_level, jurisdiction_id (selectedJurisdiction?.id ?? null), trigger ('zoom'|'select')

**6.**

- **name**: map_reset
- **trigger**: 按「‹ 回到全臺」。放大之後找不到路回去是這張地圖最可能的挫折點，退出率要量。
- **location**: src/client/pages/ElectionHomePage.tsx:1240 (onClick → resetMap, :1191)
- **properties**: from_level (當下的 mapLevelView), jurisdiction_id

**7.**

- **name**: map_inspector_toggled
- **trigger**: 手機把地圖抽屜拉開／收起。整個窄畫面的資訊都在這個抽屜裡，它有沒有被打開直接決定手機使用者看不看得到分布。
- **location**: 展開 src/client/pages/ElectionHomePage.tsx:436 (map-peek onClick)；收合 :399 (map-inspector-dismiss)
- **properties**: expanded (true|false), contest_id, contest_type

**8.**

- **name**: map_contest_switched
- **trigger**: 在抽屜頂端切換同一個區域的不同選舉（宜蘭第九選區同時有議員／鄉鎮市長／代表）。這個切換器是刻意排在摘要前面的（見 ElectionHomePage.tsx:412 的註解），有沒有人用得起來要驗。
- **location**: src/client/pages/ElectionHomePage.tsx:421 (onContestChange) → handler 在 :1451
- **properties**: from_contest_id, from_contest_type, to_contest_id, to_contest_type, jurisdiction_id, option_count (contestOptions.length)

**9.**

- **name**: contest_tab_changed
- **trigger**: 選區頁切換「預測結果／趨勢／留言」。這三個分頁的權重完全未知，而趨勢與留言各自要打一支 API（getTrend、getComments），沒人看就是白花的伺服器成本。
- **location**: src/client/pages/ContestPage.tsx:289 (onClick → setActiveTab, :239)
- **properties**: contest_id, contest_type, tab ('results'|'trend'|'comments'), entry ('tab_click'|'deep_link'——地圖抽屜的 :506、:508 兩個連結直接帶 ?tab= 進來，那條路不會經過這個 handler，要在 ContestPage 掛載時另外判斷)

**10.**

- **name**: comment_posted
- **trigger**: 留言送出成功。
- **location**: src/client/pages/ContestPage.tsx:134 (send mutation onSuccess)
- **properties**: contest_id, contest_type, body_length (draft.trim().length), entry ('enter_key' 走 :156 的 onKeyDown｜'button' 走 :166)。絕對不要送 body：那是政治意見，送到第三方就是把這個站的隱私姿態整個推翻。

**11.**

- **name**: comment_failed
- **trigger**: 留言送不出去（多半是速率限制或人機驗證）。
- **location**: src/client/pages/ContestPage.tsx:139 (send mutation onError)
- **properties**: contest_id, status (ApiError.status), needs_turnstile

**12.**

- **name**: region_view_changed
- **trigger**: 縣市頁切換縣市長／議員／鄉鎮市長／代表／村里分頁。村里那一層要載幾 MB 的圖資（loadVillageShapes），有多少人真的切過去是擴不擴充村里資料的依據。
- **location**: src/client/pages/JurisdictionPage.tsx:256 (selectView，由 :302 的 ElectionTabs onChange 呼叫)
- **properties**: jurisdiction_id, view (next), previous_view (view), contest_count (countForView 的結果，JurisdictionPage.tsx:187)

**13.**

- **name**: town_filter_changed
- **trigger**: 村里層先挑鄉鎮市區。這個分兩段的設計是刻意的（新北 1,039 個里，見 JurisdictionPage.tsx:208 的註解），要驗它沒有把人卡住。
- **location**: 下拉 src/client/pages/JurisdictionPage.tsx:327；膠囊 src/client/pages/JurisdictionPage.tsx:344
- **properties**: jurisdiction_id, town (townNames 是公開的行政區名，不是個資), control ('select'|'pill'——手機走下拉、桌機走膠囊，順便量到裝置分布), town_count (townNames.length)

**14.**

- **name**: identity_dialog_opened
- **trigger**: 點自己的名字，展開改名對話框。
- **location**: src/client/pages/MyPredictionsPage.tsx:180 (forecaster-id onClick)
- **properties**: has_name (Boolean(forecaster?.displayName)), prediction_count (items.length)

**15.**

- **name**: display_name_saved
- **trigger**: 改名存檔成功。
- **location**: src/client/pages/MyPredictionsPage.tsx:160 (save mutation onSuccess)
- **properties**: name_length (input.name.length), cleared (改回預設的「預測者」)。不要送名字本身。注意這個 handler 現在同時處理照片（MyPredictionsPage.tsx:157-158 的 uploadAvatar／removeAvatar），需求 1 會把那兩行連同 IdentityDialog 的整段上傳 UI（:87-114）拿掉，所以這個事件從一開始就不要有任何 photo 相關的欄位，免得跟著一起改。

**16.**

- **name**: search_used
- **trigger**: 用搜尋框跳到某個縣市或選區。搜尋是地圖之外唯一的導覽方式，命不命中決定要不要補搜尋詞庫。
- **location**: 送出 src/client/pages/ElectionPrototypeShared.tsx:90 (handleSearch)；點結果 src/client/pages/ElectionPrototypeShared.tsx:106
- **properties**: matched (Boolean(matches[0])), result_count (matches.length), query_length (search.trim().length), control ('submit'|'result_click')。第一版不要送查詢字串原文：那是自由輸入的欄位，就算實務上九成是縣市名，也不該預設把使用者打的字送給第三方。真的需要知道「大家在找什麼」時，再單獨決定，並且只送有命中的那些。

**17.**

- **name**: map_search_toggled
- **trigger**: 窄畫面打開／關閉浮動搜尋。優先度最低，只在懷疑手機使用者找不到搜尋時才需要。
- **location**: src/client/pages/ElectionHomePage.tsx:1223
- **properties**: open (true|false)

## ssrSafety

FOUR THINGS KEEP THIS INERT DURING SERVER RENDER.

1. No DOM access at module scope. `src/client/analytics.ts` touches `window`/`document` only inside `whenIdle`, `deliver` and the `usePageViews` effect. Importing the module on the server evaluates nothing but constants.

2. `import.meta.env` is guarded: `const buildEnv = import.meta.env ?? ({} as ImportMetaEnv)`. This matters concretely — the server today runs under `tsx` (package.json: `"api:dev": "tsx watch src/server/index.ts"`, `"api:start": "tsx src/server/index.ts"`), not under Vite. If the SSR agent ends up importing the client tree from a tsx-run process rather than from a Vite SSR build, `import.meta.env` is `undefined` and the bare `import.meta.env.VITE_GA_MEASUREMENT_ID` form throws a TypeError at import time, taking the whole render down. In a Vite client build the whole `import.meta.env` expression is still statically replaced, so the guard costs nothing.

3. The vendors are never imported on the server. `import('react-ga4')` and `import('posthog-js')` live inside `loadVendors()`, which is only reachable from `dispatch()`, which is only reachable from a `useEffect`. Whatever DOM assumptions posthog-js makes at module-evaluation time are therefore irrelevant — the server never evaluates it. A static top-level `import posthog from 'posthog-js'` would be wrong on two counts: it would be evaluated during SSR, and it would pull 87.8 KB gzipped into the entry chunk even when the key is absent (a side-effectful vendor import cannot be tree-shaken away by the `enabled` check).

4. No module-level mutable state is ever written on the server. `lastPath`, `started`, `ready`, `loading`, `pending`, `ga`, `ph` are all module-scoped, which on a long-lived Node server means they are shared across every request. They are only ever assigned from inside `dispatch`/`start`/`settle`/the effect, and `dispatch` returns early on `typeof window === 'undefined'`. So a server render cannot leave residue that affects the next visitor's render. This is worth stating explicitly to the SSR agent, because module-level state is normally the first thing that breaks under SSR.

Hydration: the module renders nothing, injects no markup, and adds no DOM before hydration completes, so it cannot cause a hydration mismatch. PostHog's script injection is the one place it could: `defaults: '2026-08-30'` includes the `'2026-01-30'` behaviour `external_scripts_inject_target: 'head'`, which the official type comment says exists specifically to avoid SSR hydration errors (verified in @posthog/types@1.407.1 posthog-config.d.ts:1548). react-ga4 appends its gtag script to `document.body` (verified, react-ga4 src/ga4.ts:96), which happens well after hydration because the whole load is deferred to `requestIdleCallback`.

Deferral: `whenIdle` (requestIdleCallback with a 4 s timeout, setTimeout 2 s fallback for Safari) keeps both vendor chunks and the googletagmanager.com script out of the way of the home page's own load — src/client/pages/ElectionHomePage.tsx:606 fetches `public/maps/taiwan-counties.svg` (468 KB, and the maps directory totals 7.5 MB) the moment the map mounts. Page views and events raised before the vendors resolve are queued and flushed in order, so nothing is lost.

## privacy

THE PROJECT'S STATED POSTURE, from the code. src/client/fingerprint.ts:1-7 says in as many words that the fingerprint is hand-written rather than FingerprintJS because "那種函式庫追求『盡可能唯一』，會去讀字型、音訊、WebGL 這些跟辨識無關的東西，換來的是更難解釋的隱私成本". src/server/identity.ts:17 says "指紋與 IP 一律只存 HMAC，不留原值" and enforces it via `signalHash` (identity.ts:18-20). The identity cookie is httpOnly (identity.ts:120). Nothing identifying ever leaves the server unhashed. Every analytics decision below is measured against that.

MAY THE FORECASTER ID BE THE POSTHOG distinct_id? No. Do not call `posthog.identify()` at all.

- The id is available client-side (`getSession()` returns `forecaster.id`, src/client/api.ts:106 / Session type at api.ts:8-18), so it is technically trivial. That is exactly why it needs an explicit ruling.
- It is the primary key of the `Forecaster` row, and that row is joined to every prediction, every comment, and to the HMAC'd fingerprint and IP signals (identity.ts:43-48). Handing it to PostHog creates an external database keyed by the same identifier as the internal one; anyone with both can join a person's PostHog session to their full prediction history. The server went to the trouble of HMAC-ing the weak signals precisely so that this join is not possible from outside.
- It is stable for 400 days by cookie (identity.ts:10) and recoverable by fingerprint for 90 days (identity.ts:13). It is a durable pseudonymous identifier, not a session id.
- Practical effect: `identify()` promotes the anonymous user to an identified person and creates a person profile, which is also the more expensive event class in PostHog's billing. The design uses `person_profiles: 'never'` (the type default is `'identified_only'`, verified at @posthog/types posthog-config.d.ts:1938) so that a future stray `identify()` cannot create one by accident. Cost of `'never'`: no person-level property filters and no cross-device stitching. Both are things this project deliberately does not have anyway.
- What you lose analytically: nothing that matters. PostHog's own anonymous distinct_id still gives you per-browser retention and funnels. If you ever need to segment by "has this person predicted before", send a coarse bucket as an event property (`prediction_count_bucket: '0'|'1-5'|'6+'`), never the id.

NEVER SEND THE FINGERPRINT. `getFingerprint()` (src/client/fingerprint.ts:22) returns a 32-hex device hash that the client sends only to our own server, where it is immediately re-hashed with a pepper. Putting that value into a GA or PostHog property would hand a third party a raw cross-site device identifier that our own database refuses to store in the clear. It would invert the entire design of identity.ts. Same for anything derived from it.

AUTOCAPTURE: OFF, and this is not a default-paranoia call. The home page renders one `<path role="button">` per county, per township, and per village (src/client/pages/ElectionHomePage.tsx:1265, :1304, :1385). At village level that is thousands of clickable SVG nodes per county, from a registry of 8,429 contests. PostHog autocapture would emit a `$autocapture` event with an element-tree selector for every one of them: high-cardinality junk that is unusable for analysis and billable per event. Autocapture also records the `textContent` of clicked elements, which on the results panels means candidate names and party labels. The explicit taxonomy above is both cheaper and more truthful.

SESSION RECORDING: OFF (`disable_session_recording: true`). Note the default is `false`, i.e. recording is on as far as the SDK is concerned and gated only by the project setting on PostHog's side (verified at @posthog/types posthog-config.d.ts:1247) — leaving it unset means a setting toggled in the PostHog UI silently starts recording this site. Two reasons to pin it off: rrweb recording a continuously panned and zoomed 468 KB SVG produces very large payloads; and the recording would capture the comment composer (src/client/pages/ContestPage.tsx:152-161), where people type political opinions. Political opinion is a GDPR special category; it is not in the 個資法 §6 enumerated list, so this is a posture call rather than a Taiwanese legal requirement — but it is the same call the fingerprint file already made.

COOKIES AND CONSENT. Today the site sets exactly one cookie, `vf_fid`, httpOnly, SameSite=Lax (identity.ts:8, :119-125) — strictly necessary, no banner needed. GA4 will add first-party `_ga`/`_ga_<id>` cookies; that part is unavoidable if you want GA at all. PostHog's default persistence is `'localStorage+cookie'` (verified, posthog-config.d.ts:1121); the design sets `persistence: 'localStorage'` so PostHog adds no cookie next to the identity cookie — it is a single-host site, so the cross-subdomain cookie buys nothing. `respect_dnt: true` is set because a project that hand-rolled a minimal fingerprint on privacy grounds should honour the browser's own signal; it costs a few percent of traffic. For a Taiwan audience under 個資法 there is no ePrivacy-style cookie-banner requirement, so no banner is proposed — but the privacy copy must be updated to say that GA4 and PostHog are in use and why, and if the site is ever promoted to EU visitors you will need consent gating (the hook for that is `opt_out_capturing_by_default: true` plus an opt-in control, and GA consent mode).

URLS ARE SAFE TO SEND. Every route path is composed of jurisdiction ids, contest ids and tab names (App.tsx:11-16); no route ever carries a name, a prediction, or an identifier of a person. `$current_url` and `page_path` therefore leak nothing. Keep it that way — do not add query parameters carrying forecaster state.

ONE COORDINATION NOTE. Requirement 1 removes image upload. The rename handler at src/client/pages/MyPredictionsPage.tsx:152-168 currently does name and photo in one mutation; the analytics event `display_name_saved` is specified with no photo-related property so it does not need revisiting when that code is cut.

## envVars

1. VITE_GA_MEASUREMENT_ID — GA4 量測 ID，格式 G-XXXXXXXXXX。使用者稍後提供。留空 = GA 完全關閉（不載 gtag、不發請求）。公開值，出現在前端 bundle 裡是正常的。
2. VITE_POSTHOG_KEY — PostHog 專案 API key，格式 phc_…。使用者稍後提供。留空 = PostHog 完全關閉。這把 key 本來就設計成公開的（只能寫入、不能讀取專案資料）。絕對不要把 PostHog 的 Personal API key 放進任何 VITE_ 變數。
3. VITE_POSTHOG_HOST — PostHog ingestion host。未設定時預設 https://us.i.posthog.com。歐盟專案改成 https://eu.i.posthog.com；日後若走反向代理就改成 /ingest。有預設值，可以先不設。
4. VITE_POSTHOG_UI_HOST — 只有在 VITE_POSTHOG_HOST 指向自家反向代理時才需要，值是真正的 PostHog app 網址（例如 https://us.posthog.com），讓 PostHog 產生的連結指得對。第一版不啟用代理，所以第一版不需要這一個。

## files

**1.**

- **path**: /workspaces/1128-vote-forecast/src/client/analytics.ts
- **action**: create
- **purpose**: GA4 與 PostHog 的唯一入口。匯出 track() 與 usePageViews()；金鑰不在時整個模組空轉。

**2.**

- **path**: /workspaces/1128-vote-forecast/src/client/App.tsx
- **action**: modify
- **purpose**: 在 App() 內呼叫一次 usePageViews()。全站唯一發 page view 的地方；main.tsx 不動，避開正在改 SSR 的那位。

**3.**

- **path**: /workspaces/1128-vote-forecast/src/client/vite-env.d.ts
- **action**: modify
- **purpose**: 補上 ImportMetaEnv 介面，讓三個 VITE_ 變數有型別。

**4.**

- **path**: /workspaces/1128-vote-forecast/src/client/pages/ForecastSheet.tsx
- **action**: modify
- **purpose**: forecast_submitted (:99)、forecast_failed (:111)；ForecastForm 加一個 surface prop，才分得出地圖抽屜與選區頁的送出。

**5.**

- **path**: /workspaces/1128-vote-forecast/src/client/pages/ContestPage.tsx
- **action**: modify
- **purpose**: contest_tab_changed (:289)、comment_posted (:134)、comment_failed (:139)、forecast_sheet_opened (:313)；傳 surface='contest_page' 給 ForecastSheet (:322)。

**6.**

- **path**: /workspaces/1128-vote-forecast/src/client/pages/ElectionHomePage.tsx
- **action**: modify
- **purpose**: map_area_selected 四個點擊點 (:1272、:1316、:1351、:1393、:1429)、map_level_changed（新增一個盯 mapLevelView 的 useEffect，:765-774 附近）、map_reset (:1240)、map_inspector_toggled (:399、:436)、map_contest_switched (:421)、forecast_sheet_opened (:1456)、map_search_toggled (:1223)；傳 surface='map_inspector' 給 ForecastForm (:388)。

**7.**

- **path**: /workspaces/1128-vote-forecast/src/client/pages/JurisdictionPage.tsx
- **action**: modify
- **purpose**: region_view_changed (selectView, :256)、town_filter_changed (:327 下拉、:344 膠囊)。

**8.**

- **path**: /workspaces/1128-vote-forecast/src/client/pages/MyPredictionsPage.tsx
- **action**: modify
- **purpose**: identity_dialog_opened (:180)、display_name_saved (:160)。等需求 1 把上傳拿掉之後再動，免得改到同一段。

**9.**

- **path**: /workspaces/1128-vote-forecast/src/client/pages/ElectionPrototypeShared.tsx
- **action**: modify
- **purpose**: search_used (:90 送出、:106 點結果)。

**10.**

- **path**: /workspaces/1128-vote-forecast/package.json
- **action**: modify
- **purpose**: dependencies 加 react-ga4 ^3.0.1 與 posthog-js ^1.422.2。

**11.**

- **path**: /workspaces/1128-vote-forecast/.env.example
- **action**: modify
- **purpose**: 三個 VITE_ 變數留空值加註解。目前這個檔完全沒有 VITE_ 開頭的變數，要順便寫清楚它們是 build 時就烤進 bundle 的。

## risks

1. VITE_ 變數是在 build 時被靜態替換進 bundle 的，不是執行時讀的。這對正在設計 Vercel 部署的那位有三個直接後果：(a) 這三個變數必須設在 Vercel 的 Build 環境變數，而且 Preview 與 Production 兩個 scope 都要設；(b) 改金鑰要重新 build，重啟沒有用；(c) 如果 Preview 與 Production 用同一組值，預覽站的流量會混進正式的 GA property 與 PostHog 專案。建議：Preview 直接不要設 VITE_GA_MEASUREMENT_ID（留空 = 整個關掉，正是這個設計的用意），或者給 PostHog 一個獨立的預覽專案 key。
2. GA4 的自訂事件屬性不會自己出現在報表裡。上面每一個 property 都要在 GA4 後台註冊成 custom dimension（事件範圍上限 50 個）才查得到，而且註冊之前送的資料不會回溯。金鑰一到手就要一次把 contest_id、contest_type、jurisdiction_id、level、surface、is_update、tab、view 這幾個註冊完。PostHog 沒有這個問題，屬性自動出現。
3. GA4 的限制要放在心上：事件名 ≤40 字元、只能是英數與底線且開頭是字母；每個事件 ≤25 個參數；參數值 ≤100 字元。上面的命名都符合，但之後有人想把 contest.area 送出去就會踩線——新竹市議員第一選舉區的 area 字串長到 145 字（見 ElectionHomePage.tsx:39 的註解）。不要送 area，送 contest_id 就好。
4. map_level_changed 是推導出來的狀態，不是某個 handler。ElectionHomePage 有五個 setDetailMode 呼叫點（:800、:863、:913、:942、:1181），另外滾輪縮放會經過 applyZoom (:897) 自動切層。逐一插入埋點一定會漏掉滾輪那條，而滾輪正是最常見的路徑。一定要用 useEffect 盯著 mapLevelView 並自己記住前一個值。
5. 地圖上的點擊事件量可能很大。村里層一次可以畫出上千個 path，使用者連續點選會產生大量 map_area_selected。第一版先全量送，上線後看數字；真的太吵就在 track() 裡對 map_area_selected 加節流（例如同一個 contest_id 在 1 秒內只送一次），這是模組內部的事，頁面不用改。
6. PostHog 的反向代理：先不做。這個站確實有自己的 Hono 伺服器（src/server/app.ts），寫一個代理路由並不難，但部署到 Vercel 之後每一筆事件都會變成一次 function 呼叫，成本跟事件量成正比。比較划算的作法是在 vercel.json 用 rewrite 把 /ingest 轉給 us.i.posthog.com——那是走路由層而不是 Node function，但頻寬還是算你的。好處只有一個：擋廣告攔截器（實務上會多回收兩三成的事件）。建議：第一版直上 us.i.posthog.com，之後真的覺得資料缺太多，再改 VITE_POSTHOG_HOST 成 /ingest 並加上 rewrite 與 VITE_POSTHOG_UI_HOST——這是一次設定變更，程式不用動。要注意代理必須同時涵蓋 ingestion 路徑與 /static（PostHog 自己會去抓額外的 script）。
7. posthog-js 沒有 exports map（已驗證：package.json 裡沒有這個欄位），所以 posthog-js/dist/module.slim.js 這種深層路徑目前可以 import，但那是未公開的介面，minor 版本就可能移動。想省那 42 KB gzip 的話要鎖版本並在 CI 裡驗證型別解析得到 dist/module.slim.d.ts。
8. react-ga4 的 initialize() 在 ID 為空字串時會 throw new Error("Require GA_MEASUREMENT_ID")（src/ga4.ts:173）。上面的設計靠 enabled 與 if (gaMeasurementId) 兩層擋住，永遠不會拿空字串去呼叫。之後有人重構這個模組時要記得這個地雷。
9. posthog-js 依賴 preact 與 core-js（npm view posthog-js dependencies 可見）。它們只進入那個延遲載入的 chunk，不會進 entry，但 npm ls 的樹會變大，安全掃描的報告也會變長。這是既成事實，不是問題，只是先講。
10. PostHog 的 defaults: '2026-08-30' 是一個會隨時間長出新行為的旋鈕。之後升級 posthog-js 時，這個字串不要跟著改成更新的日期，除非有人真的讀過那一版改了什麼——型別檔裡每一個日期都列著它開啟哪些預設值（@posthog/types posthog-config.d.ts:1544-1553）。特別是 capture_pageview，我們明確覆寫成 false，任何未來的 defaults 都不該把它翻回去。
11. 檢舉功能還沒有埋點可埋。伺服器端的 POST /api/reports 是有的（src/server/app.ts:359，邏輯在 src/server/moderation.ts:22-39，測試在 src/server/comments.test.ts:144），但 grep 過整個 src/client 沒有任何呼叫端，src/client/api.ts 也沒有對應的函式。使用者提到「檢舉」時可能以為前端已經有了。等前端真的做出檢舉入口再加 report_submitted，屬性用 target_type ('COMMENT') 與 reason（那五個列舉值，見 moderation.ts:11），不要送 note 的內容。
12. 留言的 avatarUrl 還存在於 ContestPage.tsx:177 與 MyPredictionsPage.tsx:183。需求 1 拿掉上傳之後那些分支會改，但它們跟量測無關，這裡不碰。
