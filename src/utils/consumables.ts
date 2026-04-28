import type {
  BillExpenseItem,
  BillExpenseMonth,
} from './importBill';
import { assignExpenseIds } from './importBill';
import type {
  ConsumableProduct,
  PurchaseExtra,
  PriceCandidate,
} from '../models/types';

export const CONSUMABLE_TAG = '消耗品';

// note 首词：到第一个分隔符（空白 / 中英文标点 / 数字单位前）截断
export function noteFirstWord(note: string): string {
  if (!note) return '';
  const trimmed = note.trim();
  if (!trimmed) return '';
  // 把常见分隔符当成切分点
  const m = trimmed.split(/[\s,，;；\-\/／:：()（）]+/)[0] || '';
  return m.trim();
}

export function makeMatchKey(subcategory: string, note: string): string {
  return `${(subcategory || '').trim()}|${noteFirstWord(note)}`;
}

export interface ConsumablePurchase {
  id: string;            // expenseItemId
  yearMonth: string;
  item: BillExpenseItem;
  matchKey: string;
}

// 从所有月份提取带「消耗品」标签的购买条目
export function extractConsumablePurchases(
  expenseItems: Record<string, BillExpenseMonth>,
): ConsumablePurchase[] {
  const out: ConsumablePurchase[] = [];
  for (const ym of Object.keys(expenseItems)) {
    const month = expenseItems[ym];
    if (!month?.length) continue;
    const withIds = assignExpenseIds(month);
    for (const { item, id } of withIds) {
      const tagList = (item.tags || '').split(',').map((t) => t.trim());
      if (!tagList.includes(CONSUMABLE_TAG)) continue;
      out.push({
        id,
        yearMonth: ym,
        item,
        matchKey: makeMatchKey(item.subcategory, item.note),
      });
    }
  }
  // 按日期升序
  out.sort((a, b) => (a.item.date < b.item.date ? -1 : a.item.date > b.item.date ? 1 : 0));
  return out;
}

// 根据当前 products + 用户 extras，把购买分配到 productId
// 返回：grouped[productId] = purchases[]，以及 ungrouped（既无手动绑定也无 product matchKey 命中）
export function groupPurchasesByProduct(
  products: ConsumableProduct[],
  purchases: ConsumablePurchase[],
  extras: Record<string, PurchaseExtra>,
): { grouped: Record<string, ConsumablePurchase[]>; ungrouped: ConsumablePurchase[]; suggestions: Record<string, ConsumablePurchase[]> } {
  const grouped: Record<string, ConsumablePurchase[]> = {};
  const ungrouped: ConsumablePurchase[] = [];
  const suggestions: Record<string, ConsumablePurchase[]> = {};

  // 建索引：matchKey → product
  const keyToProduct = new Map<string, ConsumableProduct>();
  for (const p of products) {
    if (p.archived) continue;
    for (const k of p.matchKeys) keyToProduct.set(k, p);
  }

  for (const purchase of purchases) {
    const extra = extras[purchase.id];
    if (extra?.excluded) continue;

    let pid: string | undefined = extra?.productId;
    if (!pid) {
      const matched = keyToProduct.get(purchase.matchKey);
      if (matched) pid = matched.id;
    }
    if (pid) {
      (grouped[pid] = grouped[pid] || []).push(purchase);
    } else {
      ungrouped.push(purchase);
      (suggestions[purchase.matchKey] = suggestions[purchase.matchKey] || []).push(purchase);
    }
  }
  return { grouped, ungrouped, suggestions };
}

export interface ConsumptionStats {
  count: number;
  firstDate?: string;
  lastDate?: string;
  daysSinceLast?: number;
  avgIntervalDays?: number;
  expectedNextDate?: string;
  isOverdue?: boolean;
  totalSpend: number;
}

