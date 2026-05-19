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
export type LifePeriodRuleParseResult = {
  overrides: LifePeriodOverrides;
  count: number;
  errors: string[];
};

export const LIFE_PERIOD_RULE_PLACEHOLDER = [
  '短 子分类 餐饮|咖啡',
  '短 标签 外卖',
  '长 标签 年费',
  '忽略 笔记 账户余额补齐',
].join('\n');

interface LifePeriodOverrideStore {
  overrides: LifePeriodOverrides;
  ruleText: string;
  setOverride: (dim: OverrideDimension, name: string, value: OverrideValue | null) => void;
  setRulesFromText: (text: string) => LifePeriodRuleParseResult;
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

function cloneEmpty(): LifePeriodOverrides {
  return { categories: {}, subcategories: {}, notes: {}, tags: {} };
}

function valueFromText(text: string): OverrideValue | null {
  const v = text.toLowerCase();
  if (v === '短' || v === 'short') return 'short';
  if (v === '长' || v === 'long') return 'long';
  if (v === '忽略' || v === 'ignore') return 'ignore';
  return null;
}

function dimFromText(text: string): OverrideDimension | null {
  const v = text.toLowerCase();
  if (v === '分类' || v === 'category' || v === 'cat') return 'category';
  if (v === '子分类' || v === 'subcategory' || v === 'sub') return 'subcategory';
  if (v === '笔记' || v === '备注' || v === 'note') return 'note';
  if (v === '标签' || v === 'tag') return 'tag';
  return null;
}

export function parseLifePeriodRuleText(text: string): LifePeriodRuleParseResult {
  const overrides = cloneEmpty();
  const errors: string[] = [];
  let count = 0;
  let currentValue: OverrideValue | null = null;

  text.split(/\r?\n/).forEach((rawLine, idx) => {
    const lineNo = idx + 1;
    let line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) return;
    line = line.replace(/[：]/g, ':');

    const valueOnly = line.match(/^(短|short|长|long|忽略|ignore)\s*:?$/i);
    if (valueOnly) {
      currentValue = valueFromText(valueOnly[1]);
      return;
    }

    const valueMatch = line.match(/^(短|short|长|long|忽略|ignore)(?:\s*:\s*|\s+)(.+)$/i);
    let value = currentValue;
    if (valueMatch) {
      value = valueFromText(valueMatch[1]);
      line = valueMatch[2].trim();
    }

    if (!value) {
      errors.push(`第 ${lineNo} 行缺少短/长/忽略`);
      return;
    }

    const dimMatch = line.match(/^(子分类|subcategory|sub|分类|category|cat|笔记|备注|note|标签|tag)(?:\s*:\s*|\s+)(.+)$/i);
    if (!dimMatch) {
      errors.push(`第 ${lineNo} 行缺少分类/子分类/笔记/标签`);
      return;
    }
    const dim = dimFromText(dimMatch[1]);
    if (!dim) {
      errors.push(`第 ${lineNo} 行维度无法识别`);
      return;
    }
    const names = dimMatch[2].split(/[，,、；;]/).map((name) => name.trim()).filter(Boolean);
    if (names.length === 0) {
      errors.push(`第 ${lineNo} 行缺少规则名`);
      return;
    }
    const bk = bucketKey(dim);
    for (const name of names) {
      overrides[bk][name] = value;
      count++;
    }
  });

  return { overrides, count, errors };
}

export function formatLifePeriodRuleText(overrides: LifePeriodOverrides): string {
  const rows: string[] = [];
  const groups: { value: OverrideValue; label: string }[] = [
    { value: 'short', label: '短' },
    { value: 'long', label: '长' },
    { value: 'ignore', label: '忽略' },
  ];
  const dims: { dim: OverrideDimension; label: string; map: Record<string, OverrideValue> }[] = [
    { dim: 'category', label: '分类', map: overrides.categories ?? {} },
    { dim: 'subcategory', label: '子分类', map: overrides.subcategories ?? {} },
    { dim: 'note', label: '笔记', map: overrides.notes ?? {} },
    { dim: 'tag', label: '标签', map: overrides.tags ?? {} },
  ];

  for (const group of groups) {
    const groupRows: string[] = [];
    for (const dim of dims) {
      const names = Object.entries(dim.map)
        .filter(([, value]) => value === group.value)
        .map(([name]) => name)
        .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
      groupRows.push(...names.map((name) => `${dim.label} ${name}`));
    }
    if (groupRows.length === 0) continue;
    if (rows.length > 0) rows.push('');
    rows.push(`${group.label}:`, ...groupRows);
  }

  return rows.join('\n');
}

export const useLifePeriodOverrideStore = create<LifePeriodOverrideStore>()(
  persist(
    (set) => ({
      overrides: EMPTY,
      ruleText: '',
      setOverride: (dim, name, value) =>
        set((s) => {
          const bk = bucketKey(dim);
          const next = { ...s.overrides[bk] };
          if (value === null) delete next[name];
          else next[name] = value;
          const overrides = { ...s.overrides, [bk]: next };
          return { overrides, ruleText: formatLifePeriodRuleText(overrides) };
        }),
      setRulesFromText: (text) => {
        const parsed = parseLifePeriodRuleText(text);
        if (parsed.errors.length === 0) {
          set({ overrides: parsed.overrides, ruleText: text });
        }
        return parsed;
      },
      resetAll: () => set({ overrides: EMPTY, ruleText: '' }),
    }),
    {
      name: 'life-period-overrides',
      version: 1,
      partialize: (s) => ({ overrides: s.overrides, ruleText: s.ruleText }),
      merge: (persisted, current) => {
        const p = (persisted && typeof persisted === 'object'
          ? persisted as { overrides?: Partial<LifePeriodOverrides>; ruleText?: unknown }
          : {});
        const ov = p.overrides ?? {};
        const overrides = {
          categories: ov.categories ?? {},
          subcategories: ov.subcategories ?? {},
          notes: ov.notes ?? {},
          tags: ov.tags ?? {},
        };
        return {
          ...current,
          overrides,
          ruleText: typeof p.ruleText === 'string' ? p.ruleText : formatLifePeriodRuleText(overrides),
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
  const subs = overrides.subcategories ?? {};
  const cats = overrides.categories ?? {};
  const notes = overrides.notes ?? {};
  const tagsMap = overrides.tags ?? {};
  const subKeyPrimary = subcategoryKey(item.category, item.subcategory);
  const sub = subs[subKeyPrimary];
  if (sub === 'short' || sub === 'long') return sub;
  if (!item.category && item.subcategory) {
    const fallbackKey = subcategoryKey('(未分类)', item.subcategory);
    const fb = subs[fallbackKey];
    if (fb === 'short' || fb === 'long') return fb;
  }
  if (item.note) {
    const noteOv = notes[item.note];
    if (noteOv === 'short' || noteOv === 'long') return noteOv;
  }
  const cat = cats[item.category];
  if (cat === 'short' || cat === 'long') return cat;
  const tagList = item.tags.split(',').map((t) => t.trim()).filter(Boolean);
  for (const t of tagList) {
    const tg = tagsMap[t];
    if (tg === 'short' || tg === 'long') return tg;
  }
  return null;
}
