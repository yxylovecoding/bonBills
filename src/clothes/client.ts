import { requestWithRetry } from '../utils/requestWithRetry';
import { accountFetch, accountRequestHeaders } from '../utils/authClient';
export { compressPhoto } from './photoCompression';

export class ClothesError extends Error {
  constructor(message: string, public status: number, public current?: unknown, public wardrobeChanged = false) { super(message); }
}
export async function clothesRequest<T>(method: 'GET' | 'POST', body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const query = new URLSearchParams(Object.entries(body).map(([key, value]) => [key, String(value)]));
  return requestWithRetry(async (requestSignal) => {
    const response = await accountFetch(`/api/bonclothes${method === 'GET' ? `?${query}` : ''}`, {
      method, signal: requestSignal,
      headers: { 'Content-Type': 'application/json' }, body: method === 'POST' ? JSON.stringify(body) : undefined,
    });
    const result = await response.json();
    if (!response.ok) throw new ClothesError(result.error || '请求失败，请重试', response.status, result.current, result.wardrobeChanged);
    return result;
  }, { signal, retry: method === 'GET', timeoutMessage: '连接超时，请重试', networkMessage: '网络连接失败，请重试' });
}
export function readLocal<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback; } catch { return fallback; }
}
export function writeLocal(key: string, value: unknown) {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value)); } catch { /* Keep live edits if storage is unavailable. */ }
}
export function photoUrl(id: string) {
  const account = accountRequestHeaders()['X-BonBills-Account'] ?? '';
  return `/api/bonclothes?view=photo&id=${encodeURIComponent(id)}&account=${encodeURIComponent(account)}`;
}
