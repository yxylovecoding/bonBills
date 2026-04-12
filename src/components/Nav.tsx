import { NavLink } from 'react-router-dom';

const tabs = [
  { to: '/', icon: '🏠', label: '主页' },
  { to: '/calendar', icon: '📅', label: '日历' },
  { to: '/reconcile', icon: '💰', label: '对账' },
  { to: '/history', icon: '📊', label: '历史' },
];

export default function Nav() {
  return (
    <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-app
                    bg-white shadow-nav border-t border-gborder
                    flex justify-around py-2 pb-[calc(env(safe-area-inset-bottom)+8px)]">
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.to === '/'}
          className={({ isActive }) =>
            `flex flex-col items-center gap-0.5 text-xs flex-1 transition-colors
             ${isActive ? 'text-gblue' : 'text-gsub'}`
          }
        >
          <span className="text-xl leading-none">{t.icon}</span>
          <span className="font-medium">{t.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
