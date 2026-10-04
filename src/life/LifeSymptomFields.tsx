import { DISCOMFORT_FIELDS, SYMPTOM_AREAS, SYMPTOM_LIMIT, SYMPTOM_STATES, SYMPTOM_TEXT_LIMIT, reusableSymptom, symptomKey,
  type SymptomArea, type SymptomHistory, type SymptomKind, type SymptomNames, type SymptomObservation, type SymptomObservations, type SymptomState } from '../utils/lifeSymptoms';

function SymptomAreaFields({ area, value, names, history, date, busy, onChange }: {
  area: SymptomArea; value: SymptomObservations; names: SymptomNames; history: SymptomHistory[]; date: string;
  busy: boolean; onChange: (value: SymptomObservations, names: SymptomNames) => void;
}) {
  const name = names[area] ?? '';
  const label = SYMPTOM_AREAS[area];
  const full = Object.keys(value).length >= SYMPTOM_LIMIT;
  const selected = Object.entries(value).filter(([, item]) => item.area === area);
  const choices = history.filter((item) => item.area === area && !value[item.key]);
  function add(name: string, clearName = false) {
    const clean = name.trim();
    if (!clean || busy || full) return;
    const key = symptomKey(area, clean);
    onChange({ ...value, [key]: value[key] ?? reusableSymptom(area, clean, date, history) }, clearName ? { ...names, [area]: '' } : names);
  }
  function change(key: string, fields: Partial<SymptomObservation>) { onChange({ ...value, [key]: { ...value[key], ...fields } }, names); }
  return <fieldset className="life-symptom-area" disabled={busy}>
    <legend>{area === 'eye' ? '症状' : label}</legend>
    {choices.length > 0 && <div className="life-symptom-choices" aria-label={`${label}已存症状`}>
      {choices.map((item) => <button type="button" key={item.key} disabled={full} onClick={() => add(item.name)}>{item.name}</button>)}
    </div>}
    {selected.map(([key, item]) => <div className="life-symptom-item" key={key}>
      <div className="life-symptom-item-heading"><span>{item.name}</span>
        <select aria-label={`${label}·${item.name}状态`} value={item.status} onChange={(event) => change(key, { status: event.target.value as SymptomState })}>
          {Object.entries(SYMPTOM_STATES).filter(([status]) => status !== 'recorded' || item.status === 'recorded')
            .map(([status, label]) => <option value={status} key={status}>{label}</option>)}
        </select>
        <button type="button" aria-label={`移除${label}·${item.name}`} onClick={() => {
          const next = { ...value }; delete next[key]; onChange(next, names);
        }}>×</button>
      </div>
      <input aria-label={`${label}·${item.name}备注`} placeholder="当天变化（选填）" maxLength={SYMPTOM_TEXT_LIMIT} value={item.note}
        onChange={(event) => change(key, { note: event.target.value })} />
    </div>)}
    <div className="life-symptom-add"><input aria-label={`${label}新症状`} value={name} disabled={full} maxLength={SYMPTOM_TEXT_LIMIT}
      placeholder={area === 'eye' ? '如：瞳孔周围一圈红血丝' : '添加症状'}
      onChange={(event) => onChange(value, { ...names, [area]: event.target.value })}
      onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); add(name, true); } }} />
      <button type="button" disabled={full || !name.trim()} onClick={() => add(name, true)}>添加</button>
    </div>
  </fieldset>;
}

export default function LifeSymptomFields({ kind, value, names, history, date, busy, onChange }: {
  kind: SymptomKind; value: SymptomObservations; names: SymptomNames; history: SymptomHistory[]; date: string;
  busy: boolean; onChange: (value: SymptomObservations, names: SymptomNames) => void;
}) {
  const areas: SymptomArea[] = kind === 'eyes' ? ['eye'] : Object.keys(DISCOMFORT_FIELDS) as SymptomArea[];
  return <div className="life-symptom-fields">{areas.map((area) =>
    <SymptomAreaFields key={area} area={area} value={value} names={names} history={history} date={date} busy={busy} onChange={onChange} />)}</div>;
}
