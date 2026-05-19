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
  confirmedExpenses: Record<string, { ids: string[]; longIds?: string[]; reviewed: boolean } | string[]>,
  expenseItems: Record<string, BillExpenseMonth>,
): LifePeriodStats {
  const subs = new Map<string, LifePeriodStatRow>();
  const tags = new Map<string, LifePeriodStatRow>();

  // 先扫所有账单，确保每个出现过的子分类/标签都有一行（即使从未审过）
  // 计数只在该天显式归属过时累加；其他情况只建空行
  for (const [ym, monthItems] of Object.entries(expenseItems)) {
    if (!monthItems || monthItems.length === 0) continue;
    for (const date of new Set(monthItems.map((it) => it.date))) {
      const dayItems = assignExpenseIds(monthItems.filter((it) => it.date === date));
      const sel = normalizeConfirmedSelection(confirmedExpenses[date]);
      const tagged = !!tagMap[date];
      const reviewed = sel.reviewed;
      const hasExplicitLong = sel.longIds !== undefined;
      const selectedIds = new Set(sel.ids);
      const longSet = new Set(sel.longIds ?? []);

      for (const { item, id } of dayItems) {
        const tagList = item.tags.split(',').map((t) => t.trim()).filter(Boolean);
        const isLife = tagList.includes('周期生活') || tagList.includes('波动生活');
        if (!isLife) continue;

        // 决定是否计入短/长统计；不影响行是否出现
        let countAs: 'short' | 'long' | null = null;
        if (tagged) {
          if (selectedIds.has(id)) countAs = 'short';
          else if (longSet.has(id)) countAs = 'long';
          else if (reviewed && !hasExplicitLong) countAs = 'long'; // 旧数据兜底
        }

        const catName = item.category || '(未分类)';
        const subName = subcategoryKey(catName, item.subcategory || '');
        const subRow = ensureRow(subs, subName);
        if (countAs === 'short') { subRow.shortCount++; subRow.shortAmount += item.amount; }
        else if (countAs === 'long') { subRow.longCount++; subRow.longAmount += item.amount; }

        for (const t of tagList) {
          if (t === '周期生活' || t === '波动生活') continue;
          const tagRow = ensureRow(tags, t);
          if (countAs === 'short') { tagRow.shortCount++; tagRow.shortAmount += item.amount; }
          else if (countAs === 'long') { tagRow.longCount++; tagRow.longAmount += item.amount; }
        }
      }
      // 顺便用一下 ym 防 lint
      void ym;
    }
  }

  const sortByTotal = (a: LifePeriodStatRow, b: LifePeriodStatRow) =>
    (b.shortCount + b.longCount) - (a.shortCount + a.longCount);

  return {
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
