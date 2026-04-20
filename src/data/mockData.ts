// 从 PLAN.md §初始数据 抄入的 mock 数据
// MVP 阶段用来填充页面展示，不持久化、不做计算
import type {
  LatestSnapshot,
  MonthlyRecord,
  CurrentStats,
  InvestAllocTargets,
} from '../models/types';

export const latestSnapshot: LatestSnapshot = {
  credit: 2005.72,
  campusCard: 180.5,       // PLAN.md 未给，MVP 用假数据
  livingBank: 1246.3,      // PLAN.md 未给，MVP 用假数据
  consumptionBank: 892.15, // PLAN.md 未给，MVP 用假数据
  investTotal: 23369.6,
  investHoldings: {
    us: 3417.6,
    eu: 459.16,
    asia: 503.78,
    a: 485.45,
    longBond: 11314.13,
    usBond: 2381.37,
    gold: 4808.11,
  },
};

// 理财目标比例（股/债/商品各 1/3）
export const investTargets: InvestAllocTargets = {
  us: 0.2333,
  eu: 0.0333,
  asia: 0.0333,
  a: 0.0333,
  longBond: 0.2333,
  usBond: 0.1,
  gold: 0.3333,
};

export const monthlyRecords: MonthlyRecord[] = [
  {
    yearMonth: '2026-03',
    income: 6487.86,
    totalExpense: 5929.28,
    volatileLife: 531.9,
    periodicLife: 2546.05,
    consumption: 2851.33,
    school: 80.69,
    accumulatedProfit: 3493.93,
    investTotal: 12843.62,
    homeDays: 0,
    travelDays: 0,
  },
  {
    yearMonth: '2026-02',
    income: 11565.16,
    totalExpense: 5745.07,
    volatileLife: 1986.37,
    periodicLife: 1656.49,
    consumption: 2102.21,
    school: 80.69,
    accumulatedProfit: 4575.02,
    investTotal: 12830,
    homeDays: 13,
    travelDays: 9,
  },
  {
    yearMonth: '2026-01',
    income: 8233.37,
    totalExpense: 6506.43,
    volatileLife: 1622.42,
    periodicLife: 2155.15,
    consumption: 2728.87,
    school: 1.26,
    accumulatedProfit: 4761.43,
    investTotal: 12830,
    homeDays: 30,
    travelDays: 0,
  },
  {
    yearMonth: '2025-12',
    income: 5361.51,
    totalExpense: 7777.51,
    volatileLife: 301.19,
    periodicLife: 3080.28,
    consumption: 4396.04,
    school: 616.9,
    accumulatedProfit: 3678.58,
    investTotal: 12924.53,
    homeDays: 0,
    travelDays: 3,
  },
  {
    yearMonth: '2025-11',
    income: 7406.55,
    totalExpense: 8725.54,
    volatileLife: 2500.37,
    periodicLife: 2877.59,
    consumption: 2157.14,
    school: 518.64,
    accumulatedProfit: 3547.15,
    investTotal: 21831.64,
    homeDays: 0,
    travelDays: 5,
  },
  {
    yearMonth: '2025-10',
    income: 4827.57,
    totalExpense: 6133.92,
    volatileLife: 884.57,
    periodicLife: 1022.79,
    consumption: 1020.21,
    school: 357.38,
    accumulatedProfit: 3532.42,
    investTotal: 15252.87,
    homeDays: 10,
    travelDays: 0,
  },
  {
    yearMonth: '2025-09',
    income: 6706.29,
    totalExpense: 12088.65,
    volatileLife: 1069.97,
    periodicLife: 1328.66,
    consumption: 1879.5,
    school: 720.99,
    accumulatedProfit: 1575.2,
    investTotal: 16295.69,
    homeDays: 1,
    travelDays: 0,
  },
  {
    yearMonth: '2025-08',
    income: 9225.27,
    totalExpense: 8360.89,
    volatileLife: 725.15,
    periodicLife: 278.96,
    consumption: 941.85,
    school: 0,
    accumulatedProfit: 728.41,
    investTotal: 21827.03,
    homeDays: 23,
    travelDays: 0,
  },
  {
    yearMonth: '2025-07',
    income: 1615.94, totalExpense: 7284.71, volatileLife: 276.28, periodicLife: 509.45,
    consumption: 3871.48, school: 0, accumulatedProfit: 0, investTotal: 0, homeDays: 20, travelDays: 0,
  },
  {
    yearMonth: '2025-06',
    income: 8312.84, totalExpense: 4204.72, volatileLife: 853.14, periodicLife: 854.81,
    consumption: 1475.53, school: 0, accumulatedProfit: 0, investTotal: 0, homeDays: 14, travelDays: 0,
  },
  {
    yearMonth: '2025-05',
    income: 5804.51, totalExpense: 9617.16, volatileLife: 295.39, periodicLife: 1415.78,
    consumption: 1149.39, school: 0, accumulatedProfit: 0, investTotal: 0, homeDays: 12, travelDays: 0,
  },
  {
    yearMonth: '2025-04',
    income: 2972.61, totalExpense: 5570.65, volatileLife: 175.77, periodicLife: 1045.11,
    consumption: 3547.69, school: 0, accumulatedProfit: 0, investTotal: 0, homeDays: 7, travelDays: 0,
  },
  {
    yearMonth: '2025-03',
    income: 3879.58, totalExpense: 7590.8, volatileLife: 747.95, periodicLife: 950.32,
    consumption: 3885.48, school: 0, accumulatedProfit: 0, investTotal: 0, homeDays: 13, travelDays: 0,
  },
  {
    yearMonth: '2025-02',
    income: 3162.8, totalExpense: 3550.62, volatileLife: 281.95, periodicLife: 374.26,
    consumption: 1048.58, school: 0, accumulatedProfit: 0, investTotal: 0, homeDays: 0, travelDays: 0,
  },
  {
    yearMonth: '2025-01',
    income: 5227.42, totalExpense: 12080.74, volatileLife: 230.59, periodicLife: 2299.67,
    consumption: 5402.82, school: 0, accumulatedProfit: 0, investTotal: 0, homeDays: 0, travelDays: 0,
  },
];

export const currentStats: CurrentStats = {
  periodicLifeAvg: 2479.98,
  volatileLifeAvg: 766.67,
  consumptionAvg: 3523.73,
  totalExpenseAvg: 6387.04,
  monthlyIncomeAvg: 5611.85,
  schoolDailyAvg: 139.88,
  stateDailyAvg: { school: 139.88, intern: 105, home: 105, travel: 105 },
  stateConsumptionDailyAvg: { school: 0, intern: 0, home: 0, travel: 0 },
  stateDailyConfidence: { school: 0, intern: 0, home: 0, travel: 0 },
  savingsRate: -0.138,
  totalLife: 2863.31,
};

// Tag 元信息
export const tagMeta = {
  intern: { icon: '💼', label: '班', color: '#8b5cf6' },
  school: { icon: '📚', label: '学', color: '#3b82f6' },
  home:   { icon: '🏠', label: '家', color: '#10b981' },
  travel: { icon: '✈️', label: '游', color: '#fb923c' },
} as const;

// 各资产品类的元信息
export const investMeta = {
  us: { label: '美股', color: '#60a5fa' },
  eu: { label: '欧股', color: '#818cf8' },
  asia: { label: '亚股', color: '#a78bfa' },
  a: { label: 'A股', color: '#f472b6' },
  longBond: { label: '长债', color: '#34d399' },
  usBond: { label: '美债', color: '#2dd4bf' },
  gold: { label: '黄金', color: '#fbbf24' },
} as const;
