import { useEffect, useMemo, useState } from 'react';
import type { InvestPositionItems, MonthlyRecord } from '../models/types';
import { useConfigStore } from '../stores/configStore';
import { useHolidayYears, type HolidayDataByYear } from '../utils/holidays';
import { canonicalInvestmentSymbol } from '../utils/investmentInstrument';
import { chinaToday, fundConfirmationKey, holdingsAsOf, isConfirmationFund, projectAlipayHoldings, type FundMetadata } from '../utils/alipayHoldings';
import { fetchPendingFundNavs, pendingFundNavStartDate, type FundNavBar } from '../utils/pendingFundEstimate';

// Public instrument metadata only; no account or order data enters this shared cache.
const fundCache = new Map<string, { expires: number; promise: Promise<FundMetadata | undefined> }>();
export function fetchConfirmationFundMetadata(symbol: string): Promise<FundMetadata | undefined> {
  const cached = fundCache.get(symbol);
  if (cached && cached.expires > Date.now()) return cached.promise;
  const entry = { expires: Date.now() + 86_400_000, promise: Promise.resolve<FundMetadata | undefined>(undefined) };
  entry.promise = (async () => {
    try {
      const response = await fetch(`/api/market-search?q=${encodeURIComponent(symbol)}`, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error('fund metadata unavailable');
      const payload = await response.json() as { results?: Array<{ symbol: string; source: string; name: string; type: string }> };
      const match = payload.results?.find((result) => result.source === 'eastmoney-fund' && result.symbol === symbol);
      if (!match || typeof match.name !== 'string' || typeof match.type !== 'string') throw new Error('fund not matched');
      return { name: match.name, type: match.type };
    } catch {
      entry.expires = Date.now() + 60_000;
      return undefined;
    }
  })();
  fundCache.set(symbol, entry);
  if (fundCache.size > 200) fundCache.delete(fundCache.keys().next().value!);
  return entry.promise;
}

export function useAlipayHoldings(items: InvestPositionItems, previousItems: InvestPositionItems | undefined, records: MonthlyRecord[], yearMonth: string, previousMonth?: string) {
  const config = useConfigStore((state) => state.config);
  const [today, setToday] = useState(chinaToday);
  const [metadata, setMetadata] = useState<Record<string, FundMetadata | undefined>>({});
  const [navs, setNavs] = useState<Record<string, FundNavBar[] | undefined>>({});
  const asOf = holdingsAsOf(yearMonth, today);
  const targets = useMemo(() => {
    const funds = Object.values(items).concat(Object.values(previousItems ?? {})).flat().filter((item) => item && isConfirmationFund(item));
    const symbols = [...new Set(funds.map((item) => canonicalInvestmentSymbol(item!.symbol)))].sort();
    const pendingMonths = [...new Set(funds.flatMap((item) => (item!.pendingBuys ?? []).flatMap((pending) => {
      const start = pendingFundNavStartDate(pending.operationAt);
      return !pending.booking && start ? [`${canonicalInvestmentSymbol(item!.symbol)}:${start.slice(0, 7)}`] : [];
    })))].sort();
    return { symbols, pendingMonths };
  }, [items, previousItems]);
  const signature = JSON.stringify(targets);
  const years = useMemo(() => {
    const dates = records.filter((record) => record.yearMonth <= yearMonth).flatMap((record) =>
      (record.investmentTransactions ?? []).filter((transaction) => targets.symbols.includes(canonicalInvestmentSymbol(transaction.symbol)))
        .flatMap((transaction) => [transaction.operationAt, transaction.autoBuy?.navDate, transaction.date]));
    const result = new Set([Number(asOf.slice(0, 4)), Number(previousMonth?.slice(0, 4) ?? asOf.slice(0, 4))]);
    for (const date of [...dates, ...targets.pendingMonths.map((key) => key.split(':')[1])]) {
      const year = Number(date?.slice(0, 4));
      if (year >= 1900 && year <= 2099) { result.add(year); if (date?.slice(5, 7) === '12') result.add(year + 1); }
    }
    return [...result].sort();
  }, [records, yearMonth, asOf, previousMonth, signature]);
  const { holidayDataByYear, unavailableYears } = useHolidayYears(years);
  const holidays = useMemo<HolidayDataByYear>(() => Object.fromEntries(
    Object.entries(holidayDataByYear).filter(([year, data]) => !unavailableYears.includes(Number(year)) && Object.keys(data).length > 0),
  ), [holidayDataByYear, unavailableYears]);

  useEffect(() => {
    let active = true;
    let running = false;
    const { symbols, pendingMonths } = JSON.parse(signature) as typeof targets;
    const refresh = async () => {
      if (document.hidden || running) return;
      running = true;
      setToday(chinaToday());
      try {
        const [funds, histories] = await Promise.all([
          Promise.all(symbols.map(async (symbol) => [fundConfirmationKey(symbol), await fetchConfirmationFundMetadata(symbol)] as const)),
          Promise.all(pendingMonths.map(async (key) => {
            const [symbol, month] = key.split(':');
            try { return [key, await fetchPendingFundNavs(symbol, month)] as const; }
            catch { return [key, undefined] as const; }
          })),
        ]);
        if (active) { setMetadata(Object.fromEntries(funds)); setNavs(Object.fromEntries(histories)); }
      } finally { running = false; }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 60_000);
    const onVisible = () => { void refresh(); };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [signature]);

  const options = useMemo(() => ({
    asOf, records, holidays, metadata, navs,
    rules: config.fundConfirmationRules, overrides: config.fundConfirmationOverrides,
  }), [asOf, records, holidays, metadata, navs, config.fundConfirmationRules, config.fundConfirmationOverrides]);
  const current = useMemo(() => projectAlipayHoldings(items, options), [items, options]);
  const previous = useMemo(() => previousItems && previousMonth
    ? projectAlipayHoldings(previousItems, { ...options, asOf: holdingsAsOf(previousMonth, today) }) : undefined,
  [previousItems, previousMonth, options, today]);
  return { ...current, previous, metadata, asOf };
}
