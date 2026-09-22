import { useEffect, useMemo } from 'react';
import { useMonthlyStore } from '../stores/monthlyStore';
import { canonicalInvestmentSymbol, isPrefixedFundSymbol } from '../utils/investmentInstrument';
import { bookPendingFundBuy } from '../utils/autoFundBuys';
import { estimatePendingFundBuy, fetchPendingFundNavs, pendingFundNavStartDate } from '../utils/pendingFundEstimate';
import { isSyncPaused } from '../utils/syncEngine';
import type { MonthlyRecord } from '../models/types';

function candidates(record: MonthlyRecord | undefined) {
  return Object.values(record?.investPositionItems ?? {}).flatMap((group) => (group ?? []).flatMap((item) =>
    (item.pendingBuys ?? []).flatMap((pending) => {
      const symbol = canonicalInvestmentSymbol(pending.symbol);
      const start = pendingFundNavStartDate(pending.operationAt);
      const isFund = item.quoteSource === 'eastmoney-fund' || isPrefixedFundSymbol(pending.symbol);
      if (pending.booking || !isFund || !/^\d{6}$/.test(symbol) || !start || !(pending.amount && pending.amount > 0)) return [];
      return [{ pending, symbol, month: start.slice(0, 7) }];
    })));
}

function canUpdate() {
  return !document.hidden && !isSyncPaused() && !document.querySelector('.finance-import-preview-shell')
    && !document.activeElement?.matches('input, textarea, select, [contenteditable="true"]');
}

export default function AutoFundBuySync() {
  const records = useMonthlyStore((state) => state.records);
  const yearMonth = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 7);
  const signature = useMemo(() => JSON.stringify(candidates(records.find((record) => record.yearMonth === yearMonth))), [records, yearMonth]);

  useEffect(() => {
    let active = true;
    let running = false;
    const refresh = async () => {
      if (running || !canUpdate()) return;
      running = true;
      try {
        const store = useMonthlyStore.getState();
        const record = store.records.find((entry) => entry.yearMonth === yearMonth);
        const orders = candidates(record);
        if (!orders.length) return;
        const histories = await Promise.all(orders.map(async ({ pending, symbol, month }) => {
          try { return { id: pending.id, symbol, month, bars: await fetchPendingFundNavs(symbol, month) }; }
          catch { return null; }
        }));
        if (!active || !canUpdate()) return;
        // Re-read after network I/O: an import or edit may have replaced the pending orders.
        const latest = useMonthlyStore.getState().records.find((entry) => entry.yearMonth === yearMonth);
        if (!latest) return;
        let next = latest;
        for (const { pending, symbol, month } of candidates(latest)) {
          const history = histories.find((entry) => entry?.id === pending.id && entry.symbol === symbol && entry.month === month);
          if (!history) continue;
          const estimate = estimatePendingFundBuy(pending, history.bars);
          if (estimate) next = bookPendingFundBuy(next, pending.id, estimate);
        }
        if (next !== latest) useMonthlyStore.getState().upsert(next, { investmentSource: 'import' });
      } finally { running = false; }
    };
    const initial = window.setTimeout(() => { void refresh(); }, 250);
    const timer = window.setInterval(() => { void refresh(); }, 60_000);
    const onVisible = () => { void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      active = false;
      window.clearTimeout(initial);
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [signature, yearMonth]);
  return null;
}
