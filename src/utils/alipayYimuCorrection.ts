import type { AlipayActualOrder, AlipayActualSnapshot, InvestKey, InvestPositionItem, InvestPositionItems, InvestmentTransactionRecord, MonthlyRecord, PendingInvestmentBuy } from '../models/types';
import type { HolidayDataByYear } from './holidays';
import type { FundNavBar } from './pendingFundEstimate';
import type { AlipayActualNav } from './alipayActualNav';
import { pendingFundNavStartDate } from './pendingFundEstimate';
import { alipayActualBasis } from './alipayActual';
import { chinaToday, estimateConfirmationDate, isConfirmationFund, validConfirmationDate } from './alipayHoldings';
import { canonicalInvestmentSymbol } from './investmentInstrument';
import { calculateInvestPositionMetric, syncInvestPositionItems, summarizeInvestPositionItems } from './investPositionItems';
import { cloneInvestPositionItems, nextInvestmentApplicationOrder } from './investmentRollover';

const round = (n: number, digits = 4) => Math.round((n + Number.EPSILON) * 10 ** digits) / 10 ** digits;
const money = (n: number) => round(n, 2);
const codeOf = (item: { symbol: string }) => canonicalInvestmentSymbol(item.symbol);
const realOrderId = (order: AlipayActualOrder) => /^\d{15,40}$/.test(order.id) ? order.id : undefined;
const matchOrder = (order: AlipayActualOrder, entry: InvestmentTransactionRecord | PendingInvestmentBuy, dateOnly = false) => {
  if (codeOf(entry) !== order.code || entry.currency.toUpperCase() !== 'CNY') return false;
  if ('side' in entry && entry.side !== order.side) return false;
  if (realOrderId(order) && entry.orderId) return realOrderId(order) === entry.orderId;
  return (dateOnly ? entry.operationAt?.slice(0, 10) === order.operationAt.slice(0, 10) : entry.operationAt === order.operationAt) && order.unit === 'CNY'
    && entry.amount !== undefined && Math.abs(entry.amount - order.quantity) < 0.005;
};
const matchingEntries = <T extends InvestmentTransactionRecord | PendingInvestmentBuy>(order: AlipayActualOrder, entries: T[]) => {
  const exact = entries.filter((entry) => matchOrder(order, entry));
  return exact.length ? exact : entries.filter((entry) => matchOrder(order, entry, true));
};

function tradeDate(order: AlipayActualOrder, holidays: HolidayDataByYear) {
  let date = order.navDate ?? pendingFundNavStartDate(order.operationAt);
  if (!date || !validConfirmationDate(date)) return undefined;
  const earliest = pendingFundNavStartDate(order.operationAt);
  if (!earliest || date < earliest) return undefined;
  for (let i = 0; i < 370; i++) {
    if (!holidays[Number(date.slice(0, 4))]) return undefined;
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (weekday > 0 && weekday < 6 && !holidays[Number(date.slice(0, 4))][date]?.isOffDay) return date;
    if (order.navDate) return undefined;
    date = new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  }
  return undefined;
}

export interface AlipayYimuCorrectionRow {
  code: string; name: string; groupKey?: InvestKey; itemId?: string; reason?: string;
  beforeShares?: number; beforeCostPrice?: number; shares?: number; costPrice?: number;
  bridgeAmount: number; deferredAmount: number; estimated: boolean; beforeFee: boolean;
  target?: InvestPositionItem;
  bridges: InvestmentTransactionRecord[];
}
export interface AlipayYimuCorrectionPlan { date: string; rows: AlipayYimuCorrectionRow[] }
export interface AlipayCorrectionQuotes {
  holdings?: Record<string, AlipayActualNav | undefined>;
  orders?: Record<string, FundNavBar[] | undefined>; // public code:month histories
}

