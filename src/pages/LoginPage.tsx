import { useState, type FormEvent } from 'react';
import { register, removeLegacyKey, signIn } from '../utils/authClient';

export default function LoginPage({ initialError = '' }: { initialError?: string }) {
  const [mode, setMode] = useState<'login' | 'key' | 'register'>('login');
  const [key, setKey] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);
  const usesKey = mode === 'key';
  const registering = mode === 'register';

  function switchMode(next: typeof mode) {
    setMode(next);
    setKey('');
    setPassword('');
    setError('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (registering) await register({ key, username: username.trim(), password });
      else await signIn(usesKey ? { key } : { username: username.trim(), password });
      removeLegacyKey();
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '登录失败，请重试');
      setBusy(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-mark" aria-hidden="true">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="3" width="14" height="18" rx="3" />
            <path d="M9 8h6M9 12h6M9 16h3" />
          </svg>
        </div>
        <h1 id="login-title">{registering ? '注册账号' : '盘账助手'}</h1>
        <form onSubmit={submit} className="login-form" aria-busy={busy}>
          {(usesKey || registering) && (
            <label htmlFor="login-key">{registering ? '现有 Key' : 'Key'}
              <input id="login-key" name="key" type="password" autoComplete="off" required maxLength={1024}
                value={key} disabled={busy} onChange={(event) => setKey(event.target.value)} />
            </label>
          )}
          {!usesKey && (
            <label htmlFor="login-username">账号
              <input id="login-username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false}
                required maxLength={100} value={username} disabled={busy} onChange={(event) => setUsername(event.target.value)} />
            </label>
          )}
          {!usesKey && (
            <label htmlFor="login-password">密码
              <input id="login-password" name="password" type="password" autoComplete={registering ? 'new-password' : 'current-password'}
                required minLength={registering ? 6 : undefined} maxLength={1024} placeholder={registering ? '至少 6 位' : undefined}
                value={password} disabled={busy} aria-invalid={Boolean(error)}
                aria-describedby={error ? 'login-error' : undefined} onChange={(event) => setPassword(event.target.value)} />
            </label>
          )}
          {error && <p id="login-error" className="login-error" role="alert">{error}</p>}
          <button type="submit" className="login-submit" disabled={busy}>
            {busy ? (registering ? '注册中…' : '登录中…') : (registering ? '注册并登录' : '登录')}
          </button>
          <div className="login-actions">
            <button type="button" className="login-switch" disabled={busy} onClick={() => switchMode(usesKey ? 'login' : 'key')}>
              {usesKey ? '账号密码登录' : '使用 Key 登录'}
            </button>
            <button type="button" className="login-switch" disabled={busy} onClick={() => switchMode(registering ? 'login' : 'register')}>
              {registering ? '返回登录' : '注册账号'}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
