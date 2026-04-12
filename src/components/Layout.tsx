import { Outlet } from 'react-router-dom';
import Nav from './Nav';

export default function Layout() {
  return (
    <div className="min-h-screen bg-gbg text-gtext">
      <div className="mx-auto max-w-app min-h-screen pb-24 px-4 pt-5">
        <Outlet />
      </div>
      <Nav />
    </div>
  );
}
