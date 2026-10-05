import { useEffect, useRef, useState } from 'react';
import { PURPOSES, SENSATIONS, DAY_PERIODS, categoryLabel, wearId, type DayPeriod, type WearFeelings, type PeriodFeeling, type Category, type PairCounts, type ClothesDayContext, type ClothesItem, type Purpose, type Sensation, type WearKind, type WearRecord, type WeatherSnapshot } from './types';
import { ClothesError, clothesRequest, photoUrl, readLocal, writeLocal } from './client';
import { isOutdoorCoat, itemWarmth, wearable } from './warmth';
import OutfitWarmth from './OutfitWarmth';
import { blankFeeling, recordFeelings, timePeriod } from './feelings';
import { itemCategories, wearAs, pairingScore } from './pairing';
import { deviceDate } from './rules';

export interface WearDraft {
  kind: WearKind; feelings: WearFeelings;
  id: string; revision: string; items: ClothesItem[]; purpose: Purpose | ''; indoor: Sensation | null;
  outdoor: Sensation | null; time: string; context: ClothesDayContext; weather: WeatherSnapshot | null; mutationId: string;
  indoorCoat: boolean;
}
export const wearDraftKey = (owner: string, date: string) => `bonclothes:wear-draft:${owner}:${date}`;
export function readWearDraft(owner: string, date: string) {
  return readWearDraftAt(wearDraftKey(owner, date));
}
export function readWearDraftAt(key: string) {
  const draft = readLocal<WearDraft | null>(key, null);
  return draft?.id && draft.context?.date && Array.isArray(draft.items) ? { ...draft, feelings: draft.feelings ?? recordFeelings({ ...draft, purpose: draft.purpose || undefined, date: draft.context.date, confirmedAt: '' }), kind: draft.kind ?? 'worn', indoorCoat: draft.indoorCoat ?? false } : null;
}
export function createWearDraft(context: ClothesDayContext, weather: WeatherSnapshot | null, items: ClothesItem[] = [], record?: WearRecord): WearDraft {
  return { feelings: record ? recordFeelings(record) : {}, kind: record ? record.kind ?? 'worn' : context.date > deviceDate(new Date(), context.timezone) ? 'styled' : 'worn', id: record ? wearId(record) : crypto.randomUUID(), revision: record?.revision ?? '', items: record?.items ?? items,
    purpose: record?.purpose ?? context.purpose ?? '', indoor: record?.indoor ?? null, outdoor: record?.outdoor ?? null, indoorCoat: record?.indoorCoat ?? false,
    time: record?.time ?? new Date().toTimeString().slice(0, 5), context: record?.context ?? context,
    weather: record?.weather ?? weather, mutationId: crypto.randomUUID() };
}
export default function WearEditor({ initial, storageKey, items, pairCounts, onSaved, onClose, onExpired, onRefresh }: {
  initial: WearDraft; storageKey: string; items: ClothesItem[]; pairCounts: PairCounts; onSaved: (record: WearRecord) => void;
  onClose: () => void; onExpired: () => void; onRefresh: () => void;
}) {
  const [draft, setDraft] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [period, setPeriod] = useState<DayPeriod>(timePeriod(initial.time));
  const [conflict, setConflict] = useState<{ revision: string } | null>(null);
  const [wardrobeChanged, setWardrobeChanged] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const key = storageKey;
  const styled = draft.kind === 'styled';
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => { writeLocal(key, draft); }, [key, draft]);
  function change(next: Partial<WearDraft>) { setDraft((value) => ({ ...value, ...next, mutationId: crypto.randomUUID() })); setError(''); }
  const snapshotTime = draft.weather?.fetchedAt && Number.isFinite(Date.parse(draft.weather.fetchedAt))
    ? new Intl.DateTimeFormat('en-GB', { timeZone: draft.context.timezone, hour: '2-digit', hourCycle: 'h23' }).format(new Date(draft.weather.fetchedAt)) : null;
  const feeling = draft.feelings[period] ?? { ...blankFeeling(draft.context),
    outdoorTemperature: draft.context.manualWeather?.temperature ?? (snapshotTime && period === timePeriod(snapshotTime) ? draft.weather?.temperature ?? null : null) };
  function changeFeeling(next: Partial<PeriodFeeling>) {
    const updated = { ...feeling, ...next };
    change({ feelings: { ...draft.feelings, [period]: updated }, indoor: updated.indoor, outdoor: updated.outdoor });
  }
  const hasCoat = draft.items.some(isOutdoorCoat);
  const positions: Category[] = ['上衣', '下装', '外套', '连衣裙', '鞋', '内衣', '文胸', '配饰'];
  const choices = items.filter((item) => wearable(item) && item.name.includes(query.trim()));
  const groups = positions.map((category) => ({ category, choices: choices.filter((item) => itemCategories(item).includes(categoryLabel(category)))
    .sort((a, b) => pairingScore(b, draft.items, pairCounts) - pairingScore(a, draft.items, pairCounts) || a.name.localeCompare(b.name, 'zh-CN')) }));
  function select(item: ClothesItem, category: Category) {
    const selected = draft.items.some((piece) => piece.id === item.id && categoryLabel(piece.category) === categoryLabel(category));
    change({ items: [...draft.items.filter((piece) => piece.id !== item.id), ...(selected ? [] : [wearAs(item, category)])] });
  }
  async function save() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const { value } = await clothesRequest<{ value: WearRecord }>('POST', { action: 'confirm', recordId: draft.id, revision: draft.revision,
        mutationId: draft.mutationId, feelings: styled ? {} : draft.feelings, kind: draft.kind, purpose: draft.purpose, indoor: styled ? null : draft.indoor, outdoor: styled ? null : draft.outdoor, time: draft.time, indoorCoat: draft.indoorCoat,
        context: draft.context, weather: draft.weather, items: draft.items.map(({ id, revision, category }) => ({ id, revision, category })) });
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
      <div className="life-editor-heading"><div className="clothes-row"><h2 id="wear-title">{draft.revision ? '编辑穿搭' : '记录穿搭'}</h2><button type="button" className="clothes-save" disabled={busy} aria-label={`当前${styled ? '搭了' : '穿了'}，切换为${styled ? '穿了' : '搭了'}`} onClick={() => change({ kind: styled ? 'worn' : 'styled' })}>{styled ? '搭了' : '穿了'}</button></div><button type="button" disabled={busy} onClick={onClose}>稍后继续</button></div>
      <fieldset disabled={busy}>
        <div className="clothes-fields">
          <label>用途<select required value={draft.purpose} onChange={(e) => change({ purpose: e.target.value as Purpose, ...(e.target.value === '睡觉' ? { outdoor: null } : {}) })}><option value="">请选择</option>{PURPOSES.map((purpose) => <option key={purpose}>{purpose}</option>)}</select></label>
          {hasCoat && <label className="clothes-check clothes-full"><input type="checkbox" checked={draft.indoorCoat} onChange={(e) => change({ indoorCoat: e.target.checked })} />室内穿外套</label>}
        </div>
        {!styled && <section className="clothes-feelings" aria-label="分时段体感">
          <div className="clothes-view" aria-label="体感时段">{DAY_PERIODS.map((value) => <button type="button" key={value} aria-pressed={period === value} onClick={() => setPeriod(value)}>{value}{draft.feelings[value]?.indoor || draft.feelings[value]?.outdoor ? ' ·' : ''}</button>)}</div>
          <div className="clothes-fields">{(['indoor', 'outdoor'] as const).filter((field) => field === 'indoor' || draft.purpose !== '睡觉').map((field) => <div className="clothes-feeling-field" key={field}>
            <label>{field === 'indoor' ? '室内体感' : '室外体感'}<select value={feeling[field] ?? ''} onChange={(e) => changeFeeling({ [field]: e.target.value || null })}><option value="">未记录</option>{SENSATIONS.map((value) => <option key={value}>{value}</option>)}</select></label>
            <label>{field === 'indoor' ? '室内温度 °C' : '室外温度 °C'}<input type="number" min={-60} max={60} step={0.5} placeholder="未记录" value={feeling[`${field}Temperature`] ?? ''} onChange={(e) => changeFeeling({ [`${field}Temperature`]: e.target.value === '' ? null : Number(e.target.value) })} /></label>
          </div>)}</div>
        </section>}
        <div className="clothes-row clothes-selected-heading"><h3>{styled ? '我搭了什么' : '我穿了什么'}</h3><span className="clothes-muted">{draft.items.length} 件</span></div>
        <div className="clothes-selected">{draft.items.map((item) => <button type="button" key={item.id} aria-label={`移除${item.name}`} onClick={() => change({ items: draft.items.filter((piece) => piece.id !== item.id) })}>{categoryLabel(item.category)} · {item.name} ×</button>)}</div>
        <OutfitWarmth items={draft.items} indoorCoat={draft.indoorCoat} indoorOnly={draft.purpose === '睡觉'} />
        <div className="clothes-fields clothes-picker-controls"><label className="clothes-full">搜索衣物<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="衣物名称" /></label></div>
        {groups.filter((group) => group.choices.length || ['上衣', '下装', '外套'].includes(group.category)).map(({ category, choices: pieces }) => <section key={category} className="clothes-picker-section" aria-label={`选择${category}`}>
          <div className="clothes-row"><h3>{category}</h3><span className="clothes-muted">{draft.items.filter((piece) => categoryLabel(piece.category) === category).length || '未选'}</span></div>
          {pieces.length ? <div className="clothes-grid clothes-picker-grid">{pieces.map((item) => {
            const selected = draft.items.some((piece) => piece.id === item.id && categoryLabel(piece.category) === category);
            const paired = pairingScore(item, draft.items, pairCounts) > 0;
            return <button type="button" className="clothes-card" key={item.id} aria-pressed={selected} aria-label={`${selected ? '取消选择' : '选择'}${item.name}作${category}`} onClick={() => select(item, category)}><img loading="lazy" src={photoUrl(item.photoId)} alt="" /><div className="clothes-card-caption"><strong>{item.name}</strong><span>{selected ? '✓' : paired ? '常搭' : `${itemWarmth(item)}°C`}</span></div></button>;
          })}</div> : <p className="clothes-muted">暂无衣物</p>}
        </section>)}
      </fieldset>
      {error && <p className="life-error" role="alert">{error}</p>}
      {wardrobeChanged && <button type="button" className="clothes-link" disabled={busy} onClick={() => {
        change({ items: draft.items.flatMap((piece) => { const current = items.find((item) => item.id === piece.id && wearable(item)); return current && itemCategories(current).includes(categoryLabel(piece.category)) ? [wearAs(current, piece.category)] : []; }) }); setWardrobeChanged(false);
      }}>更新已选衣物</button>}
      {conflict && <div className="life-conflict"><button type="button" disabled={busy} onClick={() => { change({ revision: conflict.revision }); setConflict(null); }}>保留当前编辑</button></div>}
      <div className="life-editor-actions"><button type="button" disabled={busy} onClick={() => { writeLocal(key, null); onClose(); }}>放弃</button><button className="life-primary" disabled={busy || !draft.purpose || !draft.items.length || draft.items.length > 24 || !!conflict || wardrobeChanged}>{busy ? '保存中…' : styled ? '保存为一套' : '保存穿搭'}</button></div>
    </form>
  </dialog>;
}
