import type {
  FundConfirmationOverride, FundConfirmationRule, InvestPositionItem, InvestPositionItems,
  InvestmentTransactionRecord, MonthlyRecord, PendingInvestmentBuy,
} from '../models/types';
import type { HolidayDataByYear } from './holidays';
import { canonicalInvestmentSymbol } from './investmentInstrument';
import { calculateInvestPositionMetric, INVEST_POSITION_KEYS } from './investPositionItems';
import { cloneInvestPositionItems, investmentApplicationOrder } from './investmentRollover';
import { estimatePendingFundBuy, pendingFundNavStartDate, type FundNavBar } from './pendingFundEstimate';

export type FundMetadata = { name: string; type: string };
export type AlipayOrder = {
  key: string; itemId: string; operationAt: string; amount?: number; currency: string;
  confirmationDate?: string; status: 'pending' | 'confirmed' | 'review';
  shares?: number; price?: number; navDate?: string; ambiguous?: boolean;
  override?: FundConfirmationOverride | null;
};
export type AlipayProjectionOptions = {
  asOf: string;
  records: MonthlyRecord[];
  holidays: HolidayDataByYear;
  metadata: Record<string, FundMetadata | undefined>;
  rules?: Record<string, FundConfirmationRule>;
  overrides?: Record<string, FundConfirmationOverride | null>;
  navs?: Record<string, FundNavBar[] | undefined>;
};

const round = (n: number, places = 4) => Math.round((n + Number.EPSILON) * 10 ** places) / 10 ** places;
const nextDate = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
export const chinaToday = (now = Date.now()) => new Date(now + 8 * 3_600_000).toISOString().slice(0, 10);
export const isConfirmationFund = (item: Pick<InvestPositionItem, 'symbol' | 'quoteSource'>) =>
  item.quoteSource === 'eastmoney-fund' && /^\d{6}$/.test(canonicalInvestmentSymbol(item.symbol));
export const fundConfirmationKey = (symbol: string) => `eastmoney-fund:${canonicalInvestmentSymbol(symbol)}`;

