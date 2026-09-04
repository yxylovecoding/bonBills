export interface SessionStatus {
  authenticated: boolean;
  username?: string;
}

export class SessionError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function requestSession(init: RequestInit = {}): Promise<SessionStatus> {
  const response = await fetch('/api/auth', {
    ...init,
    credentials: 'same-origin',
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
  const body = await response.json().catch(() => null) as (SessionStatus & { error?: string }) | null;
  if (!response.ok || typeof body?.authenticated !== 'boolean') {
    throw new SessionError(body?.error || '登录服务暂不可用，请稍后重试', response.status);
  }
  return body;
}

export function signIn(credentials: { username: string; password: string } | { key: string }) {
  return requestSession({ method: 'POST', body: JSON.stringify(credentials) });
}

export async function apiFetch(url: string, init: RequestInit = {}) {
  const response = await fetch(url, { ...init, credentials: 'same-origin', cache: 'no-store' });
  if (response.status === 401) {
    window.location.reload();
    throw new Error('登录已过期，请重新登录');
  }
  return response;
}

export function removeLegacyKey() {
  const url = new URL(window.location.href);
  if (url.searchParams.has('key')) {
    url.searchParams.delete('key');
    window.history.replaceState(window.history.state, '', url);
  }
  try { sessionStorage.removeItem('sync-secret'); } catch { /* 存储不可用时仍可登录 */ }
}

export async function restoreSession() {
  const url = new URL(window.location.href);
  let key = url.searchParams.get('key');
  if (!key) {
    try { key = sessionStorage.getItem('sync-secret'); } catch { /* 可使用登录表单 */ }
  }
  // 旧链接和旧标签页先交换服务端会话，再移除浏览器内的长期密钥。
  if (key) {
    try {
      return await signIn({ key });
    } finally {
      removeLegacyKey();
    }
  }
  return requestSession();
}

export async function signOut() {
  const { triggerUpload } = await import('./syncEngine');
  await triggerUpload();
  const { useSyncStatus } = await import('./syncStatus');
  if (useSyncStatus.getState().state === 'error') throw new Error('保存失败，请重试后退出');
  await requestSession({ method: 'DELETE' });
  removeLegacyKey();
  try { localStorage.setItem('bonbills-logout-at', String(Date.now())); } catch { /* 当前页仍会退出 */ }
  window.location.reload();
}
