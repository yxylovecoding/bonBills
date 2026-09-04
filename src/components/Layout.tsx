import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { signOut } from '../utils/authClient';
import AutoPossessionImporter from './AutoPossessionImporter';
import BillDropImporter from './BillDropImporter';
import Nav from './Nav';
import SyncIndicator from './SyncIndicator';

export default function Layout() {
  const [signingOut, setSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const location = useLocation();
  const isHomePage = location.pathname === '/';
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
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          {logoutError && <span role="alert" style={{ color: '#c5221f', fontSize: 11 }}>{logoutError}</span>}
          <button type="button" disabled={signingOut} onClick={() => {
            setSigningOut(true);
            setLogoutError('');
            void signOut().catch((cause) => {
              setLogoutError(cause instanceof Error ? cause.message : '退出失败，请重试');
              setSigningOut(false);
            });
          }} style={{ border: 'none', padding: '4px 0', background: 'transparent', color: '#5f6368', fontSize: 11, cursor: 'pointer' }}>
            {signingOut ? '退出中…' : '退出登录'}
          </button>
        </div>
        <Outlet />
      </div>
      <Nav />
    </div>
  );
}
