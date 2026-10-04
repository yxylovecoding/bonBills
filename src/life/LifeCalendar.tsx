import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { calendarCells, DEFAULT_CYCLE, entrySummary, LIFE_KINDS, LIFE_LABELS, type LifeView, type LifeYear, type TrainingRecord } from '../utils/bonLife';
import { CYCLE_GUIDANCE, cycleDay, cyclePhaseRanges, visibleCycleDay } from '../utils/lifeCycle';
import { requestSession } from '../utils/authClient';
import { LifeError, lifeRequest, readDraft, type LifeDraft } from './client';
import LifeEditor from './LifeEditor';
import LifeConnection from './LifeConnection';
import LifeCycleSettings from './LifeCycleSettings';
import LifeDoneList from './LifeDoneList';
import { useLifeTraining } from './useLifeTraining';
import { monthlyTrainingPlan } from '../utils/lifeTraining';

const LifeBodyTrends = lazy(() => import('./LifeBodyTrends'));

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
    kind: (draft?.kind || (Object.keys(LIFE_LABELS).includes(query.get('kind') || '') ? query.get('kind') : 'skin')) as LifeView,
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
  const [cycleSettings, setCycleSettings] = useState(false);
  const [retry, setRetry] = useState(0);
  const [loggingOut, setLoggingOut] = useState(false);
  const [saved, setSaved] = useState(false);
  const generation = useRef(0);
  const activeSync = useRef<AbortController | null>(null);
  const current = data?.year === year ? data : null;
  const periodSet = new Set(current?.periodDays ?? []);
  const cycle = current?.cycle ?? DEFAULT_CYCLE;
  const cells = calendarCells(year, month);
  const now = today();
  const trainingSource = useLifeTraining(year, kind === 'training' || draft?.kind === 'training' || cycleSettings, onExpired);
  const hasTrainingSource = Boolean(trainingSource.current?.tasks.length);
  const trainingPlan = kind === 'training' ? monthlyTrainingPlan(year, month, now,
    hasTrainingSource ? trainingSource.byDate : undefined, cycle, current?.periodDays ?? [], current?.entries ?? {}) : new Map<string, TrainingRecord>();
  const futurePlanCount = [...trainingPlan].filter(([date, record]) => date >= now && record.plan).length;
  const hasCycle = cells.some((date) => date && cycleDay(date, cycle, current?.periodDays ?? []));

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
      <div className="life-header-actions"><button disabled={!current || loading} onClick={() => setCycleSettings(true)}>经期设置</button><button onClick={() => setSettings(true)}>Outlook<span className={`life-connection-dot${current?.connected ? ' connected' : ''}`} /></button>
        <button onClick={() => void logout()} disabled={loggingOut}>{loggingOut ? '退出中…' : '退出'}</button></div></header>
    <div className="life-toolbar">
      <nav className="life-tabs" aria-label="状态日历">{([...LIFE_KINDS, 'done'] as const).map((value) => <button key={value}
        aria-pressed={kind === value} onClick={() => { setSelection((previous) => ({ ...previous, kind: value,
          ...(value === 'done' && previous.kind !== 'done' ? { year: Number(now.slice(0, 4)), month: Number(now.slice(5, 7)) } : {}) })); setSaved(false); }}>{LIFE_LABELS[value]}</button>)}</nav>
      {kind !== 'done' && <div className="life-date-controls">
        <button className="life-arrow" aria-label="上个月" disabled={year === 1900 && month === 1} onClick={() => shiftMonth(-1)}>‹</button>
        <select aria-label="年份" value={year} onChange={(event) => setSelection((previous) => ({ ...previous, year: Number(event.target.value) }))}>
          {Array.from({ length: 301 }, (_, i) => 2200 - i).map((value) => <option key={value} value={value}>{value} 年</option>)}
        </select>
        <select aria-label="月份" value={month} onChange={(event) => setSelection((previous) => ({ ...previous, month: Number(event.target.value) }))}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((value) => <option key={value} value={value}>{value} 月</option>)}
        </select>
        <button className="life-arrow" aria-label="下个月" disabled={year === 2200 && month === 12} onClick={() => shiftMonth(1)}>›</button>
        <button className="life-today" onClick={() => setSelection((previous) => ({ ...previous, year: Number(now.slice(0, 4)), month: Number(now.slice(5, 7)) }))}>今天</button>
      </div>}
    </div>
    {kind === 'training' && <div className="life-training-heading"><div><h2>{month} 月训练计划</h2>
      <p role="status">{loading || trainingSource.busy ? '安排中…' : !hasCycle ? '待设置经期' : futurePlanCount ? `后续 ${futurePlanCount} 天已安排 · 按体感调整` : '历史训练'}</p></div>
      <button disabled={loading || !current} onClick={() => setCycleSettings(true)}>{hasCycle ? '调整经期' : '设置经期'}</button>
    </div>}
    {kind === 'training' && <section className="life-training-source" aria-label="TickTick 训练计划" aria-busy={trainingSource.busy}>
      <div className="life-done-toolbar"><span role="status">{trainingSource.busy ? '读取训练计划…' : trainingSource.current?.syncedAt ? 'TickTick · 已同步' : 'TickTick · 尚未同步'}</span>
        <button disabled={trainingSource.busy} onClick={() => void trainingSource.refresh(true)}>同步训练</button></div>
      {hasTrainingSource && <details className="life-training-details"><summary>每周训练基础</summary><p className="life-training-schedule">{trainingSource.current!.tasks.map((task) => <span key={task.id}>{task.schedule} · {task.name}</span>)}</p></details>}
      {trainingSource.error && <p className="life-error" role="alert">{trainingSource.error}</p>}
      {!trainingSource.busy && trainingSource.current && !hasTrainingSource && <p className="life-empty-state">{trainingSource.current.connected ? '未找到训练待办' : <>TickTick 未连接 · <a href="https://bonbills.cn/calendar" target="_blank" rel="noreferrer">连接 TickTick ↗</a></>}</p>}
    </section>}
    {kind === 'training' && <details className="life-phase-guide"><summary>运动与饮食 <span>四阶段</span></summary>
      <div>{cyclePhaseRanges(cycle).map(({ phase, start, end }) => {
        const advice = CYCLE_GUIDANCE[phase];
        return <div className={`life-phase-row phase-${phase}`} key={phase}>
          <div className="life-phase-name"><strong>{advice.label}</strong>{advice.subtitle && <span>{advice.subtitle}</span>}<span>第 {start}–{end} 天</span></div>
          <p><span>运动</span>{advice.exercise}</p><p><span>饮食</span>{advice.food}</p></div>;
      })}</div>
      {!cycle.lastPeriodStart && !current?.periodDays.length && <button onClick={() => setCycleSettings(true)} disabled={loading}>设置经期，生成训练计划</button>}
    </details>}
    {kind === 'body' && !error && <Suspense fallback={<p className="life-empty-state" role="status">曲线读取中…</p>}>
      <LifeBodyTrends year={year} month={month} entries={current?.entries} loading={loading} />
    </Suspense>}
    {kind === 'done' ? <LifeDoneList onExpired={onExpired} /> : <section className={`life-calendar${kind === 'training' ? ' life-training-calendar' : ''}`} aria-label={`${year}年${month}月${LIFE_LABELS[kind]}日历`} aria-busy={loading}>
      <div className="life-weekdays">{WEEKDAYS.map((day) => <span key={day}>{day}</span>)}</div>
      <div className="life-days">{cells.map((date, index) => {
        if (!date) return <div className="life-empty-day" key={`empty-${index}`} aria-hidden="true" />;
        const entry = current?.entries[`${kind}:${date}`];
        const period = periodSet.has(date);
        const phase = visibleCycleDay(date, cycle, current?.periodDays ?? [], now);
        const phaseLabel = phase ? `${phase.estimated ? '预计·' : ''}${CYCLE_GUIDANCE[phase.phase].label}` : '';
        const planned = kind === 'training' ? trainingPlan.get(date) : undefined;
        const summary = entrySummary(kind, planned ? { ...entry, text: entry?.text ?? '', revision: entry?.revision ?? '', training: planned } : entry);
        const planStatus = planned?.completed ? '已完成' : entry?.training && planned?.mode !== 'auto' ? '手动安排' : date >= now && planned?.plan ? '自动计划' : '';
        return <button type="button" key={date} disabled={loading || !current || Boolean(error) || (kind === 'training' && trainingSource.busy && !trainingSource.current?.syncedAt)}
          className={`life-day${phase ? ` phase-${phase.phase}` : period ? ' phase-menstrual' : ''}${date === now ? ' is-today' : ''}`}
          aria-label={`${date} ${LIFE_LABELS[kind]} ${phaseLabel}${planStatus ? ` ${planStatus}` : ''}${summary ? `：${summary}` : '：未记录'}`}
          onClick={() => setDraft({ date, kind, text: '', revision: '', ...entry,
            ...(planned ? { training: planned } : {}),
            mutationId: crypto.randomUUID() })}>
          <span className="life-day-heading"><span className="life-day-number">{Number(date.slice(-2))}</span>{phaseLabel && <span className={`life-period-mark phase-${phase?.phase}`} aria-hidden="true">{phaseLabel}</span>}</span>
          <span className="life-day-text">{summary}</span>
          {planStatus && <span className="life-plan-status">{planStatus}</span>}
        </button>;
      })}</div>
    </section>}
    {kind !== 'done' && <footer className="life-footer"><div className="life-footer-left"><div className="life-cycle-key" aria-label="周期阶段">{cyclePhaseRanges(cycle).map(({ phase }) =>
        <span key={phase} className={`life-period-key phase-${phase}`}><i aria-hidden="true" />{CYCLE_GUIDANCE[phase].label}</span>)}</div>
      <button disabled={year <= 1900} onClick={() => setSelection((previous) => ({ ...previous, year: previous.year - 1 }))}>往年同月</button></div>
      <div className="life-sync-status" role="status">{loading ? '读取中…' : saved ? '已保存' : ''}
        {current?.connected ? <button disabled={syncing} onClick={() => void syncPeriods(year, generation.current)}>{syncing ? '经期同步中…' : '同步经期'}</button>
          : <button onClick={() => setSettings(true)}>连接经期日历</button>}</div></footer>}
    {error && <div className="life-error-banner" role="alert">{error}<button onClick={() => setRetry((value) => value + 1)}>重试</button></div>}
    {periodError && <div className="life-error-banner" role="alert">{periodError}<button onClick={() => void syncPeriods(year, generation.current)}>重试</button></div>}
    {draft && current && !loading && <LifeEditor key={`${draft.kind}:${draft.date}`} initial={draft} owner={owner} cycle={cycle} periodDays={current.periodDays} onExpired={onExpired}
      trainingTasks={hasTrainingSource ? trainingSource.byDate.get(draft.date) ?? [] : undefined}
      onClose={() => setDraft(null)} onSave={(entry, savedDraft) => {
        setData((previous) => previous ? { ...previous, entries: { ...previous.entries, [`${savedDraft.kind}:${savedDraft.date}`]: entry } } : previous);
        setDraft(null); setSaved(true);
      }} />}
    {settings && <LifeConnection year={year} connected={current?.connected ?? false} onClose={() => setSettings(false)} onChanged={(connected) => {
      setData((previous) => previous ? { ...previous, connected } : previous);
      if (connected) void syncPeriods(year, generation.current);
      else { activeSync.current?.abort(); setSyncing(false); setPeriodError(''); }
    }} />}
    {cycleSettings && <LifeCycleSettings initial={cycle} year={year} tickTickTraining={hasTrainingSource} onExpired={onExpired} onClose={() => { setCycleSettings(false); setRetry((value) => value + 1); }} onSave={(savedCycle) => {
      setData((previous) => previous ? { ...previous, cycle: savedCycle } : previous); setCycleSettings(false); setSaved(true);
    }} />}
  </main>;
}
