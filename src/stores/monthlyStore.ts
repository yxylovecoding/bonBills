import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { MonthlyRecord } from '../models/types';
import { normalizeBillYearMonth } from '../utils/importBill';

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

function mergeMonthlyRecord(a: MonthlyRecord | undefined, b: MonthlyRecord): MonthlyRecord {
  if (!a) return b;
  return {
    ...a,
    ...b,
    accumulatedProfit: b.accumulatedProfit || a.accumulatedProfit,
    investTotal: b.investTotal || a.investTotal,
    investBreakdown: b.investBreakdown ?? a.investBreakdown,
    investBreakdownProfit: b.investBreakdownProfit ?? a.investBreakdownProfit,
    investBreakdownProfitStatus: b.investBreakdownProfitStatus ?? a.investBreakdownProfitStatus,
    investProfitComponents: b.investProfitComponents ?? a.investProfitComponents,
    majorExpenses: b.majorExpenses?.length ? b.majorExpenses : a.majorExpenses,
    majorExpensesNote: b.majorExpensesNote ?? a.majorExpensesNote,
  };
}

export function normalizeMonthlyRecords(input: unknown): MonthlyRecord[] {
  if (!Array.isArray(input)) return [];
  const byMonth = new Map<string, MonthlyRecord>();
  for (const record of input) {
    if (!record || typeof record !== 'object') continue;
    const ym = normalizeBillYearMonth((record as MonthlyRecord).yearMonth);
    if (!ym) continue;
    const normalized = { ...(record as MonthlyRecord), yearMonth: ym };
    byMonth.set(ym, mergeMonthlyRecord(byMonth.get(ym), normalized));
  }
  return [...byMonth.values()].sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));
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
    {
      name: 'monthly-records',
      version: 1,
      migrate: (persistedState) => {
        if (!persistedState || typeof persistedState !== 'object') return persistedState;
        return {
          ...(persistedState as Partial<MonthlyStore>),
          records: normalizeMonthlyRecords((persistedState as Partial<MonthlyStore>).records),
        };
      },
      merge: (persistedState, currentState) => {
        const persisted = (persistedState ?? {}) as Partial<MonthlyStore>;
        return {
          ...currentState,
          ...persisted,
          records: normalizeMonthlyRecords(persisted.records ?? currentState.records),
        };
      },
    },
  ),
);
