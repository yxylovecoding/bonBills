import type { InvestPositionItem } from '../models/types';
import type { InvestPositionDraft } from './investPositionDrafts';
import { calculateInvestPositionMetric, type InvestMarketSnapshot } from './investPositionItems';

export type AlipayHoldingDraft = {
  name: string; status: InvestPositionItem['status']; mode: 'amount' | 'shares';
  amount: string; profit: string; shares: string; costPrice: string; price: string;
};
const round = (value: number, digits = 2) => Math.round((value + Number.EPSILON) * 10 ** digits) / 10 ** digits;
function numeric(value: string, label: string, signed = false) {
  const result = Number(value);
  if (!value.trim() || !Number.isFinite(result) || Math.abs(result) > 1e12 || (!signed && result < 0)) throw new Error(`请填写有效的${label}`);
  return result;
}

export function alipayHoldingDraft(item: InvestPositionItem, market?: InvestMarketSnapshot): AlipayHoldingDraft {
  const metric = calculateInvestPositionMetric(item, market);
  return { name: item.name, status: item.status, mode: 'amount',
    amount: String(round(metric.marketValueCny / (metric.fxRateToCny ?? 1))),
    profit: String(round(metric.holdingProfitCny / metric.profitFxRateToCny)),
    shares: item.shares?.toString() ?? '', costPrice: item.costPrice?.toString() ?? '', price: metric.price?.toString() ?? '' };
}

export function alipayHoldingEditSignature(item: InvestPositionItem, market?: InvestMarketSnapshot) {
  return JSON.stringify([item, calculateInvestPositionMetric(item, market)]);
}

/** Correct the shared ledger balance without adding or replaying any transaction. */
export function buildAlipayHoldingPatch(item: InvestPositionItem, draft: AlipayHoldingDraft, market?: InvestMarketSnapshot): Partial<InvestPositionDraft> {
  if (!draft.name.trim()) throw new Error('请填写名称');
  const patch: Partial<InvestPositionDraft> = { name: draft.name.trim(), status: draft.status };
  const before = alipayHoldingDraft(item, market);
  const fields = draft.mode === 'amount' ? ['amount', 'profit', 'price'] as const : ['shares', 'costPrice', 'price'] as const;
  if (fields.every((field) => draft[field] === before[field])) return patch;
  const metric = calculateInvestPositionMetric(item, market);
  const price = draft.price.trim() ? numeric(draft.price, '净值') : undefined;
  if (price !== undefined && price <= 0) throw new Error('净值必须大于零');
  const fx = metric.fxRateToCny ?? metric.profitFxRateToCny;
  let shares: number, costPrice: number, amount: number | undefined, profit: number | undefined;
  if (draft.mode === 'amount') {
    amount = numeric(draft.amount, '持有金额');
    profit = numeric(draft.profit, '持有收益', true);
    if (profit > amount || (amount === 0 && profit !== 0)) throw new Error('持有金额与收益不一致，请核对');
    if (amount > 0 && !(price && price > 0)) throw new Error('请补充净值，或改用份额与成本修正');
    shares = amount === 0 ? 0 : round(amount / price!, 10);
    if (amount > 0 && shares === 0) throw new Error('持有金额与净值不一致，请核对');
    costPrice = shares > 0 ? round((amount - profit) / shares, 10) : 0;
  } else {
    shares = numeric(draft.shares, '份额');
    costPrice = numeric(draft.costPrice, '成本价');
    amount = shares === 0 ? 0 : price ? shares * price : undefined;
    profit = shares === 0 ? 0 : price ? shares * (price - costPrice) : undefined;
  }
  Object.assign(patch, { shares: String(shares), costPrice: String(costPrice),
    ...(amount === undefined ? {} : { marketValueCny: String(round(amount * fx)) }),
    ...(profit === undefined ? {} : { holdingProfitCny: String(round(profit * fx)) }),
    ...(price === undefined ? {} : { lastPrice: String(price), lastCurrency: metric.currency ?? item.quoteCurrency ?? 'CNY', lastFxRateToCny: fx }),
  });
  // Preserve the T+1/T+2 boundary and pending links. Only refresh its valuation.
  if (item.alipayCorrection) patch.alipayCorrection = { ...item.alipayCorrection,
    valuation: price && amount !== undefined && profit !== undefined && fx === 1
      ? { shares, costPrice, price, marketValueCny: round(amount), holdingProfitCny: round(profit) } : undefined };
  return patch;
}
