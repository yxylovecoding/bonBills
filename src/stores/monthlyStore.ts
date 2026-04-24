import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { MonthlyRecord } from '../models/types';

const INITIAL_RECORDS: MonthlyRecord[] = [];

interface DayCounts {
  schoolDays: number;
  internDays: number;
  homeDays: number;
  travelDays: number;
}

interface MonthlyStore {
  records: MonthlyRecord[];
  upsert: (record: MonthlyRecord) => void;
  updateDayCounts: (yearMonth: string, counts: DayCounts) => void;
  getByYearMonth: (ym: string) => MonthlyRecord | undefined;
}

export const useMonthlyStore = create<MonthlyStore>()(
  persist(
    (set, get) => ({
      records: INITIAL_RECORDS,
      upsert: (record) =>
        set((s) => {
          const idx = s.records.findIndex((r) => r.yearMonth === record.yearMonth);
          if (idx >= 0) {
            const next = [...s.records];
            next[idx] = record;
            return { records: next };
          }
          return { records: [record, ...s.records].sort((a, b) => b.yearMonth.localeCompare(a.yearMonth)) };
        }),
      updateDayCounts: (yearMonth, counts) =>
        set((s) => {
          const idx = s.records.findIndex((r) => r.yearMonth === yearMonth);
          if (idx < 0) return s; // 没有对应记录则不操作
          const next = [...s.records];
          next[idx] = { ...next[idx], ...counts };
          return { records: next };
        }),
      getByYearMonth: (ym) => get().records.find((r) => r.yearMonth === ym),
    }),
    { name: 'monthly-records' },
  ),
);
