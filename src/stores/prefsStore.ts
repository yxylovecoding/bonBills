import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { TagKind } from '../models/types';

export type AccountKey = 'credit' | 'campusCard' | 'livingBank';

// getDay() 约定: 0=周日, 1=周一 ... 6=周六
export type WeekdayTags = Partial<Record<number, TagKind>>;

interface PrefsStore {
  tagOrder: TagKind[];
  accountOrder: AccountKey[];
  weekdayTags: WeekdayTags;
  setTagOrder: (order: TagKind[]) => void;
  setAccountOrder: (order: AccountKey[]) => void;
  setWeekdayTags: (tags: WeekdayTags) => void;
}

export const usePrefsStore = create<PrefsStore>()(
  persist(
    (set) => ({
      tagOrder: ['intern', 'school', 'home', 'travel'],
      accountOrder: ['credit', 'campusCard', 'livingBank'],
      weekdayTags: {},
      setTagOrder: (tagOrder) => set({ tagOrder }),
      setAccountOrder: (accountOrder) => set({ accountOrder }),
      setWeekdayTags: (weekdayTags) => set({ weekdayTags }),
    }),
    { name: 'user-prefs' },
  ),
);
