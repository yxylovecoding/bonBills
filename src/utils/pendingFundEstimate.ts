import type { PendingInvestmentBuy } from '../models/types';

export interface FundNavBar {
  date: string;
  close: number;
  purchaseStatus: string;
}

export interface PendingFundEstimate {
  navDate: string;
  price: number;
  shares: number;
  beforeFee: boolean;
}

const DAY_MS = 86_400_000;
const CACHE_MS = 15 * 60_000;
const navCache = new Map<string, { expiresAt: number; promise: Promise<FundNavBar[]> }>();

function chinaDate(timestamp: number) {
  return new Date(timestamp + 8 * 3_600_000).toISOString().slice(0, 10);
}

// Import timestamps without a zone are bank-local (Asia/Shanghai), regardless of browser timezone.
export function pendingFundNavStartDate(operationAt: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})?$/.test(operationAt)) return null;
  const day = operationAt.slice(0, 10);
  const midnight = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0, 10) !== day) return null;
  const timestamp = Date.parse(/[Z]|[+-]\d{2}:\d{2}$/.test(operationAt) ? operationAt : `${operationAt}+08:00`);
  if (!Number.isFinite(timestamp)) return null;
  const chinaHour = new Date(timestamp + 8 * 3_600_000).getUTCHours();
  return chinaDate(timestamp + (chinaHour >= 15 ? DAY_MS : 0));
}

export function estimatePendingFundBuy(
  pending: PendingInvestmentBuy,
  bars: FundNavBar[],
  now = Date.now(),
): PendingFundEstimate | null {
  const startDate = pendingFundNavStartDate(pending.operationAt);
  const amount = pending.amount;
  if (!startDate || typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return null;
  const fee = pending.fee;
  if (fee !== undefined && (!Number.isFinite(fee) || fee < 0 || fee >= amount)) return null;
  const today = chinaDate(now);
  const nav = [...bars].sort((a, b) => a.date.localeCompare(b.date)).find((bar) => {
    const weekday = new Date(`${bar.date}T00:00:00Z`).getUTCDay();
    return bar.date >= startDate && bar.date <= today && weekday > 0 && weekday < 6
      && Number.isFinite(bar.close) && bar.close > 0
      && /^(开放申购|限制.*申购|限大额)$/.test(bar.purchaseStatus);
  });
  if (!nav) return null;
  const shares = Math.round(((amount - (fee ?? 0)) / nav.close + Number.EPSILON) * 100) / 100;
  if (!(shares > 0) || !Number.isFinite(shares)) return null;
  return { navDate: nav.date, price: nav.close, shares, beforeFee: fee === undefined };
}

// Only the public fund code and month leave the browser; amounts and bank accounts stay local.
export function fetchPendingFundNavs(symbol: string, month: string): Promise<FundNavBar[]> {
  const key = `${symbol}:${month}`;
  const existing = navCache.get(key);
  if (existing && existing.expiresAt > Date.now()) return existing.promise;
  const entry = {
    expiresAt: Date.now() + CACHE_MS,
    promise: Promise.resolve([] as FundNavBar[]),
  };
  entry.promise = (async () => {
    try {
      const query = new URLSearchParams({ source: 'eastmoney-fund', symbol, navMonth: month });
      const response = await fetch(`/api/market-chart?${query}`, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error('NAV history unavailable');
      const payload = await response.json() as { symbol?: string; startDate?: string; bars?: FundNavBar[] };
      if (payload.symbol !== symbol || payload.startDate !== `${month}-01` || !Array.isArray(payload.bars)) {
        throw new Error('invalid NAV history');
      }
      return payload.bars.filter((bar) => typeof bar.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(bar.date)
        && typeof bar.close === 'number' && Number.isFinite(bar.close) && bar.close > 0
        && typeof bar.purchaseStatus === 'string');
    } catch (error) {
      entry.expiresAt = Date.now() + 60_000;
      throw error;
    }
  })();
  navCache.delete(key);
  navCache.set(key, entry);
  if (navCache.size > 100) navCache.delete(navCache.keys().next().value!);
  return entry.promise;
}
