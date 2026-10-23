import { useState } from 'react';
import type { LifeEntries } from '../utils/bonLife';
import { nextSkinPlan } from '../utils/lifeSkinProgress';
import { symptomColor } from './symptomColor';
import { SYMPTOM_STATES, type SymptomState } from '../utils/lifeSymptoms';
import { DEFAULT_SKIN_SETTINGS, SKIN_FIELDS, SKIN_SEASONS, SKIN_STATES, matchingSkinProducts, rankedSkinProducts, skinMedicationAvailable, skinProductNames, skinLocalPlanValues, skinPlanValues, skinSeason,
  type SkinRecord, type SkinSeason, type SkinSettings, type SkinState } from '../utils/lifeSkin';

const RECORD_FIELDS = ['morningMedication', 'morningProducts', 'eveningMedication', 'eveningProducts'] as const;
const productNames = skinProductNames;

function SkinProductChoices({ label, kind, value, products, isAvailable, busy, onChange }: {
  label: string; kind: 'medication' | 'skincare'; value: string; products: { name: string }[];
  isAvailable: (name: string) => boolean; busy: boolean; onChange: (value: string) => void;
}) {
  const selected = productNames(value);
  const [remembered, setRemembered] = useState(selected);
  const [editing, setEditing] = useState(false);
  const names = [...new Set([...products.flatMap((item) => productNames(item.name)), ...remembered])]
    .filter((name) => !selected.includes(name) && isAvailable(name));
  const kindLabel = kind === 'medication' ? '药品' : '护肤品';
  function remember(names: string[]) { setRemembered((previous) => [...new Set([...previous, ...names])]); }
  function finishEditing() { remember(selected); setEditing(false); }
  return <fieldset className="life-skin-choices life-skin-product-choices" disabled={busy}><legend>{label}</legend>
    {editing ? <div className="life-skin-product-input">
      <input autoFocus aria-label={`${label}名称`} maxLength={500} value={value} placeholder={`填写${kindLabel}名称`}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); finishEditing(); } }} />
      <button type="button" onClick={finishEditing}>完成</button>
    </div> : <>
      {selected.length > 0 && <div>{selected.map((name) => <button type="button" key={name} aria-pressed="true" aria-label={`${label} · 移除${name}`}
        onClick={() => { remember(selected); onChange(selected.filter((item) => item !== name).join('、')); }}>{name}<span aria-hidden="true"> ×</span></button>)}</div>}
      <select className="life-skin-product-picker" aria-label={`${label} · 选择${kindLabel}`} value="" onChange={(event) => {
        if (event.target.value === 'custom') { setEditing(true); return; }
        const name = event.target.value.slice('product:'.length);
        if (!name) return;
        const next = [...new Set([...selected, name])].join('、');
        if (next.length <= 500) { remember([...selected, name]); onChange(next); }
      }}>
        <option value="" disabled>＋ 选择{kindLabel}</option>
        {names.map((name) => <option key={name} value={`product:${name}`} disabled={[...selected, name].join('、').length > 500}>{name}</option>)}
        <option value="custom">手动填写…</option>
      </select>
    </>}
  </fieldset>;
}

