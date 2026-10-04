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
      <SyncIndicator />
      {syncReady && <AutoPossessionImporter />}
      {syncReady && <AutoFundBuySync />}
      <BillDropImporter />
      <div
        style={{
          maxWidth: isHomePage ? 720 : isCalendarPage ? 944 : isWishesPage ? 1200 : 480,
          width: '100%',
          margin: '0 auto',
          minHeight: '100vh',
          paddingBottom: 80,
          paddingLeft: 16,
          paddingRight: 16,
          paddingTop: 20,
          boxSizing: 'border-box',
          overflowX: 'clip',
        }}
      >
        {isHomePage && <div className="app-install-toolbar"><InstallApp app="bills" /></div>}
        <Outlet />
      </div>
      <Nav />
    </div>
  );
}
