import { lazy, Suspense, useEffect, useState } from 'react';
import LoginPage from '../pages/LoginPage';
import { requestSession, restoreSession, SessionError } from '../utils/authClient';

const App = lazy(() => import('../App'));
let startup: Promise<boolean> | undefined;

async function startApp() {
  const session = await restoreSession();
  if (!session.authenticated) return false;
  const { initSync, triggerUpload } = await import('../utils/syncEngine');
  await initSync();
  const { useMonthlyStore } = await import('../stores/monthlyStore');
  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const investmentMonthChanged = useMonthlyStore.getState().ensureInvestmentMonth(yearMonth);
  const investmentCutoffChanged = useMonthlyStore.getState().ensureInvestmentImportCutoff();
  if (investmentMonthChanged || investmentCutoffChanged) await triggerUpload();
  return true;
}

function Loading() {
  return <main className="login-shell"><p className="login-status" role="status">加载中…</p></main>;
}

export default function AuthGate() {
  const [state, setState] = useState<'loading' | 'ready' | 'login' | 'error'>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    startup ??= startApp();
    void startup.then((authenticated) => {
      if (!cancelled) setState(authenticated ? 'ready' : 'login');
    }).catch((cause) => {
      if (!cancelled) {
        setError(cause instanceof Error ? cause.message : '加载失败，请重试');
        setState(cause instanceof SessionError && cause.status === 401 ? 'login' : 'error');
      }
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (state !== 'ready') return;
    const checkSession = () => {
      void requestSession().then((session) => {
        if (!session.authenticated) window.location.reload();
      }).catch(() => undefined);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === 'bonbills-logout-at') window.location.reload();
    };
    window.addEventListener('focus', checkSession);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('focus', checkSession);
      window.removeEventListener('storage', onStorage);
    };
  }, [state]);

  if (state === 'loading') return <Loading />;
  if (state === 'login') return <LoginPage initialError={error} />;
  if (state === 'error') return (
    <main className="login-shell">
      <section className="login-card">
        <h1>暂时无法进入</h1>
        <p className="login-error" role="alert">{error}</p>
        <button className="login-submit" onClick={() => window.location.reload()}>重试</button>
        <button className="login-switch" onClick={() => setState('login')}>返回登录</button>
      </section>
    </main>
  );
  return <Suspense fallback={<Loading />}><App /></Suspense>;
}
