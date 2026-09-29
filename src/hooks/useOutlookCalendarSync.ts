import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../utils/authClient';
import { DEFAULT_OUTLOOK_RULES, reconcileOutlookSnapshot, type OutlookConflictPolicy, type OutlookSnapshot } from '../utils/outlookCalendar';
import { useCalendarStore } from '../stores/calendarStore';
import { triggerUpload } from '../utils/syncEngine';
import { useSyncStatus } from '../utils/syncStatus';

interface Reply {
  connected?: boolean;
  snapshot?: OutlookSnapshot;
  policy?: OutlookConflictPolicy;
}

function monthRange(yearMonth: string) {
  const [year, month] = yearMonth.split('-').map(Number);
  return { startDate: `${yearMonth}-01`, endDate: `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}-01` };
}

export function useOutlookCalendarSync(yearMonth: string, enabled: boolean) {
  const syncReady = useSyncStatus((state) => state.ready);
  const [connected, setConnected] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [playUrl, setPlayUrl] = useState('');
  const [classUrl, setClassUrl] = useState('');
  const [policy, setPolicy] = useState<OutlookConflictPolicy>('manual');
  const [preview, setPreview] = useState<OutlookSnapshot | null>(null);
  const [message, setMessage] = useState('');
  const [syncedAt, setSyncedAt] = useState('');
  const requestId = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const lastAutomaticSync = useRef(0);
  const tagMap = useCalendarStore((state) => state.tagMap);
  const applied = useCalendarStore((state) => state.outlookApplied);
  const manualDates = useCalendarStore((state) => state.manualTagDates);
  const range = monthRange(yearMonth);

  const apply = (reply: Reply) => {
    if (!reply.snapshot || !reply.policy) throw new Error('日历同步结果无效');
    useCalendarStore.getState().applyOutlookSnapshot(reply.snapshot, reply.policy);
    setSyncedAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
    void triggerUpload();
  };

  async function request(method: string, body?: unknown, signal?: AbortSignal): Promise<Reply> {
    const response = await apiFetch('/api/outlook-calendar', {
      method, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(40_000)]) : AbortSignal.timeout(40_000),
      ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    });
    const reply = await response.json() as Reply & { error?: string };
    if (!response.ok) throw new Error(reply.error || 'Outlook 同步失败');
    return reply;
  }

  useEffect(() => {
    if (!syncReady || !enabled) return;
    let active = true;
    let running = false;
    setPreview(null);
    setSyncedAt('');
    setMessage('');
    setLoaded(false);
    setBusy(true);
    const update = async (initial = false) => {
      if (running || (!initial && document.visibilityState !== 'visible')
        || (!initial && Date.now() - lastAutomaticSync.current < 5 * 60_000)) return;
      running = true;
      const id = ++requestId.current;
      const abort = new AbortController();
      controller.current = abort;
      try {
        const status = await request('GET', undefined, abort.signal);
        if (!active || id !== requestId.current) return;
        setConnected(Boolean(status.connected));
        setLoaded(true);
        setMessage('');
        if (!status.connected) return;
        setBusy(true);
        const reply = await request('POST', monthRange(yearMonth), abort.signal);
        if (!active || id !== requestId.current) return;
        setConnected(Boolean(reply.connected));
        if (reply.connected) apply(reply);
        lastAutomaticSync.current = Date.now();
        setMessage('');
      } catch (error) {
        if (active && id === requestId.current) setMessage(error instanceof Error ? error.message : 'Outlook 同步失败');
      } finally {
        running = false;
        if (active && id === requestId.current) { setBusy(false); setLoaded(true); lastAutomaticSync.current = Date.now(); }
      }
    };
    void update(true);
    const onFocus = () => { void update(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    const timer = window.setInterval(onFocus, 5 * 60_000);
    return () => {
      active = false;
      ++requestId.current;
      controller.current?.abort();
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [yearMonth, syncReady, enabled]);

  const run = async (action: 'preview' | 'connect' | 'sync' | 'disconnect') => {
    // Invalidate background reads, including a response finishing after disconnect.
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const id = ++requestId.current;
    setBusy(true);
    setMessage('');
    try {
      const input = { ...range, playUrl, classUrl, policy, rules: DEFAULT_OUTLOOK_RULES };
      const reply = await request(action === 'disconnect' ? 'DELETE' : action === 'connect' ? 'PUT' : 'POST',
        action === 'disconnect' ? undefined : action === 'preview' ? { ...input, action: 'preview' }
          : action === 'connect' ? input : range, abort.signal);
      if (id !== requestId.current) return;
      if (action === 'preview') {
        if (!reply.snapshot) throw new Error('日历同步结果无效');
        setPreview(reply.snapshot);
      } else if (action === 'disconnect') {
        setConnected(false);
        setSyncedAt('');
        setPreview(null);
      } else {
        setConnected(Boolean(reply.connected));
        if (reply.connected) apply(reply);
        setEditing(false);
        setPreview(null);
        setPlayUrl('');
        setClassUrl('');
      }
    } catch (error) {
      if (id === requestId.current) setMessage(error instanceof Error ? error.message : 'Outlook 同步失败');
    } finally {
      if (id === requestId.current) { setBusy(false); lastAutomaticSync.current = Date.now(); }
    }
  };

  const projected = preview ? reconcileOutlookSnapshot(tagMap, applied, manualDates, preview, policy).tagMap : null;
  const changes = projected ? [...new Set([...Object.keys(tagMap), ...Object.keys(projected)])]
    .filter((day) => day.startsWith(yearMonth) && tagMap[day] !== projected[day]).sort() : [];

  return {
    yearMonth, connected, loaded, busy, editing, setEditing,
    playUrl, setPlayUrl, classUrl, setClassUrl, policy, setPolicy,
    preview, setPreview, message, syncedAt, projected, changes, run,
  };
}
