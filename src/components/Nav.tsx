import { NavLink } from 'react-router-dom';

const tabs = [
  {
    to: '/',
    label: '主页',
    icon: (active: boolean) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill={active ? '#1a73e8' : 'none'} stroke={active ? '#1a73e8' : '#5f6368'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z" />
        <polyline points="9 22 9 12 15 12 15 22" fill={active ? '#e8f0fe' : 'none'} stroke={active ? '#1a73e8' : '#5f6368'} />
      </svg>
    ),
  },
  {
    to: '/calendar',
    label: '记录',
    icon: (active: boolean) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? '#1a73e8' : '#5f6368'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" fill={active ? '#e8f0fe' : 'none'} stroke={active ? '#1a73e8' : '#5f6368'} />
        <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
        <polyline points="8,14 11,17 16,12" stroke={active ? '#1a73e8' : '#5f6368'} />
      </svg>
    ),
  },
  {
    to: '/reconcile',
    label: '对账',
    icon: (active: boolean) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? '#1a73e8' : '#5f6368'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="4" width="20" height="16" rx="2" fill={active ? '#e8f0fe' : 'none'} stroke={active ? '#1a73e8' : '#5f6368'} />
        <path d="M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" /><path d="M2 10h4" /><path d="M18 10h4" /><path d="M2 14h4" /><path d="M18 14h4" />
      </svg>
    ),
  },
];

export default function Nav() {
  return (
    <nav
      style={{
        position: 'fixed',
        bottom: 0,
        left: '50%',
        transform: 'translateX(-50%)',
        width: '100%',
        maxWidth: 480,
        backgroundColor: '#ffffff',
        borderTop: '1px solid #e0e0e0',
        display: 'flex',
        justifyContent: 'space-around',
        alignItems: 'center',
        padding: '4px 0 calc(env(safe-area-inset-bottom, 0px) + 4px)',
        zIndex: 50,
        boxShadow: '0 -2px 8px rgba(0,0,0,0.06)',
      }}
    >
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.to === '/'}
          style={{ textDecoration: 'none', flex: 1 }}
        >
          {({ isActive }) => (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2,
                color: isActive ? '#1a73e8' : '#5f6368',
                padding: '4px 0',
              }}
            >
              {/* pill 背景 */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 52,
                  height: 28,
                  borderRadius: 14,
                  backgroundColor: isActive ? '#e8f0fe' : 'transparent',
                  transition: 'background-color 0.2s',
                }}
              >
                {t.icon(isActive)}
              </div>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: isActive ? 600 : 400,
                  lineHeight: 1,
                }}
              >
                {t.label}
              </span>
            </div>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
