import { useCallback, useEffect, useRef, useState } from 'react';
import LoginPage from '../pages/LoginPage';
import { requestSession, restoreSession } from '../utils/authClient';
import LifeCalendar from './LifeCalendar';
import './life.css';

let sessionPromise: ReturnType<typeof restoreSession> | undefined;

export default function BonLife() {
  const [owner, setOwner] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'login' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const checking = useRef(false);
  const expired = useCallback(() => setStatus('login'), []);
  useEffect(() => {
    let active = true;
    sessionPromise ??= restoreSession();
    void sessionPromise.then((session) => {
      if (!active) return;
      setOwner(session.username || 'Key');
      setStatus(session.authenticated ? 'ready' : 'login');
    }).catch(() => { if (active) { setError('暂时无法连接，请重试'); setStatus('error'); } });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (status !== 'ready') return;
    const check = async () => {
      if (checking.current) return;
      checking.current = true;
      try {
        const session = await requestSession();
        if (!session.authenticated || (session.username || 'Key') !== owner) setStatus('login');
      } catch { /* Keep unsaved text during a transient outage. */ }
      finally { checking.current = false; }
    };
    const onStorage = (event: StorageEvent) => { if (event.key === 'bonlife-logout-at') void check(); };
    window.addEventListener('focus', check);
    window.addEventListener('storage', onStorage);
    return () => { window.removeEventListener('focus', check); window.removeEventListener('storage', onStorage); };
  }, [status, owner]);

  return <div className="bonlife">
    {status === 'loading' ? <main className="life-loading" role="status">加载中…</main>
      : status === 'login' ? <LoginPage title="BonLife" />
      : status === 'error' ? <main className="life-loading"><p role="alert">{error}</p><button onClick={() => window.location.reload()}>重试</button></main>
      : <LifeCalendar owner={owner!} onExpired={expired} />}
  </div>;
}
