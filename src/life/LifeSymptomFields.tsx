import { SYMPTOM_TEXT_LIMIT } from '../utils/lifeSymptoms';

export default function LifeSymptomFields<T extends string>({ fields, value = {}, placeholder, busy, onChange }: {
  fields: Record<T, string>; value?: Partial<Record<T, string>>; placeholder: string;
  busy: boolean; onChange: (value: Partial<Record<T, string>>) => void;
}) {
  return <div className="life-symptom-fields">{(Object.entries(fields) as [T, string][]).map(([field, label], index) =>
    <label className="life-field" key={field}>{label}
      <textarea rows={2} autoFocus={index === 0} maxLength={SYMPTOM_TEXT_LIMIT} disabled={busy}
        placeholder={placeholder} value={value[field] ?? ''}
        onChange={(event) => onChange({ ...value, [field]: event.target.value })} />
    </label>)}</div>;
}
