import { useCallback, useEffect, useRef, useState } from 'react';
import type { DoneMonth } from '../utils/bonLife';
import { LifeError, lifeRequest } from './client';

export default function LifeDoneList({ year, month, onExpired }: { year: number; month: number; onExpired: () => void }) {
  const [data, setData] = useState<DoneMonth | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const refreshedAt = useRef(0);
  const key = `${year}-${String(month).padStart(2, '0')}`;
  const current = data?.month === key ? data : null;
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
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
    const update = () => { if (document.visibilityState === 'visible' && Date.now() - refreshedAt.current > 300_000) void refresh(); };
    window.addEventListener('focus', update); document.addEventListener('visibilitychange', update);
    const timer = window.setInterval(update, 300_000);
    return () => { controller.current?.abort(); clearInterval(timer); window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update); };
  }, [refresh]);
  const groups = new Map<string, DoneMonth['items']>();
  if (today.startsWith(key)) groups.set(today, []);
  for (const item of current?.items ?? []) { const list = groups.get(item.date) ?? []; list.push(item); groups.set(item.date, list); }
  return <section className="life-done" aria-label="已完成清单" aria-busy={busy}>
    <div className="life-done-toolbar"><span role="status">{busy ? '读取完成记录…' : current?.syncedAt ? `已同步 · ${new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(current.syncedAt))}` : '尚未同步'}</span>
      <button disabled={busy} onClick={() => void refresh()}>同步 TickTick</button></div>
    {error && <p className="life-error" role="alert">{error}</p>}
    {current && !current.connected && <p className="life-empty-state">TickTick 未连接 · <a href="https://bonbills.cn/calendar" target="_blank" rel="noreferrer">连接 TickTick ↗</a></p>}
    {[...groups].sort(([a], [b]) => b.localeCompare(a)).map(([date, items]) => <div key={date} className="life-done-day">
      <h2>{date === today ? '今天' : date.replace(/-/g, '.')}<span>{items.length} 项完成</span></h2>
      {items.length ? <ul>{items.map((item) => <li key={item.id}><span className="life-done-check">✓</span><span>{item.title}</span><time dateTime={item.completedAt}>{new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' }).format(new Date(item.completedAt))}</time></li>)}</ul>
        : <p className="life-empty-state">{busy ? '读取中…' : error ? '暂未读到完成记录' : current?.syncedAt ? '暂无完成记录' : '等待同步'}</p>}
    </div>)}
    {!busy && !groups.size && <p className="life-empty-state">{key > today.slice(0, 7) ? '尚未到这个月' : error ? '暂未读到完成记录' : current?.syncedAt ? '本月暂无完成记录' : '等待同步'}</p>}
  </section>;
}
