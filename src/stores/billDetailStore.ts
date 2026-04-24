import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { BillTagMonth, BillExpenseMonth } from '../utils/importBill';

interface BillDetailStore {
  tagStats: Record<string, BillTagMonth>;
  expenseItems: Record<string, BillExpenseMonth>;
  hasOverride: boolean;
  updateFromImport: (tagStats: Record<string, BillTagMonth>, expenseItems: Record<string, BillExpenseMonth>) => void;
  resetToDefaults: () => void;
}

const DEFAULTS = {
  tagStats: {} as Record<string, BillTagMonth>,
  expenseItems: {} as Record<string, BillExpenseMonth>,
};

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
        expenseItems: initialExpenseItems,
        hasOverride,
        updateFromImport: (tagStats, expenseItems) =>
          set({ tagStats, expenseItems, hasOverride: true }),
        resetToDefaults: () =>
          set({ tagStats: DEFAULTS.tagStats, expenseItems: DEFAULTS.expenseItems, hasOverride: false }),
      };
    },
    {
      name: 'bill-details',
      // 只持久化数据，不持久化函数
      partialize: (state) => ({
        tagStats: state.tagStats,
        expenseItems: state.expenseItems,
        hasOverride: state.hasOverride,
      }),
      merge: (persisted, current) => {
        const p = persisted as Partial<BillDetailStore>;
        return {
          ...current,
          tagStats: p.tagStats ?? current.tagStats,
          expenseItems: p.expenseItems ?? current.expenseItems,
          hasOverride: p.hasOverride ?? current.hasOverride,
        };
      },
    },
  ),
);
