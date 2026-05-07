import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { TagKind } from '../models/types';

export type AccountKey = 'credit' | 'campusCard' | 'livingBank';

// getDay() 约定: 0=周日, 1=周一 ... 6=周六
export type WeekdayTags = Partial<Record<number, TagKind>>;

// 日历明细模式下显示哪些类型的账单（按标签筛选）
export type ReviewableCategory = '周期生活' | '波动生活' | '消费';
export const REVIEWABLE_CATEGORIES: ReviewableCategory[] = ['周期生活', '波动生活', '消费'];

interface PrefsStore {
  tagOrder: TagKind[];
  accountOrder: AccountKey[];
  weekdayTags: WeekdayTags;
  showPayrollCutoffMarkers: boolean;
  reviewableCategories: ReviewableCategory[];
  setTagOrder: (order: TagKind[]) => void;
  setAccountOrder: (order: AccountKey[]) => void;
  setWeekdayTags: (tags: WeekdayTags) => void;
  setShowPayrollCutoffMarkers: (show: boolean) => void;
  setReviewableCategories: (cats: ReviewableCategory[]) => void;
}

export const usePrefsStore = create<PrefsStore>()(
  persist(
    (set) => ({
      tagOrder: ['intern', 'school', 'home', 'travel'],
      accountOrder: ['credit', 'campusCard', 'livingBank'],
      weekdayTags: {},
      showPayrollCutoffMarkers: true,
      reviewableCategories: ['周期生活', '波动生活', '消费'],
      setTagOrder: (tagOrder) => set({ tagOrder }),
      setAccountOrder: (accountOrder) => set({ accountOrder }),
      setWeekdayTags: (weekdayTags) => set({ weekdayTags }),
      setShowPayrollCutoffMarkers: (showPayrollCutoffMarkers) => set({ showPayrollCutoffMarkers }),
      setReviewableCategories: (reviewableCategories) => set({ reviewableCategories }),
    }),
    { name: 'user-prefs' },
  ),
);
