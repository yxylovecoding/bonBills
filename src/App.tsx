import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import HomePage from './pages/HomePage';
import CalendarPage from './pages/CalendarPage';
import ReconcilePage from './pages/ReconcilePage';
import ConsumablesPage from './pages/ConsumablesPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/reconcile" element={<ReconcilePage />} />
          <Route path="/consumables" element={<ConsumablesPage />} />
          <Route path="/history" element={<Navigate to="/calendar?tab=year" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
