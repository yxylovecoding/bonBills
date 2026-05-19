import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface TripStore {
  // key: trip startDate (YYYY-MM-DD), value: 选中的账单 tag
  tripTags: Record<string, string>;
  setTripTag: (startDate: string, tag: string) => void;
  clearTripTag: (startDate: string) => void;
}

export const useTripStore = create<TripStore>()(
  persist(
    (set) => ({
      tripTags: {},
      setTripTag: (startDate, tag) =>
        set((s) => ({ tripTags: { ...s.tripTags, [startDate]: tag } })),
      clearTripTag: (startDate) =>
        set((s) => {
          const next = { ...s.tripTags };
          delete next[startDate];
          return { tripTags: next };
        }),
    }),
    { name: 'trip-tags', version: 1 },
  ),
);
