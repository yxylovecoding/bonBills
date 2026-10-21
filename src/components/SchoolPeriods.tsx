import { useState, type CSSProperties } from 'react';
import type { SchoolPeriod } from '../models/types';
import SceneCityFields from './SceneCityFields';
import { BEIJING } from '../utils/internship';
import { NANJING, schoolPeriodError } from '../utils/schoolPeriods';
import { cityLabel } from '../utils/sceneCities';

const presets = [NANJING, BEIJING];
const button: CSSProperties = { border: 'none', borderRadius: 7, padding: '6px 10px', background: '#f1f3f4', color: '#1a73e8', fontSize: 12, cursor: 'pointer' };
const input: CSSProperties = { width: '100%', minWidth: 0, boxSizing: 'border-box', border: '1px solid #dadce0', borderRadius: 7, padding: '6px', fontSize: 12 };

export default function SchoolPeriods({ periods, onChange, onEditingChange }: {
  periods: SchoolPeriod[]; onChange: (periods: SchoolPeriod[]) => void; onEditingChange: (editing: boolean) => void;
}) {
  const [draft, setDraft] = useState<SchoolPeriod | null>(null);
  const error = draft ? schoolPeriodError(draft, periods) : null;
  const edit = (value: SchoolPeriod | null) => { setDraft(value); onEditingChange(Boolean(value)); };
  return <div style={{ marginBottom: 12 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, fontWeight: 700 }}>
      <span>上学日期</span><button type="button" style={button} disabled={Boolean(draft)} onClick={() => edit({ id: crypto.randomUUID(), city: null, startMonth: '', endMonth: '' })}>＋阶段</button>
    </div>
    {!draft && [...periods].sort((a, b) => a.startMonth.localeCompare(b.startMonth)).map(period => <button type="button" key={period.id} style={{ ...button, width: '100%', display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 6 }} onClick={() => edit(period)}>
      <span>{cityLabel(period.city)}</span><span style={{ color: '#5f6368' }}>{period.startMonth} — {period.endMonth}</span>
    </button>)}
    {draft && <div style={{ marginTop: 8 }}>
      <SceneCityFields value={{ schoolCity: draft.city }} onChange={value => setDraft({ ...draft, city: value.schoolCity ?? null })} onlySchool presets={presets} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <label style={{ fontSize: 12 }}>开始月份<input aria-label="上学开始月份" style={input} type="month" value={draft.startMonth} onChange={event => setDraft({ ...draft, startMonth: event.target.value })} /></label>
        <label style={{ fontSize: 12 }}>结束月份<input aria-label="上学结束月份" style={input} type="month" value={draft.endMonth} onChange={event => setDraft({ ...draft, endMonth: event.target.value })} /></label>
      </div>
      {error && <div role="status" style={{ color: '#c5221f', fontSize: 12, marginTop: 6 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end' }}>
        {periods.some(p => p.id === draft.id) && <button type="button" style={{ ...button, color: '#c5221f', marginRight: 'auto' }} onClick={() => { onChange(periods.filter(p => p.id !== draft.id)); edit(null); }}>删除</button>}
        <button type="button" style={button} onClick={() => edit(null)}>取消</button>
        <button type="button" style={{ ...button, opacity: error ? 0.5 : 1 }} disabled={Boolean(error)} onClick={() => {
          if (error) return;
          onChange([...periods.filter(p => p.id !== draft.id), draft].sort((a, b) => a.startMonth.localeCompare(b.startMonth))); edit(null);
        }}>完成</button>
      </div>
    </div>}
  </div>;
}
