import { useCallback, useEffect, useRef, useState } from 'react';
import { calendarCells, LIFE_LABELS, type LifeKind, type LifeYear } from '../utils/bonLife';
import { requestSession } from '../utils/authClient';
import { LifeError, lifeRequest, readDraft, type LifeDraft } from './client';
import LifeEditor from './LifeEditor';
import LifeConnection from './LifeConnection';

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
function initialDate(draft: LifeDraft | null) {
  const query = new URLSearchParams(window.location.search);
  const date = draft?.date || today();
  const requestedYear = Number(query.get('year'));
  const requestedMonth = Number(query.get('month'));
  return {
    year: !draft && Number.isInteger(requestedYear) && requestedYear >= 1900 && requestedYear <= 2200 ? requestedYear : Number(date.slice(0, 4)),
    month: !draft && requestedMonth >= 1 && requestedMonth <= 12 && Number.isInteger(requestedMonth) ? requestedMonth : Number(date.slice(5, 7)),
    kind: draft?.kind || (query.get('kind') === 'mood' ? 'mood' : 'skin') as LifeKind,
  };
}

export default function LifeCalendar({ owner, onExpired }: { owner: string; onExpired: () => void }) {
  const [draft, setDraft] = useState<LifeDraft | null>(() => readDraft(owner));
  const [selection, setSelection] = useState(() => initialDate(draft));
  const { year, month, kind } = selection;
  const [data, setData] = useState<LifeYear | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [periodError, setPeriodError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [settings, setSettings] = useState(false);
  const [retry, setRetry] = useState(0);
  const [loggingOut, setLoggingOut] = useState(false);
  const [saved, setSaved] = useState(false);
  const generation = useRef(0);
  const activeSync = useRef<AbortController | null>(null);
  const current = data?.year === year ? data : null;
  const periodSet = new Set(current?.periodDays ?? []);
  const cells = calendarCells(year, month);
  const now = today();

  const syncPeriods = useCallback(async (selectedYear: number, token: number) => {
    activeSync.current?.abort();
    const controller = new AbortController();
    activeSync.current = controller;
    setSyncing(true); setPeriodError('');
    try {
      const result = await lifeRequest<Pick<LifeYear, 'connected'> & Partial<Pick<LifeYear, 'periodDays' | 'syncedAt'>>>(
        'POST', { action: 'sync-periods', year: selectedYear }, controller.signal);
      if (token === generation.current && !controller.signal.aborted) setData((previous) => previous?.year === selectedYear ? { ...previous, ...result } : previous);
    } catch (cause) {
      if (controller.signal.aborted || token !== generation.current) return;
      if (cause instanceof LifeError && cause.status === 401) onExpired();
      else setPeriodError(cause instanceof Error ? cause.message : '经期同步失败，请重试');
    } finally { if (token === generation.current && activeSync.current === controller) setSyncing(false); }
  }, [onExpired]);

  useEffect(() => {
    const token = ++generation.current;
    const controller = new AbortController();
    activeSync.current?.abort();
    setLoading(true); setError(''); setPeriodError(''); setSyncing(false); setSaved(false);
    void lifeRequest<LifeYear>('GET', { year }, controller.signal).then((result) => {
      if (token !== generation.current || controller.signal.aborted) return;
      setData(result); setLoading(false);
      if (result.connected) void syncPeriods(year, token);
    }).catch((cause) => {
      if (controller.signal.aborted || token !== generation.current) return;
      setLoading(false);
      if (cause instanceof LifeError && cause.status === 401) onExpired();
      else setError(cause instanceof Error ? cause.message : '读取失败，请重试');
    });
    return () => { controller.abort(); activeSync.current?.abort(); };
  }, [year, retry, onExpired, syncPeriods]);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('year', String(year)); url.searchParams.set('month', String(month)); url.searchParams.set('kind', kind);
    window.history.replaceState(window.history.state, '', url);
  }, [year, month, kind]);

  function shiftMonth(delta: number) {
    const next = new Date(Date.UTC(year, month - 1 + delta, 1));
    if (next.getUTCFullYear() < 1900 || next.getUTCFullYear() > 2200) return;
    setSelection((previous) => ({ ...previous, year: next.getUTCFullYear(), month: next.getUTCMonth() + 1 }));
  }
  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await requestSession({ method: 'DELETE' });
      try { localStorage.setItem('bonlife-logout-at', String(Date.now())); } catch { /* Current page still logs out. */ }
      onExpired();
    } catch { setError('退出失败，请重试'); }
    finally { setLoggingOut(false); }
  }

  return <main className="life-shell">
    <header className="life-header"><h1><span className="life-brand-dot" />BonLife</h1>
      <div className="life-header-actions"><button onClick={() => setSettings(true)}>Outlook<span className={`life-connection-dot${current?.connected ? ' connected' : ''}`} /></button>
        <button onClick={() => void logout()} disabled={loggingOut}>{loggingOut ? '退出中…' : '退出'}</button></div></header>
    <div className="life-toolbar">
      <nav className="life-tabs" aria-label="状态日历">{(['skin', 'mood'] as const).map((value) => <button key={value}
        aria-pressed={kind === value} onClick={() => { setSelection((previous) => ({ ...previous, kind: value })); setSaved(false); }}>{LIFE_LABELS[value]}</button>)}</nav>
      <div className="life-date-controls">
        <button className="life-arrow" aria-label="上个月" disabled={year === 1900 && month === 1} onClick={() => shiftMonth(-1)}>‹</button>
        <select aria-label="年份" value={year} onChange={(event) => setSelection((previous) => ({ ...previous, year: Number(event.target.value) }))}>
          {Array.from({ length: 301 }, (_, i) => 2200 - i).map((value) => <option key={value} value={value}>{value} 年</option>)}
        </select>
        <select aria-label="月份" value={month} onChange={(event) => setSelection((previous) => ({ ...previous, month: Number(event.target.value) }))}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((value) => <option key={value} value={value}>{value} 月</option>)}
        </select>
        <button className="life-arrow" aria-label="下个月" disabled={year === 2200 && month === 12} onClick={() => shiftMonth(1)}>›</button>
        <button className="life-today" onClick={() => setSelection((previous) => ({ ...previous, year: Number(now.slice(0, 4)), month: Number(now.slice(5, 7)) }))}>今天</button>
      </div>
    </div>
    <section className="life-calendar" aria-label={`${year}年${month}月${LIFE_LABELS[kind]}日历`} aria-busy={loading}>
      <div className="life-weekdays">{WEEKDAYS.map((day) => <span key={day}>{day}</span>)}</div>
      <div className="life-days">{cells.map((date, index) => {
        if (!date) return <div className="life-empty-day" key={`empty-${index}`} aria-hidden="true" />;
        const entry = current?.entries[`${kind}:${date}`];
        const period = periodSet.has(date);
        return <button type="button" key={date} disabled={loading || !current || Boolean(error)}
          className={`life-day${period ? ' is-period' : ''}${date === now ? ' is-today' : ''}`}
          aria-label={`${date} ${LIFE_LABELS[kind]}${period ? ' 经期' : ''}${entry?.text ? `：${entry.text}` : '：未记录'}`}
          onClick={() => setDraft({ date, kind, text: entry?.text || '', revision: entry?.revision || '', mutationId: crypto.randomUUID() })}>
          <span className="life-day-heading"><span className="life-day-number">{Number(date.slice(-2))}</span>{period && <span className="life-period-mark" aria-hidden="true">经期</span>}</span>
          <span className="life-day-text">{entry?.text || ''}</span>
        </button>;
      })}</div>
    </section>
    <footer className="life-footer"><div className="life-footer-left"><span className="life-period-key"><i />经期</span>
      <button disabled={year <= 1900} onClick={() => setSelection((previous) => ({ ...previous, year: previous.year - 1 }))}>往年同月</button></div>
      <div className="life-sync-status" role="status">{loading ? '读取中…' : saved ? '已保存' : ''}
        {current?.connected ? <button disabled={syncing} onClick={() => void syncPeriods(year, generation.current)}>{syncing ? '经期同步中…' : '同步经期'}</button>
          : <button onClick={() => setSettings(true)}>连接经期日历</button>}</div></footer>
    {error && <div className="life-error-banner" role="alert">{error}<button onClick={() => setRetry((value) => value + 1)}>重试</button></div>}
    {periodError && <div className="life-error-banner" role="alert">{periodError}<button onClick={() => void syncPeriods(year, generation.current)}>重试</button></div>}
    {draft && current && !loading && <LifeEditor key={`${draft.kind}:${draft.date}`} initial={draft} owner={owner} period={periodSet.has(draft.date)} onExpired={onExpired}
      onClose={() => setDraft(null)} onSave={(entry, savedDraft) => {
        setData((previous) => previous ? { ...previous, entries: { ...previous.entries, [`${savedDraft.kind}:${savedDraft.date}`]: entry } } : previous);
        setDraft(null); setSaved(true);
      }} />}
    {settings && <LifeConnection year={year} connected={current?.connected ?? false} onClose={() => setSettings(false)} onChanged={(connected) => {
      setData((previous) => previous ? { ...previous, connected } : previous);
      if (connected) void syncPeriods(year, generation.current);
      else { activeSync.current?.abort(); setSyncing(false); setPeriodError(''); }
    }} />}
  </main>;
}
