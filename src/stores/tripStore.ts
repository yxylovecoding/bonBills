import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface TripStore {
  // key: trip startDate (YYYY-MM-DD), value: 选中的账单 tag
  tripTags: Record<string, string>;
  // key: trip startDate (YYYY-MM-DD), value: 出游备注
  tripNotes: Record<string, string>;
  // key: 日期 d，表示「d 不与前一天合并，d 起开启新的一次出游」
  tripSplits: Record<string, true>;
  setTripTag: (startDate: string, tag: string) => void;
  setTripNote: (startDate: string, note: string) => void;
  clearTripTag: (startDate: string) => void;
  toggleTripSplit: (date: string) => void;
}

export const useTripStore = create<TripStore>()(
  persist(
    (set) => ({
      tripTags: {},
      tripNotes: {},
      tripSplits: {},
      setTripTag: (startDate, tag) =>
        set((s) => ({ tripTags: { ...s.tripTags, [startDate]: tag } })),
      setTripNote: (startDate, note) =>
        set((s) => {
          const next = { ...s.tripNotes };
          if (note) next[startDate] = note;
          else delete next[startDate];
          return { tripNotes: next };
        }),
      clearTripTag: (startDate) =>
        set((s) => {
          const next = { ...s.tripTags };
          delete next[startDate];
          return { tripTags: next };
        }),
      toggleTripSplit: (date) =>
        set((s) => {
          const nextSplits = { ...s.tripSplits };
          const nextTags = { ...s.tripTags };
          const nextNotes = { ...s.tripNotes };
          if (nextSplits[date]) {
            // 取消切分 → 合并；连带清掉第二段数据，避免孤立数据继续保留
            delete nextSplits[date];
            delete nextTags[date];
            delete nextNotes[date];
          } else {
            nextSplits[date] = true;
          }
          return { tripSplits: nextSplits, tripTags: nextTags, tripNotes: nextNotes };
        }),
    }),
    { name: 'trip-tags', version: 2 },
  ),
);
