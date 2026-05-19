import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ExpenseScope = 'local' | 'shared';
// 用户配置值：可加 'ignore'（已审视、明确不参与判定，与"默认"行为相同但状态明确）
export type OverrideValue = ExpenseScope | 'ignore';

export interface ExpenseScopeOverrides {
  // key 是名称：分类用 category，子分类用 `${category}|${subcategory}`，笔记用原文，标签用 tag 名
  categories: Record<string, OverrideValue>;
  subcategories: Record<string, OverrideValue>;
  notes: Record<string, OverrideValue>;
  tags: Record<string, OverrideValue>;
}

const EMPTY: ExpenseScopeOverrides = { categories: {}, subcategories: {}, notes: {}, tags: {} };
const LEGACY_STORE_KEY = 'life-period-overrides';

export type OverrideDimension = 'category' | 'subcategory' | 'note' | 'tag';

interface ExpenseScopeOverrideStore {
  overrides: ExpenseScopeOverrides;
  setOverride: (dim: OverrideDimension, name: string, value: OverrideValue | null) => void;
  resetAll: () => void;
}

function bucketKey(dim: OverrideDimension): keyof ExpenseScopeOverrides {
  if (dim === 'category') return 'categories';
  if (dim === 'subcategory') return 'subcategories';
  if (dim === 'note') return 'notes';
  return 'tags';
}

export const subcategoryKey = (category: string, subcategory: string) =>
  subcategory ? `${category}|${subcategory}` : category;

function normalizeOverrideValue(value: unknown): OverrideValue | undefined {
  if (value === 'local' || value === 'shared' || value === 'ignore') return value;
  if (value === 'short') return 'local';
  if (value === 'long') return 'shared';
  return undefined;
}

function normalizeBucket(bucket: unknown): Record<string, OverrideValue> {
  if (!bucket || typeof bucket !== 'object') return {};
  const result: Record<string, OverrideValue> = {};
  for (const [key, rawValue] of Object.entries(bucket as Record<string, unknown>)) {
    const value = normalizeOverrideValue(rawValue);
    if (value) result[key] = value;
  }
  return result;
}

export function normalizeExpenseScopeOverrides(input: unknown): ExpenseScopeOverrides {
  const raw = input && typeof input === 'object' && 'overrides' in input
    ? (input as { overrides?: unknown }).overrides
    : input;
  if (!raw || typeof raw !== 'object') return EMPTY;
  const overrides = raw as Partial<Record<keyof ExpenseScopeOverrides, unknown>>;
  return {
    categories: normalizeBucket(overrides.categories),
    subcategories: normalizeBucket(overrides.subcategories),
    notes: normalizeBucket(overrides.notes),
    tags: normalizeBucket(overrides.tags),
  };
}

function readLegacyOverrides(): ExpenseScopeOverrides {
  try {
    if (typeof localStorage === 'undefined') return EMPTY;
    const raw = localStorage.getItem(LEGACY_STORE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as { state?: unknown };
    localStorage.removeItem(LEGACY_STORE_KEY);
    return normalizeExpenseScopeOverrides(parsed.state ?? parsed);
  } catch {
    return EMPTY;
  }
}

export const useExpenseScopeOverrideStore = create<ExpenseScopeOverrideStore>()(
  persist(
    (set) => ({
      overrides: readLegacyOverrides(),
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
      name: 'expense-scope-overrides',
      version: 1,
      partialize: (s) => ({ overrides: s.overrides }),
      merge: (persisted, current) => {
        return {
          ...current,
          overrides: normalizeExpenseScopeOverrides(persisted),
        };
      },
    },
  ),
);

// 工具：判断一条账单根据 overrides 应被划为哪个范围；返回 null 表示无命中
// 优先级：subcategory > 笔记 > category > tag。'ignore' 等同于"未配置"，不阻塞后续维度查找。
// subcategory 查找会尝试两种 key 形态以适配空 category 的边缘情况：
//   1) `${category}|${subcategory}` 原值
//   2) `(未分类)|${subcategory}` —— buildExpenseScopeStats 给空 category 兜底过
export function resolveExpenseScope(
  item: { category: string; subcategory: string; tags: string; note?: string },
  overrides: ExpenseScopeOverrides,
): ExpenseScope | null {
  const subs = overrides.subcategories ?? {};
  const cats = overrides.categories ?? {};
  const notes = overrides.notes ?? {};
  const tagsMap = overrides.tags ?? {};
  const subKeyPrimary = subcategoryKey(item.category, item.subcategory);
  const sub = subs[subKeyPrimary];
  if (sub === 'local' || sub === 'shared') return sub;
  if (!item.category && item.subcategory) {
    const fallbackKey = subcategoryKey('(未分类)', item.subcategory);
    const fb = subs[fallbackKey];
    if (fb === 'local' || fb === 'shared') return fb;
  }
  if (item.note) {
    const noteOv = notes[item.note];
    if (noteOv === 'local' || noteOv === 'shared') return noteOv;
  }
  const cat = cats[item.category];
  if (cat === 'local' || cat === 'shared') return cat;
  const tagList = item.tags.split(',').map((t) => t.trim()).filter(Boolean);
  for (const t of tagList) {
    const tg = tagsMap[t];
    if (tg === 'local' || tg === 'shared') return tg;
  }
  return null;
}
