import { Suspense, lazy } from 'react';
import { Route, Routes } from 'react-router-dom';
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

// 後台是另一支程式，只是共用網域與建置。lazy 讓它自己一個 chunk，公開頁面不會
// 為了一個只有我看得到的畫面多下載幾十 KB。
const AdminApp = lazy(() => import('./admin/AdminApp'));

export function App() {
  usePageViews();
  return (
    <>
      <Routes>
        <Route path="/" element={<ElectionHomePage />} />
        <Route path="/regions" element={<RegionsPage />} />
        <Route path="/parties" element={<PartiesPage />} />
        <Route path="/parties/:partyId" element={<PartiesPage />} />
        <Route path="/rankings" element={<CandidateRankingsPage />} />
        <Route path="/region/:jurisdictionId" element={<JurisdictionPage />} />
        <Route path="/contest/:contestId" element={<ContestPage />} />
        <Route path="/mine" element={<MyPredictionsPage />} />
        <Route
          path="/admin/*"
          element={
            <Suspense fallback={null}>
              <AdminApp />
            </Suspense>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      {/* Routes 外面、跟它平行：任何網址都要看得到，不能只掛在某一個 route 底下。 */}
      <AnnouncementModal />
    </>
  );
}
