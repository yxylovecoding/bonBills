import { useEffect, useState } from 'react';
import { clothesRequest } from '../clothes/client';
import type { CalendarWeather } from '../utils/calendarWeather';
import { useSyncStatus } from '../utils/syncStatus';

export function useCalendarWeather(month: string, enabled: boolean) {
  const syncState = useSyncStatus((s) => s.state), revision = useSyncStatus((s) => s.revision);
  const [snapshot, setSnapshot] = useState<{ month: string; value: CalendarWeather } | null>(null);
  const [retry, setRetry] = useState(0), [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!enabled || syncState === 'saving') return;
    const abort = new AbortController(); let active = true;
    const end = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
    setBusy(true);
    void clothesRequest<CalendarWeather>('GET', { view: 'calendar-weather', date: `${month}-01`, endDate: `${month}-${end}` }, abort.signal)
      .then((value) => { if (active) setSnapshot({ month, value }); })
      .catch(() => { if (active) setSnapshot({ month, value: { days: {}, error: '天气更新失败' } }); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; abort.abort(); };
  }, [month, enabled, syncState, revision, retry]);
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => { if (!document.hidden) setRetry((v) => v + 1); };
    const timer = window.setInterval(refresh, 30 * 60000);
    window.addEventListener('focus', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [enabled]);
  return { ...(snapshot?.month === month ? snapshot.value : { days: {} }), busy, refresh: () => setRetry((v) => v + 1) };
}
