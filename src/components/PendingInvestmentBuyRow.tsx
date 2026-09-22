import { useEffect, useState } from 'react';
import type { InvestQuoteSource, PendingInvestmentBuy } from '../models/types';
import { canonicalInvestmentSymbol, isPrefixedFundSymbol } from '../utils/investmentInstrument';
import { estimatePendingFundBuy, fetchPendingFundNavs, pendingFundNavStartDate, type FundNavBar } from '../utils/pendingFundEstimate';

export default function PendingInvestmentBuyRow({ pending, quoteSource }: {
  pending: PendingInvestmentBuy;
  quoteSource?: InvestQuoteSource;
}) {
  const symbol = canonicalInvestmentSymbol(pending.symbol);
  const isFund = /^\d{6}$/.test(symbol) && (quoteSource === 'eastmoney-fund' || isPrefixedFundSymbol(pending.symbol));
  const startDate = pendingFundNavStartDate(pending.operationAt);
  const month = startDate?.slice(0, 7) ?? '';
  const canEstimate = isFund && Boolean(startDate) && Number.isFinite(pending.amount) && (pending.amount ?? 0) > 0;
  const requestKey = canEstimate && !pending.booking ? `${symbol}:${month}` : '';
  const [history, setHistory] = useState<{ key: string; bars?: FundNavBar[]; failed?: boolean }>({ key: '' });

  useEffect(() => {
    if (!requestKey) return;
    let cancelled = false;
    const refresh = async () => {
      if (document.hidden) return;
      try {
        const bars = await fetchPendingFundNavs(symbol, month);
        if (!cancelled) setHistory({ key: requestKey, bars });
      } catch {
        if (!cancelled) setHistory((previous) => ({
          key: requestKey,
          bars: previous.key === requestKey ? previous.bars : undefined,
          failed: true,
        }));
      }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 60_000);
    const onVisible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [requestKey, symbol, month]);

  const current = history.key === requestKey ? history : undefined;
  const estimate = canEstimate && current?.bars ? estimatePendingFundBuy(pending, current.bars) : null;
  const currency = pending.currency === 'CNY' ? '¥' : pending.currency === 'USD' ? '$' : `${pending.currency} `;
  const status = !startDate ? '时间待补' : current?.failed ? '净值暂未获取' : current?.bars ? '净值待出' : '净值查询中';
  if (pending.booking) return null;

  return (
    <div style={{ borderRadius: 7, backgroundColor: '#fff4e5', padding: '5px 7px', color: '#e8710a', fontSize: 10, fontWeight: 700 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '3px 8px' }}>
        <span>待确认 · {pending.operationAt.slice(5, 16).replace('T', ' ')}</span>
        <span style={{ fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>
          {pending.amount ? `${currency}${pending.amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '金额待出'}
          {pending.account ? ` · ${pending.account}` : ''}
        </span>
      </div>
      {isFund && (pending.amount ?? 0) > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '3px 8px', marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>
          {estimate ? <>
            <span>预估{estimate.beforeFee ? '费前份额' : '份额'} {estimate.shares.toFixed(2)}</span>
            <span>净值 {estimate.price.toFixed(4)} · {estimate.navDate.slice(5)}</span>
          </> : <span>{status}</span>}
        </div>
      )}
    </div>
  );
}
