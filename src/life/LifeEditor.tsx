import LifeSkinFields from './LifeSkinFields';
import type { SkinSettings } from '../utils/lifeSkin';
import { useEffect, useRef, useState } from 'react';
import { BODY_FIELDS, entrySummary, parseLifeEdit, LIFE_LABELS, LIFE_TEXT_LIMIT, type BodyRecord, type CycleSettings, type LifeEntry } from '../utils/bonLife';
import { CYCLE_GUIDANCE, visibleCycleDay } from '../utils/lifeCycle';
import { draftKey, LifeError, lifeRequest, type LifeDraft } from './client';
import { automaticTraining, plannedTraining, type TrainingTask } from '../utils/lifeTraining';

export default function LifeEditor({ initial, owner, cycle, periodDays, trainingTasks, skinSettings, onSave, onClose, onExpired }: {
  initial: LifeDraft; owner: string; cycle: CycleSettings; periodDays: string[];
  trainingTasks?: TrainingTask[]; skinSettings?: SkinSettings;
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
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
  const training = draft.kind === 'training' ? plannedTraining(draft.date, today, trainingTasks, cycle, periodDays, draft.training) : undefined;

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
      const savedDraft = training ? { ...draft, training } : draft;
      parseLifeEdit(savedDraft);
      const { entry } = await lifeRequest<{ entry: LifeEntry }>('POST', { action: 'save', ...savedDraft });
      try { localStorage.removeItem(draftKey(owner)); } catch { /* Server save succeeded. */ }
      onSave(entry, savedDraft);
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
      {draft.kind === 'skin' && <LifeSkinFields date={draft.date} value={draft.skin} settings={skinSettings} busy={busy} onChange={(skin) => change({ skin })} />}
      {draft.kind === 'body' && <div className="life-fields">{Object.entries(BODY_FIELDS).map(([key, { label, unit, max }]) =>
        <label key={key}>{label}{unit && ` · ${unit}`}<input type="number" min="0.01" max={max} step="any" inputMode="decimal" disabled={busy}
          value={draft.body?.[key as keyof BodyRecord] ?? ''} onChange={(event) => {
            const body = { ...draft.body };
            if (!event.target.value) delete body[key as keyof BodyRecord]; else body[key as keyof BodyRecord] = Number(event.target.value);
            change({ body });
          }} /></label>)}</div>}
      {draft.kind === 'training' && <div className="life-training-editor">
        {Boolean(trainingTasks?.length) && <details className="life-training-details"><summary>训练内容</summary>
          {trainingTasks!.map((task) => <div key={task.id}><p>{task.name}</p>{task.notes && <p className="life-training-notes">{task.notes}</p>}
            {task.links.length > 0 && <div className="life-training-links">{task.links.map((link) => <a href={link.url} key={link.url} target="_blank" rel="noreferrer">{link.title} ↗</a>)}</div>}</div>)}
        </details>}
        {guidance && <div className="life-guidance"><p><span>运动</span>{guidance.exercise}</p><p><span>饮食</span>{guidance.food}</p></div>}
        <div className="life-training-mode"><span>{training?.mode === 'auto' ? '自动轮换' : '手动安排'}</span>
          {training?.mode !== 'auto' && !training?.completed && <button type="button" disabled={busy} onClick={() => change({ training: automaticTraining(draft.date, trainingTasks, cycle, periodDays, training?.effort) })}>恢复自动安排</button>}
        </div>
        <label className="life-field">当日强度<select disabled={busy} value={training?.effort ?? 'normal'} onChange={(event) => {
          const effort = event.target.value as 'normal' | 'easy' | 'rest';
          change({ training: { ...automaticTraining(draft.date, trainingTasks, cycle, periodDays, effort), completed: training?.completed ?? false } });
        }}><option value="normal">按计划</option><option value="easy">轻量</option><option value="rest">休息</option></select></label>
        <label className="life-field">训练计划<textarea aria-label="训练计划" rows={3} maxLength={1000} disabled={busy} value={training?.plan ?? ''}
          onChange={(event) => change({ training: { effort: 'normal', completed: false, ...training, plan: event.target.value, mode: 'manual', projects: undefined } })} /></label>
        <label className="life-check"><input type="checkbox" disabled={busy} checked={training?.completed ?? false} onChange={(event) =>
          change({ training: { plan: '', effort: 'normal', ...training, completed: event.target.checked } })} />已完成</label>
      </div>}
      <label className="life-field">{draft.kind === 'skin' ? '皮肤备注' : draft.kind === 'mood' ? '情绪' : '备注'}
      <textarea aria-label={`${LIFE_LABELS[draft.kind]}记录`} autoFocus={draft.kind !== 'skin'} rows={draft.kind === 'skin' ? 3 : 7} maxLength={LIFE_TEXT_LIMIT}
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
