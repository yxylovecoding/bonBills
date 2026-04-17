import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { TagKind } from '../models/types';

// tagMap: { "2026-04-11": "school", ... }
type TagMap = Record<string, TagKind>;

interface CalendarStore {
  tagMap: TagMap;
  setTag: (date: string, tag: TagKind) => void;
  removeTag: (date: string) => void;
  toggleTag: (date: string, tag: TagKind) => void;
  getTagsForMonth: (yearMonth: string) => TagMap;
  countByTag: (yearMonth: string) => Record<TagKind, number>;
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
    }),
    { name: 'calendar-tags' },
  ),
);
