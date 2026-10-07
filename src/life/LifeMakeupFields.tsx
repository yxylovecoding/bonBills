import { EMPTY_MAKEUP, MAKEUP_FIELDS, type MakeupRecord } from '../utils/lifeMakeup';

export default function LifeMakeupFields({ value = EMPTY_MAKEUP, busy, onChange }: {
  value?: MakeupRecord; busy: boolean; onChange: (value: MakeupRecord) => void;
}) {
  return <div className="life-fields">{(Object.entries(MAKEUP_FIELDS) as [keyof typeof MAKEUP_FIELDS, string][]).map(([key, label]) =>
    <label className="life-field" key={key}>{label}<select disabled={busy} value={value[key] === null ? '' : String(value[key])}
      onChange={(event) => onChange({ ...value, [key]: event.target.value === '' ? null : event.target.value === 'true' })}>
      <option value="">未记录</option><option value="true">有</option><option value="false">无</option>
    </select></label>)}</div>;
}
