import { Outlet } from 'react-router-dom';
import Nav from './Nav';

export default function Layout() {
  return (
    <div
      style={{ minHeight: '100vh', backgroundColor: '#f0f2f5', color: '#202124' }}
    >
      <div
        style={{
          maxWidth: 480,
          margin: '0 auto',
          minHeight: '100vh',
          paddingBottom: 80,
          paddingLeft: 16,
          paddingRight: 16,
          paddingTop: 20,
        }}
      >
        <Outlet />
      </div>
      <Nav />
    </div>
  );
}
