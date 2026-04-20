import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { MonthlyRecord } from '../models/types';

// 初始历史数据（从 账单_0413170859.csv 解析，2021-01 ~ 2026-04）
// accumulatedProfit / investTotal / homeDays / travelDays 保留手工录入值
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
  { yearMonth: '2024-12', income: 21992.73, totalExpense: 5189.33, volatileLife: 53.43, periodicLife: 3116.07, consumption: 2019.83, school: 33.4, accumulatedProfit: 0, investTotal: 0, homeDays: 0, travelDays: 0, majorExpenses: [] },
  { yearMonth: '2024-11', income: 6426.32, totalExpense: 12973.71, volatileLife: 131.51, periodicLife: 2517.16, consumption: 10325.04, school: 19.18, accumulatedProfit: 0, investTotal: 0, homeDays: 0, travelDays: 0, majorExpenses: [] },
  { yearMonth: '2024-10', income: 6620.77, totalExpense: 6747.77, volatileLife: 101.59, periodicLife: 2171.16, consumption: 4475.02, school: 25, accumulatedProfit: 0, investTotal: 0, homeDays: 0, travelDays: 0, majorExpenses: [] },
  { yearMonth: '2024-09', income: 5552.07, totalExpense: 5092.93, volatileLife: 2407.07, periodicLife: 1561.39, consumption: 1124.47, school: 31, accumulatedProfit: 0, investTotal: 0, homeDays: 0, travelDays: 0, majorExpenses: [] },
  { yearMonth: '2024-08', income: 49.88, totalExpense: 1105.25, volatileLife: 0, periodicLife: 620.76, consumption: 484.49, school: 3, accumulatedProfit: 0, investTotal: 0, homeDays: 0, travelDays: 0, majorExpenses: [] },
  { yearMonth: '2024-07', income: 2663, totalExpense: 3481.53, volatileLife: 949.23, periodicLife: 1969.71, consumption: 562.59, school: 61.03, accumulatedProfit: 0, investTotal: 0, homeDays: 0, travelDays: 0, majorExpenses: [] },
  { yearMonth: '2024-06', income: 3450.08, totalExpense: 4716.32, volatileLife: 2061.57, periodicLife: 1133.04, consumption: 1521.71, school: 63.42, accumulatedProfit: 0, investTotal: 0, homeDays: 0, travelDays: 0, majorExpenses: [] },
  { yearMonth: '2024-05', income: 3569.29, totalExpense: 5752.7, volatileLife: 711.25, periodicLife: 2982.56, consumption: 2058.89, school: 68.5, accumulatedProfit: 0, investTotal: 0, homeDays: 0, travelDays: 0, majorExpenses: [] },
  { yearMonth: '2024-04', income: 2771.93, totalExpense: 3138.74, volatileLife: 328.56, periodicLife: 823.67, consumption: 1986.51, school: 50.5, accumulatedProfit: 0, investTotal: 0, homeDays: 0, travelDays: 0, majorExpenses: [] },
  { yearMonth: '2024-03', income: 2369.15, totalExpense: 5439.63, volatileLife: 153.4, periodicLife: 1861.76, consumption: 3424.47, school: 81.1, accumulatedProfit: 0, investTotal: 0, homeDays: 0, travelDays: 0, majorExpenses: [] },
  { yearMonth: '2024-02', income: 3442.91, totalExpense: 3361.51, volatileLife: 234.47, periodicLife: 2685.32, consumption: 441.72, school: 10.5, accumulatedProfit: 0, investTotal: 0, homeDays: 0, travelDays: 0, majorExpenses: [] },
  { yearMonth: '2024-01', income: 1622.93, totalExpense: 6690.45, volatileLife: 2858.99, periodicLife: 1893.49, consumption: 1937.97, school: 23.5, accumulatedProfit: 0, investTotal: 0, homeDays: 0, travelDays: 0, majorExpenses: [] },
  { yearMonth: '2023-12', income: 12406.56, totalExpense: 2016.01, volatileLife: 0, periodicLife: 1553.84, consumption: 462.17, school: 52.5, accumulatedProfit: 0, investTotal: 0, homeDays: 0, travelDays: 0, majorExpenses: [] },
  { yearMonth: '2023-11', income: 2493.59, totalExpense: 1311.59, volatileLife: 14.72, periodicLife: 1094.49, consumption: 202.38, school: 64.22, accumulatedProfit: 0, investTotal: 0, homeDays: 0, travelDays: 0, majorExpenses: [] },
  { yearMonth: '2023-10', income: 4413.71, totalExpense: 1851.18, volatileLife: 0, periodicLife: 1112.95, consumption: 738.23, school: 63.76, accumulatedProfit: 0, investTotal: 0, homeDays: 0, travelDays: 0, majorExpenses: [] },
  { yearMonth: '2023-09', income: 3747.11, totalExpense: 846.85, volatileLife: 0, periodicLife: 705.7, consumption: 141.15, school: 177.26, accumulatedProfit: 0, investTotal: 0, homeDays: 0, travelDays: 0, majorExpenses: [] },
  { yearMonth: '2023-08', income: 3156.47, totalExpense: 1158.34, volatileLife: 0, periodicLife: 788.14, consumption: 370.2, school: 34.68, accumulatedProfit: 0, investTotal: 0, homeDays: 0, travelDays: 0, majorExpenses: [] },
  { yearMonth: '2023-07', income: 2252.78, totalExpense: 1681.56, volatileLife: 0, periodicLife: 1432.06, consumption: 249.5, school: 55.3, accumulatedProfit: 0, investTotal: 0, homeDays: 0, travelDays: 0, majorExpenses: [] },
  { yearMonth: '2023-06', income: 2550.56, totalExpense: 1203.83, volatileLife: 0, periodicLife: 857.39, consumption: 346.44, school: 94, accumulatedProfit: 0, investTotal: 0, homeDays: 0, travelDays: 0, majorExpenses: [] },
  { yearMonth: '2023-05', income: 3246.57, totalExpense: 1630.03, volatileLife: 108.16, periodicLife: 1286.62, consumption: 235.25, school: 68.3, accumulatedProfit: 0, investTotal: 0, homeDays: 0, travelDays: 0, majorExpenses: [] },
  { yearMonth: '2023-04', income: 2329.62, totalExpense: 1243.46, volatileLife: 0, periodicLife: 1086.96, consumption: 156.5, school: 67.88, accumulatedProfit: 0, investTotal: 0, homeDays: 0, travelDays: 0, majorExpenses: [] },
  { yearMonth: '2023-03', income: 8602.74, totalExpense: 1518.78, volatileLife: 0, periodicLife: 1452.09, consumption: 66.69, school: 10, accumulatedProfit: 0, investTotal: 0, homeDays: 0, travelDays: 0, majorExpenses: [] },
  { yearMonth: '2023-02', income: 2752.82, totalExpense: 643.86, volatileLife: 0, periodicLife: 611.26, consumption: 32.6, school: 0, accumulatedProfit: 0, investTotal: 0, homeDays: 0, travelDays: 0, majorExpenses: [] },
  { yearMonth: '2023-01', income: 3098.82, totalExpense: 425.66, volatileLife: 0, periodicLife: 363.06, consumption: 62.6, school: 0, accumulatedProfit: 0, investTotal: 0, homeDays: 0, travelDays: 0, majorExpenses: [] },
  { yearMonth: '2022-12', income: 8050, totalExpense: 0, volatileLife: 0, periodicLife: 0, consumption: 0, school: 0, accumulatedProfit: 0, investTotal: 0, homeDays: 0, travelDays: 0, majorExpenses: [] },
  { yearMonth: '2022-11', income: 0, totalExpense: 156.16, volatileLife: 0, periodicLife: 156.16, consumption: 0, school: 0, accumulatedProfit: 0, investTotal: 0, homeDays: 0, travelDays: 0, majorExpenses: [] },
  { yearMonth: '2022-10', income: 0, totalExpense: 120.4, volatileLife: 0, periodicLife: 0, consumption: 120.4, school: 0, accumulatedProfit: 0, investTotal: 0, homeDays: 0, travelDays: 0, majorExpenses: [] },
  { yearMonth: '2022-09', income: 0, totalExpense: 0, volatileLife: 0, periodicLife: 0, consumption: 0, school: 0, accumulatedProfit: 0, investTotal: 0, homeDays: 0, travelDays: 0, majorExpenses: [] },
  { yearMonth: '2022-07', income: 0, totalExpense: 0, volatileLife: 0, periodicLife: 0, consumption: 0, school: 0, accumulatedProfit: 0, investTotal: 0, homeDays: 0, travelDays: 0, majorExpenses: [] },
  { yearMonth: '2022-06', income: 0, totalExpense: 212.98, volatileLife: 0, periodicLife: 0, consumption: 212.98, school: 0, accumulatedProfit: 0, investTotal: 0, homeDays: 0, travelDays: 0, majorExpenses: [] },
  { yearMonth: '2022-05', income: 244, totalExpense: 38, volatileLife: 0, periodicLife: 0, consumption: 38, school: 0, accumulatedProfit: 0, investTotal: 0, homeDays: 0, travelDays: 0, majorExpenses: [] },
  { yearMonth: '2022-04', income: 500, totalExpense: 164.68, volatileLife: 0, periodicLife: 0, consumption: 164.68, school: 0, accumulatedProfit: 0, investTotal: 0, homeDays: 0, travelDays: 0, majorExpenses: [] },
  { yearMonth: '2022-02', income: 0, totalExpense: 0, volatileLife: 0, periodicLife: 0, consumption: 0, school: 0, accumulatedProfit: 0, investTotal: 0, homeDays: 0, travelDays: 0, majorExpenses: [] },
  { yearMonth: '2022-01', income: 37851.55, totalExpense: 17159.68, volatileLife: 0, periodicLife: 14659.39, consumption: 2500.29, school: 0, accumulatedProfit: 0, investTotal: 0, homeDays: 0, travelDays: 0, majorExpenses: [] },
  { yearMonth: '2021-12', income: 0, totalExpense: 71.47, volatileLife: 0, periodicLife: 0, consumption: 71.47, school: 0, accumulatedProfit: 0, investTotal: 0, homeDays: 0, travelDays: 0, majorExpenses: [] },
  { yearMonth: '2021-10', income: 0, totalExpense: 0, volatileLife: 0, periodicLife: 0, consumption: 0, school: 0, accumulatedProfit: 0, investTotal: 0, homeDays: 0, travelDays: 0, majorExpenses: [] },
  { yearMonth: '2021-09', income: 0, totalExpense: 0, volatileLife: 0, periodicLife: 0, consumption: 0, school: 0, accumulatedProfit: 0, investTotal: 0, homeDays: 0, travelDays: 0, majorExpenses: [] },
  { yearMonth: '2021-07', income: 100, totalExpense: 0, volatileLife: 0, periodicLife: 0, consumption: 0, school: 0, accumulatedProfit: 0, investTotal: 0, homeDays: 0, travelDays: 0, majorExpenses: [] },
  { yearMonth: '2021-06', income: 0, totalExpense: 0, volatileLife: 0, periodicLife: 0, consumption: 0, school: 0, accumulatedProfit: 0, investTotal: 0, homeDays: 0, travelDays: 0, majorExpenses: [] },
  { yearMonth: '2021-01', income: 26937.08, totalExpense: 5403.08, volatileLife: 0, periodicLife: 5013.93, consumption: 389.15, school: 0, accumulatedProfit: 0, investTotal: 0, homeDays: 0, travelDays: 0, majorExpenses: [] },
];

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
