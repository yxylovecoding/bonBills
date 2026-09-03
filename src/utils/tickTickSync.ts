import { create } from 'zustand';

export type TickTickConnectionState = 'unknown' | 'connected' | 'disconnected';
export type TickTickOperationState = 'idle' | 'connecting' | 'syncing' | 'synced' | 'error';

interface TickTickStatusResponse {
  connected: boolean;
  lastSyncAt?: string;
  error?: string;
}

interface TickTickSyncStore {
  connection: TickTickConnectionState;
  operation: TickTickOperationState;
  message: string;
  lastSyncAt?: string;
  setStatus: (partial: Partial<Omit<TickTickSyncStore, 'setStatus'>>) => void;
}

export const useTickTickSyncStatus = create<TickTickSyncStore>((set) => ({
  connection: 'unknown',
  operation: 'idle',
  message: '',
  setStatus: (partial) => set(partial),
}));

async function requestTickTick(secret: string, init: RequestInit = {}) {
  const response = await fetch('/api/ticktick-trips', {
    ...init,
    headers: {
      Authorization: `Bearer ${secret}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  const body = await response.json().catch(() => null) as (TickTickStatusResponse & { error?: string }) | null;
  if (!response.ok) {
    const fallback = response.status >= 500 ? '同步服务暂时不可用，请稍后重试' : `请求失败（${response.status}）`;
    throw new Error(body?.error || fallback);
  }
  return body;
}

export async function loadTickTickSyncStatus(secret: string) {
  const store = useTickTickSyncStatus.getState();
  try {
    const body = await requestTickTick(secret, { method: 'GET' });
    store.setStatus({
      connection: body?.connected ? 'connected' : 'disconnected',
      operation: body?.error ? 'error' : 'idle',
      message: body?.error ?? '',
      lastSyncAt: body?.lastSyncAt,
    });
    return Boolean(body?.connected);
  } catch (error) {
    store.setStatus({ operation: 'error', message: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

export async function connectTickTick(secret: string, token: string) {
  const store = useTickTickSyncStatus.getState();
  store.setStatus({ operation: 'connecting', message: '' });
  try {
    const body = await requestTickTick(secret, { method: 'PUT', body: JSON.stringify({ token }) });
    store.setStatus({
      connection: 'connected',
      operation: body?.error ? 'error' : 'idle',
      message: body?.error ?? '',
      lastSyncAt: body?.lastSyncAt,
    });
  } catch (error) {
    store.setStatus({
      connection: 'disconnected',
      operation: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function syncTickTickTrips(secret: string) {
  const store = useTickTickSyncStatus.getState();
  if (store.connection === 'disconnected') return;
  store.setStatus({ operation: 'syncing', message: '' });
  try {
    const body = await requestTickTick(secret, { method: 'POST' });
    store.setStatus({
      connection: 'connected',
      operation: 'synced',
      message: '',
      lastSyncAt: body?.lastSyncAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    store.setStatus({
      connection: /未连接/.test(message) ? 'disconnected' : store.connection,
      operation: /未连接/.test(message) ? 'idle' : 'error',
      message: /未连接/.test(message) ? '' : message,
    });
  }
}

export async function disconnectTickTick(secret: string) {
  const store = useTickTickSyncStatus.getState();
  await requestTickTick(secret, { method: 'DELETE' });
  store.setStatus({ connection: 'disconnected', operation: 'idle', message: '', lastSyncAt: undefined });
}
