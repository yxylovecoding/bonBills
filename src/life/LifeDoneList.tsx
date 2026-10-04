import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DoneItem, DoneMonth } from '../utils/bonLife';
import { doneWeekDates, doneWeekMonths, doneWeekNumber, earlierDoneWeeks, groupDoneCategories, groupDoneWeek, shiftDoneDate } from '../utils/lifeDone';
import { LifeError, lifeRequest } from './client';

const shanghaiToday = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
const completionTime = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' });
const weekdays = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

function DoneDay({ date, index, items, today, pending, busy, error }: {
  date: string; index: number; items: DoneItem[]; today: string; pending: boolean; busy: boolean; error: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const isToday = date === today;
  const open = isToday || expanded;
  const future = date > today;
  const groups = groupDoneCategories(items);
  return <section className={`life-week-day${isToday ? ' is-today' : ''}${future ? ' is-future' : ''}`} aria-label={`${date}完成记录`}>
    <header className="life-week-day-heading"><time dateTime={date}>{Number(date.slice(8))}</time><span>{weekdays[index]}</span>{isToday && <span className="life-week-today">今天</span>}</header>
    <div className="life-week-day-content">
      {future ? null : pending && !items.length ? <p className="life-week-empty">{busy ? '读取中…' : error ? '暂未读到记录' : '等待同步'}</p> : <>
        {open ? <div className="life-week-categories">{groups.map((group) => <section className="life-week-category" key={group.category} aria-label={`${group.category} · ${group.items.length} 项完成`}>
          <h3>{group.category}<span>{group.items.length}</span></h3>
          {group.items.length ? <ul>{group.items.map((item) => <li key={item.id}><span className="life-done-task-title">{item.title}</span><time dateTime={item.completedAt}>{completionTime.format(new Date(item.completedAt))}</time></li>)}</ul> : <p className="life-week-category-empty">—</p>}
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
        if (!force && local?.syncedAt && Date.now() - Date.parse(local.syncedAt) < 300_000) return;
        const cached = await lifeRequest<DoneMonth>('GET', { view: 'done', year, month }, request.signal);
        if (request.signal.aborted) return;
        store(cached);
        if (cached.connected && (force || !cached.syncedAt || Date.now() - Date.parse(cached.syncedAt) > 300_000)) {
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
  useEffect(() => {
    void refresh();
    const update = () => {
      setToday(shanghaiToday());
      if (document.visibilityState === 'visible' && Date.now() - refreshedAt.current > 300_000) void refresh();
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
  return <section className="life-done" aria-label="DoneList 周本" aria-busy={busy}>
    <div className="life-done-heading"><h2>完成周本</h2><nav className="life-week-navigation" aria-label="翻阅周本">
      <button className="life-arrow" aria-label="上一周" onClick={() => move(-1)}>‹</button>
      <button className="life-today" onClick={() => strip.current?.scrollTo({ left: strip.current.scrollWidth, behavior: 'smooth' })}>本周</button>
      <button className="life-arrow" aria-label="下一周" disabled={atLatest} onClick={() => move(1)}>›</button>
    </nav></div>
    <div className="life-done-toolbar"><span role="status">{busy ? '同步中…' : syncedAt ? `${completionTime.format(new Date(syncedAt))} 已同步` : '尚未同步'}</span>
      <button disabled={busy} onClick={() => void refresh(true)}>同步 TickTick</button></div>
    {Object.entries(errors).map(([key, error]) => <p className="life-error" role="alert" key={key}>{key.replace('-', ' 年 ')} 月 · {error}</p>)}
    {months.some((value) => value && !value.connected) && <p className="life-empty-state">TickTick 未连接 · <a href="https://bonbills.cn/calendar" target="_blank" rel="noreferrer">连接 TickTick ↗</a></p>}
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
