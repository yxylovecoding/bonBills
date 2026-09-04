import { useState, type FormEvent } from 'react';
import { removeLegacyKey, signIn } from '../utils/authClient';

export default function LoginPage({ initialError = '' }: { initialError?: string }) {
  const [usesKey, setUsesKey] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await signIn(usesKey ? { key: password } : { username: username.trim(), password });
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
        <h1 id="login-title">盘账助手</h1>
        <form onSubmit={submit} className="login-form" aria-busy={busy}>
          {!usesKey && (
            <label htmlFor="login-username">账号
              <input id="login-username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false}
                required maxLength={100} value={username} disabled={busy} onChange={(event) => setUsername(event.target.value)} />
            </label>
          )}
          <label htmlFor="login-password">{usesKey ? 'Key' : '密码'}
            <input id="login-password" name="password" type="password" autoComplete={usesKey ? 'off' : 'current-password'}
              required maxLength={1024} value={password} disabled={busy} aria-invalid={Boolean(error)}
              aria-describedby={error ? 'login-error' : undefined} onChange={(event) => setPassword(event.target.value)} />
          </label>
          {error && <p id="login-error" className="login-error" role="alert">{error}</p>}
          <button type="submit" className="login-submit" disabled={busy}>{busy ? '登录中…' : '登录'}</button>
          <button type="button" className="login-switch" disabled={busy} onClick={() => {
            setUsesKey((value) => !value);
            setPassword('');
            setError('');
          }}>{usesKey ? '使用账号密码登录' : '使用 Key 登录'}</button>
        </form>
      </section>
    </main>
  );
}
