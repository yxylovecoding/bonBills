import { useEffect, useRef, useState } from 'react';
import { BODY_REGIONS, REGION_LABELS, CATEGORIES, COLORS, categoryLabel, hasBraRequirement, type ClothesItem } from './types';
import { itemCategories } from './pairing';
import { estimateWarmth, itemRegions, itemWarmth, normalizeItem } from './warmth';
import { ClothesError, clothesRequest, compressPhoto, photoUrl, readLocal, writeLocal } from './client';

export function newItem(): ClothesItem {
  return { id: crypto.randomUUID(), revision: '', name: '', category: '上衣', color: '白', thickness: 2, active: true, braRequirement: 'required',
    windproof: false, waterproof: false, status: '可穿', photoId: '' };
}
export interface ItemDraft { item: ClothesItem; photo: string; mutationId: string }
export const itemDraftKey = (owner: string) => `bonclothes:item-draft:${owner}`;
export function readItemDraft(owner: string): ItemDraft | null {
  const draft = readLocal<ItemDraft | null>(itemDraftKey(owner), null);
  return draft?.item && CATEGORIES.includes(categoryLabel(draft.item.category)) && typeof draft.mutationId === 'string' ? draft : null;
}
export default function ItemEditor({ initial, owner, onClose, onSaved, onExpired }: {
  initial: ItemDraft; owner: string; onClose: () => void; onSaved: (item: ClothesItem) => void; onExpired: () => void;
}) {
  const [draft, setDraft] = useState({ ...initial, item: normalizeItem(initial.item) }), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [conflict, setConflict] = useState<ClothesItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const deleteId = useRef(crypto.randomUUID());
  const { item, photo } = draft;
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => { writeLocal(itemDraftKey(owner), draft); }, [draft, owner]);
  function change(next: Partial<ClothesItem>, nextPhoto = photo) {
    setDraft({ item: { ...item, ...next, ...('warmth' in next ? { learnedWarmth: undefined } : {}) }, photo: nextPhoto, mutationId: crypto.randomUUID() }); setDeleting(false);
  }
  function close() { writeLocal(itemDraftKey(owner), null); onClose(); }
  async function save(remove = false) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const { value } = await clothesRequest<{ value: ClothesItem }>('POST', remove
        ? { action: 'delete-item', id: item.id, revision: item.revision, mutationId: deleteId.current }
        : { action: 'save-item', item, photo, mutationId: draft.mutationId });
      writeLocal(itemDraftKey(owner), null); onSaved(value);
    } catch (cause) {
      if (cause instanceof ClothesError && cause.status === 401) onExpired();
      if (cause instanceof ClothesError && cause.status === 409) setConflict(cause.current as ClothesItem);
      setError(cause instanceof Error ? cause.message : '保存失败，请重试');
    } finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="life-dialog clothes-dialog" aria-labelledby="item-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <div className="life-editor-heading"><h2 id="item-title">{item.revision ? '编辑衣物' : '新增衣物'}</h2><button type="button" disabled={busy} onClick={onClose}>稍后继续</button></div>
      <fieldset disabled={busy}>
        <label className="clothes-upload">{photo || item.photoId ? <img src={photo || photoUrl(item.photoId)} alt="衣物照片" /> : <span>添加照片</span>}
          <input aria-label="衣物照片" type="file" accept="image/jpeg,image/png,image/webp" onChange={async (event) => {
            const file = event.target.files?.[0]; if (!file) return;
            setBusy(true); setError('');
            try { change({}, await compressPhoto(file)); } catch (cause) { setError(cause instanceof Error ? cause.message : '照片处理失败'); }
            finally { setBusy(false); }
          }} /><span>{photo || item.photoId ? '更换照片' : '选择照片'}</span>
        </label>
        <div className="clothes-fields">
          <label className="clothes-full">名称<input value={item.name} maxLength={60} placeholder={`${item.color === '多色' ? item.color : `${item.color}色`}${categoryLabel(item.category)}`} onChange={(e) => change({ name: e.target.value })} /></label>
          <label>类别<select aria-label="类别" value={categoryLabel(item.category)} onChange={(e) => change({ category: e.target.value as ClothesItem['category'], wearAs: [], warmthRegions: undefined })}>{CATEGORIES.map((v) => <option key={v}>{v}</option>)}</select></label>
          {['上衣', '外套'].includes(categoryLabel(item.category)) && <label className="clothes-check"><input type="checkbox" checked={itemCategories(item).length > 1} onChange={(e) => change({ wearAs: e.target.checked ? ['上衣', '外套'] : [] })} />{categoryLabel(item.category) === '外套' ? '也可作上衣' : '也可作外套'}</label>}
          <label>颜色<select aria-label="颜色" value={item.color} onChange={(e) => change({ color: e.target.value as ClothesItem['color'] })}>{COLORS.map((v) => <option key={v} value={v}>{v === '多色' ? v : `${v}色`}</option>)}</select></label>
          <label>厚薄<select aria-label="厚薄" value={item.thickness} onChange={(e) => change({ thickness: Number(e.target.value) as 1 | 2 | 3 })}><option value={1}>薄</option><option value={2}>适中</option><option value={3}>厚</option></select></label>
          <label>状态<select aria-label="状态" value={item.status} onChange={(e) => change({ status: e.target.value as ClothesItem['status'] })}>{['可穿', '收起'].map((v) => <option key={v}>{v}</option>)}</select></label>
          <label className="clothes-check clothes-full"><input type="checkbox" checked={item.sleepwear ?? false} onChange={(e) => change({ sleepwear: e.target.checked })} />睡衣</label>
          {categoryLabel(item.category) === '配饰' && <div className="clothes-full"><span className="clothes-label">保暖部位</span><div className="clothes-checks" role="group" aria-label="保暖部位">{BODY_REGIONS.map((region) => <label key={region}><input type="checkbox" checked={itemRegions(item).includes(region)} onChange={(e) => change({ warmthRegions: e.target.checked ? [...itemRegions(item), region] : itemRegions(item).filter((value) => value !== region) })} />{REGION_LABELS[region]}</label>)}</div></div>}
          <label>保暖值 °C<input type="number" min={0} max={40} step={0.5} required value={itemWarmth(item)} onChange={(e) => change({ warmth: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
          <button type="button" className="clothes-link" onClick={() => change({ warmth: estimateWarmth(item) })}>重新预估</button>
          {itemCategories(item).some(hasBraRequirement) && <label>文胸<select aria-label="文胸" value={item.braRequirement ?? 'required'} onChange={(e) => change({ braRequirement: e.target.value as ClothesItem['braRequirement'] })}><option value="required">需穿文胸</option><option value="optional">可不穿文胸</option></select></label>}
        </div>
        <div className="clothes-checks">{([['active', '方便活动'], ['windproof', '防风'], ['waterproof', '防雨']] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={item[key]} onChange={(e) => change({ [key]: e.target.checked })} />{label}</label>)}</div>
      </fieldset>
      {error && <p className="life-error" role="alert">{error}</p>}
      {conflict && <div className="life-conflict"><p>{conflict.deleted ? '衣物已删除' : `最新：${conflict.name} · ${conflict.status}`}</p><button type="button" onClick={() => {
        change({ revision: conflict.revision }); deleteId.current = crypto.randomUUID(); setConflict(null); setError('');
      }}>沿用当前编辑</button></div>}
      {deleting && <p className="life-error">删除这件衣物？</p>}
      <div className="life-editor-actions clothes-editor-actions">
        {item.revision && <button type="button" className="clothes-danger" disabled={busy || Boolean(conflict)} onClick={() => deleting ? void save(true) : setDeleting(true)}>{deleting ? '确认删除' : '删除'}</button>}
        <button type="button" disabled={busy} onClick={close}>放弃</button>
        <button className="life-primary" disabled={busy || Boolean(conflict) || (!photo && !item.photoId)}>{busy ? '处理中…' : '保存'}</button>
      </div>
    </form>
  </dialog>;
}
