import { useEffect, useRef, useState } from 'react';
import { CATEGORIES, PURPOSES, SENSATIONS, categoryLabel, wearId, type ClothesDayContext, type ClothesItem, type Purpose, type Sensation, type WearRecord, type WeatherSnapshot } from './types';
import { ClothesError, clothesRequest, photoUrl, readLocal, writeLocal } from './client';
import { isOutdoorCoat, itemWarmth, wearable } from './warmth';
import OutfitWarmth from './OutfitWarmth';

export interface WearDraft {
  id: string; revision: string; items: ClothesItem[]; purpose: Purpose | ''; indoor: Sensation | null;
  outdoor: Sensation | null; time: string; context: ClothesDayContext; weather: WeatherSnapshot | null; mutationId: string;
  indoorCoat: boolean;
}
export const wearDraftKey = (owner: string, date: string) => `bonclothes:wear-draft:${owner}:${date}`;
export function readWearDraft(owner: string, date: string) {
  const draft = readLocal<WearDraft | null>(wearDraftKey(owner, date), null);
  return draft?.id && draft.context?.date === date && Array.isArray(draft.items) ? { ...draft, indoorCoat: draft.indoorCoat ?? false } : null;
}
export function createWearDraft(context: ClothesDayContext, weather: WeatherSnapshot | null, items: ClothesItem[] = [], record?: WearRecord): WearDraft {
  return { id: record ? wearId(record) : crypto.randomUUID(), revision: record?.revision ?? '', items: record?.items ?? items,
    purpose: record?.purpose ?? '', indoor: record?.indoor ?? null, outdoor: record?.outdoor ?? null, indoorCoat: record?.indoorCoat ?? false,
    time: record?.time ?? new Date().toTimeString().slice(0, 5), context: record?.context ?? context,
    weather: record?.weather ?? weather, mutationId: crypto.randomUUID() };
}
export default function WearEditor({ initial, owner, items, onSaved, onClose, onExpired, onRefresh }: {
  initial: WearDraft; owner: string; items: ClothesItem[]; onSaved: (record: WearRecord) => void;
  onClose: () => void; onExpired: () => void; onRefresh: () => void;
}) {
  const [draft, setDraft] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [category, setCategory] = useState('全部'), [query, setQuery] = useState('');
  const [conflict, setConflict] = useState<{ revision: string } | null>(null);
  const [wardrobeChanged, setWardrobeChanged] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const key = wearDraftKey(owner, draft.context.date);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => { writeLocal(key, draft); }, [key, draft]);
  function change(next: Partial<WearDraft>) { setDraft((value) => ({ ...value, ...next, mutationId: crypto.randomUUID() })); setError(''); }
  const hasCoat = draft.items.some(isOutdoorCoat);
  const choices = items.filter((item) => wearable(item) && (category === '全部' || (category === '睡衣' ? item.sleepwear : categoryLabel(item.category) === category)) && item.name.includes(query.trim()));
  async function save() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const { value } = await clothesRequest<{ value: WearRecord }>('POST', { action: 'confirm', recordId: draft.id, revision: draft.revision,
        mutationId: draft.mutationId, purpose: draft.purpose, indoor: draft.indoor, outdoor: draft.outdoor, time: draft.time, indoorCoat: draft.indoorCoat,
        context: draft.context, weather: draft.weather, items: draft.items.map(({ id, revision }) => ({ id, revision })) });
      writeLocal(key, null); onSaved(value);
    } catch (cause) {
      if (cause instanceof ClothesError) {
        if (cause.status === 401) onExpired();
        if (cause.status === 409 && !cause.wardrobeChanged) setConflict({ revision: (cause.current as WearRecord | null)?.revision ?? '' });
        if (cause.wardrobeChanged) { setWardrobeChanged(true); onRefresh(); }
      }
      setError(cause instanceof Error ? cause.message : '保存失败，请重试');
    } finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="life-dialog clothes-dialog clothes-wear-dialog" aria-labelledby="wear-title" onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <div className="life-editor-heading"><h2 id="wear-title">{draft.revision ? '编辑穿搭' : '记录穿搭'}</h2><button type="button" disabled={busy} onClick={onClose}>稍后继续</button></div>
      <fieldset disabled={busy}>
        <div className="clothes-fields">
          <label>用途<select required value={draft.purpose} onChange={(e) => change({ purpose: e.target.value as Purpose, ...(e.target.value === '睡觉' ? { outdoor: null } : {}) })}><option value="">请选择</option>{PURPOSES.map((purpose) => <option key={purpose}>{purpose}</option>)}</select></label>
          <label>穿着时间<input type="time" required value={draft.time} onChange={(e) => change({ time: e.target.value })} /></label>
          {(['indoor', 'outdoor'] as const).filter((field) => field === 'indoor' || draft.purpose !== '睡觉').map((field) => <label key={field}>{field === 'indoor' ? '室内体感' : '室外体感'}<select value={draft[field] ?? ''} onChange={(e) => change({ [field]: e.target.value || null })}><option value="">未记录</option>{SENSATIONS.map((feeling) => <option key={feeling}>{feeling}</option>)}</select></label>)}
          {hasCoat && <label className="clothes-check clothes-full"><input type="checkbox" checked={draft.indoorCoat} onChange={(e) => change({ indoorCoat: e.target.checked })} />室内穿外套</label>}
        </div>
        <div className="clothes-row clothes-selected-heading"><h3>我穿了什么</h3><span className="clothes-muted">{draft.items.length} 件</span></div>
        <div className="clothes-selected">{draft.items.map((item) => <button type="button" key={item.id} aria-label={`移除${item.name}`} onClick={() => change({ items: draft.items.filter((piece) => piece.id !== item.id) })}>{item.name} ×</button>)}</div>
        <OutfitWarmth items={draft.items} indoorCoat={draft.indoorCoat} indoorOnly={draft.purpose === '睡觉'} />
        <div className="clothes-fields clothes-picker-controls"><label>分类<select value={category} onChange={(e) => setCategory(e.target.value)}>{['全部', ...CATEGORIES, '睡衣'].map((value) => <option key={value}>{value}</option>)}</select></label><label>搜索衣物<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="衣物名称" /></label></div>
        <div className="clothes-grid clothes-picker-grid">{choices.map((item) => {
          const selected = draft.items.some((piece) => piece.id === item.id);
          return <button type="button" className="clothes-card" key={item.id} aria-pressed={selected} aria-label={`${selected ? '取消选择' : '选择'}${item.name}`} onClick={() => change({ items: selected ? draft.items.filter((piece) => piece.id !== item.id) : [...draft.items, item] })}><img loading="lazy" src={photoUrl(item.photoId)} alt="" /><div className="clothes-card-caption"><strong>{item.name}</strong><span>{selected ? '✓' : `${itemWarmth(item)}°C`}</span></div></button>;
        })}</div>
        {!choices.length && <p className="clothes-muted">暂无符合条件的衣物</p>}
      </fieldset>
      {error && <p className="life-error" role="alert">{error}</p>}
      {wardrobeChanged && <button type="button" className="clothes-link" disabled={busy} onClick={() => {
        change({ items: draft.items.flatMap((piece) => { const current = items.find((item) => item.id === piece.id && wearable(item)); return current ? [current] : []; }) }); setWardrobeChanged(false);
      }}>更新已选衣物</button>}
      {conflict && <div className="life-conflict"><button type="button" disabled={busy} onClick={() => { change({ revision: conflict.revision }); setConflict(null); }}>保留当前编辑</button></div>}
      <div className="life-editor-actions"><button type="button" disabled={busy} onClick={() => { writeLocal(key, null); onClose(); }}>放弃</button><button className="life-primary" disabled={busy || !draft.purpose || !draft.items.length || draft.items.length > 24 || !!conflict || wardrobeChanged}>{busy ? '保存中…' : '保存穿搭'}</button></div>
    </form>
  </dialog>;
}
