import { Outlet } from 'react-router-dom';
import Nav from './Nav';
import SyncIndicator from './SyncIndicator';

export default function Layout() {
  return (
    <div
      style={{ minHeight: '100vh', backgroundColor: '#f0f2f5', color: '#202124' }}
    >
      <SyncIndicator />
      <div
        style={{
          maxWidth: 480,
          width: '100%',
          margin: '0 auto',
          minHeight: '100vh',
          paddingBottom: 80,
          paddingLeft: 16,
          paddingRight: 16,
          paddingTop: 20,
          boxSizing: 'border-box',
          overflowX: 'hidden',
        }}
      >
        <Outlet />
      </div>
      <Nav />
    </div>
  );
}
