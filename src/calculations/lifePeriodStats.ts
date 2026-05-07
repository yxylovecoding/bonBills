// 基于历史 reviewed 天里的勾选行为，统计各分类/子分类/标签
// 在「短周期（已勾）」和「长周期（未勾）」两侧的出现频次
import type { TagKind } from '../models/types';
import type { BillExpenseMonth } from '../utils/importBill';
import { assignExpenseIds } from '../utils/importBill';
import { normalizeConfirmedSelection } from '../stores/calendarStore';
import { subcategoryKey } from '../stores/lifePeriodOverrideStore';

export type LifePeriodStatRow = {
  name: string;
  shortCount: number; // 命中短周期的账单条数
  longCount: number;  // 命中长周期的账单条数
  shortAmount: number;
  longAmount: number;
};

export type LifePeriodStats = {
  categories: LifePeriodStatRow[];
  subcategories: LifePeriodStatRow[]; // name = "category|subcategory"
  tags: LifePeriodStatRow[];
};

function ensureRow(map: Map<string, LifePeriodStatRow>, name: string): LifePeriodStatRow {
  let r = map.get(name);
  if (!r) {
    r = { name, shortCount: 0, longCount: 0, shortAmount: 0, longAmount: 0 };
    map.set(name, r);
  }
  return r;
}

export function buildLifePeriodStats(
  tagMap: Record<string, TagKind>,
  confirmedExpenses: Record<string, { ids: string[]; reviewed: boolean } | string[]>,
  expenseItems: Record<string, BillExpenseMonth>,
): LifePeriodStats {
  const cats = new Map<string, LifePeriodStatRow>();
  const subs = new Map<string, LifePeriodStatRow>();
  const tags = new Map<string, LifePeriodStatRow>();

  for (const [date, raw] of Object.entries(confirmedExpenses)) {
    const sel = normalizeConfirmedSelection(raw);
    if (!sel.reviewed) continue;
    if (!tagMap[date]) continue;
    const ym = date.slice(0, 7);
    const monthItems = expenseItems[ym];
    if (!monthItems || monthItems.length === 0) continue;

    const dayItems = assignExpenseIds(monthItems.filter((it) => it.date === date));
    const selectedIds = new Set(sel.ids);

    for (const { item, id } of dayItems) {
      const tagList = item.tags.split(',').map((t) => t.trim()).filter(Boolean);
      const isLife = tagList.includes('周期生活') || tagList.includes('波动生活');
      if (!isLife) continue;
      const isShort = selectedIds.has(id);

      const catName = item.category || '(未分类)';
      const subName = subcategoryKey(catName, item.subcategory || '');

      const catRow = ensureRow(cats, catName);
      const subRow = ensureRow(subs, subName);
      if (isShort) {
        catRow.shortCount++; catRow.shortAmount += item.amount;
        subRow.shortCount++; subRow.shortAmount += item.amount;
      } else {
        catRow.longCount++;  catRow.longAmount  += item.amount;
        subRow.longCount++;  subRow.longAmount  += item.amount;
      }

      for (const t of tagList) {
        if (t === '周期生活' || t === '波动生活') continue; // 这两个是大类，不作为细分维度
        const tagRow = ensureRow(tags, t);
        if (isShort) { tagRow.shortCount++; tagRow.shortAmount += item.amount; }
        else { tagRow.longCount++; tagRow.longAmount += item.amount; }
      }
    }
  }

  const sortByTotal = (a: LifePeriodStatRow, b: LifePeriodStatRow) =>
    (b.shortCount + b.longCount) - (a.shortCount + a.longCount);

  return {
    categories: Array.from(cats.values()).sort(sortByTotal),
    subcategories: Array.from(subs.values()).sort(sortByTotal),
    tags: Array.from(tags.values()).sort(sortByTotal),
  };
}

// 推荐周期：哪边出现次数多就猜哪边；二者都为 0 返回 null
export function suggestPeriod(row: LifePeriodStatRow): 'short' | 'long' | null {
  if (row.shortCount === 0 && row.longCount === 0) return null;
  return row.shortCount >= row.longCount ? 'short' : 'long';
}

// 是否不一致（两侧都有）
export function isInconsistent(row: LifePeriodStatRow): boolean {
  return row.shortCount > 0 && row.longCount > 0;
}
