import { Suspense, lazy, useEffect, useLayoutEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { AnnouncementModal } from './AnnouncementModal';
import { usePageViews } from './analytics';
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

export function App() {
  usePageViews();
  return (
    <>
      <ScrollToTop />
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
      {/* Routes 外面、跟它平行：任何網址都要看得到，不能只掛在某一個 route 底下。 */}
      <AnnouncementModal />
    </>
  );
}
