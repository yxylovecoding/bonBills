import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface TripStore {
  // key: trip startDate (YYYY-MM-DD), value: 选中的账单 tag
  tripTags: Record<string, string>;
  // key: 日期 d，表示「d 不与前一天合并，d 起开启新的一次出游」
  tripSplits: Record<string, true>;
  setTripTag: (startDate: string, tag: string) => void;
  clearTripTag: (startDate: string) => void;
  toggleTripSplit: (date: string) => void;
}

export const useTripStore = create<TripStore>()(
  persist(
    (set) => ({
      tripTags: {},
      tripSplits: {},
      setTripTag: (startDate, tag) =>
        set((s) => ({ tripTags: { ...s.tripTags, [startDate]: tag } })),
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
          if (nextSplits[date]) {
            // 取消切分 → 合并；连带把第二段的 tag 也清掉，避免孤立 tag 继续重路由
            delete nextSplits[date];
            delete nextTags[date];
          } else {
            nextSplits[date] = true;
          }
          return { tripSplits: nextSplits, tripTags: nextTags };
        }),
    }),
    { name: 'trip-tags', version: 2 },
  ),
);
