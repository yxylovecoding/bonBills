import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DoneMonth } from '../utils/bonLife';
import { shiftDoneDate } from '../utils/lifeDone';
import { LifeError, lifeRequest } from './client';

type DateRange = { from: string; to: string };
type LoadedMonth = DoneMonth & DateRange;
type LoadMode = 'extend' | 'refresh' | 'force';

const needsDoneSync = (month: DoneMonth) => Boolean(month.connected && (month.needsTagSync || month.needsDurationSync
  || !month.syncedAt || Date.now() - Date.parse(month.syncedAt) > 300_000)
  || month.outlookConnected && (month.outlookError || !month.outlookSyncedAt || Date.now() - Date.parse(month.outlookSyncedAt) > 300_000));

function monthRanges(firstDate: string, today: string) {
  const ranges: DateRange[] = [];
  for (let from = firstDate; from <= today;) {
    const [year, month] = from.split('-').map(Number);
    const lastDay = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    const to = lastDay < today ? lastDay : today;
    ranges.push({ from, to });
    from = shiftDoneDate(to, 1);
  }
  return ranges;
}

function rangeToRead(wanted: DateRange, loaded: LoadedMonth | undefined, mode: LoadMode): DateRange | null {
  if (!loaded || mode === 'force' || (mode === 'refresh' && (needsDoneSync(loaded) || !(loaded.connected || loaded.outlookConnected)))) return wanted;
  const earlier = wanted.from < loaded.from;
  const later = wanted.to > loaded.to;
  if (earlier && later) return wanted;
  if (earlier) return { from: wanted.from, to: shiftDoneDate(loaded.from, -1) };
  if (later) return { from: shiftDoneDate(loaded.to, 1), to: wanted.to };
  return null;
}

export function useDoneRecords(firstDate: string, today: string, onExpired: () => void) {
  const ranges = useMemo(() => monthRanges(firstDate, today), [firstDate, today]);
  const cache = useRef<Record<string, LoadedMonth>>({});
  const [data, setData] = useState(cache.current);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const queues = useRef(new Map<string, Promise<void>>());

  useEffect(() => {
    const request = new AbortController();
    controller.current = request;
    return () => { request.abort(); queues.current.clear(); };
  }, []);

  const refresh = useCallback((mode: LoadMode) => {
    const signal = controller.current?.signal;
    if (!signal || signal.aborted) return;
    for (const wanted of ranges) {
      const key = wanted.from.slice(0, 7);
      if (!rangeToRead(wanted, cache.current[key], mode)) continue;
      // 快速连续翻周时，同月请求依次补齐缺口，不打断已开始的同步。
      const previous = queues.current.get(key) ?? Promise.resolve();
      const task = previous.then(async () => {
        if (signal.aborted) return;
        const loaded = cache.current[key];
        const range = rangeToRead(wanted, loaded, mode);
        if (!range) return;
        const [year, month] = key.split('-').map(Number);
        const query = { year, month, ...range };
        const store = (value: DoneMonth) => {
          const retained = loaded?.items.filter(item => item.date < range.from || item.date > range.to) ?? [];
          cache.current = { ...cache.current, [key]: { ...value, items: [...retained, ...value.items],
            from: loaded && loaded.from < range.from ? loaded.from : range.from,
            to: loaded && loaded.to > range.to ? loaded.to : range.to } };
          setData(cache.current);
        };
        setErrors(old => { const next = { ...old }; delete next[key]; return next; });
        try {
          const cached = await lifeRequest<DoneMonth>('GET', { view: 'done', ...query }, signal);
          if (signal.aborted) return;
          store(cached);
          if ((cached.connected || cached.outlookConnected) && (mode === 'force' || needsDoneSync(cached))) {
            const result = await lifeRequest<DoneMonth>('POST', { action: 'sync-done', ...query }, signal);
            if (signal.aborted) return;
            store(result);
            if (result.outlookError) setErrors(old => ({ ...old, [key]: result.outlookError! }));
          }
        } catch (cause) {
          if (signal.aborted) return;
          if (cause instanceof LifeError && cause.status === 401) onExpired();
          else setErrors(old => ({ ...old, [key]: cause instanceof Error ? cause.message : '同步失败，请重试' }));
        }
      }).finally(() => {
        if (queues.current.get(key) !== task) return;
        queues.current.delete(key);
        if (!queues.current.size && !signal.aborted) setBusy(false);
      });
      queues.current.set(key, task);
      setBusy(true);
    }
  }, [ranges, onExpired]);

  useEffect(() => { refresh('extend'); }, [refresh]);
  return { data, months: ranges.map(range => data[range.from.slice(0, 7)]), errors, busy, refresh };
}
