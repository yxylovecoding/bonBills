import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// 算法返回的实际归类（命中 short 或 long）
export type LifePeriod = 'short' | 'long';
// 用户配置值：可加 'ignore'（已审视、明确不参与判定，与"默认"行为相同但状态明确）
export type OverrideValue = LifePeriod | 'ignore';

export interface LifePeriodOverrides {
  // key 是名称：分类用 category，子分类用 `${category}|${subcategory}`，笔记用原文，标签用 tag 名
  categories: Record<string, OverrideValue>;
  subcategories: Record<string, OverrideValue>;
  notes: Record<string, OverrideValue>;
  tags: Record<string, OverrideValue>;
}

const EMPTY: LifePeriodOverrides = { categories: {}, subcategories: {}, notes: {}, tags: {} };

export type OverrideDimension = 'category' | 'subcategory' | 'note' | 'tag';

interface LifePeriodOverrideStore {
  overrides: LifePeriodOverrides;
  setOverride: (dim: OverrideDimension, name: string, value: OverrideValue | null) => void;
  resetAll: () => void;
}

function bucketKey(dim: OverrideDimension): keyof LifePeriodOverrides {
  if (dim === 'category') return 'categories';
  if (dim === 'subcategory') return 'subcategories';
  if (dim === 'note') return 'notes';
  return 'tags';
}

export const subcategoryKey = (category: string, subcategory: string) =>
  subcategory ? `${category}|${subcategory}` : category;

export const useLifePeriodOverrideStore = create<LifePeriodOverrideStore>()(
  persist(
    (set) => ({
      overrides: EMPTY,
      setOverride: (dim, name, value) =>
        set((s) => {
          const bk = bucketKey(dim);
          const next = { ...s.overrides[bk] };
          if (value === null) delete next[name];
          else next[name] = value;
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
            notes: ov.notes ?? {},
            tags: ov.tags ?? {},
          },
        };
      },
    },
  ),
);

// 工具：判断一条账单根据 overrides 应被划为哪一周期；返回 null 表示无命中
// 优先级：subcategory > 笔记 > category > tag。'ignore' 等同于"未配置"，不阻塞后续维度查找。
// subcategory 查找会尝试两种 key 形态以适配空 category 的边缘情况：
//   1) `${category}|${subcategory}` 原值
//   2) `(未分类)|${subcategory}` —— buildLifePeriodStats 给空 category 兜底过
export function resolveLifePeriod(
  item: { category: string; subcategory: string; tags: string; note?: string },
  overrides: LifePeriodOverrides,
): LifePeriod | null {
  const subKeyPrimary = subcategoryKey(item.category, item.subcategory);
  const sub = overrides.subcategories[subKeyPrimary];
  if (sub === 'short' || sub === 'long') return sub;
  if (!item.category && item.subcategory) {
    const fallbackKey = subcategoryKey('(未分类)', item.subcategory);
    const fb = overrides.subcategories[fallbackKey];
    if (fb === 'short' || fb === 'long') return fb;
  }
  if (item.note) {
    const noteOv = overrides.notes[item.note];
    if (noteOv === 'short' || noteOv === 'long') return noteOv;
  }
  const cat = overrides.categories[item.category];
  if (cat === 'short' || cat === 'long') return cat;
  const tagList = item.tags.split(',').map((t) => t.trim()).filter(Boolean);
  for (const t of tagList) {
    const tg = overrides.tags[t];
    if (tg === 'short' || tg === 'long') return tg;
  }
  return null;
}