export function calcConsumptionStats(
  purchases: ConsumablePurchase[],
  today: Date = new Date(),
): ConsumptionStats {
  if (purchases.length === 0) return { count: 0, totalSpend: 0 };
  const sorted = [...purchases].sort((a, b) =>
    a.item.date < b.item.date ? -1 : a.item.date > b.item.date ? 1 : 0,
  );
  const firstDate = sorted[0].item.date;
  const lastDate = sorted[sorted.length - 1].item.date;
  const totalSpend = sorted.reduce((s, p) => s + p.item.amount, 0);
  const last = new Date(lastDate);
  const todayMid = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const daysSinceLast = Math.max(0, Math.round((todayMid.getTime() - last.getTime()) / 86400000));

  if (sorted.length < 2) {
    return { count: sorted.length, firstDate, lastDate, daysSinceLast, totalSpend };
  }
  const first = new Date(firstDate);
  const span = (last.getTime() - first.getTime()) / 86400000;
  const avgIntervalDays = span > 0 ? Math.round(span / (sorted.length - 1)) : undefined;

  let expectedNextDate: string | undefined;
  let isOverdue = false;
  if (avgIntervalDays && avgIntervalDays > 0) {
    const next = new Date(last.getTime() + avgIntervalDays * 86400000);
    expectedNextDate = next.toISOString().slice(0, 10);
    isOverdue = todayMid.getTime() > next.getTime();
  }
  return { count: sorted.length, firstDate, lastDate, daysSinceLast, avgIntervalDays, expectedNextDate, isOverdue, totalSpend };
}

// 将历史购买与候选报价合并为一个比价行
export interface PriceRow {
  kind: 'purchase' | 'candidate';
  id: string;
  source: string;          // 历史用 account；候选用 source
  date?: string;           // 历史用购买日期；候选用 addedAt
  spec?: string;
  qty?: number;
  totalPrice: number;
  unitPrice?: number;
  note?: string;
  pinned?: boolean;
  raw: ConsumablePurchase | PriceCandidate;
}

export function buildPriceRows(
  purchases: ConsumablePurchase[],
  candidates: PriceCandidate[],
  extras: Record<string, PurchaseExtra>,
): PriceRow[] {
  const rows: PriceRow[] = [];
  for (const p of purchases) {
    const ex = extras[p.id];
    const qty = ex?.qty;
    const unitPrice = qty && qty > 0 ? p.item.amount / qty : undefined;
    rows.push({
      kind: 'purchase',
      id: p.id,
      source: p.item.account || '历史',
      date: p.item.date,
      spec: ex?.spec,
      qty,
      totalPrice: p.item.amount,
      unitPrice,
      note: p.item.note,
      raw: p,
    });
  }
  for (const c of candidates) {
    const unitPrice = c.qty && c.qty > 0 ? c.totalPrice / c.qty : undefined;
    rows.push({
      kind: 'candidate',
      id: c.id,
      source: c.source,
      date: new Date(c.addedAt).toISOString().slice(0, 10),
      spec: c.spec,
      qty: c.qty,
      totalPrice: c.totalPrice,
      unitPrice,
      note: c.note,
      pinned: c.pinned,
      raw: c,
    });
  }
  // 排序：pinned 置顶 → 单价升序（无单价的回退到 totalPrice 升序，置后）
  rows.sort((a, b) => {
    if ((a.pinned ? 1 : 0) !== (b.pinned ? 1 : 0)) return a.pinned ? -1 : 1;
    const aHas = a.unitPrice !== undefined;
    const bHas = b.unitPrice !== undefined;
    if (aHas && bHas) return (a.unitPrice as number) - (b.unitPrice as number);
    if (aHas) return -1;
    if (bHas) return 1;
    return a.totalPrice - b.totalPrice;
  });
  return rows;
}

// 基于 ungrouped 的 matchKey 生成「建议商品」候选名（供一键创建）
export function suggestProductName(matchKey: string, samples: ConsumablePurchase[]): string {
  const [, firstWord] = matchKey.split('|');
  if (firstWord) return firstWord;
  const subcat = samples[0]?.item.subcategory?.trim();
  return subcat || '未命名消耗品';
}

export function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}
