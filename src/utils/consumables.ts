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

// 默认黑名单：账单里常见的「系统/分类」tag，不应作为商品识别用
export const DEFAULT_TAG_BLACKLIST = [
  '消耗品',
  '周期生活',
  '波动生活',
  '消费',
  '吃好喝好',
  '红',
  '黑',
  '白',
  '家',
];

// note 首词：到第一个分隔符（空白 / 中英文标点 / 数字单位前）截断
export function noteFirstWord(note: string): string {
  if (!note) return '';
  const trimmed = note.trim();
  if (!trimmed) return '';
  // 把常见分隔符当成切分点
  const m = trimmed.split(/[\s,，;；\-\/／:：()（）]+/)[0] || '';
  return m.trim();
}

// 从 tags 字段（逗号分隔）中剔除黑名单后剩下的「业务 tag」列表，保持原顺序
export function extractProductTags(tags: string, blacklist: Set<string>): string[] {
  if (!tags) return [];
  return tags
    .split(/[,，]/)
    .map((t) => t.trim())
    .filter((t) => t && !blacklist.has(t));
}

export function makeMatchKey(subcategory: string, productTag: string): string {
  return `${(subcategory || '').trim()}|${(productTag || '').trim()}`;
}

export interface ConsumablePurchase {
  id: string;            // expenseItemId
  yearMonth: string;
  item: BillExpenseItem;
  matchKey: string;
  productTags: string[]; // 剔除黑名单后剩下的业务 tags
}

// 从所有月份提取带「消耗品」标签的购买条目（matchKey 为占位，后续在 groupPurchasesByProduct 中按业务 tag 频次重写）
export function extractConsumablePurchases(
  expenseItems: Record<string, BillExpenseMonth>,
  blacklist: string[] = DEFAULT_TAG_BLACKLIST,
): ConsumablePurchase[] {
  const out: ConsumablePurchase[] = [];
  const blackSet = new Set(blacklist);
  for (const ym of Object.keys(expenseItems)) {
    const month = expenseItems[ym];
    if (!month?.length) continue;
    const withIds = assignExpenseIds(month);
    for (const { item, id } of withIds) {
      const tagList = (item.tags || '').split(/[,，]/).map((t) => t.trim());
      if (!tagList.includes(CONSUMABLE_TAG)) continue;
      const productTags = extractProductTags(item.tags || '', blackSet);
      // 占位 matchKey：先用 subcategory|noteFirstWord 兜底；下游重新覆盖
      out.push({
        id,
        yearMonth: ym,
        item,
        matchKey: makeMatchKey(item.subcategory, noteFirstWord(item.note)),
        productTags,
      });
    }
  }
  // 按日期升序
  out.sort((a, b) => (a.item.date < b.item.date ? -1 : a.item.date > b.item.date ? 1 : 0));
  return out;
}

// 根据当前 products + 用户 extras，把购买分配到 productId
// 返回：grouped[productId] = purchases[]，以及 ungrouped（既无手动绑定也无 product matchKey 命中）
//
// matchKey 计算策略：
//   1. 在 (subcategory) 桶内统计每个业务 tag 的出现频次
//   2. 每条 purchase 取自身业务 tags 中频次最高（同频次保留首个）的 tag → matchKey = subcategory|tag
//   3. 没有业务 tag 的回退到 subcategory|noteFirstWord
//   每条 purchase 的 matchKey 会被覆盖写回（用于显示与回写 store）
export function groupPurchasesByProduct(
  products: ConsumableProduct[],
  purchases: ConsumablePurchase[],
  extras: Record<string, PurchaseExtra>,
): { grouped: Record<string, ConsumablePurchase[]>; ungrouped: ConsumablePurchase[]; suggestions: Record<string, ConsumablePurchase[]> } {
  const grouped: Record<string, ConsumablePurchase[]> = {};
  const ungrouped: ConsumablePurchase[] = [];
  const suggestions: Record<string, ConsumablePurchase[]> = {};

  // 第一遍：按 subcategory 桶统计业务 tag 频次
  const tagFreqBySubcat = new Map<string, Map<string, number>>();
  for (const p of purchases) {
    if (extras[p.id]?.excluded) continue;
    const sub = (p.item.subcategory || '').trim();
    let bucket = tagFreqBySubcat.get(sub);
    if (!bucket) {
      bucket = new Map();
      tagFreqBySubcat.set(sub, bucket);
    }
    for (const t of p.productTags) {
      bucket.set(t, (bucket.get(t) || 0) + 1);
    }
  }

  // 第二遍：为每条 purchase 选定业务 tag → 重写 matchKey
  for (const p of purchases) {
    const sub = (p.item.subcategory || '').trim();
    const bucket = tagFreqBySubcat.get(sub);
    let chosen = '';
    if (bucket && p.productTags.length > 0) {
      let bestFreq = -1;
      for (const t of p.productTags) {
        const f = bucket.get(t) || 0;
        if (f > bestFreq) {
          bestFreq = f;
          chosen = t;
        }
      }
    }
    p.matchKey = chosen ? makeMatchKey(sub, chosen) : makeMatchKey(sub, noteFirstWord(p.item.note));
  }

  // 第三遍：按 matchKey / extras.productId 分发到 product
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
  return subcat || '未命名消费品';
}

// 库存状态：基于历史购买间隔 + 手动「已用完」时间戳
export type InventoryStatus = 'ok' | 'soon' | 'overdue' | 'manual-out' | 'no-data';

export interface InventoryInfo {
  status: InventoryStatus;
  daysSinceLast?: number;
  avgIntervalDays?: number;
  lastDate?: string;
  expectedNextDate?: string;
  effectiveUsedUpAt?: string; // usedUpAt 在没被新购买冲掉时
}

// 如果 usedUpAt 早于（或等于）最后一次购买日期 → 视为自动清除（购买刷新了状态）
export function isUsedUpStillEffective(usedUpAt: string | undefined, lastPurchaseDate: string | undefined): boolean {
  if (!usedUpAt) return false;
  if (!lastPurchaseDate) return true;
  return usedUpAt.slice(0, 10) > lastPurchaseDate.slice(0, 10);
}

export function calcInventoryStatus(
  stats: ConsumptionStats,
  usedUpAt?: string,
  today: Date = new Date(),
): InventoryInfo {
  const effectiveUsedUp = isUsedUpStillEffective(usedUpAt, stats.lastDate) ? usedUpAt : undefined;
  if (effectiveUsedUp) {
    return {
      status: 'manual-out',
      daysSinceLast: stats.daysSinceLast,
      avgIntervalDays: stats.avgIntervalDays,
      lastDate: stats.lastDate,
      expectedNextDate: stats.expectedNextDate,
      effectiveUsedUpAt: effectiveUsedUp,
    };
  }
  if (stats.count === 0) return { status: 'no-data' };

  const { daysSinceLast, avgIntervalDays } = stats;
  let status: InventoryStatus = 'ok';
  if (avgIntervalDays && avgIntervalDays > 0 && daysSinceLast !== undefined) {
    if (daysSinceLast > avgIntervalDays) status = 'overdue';
    else if (avgIntervalDays - daysSinceLast <= Math.max(2, avgIntervalDays * 0.2)) status = 'soon';
  }
  // 触发 today 引用以避免 unused 警告
  void today;
  return {
    status,
    daysSinceLast,
    avgIntervalDays,
    lastDate: stats.lastDate,
    expectedNextDate: stats.expectedNextDate,
  };
}

export function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}
