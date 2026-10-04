import { useCallback, useEffect, useRef, useState } from 'react';
import type { DoneItem, DoneMonth } from '../utils/bonLife';
import { groupDoneCategories, splitDoneDays } from '../utils/lifeDone';
import { LifeError, lifeRequest } from './client';

const shanghaiToday = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
const completionTime = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' });
const dayLabel = (date: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date(`${date}T00:00:00+08:00`));

function DoneCategories({ items, emptyLabel }: { items: DoneItem[]; emptyLabel: string }) {
  return <div className="life-done-categories">{groupDoneCategories(items).map((group) => <section key={group.category}
    className={`life-done-category${group.category === '未分类' ? ' is-unclassified' : ''}`} aria-label={`${group.category} · ${group.items.length} 项完成`}>
    <h3>{group.category}<span>{group.items.length}</span></h3>
    {group.items.length ? <ul>{group.items.map((item) => <li key={item.id}>
      <span className="life-done-task-title">{item.title}</span><time dateTime={item.completedAt}>{completionTime.format(new Date(item.completedAt))}</time>
    </li>)}</ul> : <p className="life-done-category-empty">{emptyLabel}</p>}
  </section>)}</div>;
}

function DoneHistoryDay({ date, items }: { date: string; items: DoneItem[] }) {
  const [open, setOpen] = useState(false);
  return <details className="life-done-history-day" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary><span>{dayLabel(date)}</span><span className="life-done-history-count">{items.length} 项<span className="life-done-chevron" aria-hidden="true">⌄</span></span></summary>
    {open && <DoneCategories items={items} emptyLabel="暂无完成项" />}
  </details>;
}

export default function LifeDoneList({ year, month, onExpired }: { year: number; month: number; onExpired: () => void }) {
  const [data, setData] = useState<DoneMonth | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [today, setToday] = useState(shanghaiToday);
  const controller = useRef<AbortController | null>(null);
  const refreshedAt = useRef(0);
  const key = `${year}-${String(month).padStart(2, '0')}`;
  const current = data?.month === key ? data : null;
  const isCurrentMonth = today.startsWith(`${key}-`);
  const refresh = useCallback(async (sync = true) => {
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    setBusy(true); setError(''); refreshedAt.current = Date.now();
    try {
      const cached = await lifeRequest<DoneMonth>('GET', { view: 'done', year, month }, request.signal);
      if (request.signal.aborted) return;
      setData(cached);
      if (sync && cached.connected) {
        const result = await lifeRequest<DoneMonth>('POST', { action: 'sync-done', year, month }, request.signal);
        if (!request.signal.aborted) setData(result);
      }
    } catch (cause) {
      if (request.signal.aborted) return;
      if (cause instanceof LifeError && cause.status === 401) onExpired();
      else setError(cause instanceof Error ? cause.message : '同步失败，请重试');
    } finally { if (!request.signal.aborted) setBusy(false); }
  }, [year, month, onExpired]);
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
  const { current: todayItems, history } = splitDoneDays(current?.items ?? [], key, today);
  const pending = !current?.syncedAt;
  const emptyLabel = pending ? busy ? '读取中…' : error ? '暂未读到记录' : '等待同步' : '暂无完成项';
  return <section className="life-done" aria-label="已完成清单" aria-busy={busy}>
    <div className="life-done-heading"><div><h2>{isCurrentMonth ? '今天的完成' : `${year} 年 ${month} 月`}</h2>
      <p>{isCurrentMonth ? dayLabel(today) : '历史记录'}</p></div>
      {isCurrentMonth && <div className="life-done-total"><strong>{pending && !todayItems.length ? '—' : todayItems.length}</strong><span>项完成</span></div>}
    </div>
    <div className="life-done-toolbar"><span role="status">{busy ? '同步中…' : current?.syncedAt ? `${completionTime.format(new Date(current.syncedAt))} 已同步` : '尚未同步'}</span>
      <button disabled={busy} onClick={() => void refresh()}>同步 TickTick</button></div>
    {error && <p className="life-error" role="alert">{error}</p>}
    {current && !current.connected && <p className="life-empty-state">TickTick 未连接 · <a href="https://bonbills.cn/calendar" target="_blank" rel="noreferrer">连接 TickTick ↗</a></p>}
    {isCurrentMonth && <section aria-label="今天的完成项"><DoneCategories items={todayItems} emptyLabel={emptyLabel} /></section>}
    {history.length > 0 && <section className="life-done-history" aria-label="历史完成记录">
      <h2>历史记录<span>{history.length} 天</span></h2>
      {history.map(([date, items]) => <DoneHistoryDay key={date} date={date} items={items} />)}
    </section>}
    {!isCurrentMonth && !history.length && <p className="life-empty-state">{key > today.slice(0, 7) ? '尚未到这个月' : pending ? emptyLabel : '本月暂无完成记录'}</p>}
  </section>;
}
