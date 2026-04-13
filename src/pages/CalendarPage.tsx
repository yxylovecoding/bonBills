import { useMemo, useState } from 'react';
import Card from '../components/Card';
import { tagMeta } from '../data/mockData';
import { useCalendarStore } from '../stores/calendarStore';
import { useConfigStore } from '../stores/configStore';
import { useSnapshotStore } from '../stores/snapshotStore';
import { formatCurrency } from '../components/CurrencyDisplay';
import type { TagKind } from '../models/types';

const C = { blue: '#1a73e8', sub: '#5f6368', border: '#e0e0e0', weekend: '#ea4335' };
const CN_MONTH = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
const WEEK_HEADERS = ['日', '一', '二', '三', '四', '五', '六'];
const TAG_ORDER: TagKind[] = ['school', 'intern', 'home', 'travel', 'rest'];

function pad(n: number) { return String(n).padStart(2, '0'); }
function getDaysInMonth(year: number, month: number) { return new Date(year, month + 1, 0).getDate(); }

function getDayOfWeek(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}
function isWeekend(key: string) {
  const dow = getDayOfWeek(key);
  return dow === 0 || dow === 6;
}

// 获取两个日期之间的所有日期 key（含两端）
function getRange(a: string, b: string): string[] {
  const [s, e] = a <= b ? [a, b] : [b, a];
  const result: string[] = [];
  const cur = new Date(s + 'T00:00:00');
  const end = new Date(e + 'T00:00:00');
  while (cur <= end) {
    result.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return result;
}

export default function CalendarPage() {
  const today = '2026-04-12';
  const [year, setYear]   = useState(2026);
  const [month, setMonth] = useState(3);
  const [selectedTag, setSelectedTag] = useState<TagKind>('school');
  const [warnMsg, setWarnMsg] = useState('');

  // 选择模式
  const [selectMode, setSelectMode] = useState<'single' | 'range'>('single');
  const [rangeStart, setRangeStart] = useState<string | null>(null);
  const [rangeHover, setRangeHover] = useState<string | null>(null);

  const { tagMap, setTag, toggleTag } = useCalendarStore();
  const { config } = useConfigStore();
  const { current } = useSnapshotStore();

  const todayDate = 12;
  const daysToPayDate = config.creditPayDate - todayDate;
  const daysToBillDate = config.creditBillDate - todayDate;
  const showPayWarn  = todayDate >= config.creditPayDate - 5 && todayDate <= config.creditPayDate;
  const showBillWarn = todayDate >= config.creditBillDate - 6 && todayDate <= config.creditBillDate;

  const yearMonth = `${year}-${pad(month + 1)}`;
  const daysInMonth = getDaysInMonth(year, month);
  const firstDayWeekIdx = new Date(year, month, 1).getDay();

  const cells = useMemo(() => {
    const arr: { key: string; day: number | null }[] = [];
    for (let i = 0; i < firstDayWeekIdx; i++) arr.push({ key: `empty-${i}`, day: null });
    for (let d = 1; d <= daysInMonth; d++) arr.push({ key: `${year}-${pad(month + 1)}-${pad(d)}`, day: d });
    while (arr.length < 42) arr.push({ key: `tail-${arr.length}`, day: null });
    return arr;
  }, [year, month, firstDayWeekIdx, daysInMonth]);

  // 当前预览范围（起止模式下，从 rangeStart 到 rangeHover 的所有 key）
  const previewRange = useMemo<Set<string>>(() => {
    if (selectMode !== 'range' || !rangeStart) return new Set();
    const end = rangeHover ?? rangeStart;
    return new Set(getRange(rangeStart, end));
  }, [selectMode, rangeStart, rangeHover]);

  const stats = useMemo(() => {
    const counts: Record<TagKind, number> = { school: 0, intern: 0, home: 0, travel: 0, rest: 0 };
    for (const cell of cells) {
      if (cell.day === null) continue;
      const tag = tagMap[cell.key];
      if (tag) counts[tag]++;
    }
    return { counts, tagged: Object.values(counts).reduce((a, b) => a + b, 0), total: daysInMonth };
  }, [cells, tagMap, daysInMonth]);

  const isBlocked = (key: string) => selectedTag === 'intern' && isWeekend(key);

  const handleCellClick = (key: string) => {
    if (isBlocked(key)) {
      setWarnMsg('实习周末不算上班（吃喝不在公司），请标记为上学或休息');
      setTimeout(() => setWarnMsg(''), 3000);
      return;
    }

    if (selectMode === 'single') {
      toggleTag(key, selectedTag);
      return;
    }

    // 起止模式
    if (!rangeStart) {
      setRangeStart(key);
      setRangeHover(key);
    } else {
      // 应用范围
      const range = getRange(rangeStart, key);
      const validKeys = new Set(cells.filter(c => c.day !== null).map(c => c.key));
      for (const k of range) {
        if (validKeys.has(k) && !isBlocked(k)) setTag(k, selectedTag);
      }
      setRangeStart(null);
      setRangeHover(null);
    }
  };

  const cancelRange = () => { setRangeStart(null); setRangeHover(null); };

  const switchMode = (m: 'single' | 'range') => {
    setSelectMode(m);
    setRangeStart(null);
    setRangeHover(null);
  };

  const prevMonth = () => {
    cancelRange();
    if (month === 0) { setYear((y) => y - 1); setMonth(11); } else setMonth((m) => m - 1);
  };
  const nextMonth = () => {
    cancelRange();
    if (month === 11) { setYear((y) => y + 1); setMonth(0); } else setMonth((m) => m + 1);
  };

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 14px' }}>日历标记</h1>

      {/* 月份导航 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <button onClick={prevMonth} style={navBtnStyle}>‹</button>
        <span style={{ fontSize: 16, fontWeight: 600 }}>{CN_MONTH[month]} {year}</span>
        <button onClick={nextMonth} style={navBtnStyle}>›</button>
      </div>

      {/* Tag 选择器 + 模式切换 */}
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, marginBottom: 8, alignItems: 'center' }}>
        {TAG_ORDER.map((t) => {
          const meta = tagMeta[t];
          const active = selectedTag === t;
          return (
            <button key={t} onClick={() => { setSelectedTag(t); cancelRange(); }} style={{
              flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4,
              padding: '6px 14px', borderRadius: 20, fontSize: 13,
              border: active ? `2px solid ${C.blue}` : `1px solid ${C.border}`,
              backgroundColor: active ? '#e8f0fe' : '#ffffff',
              color: active ? C.blue : C.sub,
              fontWeight: active ? 600 : 400, cursor: 'pointer',
            }}>
              {meta.icon} {meta.label}
            </button>
          );
        })}
      </div>

      {/* 选择模式切换 */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 12, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden', alignSelf: 'flex-start', width: 'fit-content' }}>
        {(['single', 'range'] as const).map((m) => (
          <button key={m} onClick={() => switchMode(m)} style={{
            padding: '6px 16px', fontSize: 13, border: 'none', cursor: 'pointer',
            backgroundColor: selectMode === m ? C.blue : '#fff',
            color: selectMode === m ? '#fff' : C.sub,
            fontWeight: selectMode === m ? 600 : 400,
          }}>
            {m === 'single' ? '单击' : '起止'}
          </button>
        ))}
      </div>

      {/* 起止模式提示 */}
      {selectMode === 'range' && (
        <div style={{ fontSize: 13, color: rangeStart ? C.blue : C.sub, backgroundColor: rangeStart ? '#e8f0fe' : '#f8f9fa', border: `1px solid ${rangeStart ? '#a8c7fa' : C.border}`, borderRadius: 10, padding: '8px 14px', marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{rangeStart ? `已选起点 ${rangeStart}，点击终点日期` : '点击起点日期'}</span>
          {rangeStart && <button onClick={cancelRange} style={{ fontSize: 12, color: C.sub, border: 'none', background: 'none', cursor: 'pointer' }}>✕ 取消</button>}
        </div>
      )}

      {/* 周末提示 */}
      {warnMsg && (
        <div style={{ backgroundColor: '#fef7e0', border: '1px solid #fdd663', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#b06000', marginBottom: 12 }}>
          ⚠️ {warnMsg}
        </div>
      )}

      {/* 月历 */}
      <Card>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, textAlign: 'center', fontSize: 11, marginBottom: 4, fontWeight: 500 }}>
          {WEEK_HEADERS.map((w, i) => (
            <div key={w} style={{ color: (i === 0 || i === 6) ? C.weekend : C.sub }}>{w}</div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
          {cells.map((cell) => {
            if (cell.day === null) return <div key={cell.key} style={{ aspectRatio: '1' }} />;

            const tag = tagMap[cell.key];
            const isToday = cell.key === today;
            const weekend = isWeekend(cell.key);
            const blocked = selectedTag === 'intern' && weekend;
            const isRangeStart = cell.key === rangeStart;
            const inPreview = previewRange.has(cell.key);

            // 显示颜色：预览范围内用 selectedTag 颜色，否则用已标记颜色
            const displayTag = inPreview ? selectedTag : tag;
            const displayMeta = displayTag ? tagMeta[displayTag] : null;

            let borderStyle = 'none';
            if (isToday) borderStyle = `2px solid ${C.blue}`;
            else if (isRangeStart) borderStyle = `2px solid ${C.blue}`;
            else if (inPreview) borderStyle = `1.5px dashed ${C.blue}`;

            return (
              <button
                key={cell.key}
                onClick={() => handleCellClick(cell.key)}
                onMouseEnter={() => {
                  if (selectMode === 'range' && rangeStart) setRangeHover(cell.key);
                }}
                title={blocked ? '实习周末不算上班' : undefined}
                style={{
                  aspectRatio: '1', borderRadius: 10, fontSize: 12,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  border: borderStyle,
                  backgroundColor: displayMeta ? `${displayMeta.color}20` : weekend ? '#fff0f0' : '#f8f9fa',
                  color: displayMeta ? displayMeta.color : weekend ? C.weekend : '#202124',
                  cursor: blocked ? 'not-allowed' : 'pointer',
                  fontWeight: 500, transition: 'all 0.1s', opacity: blocked ? 0.6 : 1,
                  outline: 'none',
                }}
              >
                {cell.day}
                {displayMeta && <span style={{ fontSize: 8, marginTop: 1 }}>{displayMeta.icon}</span>}
              </button>
            );
          })}
        </div>
      </Card>

      {/* 统计 */}
      <Card title="本月统计" subtitle={`${yearMonth} · 已标记 ${stats.tagged}/${stats.total}`}>
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

      {/* 信用卡提醒 */}
      {(showPayWarn || showBillWarn) && (
        <div style={{ marginBottom: 16 }}>
          {showPayWarn && (
            <div style={{ backgroundColor: '#fce8e6', border: '1px solid #f28b82', borderRadius: 12, padding: '12px 16px', fontSize: 13, color: '#c5221f', marginBottom: 8 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>💳 还款提醒</div>
              <div>{config.creditPayDate} 号还款，还有 {daysToPayDate} 天</div>
              <div style={{ marginTop: 4, opacity: 0.85 }}>待还金额 ¥{formatCurrency(current.accounts.credit)}</div>
            </div>
          )}
          {showBillWarn && (
            <div style={{ backgroundColor: '#fef7e0', border: '1px solid #fdd663', borderRadius: 12, padding: '12px 16px', fontSize: 13, color: '#b06000' }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>🧾 出账提醒</div>
              <div>{config.creditBillDate} 号出账，还有 {daysToBillDate} 天，请确认消费</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const navBtnStyle: React.CSSProperties = {
  width: 36, height: 36, borderRadius: '50%', backgroundColor: '#ffffff',
  border: '1px solid #e0e0e0', color: '#5f6368', fontSize: 18, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};
