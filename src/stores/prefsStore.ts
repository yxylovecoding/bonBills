import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { TagKind } from '../models/types';

export type AccountKey = 'credit' | 'campusCard' | 'livingBank';

// getDay() 约定: 0=周日, 1=周一 ... 6=周六
export type WeekdayTags = Partial<Record<number, TagKind>>;

// 日历明细模式下显示哪些类型的账单（按标签筛选）
export type ReviewableCategory = '周期生活' | '波动生活' | '消费';
export const REVIEWABLE_CATEGORIES: ReviewableCategory[] = ['周期生活', '波动生活', '消费'];
export const DEFAULT_EXPENSE_SCOPE_HELP_TEXT = [
  '本地 = 只在这儿用；共享 = 不止在这儿用。',
  '命中的账单将自动归为本地/共享生活，不再需要逐条勾选。优先级：子分类 > 笔记 > 标签。「忽略」表示与本地/共享无关、由下一维度决定。虚线 = 历史推荐值；⚠️ = 历史勾选不一致。点击行可展开该类下的账单明细。',
].join('\n');

interface PrefsStore {
  tagOrder: TagKind[];
  accountOrder: AccountKey[];
  weekdayTags: WeekdayTags;
  showPayrollCutoffMarkers: boolean;
  reviewableCategories: ReviewableCategory[];
  expenseScopeHelpText: string;
  setTagOrder: (order: TagKind[]) => void;
  setAccountOrder: (order: AccountKey[]) => void;
  setWeekdayTags: (tags: WeekdayTags) => void;
  setShowPayrollCutoffMarkers: (show: boolean) => void;
  setReviewableCategories: (cats: ReviewableCategory[]) => void;
  setExpenseScopeHelpText: (text: string) => void;
}

export const usePrefsStore = create<PrefsStore>()(
  persist(
    (set) => ({
      tagOrder: ['intern', 'school', 'home', 'travel'],
      accountOrder: ['credit', 'campusCard', 'livingBank'],
      weekdayTags: {},
      showPayrollCutoffMarkers: true,
      reviewableCategories: ['周期生活', '波动生活', '消费'],
      expenseScopeHelpText: DEFAULT_EXPENSE_SCOPE_HELP_TEXT,
      setTagOrder: (tagOrder) => set({ tagOrder }),
      setAccountOrder: (accountOrder) => set({ accountOrder }),
      setWeekdayTags: (weekdayTags) => set({ weekdayTags }),
      setShowPayrollCutoffMarkers: (showPayrollCutoffMarkers) => set({ showPayrollCutoffMarkers }),
      setReviewableCategories: (reviewableCategories) => set({ reviewableCategories }),
      setExpenseScopeHelpText: (expenseScopeHelpText) => set({ expenseScopeHelpText }),
    }),
    {
      name: 'user-prefs',
      merge: (persisted, current) => {
        const p = persisted && typeof persisted === 'object' ? persisted as Partial<PrefsStore> & Record<string, unknown> : {};
        const legacyHelpKey = 'life' + 'PeriodHelpText';
        const rawHelpText = p.expenseScopeHelpText ?? p[legacyHelpKey];
        const persistedHelpText = typeof rawHelpText === 'string' ? rawHelpText : undefined;
        const expenseScopeHelpText = persistedHelpText && /[短长]/.test(persistedHelpText)
          ? DEFAULT_EXPENSE_SCOPE_HELP_TEXT
          : persistedHelpText;
        const { expenseScopeHelpText: _scopeHelp, [legacyHelpKey]: _legacyHelp, ...rest } = p;
        void _scopeHelp; void _legacyHelp;
        return { ...current, ...rest, expenseScopeHelpText: expenseScopeHelpText ?? current.expenseScopeHelpText };
      },
    },
  ),
);
