import { Outlet, useLocation } from 'react-router-dom';
import AutoPossessionImporter from './AutoPossessionImporter';
import BillDropImporter from './BillDropImporter';
import Nav from './Nav';
import SyncIndicator from './SyncIndicator';

export default function Layout() {
  const location = useLocation();
  const isCalendarPage = location.pathname === '/calendar';
  const isWishesPage = location.pathname === '/wishes';
  return (
    <div
      style={{ minHeight: '100vh', backgroundColor: '#f0f2f5', color: '#202124' }}
    >
      <SyncIndicator />
      <AutoPossessionImporter />
      <BillDropImporter />
      <div
        style={{
          maxWidth: isCalendarPage ? 944 : isWishesPage ? 1200 : 480,
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
        <Outlet />
      </div>
      <Nav />
    </div>
  );
}