export default function LifeSkinFields({ value = {}, date, entries, settings = DEFAULT_SKIN_SETTINGS, busy, onChange }: {
  value?: SkinRecord; date: string; entries: LifeEntries; settings?: SkinSettings; busy: boolean; onChange: (skin: SkinRecord) => void;
}) {
  const status = value.status;
  const season = value.season ?? skinSeason(date);
  const plan = status ? settings.plans[status] : undefined;
  const day = value.planDay;
  const selectedDay = day ? plan?.days[day - 1] : undefined;
  const local = skinLocalPlanValues(settings, value);
  const suggested = status && day && selectedDay ? skinPlanValues(settings, status, day, season) : {};
  const care = status ? matchingSkinProducts(settings, status, season, 'skincare') : [];
  const hasSuggestion = RECORD_FIELDS.some((field) => Boolean(suggested[field]));
  function change(next: Partial<SkinRecord>) { onChange({ ...value, ...next }); }
  function followHistory(state: SkinState) {
    const next = { ...value, status: state };
    if (state !== 'acne') delete next.acneProgress;
    const inferred = nextSkinPlan(date, settings, entries, state);
    if (inferred.planDay === undefined) delete next.planDay; else next.planDay = inferred.planDay;
    onChange(next);
  }
  return <div className="life-skin-editor">
    <fieldset className="life-skin-choices" disabled={busy}><legend>皮肤状态</legend><div>
      {(Object.entries(SKIN_STATES) as [SkinState, string][]).map(([key, label]) => <button type="button" key={key}
        className="life-symptom-mark" style={symptomColor(`skin:${key}`)}
        aria-pressed={status === key} onClick={() => { if (key !== status) followHistory(key); }}>{label}</button>)}
    </div></fieldset>
    {status === 'acne' && <label className="life-field">痤疮状态<select disabled={busy} value={value.acneProgress ?? ''}
      onChange={(event) => {
        const next = { ...value };
        if (event.target.value) next.acneProgress = event.target.value as SymptomState; else delete next.acneProgress;
        onChange(next);
      }}><option value="">未记录</option>{Object.entries(SYMPTOM_STATES).filter(([key]) => key !== 'recorded' || value.acneProgress === 'recorded')
        .map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>}
    <fieldset className="life-skin-choices" disabled={busy}><legend>副状态</legend><div>
      <button type="button" className="life-symptom-mark" style={symptomColor('skin:acneMarks')}
        aria-pressed={value.acneMarks ?? false} onClick={() => change({ acneMarks: !value.acneMarks })}>痘印</button>
    </div></fieldset>
    {(plan || value.acneMarks) && <section className="life-skin-plan" aria-label="个人护理方案">
      <div className="life-skin-plan-heading"><h3>个人方案</h3><label>季节<select aria-label="护理季节" disabled={busy} value={season}
        onChange={(event) => change({ season: event.target.value as SkinSeason })}>{Object.entries(SKIN_SEASONS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
      {plan && plan.days.length > 1 && <div className="life-skin-day-options" aria-label="方案天数">{plan.days.map((_, index) => <button type="button" key={index}
        disabled={busy} aria-pressed={day === index + 1} onClick={() => change({ planDay: index + 1 })}>第 {index + 1} 天</button>)}<button type="button" disabled={busy} onClick={() => followHistory(status!)}>按记录推算</button></div>}
      {plan && !selectedDay && <p className="life-empty-state">{day ? `原方案第 ${day} 天已移除，请重新选择` : '本轮已结束，请选择下一步'}</p>}
      {selectedDay && <dl>{(['medication', 'morningMedication', 'eveningMedication'] as const).map((field) => selectedDay[field] &&
        <div key={field}><dt>{field === 'medication' ? '用药' : SKIN_FIELDS[field]}</dt><dd>{selectedDay[field]}</dd></div>)}
        {selectedDay.notes && <div><dt>应对方法</dt><dd>{selectedDay.notes}</dd></div>}
        <div><dt>护肤品{plan?.careFrom && <small>同受损</small>}</dt><dd>{care.length ? care.map((item) => item.name).join('、') : '本季节暂无在用护肤品'}</dd></div>
      </dl>}
      {selectedDay && !selectedDay.medication && !selectedDay.morningMedication && !selectedDay.eveningMedication && !selectedDay.notes && <p className="life-empty-state">暂未设置应对方法</p>}
      {value.acneMarks && <dl><div><dt>局部用药</dt><dd>{local.localMedication || '未设置'}</dd></div></dl>}
      <button className="life-skin-fill" type="button" disabled={busy || !hasSuggestion} onClick={() => {
        const next = { ...value, season };
        for (const field of RECORD_FIELDS) if (!next[field]?.trim() && suggested[field]) next[field] = suggested[field];
        onChange(next);
      }}>填入空白项</button>
    </section>}
    <div className="life-fields">{RECORD_FIELDS.map((field) => {
      const kind = field.endsWith('Products') ? 'skincare' : 'medication';
      const time = field.startsWith('morning') ? 'morning' : 'evening';
      const products = rankedSkinProducts(settings, status, season, kind, time, selectedDay);
      return <SkinProductChoices key={field} label={SKIN_FIELDS[field]} kind={kind} value={value[field] ?? ''} products={products}
        isAvailable={(name) => kind !== 'medication' || skinMedicationAvailable(settings, name, time, selectedDay)}
        busy={busy} onChange={(next) => change({ [field]: next })} />;
    })}</div>
  </div>;
}
