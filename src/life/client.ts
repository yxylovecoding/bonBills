import { requestWithRetry } from '../utils/requestWithRetry';
import type { LifeEntry, LifeKind } from '../utils/bonLife';

export class LifeError extends Error {
  constructor(message: string, public status: number, public current?: LifeEntry) { super(message); }
}

export async function lifeRequest<T>(method: string, body?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  return requestWithRetry(async (requestSignal) => {
    const response = await fetch(`/api/bonlife${method === 'GET' ? `?year=${body?.year}` : ''}`, {
      method, credentials: 'same-origin', cache: 'no-store', signal: requestSignal,
      headers: { 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body),
    });
    const result = await response.json().catch((error: unknown) => {
      if (error instanceof SyntaxError) return null;
      throw error;
    });
    if (!response.ok || !result || typeof result !== 'object') {
      throw new LifeError(result?.error || '服务暂不可用，请重试', response.status, result?.current);
    }
    return result;
  }, { signal, retry: method === 'GET', timeoutMessage: '连接超时，请重试', networkMessage: '网络连接失败，请重试' });
}

export interface LifeDraft { date: string; kind: LifeKind; text: string; revision: string; mutationId: string }
export function draftKey(owner: string) { return `bonlife:draft:v1:${encodeURIComponent(owner)}`; }
export function readDraft(owner: string): LifeDraft | null {
  try {
    const value = JSON.parse(localStorage.getItem(draftKey(owner)) || 'null') as LifeDraft | null;
    return value && /^\d{4}-\d{2}-\d{2}$/.test(value.date) && ['skin', 'mood'].includes(value.kind)
      && typeof value.text === 'string' && typeof value.revision === 'string' && typeof value.mutationId === 'string' ? value : null;
  } catch { return null; }
}
