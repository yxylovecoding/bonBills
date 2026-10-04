import { useEffect, useRef, useState } from 'react';
import { parseCycleSettings, type CycleSettings } from '../utils/bonLife';
import { LifeError, lifeRequest } from './client';

export default function LifeCycleSettings({ initial, year, tickTickTraining, onSave, onClose, onExpired }: {
  initial: CycleSettings; year: number; tickTickTraining?: boolean; onSave: (settings: CycleSettings, swimmingError?: string) => void; onClose: () => void; onExpired: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mutationId = useRef(crypto.randomUUID());
  useEffect(() => { dialog.current?.showModal(); }, []);
  function change(fields: Partial<CycleSettings>) { setDraft((value) => ({ ...value, ...fields })); mutationId.current = crypto.randomUUID(); }
  async function save() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const cycle = parseCycleSettings(draft);
      const result = await lifeRequest<{ cycle: CycleSettings; swimmingError?: string }>('POST', { action: 'save-cycle', year, cycle, mutationId: mutationId.current });
      onSave(result.cycle, result.swimmingError);
    } catch (cause) {
      if (cause instanceof LifeError && cause.status === 401) onExpired();
      setError(cause instanceof Error ? cause.message : '保存失败，请重试');
    } finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="life-dialog" aria-labelledby="life-cycle-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <div className="life-editor-heading"><h2 id="life-cycle-title">经期与训练</h2></div>
      <label className="life-field">最近月经开始<input type="date" min="1900-01-01" max="2200-12-31" value={draft.lastPeriodStart} disabled={busy}
        onChange={(event) => change({ lastPeriodStart: event.target.value })} /></label>
      <div className="life-fields"><label>周期 · 天<input type="number" required min="21" max="45" value={draft.cycleLength} disabled={busy}
        onChange={(event) => change({ cycleLength: Number(event.target.value) })} /></label>
        <label>经期 · 天<input type="number" required min="1" max="10" value={draft.periodLength} disabled={busy}
          onChange={(event) => change({ periodLength: Number(event.target.value) })} /></label></div>
      {tickTickTraining ? <p className="life-empty-state">训练日 · TickTick 已同步</p> : <fieldset className="life-training-days"><legend>训练日</legend><div>{[1, 2, 3, 4, 5, 6, 0].map((day, index) =>
        <button key={day} type="button" disabled={busy} aria-pressed={draft.trainingDays.includes(day)} aria-label={`周${'一二三四五六日'[index]}`}
          onClick={() => change({ trainingDays: draft.trainingDays.includes(day) ? draft.trainingDays.filter((value) => value !== day) : [...draft.trainingDays, day] })}>{'一二三四五六日'[index]}</button>)}</div></fieldset>}
      {error && <p className="life-error" role="alert">{error}</p>}
      <div className="life-editor-actions"><button type="button" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="life-primary" disabled={busy}>{busy ? '保存中…' : '保存'}</button></div>
    </form>
  </dialog>;
}
