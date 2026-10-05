import { useId } from 'react';
import type { LifeEntries } from '../utils/bonLife';
import { nextSkinPlan } from '../utils/lifeSkinProgress';
import { DEFAULT_SKIN_SETTINGS, SKIN_FIELDS, SKIN_SEASONS, SKIN_STATES, matchingSkinProducts, skinLocalPlanValues, skinPlanValues, skinSeason,
  type SkinField, type SkinRecord, type SkinSeason, type SkinSettings, type SkinState } from '../utils/lifeSkin';

export default function LifeSkinFields({ value = {}, date, entries, settings = DEFAULT_SKIN_SETTINGS, busy, onChange }: {
  value?: SkinRecord; date: string; entries: LifeEntries; settings?: SkinSettings; busy: boolean; onChange: (skin: SkinRecord) => void;
}) {
  const id = useId();
  const status = value.status;
  const season = value.season ?? skinSeason(date);
  const plan = status ? settings.plans[status] : undefined;
  const day = value.planDay;
  const selectedDay = day ? plan?.days[day - 1] : undefined;
  const local = skinLocalPlanValues(settings, value);
  const suggested = { ...(status && day && selectedDay ? skinPlanValues(settings, status, day, season) : {}), ...local };
  const care = status ? matchingSkinProducts(settings, status, season, 'skincare') : [];
  const hasSuggestion = Object.values(suggested).some(Boolean);
  function change(next: Partial<SkinRecord>) { onChange({ ...value, ...next }); }
  function followHistory(state: SkinState) {
    const next = { ...value, status: state };
    const inferred = nextSkinPlan(date, settings, entries, state);
    if (inferred.planDay === undefined) delete next.planDay; else next.planDay = inferred.planDay;
    onChange(next);
  }
  return <div className="life-skin-editor">
    <fieldset className="life-skin-choices" disabled={busy}><legend>皮肤状态</legend><div>
      {(Object.entries(SKIN_STATES) as [SkinState, string][]).map(([key, label]) => <button type="button" key={key}
        aria-pressed={status === key} onClick={() => { if (key !== status) followHistory(key); }}>{label}</button>)}
    </div></fieldset>
    <fieldset className="life-skin-choices" disabled={busy}><legend>副状态</legend><div>
      <button type="button" aria-pressed={value.acneMarks ?? false} onClick={() => change({ acneMarks: !value.acneMarks })}>痘印</button>
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
        for (const [field, content] of Object.entries(suggested)) if (!next[field as SkinField]?.trim()) next[field as SkinField] = content;
        onChange(next);
      }}>填入空白项</button>
    </section>}
    <div className="life-fields">{(Object.entries(SKIN_FIELDS) as [SkinField, string][]).map(([field, label]) => {
      if (field === 'localMedication' && !value.acneMarks && !value.localMedication) return null;
      const kind = field.endsWith('Products') ? 'skincare' : 'medication';
      const time = field.startsWith('morning') ? 'morning' : field.startsWith('evening') ? 'evening' : undefined;
      const products = field === 'localMedication' ? (local.localMedication ? [{ id: 'acne-marks', name: local.localMedication, tags: ['痘印'] }] : [])
        : matchingSkinProducts(settings, status, season, kind, time);
      return <label key={field} className={field === 'medication' || field === 'localMedication' ? 'life-skin-full-field' : undefined}>{label}
        <input maxLength={500} list={`${id}-${field}`} disabled={busy} value={value[field] ?? ''} placeholder="输入或选择在用用品"
          onChange={(event) => change({ [field]: event.target.value })} />
        <datalist id={`${id}-${field}`}>{products.map((item) => <option key={item.id} value={item.name}>{item.tags.join(' · ')}</option>)}</datalist>
      </label>;
    })}</div>
  </div>;
}
