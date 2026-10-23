import type { AlipayActualSnapshot } from '../models/types';
import { useConfigStore } from '../stores/configStore';
import { useMonthlyStore } from '../stores/monthlyStore';
import { getAccountStorage } from './accountCache';
import { parseAlipayActual } from './alipayActual';
import { fetchAlipayActualNav } from './alipayActualNav';
import { applyAlipayYimuCorrection, buildAlipayYimuCorrection, yimuCorrectionSignature, type AlipayCorrectionQuotes } from './alipayYimuCorrection';
import { fetchHolidayYear, type HolidayDataByYear } from './holidays';
import { fetchPendingFundNavs, pendingFundNavStartDate } from './pendingFundEstimate';
import { isInvestAccumulatedProfitAuto } from './investRecords';
import { summarizeInvestPositionItems } from './investPositionItems';
import { runWithSyncPaused, triggerUpload } from './syncEngine';

export async function loadAlipayLedgerInputs(snapshot: AlipayActualSnapshot) {
  const pending = snapshot.orders.filter((order) => order.side === 'buy' && order.status === 'pending');
  const years = [...new Set(pending.flatMap((order) => [snapshot.date, order.operationAt]
    .flatMap((date) => [Number(date.slice(0, 4)), Number(date.slice(0, 4)) + 1])))];
  const keys = [...new Set(pending.filter((order) => order.nav === undefined).flatMap((order) => {
    const date = order.navDate ?? pendingFundNavStartDate(order.operationAt);
    return date ? [`${order.code}:${date.slice(0, 7)}`] : [];
  }))];
  const [calendars, holdings, orders] = await Promise.all([
    Promise.all(years.map(async (year) => [year, await fetchHolidayYear(year)] as const)),
    Promise.all(snapshot.funds.filter((fund) => fund.shares === undefined && fund.nav === undefined)
      .map(async (fund) => [fund.code, await fetchAlipayActualNav(fund.code, snapshot.date).catch(() => undefined)] as const)),
    Promise.all(keys.map(async (key) => {
      const [code, month] = key.split(':');
      return { code, month, bars: await fetchPendingFundNavs(code, month).catch(() => undefined) };
    })),
  ]);
  return {
    holidays: Object.fromEntries(calendars.filter(([, result]) => !result.warning).map(([year, result]) => [year, result.data])) as HolidayDataByYear,
    quotes: { holdings: Object.fromEntries(holdings), orders: Object.fromEntries(orders.flatMap(({ code, month, bars }) =>
      [...new Set([month, ...(bars ?? []).map((bar) => bar.date.slice(0, 7))])].map((month) => [`${code}:${month}`, bars]))) } satisfies AlipayCorrectionQuotes,
  };
}

// Snapshots are import evidence. Both live views always read the monthly ledger.
export async function importAlipaySnapshotToLedger(
  input: AlipayActualSnapshot,
  baseline: string,
  load = loadAlipayLedgerInputs,
) {
  const snapshot = parseAlipayActual(JSON.stringify(input));
  const owner = getAccountStorage();
  const signature = yimuCorrectionSignature(useMonthlyStore.getState().records);
  const { holidays, quotes } = await load(snapshot);
  return runWithSyncPaused(async () => {
    const { config, setConfig } = useConfigStore.getState();
    const store = useMonthlyStore.getState();
    if (owner !== getAccountStorage()) throw new Error('账号已切换，请重新导入');
    if (JSON.stringify(config.alipayActualSnapshots?.[snapshot.date] ?? null) !== baseline
      || yimuCorrectionSignature(store.records) !== signature) throw new Error('持仓已更新，请重新导入');
    const current = store.records.find((record) => record.yearMonth === snapshot.date.slice(0, 7));
    const plan = buildAlipayYimuCorrection(snapshot, current?.investPositionItems ?? {}, store.records, holidays, quotes);
    const ready = plan.rows.filter((row) => !row.reason && row.target && row.groupKey);
    const corrected = current && ready.length ? applyAlipayYimuCorrection(current, plan, ready.map((row) => row.code)) : undefined;
    const beforeConfig = config.alipayActualSnapshots;
    const beforeRecords = store.records;
    try {
      if (corrected && current) {
        corrected.accumulatedProfit = isInvestAccumulatedProfitAuto(current.yearMonth, config.investAutoSumStartMonth)
          ? summarizeInvestPositionItems(corrected.investPositionItems ?? {}).totalProfitCny : current.accumulatedProfit;
        store.upsert(corrected, { investmentSource: 'manual', replaceInvestmentState: true });
      }
      setConfig({ alipayActualSnapshots: { ...beforeConfig, [snapshot.date]: snapshot } });
    } catch (error) {
      useMonthlyStore.setState({ records: beforeRecords });
      setConfig({ alipayActualSnapshots: beforeConfig });
      throw error;
    }
    await triggerUpload();
    const unresolved = plan.rows.filter((row) => row.reason);
    return { updated: ready.length, unresolved, message: [
      ready.length ? `持仓已同步 ${ready.length} 只` : '导入记录已保存',
      ...unresolved.map((row) => `${row.name}：${row.reason}`),
    ].join(' · ') };
  });
}
