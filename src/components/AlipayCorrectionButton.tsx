import { useEffect, useMemo, useRef, useState } from 'react';
import type { AlipayActualSnapshot, InvestPositionItems, MonthlyRecord } from '../models/types';
import { useMonthlyStore } from '../stores/monthlyStore';
import { useConfigStore } from '../stores/configStore';
import { getAccountStorage } from '../utils/accountCache';
import { useHolidayYears } from '../utils/holidays';
import { fetchAlipayActualNav } from '../utils/alipayActualNav';
import { fetchPendingFundNavs, pendingFundNavStartDate } from '../utils/pendingFundEstimate';
import { applyAlipayYimuCorrection, buildAlipayYimuCorrection, yimuCorrectionSignature, type AlipayCorrectionQuotes } from '../utils/alipayYimuCorrection';
import { isInvestAccumulatedProfitAuto } from '../utils/investRecords';
import { summarizeInvestPositionItems } from '../utils/investPositionItems';
import { triggerUpload } from '../utils/syncEngine';

const value = (n: number | undefined, digits = 4) => n === undefined ? '—' : n.toLocaleString('zh-CN', { maximumFractionDigits: digits });
type Context = { snapshot: AlipayActualSnapshot; items: InvestPositionItems; records: MonthlyRecord[]; signature: string; owner: ReturnType<typeof getAccountStorage> };

