import { Route, Routes } from 'react-router-dom';
import {
  ContestPage,
  ElectionHomePage,
  JurisdictionPage,
  MyPredictionsPage,
  PrototypeProvider,
} from './pages/ElectionPrototypePage';
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