/** The screenshot is a balance anchor. Add only buys already due under Yimu's T+1 rule. */
export function buildAlipayYimuCorrection(
  snapshot: AlipayActualSnapshot, items: InvestPositionItems, records: MonthlyRecord[],
  holidays: HolidayDataByYear, quotes: AlipayCorrectionQuotes = {},
): AlipayYimuCorrectionPlan {
  const ledger = [...new Map(records.flatMap((record) => record.investmentTransactions ?? []).map((entry) => [entry.id, entry])).values()];
  const rows = snapshot.funds.map((fund): AlipayYimuCorrectionRow => {
    const row: AlipayYimuCorrectionRow = { code: fund.code, name: fund.name, bridgeAmount: 0, deferredAmount: 0, estimated: false, beforeFee: false, bridges: [] };
    const fail = (reason: string) => ({ ...row, reason, target: undefined, bridges: [] });
    const matches = Object.entries(items).flatMap(([key, group]) => key === 'account' || key === 'aggregate' ? []
      : (group ?? []).filter((item) => isConfirmationFund(item) && codeOf(item) === fund.code).map((item) => ({ key: key as InvestKey, item })));
    if (matches.length !== 1) return fail('一木基金未唯一匹配');
    const { key: groupKey, item } = matches[0];
    Object.assign(row, { groupKey, itemId: item.id, beforeShares: item.shares, beforeCostPrice: item.costPrice });
    if (!['CNY', 'CNH'].includes((item.quoteCurrency || item.lastCurrency || 'CNY').toUpperCase())) return fail('持仓币种待核对');
    const local = ledger.filter((entry) => codeOf(entry) === fund.code);
    if (local.some((entry) => entry.date > snapshot.date || (entry.operationAt?.slice(0, 10) ?? entry.date) > snapshot.date)) return fail('存在晚于实录的交易，请更新支付宝数据');
    if (item.alipayCorrection && item.alipayCorrection.date > snapshot.date) return fail('已有更新日期的矫正');
    const fundOrders = snapshot.orders.filter((entry) => entry.code === fund.code);
    const seen = new Map<string, AlipayActualOrder>();
    for (const order of fundOrders) {
      if (seen.has(order.id) && JSON.stringify(seen.get(order.id)) !== JSON.stringify(order)) return fail('同一订单内容冲突');
      seen.set(order.id, order);
    }
    const orders = [...seen.values()];
    if (orders.some((order) => order.status === 'unknown')) return fail('交易状态待核对');
    const pending = orders.filter((order) => order.status === 'pending');
    if (pending.some((order) => order.unit !== 'CNY')) return fail('待确认交易金额待补充');
    const buys = pending.filter((order) => order.side === 'buy').sort((a, b) => a.operationAt.localeCompare(b.operationAt) || a.id.localeCompare(b.id));
    const bookings = new Map(buys.map((order) => [order.id, matchingEntries(order, local)]));
    const matchedIds = [...bookings.values()].flat().map((entry) => entry.id);
    if ([...bookings.values()].some((entries) => entries.length > 1) || new Set(matchedIds).size !== matchedIds.length) return fail('同日同金额订单需核对编号');
    if (fund.pendingBuyAmount !== undefined && Math.abs(fund.pendingBuyAmount - buys.reduce((sum, order) => sum + order.quantity, 0)) > 0.015) return fail('待确认买入记录不完整');
    if (pending.some((order) => order.side === 'sell') && (fund.shares === undefined || fund.confirmedAmount === undefined)) return fail('赎回中，请补充含份额和持有金额的详情页');
    const basis = alipayActualBasis(fund, items, orders, quotes.holdings?.[fund.code]);
    if (basis.shares === null || basis.costPrice === null || basis.costTotal === null || basis.confirmedAmount === null) return fail('份额、成本或对应净值待补充');
    if (fund.amountKind === 'total' && Math.abs(basis.confirmedAmount + basis.pendingBuy + basis.pendingSell - fund.totalAmount) > 0.03) return fail('持有金额与在途金额不一致');
    if (basis.nav !== null && Math.abs(basis.shares * basis.nav - basis.confirmedAmount) > Math.max(0.03, basis.nav * 0.006)) return fail('份额与金额对应的净值不一致');
    let shares = basis.shares;
    let cost = basis.costTotal;
    row.estimated = basis.sharesEstimated || basis.costPriceEstimated;
    const deferred: PendingInvestmentBuy[] = [];
    const bridgedPending: PendingInvestmentBuy[] = [];
    const referenceIds = local.filter((entry) => !matchedIds.includes(entry.id)).map((entry) => entry.id);
    for (const order of buys) {
      if (!(order.quantity > 0) || !Number.isFinite(order.quantity)) return fail('交易金额待核对');
      const navDate = tradeDate(order, holidays);
      const confirmation = navDate && estimateConfirmationDate(order.operationAt, 1, holidays, navDate);
      if (!navDate || !confirmation) return fail('T+1 日期待核对，节假日资料或成交日暂缺');
      const booked = bookings.get(order.id)!;
      const pendingMatches = matchingEntries(order, item.pendingBuys ?? []);
      if (booked.length > 1 || pendingMatches.length > 1) return fail('同时间同金额订单需核对编号');
      const oldPending = pendingMatches[0];
      const pendingId = oldPending?.id ?? `alipay:${order.id}`;
      const formal = booked[0] && (!booked[0].autoBuy || booked[0].autoBuy.status === 'reconciled');
      const fee = order.fee ?? (formal || booked[0] && !booked[0].autoBuy?.beforeFee ? booked[0].fee : oldPending?.fee);
      const nextPending: PendingInvestmentBuy = {
        id: pendingId, orderId: realOrderId(order) ?? oldPending?.orderId ?? booked[0]?.orderId,
        ledgerTransactionId: formal ? booked[0].id : oldPending?.ledgerTransactionId,
        matchKey: oldPending?.matchKey ?? booked[0]?.pendingMatchKey ?? `alipay:${order.id}`,
        baseMatchKey: oldPending?.baseMatchKey ?? booked[0]?.pendingBaseMatchKey ?? `alipay:${fund.code}:${order.operationAt}`,
        operationAt: order.operationAt, amount: order.quantity, fee, name: fund.name, symbol: fund.code, groupKey,
        currency: 'CNY', account: oldPending?.account ?? booked[0]?.account, notBefore: confirmation,
      };
      if (confirmation > snapshot.date) { deferred.push(nextPending); row.deferredAmount = money(row.deferredAmount + order.quantity); continue; }
      if (local.some((entry) => entry.side === 'sell' && (entry.operationAt ?? entry.date) >= order.operationAt)) return fail('待确认买入后发生卖出，请核对成交记录');
      const history = quotes.orders?.[`${fund.code}:${navDate.slice(0, 7)}`];
      const nav = order.nav ?? (formal || booked[0]?.autoBuy?.navDate === navDate ? booked[0].price : undefined)
        ?? history?.find((bar) => bar.date === navDate)?.close;
      if (!(nav && nav > 0 && Number.isFinite(nav))) return fail(`${navDate} 成交净值暂缺`);
      if (fee !== undefined && (!Number.isFinite(fee) || fee < 0 || fee >= order.quantity)) return fail('交易手续费待核对');
      const addedShares = order.confirmedShares ?? (formal || booked[0] && !booked[0].autoBuy?.beforeFee ? booked[0].shares : undefined)
        ?? round((order.quantity - (fee ?? 0)) / nav, 2);
      if (!(addedShares > 0) || !Number.isFinite(addedShares)) return fail('买入份额待核对');
      const beforeFee = fee === undefined && order.confirmedShares === undefined;
      row.beforeFee ||= beforeFee;
      row.estimated ||= order.confirmedShares === undefined && (!booked[0] || !!booked[0].autoBuy);
      const transactionId = booked[0]?.id ?? `auto-invest:${pendingId}`;
      const before = { shares, costPrice: shares > 0 ? round(cost / shares) : 0 };
      const bridge: InvestmentTransactionRecord = {
        id: transactionId, date: confirmation < `${snapshot.date.slice(0, 7)}-01` ? `${snapshot.date.slice(0, 7)}-01` : confirmation,
        side: 'buy', name: fund.name, symbol: fund.code, groupKey, shares: addedShares, price: nav, fee: fee ?? 0,
        currency: 'CNY', quoteSource: 'eastmoney-fund', operationAt: order.operationAt, occurredAt: order.operationAt,
        orderId: nextPending.orderId, amount: order.quantity, costFromAmount: true, account: nextPending.account,
        pendingMatchKey: nextPending.matchKey, pendingBaseMatchKey: nextPending.baseMatchKey,
        positionBefore: before, applicationOrder: nextInvestmentApplicationOrder(ledger) + row.bridges.length,
        autoBuy: { pendingId, status: formal ? 'reconciled' : 'estimated', navDate, beforeFee, beforeShares: before.shares, beforeCostPrice: before.costPrice,
          previousTransactionIds: [...new Set([...referenceIds, ...row.bridges.map((entry) => entry.id)])], alipayAsOf: snapshot.date },
      };
      // Moving an existing prior-month booking would leave two ledger owners.
      if (booked[0] && records.some((record) => record.yearMonth !== snapshot.date.slice(0, 7) && record.investmentTransactions?.some((entry) => entry.id === booked[0].id))) return fail('跨月预估订单需先完成正式确认');
      row.bridges.push(bridge);
      bridgedPending.push({ ...nextPending, booking: { transactionId, date: bridge.date, navDate, shares: addedShares, price: nav, beforeFee } });
      shares = round(shares + addedShares); cost = money(cost + order.quantity);
      row.bridgeAmount = money(row.bridgeAmount + order.quantity);
    }
    const costPrice = row.bridges.length ? (shares > 0 ? round(cost / shares) : 0) : round(basis.costPrice);
    const metric = calculateInvestPositionMetric(item);
    // The imported balance is the new anchor; a cached ledger quote must not
    // overwrite its amount/profit as soon as the imported shares and cost are saved.
    const price = basis.nav ?? (basis.shares > 0 ? basis.confirmedAmount / basis.shares : undefined) ?? metric.price;
    const marketValueCny = money(basis.confirmedAmount + (shares - basis.shares) * (price ?? 0));
    const holdingProfitCny = money(fund.holdingProfit + (shares - basis.shares) * (price ?? 0) - row.bridgeAmount);
    const preservedPending = (item.pendingBuys ?? []).filter((order) => order.operationAt.slice(0, 10) > snapshot.date);
    const target: InvestPositionItem = { ...item, shares, costPrice, status: shares > 0 ? 'active' : 'paused',
      historicalProfitCny: money(metric.historicalProfitCny / metric.profitFxRateToCny), profitInputMode: 'historical',
      historicalProfitCurrency: 'CNY', quoteCurrency: 'CNY', lastCurrency: 'CNY', lastFxRateToCny: 1,
      lastPrice: price ?? undefined, quoteAt: basis.navDate ?? snapshot.date,
      marketValueCny, holdingProfitCny,
      pendingBuys: [...preservedPending, ...deferred, ...bridgedPending],
      alipayCorrection: { date: snapshot.date, deferredBuys: deferred.map((entry) => ({ operationAt: entry.operationAt, amount: entry.amount!, orderId: entry.orderId })),
        ...(price === undefined ? {} : { valuation: { shares, costPrice, price, marketValueCny, holdingProfitCny } }) },
    };
    return { ...row, shares, costPrice, target };
  });
  return { date: snapshot.date, rows };
}

