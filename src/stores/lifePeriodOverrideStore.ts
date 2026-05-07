import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type LifePeriod = 'short' | 'long';

export interface LifePeriodOverrides {
  // key 是名称：分类用 category，子分类用 `${category}|${subcategory}`，标签用 tag 名
  categories: Record<string, LifePeriod>;
  subcategories: Record<string, LifePeriod>;
  tags: Record<string, LifePeriod>;
}

const EMPTY: LifePeriodOverrides = { categories: {}, subcategories: {}, tags: {} };

export type OverrideDimension = 'category' | 'subcategory' | 'tag';

interface LifePeriodOverrideStore {
  overrides: LifePeriodOverrides;
  setOverride: (dim: OverrideDimension, name: string, period: LifePeriod | null) => void;
  resetAll: () => void;
}

function bucketKey(dim: OverrideDimension): keyof LifePeriodOverrides {
  if (dim === 'category') return 'categories';
  if (dim === 'subcategory') return 'subcategories';
  return 'tags';
}

export const subcategoryKey = (category: string, subcategory: string) =>
  subcategory ? `${category}|${subcategory}` : category;

export const useLifePeriodOverrideStore = create<LifePeriodOverrideStore>()(
  persist(
    (set) => ({
      overrides: EMPTY,
      setOverride: (dim, name, period) =>
        set((s) => {
          const bk = bucketKey(dim);
          const next = { ...s.overrides[bk] };
          if (period === null) delete next[name];
          else next[name] = period;
          return { overrides: { ...s.overrides, [bk]: next } };
        }),
      resetAll: () => set({ overrides: EMPTY }),
    }),
    {
      name: 'life-period-overrides',
      version: 1,
      partialize: (s) => ({ overrides: s.overrides }),
      merge: (persisted, current) => {
        const p = (persisted && typeof persisted === 'object'
          ? persisted as { overrides?: Partial<LifePeriodOverrides> }
          : {});
        const ov = p.overrides ?? {};
        return {
          ...current,
          overrides: {
            categories: ov.categories ?? {},
            subcategories: ov.subcategories ?? {},
            tags: ov.tags ?? {},
          },
        };
      },
    },
  ),
);

// 工具：判断一条账单根据 overrides 应被划为哪一周期；返回 null 表示无 override
export function resolveLifePeriod(
  item: { category: string; subcategory: string; tags: string },
  overrides: LifePeriodOverrides,
): LifePeriod | null {
  // 优先级：subcategory > category > tag
  const subKey = subcategoryKey(item.category, item.subcategory);
  if (overrides.subcategories[subKey]) return overrides.subcategories[subKey];
  if (item.category && overrides.categories[item.category]) return overrides.categories[item.category];
  const tagList = item.tags.split(',').map((t) => t.trim()).filter(Boolean);
  for (const t of tagList) {
    if (overrides.tags[t]) return overrides.tags[t];
  }
  return null;
}
