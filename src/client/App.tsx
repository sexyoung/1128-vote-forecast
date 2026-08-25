import { Route, Routes } from 'react-router-dom';
import { ToolsPage } from './pages/ToolsPage';

export function App() {
  return (
    <Routes>
      <Route path="/" element={null} />
      <Route path="/tools" element={<ToolsPage />} />
      <Route path="*" element={null} />
    </Routes>
  );
}
