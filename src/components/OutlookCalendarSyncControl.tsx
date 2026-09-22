import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../utils/authClient';
import { DEFAULT_OUTLOOK_RULES, reconcileOutlookSnapshot, type OutlookConflictPolicy, type OutlookSnapshot } from '../utils/outlookCalendar';
import { useCalendarStore } from '../stores/calendarStore';
import { triggerUpload } from '../utils/syncEngine';
import { tagMeta } from '../data/mockData';

const BUTTON: React.CSSProperties = { border: '1px solid #dadce0', borderRadius: 7, background: '#fff', color: '#1a73e8', cursor: 'pointer', fontSize: 11, padding: '4px 7px' };
const INPUT: React.CSSProperties = { width: '100%', minWidth: 0, border: '1px solid #dadce0', borderRadius: 7, padding: '6px 8px', fontSize: 12, boxSizing: 'border-box' };

interface Reply {
  connected?: boolean;
  snapshot?: OutlookSnapshot;
  policy?: OutlookConflictPolicy;
}

function monthRange(yearMonth: string) {
  const [year, month] = yearMonth.split('-').map(Number);
  return { startDate: `${yearMonth}-01`, endDate: `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}-01` };
}

export default function OutlookCalendarSyncControl({ yearMonth }: { yearMonth: string }) {
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
  }, [yearMonth]); // Only a changed month starts a new subscription read.

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

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <span role="status" style={{ fontSize: 12, color: message ? '#ea4335' : '#5f6368' }}>
          Outlook · {busy ? '同步中…' : !loaded ? '加载中…' : message ? '同步失败' : !connected ? '未连接' : syncedAt ? `已同步 ${syncedAt}` : '已连接'}
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          {connected ? <>
            <button type="button" disabled={busy} onClick={() => void run('sync')} style={BUTTON}>同步本月</button>
            <button type="button" disabled={busy} onClick={() => void run('disconnect')} style={{ ...BUTTON, border: 'none', color: '#5f6368' }}>断开</button>
          </> : <button type="button" disabled={busy} onClick={() => setEditing((value) => !value)} aria-expanded={editing} style={BUTTON}>{editing ? '收起' : '连接'}</button>}
        </div>
      </div>
      {editing && !connected && (
        <form onSubmit={(event) => { event.preventDefault(); void run(preview ? 'connect' : 'preview'); }} style={{ marginTop: 10, display: 'grid', gap: 8 }}>
          <label style={{ fontSize: 11, color: '#5f6368' }}>玩 · ICS
            <input type="password" autoComplete="off" disabled={busy} aria-label="玩日历 ICS 链接" value={playUrl} onChange={(event) => { setPlayUrl(event.target.value); setPreview(null); }} style={{ ...INPUT, marginTop: 4 }} />
          </label>
          <label style={{ fontSize: 11, color: '#5f6368' }}>课 · ICS
            <input type="password" autoComplete="off" disabled={busy} aria-label="课日历 ICS 链接" value={classUrl} onChange={(event) => { setClassUrl(event.target.value); setPreview(null); }} style={{ ...INPUT, marginTop: 4 }} />
          </label>
          <label style={{ fontSize: 11, color: '#5f6368' }}>冲突时
            <select disabled={busy} aria-label="Outlook 同步优先级" value={policy} onChange={(event) => setPolicy(event.target.value as OutlookConflictPolicy)} style={{ ...INPUT, marginTop: 4 }}>
              <option value="manual">保留手动标记</option><option value="outlook">以 Outlook 为准</option>
            </select>
          </label>
          {preview && <div style={{ fontSize: 11, color: '#5f6368' }}>
            <div style={{ marginBottom: 6 }}>{yearMonth} · {changes.length ? `待更新 ${changes.length} 天` : '暂无待更新日期'}</div>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', maxHeight: 180, overflowY: 'auto' }}>
              {changes.map((day) => <span key={day} style={{ padding: '3px 6px', background: '#f1f3f4', borderRadius: 6 }}>
                {day.slice(5).replace('-', '/')} · {projected?.[day] ? tagMeta[projected[day]].label : '未标记'}
              </span>)}
            </div>
          </div>}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <a href="https://support.microsoft.com/en-us/outlook/share-your-calendar-in-outlook-com" target="_blank" rel="noreferrer" style={{ fontSize: 11, color: '#5f6368' }}>获取订阅链接 ↗</a>
            <button type="submit" disabled={busy || (!playUrl.trim() && !classUrl.trim())} style={BUTTON}>{preview ? '连接并同步' : '预览本月'}</button>
          </div>
        </form>
      )}
      {message && <div role="alert" style={{ marginTop: 6, fontSize: 11, color: '#ea4335' }}>{message}</div>}
    </div>
  );
}