export function applyAlipayYimuCorrection(record: MonthlyRecord, plan: AlipayYimuCorrectionPlan, codes: string[], now = Date.now()) {
  if (plan.date.slice(0, 7) !== record.yearMonth || !validConfirmationDate(plan.date) || plan.date > chinaToday(now)) throw new Error('矫正日期与当前月份不一致');
  const selected = plan.rows.filter((row) => codes.includes(row.code));
  if (!selected.length || selected.some((row) => row.reason || !row.target || !row.groupKey)) throw new Error('请只选择资料完整的基金');
  const items = cloneInvestPositionItems(record.investPositionItems);
  let transactions = [...(record.investmentTransactions ?? [])];
  for (const row of selected) {
    const index = (items[row.groupKey!] ?? []).findIndex((item) => item.id === row.itemId && codeOf(item) === row.code);
    if (index < 0) throw new Error('一木持仓已变化，请重新矫正');
    items[row.groupKey!]![index] = row.target!;
    transactions = transactions.filter((entry) => !(entry.autoBuy?.status === 'estimated' && codeOf(entry) === row.code && entry.side === 'buy'
      && row.target!.pendingBuys?.some((pending) => !pending.booking && pending.operationAt.slice(0, 10) <= plan.date
        && (pending.orderId && entry.orderId ? pending.orderId === entry.orderId
          : pending.operationAt === entry.operationAt && pending.amount === entry.amount))));
    const bridges = new Map(row.bridges.map((entry) => [entry.id, entry]));
    transactions = transactions.map((entry) => codeOf(entry) !== row.code ? entry : bridges.get(entry.id) ?? { ...entry, autoBuy: undefined });
    const ids = new Set(transactions.map((entry) => entry.id));
    transactions.push(...row.bridges.filter((entry) => !ids.has(entry.id)));
  }
  const updated = syncInvestPositionItems(record, items);
  // Keep historical profits, but update the auto-summed cumulative profit by the holding-profit change.
  const before = summarizeInvestPositionItems(record.investPositionItems ?? {}).totalProfitCny;
  const after = summarizeInvestPositionItems(items).totalProfitCny;
  return { ...updated, accumulatedProfit: money(record.accumulatedProfit + after - before), investmentTransactions: transactions,
    investmentEditedAt: new Date(now).toISOString(), investmentRolledOverFrom: undefined,
    investmentInheritanceRevision: (record.investmentInheritanceRevision ?? 0) + 1 };
}

export function yimuCorrectionSignature(records: MonthlyRecord[]) {
  return JSON.stringify(records.map((record) => ({ month: record.yearMonth, transactions: record.investmentTransactions,
    items: Object.entries(record.investPositionItems ?? {}).map(([key, group]) => [key, group?.map((item) => ({
      id: item.id, symbol: item.symbol, quoteSource: item.quoteSource, quoteCurrency: item.quoteCurrency, status: item.status,
      shares: item.shares, costPrice: item.costPrice, historicalProfitCny: item.historicalProfitCny, profitInputMode: item.profitInputMode,
      pendingBuys: item.pendingBuys, alipayCorrection: item.alipayCorrection,
    }))]),
  })));
}
