import { GENERAL_DISCOMFORT_AREA, SYMPTOM_AREAS, SYMPTOM_LIMIT, SYMPTOM_STATES, SYMPTOM_TEXT_LIMIT, reusableSymptom, symptomKey,
  type SymptomArea, type SymptomHistory, type SymptomKind, type SymptomNames, type SymptomObservation, type SymptomObservations, type SymptomState } from '../utils/lifeSymptoms';
import { symptomColor } from './symptomColor';

function symptomLabel(area: SymptomArea, name: string) {
  return area === 'eye' || area === GENERAL_DISCOMFORT_AREA ? name : `${SYMPTOM_AREAS[area]} · ${name}`;
}

export default function LifeSymptomFields({ kind, value, names, history, date, busy, onChange }: {
  kind: SymptomKind; value: SymptomObservations; names: SymptomNames; history: SymptomHistory[]; date: string;
  busy: boolean; onChange: (value: SymptomObservations, names: SymptomNames) => void;
}) {
  const defaultArea = kind === 'eyes' ? 'eye' : GENERAL_DISCOMFORT_AREA;
  // Keep unfinished inputs from the old per-area editor visible until added or cleared.
  const inputAreas: SymptomArea[] = [defaultArea, ...(Object.keys(names) as SymptomArea[])
    .filter((area) => area !== defaultArea && names[area]?.trim())];
  const full = Object.keys(value).length >= SYMPTOM_LIMIT;
  const choices = history.filter((item) => !value[item.key]);
  function add(area: SymptomArea, name: string, clearName = false) {
    const clean = name.trim();
    if (!clean || busy || full) return;
    const key = symptomKey(area, clean);
    onChange({ ...value, [key]: value[key] ?? reusableSymptom(area, clean, date, history) }, clearName ? { ...names, [area]: '' } : names);
  }
  function change(key: string, fields: Partial<SymptomObservation>) { onChange({ ...value, [key]: { ...value[key], ...fields } }, names); }
  return <fieldset className="life-symptom-area" disabled={busy}>
    <legend>症状</legend>
    {inputAreas.map((area) => {
      const name = names[area] ?? '';
      const label = area === GENERAL_DISCOMFORT_AREA ? '身体' : SYMPTOM_AREAS[area];
      return <div className="life-symptom-add" key={area}>
        {area !== defaultArea && <span>{label}</span>}
        <input aria-label={`${label}新症状`} value={name} disabled={full} maxLength={SYMPTOM_TEXT_LIMIT}
        placeholder={kind === 'eyes' ? '新增症状，如：红血丝' : '新增症状，如：湿气重'}
        onChange={(event) => onChange(value, { ...names, [area]: event.target.value })}
        onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); add(area, name, true); } }} />
        <button type="button" disabled={full || !name.trim()} onClick={() => add(area, name, true)}>添加</button>
      </div>;
    })}
    {choices.length > 0 && <div className="life-symptom-choices" aria-label="已存症状">
      {choices.map((item) => <button type="button" key={item.key} className="life-symptom-mark" style={symptomColor(item.key)} disabled={full}
        onClick={() => add(item.area, item.name)}>{symptomLabel(item.area, item.name)}</button>)}
    </div>}
    {Object.entries(value).map(([key, item]) => <div className="life-symptom-item" key={key}>
      <div className="life-symptom-item-heading"><span className="life-symptom-mark" style={symptomColor(key)}>{symptomLabel(item.area, item.name)}</span>
        <select aria-label={`${symptomLabel(item.area, item.name)}状态`} value={item.status} onChange={(event) => change(key, { status: event.target.value as SymptomState })}>
          {Object.entries(SYMPTOM_STATES).filter(([status]) => status !== 'recorded' || item.status === 'recorded')
            .map(([status, label]) => <option value={status} key={status}>{label}</option>)}
        </select>
        <button type="button" aria-label={`移除${symptomLabel(item.area, item.name)}`} onClick={() => {
          const next = { ...value }; delete next[key]; onChange(next, names);
        }}>×</button>
      </div>
      <input aria-label={`${symptomLabel(item.area, item.name)}备注`} placeholder="跟进备注 / 用药（选填）" maxLength={SYMPTOM_TEXT_LIMIT} value={item.note}
        onChange={(event) => change(key, { note: event.target.value })} />
    </div>)}
  </fieldset>;
}
