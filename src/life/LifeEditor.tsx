import { useEffect, useRef, useState } from 'react';
import { LIFE_LABELS, LIFE_TEXT_LIMIT, type LifeEntry } from '../utils/bonLife';
import { draftKey, LifeError, lifeRequest, type LifeDraft } from './client';

export default function LifeEditor({ initial, owner, period, onSave, onClose, onExpired }: {
  initial: LifeDraft; owner: string; period: boolean;
  onSave: (entry: LifeEntry, draft: LifeDraft) => void; onClose: () => void; onExpired: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState<LifeEntry | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const attempted = useRef(false);
  const dirty = draft.text !== initial.text || Boolean(localStorageSafeRead());

  function localStorageSafeRead() {
    try { return localStorage.getItem(draftKey(owner)); } catch { return null; }
  }
  function persist(next: LifeDraft) {
    try { localStorage.setItem(draftKey(owner), JSON.stringify(next)); }
    catch { setError('草稿暂存失败，请保存后再关闭'); }
  }
  function change(text: string) {
    const next = { ...draft, text, mutationId: crypto.randomUUID() };
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
        {period && <span className="life-period-label">经期</span>}</div>
      <textarea aria-label={`${LIFE_LABELS[draft.kind]}记录`} autoFocus rows={7} maxLength={LIFE_TEXT_LIMIT}
        placeholder="写几句话…" value={draft.text} disabled={busy} onChange={(event) => change(event.target.value)} />
      {error && <p role="alert" className="life-error">{error}</p>}
      {conflict && <div className="life-conflict"><p>云端记录</p><blockquote>{conflict.text || '（空白）'}</blockquote>
        <button type="button" onClick={() => {
          const next = { ...draft, revision: conflict.revision, mutationId: crypto.randomUUID() };
          setDraft(next); persist(next); setConflict(null); setError('');
        }}>保留我的文字并继续编辑</button></div>}
      <div className="life-editor-actions"><button type="button" disabled={busy} onClick={close}>{discarding ? '放弃修改' : '取消'}</button>
        <button type="submit" className="life-primary" disabled={busy || Boolean(conflict)}>{busy ? '保存中…' : '保存'}</button></div>
    </form>
  </dialog>;
}