function CorrectionDialog({ context, close }: { context: Context; close: () => void }) {
  const { snapshot, items, records } = context;
  const dialog = useRef<HTMLElement>(null);
  const years = useMemo(() => [...new Set([snapshot.date, ...snapshot.orders.filter((order) => order.status === 'pending').map((order) => order.operationAt)]
    .flatMap((date) => [Number(date.slice(0, 4)), Number(date.slice(0, 4)) + 1]))].sort(), [snapshot]);
  const calendar = useHolidayYears(years);
  const [quotes, setQuotes] = useState<AlipayCorrectionQuotes>();
  const [error, setError] = useState('');
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    let active = true;
    const load = async () => {
      const keys = [...new Set(snapshot.orders.filter((order) => order.side === 'buy' && order.status === 'pending' && order.nav === undefined)
        .flatMap((order) => { const date = order.navDate ?? pendingFundNavStartDate(order.operationAt); return date ? [`${order.code}:${date.slice(0, 7)}`] : []; }))];
      const [holdings, orders] = await Promise.all([
        Promise.all(snapshot.funds.filter((fund) => fund.shares === undefined && fund.nav === undefined)
          .map(async (fund) => [fund.code, await fetchAlipayActualNav(fund.code, snapshot.date).catch(() => undefined)] as const)),
        Promise.all(keys.map(async (key) => { const [code, month] = key.split(':'); return { code, month, bars: await fetchPendingFundNavs(code, month).catch(() => undefined) }; })),
      ]);
      if (active) setQuotes({ holdings: Object.fromEntries(holdings), orders: Object.fromEntries(orders.flatMap(({ code, month, bars }) =>
        [...new Set([month, ...(bars ?? []).map((bar) => bar.date.slice(0, 7))])].map((month) => [`${code}:${month}`, bars]))) });
    };
    void load();
    return () => { active = false; };
  }, [snapshot]);
  useEffect(() => {
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key !== 'Tab') return;
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? []);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [close]);
  const holidays = useMemo(() => Object.fromEntries(Object.entries(calendar.holidayDataByYear)
    .filter(([year, data]) => !calendar.unavailableYears.includes(Number(year)) && Object.keys(data).length)), [calendar.holidayDataByYear, calendar.unavailableYears]);
  const loading = !quotes || calendar.holidayLoading;
  const plan = useMemo(() => !loading ? buildAlipayYimuCorrection(snapshot, items, records, holidays, quotes) : undefined, [loading, snapshot, items, records, holidays, quotes]);
  const selected = plan?.rows.filter((row) => !row.reason && !excluded.has(row.code)) ?? [];
  return <div className="alipay-import-backdrop alipay-correction-preview"><section className="alipay-import-dialog" ref={dialog} role="dialog" aria-modal="true" aria-label="矫正一木持仓">
    <header className="alipay-detail-line"><b>矫正一木持仓 · T+1</b><button className="alipay-text-button" type="button" onClick={close}>取消</button></header>
    <div>支付宝实录 · {snapshot.date}</div>
    {loading && <div role="status">核对成交净值和确认日期…</div>}
    {plan?.rows.map((row) => <fieldset key={row.code}>
      <legend><label><input type="checkbox" checked={!row.reason && !excluded.has(row.code)} disabled={!!row.reason}
        onChange={(event) => setExcluded((prior) => { const next = new Set(prior); if (event.target.checked) next.delete(row.code); else next.add(row.code); return next; })} />{row.name}</label></legend>
      {row.reason ? <span className="alipay-import-warning">{row.reason}</span> : <>
        <div className="alipay-detail-line"><span>份额</span><span>{value(row.beforeShares)} → <b>{value(row.shares)}</b></span></div>
        <div className="alipay-detail-line"><span>成本价</span><span>{row.beforeCostPrice?.toFixed(4) ?? '—'} → <b>{row.costPrice?.toFixed(4)}</b></span></div>
        <div className="alipay-detail-line"><span>T+1 补入 ¥{value(row.bridgeAmount, 2)}</span><span>继续待确认 ¥{value(row.deferredAmount, 2)}</span></div>
        {(row.estimated || row.beforeFee) && <span className="alipay-import-warning">{row.beforeFee ? '含费前推算' : '含推算值'}</span>}
      </>}
    </fieldset>)}
    {error && <div role="alert" className="alipay-pending">{error}</div>}
    <button type="button" className="alipay-text-button" disabled={!selected.length || loading} onClick={() => {
      try {
        const config = useConfigStore.getState().config;
        const store = useMonthlyStore.getState();
        if (getAccountStorage() !== context.owner) throw new Error('账号已切换，请重新矫正');
        if (JSON.stringify(config.alipayActualSnapshots?.[snapshot.date]) !== JSON.stringify(snapshot)
          || yimuCorrectionSignature(store.records) !== context.signature) throw new Error('持仓或实录已更新，请重新矫正');
        const current = store.records.find((record) => record.yearMonth === snapshot.date.slice(0, 7));
        if (!current || !plan) throw new Error('请先保存当月一木持仓');
        const corrected = applyAlipayYimuCorrection(current, plan, selected.map((row) => row.code));
        corrected.accumulatedProfit = isInvestAccumulatedProfitAuto(current.yearMonth, config.investAutoSumStartMonth)
          ? summarizeInvestPositionItems(corrected.investPositionItems ?? {}).totalProfitCny : current.accumulatedProfit;
        store.upsert(corrected, { investmentSource: 'manual', replaceInvestmentState: true });
        void triggerUpload(); close();
      } catch (cause) { setError(cause instanceof Error ? cause.message : '矫正失败'); }
    }}>确认矫正{selected.length ? ` ${selected.length} 只基金` : ''}</button>
  </section></div>;
}

export default function AlipayCorrectionButton({ snapshot, items, disabled }: { snapshot?: AlipayActualSnapshot; items: InvestPositionItems; disabled?: boolean }) {
  const [context, setContext] = useState<Context>();
  const button = useRef<HTMLButtonElement>(null);
  const close = useMemo(() => () => { setContext(undefined); button.current?.focus(); }, []);
  return <>
    <button ref={button} type="button" className="alipay-text-button" disabled={!snapshot || disabled} title={!snapshot ? '先导入支付宝实录' : undefined} onClick={() => {
      if (!snapshot) return;
      const records = useMonthlyStore.getState().records;
      setContext({ snapshot: structuredClone(snapshot), items: structuredClone(items), records: structuredClone(records), signature: yimuCorrectionSignature(records), owner: getAccountStorage() });
    }}>矫正</button>
    {context && <CorrectionDialog context={context} close={close} />}
  </>;
}
