import { NavLink } from 'react-router-dom';

const tabs = [
  { to: '/', icon: 'home', label: '主页' },
  { to: '/calendar', icon: 'calendar_month', label: '日历' },
  { to: '/reconcile', icon: 'account_balance_wallet', label: '对账' },
  { to: '/history', icon: 'bar_chart', label: '历史' },
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
        padding: '6px 0 calc(env(safe-area-inset-bottom, 0px) + 6px)',
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
                position: 'relative',
              }}
            >
              {isActive && (
                <div
                  style={{
                    position: 'absolute',
                    top: -2,
                    width: 48,
                    height: 28,
                    borderRadius: 14,
                    backgroundColor: '#e8f0fe',
                  }}
                />
              )}
              <span
                className="material-symbols-rounded"
                style={{
                  fontSize: 22,
                  position: 'relative',
                  zIndex: 1,
                  fontVariationSettings: isActive ? "'FILL' 1" : "'FILL' 0",
                }}
              >
                {t.icon}
              </span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: isActive ? 600 : 400,
                  position: 'relative',
                  zIndex: 1,
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
