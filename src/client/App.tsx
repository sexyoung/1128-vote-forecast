import { Route, Routes } from 'react-router-dom';
import { ContestPage } from './pages/ContestPage';
import { ElectionHomePage } from './pages/ElectionHomePage';
import { JurisdictionPage } from './pages/JurisdictionPage';
import { MyPredictionsPage } from './pages/MyPredictionsPage';
import { RegionsPage } from './pages/RegionsPage';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<ElectionHomePage />} />
      <Route path="/regions" element={<RegionsPage />} />
      <Route path="/region/:jurisdictionId" element={<JurisdictionPage />} />
      <Route path="/contest/:contestId" element={<ContestPage />} />
      <Route path="/mine" element={<MyPredictionsPage />} />
      <Route path="*" element={<ElectionHomePage />} />
    </Routes>
  );
}
