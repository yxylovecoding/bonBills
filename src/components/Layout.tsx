import { Outlet, useLocation } from 'react-router-dom';
import AutoPossessionImporter from './AutoPossessionImporter';
import AutoFundBuySync from './AutoFundBuySync';
import BillDropImporter from './BillDropImporter';
import Nav from './Nav';
import InstallApp from './InstallApp';
import SyncIndicator from './SyncIndicator';
import { usePageScrollRestoration } from '../hooks/usePageScrollRestoration';
import { useSyncStatus } from '../utils/syncStatus';

export default function Layout() {
  const syncReady = useSyncStatus((state) => state.ready);
  const location = useLocation();
  usePageScrollRestoration(`${location.pathname}${location.search}`);
  const isHomePage = location.pathname === '/';
  const isCalendarPage = location.pathname === '/calendar';
  const isWishesPage = location.pathname === '/wishes';
  return (
    <div
      style={{ minHeight: '100vh', backgroundColor: '#f0f2f5', color: '#202124' }}
    >
      {syncReady && <AutoPossessionImporter />}
      {syncReady && <AutoFundBuySync />}
      <BillDropImporter />
      <div
        className="app-content"
        style={{
          maxWidth: isHomePage ? 720 : isCalendarPage ? 944 : isWishesPage ? 1200 : 480,
          width: '100%',
          margin: '0 auto',
          minHeight: '100vh',
          boxSizing: 'border-box',
        }}
      >
        <div className="app-status-toolbar">
          {isHomePage && <InstallApp app="bills" />}
          <SyncIndicator />
        </div>
        <Outlet />
      </div>
      <Nav />
    </div>
  );
}
