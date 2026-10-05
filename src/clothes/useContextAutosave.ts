import { useEffect, useState, useSyncExternalStore } from 'react';
import { clothesRequest, readLocal, writeLocal } from './client';
import { ContextAutosave, type ContextPending } from './contextAutosave';
import type { ClothesDayContext } from './types';

const queues = new Map<string, ContextAutosave>();
export function useContextAutosave(key: string, initial: ClothesDayContext) {
  const [queue] = useState(() => {
    let queue = queues.get(key);
    if (!queue) {
      const legacy = readLocal<ClothesDayContext | null>(key, null);
      const pending = readLocal<ContextPending | null>(`${key}:sync`, legacy ? { context: legacy, mutationId: crypto.randomUUID() } : null);
      queue = new ContextAutosave(initial, pending, async (request) => {
        const { value } = await clothesRequest<{ value: ClothesDayContext }>('POST', { action: 'save-context', ...request });
        return value;
      }, (pending) => { writeLocal(key, pending?.context ?? null); writeLocal(`${key}:sync`, pending); });
      queues.set(key, queue);
    }
    return queue;
  });
  const state = useSyncExternalStore(queue.subscribe, queue.snapshot);
  useEffect(() => { queue.accept(initial); queue.schedule(); }, [queue, initial]);
  useEffect(() => {
    const flush = () => { void queue.flush(); };
    window.addEventListener('online', flush); window.addEventListener('pagehide', flush);
    return () => { window.removeEventListener('online', flush); window.removeEventListener('pagehide', flush); void queue.flush(); };
  }, [queue]);
  return { ...state, queue };
}
