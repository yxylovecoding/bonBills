import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { TagKind } from '../models/types';

export type AccountKey = 'credit' | 'campusCard' | 'livingBank';

// getDay() 约定: 0=周日, 1=周一 ... 6=周六
export type WeekdayTags = Partial<Record<number, TagKind>>;

// 日历明细模式下显示哪些类型的账单（按标签筛选）
export type ReviewableCategory = '周期生活' | '波动生活' | '消费';
export const REVIEWABLE_CATEGORIES: ReviewableCategory[] = ['周期生活', '波动生活', '消费'];
export const DEFAULT_LIFE_PERIOD_HELP_TEXT = [
  '短 = 按所在场景（学校/实习/在家/旅行）计入当天日均；长 = 不和场景挂钩，全期摊匀进基础日均。',
  '命中的账单将自动归为短/长周期生活，不再需要逐条勾选。优先级：子分类 > 笔记 > 标签。「忽略」表示与长短无关、由下一维度决定。虚线 = 历史推荐值；⚠️ = 历史勾选不一致。点击行可展开该类下的账单明细。',
].join('\n');

interface PrefsStore {
  tagOrder: TagKind[];
  accountOrder: AccountKey[];
  weekdayTags: WeekdayTags;
  showPayrollCutoffMarkers: boolean;
  reviewableCategories: ReviewableCategory[];
  lifePeriodHelpText: string;
  setTagOrder: (order: TagKind[]) => void;
  setAccountOrder: (order: AccountKey[]) => void;
  setWeekdayTags: (tags: WeekdayTags) => void;
  setShowPayrollCutoffMarkers: (show: boolean) => void;
  setReviewableCategories: (cats: ReviewableCategory[]) => void;
  setLifePeriodHelpText: (text: string) => void;
}

export const usePrefsStore = create<PrefsStore>()(
  persist(
    (set) => ({
      tagOrder: ['intern', 'school', 'home', 'travel'],
      accountOrder: ['credit', 'campusCard', 'livingBank'],
      weekdayTags: {},
      showPayrollCutoffMarkers: true,
      reviewableCategories: ['周期生活', '波动生活', '消费'],
      lifePeriodHelpText: DEFAULT_LIFE_PERIOD_HELP_TEXT,
      setTagOrder: (tagOrder) => set({ tagOrder }),
      setAccountOrder: (accountOrder) => set({ accountOrder }),
      setWeekdayTags: (weekdayTags) => set({ weekdayTags }),
      setShowPayrollCutoffMarkers: (showPayrollCutoffMarkers) => set({ showPayrollCutoffMarkers }),
      setReviewableCategories: (reviewableCategories) => set({ reviewableCategories }),
      setLifePeriodHelpText: (lifePeriodHelpText) => set({ lifePeriodHelpText }),
    }),
    { name: 'user-prefs' },
  ),
);
