import { useCallback, useEffect, useRef, useState } from 'react';
import { accountFetch } from '../utils/authClient';
import { useDragSort } from '../hooks/useDragSort';
import { SCHEDULING_RULES, moveSchedulingRule, readRuleConfig, ruleTitle, type SchedulingRuleConfig, type SchedulingRuleId, type SchedulingRun } from '../utils/schedulingRules';
import './schedulingRules.css';

interface Connection { id: string; name: string; kind: 'subscription' | 'period' | 'write'; connected: boolean; syncedAt?: string; error?: string }
interface Reply { config: SchedulingRuleConfig; lastRun?: SchedulingRun; outlook?: Connection[]; triggered?: boolean; error?: string }
const endpoint = '/api/ticktick-trips?action=rules';
const time = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function RuleEditor({ initial, onSave, onClose }: {
  initial: SchedulingRuleConfig; onSave: (config: SchedulingRuleConfig) => Promise<void>; onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => structuredClone(initial));
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [expanded, setExpanded] = useState<SchedulingRuleId | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const scrollBody = useRef<HTMLDivElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const change = (work: () => SchedulingRuleConfig) => {
    if (busy) return false;
    try { setDraft(work()); setError(''); return true; } catch (cause) { setError((cause as Error).message); return false; }
  };
  const drag = useDragSort(draft.order, order => change(() => {
    const normalized = readRuleConfig({ ...draft, order });
    if (normalized.order.some((id, index) => id !== order[index])) throw new Error('不能越过绑定的前序或后序规则');
    return normalized;
  }));
  const save = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try { await onSave(draft); onClose(); } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };
  return <dialog ref={dialog} className="schedule-dialog" aria-labelledby="schedule-editor-title"
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <header><h2 id="schedule-editor-title">规则优先级</h2><span>前序优先 · 从上到下执行</span></header>
      <div className="schedule-editor-body" ref={scrollBody} onPointerMove={event => {
        if (drag.draggingIdx === null || !scrollBody.current) return;
        const bounds = scrollBody.current.getBoundingClientRect();
        if (event.clientY < bounds.top + 48) scrollBody.current.scrollTop -= 24;
        if (event.clientY > bounds.bottom - 48) scrollBody.current.scrollTop += 24;
      }}>
        <ol className="schedule-rules-list">
          {draft.order.map((id, index) => <li key={id} ref={element => drag.itemRef(element, index)} className={drag.draggingIdx === index ? 'is-dragging' : ''}>
            <div className="schedule-rule-heading">
              <button type="button" {...(!busy ? drag.handleProps(index) : {})} className="schedule-drag" disabled={busy}
                aria-label={`拖动${ruleTitle(id)}，也可用上下方向键移动`}
                onKeyDown={event => {
                  const to = event.key === 'ArrowUp' ? index - 1 : event.key === 'ArrowDown' ? index + 1 : index;
                  if (to === index) return;
                  event.preventDefault();
                  if (to >= 0 && to < draft.order.length) change(() => moveSchedulingRule(draft, index, to));
                }}>⠿</button>
              <span className="schedule-number">{index + 1}</span><strong>{ruleTitle(id)}</strong>
              <button type="button" disabled={busy} className="schedule-predecessor-toggle" aria-expanded={expanded === id}
                onClick={() => setExpanded(expanded === id ? null : id)}>前序 {(draft.predecessors[id] ?? []).length || ''}</button>
            </div>
            <p>{SCHEDULING_RULES.find(rule => rule[0] === id)![2]}</p>
            {!!draft.predecessors[id]?.length && <div className="schedule-predecessors">{draft.predecessors[id]!.map(ruleTitle).join('、')} → {ruleTitle(id)}</div>}
            {expanded === id && <fieldset disabled={busy}><legend>必须先完成</legend>
              {draft.order.filter(candidate => candidate !== id).map(parent => <label key={parent}>
                <input type="checkbox" checked={(draft.predecessors[id] ?? []).includes(parent)} onChange={event => change(() => readRuleConfig({ ...draft,
                  predecessors: { ...draft.predecessors, [id]: event.target.checked ? [...draft.predecessors[id] ?? [], parent] : (draft.predecessors[id] ?? []).filter(p => p !== parent) },
                }))} />{ruleTitle(parent)}
              </label>)}
            </fieldset>}
          </li>)}
        </ol>
      </div>
      <footer>{error && <p role="alert">{error}</p>}<div>
        <button type="button" disabled={busy} onClick={onClose}>取消</button>
        <button type="submit" disabled={busy}>{busy ? '保存中…' : '保存并重排'}</button>
      </div></footer>
    </form>
  </dialog>;
}

