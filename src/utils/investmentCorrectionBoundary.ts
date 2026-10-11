import type { InvestPositionItem, InvestmentTransactionRecord, PendingInvestmentBuy } from '../models/types';

/** A corrected balance already includes older trades. Deferred T+1 buys are the exception. */
export function coveredByAlipayCorrection(item: InvestPositionItem, entry: InvestmentTransactionRecord | PendingInvestmentBuy) {
  const boundary = item.alipayCorrection;
  if (!boundary) return false;
  const operationAt = entry.operationAt;
  const date = 'side' in entry ? entry.date : entry.operationAt.slice(0, 10);
  if (!date || date > boundary.date || (operationAt && operationAt.slice(0, 10) > boundary.date)) return false;
  const buy = !('side' in entry) || entry.side === 'buy';
  return !buy || !boundary.deferredBuys.some((order) => order.orderId && entry.orderId
    ? order.orderId === entry.orderId
    : order.operationAt === operationAt && entry.amount !== undefined && Math.abs(order.amount - entry.amount) < 0.005);
}
