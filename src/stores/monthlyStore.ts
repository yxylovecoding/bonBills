import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { MonthlyRecord } from '../models/types';

// 初始历史数据（从 账单_0413170859.csv 解析，expenses 来源于标签分类，income 含全类型收入）
// homeDays / travelDays / accumulatedProfit / investTotal 保留手工录入值
const INITIAL_RECORDS: MonthlyRecord[] = [
  { yearMonth: '2026-04', income: 12139.57, totalExpense: 2559.26, volatileLife: 1119.24, periodicLife: 975.9, consumption: 464.12, school: 257.45, accumulatedProfit: 0, investTotal: 0, homeDays: 0, travelDays: 0, majorExpenses: [] },
  { yearMonth: '2026-03', income: 6488.28, totalExpense: 6016.54, volatileLife: 646.94, periodicLife: 2532.04, consumption: 2837.56, school: 461.04, accumulatedProfit: 3493.93, investTotal: 12843.62, homeDays: 0, travelDays: 0, majorExpenses: [] },
  { yearMonth: '2026-02', income: 11565.16, totalExpense: 8002.05, volatileLife: 1995.36, periodicLife: 3591.6, consumption: 2415.09, school: 73.69, accumulatedProfit: 4575.02, investTotal: 12830, homeDays: 13, travelDays: 9, majorExpenses: [] },
  { yearMonth: '2026-01', income: 6395.46, totalExpense: 6666.93, volatileLife: 1622.42, periodicLife: 2315.65, consumption: 2728.86, school: 1.26, accumulatedProfit: 4761.43, investTotal: 12830, homeDays: 30, travelDays: 0, majorExpenses: [] },
  { yearMonth: '2025-12', income: 5361.53, totalExpense: 7616.79, volatileLife: 301.19, periodicLife: 3086.28, consumption: 4229.32, school: 601.9, accumulatedProfit: 3678.58, investTotal: 12924.53, homeDays: 0, travelDays: 3, majorExpenses: [] },
  { yearMonth: '2025-11', income: 7406.55, totalExpense: 8540.54, volatileLife: 2449.37, periodicLife: 2877.59, consumption: 3213.58, school: 483.64, accumulatedProfit: 3547.15, investTotal: 21831.64, homeDays: 0, travelDays: 5, majorExpenses: [] },
  { yearMonth: '2025-10', income: 4827.57, totalExpense: 5932.92, volatileLife: 884.57, periodicLife: 2187.87, consumption: 2860.48, school: 346.88, accumulatedProfit: 3532.42, investTotal: 15252.87, homeDays: 10, travelDays: 0, majorExpenses: [] },
  { yearMonth: '2025-09', income: 6706.29, totalExpense: 12088.65, volatileLife: 1069.97, periodicLife: 3696.07, consumption: 7322.61, school: 573.99, accumulatedProfit: 1575.2, investTotal: 16295.69, homeDays: 1, travelDays: 0, majorExpenses: [] },
  { yearMonth: '2025-08', income: 9225.27, totalExpense: 8311.19, volatileLife: 725.15, periodicLife: 5571.31, consumption: 2014.73, school: 102.46, accumulatedProfit: 728.41, investTotal: 21827.03, homeDays: 23, travelDays: 0, majorExpenses: [] },
  { yearMonth: '2025-07', income: 1615.94, totalExpense: 7284.71, volatileLife: 276.28, periodicLife: 798.84, consumption: 6209.59, school: 0, accumulatedProfit: 0, investTotal: 0, homeDays: 20, travelDays: 0, majorExpenses: [] },
  { yearMonth: '2025-06', income: 7319.48, totalExpense: 4399.26, volatileLife: 293.14, periodicLife: 1300.06, consumption: 2806.06, school: 28.75, accumulatedProfit: 0, investTotal: 0, homeDays: 14, travelDays: 0, majorExpenses: [] },
  { yearMonth: '2025-05', income: 5701.05, totalExpense: 9958.37, volatileLife: 295.39, periodicLife: 3017.9, consumption: 6645.08, school: 20.58, accumulatedProfit: 0, investTotal: 0, homeDays: 12, travelDays: 0, majorExpenses: [] },
  { yearMonth: '2025-04', income: 2972.61, totalExpense: 5555.65, volatileLife: 175.77, periodicLife: 1321.67, consumption: 4058.21, school: 32, accumulatedProfit: 0, investTotal: 0, homeDays: 7, travelDays: 0, majorExpenses: [] },
  { yearMonth: '2025-03', income: 3879.58, totalExpense: 7399.39, volatileLife: 747.95, periodicLife: 2130.56, consumption: 4520.88, school: 27, accumulatedProfit: 0, investTotal: 0, homeDays: 13, travelDays: 0, majorExpenses: [] },
  { yearMonth: '2025-02', income: 3162.8, totalExpense: 3488.6, volatileLife: 281.95, periodicLife: 1002.87, consumption: 2203.78, school: 4, accumulatedProfit: 0, investTotal: 0, homeDays: 0, travelDays: 0, majorExpenses: [] },
  { yearMonth: '2025-01', income: 5227.42, totalExpense: 11066.8, volatileLife: 230.59, periodicLife: 3542.55, consumption: 7293.66, school: 17.4, accumulatedProfit: 0, investTotal: 0, homeDays: 0, travelDays: 0, majorExpenses: [] },
];

interface MonthlyStore {
  records: MonthlyRecord[];
  upsert: (record: MonthlyRecord) => void;
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
      getByYearMonth: (ym) => get().records.find((r) => r.yearMonth === ym),
    }),
    { name: 'monthly-records' },
  ),
);