export default function LifeSchedulingRules({ onExpired, onManageOutlook }: { onExpired: () => void; onManageOutlook?: () => void }) {
  const [data, setData] = useState<Reply | null>(null), [editing, setEditing] = useState(false);
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [retryDispatch, setRetryDispatch] = useState(false);
  const [busy, setBusy] = useState(false);
  const request = useCallback(async (method = 'GET', config?: SchedulingRuleConfig, signal?: AbortSignal): Promise<Reply> => {
    const response = await accountFetch(endpoint, { method, signal, headers: { 'Content-Type': 'application/json' }, ...(config ? { body: JSON.stringify(config) } : {}) });
    if (response.status === 401) { onExpired(); throw new Error('请重新登录'); }
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || '规则读取失败');
    return value;
  }, [onExpired]);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try { const value = await request('GET', undefined, signal); if (!signal?.aborted) { setData(value); setError(''); } }
    catch (cause) { if (!signal?.aborted) setError((cause as Error).message); }
  }, [request]);
  useEffect(() => {
    const controller = new AbortController(); void refresh(controller.signal);
    const focus = () => { if (!document.hidden && !editing) void refresh(controller.signal); };
    window.addEventListener('focus', focus);
    const timer = window.setInterval(focus, 30_000);
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener('focus', focus); };
  }, [refresh, editing]);
  const save = async (config: SchedulingRuleConfig) => {
    const value = await request('PATCH', config, AbortSignal.timeout(25_000));
    setData(previous => ({ ...previous, config: value.config }));
    setRetryDispatch(!value.triggered); setMessage(value.triggered ? '已保存并触发重排' : '已保存，重排未触发');
  };
  const retry = async () => {
    setBusy(true);
    try {
      const response = await accountFetch('/api/ticktick-trips?action=trigger-replan', { method: 'POST', signal: AbortSignal.timeout(20_000) });
      if (response.status === 401) { onExpired(); return; }
      if (!response.ok) throw new Error('重排未触发，请重试');
      setRetryDispatch(false); setMessage('已触发重排');
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };
  return <section className="schedule-settings" aria-label="规则和 Outlook 连接">
    <div className="schedule-summary"><details><summary>规则优先级{data ? ` · ${data.config.order.length} 条` : ''}</summary>
      {data && <><div className="schedule-list-actions"><span>{data.lastRun ? `${time.format(new Date(data.lastRun.generatedAt))} · 配置 v${data.lastRun.version}` : '尚未执行'}</span>
        <button onClick={() => setEditing(true)}>编辑规则</button></div>
        <ol className="schedule-rules-list">{data.config.order.map(id => {
          const result = data.lastRun?.results.find(r => r.id === id);
          return <li key={id}><div className="schedule-rule-heading"><strong>{ruleTitle(id)}</strong>
            <span>{result?.status === 'success' ? `已执行 · ${result.matched} 项` : result?.status === 'failed' ? '失败' : result?.status === 'skipped' ? '跳过' : ''}</span></div>
            <p>{SCHEDULING_RULES.find(rule => rule[0] === id)![2]}</p>
            {!!data.config.predecessors[id]?.length && <div className="schedule-predecessors">前序：{data.config.predecessors[id]!.map(ruleTitle).join('、')}</div>}
            {result?.reason && <p>{result.reason}</p>}
            {!!result?.conflicts?.length && <p>冲突采用：{[...new Set(result.conflicts.map(c => ruleTitle(c.winner)))].join('、')}</p>}
          </li>;
        })}</ol></>}
    </details></div>
    <details className="schedule-outlook" open><summary>Outlook</summary>
      {data?.outlook?.map(connection => <div className="schedule-connection" key={connection.id}>
        <div><strong>{connection.name}</strong><span>{connection.error || (connection.connected ? '已连接' : '未连接')}
          {connection.syncedAt ? ` · ${time.format(new Date(connection.syncedAt))}` : ''}</span></div>
        {connection.kind === 'subscription' ? <a href="https://bill.bonbills.cn/calendar" target="_blank" rel="noreferrer">管理订阅 ↗</a>
          : <button onClick={onManageOutlook}>管理连接</button>}
      </div>)}
    </details>
    {message && <p role="status">{message}{retryDispatch && <button disabled={busy} onClick={() => void retry()}>重试重排</button>}</p>}
    {error && <p role="alert">{error} <button onClick={() => void refresh()}>重新读取</button></p>}
    {editing && data && <RuleEditor initial={data.config} onSave={save} onClose={() => setEditing(false)} />}
  </section>;
}
