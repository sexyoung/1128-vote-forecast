import { Suspense, lazy } from 'react';
import { Route, Routes } from 'react-router-dom';
import { ContestPage } from './pages/ContestPage';
import { ElectionHomePage } from './pages/ElectionHomePage';
import { JurisdictionPage } from './pages/JurisdictionPage';
import { MyPredictionsPage } from './pages/MyPredictionsPage';
import { RegionsPage } from './pages/RegionsPage';
import { NotFoundPage } from './pages/NotFoundPage';

// 後台是另一支程式，只是共用網域與建置。lazy 讓它自己一個 chunk，公開頁面不會
// 為了一個只有我看得到的畫面多下載幾十 KB。
const AdminApp = lazy(() => import('./admin/AdminApp'));

export function App() {
  return (
    <Routes>
      <Route path="/" element={<ElectionHomePage />} />
      <Route path="/regions" element={<RegionsPage />} />
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
  );
}