export function validConfirmationDate(date: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T00:00:00Z`))
    && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
}

export function holdingsAsOf(yearMonth: string, today = chinaToday()) {
  const [year, month] = yearMonth.split('-').map(Number);
  const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return end < today ? end : today;
}

export function resolveFundConfirmationRule(metadata: FundMetadata | undefined, rule: FundConfirmationRule = 'auto'): 1 | 2 | undefined {
  if (rule === 1 || rule === 2) return rule;
  if (!metadata) return undefined;
  if (/qdii/i.test(`${metadata.name} ${metadata.type}`)) return 2;
  // A generic search result labelled merely “基金” is not evidence of its settlement class.
  if (/股票型|混合型|债券型|货币型|指数型|指数-/.test(metadata.type) && !/FOF|养老/i.test(metadata.type)) return 1;
  return undefined;
}

function tradingDay(date: string, holidays: HolidayDataByYear): boolean | undefined {
  const year = Number(date.slice(0, 4));
  if (!holidays[year]) return undefined;
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return weekday !== 0 && weekday !== 6 && !holidays[year][date]?.isOffDay;
}

export function estimateConfirmationDate(
  operationAt: string, days: 1 | 2 | undefined, holidays: HolidayDataByYear, navDate?: string,
) {
  if (!days) return undefined;
  let date = navDate && validConfirmationDate(navDate) ? navDate : pendingFundNavStartDate(operationAt);
  if (!date) return undefined;
  // A missing calendar is unknown, not an all-open year. Bound the walk even for bad input.
  for (let attempts = 0; attempts < 370; attempts++, date = nextDate(date)) {
    const open = tradingDay(date, holidays);
    if (open === undefined) return undefined;
    if (!open) continue;
    let remaining = days;
    for (let count = 0; count < 370; count++) {
      date = nextDate(date);
      const confirmationOpen = tradingDay(date, holidays);
      if (confirmationOpen === undefined) return undefined;
      if (confirmationOpen && --remaining === 0) return date;
    }
    return undefined;
  }
  return undefined;
}

export function confirmationOrderKey(entry: InvestmentTransactionRecord | PendingInvestmentBuy, useMatchKey = false) {
  const base = 'baseMatchKey' in entry ? entry.baseMatchKey : entry.pendingBaseMatchKey;
  const identity = entry.orderId && !useMatchKey ? `order:${entry.orderId}` : base ? `match:${base}`
    : 'side' in entry && entry.autoBuy ? `id:${entry.autoBuy.pendingId}` : `id:${entry.id}`;
  return `${fundConfirmationKey(entry.symbol)}:${entry.currency.toUpperCase()}:${identity}`;
}

function orderStatus(entry: InvestmentTransactionRecord | PendingInvestmentBuy, item: InvestPositionItem, options: AlipayProjectionOptions): AlipayOrder {
  const key = confirmationOrderKey(entry);
  // A later formal export can add an order number. Keep an earlier unambiguous manual correction.
  const override = options.overrides && key in options.overrides
    ? options.overrides[key] : options.overrides?.[confirmationOrderKey(entry, true)];
  const symbol = canonicalInvestmentSymbol(item.symbol);
  const formal = 'side' in entry;
  const history = options.navs?.[`${symbol}:${pendingFundNavStartDate(entry.operationAt ?? '')?.slice(0, 7)}`];
  const estimate = !formal && history
    ? estimatePendingFundBuy(entry, history, Date.parse(`${options.asOf}T23:59:59+08:00`)) : null;
  const navDate = formal ? entry.autoBuy?.navDate : entry.booking?.navDate ?? estimate?.navDate;
  const shares = formal ? entry.shares : entry.booking?.shares ?? estimate?.shares;
  const price = formal ? entry.price : entry.booking?.price ?? estimate?.price;
  const days = resolveFundConfirmationRule(options.metadata[fundConfirmationKey(symbol)], options.rules?.[fundConfirmationKey(symbol)]);
  const confirmationDate = override?.status === 'confirmed'
    ? (validConfirmationDate(override.date) && override.date >= (entry.operationAt ?? '').slice(0, 10) ? override.date : undefined)
    : estimateConfirmationDate(entry.operationAt ?? '', days, options.holidays, navDate);
  const status = override?.status === 'pending' ? 'pending' : !confirmationDate ? 'review'
    : confirmationDate > options.asOf || !(shares && shares > 0 && price && price > 0) ? 'pending' : 'confirmed';
  return {
    key, itemId: item.id, operationAt: entry.operationAt ?? '', amount: entry.amount,
    currency: entry.currency, confirmationDate: override?.status === 'pending' ? undefined : confirmationDate,
    status, shares, price, navDate, override,
  };
}

type ReplayPosition = { shares: number; costPrice: number; realized: number };
function replay(position: ReplayPosition, transaction: InvestmentTransactionRecord): ReplayPosition | null {
  const { shares, price, fee } = transaction;
  if (!(shares > 0 && price > 0) || !Number.isFinite(shares + price + fee) || fee < 0) return null;
  if (transaction.side === 'sell') {
    if (shares > position.shares + 0.0001) return null;
    return { ...position, shares: round(Math.max(0, position.shares - shares)), realized: position.realized + shares * (price - position.costPrice) - fee };
  }
  const addedCost = transaction.costFromAmount && transaction.amount !== undefined ? transaction.amount : shares * price + fee;
  if (!Number.isFinite(addedCost) || addedCost < 0) return null;
  return { ...position, shares: round(position.shares + shares), costPrice: round((position.shares * position.costPrice + addedCost) / (position.shares + shares)) };
}

/** Pure display projection. Every input snapshot and every ledger object remains untouched. */
export function projectAlipayHoldings(source: InvestPositionItems, options: AlipayProjectionOptions) {
  const items = cloneInvestPositionItems(source);
  const orders: AlipayOrder[] = [];
  const reviewItemIds = new Set<string>();
  const records = [...options.records].filter((record) => record.yearMonth <= options.asOf.slice(0, 7)).sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
  const ledger = [...new Map(records.flatMap((record) => [...(record.investmentTransactions ?? [])]
    .sort(investmentApplicationOrder)).map((transaction) => [transaction.id, transaction])).values()];
  const symbolCounts = new Map<string, number>();
  for (const key of INVEST_POSITION_KEYS) for (const item of items[key] ?? []) {
    if (isConfirmationFund(item)) symbolCounts.set(canonicalInvestmentSymbol(item.symbol), (symbolCounts.get(canonicalInvestmentSymbol(item.symbol)) ?? 0) + 1);
  }

  for (const groupKey of INVEST_POSITION_KEYS) for (let index = 0; index < (items[groupKey]?.length ?? 0); index++) {
    const item = items[groupKey]![index];
    if (!isConfirmationFund(item)) continue;
    const symbol = canonicalInvestmentSymbol(item.symbol);
    const transactions = ledger.filter((transaction) => canonicalInvestmentSymbol(transaction.symbol) === symbol);
    const buys = transactions.filter((transaction) => transaction.side === 'buy');
    const keyed = new Map<string, InvestmentTransactionRecord[]>();
    buys.forEach((transaction) => keyed.set(confirmationOrderKey(transaction), [...(keyed.get(confirmationOrderKey(transaction)) ?? []), transaction]));
    const duplicate = [...keyed.values()].some((entries) => entries.length > 1);
    const transactionOrders = buys.map((transaction) => orderStatus(transaction, item, options));
    const pending = (item.pendingBuys ?? []).filter((entry) => !entry.booking
      && !keyed.has(confirmationOrderKey(entry))
      && buys.filter((transaction) => confirmationOrderKey(transaction, true) === confirmationOrderKey(entry, true)).length !== 1);
    const pendingKeys = pending.map((entry) => confirmationOrderKey(entry));
    const aliases = new Map<string, number>();
    buys.forEach((entry) => {
      const alias = confirmationOrderKey(entry, true);
      aliases.set(alias, (aliases.get(alias) ?? 0) + 1);
    });
    // Several explicit order numbers can share a timestamp. An older correction or
    // pending row without that number cannot safely be assigned to any one of them.
    const ambiguousAlias = pending.some((entry) => (aliases.get(confirmationOrderKey(entry, true)) ?? 0) > 1)
      || buys.some((entry) => {
        const alias = confirmationOrderKey(entry, true);
        return (aliases.get(alias) ?? 0) > 1 && options.overrides?.[alias] != null
          && !(options.overrides && confirmationOrderKey(entry) in options.overrides);
      });
    const ambiguous = duplicate || ambiguousAlias || new Set(pendingKeys).size !== pendingKeys.length || symbolCounts.get(symbol)! > 1;
    const pendingOrders = pending.map((entry) => orderStatus(entry, item, options));
    const itemOrders = [...transactionOrders, ...pendingOrders];
    orders.push(...itemOrders);
    if (ambiguous || !itemOrders.length || itemOrders.some((order) => order.status === 'review')) {
      reviewItemIds.add(item.id);
      if (ambiguous) itemOrders.forEach((order) => { order.status = 'review'; order.ambiguous = true; });
      if (ambiguous || !itemOrders.length) continue;
    }
    const excluded = new Set(buys.filter((transaction, i) => transactionOrders[i].status === 'pending' || transaction.date > options.asOf).map((transaction) => transaction.id));
    const firstExcluded = transactions.findIndex((transaction) => excluded.has(transaction.id));
    let projected: ReplayPosition = { shares: item.shares ?? 0, costPrice: item.costPrice ?? 0, realized: 0 };
    let realizedDelta = 0;
    if (firstExcluded >= 0) {
      let start = firstExcluded;
      let anchor: { shares: number; costPrice: number } | undefined;
      for (; start >= 0; start--) {
        const transaction = transactions[start];
        anchor = transaction.positionBefore ?? (transaction.autoBuy ? { shares: transaction.autoBuy.beforeShares, costPrice: transaction.autoBuy.beforeCostPrice } : undefined);
        if (anchor) break;
      }
      if (!anchor) {
        const beforeMonth = transactions[firstExcluded].date.slice(0, 7);
        const prior = records.filter((record) => record.yearMonth < beforeMonth).at(-1);
        const previous = Object.values(prior?.investPositionItems ?? {}).flat().find((entry) => entry && canonicalInvestmentSymbol(entry.symbol) === symbol);
        if (prior && previous) {
          anchor = { shares: previous.shares ?? 0, costPrice: previous.costPrice ?? 0 };
          start = transactions.findIndex((transaction) => transaction.date.slice(0, 7) > prior.yearMonth);
        }
      }
      if (!anchor || start < 0 || item.shares === undefined || item.costPrice === undefined) {
        reviewItemIds.add(item.id); continue;
      }
      let canonical: ReplayPosition | null = { ...anchor, realized: 0 };
      let visible: ReplayPosition | null = { ...anchor, realized: 0 };
      for (const transaction of transactions.slice(start)) {
        if (canonical) canonical = replay(canonical, transaction);
        if (visible && !excluded.has(transaction.id)) visible = replay(visible, transaction);
      }
      if (!canonical || !visible || Math.abs(canonical.shares - item.shares) > 0.0002
        || Math.abs(canonical.costPrice - item.costPrice) > 0.0002
        || transactions.some((transaction) => transaction.currency.toUpperCase() !== (item.quoteCurrency || item.lastCurrency || 'CNY').toUpperCase())) {
        reviewItemIds.add(item.id); continue;
      }
      projected = visible;
      realizedDelta = visible.realized - canonical.realized;
    }
    // Pending-only imports have no ledger effect yet. Add their estimated shares only to this view.
    let invalidPending = false;
    for (let i = 0; i < pending.length; i++) {
      const order = pendingOrders[i];
      if (order.status !== 'confirmed') continue;
      const entry = pending[i];
      // Appending a delayed estimate behind a later sale would invent an average
      // cost. Wait for a reconciled ledger before projecting that sequence.
      if (transactions.some((transaction) => transaction.side === 'sell'
        && (transaction.operationAt ?? transaction.date) >= entry.operationAt)) {
        order.status = 'review'; reviewItemIds.add(item.id); invalidPending = true; continue;
      }
      const next = replay(projected, { ...entry, date: order.confirmationDate!, side: 'buy', shares: order.shares!, price: order.price!, fee: entry.fee ?? 0, costFromAmount: true });
      if (next) projected = next;
      else { reviewItemIds.add(item.id); invalidPending = true; }
    }
    if (invalidPending) continue;
    if (projected.shares === item.shares && projected.costPrice === item.costPrice && realizedDelta === 0) continue;
    const metric = calculateInvestPositionMetric(item);
    const fx = metric.fxRateToCny ?? metric.profitFxRateToCny;
    const price = metric.price ?? ((item.shares ?? 0) > 0 ? metric.marketValueCny / item.shares! / fx : undefined);
    if (projected.shares > 0 && !(price && price > 0)) { reviewItemIds.add(item.id); continue; }
    items[groupKey]![index] = {
      ...item, shares: projected.shares, costPrice: projected.costPrice,
      status: item.status === 'closed' && projected.shares > 0 ? 'active' : item.status,
      marketValueCny: round(projected.shares * (price ?? 0) * fx, 2),
      holdingProfitCny: round(projected.shares * ((price ?? 0) - projected.costPrice) * fx, 2),
      historicalProfitCny: round(metric.historicalProfitCny / metric.profitFxRateToCny + realizedDelta, 2),
      profitInputMode: 'historical',
    };
  }
  return { items, orders, reviewItemIds };
}
