import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { TagKind } from '../models/types';

// tagMap: { "2026-04-11": "school", ... }
type TagMap = Record<string, TagKind>;

interface CalendarStore {
  tagMap: TagMap;
  initializedFromRecords: boolean; // 防止重复执行一次性初始化
  setTag: (date: string, tag: TagKind) => void;
  removeTag: (date: string) => void;
  toggleTag: (date: string, tag: TagKind) => void;
  getTagsForMonth: (yearMonth: string) => TagMap;
  countByTag: (yearMonth: string) => Record<TagKind, number>;
  bulkFillSchool: (fromDate: string, toDate: string) => void;
  initMonthFromCounts: (yearMonth: string, counts: { school: number; intern: number; home: number; travel: number }) => void;
  markInitialized: () => void;
}

export const useCalendarStore = create<CalendarStore>()(
  persist(
    (set, get) => ({
      tagMap: {
        // 初始数据：2026-04 已标记天数
        '2026-04-01': 'school', '2026-04-02': 'school', '2026-04-03': 'school',
        '2026-04-04': 'school', '2026-04-05': 'school',
        '2026-04-06': 'school', '2026-04-07': 'school', '2026-04-08': 'school',
        '2026-04-09': 'school', '2026-04-10': 'school', '2026-04-11': 'school',
      },
      initializedFromRecords: false,

      setTag: (date, tag) =>
        set((s) => ({ tagMap: { ...s.tagMap, [date]: tag } })),

      removeTag: (date) =>
        set((s) => {
          const next = { ...s.tagMap };
          delete next[date];
          return { tagMap: next };
        }),

      toggleTag: (date, tag) => {
        const current = get().tagMap[date];
        if (current === tag) {
          get().removeTag(date);
        } else {
          get().setTag(date, tag);
        }
      },

      getTagsForMonth: (yearMonth) => {
        const map = get().tagMap;
        const result: TagMap = {};
        for (const [date, tag] of Object.entries(map)) {
          if (date.startsWith(yearMonth)) result[date] = tag;
        }
        return result;
      },

      countByTag: (yearMonth) => {
        const monthMap = get().getTagsForMonth(yearMonth);
        const counts: Record<TagKind, number> = { intern: 0, school: 0, home: 0, travel: 0 };
        for (const tag of Object.values(monthMap)) counts[tag]++;
        return counts;
      },

      bulkFillSchool: (fromDate, toDate) =>
        set((s) => {
          const next = { ...s.tagMap };
          const cur = new Date(fromDate + 'T00:00:00');
          const end = new Date(toDate + 'T00:00:00');
          while (cur <= end) {
            const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
            if (!next[key]) next[key] = 'school';
            cur.setDate(cur.getDate() + 1);
          }
          return { tagMap: next };
        }),

      // 按天数分配某月的状态标签（覆盖写入）
      // 分配顺序（从月末往前）：home → travel → intern → school
      initMonthFromCounts: (yearMonth, counts) =>
        set((s) => {
          const [y, m] = yearMonth.split('-').map(Number);
          const daysInMonth = new Date(y, m, 0).getDate();
          const days: string[] = Array.from({ length: daysInMonth }, (_, i) =>
            `${yearMonth}-${String(i + 1).padStart(2, '0')}`,
          ).reverse();

          const assignments: TagMap = {};
          let idx = 0;
          for (let i = 0; i < counts.home;   i++) assignments[days[idx++]] = 'home';
          for (let i = 0; i < counts.travel;  i++) assignments[days[idx++]] = 'travel';
          for (let i = 0; i < counts.intern;  i++) assignments[days[idx++]] = 'intern';
          while (idx < daysInMonth) assignments[days[idx++]] = 'school';

          return { tagMap: { ...s.tagMap, ...assignments } };
        }),

      markInitialized: () => set({ initializedFromRecords: true }),
    }),
    { name: 'calendar-tags' },
  ),
);
