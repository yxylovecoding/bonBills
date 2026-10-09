import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { DoneItem, DoneMonth } from '../utils/bonLife';
import type { TickTickPlanDetails } from '../utils/tickTickPlanDetails';
import { requestWithRetry } from '../utils/requestWithRetry';
import { accountRequestHeaders } from '../utils/authClient';
import { doneWeekDates, doneWeekMonths, doneWeekNumber, earlierDoneWeeks, computeDoneDurations, groupDoneCategories, groupDoneWeek, shiftDoneDate } from '../utils/lifeDone';
import { LifeError, lifeRequest } from './client';
import LifePlanDetails from './LifePlanDetails';
import OutlookLaundryControl from '../components/OutlookLaundryControl';

const shanghaiToday = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
const completionTime = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' });
const weekdays = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

// 每次加载 DoneList 页面时自动触发一次重排（静默，不打扰用户）。
// 使用模块级 flag 避免因组件在同一次会话内多次挂载/卸载重复触发。
let autoReplanDispatched = false;

function DoneDay({ date, index, items, today, pending, busy, error }: {
  date: string; index: number; items: DoneItem[]; today: string; pending: boolean; busy: boolean; error: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const isToday = date === today;
  const open = isToday || expanded;
  const future = date > today;
  const groups = groupDoneCategories(items);
  // 今日视图下按完成时间戳差值推算每个任务的耗时，并把耗时映射为任务块的最小高度，
  // 让耗时越长的任务块在列里占的垂直空间越大，形成类似时间轴块的视觉效果。
  const durations = isToday ? computeDoneDurations(items) : null;
  const blockStyle = (id: string): CSSProperties | undefined => {
    if (!durations) return undefined;
    const minutes = durations.get(id) ?? 15;
    // 2px/分钟，夹在 28~220px 之间，避免极短/极长任务把列拉成极端比例。
    const height = Math.min(220, Math.max(28, Math.round(minutes * 2)));
    return { minHeight: `${height}px` };
  };
  return <section className={`life-week-day${isToday ? ' is-today' : ''}${future ? ' is-future' : ''}`} aria-label={`${date}完成记录`}>
    <header className="life-week-day-heading"><time dateTime={date}>{Number(date.slice(8))}</time><span>{weekdays[index]}</span>{isToday && <span className="life-week-today">今天</span>}</header>
    <div className="life-week-day-content">
      {future ? null : pending && !items.length ? <p className="life-week-empty">{busy ? '读取中…' : error ? '暂未读到记录' : '等待同步'}</p> : <>
        {open ? <div className={`life-week-categories${durations ? ' is-timeline' : ''}`}>{groups.map((group) => <section className="life-week-category" key={group.category} aria-label={`${group.category} · ${group.items.length} 项完成`}>
          <h3>{group.category}<span>{group.items.length}</span></h3>
          {group.items.length ? <ul>{group.items.map((item) => <li key={item.id} style={blockStyle(item.id)} title={durations ? `约 ${Math.round(durations.get(item.id) ?? 0)} 分钟` : undefined}><span className="life-done-task-title">{item.title}</span><time dateTime={item.completedAt}>{completionTime.format(new Date(item.completedAt))}</time></li>)}</ul> : <p className="life-week-category-empty">—</p>}
        </section>)}</div> : <div className="life-week-day-summary">{groups.map((group) => <span key={group.category}>{group.category}<span>{group.items.length}</span></span>)}</div>}
        {!isToday && items.length > 0 && <button className="life-week-expand" aria-expanded={open} onClick={() => setExpanded((value) => !value)}>{open ? '收起' : `展开 ${items.length} 项`}</button>}
      </>}
    </div>
  </section>;
}

export default function LifeDoneList({ onExpired }: { onExpired: () => void }) {
  const [today, setToday] = useState(shanghaiToday);
  const thisWeek = doneWeekDates(today)[0];
  const [weeks, setWeeks] = useState(() => [...earlierDoneWeeks(thisWeek, 3), thisWeek]);
  const [data, setData] = useState<Record<string, DoneMonth>>({});
  const cache = useRef<Record<string, DoneMonth>>({});
  const [busy, setBusy] = useState(false);
  const [replanning, setReplanning] = useState(false);
  const [replanMessage, setReplanMessage] = useState('');
  const [planDetails, setPlanDetails] = useState<TickTickPlanDetails | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsError, setDetailsError] = useState('');
  const detailsController = useRef<AbortController | null>(null);
  const [replanError, setReplanError] = useState('');
  const replanController = useRef<AbortController | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const controller = useRef<AbortController | null>(null);
  const refreshedAt = useRef(0);
  const strip = useRef<HTMLDivElement>(null);
  const positioned = useRef(false);
  const beforePrepend = useRef<{ width: number; left: number } | null>(null);
  const goToLatest = useRef(false);
  const [atLatest, setAtLatest] = useState(true);
  const monthKey = [...new Set(weeks.flatMap((week) => doneWeekMonths(week, today)))].sort().join(',');
  const refresh = useCallback(async (force = false) => {
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    setBusy(true); setErrors({}); refreshedAt.current = Date.now();
    await Promise.all(monthKey.split(',').filter(Boolean).map(async (key) => {
      const [year, month] = key.split('-').map(Number);
      const store = (value: DoneMonth) => { cache.current[key] = value; setData((previous) => ({ ...previous, [key]: value })); };
      try {
        const local = cache.current[key];
        if (!force && local?.syncedAt && !local.needsTagSync && Date.now() - Date.parse(local.syncedAt) < 300_000) return;
        const cached = await lifeRequest<DoneMonth>('GET', { view: 'done', year, month }, request.signal);
        if (request.signal.aborted) return;
        store(cached);
        if (cached.connected && (force || cached.needsTagSync || !cached.syncedAt || Date.now() - Date.parse(cached.syncedAt) > 300_000)) {
          const result = await lifeRequest<DoneMonth>('POST', { action: 'sync-done', year, month }, request.signal);
          if (!request.signal.aborted) store(result);
        }
      } catch (cause) {
        if (request.signal.aborted) return;
        if (cause instanceof LifeError && cause.status === 401) onExpired();
        else setErrors((previous) => ({ ...previous, [key]: cause instanceof Error ? cause.message : '同步失败，请重试' }));
      }
    }));
    if (!request.signal.aborted) setBusy(false);
  }, [monthKey, onExpired]);
  async function triggerReplan() {
    if (busy || replanController.current) return;
    const request = new AbortController(); replanController.current = request;
    const timer = window.setTimeout(() => request.abort(), 20_000);
    setReplanning(true); setReplanError(''); setReplanMessage('');
    try {
      const response = await fetch('/api/ticktick-trips?action=trigger-replan', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: request.signal,
        headers: accountRequestHeaders(),
      });
      if (response.status === 401) { onExpired(); return; }
      const result = await response.json() as { triggered?: boolean; error?: string };
      if (!response.ok || !result.triggered) throw new Error(result.error || '触发重排失败，请重试');
      if (!request.signal.aborted) setReplanMessage('已触发重排 · Outlook、今日重要之事和今日事将依次更新');
    } catch (cause) {
      if (!request.signal.aborted) setReplanError(cause instanceof TypeError
        ? '触发请求失败，请检查网络后重试' : cause instanceof Error ? cause.message : '触发重排失败，请重试');
      else setReplanError('触发结果暂未确认，请稍后查看 GitHub Actions');
    } finally {
      clearTimeout(timer);
      if (replanController.current === request) replanController.current = null;
      setReplanning(false);
    }
  }
  useEffect(() => () => { replanController.current?.abort(); }, []);
  // 页面打开时自动静默触发一次重排任务，等价于用户点击「重排任务」按钮，
  // 不走组件状态，避免打扰用户；失败也静默忽略。
  useEffect(() => {
    if (autoReplanDispatched) return;
    autoReplanDispatched = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 20_000);
    void (async () => {
      try {
        await fetch('/api/ticktick-trips?action=trigger-replan', {
          method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
          headers: accountRequestHeaders(),
        });
      } catch { /* 静默忽略触发失败，用户仍可手动点击「重排任务」。*/ }
      finally { clearTimeout(timer); }
    })();
    return () => { clearTimeout(timer); controller.abort(); };
  }, []);
  useEffect(() => {
    const request = new AbortController(); detailsController.current = request;
    setDetailsError('');
    void requestWithRetry(async signal => {
      const response = await fetch('/api/ticktick-trips?action=plan-details', { credentials: 'same-origin', headers: accountRequestHeaders(), cache: 'no-store', signal });
      if (response.status === 401) { onExpired(); return null; }
      const data = await response.json() as { details?: TickTickPlanDetails | null; error?: string };
      if (!response.ok) throw new Error(data.error || '排期详情读取失败');
      return data.details ?? null;
    }, { signal: request.signal, retry: true, timeoutMessage: '排期详情读取超时，请刷新重试', networkMessage: '排期详情读取失败，请刷新重试' })
      .then(details => { if (!request.signal.aborted) setPlanDetails(details); })
      .catch(cause => { if (!request.signal.aborted) setDetailsError(cause instanceof Error ? cause.message : '排期详情读取失败'); });
    return () => request.abort();
  }, [today, onExpired]);
  useEffect(() => {
    void refresh();
    const update = () => {
      setToday(shanghaiToday());
      if (!replanController.current && document.visibilityState === 'visible' && Date.now() - refreshedAt.current > 300_000) void refresh();
    };
    window.addEventListener('focus', update); document.addEventListener('visibilitychange', update);
    const timer = window.setInterval(update, 300_000);
    return () => { controller.current?.abort(); clearInterval(timer); window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update); };
  }, [refresh]);
  useEffect(() => {
    if (weeks[weeks.length - 1] >= thisWeek) return;
    goToLatest.current = atLatest;
    setWeeks((previous) => {
      const next = [...previous];
      for (let week = shiftDoneDate(next[next.length - 1], 7); week <= thisWeek; week = shiftDoneDate(week, 7)) next.push(week);
      return next;
    });
  }, [thisWeek, weeks, atLatest]);
  useLayoutEffect(() => {
    const element = strip.current;
    if (!element) return;
    if (!positioned.current || goToLatest.current) {
      element.scrollLeft = element.scrollWidth - element.clientWidth;
      positioned.current = true; goToLatest.current = false;
    } else if (beforePrepend.current) {
      element.scrollLeft = beforePrepend.current.left + element.scrollWidth - beforePrepend.current.width;
      beforePrepend.current = null;
    }
  }, [weeks]);
  function loadEarlier(offset = 0) {
    const element = strip.current;
    if (!element || beforePrepend.current) return;
    const earlier = earlierDoneWeeks(weeks[0]);
    if (!earlier.length) return;
    beforePrepend.current = { width: element.scrollWidth, left: element.scrollLeft + offset };
    setWeeks((previous) => [...earlier, ...previous]);
  }
  function move(direction: number) {
    const element = strip.current;
    if (!element) return;
    const page = element.querySelector<HTMLElement>('.life-week-page');
    const distance = (page?.offsetWidth ?? element.clientWidth) + 24;
    if (direction < 0 && element.scrollLeft < distance && weeks[0] > '1900-01-01') { loadEarlier(-distance); return; }
    element.scrollBy({ left: direction * distance, behavior: 'smooth' });
  }
  const months = monthKey.split(',').filter(Boolean).map((key) => data[key]);
  const syncedAt = months.every((value) => value?.syncedAt) ? months.map((value) => value.syncedAt!).sort()[0] : null;
  return <section className="life-done" aria-label="DoneList 周本" aria-busy={busy || replanning}>
    <div className="life-done-heading"><h2>完成周本</h2><nav className="life-week-navigation" aria-label="翻阅周本">
      <button className="life-arrow" aria-label="上一周" onClick={() => move(-1)}>‹</button>
      <button className="life-today" onClick={() => strip.current?.scrollTo({ left: strip.current.scrollWidth, behavior: 'smooth' })}>本周</button>
      <button className="life-arrow" aria-label="下一周" disabled={atLatest} onClick={() => move(1)}>›</button>
    </nav></div>
    <div className="life-done-toolbar"><span role="status">{replanning ? '重排中…' : busy ? '同步中…' : planDetails ? <button className="life-plan-trigger" aria-expanded={detailsOpen} aria-controls="life-plan-details" onClick={() => setDetailsOpen(open => !open)}>
      {replanMessage || `上次排期 · 剩余 ${planDetails.selected.length} 项 · 约 ${planDetails.selected.reduce((sum, task) => sum + task.minutes, 0)} 分钟`}
    </button> : replanMessage || (syncedAt ? `${completionTime.format(new Date(syncedAt))} 已同步` : '尚未同步')}</span>
      <div className="life-done-actions"><button disabled={busy || replanning} onClick={() => void triggerReplan()}>{replanning ? '触发中…' : '重排任务'}</button>
        <button disabled={busy || replanning} onClick={() => void refresh(true)}>同步 TickTick</button></div></div>
    <OutlookLaundryControl />
    {replanError && <p className="life-error" role="alert">{replanError}</p>}
    {detailsError && <p className="life-error" role="alert">{detailsError}</p>}
    {detailsOpen && planDetails && <LifePlanDetails plan={planDetails} />}
    {Object.entries(errors).map(([key, error]) => <p className="life-error" role="alert" key={key}>{key.replace('-', ' 年 ')} 月 · {error}</p>)}
    {months.some((value) => value && !value.connected) && <p className="life-empty-state">TickTick 未连接 · <a href="https://bill.bonbills.cn/calendar" target="_blank" rel="noreferrer">连接 TickTick ↗</a></p>}
    <div ref={strip} className="life-week-strip" role="region" aria-label="连续周本，向左查看更早记录" tabIndex={0} onScroll={(event) => {
      const element = event.currentTarget;
      setAtLatest(element.scrollWidth - element.clientWidth - element.scrollLeft < 8);
      if (positioned.current && element.scrollLeft < 80) loadEarlier();
    }}>
      {weeks.map((week) => {
        const days = doneWeekDates(week);
        const records = groupDoneWeek(doneWeekMonths(week, today).flatMap((key) => data[key]?.items ?? []), week, today);
        const firstMonth = Number(days[0].slice(5, 7)); const lastMonth = Number(days[6].slice(5, 7));
        return <article key={week} className="life-week-page" aria-label={`${week}至${days[6]}周本`} data-week={week}>
          <header className="life-week-page-heading"><div><h3>{firstMonth}{firstMonth !== lastMonth && <> | {lastMonth}</>}</h3><span>{doneWeekDates(week)[3].slice(0, 4)} · 第 {doneWeekNumber(week)} 周</span></div>
            <span>{days[0].slice(5).replace('-', '.')} — {days[6].slice(5).replace('-', '.')}</span></header>
          {records.map((day, index) => <DoneDay key={day.date} {...day} index={index} today={today} busy={busy} error={Boolean(errors[day.date.slice(0, 7)])} pending={!data[day.date.slice(0, 7)]?.syncedAt} />)}
        </article>;
      })}
    </div>
  </section>;
}
