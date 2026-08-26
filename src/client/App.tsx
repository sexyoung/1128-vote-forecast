import { Route, Routes } from 'react-router-dom';
import { ContestPage } from './pages/ContestPage';
import { ElectionHomePage } from './pages/ElectionHomePage';
import { PrototypeProvider } from './pages/ElectionPrototypeShared';
import { JurisdictionPage } from './pages/JurisdictionPage';
import { MyPredictionsPage } from './pages/MyPredictionsPage';
import { ToolsPage } from './pages/ToolsPage';

export function App() {
  return (
    <PrototypeProvider>
      <Routes>
        <Route path="/" element={<ElectionHomePage />} />
        <Route path="/region/:jurisdictionId" element={<JurisdictionPage />} />
        <Route path="/contest/:contestId" element={<ContestPage />} />
        <Route path="/mine" element={<MyPredictionsPage />} />
        <Route path="/tools" element={<ToolsPage />} />
        <Route path="*" element={<ElectionHomePage />} />
      </Routes>
    </PrototypeProvider>
  );
}
