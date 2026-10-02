import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';

const isLife = window.location.hostname === 'life.bonbills.cn' || /^\/life(?:\/|$)/.test(window.location.pathname);
const Root = React.lazy(() => isLife ? import('./life/BonLife') : import('./components/AuthGate'));
if (isLife) {
  document.title = 'BonLife';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#f6f5f3');
  const icon = document.createElement('link');
  icon.rel = 'icon'; icon.href = '/bonlife.svg'; document.head.appendChild(icon);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <React.Suspense fallback={<main className="login-shell"><p role="status">加载中…</p></main>}><Root /></React.Suspense>
  </React.StrictMode>,
);
