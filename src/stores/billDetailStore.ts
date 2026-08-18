import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { BillMonthlyAgg, BillTagMonth, BillExpenseMonth, BillIncomeMonth } from '../utils/importBill';
import { aggregateExpenseItems, emptyBillMonthlyAgg, normalizeBillDate, normalizeBillYearMonth } from '../utils/importBill';

interface BillDetailStore {
  tagStats: Record<string, BillTagMonth>;
  aggregates: Record<string, BillMonthlyAgg>;
  expenseItems: Record<string, BillExpenseMonth>;
  incomeItems: Record<string, BillIncomeMonth>;
  hasOverride: boolean;
  updateFromImport: (
    tagStats: Record<string, BillTagMonth>,
    expenseItems: Record<string, BillExpenseMonth>,
    incomeItems: Record<string, BillIncomeMonth>,
    aggregates?: Record<string, BillMonthlyAgg>,
  ) => void;
  resetToDefaults: () => void;
}

const DEFAULTS = {
  tagStats: {} as Record<string, BillTagMonth>,
  aggregates: {} as Record<string, BillMonthlyAgg>,
  expenseItems: {} as Record<string, BillExpenseMonth>,
  incomeItems: {} as Record<string, BillIncomeMonth>,
};

function mergeTagMonth(a: BillTagMonth | undefined, b: BillTagMonth): BillTagMonth {
  if (!a) return b;
  return {
    eatDrinkAmount: a.eatDrinkAmount + b.eatDrinkAmount,
    eatDrinkCount: a.eatDrinkCount + b.eatDrinkCount,
    redAmount: a.redAmount + b.redAmount,
    blackAmount: a.blackAmount + b.blackAmount,
    eatDrinkItems: [...a.eatDrinkItems, ...b.eatDrinkItems],
    redItems: [...a.redItems, ...b.redItems],
    blackItems: [...a.blackItems, ...b.blackItems],
  };
}

function normalizeTagStats(input: unknown): Record<string, BillTagMonth> {
  if (!input || typeof input !== 'object') return {};
  const result: Record<string, BillTagMonth> = {};
  for (const [rawYm, value] of Object.entries(input as Record<string, BillTagMonth>)) {
    const ym = normalizeBillYearMonth(rawYm);
    if (!ym || !value) continue;
    result[ym] = mergeTagMonth(result[ym], value);
  }
  return result;
}

function normalizeExpenseItems(input: unknown): Record<string, BillExpenseMonth> {
  if (!input || typeof input !== 'object') return {};
  const result: Record<string, BillExpenseMonth> = {};
  for (const [rawYm, value] of Object.entries(input as Record<string, BillExpenseMonth>)) {
    const ym = normalizeBillYearMonth(rawYm);
    if (!ym || !Array.isArray(value)) continue;
    const normalizedItems = value
      .map((item) => {
        const date = normalizeBillDate(item.date);
        if (!date) return null;
        return { ...item, date };
      })
      .filter((item): item is BillExpenseMonth[number] => item !== null);
    if (normalizedItems.length === 0) continue;
    result[ym] = [...(result[ym] ?? []), ...normalizedItems];
  }
  return result;
}

function normalizeIncomeItems(input: unknown): Record<string, BillIncomeMonth> {
  return normalizeExpenseItems(input);
}

function mergeAggregate(a: BillMonthlyAgg | undefined, b: BillMonthlyAgg): BillMonthlyAgg {
  const base = a ?? emptyBillMonthlyAgg();
  return {
    income: base.income + (b.income ?? 0),
    totalExpense: base.totalExpense + (b.totalExpense ?? 0),
    periodicLife: base.periodicLife + (b.periodicLife ?? 0),
    volatileLife: base.volatileLife + (b.volatileLife ?? 0),
    consumption: base.consumption + (b.consumption ?? 0),
    school: base.school + (b.school ?? 0),
  };
}

function normalizeAggregates(input: unknown): Record<string, BillMonthlyAgg> {
  if (!input || typeof input !== 'object') return {};
  const result: Record<string, BillMonthlyAgg> = {};
  for (const [rawYm, value] of Object.entries(input as Record<string, Partial<BillMonthlyAgg>>)) {
    const ym = normalizeBillYearMonth(rawYm);
    if (!ym || !value || typeof value !== 'object') continue;
    result[ym] = mergeAggregate(result[ym], {
      income: Number(value.income) || 0,
      totalExpense: Number(value.totalExpense) || 0,
      periodicLife: Number(value.periodicLife) || 0,
      volatileLife: Number(value.volatileLife) || 0,
      consumption: Number(value.consumption) || 0,
      school: Number(value.school) || 0,
    });
  }
  return result;
}

