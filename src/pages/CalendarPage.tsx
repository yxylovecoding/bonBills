import { useMemo, useState } from 'react';
import Card from '../components/Card';
import { tagMeta } from '../data/mockData';
import type { TagKind } from '../models/types';

const C = { blue: '#1a73e8', sub: '#5f6368', border: '#e0e0e0' };
const CN_MONTH = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
const WEEK_HEADERS = ['日', '一', '二', '三', '四', '五', '六'];
const TAG_ORDER: TagKind[] = ['school', 'intern', 'home', 'travel', 'rest'];

function pad(n: number) { return String(n).padStart(2, '0'); }
function getDaysInMonth(year: number, month: number) { return new Date(year, month + 1, 0).getDate(); }

export default function CalendarPage() {
  const [year, setYear] = useState(2026);
  const [month, setMonth] = useState(3);
  const [selectedTag, setSelectedTag] = useState<TagKind>('school');
  const [tagMap, setTagMap] = useState<Record<string, TagKind>>({
    '2026-04-01': 'school', '2026-04-02': 'school', '2026-04-03': 'school',
    '2026-04-04': 'rest', '2026-04-05': 'rest',
    '2026-04-06': 'school', '2026-04-07': 'school', '2026-04-08': 'school',
    '2026-04-09': 'school', '2026-04-10': 'school', '2026-04-11': 'rest',
  });

  const todayKey = '2026-04-11';
  const daysInMonth = getDaysInMonth(year, month);
  const firstDayWeekIdx = new Date(year, month, 1).getDay();

  const cells = useMemo(() => {
    const arr: { key: string; day: number | null }[] = [];
    for (let i = 0; i < firstDayWeekIdx; i++) arr.push({ key: `empty-${i}`, day: null });
    for (let d = 1; d <= daysInMonth; d++) arr.push({ key: `${year}-${pad(month + 1)}-${pad(d)}`, day: d });
    while (arr.length < 42) arr.push({ key: `tail-${arr.length}`, day: null });
    return arr;
  }, [year, month, firstDayWeekIdx, daysInMonth]);

  const stats = useMemo(() => {
    const counts: Record<TagKind, number> = { school: 0, intern: 0, home: 0, travel: 0, rest: 0 };
    for (const cell of cells) {
      if (cell.day === null) continue;
      const tag = tagMap[cell.key];
      if (tag) counts[tag] += 1;
    }
    return { counts, tagged: Object.values(counts).reduce((a, b) => a + b, 0), total: daysInMonth };
  }, [cells, tagMap, daysInMonth]);

  const toggle = (key: string) => {
    setTagMap((prev) => {
      const next = { ...prev };
      if (next[key] === selectedTag) delete next[key]; else next[key] = selectedTag;
      return next;
    });
  };

  const prevMonth = () => { if (month === 0) { setYear((y) => y - 1); setMonth(11); } else setMonth((m) => m - 1); };
  const nextMonth = () => { if (month === 11) { setYear((y) => y + 1); setMonth(0); } else setMonth((m) => m + 1); };

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 14px' }}>日历标记</h1>

      {/* 月份导航 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <button onClick={prevMonth} style={navBtnStyle}>‹</button>
        <span style={{ fontSize: 16, fontWeight: 600 }}>{CN_MONTH[month]} {year}</span>
        <button onClick={nextMonth} style={navBtnStyle}>›</button>
      </div>

      {/* Tag 选择器 */}
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, marginBottom: 12 }}>
        {TAG_ORDER.map((t) => {
          const meta = tagMeta[t];
          const active = selectedTag === t;
          return (
            <button
              key={t}
              onClick={() => setSelectedTag(t)}
              style={{
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '6px 14px',
                borderRadius: 20,
                fontSize: 13,
                border: active ? `2px solid ${C.blue}` : `1px solid ${C.border}`,
                backgroundColor: active ? '#e8f0fe' : '#ffffff',
                color: active ? C.blue : C.sub,
                fontWeight: active ? 600 : 400,
                cursor: 'pointer',
              }}
            >
              {meta.icon} {meta.label}
            </button>
          );
        })}
      </div>

      {/* 月历 */}
      <Card>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, textAlign: 'center', fontSize: 11, color: C.sub, marginBottom: 4, fontWeight: 500 }}>
          {WEEK_HEADERS.map((w) => <div key={w}>{w}</div>)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
          {cells.map((cell) => {
            if (cell.day === null) return <div key={cell.key} style={{ aspectRatio: '1' }} />;
            const tag = tagMap[cell.key];
            const meta = tag ? tagMeta[tag] : null;
            const isToday = cell.key === todayKey;
            return (
              <button
                key={cell.key}
                onClick={() => toggle(cell.key)}
                style={{
                  aspectRatio: '1',
                  borderRadius: 10,
                  fontSize: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: isToday ? `2px solid ${C.blue}` : 'none',
                  backgroundColor: meta ? `${meta.color}18` : '#f8f9fa',
                  color: meta ? meta.color : '#202124',
                  cursor: 'pointer',
                  fontWeight: 500,
                  transition: 'all 0.15s',
                }}
              >
                {cell.day}
                {meta && <span style={{ fontSize: 8, marginTop: 1 }}>{meta.icon}</span>}
              </button>
            );
          })}
        </div>
      </Card>

      {/* 统计 */}
      <Card title="本月统计" subtitle={`已标记 ${stats.tagged}/${stats.total}`}>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <tbody>
            {TAG_ORDER.map((t) => {
              const meta = tagMeta[t];
              const count = stats.counts[t];
              const pct = stats.total > 0 ? (count / stats.total) * 100 : 0;
              return (
                <tr key={t}>
                  <td style={{ padding: '6px 0', width: 70, color: C.sub }}>{meta.icon} {meta.label}</td>
                  <td style={{ padding: '6px 8px' }}>
                    <div style={{ height: 8, backgroundColor: '#e8eaed', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, backgroundColor: meta.color, borderRadius: 4, transition: 'width 0.3s' }} />
                    </div>
                  </td>
                  <td style={{ padding: '6px 0', width: 30, textAlign: 'right', fontWeight: 500, fontVariantNumeric: 'tabular-nums', color: C.sub }}>{count}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {stats.tagged < stats.total && (
          <div style={{ marginTop: 12, fontSize: 13, color: '#e8710a', backgroundColor: '#fef7e0', border: '1px solid #fdd663', borderRadius: 12, padding: '10px 14px' }}>
            💡 还有 {stats.total - stats.tagged} 天未标记
          </div>
        )}
      </Card>
    </div>
  );
}

const navBtnStyle: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: '50%',
  backgroundColor: '#ffffff',
  border: `1px solid #e0e0e0`,
  color: '#5f6368',
  fontSize: 18,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};
