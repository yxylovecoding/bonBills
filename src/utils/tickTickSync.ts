import { apiFetch } from './authClient';
import { create } from 'zustand';

export type TickTickConnectionState = 'unknown' | 'connected' | 'disconnected';
export type TickTickOperationState = 'idle' | 'connecting' | 'syncing' | 'synced' | 'error';

export interface TickTickDailyPlan {
  date: string;
  todayCount: number;
  plannedMinutes: number;
  availableMinutes: number;
  importantCount: number;
  deferredCount: number;
  cycleRiskCount: number;
  oversizedCount: number;
}

interface TickTickStatusResponse {
  dailyPlan?: TickTickDailyPlan;
  budgetMinutes?: number;
  connected: boolean;
  lastSyncAt?: string;
  error?: string;
}

interface TickTickSyncStore {
  dailyPlan?: TickTickDailyPlan;
  budgetMinutes?: number;
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

async function requestTickTick(init: RequestInit = {}) {
  const response = await apiFetch('/api/ticktick-trips', {
    ...init,
    headers: {
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

export async function loadTickTickSyncStatus() {
  const store = useTickTickSyncStatus.getState();
  try {
    const body = await requestTickTick({ method: 'GET' });
    store.setStatus({
      connection: body?.connected ? 'connected' : 'disconnected',
      operation: body?.error ? 'error' : 'idle',
      message: body?.error ?? '',
      lastSyncAt: body?.lastSyncAt,
      dailyPlan: body?.dailyPlan,
      budgetMinutes: body?.budgetMinutes,
    });
    return Boolean(body?.connected);
  } catch (error) {
    store.setStatus({ operation: 'error', message: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

export async function connectTickTick(token: string) {
  const store = useTickTickSyncStatus.getState();
  store.setStatus({ operation: 'connecting', message: '' });
  try {
    const body = await requestTickTick({ method: 'PUT', body: JSON.stringify({ token }) });
    store.setStatus({
      connection: 'connected',
      operation: body?.error ? 'error' : 'idle',
      message: body?.error ?? '',
      lastSyncAt: body?.lastSyncAt,
      dailyPlan: body?.dailyPlan,
      budgetMinutes: body?.budgetMinutes,
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

export async function syncTickTickTrips() {
  const store = useTickTickSyncStatus.getState();
  if (store.connection === 'disconnected') return;
  store.setStatus({ operation: 'syncing', message: '' });
  try {
    const body = await requestTickTick({ method: 'POST' });
    store.setStatus({
      connection: 'connected',
      operation: 'synced',
      message: '',
      lastSyncAt: body?.lastSyncAt,
      dailyPlan: body?.dailyPlan,
      budgetMinutes: body?.budgetMinutes,
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

export async function disconnectTickTick() {
  const store = useTickTickSyncStatus.getState();
  await requestTickTick({ method: 'DELETE' });
  store.setStatus({ connection: 'disconnected', operation: 'idle', message: '', lastSyncAt: undefined });
}

export async function saveTickTickDailyBudget(budgetMinutes: number) {
  const store = useTickTickSyncStatus.getState();
  store.setStatus({ operation: 'syncing', message: '' });
  try {
    const body = await requestTickTick({ method: 'PATCH', body: JSON.stringify({ budgetMinutes }) });
    store.setStatus({ budgetMinutes: body?.budgetMinutes, dailyPlan: body?.dailyPlan });
    await syncTickTickTrips();
  } catch (error) {
    store.setStatus({ operation: 'error', message: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
