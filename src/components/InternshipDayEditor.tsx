import { useCalendarStore } from '../stores/calendarStore';
import { useLifeCalendar } from '../hooks/useLifeCalendar';
import { resolveDailyContext } from '../utils/internship';
import { CityPicker } from './InternshipSettings';
export default function InternshipDayEditor({ date }: { date: string }) {
  const { rawTagMap, internship } = useLifeCalendar();
  const { dayOverrides, setDayOverride } = useCalendarStore();
  const day = resolveDailyContext(date, rawTagMap[date], internship), value = dayOverrides[date] ?? {};
  return <div style={{ padding: 12, background: '#f8f9fa', borderRadius: 12, marginBottom: 8 }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 12 }}>
      <strong>{date} · {day.label}</strong>
      {day.period && <select aria-label="当日出勤" value={value.attendance ?? 'auto'} onChange={e => {
        const { attendance: _a, attendanceLocked: _l, ...rest } = value;
        setDayOverride(date, e.target.value === 'auto' ? rest : { ...rest, attendance: e.target.value as 'work' | 'rest', attendanceLocked: true });
      }} style={{ border: '1px solid #dadce0', borderRadius: 6, padding: 5 }}><option value="auto">自动</option><option value="work">出勤</option><option value="rest">休息／请假</option></select>}
    </div>
    <CityPicker city={day.city} onChange={city => { const { city: _city, ...rest } = value; setDayOverride(date, city ? { ...rest, city } : rest); }} label="当日城市" />
    {value.city && <button type="button" style={{ border: 0, background: 'none', color: '#1a73e8', fontSize: 12 }} onClick={() => { const { city: _city, ...rest } = value; setDayOverride(date, rest); }}>恢复默认城市</button>}
  </div>;
}
