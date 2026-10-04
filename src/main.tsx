import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';

const isLifeHost = window.location.hostname === 'life.bonbills.cn';
const isLife = isLifeHost || /^\/life(?:\/|$)/.test(window.location.pathname);
// Keep loaders separate so Vite attaches each app's CSS to its own import.
const Root = isLife
  ? React.lazy(() => import('./life/BonLife'))
  : React.lazy(() => import('./components/AuthGate'));
const appName = isLife ? 'BonLife' : 'BonBills';
const appIcon = isLife ? 'bonlife' : 'bonbills';
document.title = appName;
document.querySelector('meta[name="application-name"]')?.setAttribute('content', appName);
document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', appName);
document.querySelector('meta[name="theme-color"]')?.setAttribute('content', isLife ? '#f6f5f3' : '#f0f2f5');
document.querySelector('link[rel="icon"]')?.setAttribute('href', `/${appIcon}.svg`);
document.querySelector('link[rel="apple-touch-icon"]')?.setAttribute('href', `/icons/${appIcon}-180.png`);
// Select one manifest before attaching it: /life must launch BonLife on the main host too.
const manifest = document.createElement('link');
manifest.rel = 'manifest';
manifest.href = isLife ? (isLifeHost ? '/bonlife.webmanifest' : '/bonlife-path.webmanifest') : '/bonbills.webmanifest';
document.head.appendChild(manifest);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <React.Suspense fallback={<main className="login-shell"><p role="status">加载中…</p></main>}><Root /></React.Suspense>
  </React.StrictMode>,
);