export function normalizeBillDetailState(state: Partial<BillDetailStore>): Partial<BillDetailStore> {
  const expenseItems = normalizeExpenseItems(state.expenseItems);
  const incomeItems = normalizeIncomeItems(state.incomeItems);
  const aggregates = normalizeAggregates(state.aggregates);
  // 兼容旧数据：以前 bill-details 只持久化明细，月汇总丢失时从明细补支出侧汇总。
  for (const [ym, items] of Object.entries(expenseItems)) {
    if (aggregates[ym]) continue;
    aggregates[ym] = { income: 0, ...aggregateExpenseItems(items) };
  }
  // 收入明细与月汇总独立持久化；汇总缺失时也能从明细恢复。
  for (const [ym, items] of Object.entries(incomeItems)) {
    const income = Math.round(items.reduce((sum, item) => sum + item.amount, 0) * 100) / 100;
    if (!aggregates[ym]) aggregates[ym] = emptyBillMonthlyAgg();
    if (Math.abs(aggregates[ym].income) <= 0.01) aggregates[ym].income = income;
  }
  return {
    ...state,
    tagStats: normalizeTagStats(state.tagStats),
    aggregates,
    expenseItems,
    incomeItems,
  };
}

// 一次性迁移：从旧 localStorage key 迁移到新 store
function migrateOldKeys(): { tagStats?: Record<string, BillTagMonth>; expenseItems?: Record<string, BillExpenseMonth> } | null {
  try {
    const oldTagStats = localStorage.getItem('billTagStats.override.v1');
    const oldExpenseItems = localStorage.getItem('billExpenseItems.override.v1');
    if (!oldTagStats && !oldExpenseItems) return null;
    const result: { tagStats?: Record<string, BillTagMonth>; expenseItems?: Record<string, BillExpenseMonth> } = {};
    if (oldTagStats) result.tagStats = JSON.parse(oldTagStats);
    if (oldExpenseItems) result.expenseItems = JSON.parse(oldExpenseItems);
    // 清除旧 key
    localStorage.removeItem('billTagStats.override.v1');
    localStorage.removeItem('billExpenseItems.override.v1');
    return result;
  } catch {
    return null;
  }
}

export const useBillDetailStore = create<BillDetailStore>()(
  persist(
    (set) => {
      // 检查是否需要迁移
      const migrated = migrateOldKeys();
      const initialTagStats = migrated?.tagStats ?? DEFAULTS.tagStats;
      const initialExpenseItems = migrated?.expenseItems ?? DEFAULTS.expenseItems;
      const hasOverride = !!migrated;

      return {
        tagStats: initialTagStats,
        aggregates: DEFAULTS.aggregates,
        expenseItems: initialExpenseItems,
        incomeItems: DEFAULTS.incomeItems,
        hasOverride,
        updateFromImport: (tagStats, expenseItems, incomeItems, aggregates = {}) =>
          set(normalizeBillDetailState({ tagStats, expenseItems, incomeItems, aggregates, hasOverride: true })),
        resetToDefaults: () =>
          set({ tagStats: DEFAULTS.tagStats, aggregates: DEFAULTS.aggregates, expenseItems: DEFAULTS.expenseItems, incomeItems: DEFAULTS.incomeItems, hasOverride: false }),
      };
    },
    {
      name: 'bill-details',
      version: 2,
      migrate: (persistedState) => {
        if (!persistedState || typeof persistedState !== 'object') return persistedState;
        return normalizeBillDetailState(persistedState as Partial<BillDetailStore>);
      },
      // 只持久化数据，不持久化函数
      partialize: (state) => ({
        tagStats: state.tagStats,
        aggregates: state.aggregates,
        expenseItems: state.expenseItems,
        incomeItems: state.incomeItems,
        hasOverride: state.hasOverride,
      }),
      merge: (persisted, current) => {
        const p = normalizeBillDetailState((persisted ?? {}) as Partial<BillDetailStore>);
        return {
          ...current,
          tagStats: p.tagStats ?? current.tagStats,
          aggregates: p.aggregates ?? current.aggregates,
          expenseItems: p.expenseItems ?? current.expenseItems,
          incomeItems: p.incomeItems ?? current.incomeItems,
          hasOverride: p.hasOverride ?? current.hasOverride,
        };
      },
    },
  ),
);
