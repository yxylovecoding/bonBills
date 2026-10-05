import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { apiFetch } from '../utils/authClient';

interface Status {
  provider?: 'microsoft' | 'make';
  connected: boolean; enabled: boolean; clientId?: string; calendarId?: string; calendarName?: string;
  lastSyncAt?: string; error?: string; calendars?: { id: string; name: string; isDefaultCalendar?: boolean }[];
}
interface Flow { flowId: string; userCode: string; verificationUrl: string; interval: number; expiresAt: number }
const endpoint = '/api/outlook-calendar?app=write';
const button: CSSProperties = { border: 'none', borderRadius: 8, padding: '7px 10px', background: '#f1f3f4', color: '#1a73e8', fontSize: 12, cursor: 'pointer' };
const field: CSSProperties = { minWidth: 0, width: '100%', border: '1px solid #dadce0', borderRadius: 8, padding: '7px 8px', fontSize: 13, boxSizing: 'border-box' };
async function request<T>(method: string, body?: unknown, calendars = false): Promise<T> {
  const response = await apiFetch(`${endpoint}${calendars ? '&calendars=true' : ''}`, { method,
    headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'Outlook 连接失败');
  return data as T;
}
export default function OutlookLaundryControl() {
  const [status, setStatus] = useState<Status | null>(null), [expanded, setExpanded] = useState(false);
  const [clientId, setClientId] = useState(''), [calendarId, setCalendarId] = useState('');
  const [webhookUrl, setWebhookUrl] = useState(''), [direct, setDirect] = useState(false);
  const [flow, setFlow] = useState<Flow | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    void request<Status>('GET').then(data => { if (alive.current) { setStatus(data); setClientId(data.clientId ?? ''); } })
      .catch(cause => { if (alive.current) setError(cause.message); });
    return () => { alive.current = false; };
  }, []);
  async function loadCalendars() {
    const data = await request<Status>('GET', undefined, true);
    if (!alive.current) return;
    setStatus(data); setCalendarId(data.calendarId ?? data.calendars?.find(calendar => calendar.isDefaultCalendar)?.id
      ?? data.calendars?.find(calendar => calendar.name === '日历')?.id ?? '');
  }
  useEffect(() => {
    if (!flow) return;
    let canceled = false, timer: ReturnType<typeof setTimeout>;
    async function poll() {
      if (Date.now() >= flow!.expiresAt) { setFlow(null); setError('授权已过期，请重新连接'); return; }
      try {
        const result = await request<{ pending: boolean; interval?: number }>('POST', { action: 'poll', flowId: flow!.flowId });
        if (canceled) return;
        if (result.pending) timer = setTimeout(() => void poll(), (result.interval ?? flow!.interval) * 1000);
        else { setFlow(null); setStatus(current => ({ ...current, connected: true, enabled: false })); await loadCalendars(); }
      } catch (cause) { if (!canceled) { setFlow(null); setError(cause instanceof Error ? cause.message : '授权失败'); } }
    }
    timer = setTimeout(() => void poll(), flow.interval * 1000);
    return () => { canceled = true; clearTimeout(timer); };
  }, [flow]);
  async function run(action: 'start' | 'make' | 'select' | 'disconnect' | 'calendars') {
    setBusy(true); setError('');
    try {
      if (action === 'start') { const data = await request<Flow>('POST', { action, clientId: clientId.trim() }); if (alive.current) setFlow(data); }
      else if (action === 'make') {
        const data = await request<Status>('POST', { action, webhookUrl: webhookUrl.trim() });
        if (alive.current) { setWebhookUrl(''); setStatus(data); setCalendarId(data.calendars?.find(calendar => calendar.isDefaultCalendar)?.id ?? ''); }
      }
      else if (action === 'calendars') await loadCalendars();
      else {
        const data = await request<Status>(action === 'disconnect' ? 'DELETE' : 'POST', action === 'select' ? { action, calendarId } : undefined);
        if (alive.current) { setStatus(data); setFlow(null); setExpanded(false); }
      }
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : '连接失败'); }
    finally { if (alive.current) setBusy(false); }
  }
  return <div style={{ border: '1px solid #f1f3f4', borderRadius: 10, padding: '9px 10px', marginBottom: 12 }}>
    <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center' }}>
      <div><div style={{ fontSize: 13, fontWeight: 700 }}>洗衣日程 · Outlook</div>
        <div role="status" style={{ fontSize: 11, color: '#5f6368', marginTop: 3 }}>
          {status?.error ? '同步失败' : status?.enabled ? `已开启 · ${status.calendarName}` : status?.connected ? '待选择日历' : status ? '未连接' : error ? '连接失败' : '加载中…'}
        </div></div>
      <button type="button" style={button} aria-expanded={expanded} disabled={busy || !status}
        onClick={() => { setExpanded(value => !value); if (!expanded && status?.connected && !status.enabled) void run('calendars'); }}>
        {expanded ? '收起' : status?.connected ? '管理' : '连接'}
      </button>
    </div>
    {expanded && <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
      {!status?.connected && !flow && <>
        {!direct && <>
          <label style={{ fontSize: 12 }}>Make Webhook<input aria-label="Make Webhook" type="password" value={webhookUrl} disabled={busy} autoComplete="off"
            style={{ ...field, marginTop: 4 }} onChange={event => setWebhookUrl(event.target.value)} /></label>
          <button type="button" style={button} disabled={busy || !webhookUrl.trim()} onClick={() => void run('make')}>连接 Make</button>
        </>}
        {direct && <>
        <label style={{ fontSize: 12 }}>微软应用 ID<input aria-label="微软应用 ID" value={clientId} disabled={busy} autoComplete="off"
          style={{ ...field, marginTop: 4 }} onChange={event => setClientId(event.target.value)} /></label>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <a href="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#1a73e8' }}>微软应用注册</a>
          <button type="button" style={button} disabled={busy || !clientId.trim()} onClick={() => void run('start')}>登录微软授权</button>
        </div>
        </>}
        <button type="button" style={{ ...button, color: '#5f6368', justifySelf: 'start' }} disabled={busy} onClick={() => setDirect(value => !value)}>{direct ? '使用 Make' : '使用自有微软应用'}</button>
      </>}
      {flow && <>
        <div style={{ fontSize: 12 }}>授权码 <strong style={{ userSelect: 'all', letterSpacing: 2 }}>{flow.userCode}</strong></div>
        <a href={flow.verificationUrl} target="_blank" rel="noreferrer" style={{ ...button, textAlign: 'center', textDecoration: 'none' }}>前往微软授权</a>
        <div role="status" style={{ fontSize: 12, color: '#5f6368' }}>等待授权…</div>
        <button type="button" style={{ ...button, color: '#5f6368' }} disabled={busy} onClick={() => void run('disconnect')}>取消授权</button>
      </>}
      {status?.connected && !status.enabled && <>
        <select aria-label="洗衣日程日历" style={field} disabled={busy} value={calendarId} onChange={event => setCalendarId(event.target.value)}>
          <option value="">选择日历</option>{status.calendars?.map(calendar => <option value={calendar.id} key={calendar.id}>{calendar.name}</option>)}
        </select>
        <button type="button" style={button} disabled={busy || !calendarId} onClick={() => void run('select')}>开启同步</button>
      </>}
      {status?.enabled && status.lastSyncAt && <div style={{ fontSize: 12, color: '#5f6368' }}>已同步 {new Date(status.lastSyncAt).toLocaleString('zh-CN')}</div>}
      {status?.connected && <button type="button" style={{ ...button, color: '#5f6368' }} disabled={busy} onClick={() => void run('disconnect')}>断开连接</button>}
      {status?.error && <div role="status" style={{ fontSize: 12, color: '#ea4335' }}>{status.error}</div>}
    </div>}
    {error && <div role="status" style={{ fontSize: 12, color: '#ea4335', marginTop: 8 }}>{error}</div>}
  </div>;
}
