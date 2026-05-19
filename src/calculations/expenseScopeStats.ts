// 基于历史 reviewed 天里的勾选行为，统计各分类/子分类/标签
// 在「本地」和「共享」两侧的出现频次
import type { TagKind } from '../models/types';
import type { BillExpenseMonth } from '../utils/importBill';
import { assignExpenseIds } from '../utils/importBill';
import { normalizeConfirmedSelection } from '../stores/calendarStore';
import { subcategoryKey } from '../stores/expenseScopeOverrideStore';

export type ExpenseScopeStatRow = {
  name: string;
  localCount: number;
  sharedCount: number;
  localAmount: number;
  sharedAmount: number;
};

export type ExpenseScopeStats = {
  subcategories: ExpenseScopeStatRow[]; // name = "category|subcategory"
  notes: ExpenseScopeStatRow[];          // name = 笔记原文
  tags: ExpenseScopeStatRow[];
};

function ensureRow(map: Map<string, ExpenseScopeStatRow>, name: string): ExpenseScopeStatRow {
  let r = map.get(name);
  if (!r) {
    r = { name, localCount: 0, sharedCount: 0, localAmount: 0, sharedAmount: 0 };
    map.set(name, r);
  }
  return r;
}

export function buildExpenseScopeStats(
  tagMap: Record<string, TagKind>,
  confirmedExpenses: Record<string, unknown>,
  expenseItems: Record<string, BillExpenseMonth>,
  // 仅显示至少有一个标签命中 scopeTags 的账单对应的行；不传或为空 → 不过滤
  scopeTags?: string[],
): ExpenseScopeStats {
  const scopeSet = scopeTags && scopeTags.length > 0 ? new Set(scopeTags) : null;
  const subs = new Map<string, ExpenseScopeStatRow>();
  const notes = new Map<string, ExpenseScopeStatRow>();
  const tags = new Map<string, ExpenseScopeStatRow>();

  // 先扫所有账单，确保每个出现过的子分类/标签都有一行（即使从未审过）
  // 计数只在该天显式归属过时累加；其他情况只建空行
  for (const [ym, monthItems] of Object.entries(expenseItems)) {
    if (!monthItems || monthItems.length === 0) continue;
    for (const date of new Set(monthItems.map((it) => it.date))) {
      const dayItems = assignExpenseIds(monthItems.filter((it) => it.date === date));
      const sel = normalizeConfirmedSelection(confirmedExpenses[date]);
      const tagged = !!tagMap[date];
      const reviewed = sel.reviewed;
      const hasExplicitShared = sel.sharedIds !== undefined;
      const localSet = new Set(sel.localIds);
      const sharedSet = new Set(sel.sharedIds ?? []);

      for (const { item, id } of dayItems) {
        const tagList = item.tags.split(',').map((t) => t.trim()).filter(Boolean);
        const inScope = scopeSet
          ? tagList.some((t) => scopeSet.has(t))
          : tagList.includes('周期生活') || tagList.includes('波动生活');
        if (!inScope) continue;

        // 仅统计"显式选择"过的：旧 checkbox 模式下未勾并不等于共享，
        // 那只是"未确认是今天的开销"，不该污染历史推荐值
        let countAs: 'local' | 'shared' | null = null;
        if (tagged) {
          if (localSet.has(id)) countAs = 'local';
          else if (sharedSet.has(id)) countAs = 'shared';
        }
        void reviewed; void hasExplicitShared;

        const catName = item.category || '(未分类)';
        const subName = subcategoryKey(catName, item.subcategory || '');
        const subRow = ensureRow(subs, subName);
        if (countAs === 'local') { subRow.localCount++; subRow.localAmount += item.amount; }
        else if (countAs === 'shared') { subRow.sharedCount++; subRow.sharedAmount += item.amount; }

        if (item.note) {
          const noteRow = ensureRow(notes, item.note);
          if (countAs === 'local') { noteRow.localCount++; noteRow.localAmount += item.amount; }
          else if (countAs === 'shared') { noteRow.sharedCount++; noteRow.sharedAmount += item.amount; }
        }

        for (const t of tagList) {
          if (t === '周期生活' || t === '波动生活' || t === '消费') continue; // 这三个是大类，不作为细分维度
          const tagRow = ensureRow(tags, t);
          if (countAs === 'local') { tagRow.localCount++; tagRow.localAmount += item.amount; }
          else if (countAs === 'shared') { tagRow.sharedCount++; tagRow.sharedAmount += item.amount; }
        }
      }
      // 顺便用一下 ym 防 lint
      void ym;
    }
  }

  const sortByTotal = (a: ExpenseScopeStatRow, b: ExpenseScopeStatRow) =>
    (b.localCount + b.sharedCount) - (a.localCount + a.sharedCount);

  return {
    subcategories: Array.from(subs.values()).sort(sortByTotal),
    notes: Array.from(notes.values()).sort(sortByTotal),
    tags: Array.from(tags.values()).sort(sortByTotal),
  };
}

// 推荐范围：哪边出现次数多就猜哪边；二者都为 0 返回 null
export function suggestScope(row: ExpenseScopeStatRow): 'local' | 'shared' | null {
  if (row.localCount === 0 && row.sharedCount === 0) return null;
  return row.localCount >= row.sharedCount ? 'local' : 'shared';
}

// 是否不一致（两侧都有）
export function isInconsistent(row: ExpenseScopeStatRow): boolean {
  return row.localCount > 0 && row.sharedCount > 0;
}
