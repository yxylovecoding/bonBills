import { useMemo, useState } from 'react';
import Card from '../components/Card';
import { tagMeta } from '../data/mockData';
import type { TagKind } from '../models/types';

const CN_MONTH = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
const WEEK_HEADERS = ['日', '一', '二', '三', '四', '五', '六'];
const TAG_ORDER: TagKind[] = ['school', 'intern', 'home', 'travel', 'rest'];

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

export default function CalendarPage() {
  // 默认显示 2026-04 (今天 04-11)
  const [year, setYear] = useState(2026);
  const [month, setMonth] = useState(3); // 0-indexed
  const [selectedTag, setSelectedTag] = useState<TagKind>('school');
  const [tagMap, setTagMap] = useState<Record<string, TagKind>>({
    // MVP 预置几个示例
    '2026-04-01': 'school',
    '2026-04-02': 'school',
    '2026-04-03': 'school',
    '2026-04-04': 'rest',
    '2026-04-05': 'rest',
    '2026-04-06': 'school',
    '2026-04-07': 'school',
    '2026-04-08': 'school',
    '2026-04-09': 'school',
    '2026-04-10': 'school',
    '2026-04-11': 'rest',
  });

  const todayKey = '2026-04-11';
  const daysInMonth = getDaysInMonth(year, month);
  const firstDayWeekIdx = new Date(year, month, 1).getDay();

  // 生成 42 格
  const cells = useMemo(() => {
    const arr: { key: string; day: number | null }[] = [];
    for (let i = 0; i < firstDayWeekIdx; i++) arr.push({ key: `empty-${i}`, day: null });
    for (let d = 1; d <= daysInMonth; d++) {
      arr.push({ key: `${year}-${pad(month + 1)}-${pad(d)}`, day: d });
    }
    while (arr.length < 42) arr.push({ key: `tail-${arr.length}`, day: null });
    return arr;
  }, [year, month, firstDayWeekIdx, daysInMonth]);

  const stats = useMemo(() => {
    const counts: Record<TagKind, number> = {
      school: 0, intern: 0, home: 0, travel: 0, rest: 0,
    };
    for (const cell of cells) {
      if (cell.day === null) continue;
      const tag = tagMap[cell.key];
      if (tag) counts[tag] += 1;
    }
    const tagged = Object.values(counts).reduce((a, b) => a + b, 0);
    return { counts, tagged, total: daysInMonth };
  }, [cells, tagMap, daysInMonth]);

  const toggle = (key: string) => {
    setTagMap((prev) => {
      const next = { ...prev };
      if (next[key] === selectedTag) delete next[key];
      else next[key] = selectedTag;
      return next;
    });
  };

  const prevMonth = () => {
    if (month === 0) {
      setYear((y) => y - 1);
      setMonth(11);
    } else setMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) {
      setYear((y) => y + 1);
      setMonth(0);
    } else setMonth((m) => m + 1);
  };

  return (
    <div>
      <h1 className="text-xl font-semibold mb-3">日历标记</h1>

      {/* 月份导航 */}
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={prevMonth}
          className="w-9 h-9 rounded-full bg-cardDark text-white/60 hover:text-white"
        >
          ‹
        </button>
        <div className="text-base font-medium">
          {CN_MONTH[month]} {year}
        </div>
        <button
          onClick={nextMonth}
          className="w-9 h-9 rounded-full bg-cardDark text-white/60 hover:text-white"
        >
          ›
        </button>
      </div>

      {/* Tag 选择器 */}
      <div className="flex gap-2 overflow-x-auto pb-2 mb-3 -mx-4 px-4">
        {TAG_ORDER.map((t) => {
          const meta = tagMeta[t];
          const active = selectedTag === t;
          return (
            <button
              key={t}
              onClick={() => setSelectedTag(t)}
              className={`shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full text-xs
                          border transition-colors
                          ${active
                            ? 'border-white/60 bg-white/10'
                            : 'border-white/10 bg-cardDark text-white/60'}`}
              style={active ? { color: meta.color } : undefined}
            >
              <span>{meta.icon}</span>
              <span>{meta.label}</span>
            </button>
          );
        })}
      </div>

      {/* 月历 */}
      <Card>
        <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-white/40 mb-1">
          {WEEK_HEADERS.map((w) => (
            <div key={w}>{w}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((cell) => {
            if (cell.day === null) {
              return <div key={cell.key} className="aspect-square" />;
            }
            const tag = tagMap[cell.key];
            const meta = tag ? tagMeta[tag] : null;
            const isToday = cell.key === todayKey;
            return (
              <button
                key={cell.key}
                onClick={() => toggle(cell.key)}
                className={`aspect-square rounded-lg text-xs flex flex-col items-center
                            justify-center transition-colors relative
                            ${isToday ? 'ring-2 ring-blue-400' : ''}
                            ${meta ? '' : 'bg-white/5 hover:bg-white/10'}`}
                style={
                  meta
                    ? { backgroundColor: `${meta.color}33`, color: meta.color }
                    : undefined
                }
              >
                <span className="font-medium">{cell.day}</span>
                {meta && <span className="text-[8px] leading-none mt-0.5">{meta.icon}</span>}
              </button>
            );
          })}
        </div>
      </Card>

      {/* 统计 */}
      <Card title="本月统计" subtitle={`已标记 ${stats.tagged}/${stats.total}`}>
        <div className="space-y-2">
          {TAG_ORDER.map((t) => {
            const meta = tagMeta[t];
            const count = stats.counts[t];
            const pct = stats.total > 0 ? (count / stats.total) * 100 : 0;
            return (
              <div key={t} className="flex items-center gap-2 text-xs">
                <span className="w-14 shrink-0">{meta.icon} {meta.label}</span>
                <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className="h-full"
                    style={{ width: `${pct}%`, backgroundColor: meta.color }}
                  />
                </div>
                <span className="w-8 text-right tabular-nums text-white/60">{count}</span>
              </div>
            );
          })}
        </div>
        {stats.tagged < stats.total && (
          <div className="mt-3 text-xs text-orange-400 bg-orange-500/10 rounded-lg p-2">
            💡 还有 {stats.total - stats.tagged} 天未标记
          </div>
        )}
      </Card>
    </div>
  );
}
