import { Component, type ReactNode, Suspense, lazy, useEffect, useLayoutEffect } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { AnnouncementModal } from './AnnouncementModal';
import { captureException, usePageViews } from './analytics';
import { ContestPage } from './pages/ContestPage';
import { ElectionHomePage } from './pages/ElectionHomePage';
import { JurisdictionPage } from './pages/JurisdictionPage';
import { MyPredictionsPage } from './pages/MyPredictionsPage';
import { RegionsPage } from './pages/RegionsPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PartiesPage } from './pages/PartiesPage';
import { CandidateRankingsPage } from './pages/CandidateRankingsPage';
import { PrivacyPage } from './pages/PrivacyPage';
import { TermsPage } from './pages/TermsPage';
import { ChangelogPage } from './pages/ChangelogPage';
import { PageShell } from './pages/ElectionPrototypeShared';

// 後台是另一支程式，只是共用網域與建置。lazy 讓它自己一個 chunk，公開頁面不會
// 為了一個只有我看得到的畫面多下載幾十 KB。
const AdminApp = lazy(() => import('./admin/AdminApp'));
const useIsomorphicLayoutEffect = typeof document === 'undefined' ? useEffect : useLayoutEffect;

function ScrollToTop() {
  const { pathname, search } = useLocation();

  useIsomorphicLayoutEffect(() => {
    const scrollingElement = (document.scrollingElement ?? document.documentElement) as HTMLElement;
    const previousBehavior = scrollingElement.style.scrollBehavior;
    const previousPriority = scrollingElement.style.getPropertyPriority('scroll-behavior');
    let secondFrame = 0;

    const reset = () => {
      scrollingElement.scrollTop = 0;
      window.scrollTo(0, 0);
      document.body.scrollTop = 0;
    };
    const restoreBehavior = () => {
      if (previousBehavior) {
        scrollingElement.style.setProperty('scroll-behavior', previousBehavior, previousPriority);
      } else {
        scrollingElement.style.removeProperty('scroll-behavior');
      }
    };

    // iOS 對 behavior: instant 的支援不一致；換頁期間直接蓋掉全站 smooth scroll。
    // 虛擬列表會在掛載後量測並校正一次，因此連續兩幀再歸零，避免舊 offset 被寫回。
    scrollingElement.style.setProperty('scroll-behavior', 'auto', 'important');
    reset();
    const firstFrame = window.requestAnimationFrame(() => {
      reset();
      secondFrame = window.requestAnimationFrame(() => {
        reset();
        restoreBehavior();
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      restoreBehavior();
    };
  }, [pathname, search]);

  return null;
}

// render 一炸就整頁空白，而且沒有 $exception 看得到（見 analytics 的 captureException）。
// 錯誤邊界把空白換成看得懂的畫面，並把例外送出去。
class ErrorBoundary extends Component<
  { children: ReactNode; resetKey: string },
  { failed: boolean; resetKey: string }
> {
  state = { failed: false, resetKey: this.props.resetKey };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: { resetKey: string }, state: { resetKey: string }) {
    // 換頁時歸零，讓使用者走得出壞掉的那一頁，不用重新整理。
    if (props.resetKey !== state.resetKey) return { failed: false, resetKey: props.resetKey };
    return null;
  }

  componentDidCatch(error: unknown, info: { componentStack?: string | null }) {
    captureException(error, { componentStack: info.componentStack ?? undefined });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="page">
        <section className="page-heading">
          <h1>這一頁出了點問題</h1>
          <Link className="button" to="/">
            回預測地圖
          </Link>
        </section>
      </main>
    );
  }
}

export function App() {
  usePageViews();
  const { pathname } = useLocation();
  return (
    <>
      <ScrollToTop />
      <ErrorBoundary resetKey={pathname}>
        <Routes>
          <Route element={<PageShell />}>
            <Route path="/" element={<ElectionHomePage />} />
            <Route path="/regions" element={<RegionsPage />} />
            <Route path="/parties" element={<PartiesPage />} />
            <Route path="/parties/:partyId" element={<PartiesPage />} />
            <Route path="/rankings" element={<CandidateRankingsPage />} />
            <Route path="/region/:jurisdictionId" element={<JurisdictionPage />} />
            <Route path="/contest/:contestId" element={<ContestPage />} />
            <Route path="/mine" element={<MyPredictionsPage />} />
            <Route path="/privacy" element={<PrivacyPage />} />
            <Route path="/terms" element={<TermsPage />} />
            <Route path="/changelog" element={<ChangelogPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
          <Route
            path="/admin/*"
            element={
              <Suspense fallback={null}>
                <AdminApp />
              </Suspense>
            }
          />
        </Routes>
      </ErrorBoundary>
      {/* Routes 外面、跟它平行：任何網址都要看得到，不能只掛在某一個 route 底下。 */}
      <AnnouncementModal />
    </>
  );
}
