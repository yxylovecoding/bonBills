import { useEffect, useRef, useState } from 'react';
import { BODY_FIELDS, SKIN_FIELDS, entrySummary, parseLifeEdit, LIFE_LABELS, LIFE_TEXT_LIMIT, type BodyRecord, type CycleSettings, type LifeEntry, type SkinRecord } from '../utils/bonLife';
import { CYCLE_GUIDANCE, visibleCycleDay, suggestedTraining } from '../utils/lifeCycle';
import { draftKey, LifeError, lifeRequest, type LifeDraft } from './client';
import { personalTraining, type TrainingTask } from '../utils/lifeTraining';

export default function LifeEditor({ initial, owner, cycle, periodDays, trainingTasks, onSave, onClose, onExpired }: {
  initial: LifeDraft; owner: string; cycle: CycleSettings; periodDays: string[];
  trainingTasks?: TrainingTask[];
  onSave: (entry: LifeEntry, draft: LifeDraft) => void; onClose: () => void; onExpired: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState<LifeEntry | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const attempted = useRef(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial) || Boolean(localStorageSafeRead());
  const phase = visibleCycleDay(draft.date, cycle, periodDays);
  const guidance = phase ? CYCLE_GUIDANCE[phase.phase] : null;

  function localStorageSafeRead() {
    try { return localStorage.getItem(draftKey(owner)); } catch { return null; }
  }
  function persist(next: LifeDraft) {
    try { localStorage.setItem(draftKey(owner), JSON.stringify(next)); }
    catch { setError('草稿暂存失败，请保存后再关闭'); }
  }
  function change(fields: Partial<LifeDraft>) {
    const next = { ...draft, ...fields, mutationId: crypto.randomUUID() };
    setDraft(next); persist(next); setDiscarding(false);
  }
  function close() {
    if (busy) return;
    if (dirty && !discarding) { setDiscarding(true); return; }
    try { localStorage.removeItem(draftKey(owner)); } catch { /* No draft storage. */ }
    onClose();
  }
  useEffect(() => {
    dialog.current?.showModal();
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);

  async function save() {
    if (busy || attempted.current) return;
    attempted.current = true;
    setBusy(true); setError(''); persist(draft);
    try {
      parseLifeEdit(draft);
      const { entry } = await lifeRequest<{ entry: LifeEntry }>('POST', { action: 'save', ...draft });
      try { localStorage.removeItem(draftKey(owner)); } catch { /* Server save succeeded. */ }
      onSave(entry, draft);
    } catch (cause) {
      if (cause instanceof LifeError && cause.status === 401) onExpired();
      else if (cause instanceof LifeError && cause.current) setConflict(cause.current);
      setError(cause instanceof Error ? cause.message : '保存失败，请重试');
    } finally { setBusy(false); attempted.current = false; }
  }
  return <dialog className="life-dialog" ref={dialog} onCancel={(event) => { event.preventDefault(); close(); }} aria-labelledby="life-editor-title">
    <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <div className="life-editor-heading"><h2 id="life-editor-title">{LIFE_LABELS[draft.kind]} <span>{draft.date.replace(/-/g, '.')}</span></h2>
        {guidance && <span className={`life-period-label phase-${phase?.phase}`}>{phase?.estimated ? '预计·' : ''}{guidance.label}</span>}</div>
      {draft.kind === 'skin' && <div className="life-fields">{Object.entries(SKIN_FIELDS).map(([key, label]) =>
        <label key={key}>{label}<input maxLength={500} disabled={busy} value={draft.skin?.[key as keyof SkinRecord] ?? ''}
          onChange={(event) => change({ skin: { ...draft.skin, [key]: event.target.value } })} /></label>)}</div>}
      {draft.kind === 'body' && <div className="life-fields">{Object.entries(BODY_FIELDS).map(([key, { label, unit, max }]) =>
        <label key={key}>{label}{unit && ` · ${unit}`}<input type="number" min="0.01" max={max} step="any" inputMode="decimal" disabled={busy}
          value={draft.body?.[key as keyof BodyRecord] ?? ''} onChange={(event) => {
            const body = { ...draft.body };
            if (!event.target.value) delete body[key as keyof BodyRecord]; else body[key as keyof BodyRecord] = Number(event.target.value);
            change({ body });
          }} /></label>)}</div>}
      {draft.kind === 'training' && <div className="life-training-editor">
        {Boolean(trainingTasks?.length) && <details className="life-training-details"><summary>TickTick 原计划</summary>
          {trainingTasks!.map((task) => <div key={task.id}><p>{task.name}</p>{task.notes && <p className="life-training-notes">{task.notes}</p>}
            {task.links.length > 0 && <div className="life-training-links">{task.links.map((link) => <a href={link.url} key={link.url} target="_blank" rel="noreferrer">{link.title} ↗</a>)}</div>}</div>)}
        </details>}
        {guidance && <div className="life-guidance"><p><span>运动</span>{guidance.exercise}</p><p><span>饮食</span>{guidance.food}</p></div>}
        <label className="life-field">今日强度<select disabled={busy} value={draft.training?.effort ?? 'normal'} onChange={(event) => {
          const effort = event.target.value as 'normal' | 'easy' | 'rest';
          change({ training: { plan: trainingTasks ? personalTraining(draft.date, trainingTasks, cycle, periodDays, effort) : suggestedTraining(draft.date, cycle, periodDays, effort), effort, completed: draft.training?.completed ?? false } });
        }}><option value="normal">按计划</option><option value="easy">轻量</option><option value="rest">休息</option></select></label>
        <label className="life-field">训练计划<textarea rows={3} maxLength={1000} disabled={busy} value={draft.training?.plan ?? ''}
          onChange={(event) => change({ training: { effort: 'normal', completed: false, ...draft.training, plan: event.target.value } })} /></label>
        <label className="life-check"><input type="checkbox" disabled={busy} checked={draft.training?.completed ?? false} onChange={(event) =>
          change({ training: { plan: '', effort: 'normal', ...draft.training, completed: event.target.checked } })} />已完成</label>
      </div>}
      <label className="life-field">{draft.kind === 'skin' ? '皮肤状态' : draft.kind === 'mood' ? '情绪' : '备注'}
      <textarea aria-label={`${LIFE_LABELS[draft.kind]}记录`} autoFocus rows={7} maxLength={LIFE_TEXT_LIMIT}
        placeholder="写几句话…" value={draft.text} disabled={busy} onChange={(event) => change({ text: event.target.value })} /></label>
      {error && <p role="alert" className="life-error">{error}</p>}
      {conflict && <div className="life-conflict"><p>云端记录</p><blockquote>{entrySummary(draft.kind, conflict) || '（空白）'}</blockquote>
        <button type="button" onClick={() => {
          const next = { ...draft, revision: conflict.revision, mutationId: crypto.randomUUID() };
          setDraft(next); persist(next); setConflict(null); setError('');
        }}>保留我的记录并继续编辑</button></div>}
      <div className="life-editor-actions"><button type="button" disabled={busy} onClick={close}>{discarding ? '放弃修改' : '取消'}</button>
        <button type="submit" className="life-primary" disabled={busy || Boolean(conflict)}>{busy ? '保存中…' : '保存'}</button></div>
    </form>
  </dialog>;
}
