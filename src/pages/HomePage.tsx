import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import Card from '../components/Card';
import StatRow from '../components/StatRow';
import CurrencyDisplay, { formatCurrency } from '../components/CurrencyDisplay';
import AmountInput from '../components/AmountInput';
import { useSnapshotStore } from '../stores/snapshotStore';
import { useConfigStore } from '../stores/configStore';
import { useMonthlyStore } from '../stores/monthlyStore';
import { useCalendarStore } from '../stores/calendarStore';
import { useBillDetailStore } from '../stores/billDetailStore';
import { useExpenseScopeOverrideStore } from '../stores/expenseScopeOverrideStore';
import { useTripStore } from '../stores/tripStore';
import { calcHistoryStats } from '../calculations/history';
import { calcFire } from '../calculations/fire';
import { tagMeta } from '../data/mockData';
import type { FutureFireExpense, IncomeItem, TagKind, LocalLifeBreakdownRow, MonthlyRecord, SharedLifeBreakdownRow } from '../models/types';
import { useHolidayYears } from '../utils/holidays';
import { dateLabel, daysUntilDate, resolveIncomeForMonth } from '../utils/payroll';
import { TAX_RULE_PRESETS } from '../utils/tax';

import { version as APP_VERSION } from '../../package.json';
// 本版改动概括（≤6 字），随每次迭代更新
const RELEASE_NOTE = '资产进度显示离目标还差多少万';
const C = { blue: '#1a73e8', red: '#ea4335', green: '#0d9488', purple: '#7c3aed', sub: '#5f6368', orange: '#e8710a' };
const DEFAULT_TAX_RULE_TEXT = TAX_RULE_PRESETS[0].text;
const MIN_INVEST_ANNUAL_GROWTH_RATE = -0.99;
const CNY_ASSET_ACCOUNT_KEYS = ['savingsCard', 'incomeBank', 'livingBank', 'campusCard', 'consumptionBank', 'wishJar', 'investCnyBank'] as const;
const USD_ASSET_ACCOUNT_KEYS = ['usdLivingBank', 'usdConsumptionBank', 'usdWishJar', 'investUsdBank'] as const;

type UsdRateResponse = {
  rate: number;
  date?: string;
  source?: string;
};

function fmt万(v: number) { return (v / 10000).toFixed(2) + '万'; }
function fmt年(v: number) { return Number.isInteger(v) ? String(v) : v.toFixed(1); }
function fmtRatio(v: number | null) { return v === null ? '—' : `${v.toFixed(2)}倍`; }
function Divider() { return <div style={{ height: 1, backgroundColor: '#f1f3f4', margin: '8px 0' }} />; }

function prevYearMonth(ym: string): string {
  const [year, month] = ym.split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return '';
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  return `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
}

interface CombinedLifeBreakdownRow {
  category: string;
  amountTotal: number;
  dailyBase: number;
  subcategories: {
    subcategory: string;
    amountTotal: number;
    dailyBase: number;
  }[];
}

function mergeSceneLifeBreakdown(
  localRows: LocalLifeBreakdownRow[],
  sharedRows: SharedLifeBreakdownRow[],
): CombinedLifeBreakdownRow[] {
  const byCategory = new Map<string, CombinedLifeBreakdownRow>();
  const addRow = (row: LocalLifeBreakdownRow | SharedLifeBreakdownRow) => {
    const category = byCategory.get(row.category) ?? {
      category: row.category,
      amountTotal: 0,
      dailyBase: 0,
      subcategories: [],
    };
    category.amountTotal += row.amountTotal;
    category.dailyBase += row.dailyBase;
    for (const sub of row.subcategories) {
      const existing = category.subcategories.find((item) => item.subcategory === sub.subcategory);
      if (existing) {
        existing.amountTotal += sub.amountTotal;
        existing.dailyBase += sub.dailyBase;
      } else {
        category.subcategories.push({ ...sub });
      }
    }
    byCategory.set(row.category, category);
  };

  localRows.forEach(addRow);
  sharedRows.forEach(addRow);
  return [...byCategory.values()]
    .map((row) => ({
      ...row,
      subcategories: row.subcategories.sort((a, b) => b.dailyBase - a.dailyBase),
    }))
    .sort((a, b) => b.dailyBase - a.dailyBase);
}

function FireDetailGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ padding: '10px 0 8px', borderTop: '1px solid #f1f3f4' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#202124', marginBottom: 4 }}>{title}</div>
      {children}
    </div>
  );
}

// ── 趋势图 ────────────────────────────────────────────────────────
function TrendCharts({ records }: { records: MonthlyRecord[] }) {
  const chartData = useMemo(
    () => [...records].reverse().slice(-12).map((r) => ({
      month: r.yearMonth.slice(5),
      收入: r.income,
      支出: r.totalExpense,
      结余: r.income - r.totalExpense,
      周期生活: r.periodicLife,
      波动生活: r.volatileLife,
      消费: r.consumption,
    })),
    [records],
  );
  const tickStyle = { fontSize: 11, fill: C.sub };
  return (
    <>
      <Card title="收支趋势" subtitle="近12月">
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f3f4" />
            <XAxis dataKey="month" tick={tickStyle} />
            <YAxis tick={tickStyle} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
            <Tooltip formatter={(v) => `¥${formatCurrency(Number(v))}`} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="收入" stroke={C.red}   strokeWidth={2}   dot={false} />
            <Line type="monotone" dataKey="支出" stroke={C.green} strokeWidth={2}   dot={false} />
            <Line type="monotone" dataKey="结余" stroke={C.blue}  strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
          </LineChart>
        </ResponsiveContainer>
      </Card>
      <Card title="支出构成" subtitle="近12月堆叠">
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f3f4" />
            <XAxis dataKey="month" tick={tickStyle} />
            <YAxis tick={tickStyle} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
            <Tooltip formatter={(v) => `¥${formatCurrency(Number(v))}`} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="周期生活" stackId="a" fill={C.blue} />
            <Bar dataKey="波动生活" stackId="a" fill="#60a5fa" />
            <Bar dataKey="消费"     stackId="a" fill={C.purple} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </>
  );
}

// ── 主页 ──────────────────────────────────────────────────────────
export default function HomePage() {
  const navigate = useNavigate();
  const { current } = useSnapshotStore();
  const { config, setConfig } = useConfigStore();
  const { records } = useMonthlyStore();
  const { tagMap, confirmedExpenses } = useCalendarStore();
  const { expenseItems } = useBillDetailStore();
  const { overrides: expenseScopeOverrides } = useExpenseScopeOverrideStore();
  const { tripTags } = useTripStore();

  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth();
  const { holidayDataByYear, holidayWarning } = useHolidayYears([currentYear - 1, currentYear]);

  const twoYearsAgo = `${today.getFullYear() - 1}-01`;
  const filteredRecords = useMemo(
    () => records.filter((r) => r.yearMonth >= twoYearsAgo),
    [records, twoYearsAgo],
  );
  const stats = useMemo(
    () => calcHistoryStats(filteredRecords, tagMap, confirmedExpenses, expenseItems, expenseScopeOverrides, tripTags),
    [filteredRecords, tagMap, confirmedExpenses, expenseItems, expenseScopeOverrides, tripTags],
  );

  // 近一年校园卡日均
  const oneYearAgo = `${today.getFullYear() - 1}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const campusDailyAvgYear = useMemo(() => {
    const recent = records.filter((r) => r.yearMonth >= oneYearAgo && (r.schoolDays ?? 0) > 0 && r.school > 0);
    if (recent.length === 0) return 0;
    return recent.reduce((s, r) => s + r.school / (r.schoolDays ?? 1), 0) / recent.length;
  }, [records, oneYearAgo]);

  const totalInvest = Object.values(current.investHoldings).reduce((s, v) => s + v, 0);
  const fallbackUsdRate = useMemo(
    () => [...records].sort((a, b) => b.yearMonth.localeCompare(a.yearMonth))
      .map((r) => r.investProfitComponents?.us?.rate ?? r.investProfitComponents?.usBond?.rate)
      .find((rate) => rate !== undefined && Number.isFinite(rate) && rate > 0) ?? null,
    [records],
  );
  const [remoteUsdRate, setRemoteUsdRate] = useState<UsdRateResponse | null>(null);
  const [usdRateError, setUsdRateError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setUsdRateError(false);
    fetch('/api/usd-rate', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = (await response.json()) as UsdRateResponse;
        if (!Number.isFinite(data.rate) || data.rate <= 0) throw new Error('invalid USD rate');
        setRemoteUsdRate(data);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setUsdRateError(true);
      });
    return () => controller.abort();
  }, []);
  const latestUsdRate = remoteUsdRate?.rate ?? fallbackUsdRate;
  const usdRateSourceLabel = remoteUsdRate
    ? `${remoteUsdRate.source ?? '实时汇率'}${remoteUsdRate.date ? ` · ${remoteUsdRate.date}` : ''}`
    : fallbackUsdRate !== null
      ? `${usdRateError ? '联网失败 · ' : ''}历史汇率`
      : '暂无汇率';
  const fireIncomeAssetStats = useMemo(() => {
    const sortedRecords = [...records].sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));
    const recentRecords = sortedRecords.slice(0, 12);
    const byMonth = new Map(sortedRecords.map((record) => [record.yearMonth, record]));
    const annualIncome = recentRecords.reduce((sum, record) => sum + record.income, 0);
    const passiveIncome = recentRecords.reduce((sum, record) => {
      const prev = byMonth.get(prevYearMonth(record.yearMonth));
      return prev ? sum + record.accumulatedProfit - (prev.accumulatedProfit ?? 0) : sum;
    }, 0);
    const cnyAssets = CNY_ASSET_ACCOUNT_KEYS.reduce((sum, key) => sum + (current.accounts[key] ?? 0), 0);
    const usdAssetsOriginal = USD_ASSET_ACCOUNT_KEYS.reduce((sum, key) => sum + (current.accounts[key] ?? 0), 0);
    const usdAssetsCny = latestUsdRate !== null ? usdAssetsOriginal * latestUsdRate : 0;
    const creditLiability = current.accounts.credit ?? 0;
    const personalNetAssets = cnyAssets + usdAssetsCny + totalInvest - creditLiability;

    return {
      annualIncome,
      passiveIncome,
      personalNetAssets,
      assetIncomeRatio: annualIncome > 0 ? personalNetAssets / annualIncome : null,
      passiveIncomeRatio: annualIncome > 0 ? passiveIncome / annualIncome : null,
      recentMonthCount: recentRecords.length,
      usdAssetsOriginal,
      usdAssetsIncluded: latestUsdRate !== null,
    };
  }, [current.accounts, latestUsdRate, records, totalInvest]);

  // FIRE 模式切换
  const [fireMode, setFireMode] = useState<'life' | 'all'>('all');
  const [fireExpanded, setFireExpanded] = useState(false);
  const [sceneExpanded, setSceneExpanded] = useState<Set<TagKind>>(new Set());
  const [sceneLocalOpenCategories, setSceneLocalOpenCategories] = useState<Set<string>>(new Set());
  const futureFireExpenses = config.futureFireExpenses ?? [];
  const syncFutureFireExpenses = (items: FutureFireExpense[]) => setConfig({ futureFireExpenses: items });
  const activeFutureFireMonthly = futureFireExpenses
    .filter((item) => item.isActive)
    .reduce((sum, item) => sum + item.monthlyAmount, 0);
  const futureLifeAnnualExpense = stats.stateDailyAvg.school * 365 + activeFutureFireMonthly * 12;
  const futureConsumptionAnnualExpense = stats.consumptionAvg * 12;
  const fireAnnualExpense = fireMode === 'life'
    ? futureLifeAnnualExpense
    : futureLifeAnnualExpense + futureConsumptionAnnualExpense;
  const fireExpenseAvg = fireAnnualExpense / 12;
  const fireStats = useMemo(() => ({ ...stats, totalExpenseAvg: fireExpenseAvg }), [stats, fireExpenseAvg]);
  const fire = useMemo(() => calcFire(config, fireStats, totalInvest), [config, fireStats, totalInvest]);
  const customFireTargetYears = config.fireTargetYears && config.fireTargetYears > 0 && config.fireTargetYears < fire.retireYearsLeft
    ? Math.min(config.fireTargetYears, fire.retireYearsLeft)
    : undefined;
  const fireTargetYearOptions = useMemo(() => {
    const base = [1, 3, 5, 10, 15, 20];
    for (let year = 25; year < fire.retireYearsLeft; year += 5) base.push(year);
    if (customFireTargetYears && !base.includes(customFireTargetYears)) base.push(customFireTargetYears);
    return base.filter((year) => year < fire.retireYearsLeft).sort((a, b) => a - b);
  }, [customFireTargetYears, fire.retireYearsLeft]);
  const fireTargetYearSelectValue = customFireTargetYears ? String(customFireTargetYears) : 'retire';
  const fireTargetYearLabel = customFireTargetYears ? `${fmt年(customFireTargetYears)}年` : '退休';
  const updateFireTargetYears = (raw: string) => {
    if (raw === 'retire') {
      setConfig({ fireTargetYears: undefined });
      return;
    }
    setConfig({ fireTargetYears: Math.min(Number(raw), fire.retireYearsLeft) });
  };
  const updateFireGrowthRate = (raw: string) => {
    const parsed = Number(raw);
    const next = Number.isFinite(parsed) ? Math.max(parsed / 100, MIN_INVEST_ANNUAL_GROWTH_RATE) : 0;
    setConfig({ investAnnualGrowthRate: next });
  };
  const toggleScene = (tagKind: TagKind) => {
    setSceneExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(tagKind)) next.delete(tagKind);
      else next.add(tagKind);
      return next;
    });
  };
  const toggleSceneLocalCategory = (categoryKey: string) => {
    setSceneLocalOpenCategories((prev) => {
      const next = new Set(prev);
      if (next.has(categoryKey)) next.delete(categoryKey);
      else next.add(categoryKey);
      return next;
    });
  };

  const updateFutureFireExpense = (id: string, field: keyof FutureFireExpense, raw: string | boolean) => {
    syncFutureFireExpenses(futureFireExpenses.map((item) => {
      if (item.id !== id) return item;
      if (field === 'name') return { ...item, name: String(raw) };
      if (field === 'monthlyAmount') return { ...item, monthlyAmount: parseFloat(String(raw)) || 0 };
      if (field === 'isActive') return { ...item, isActive: Boolean(raw) };
      return item;
    }));
  };
  const addFutureFireExpense = () => syncFutureFireExpenses([
    ...futureFireExpenses,
    { id: `future_fire_${Date.now()}`, name: '租房', monthlyAmount: 0, isActive: true },
  ]);
  const removeFutureFireExpense = (id: string) => syncFutureFireExpenses(futureFireExpenses.filter((item) => item.id !== id));

  // 固定收入编辑
  const [localIncome, setLocalIncome] = useState<IncomeItem[]>(config.incomeItems);
  const syncIncome = (items: IncomeItem[]) => { setLocalIncome(items); setConfig({ incomeItems: items }); };
  const updateIncomeField = (id: string, field: keyof IncomeItem, raw: string) => {
    const items = localIncome.map((item) => {
      if (item.id !== id) return item;
      if (field === 'amount')    return { ...item, amount: parseFloat(raw) || 0 };
      if (field === 'payDay')    { const v = parseInt(raw, 10); return { ...item, payDay: isNaN(v) ? 1 : v }; }
      if (field === 'name')      return { ...item, name: raw };
      if (field === 'dailyRate') return { ...item, dailyRate: parseFloat(raw) || undefined };
      if (field === 'taxRuleText') return { ...item, taxRuleText: raw };
      return item;
    });
    syncIncome(items);
  };
  const toggleTaxRule = (id: string) => {
    const items = localIncome.map((item) => {
      if (item.id !== id) return item;
      if (item.taxRuleText?.trim()) {
        const { taxRuleText: _taxRuleText, ...rest } = item;
        return rest as IncomeItem;
      }
      return { ...item, taxRuleText: DEFAULT_TAX_RULE_TEXT };
    });
    syncIncome(items);
  };
  const setTaxRuleText = (id: string, ruleText: string) => {
    syncIncome(localIncome.map((item) => item.id === id ? { ...item, taxRuleText: ruleText } : item));
  };
  const toggleDailyRate = (id: string) => {
    const items = localIncome.map((item) => {
      if (item.id !== id) return item;
      if (item.dailyRate !== undefined) {
        const { dailyRate: _dr, tagKind: _tk, ...rest } = item;
        return rest as IncomeItem;
      }
      return { ...item, dailyRate: 0, tagKind: 'intern' as TagKind };
    });
    syncIncome(items);
  };
  const addIncomeItem    = () => syncIncome([...localIncome, { id: `income_${Date.now()}`, name: '新收入', amount: 0, payDay: 1, isActive: true }]);
  const removeIncomeItem = (id: string) => syncIncome(localIncome.filter((i) => i.id !== id));

  const resolvedIncomeItems = useMemo(
    () => localIncome.map((item) => resolveIncomeForMonth(item, currentYear, currentMonth, tagMap, holidayDataByYear)),
    [localIncome, currentYear, currentMonth, tagMap, holidayDataByYear],
  );

  // 月度快照
  const monthlySurplus = stats.monthlyIncomeAvg - stats.totalExpenseAvg;
  const sceneDailyRows: { tagKind: TagKind; val: number }[] = (
    ['school', 'intern', 'home', 'travel'] as TagKind[]
  ).map((k) => ({ tagKind: k, val: stats.stateDailyAvg[k] })).filter((r) => r.val > 0);
  const sceneBlocks = (
    [
      { key: 'campus-work', tagKinds: ['school', 'intern'] as TagKind[], bg: '#eff6ff', border: '#bfdbfe' },
      { key: 'home', tagKinds: ['home'] as TagKind[], bg: '#fffbeb', border: '#fde68a' },
      { key: 'travel', tagKinds: ['travel'] as TagKind[], bg: '#fdf2f8', border: '#fbcfe8' },
    ]
  ).map((block) => ({
    ...block,
    rows: block.tagKinds
      .map((tagKind) => ({ tagKind, val: stats.stateDailyAvg[tagKind] }))
      .filter((row) => row.val > 0),
  })).filter((block) => block.rows.length > 0);
  const sceneRangeLabel = filteredRecords.length >= 12
    ? `(近 ${(filteredRecords.length / 12).toFixed(1)} 年)`
    : `(近 ${filteredRecords.length} 个月)`;
  const fireProgressPercent = Math.min(Math.max(fire.progress * 100, 0), 100);
  const fireProgressLabel = `${(fire.progress * 100).toFixed(1)}%`;
  const fireProgressGap = Math.max(fire.fireTarget - totalInvest, 0);

  return (
    <div>
      {/* 页头：标题 + 人生时钟 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', margin: '0 0 16px' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 2px' }}>盘账助手</h1>
          <p style={{ fontSize: 13, color: C.sub, margin: 0 }}>
            {today.getFullYear()}年{today.getMonth() + 1}月 · 第 {today.getDate()} 天
          </p>
          <div style={{ marginTop: 8 }}>
            <button
              type="button"
              onClick={() => navigate('/possessions')}
              style={{ border: 'none', borderRadius: 999, backgroundColor: '#202124', color: '#fff', fontSize: 12, fontWeight: 700, padding: '6px 10px', cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.14)' }}
            >
              📦 物品
            </button>
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 30, fontWeight: 700, fontFamily: 'monospace', color: '#202124', letterSpacing: 1 }}>
            {fire.lifeClockStr}
          </div>
          <div style={{ fontSize: 11, color: C.sub }}>{fire.lifeClockPeriod}</div>
          <div title={`v${APP_VERSION} 本版改动`} style={{ display: 'inline-block', marginTop: 4, fontSize: 10, fontWeight: 500, color: C.blue, backgroundColor: '#e8f0fe', padding: '2px 6px', borderRadius: 6 }}>
            ✨ {RELEASE_NOTE}
          </div>
        </div>
      </div>

      {/* 月度快照 */}
      <Card title="月度快照" subtitle={`近两年均值 · 共 ${records.length} 个月`}>
        <StatRow label="月均收入" value={<CurrencyDisplay value={stats.monthlyIncomeAvg} color={C.red}   kFormat />} />
        <StatRow label="月均支出" value={<CurrencyDisplay value={stats.totalExpenseAvg}  color={C.green} kFormat />} />
        <StatRow label="周期生活" indent value={<CurrencyDisplay value={stats.periodicLifeAvg} color={C.blue} kFormat />} />
        <StatRow label="波动生活" indent value={<CurrencyDisplay value={stats.volatileLifeAvg} color={C.blue} kFormat />} />
        <StatRow label="消费"     indent value={<CurrencyDisplay value={stats.consumptionAvg}  color={C.purple} kFormat />} />
        <Divider />
        <StatRow label="月均结余" value={<CurrencyDisplay value={monthlySurplus} color={monthlySurplus >= 0 ? C.red : C.green} kFormat />} />
        {sceneDailyRows.length > 0 && (
          <>
            <Divider />
            <div style={{ fontSize: 12, color: C.sub, marginBottom: 4 }}>场景日均 {sceneRangeLabel}</div>
            {sceneBlocks.map((block) => (
              <div key={block.key} style={{ backgroundColor: block.bg, border: `1px solid ${block.border}`, borderRadius: 8, marginTop: 6, overflow: 'hidden' }}>
                {block.rows.map((r, idx) => {
                  const m = tagMeta[r.tagKind];
                  const expanded = sceneExpanded.has(r.tagKind);
                  const sharedPct = r.val > 0 ? (stats.sharedLifeDailyBase / r.val) * 100 : 0;
                  const combinedBreakdown = mergeSceneLifeBreakdown(stats.localLifeBreakdown[r.tagKind] ?? [], stats.sharedLifeBreakdown);
                  const combinedBreakdownDaily = combinedBreakdown.reduce((sum, row) => sum + row.dailyBase, 0);
                  const unclassifiedDaily = Math.max(r.val - combinedBreakdownDaily, 0);
                  return (
                    <div key={r.tagKind} style={{ borderTop: idx > 0 ? `1px solid ${block.border}` : 'none' }}>
                      <button
                        type="button"
                        onClick={() => toggleScene(r.tagKind)}
                        style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, padding: '7px 10px', color: 'inherit', background: 'none', border: 'none', cursor: 'pointer' }}
                      >
                        <span style={{ color: C.sub, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0, marginRight: 8 }}>
                          <span style={{ marginRight: 4, fontSize: 10, color: '#9aa0a6' }}>{expanded ? '▼' : '▶'}</span>
                          {m.icon} {m.label}
                          {stats.sharedLifeDailyBase > 0 && (
                            <span style={{ fontSize: 11, color: '#9aa0a6' }}>（共享均摊 {sharedPct.toFixed(1)}%）</span>
                          )}
                        </span>
                        <span style={{ fontWeight: 500, fontVariantNumeric: 'tabular-nums', color: '#202124', flexShrink: 0 }}>¥{formatCurrency(r.val)}/天</span>
                      </button>
                      {expanded && (
                        <div style={{ padding: '4px 10px 8px', borderTop: '1px dashed #dadce0' }}>
                          {combinedBreakdown.map((row) => {
                            const pct = r.val > 0 ? (row.dailyBase / r.val) * 100 : 0;
                            const categoryKey = `${r.tagKind}|${row.category}`;
                            const categoryOpen = sceneLocalOpenCategories.has(categoryKey);
                            const hasSubBreakdown = row.subcategories.length > 0;
                            return (
                              <div key={row.category}>
                                <button
                                  type="button"
                                  onClick={() => hasSubBreakdown && toggleSceneLocalCategory(categoryKey)}
                                  style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, padding: '3px 0', color: '#3c4043', background: 'none', border: 'none', cursor: hasSubBreakdown ? 'pointer' : 'default' }}
                                >
                                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0, marginRight: 8, textAlign: 'left' }}>
                                    {hasSubBreakdown && (
                                      <span style={{ marginRight: 4, fontSize: 9, color: '#9aa0a6' }}>{categoryOpen ? '▼' : '▶'}</span>
                                    )}
                                    {row.category} <span style={{ color: '#9aa0a6' }}>· {pct.toFixed(1)}%</span>
                                  </span>
                                  <span style={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0, color: C.sub }}>¥{row.dailyBase.toFixed(2)}/天</span>
                                </button>
                                {categoryOpen && hasSubBreakdown && (
                                  <div style={{ padding: '0 0 3px 14px' }}>
                                    {row.subcategories.map((sub) => {
                                      const subPct = row.dailyBase > 0 ? (sub.dailyBase / row.dailyBase) * 100 : 0;
                                      return (
                                        <div key={sub.subcategory} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, padding: '2px 0', color: '#5f6368' }}>
                                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0, marginRight: 8 }}>
                                            {sub.subcategory} <span style={{ color: '#9aa0a6' }}>· {subPct.toFixed(1)}%</span>
                                          </span>
                                          <span style={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>¥{sub.dailyBase.toFixed(2)}/天</span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          {unclassifiedDaily > 0.005 && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '3px 0', color: '#3c4043' }}>
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0, marginRight: 8 }}>
                                未拆分估算 <span style={{ color: '#9aa0a6' }}>· {((unclassifiedDaily / r.val) * 100).toFixed(1)}%</span>
                              </span>
                              <span style={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0, color: C.sub }}>¥{unclassifiedDaily.toFixed(2)}/天</span>
                            </div>
                          )}
                          {r.tagKind === 'school' && campusDailyAvgYear > 0 && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '3px 0', color: '#3c4043' }}>
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0, marginRight: 8 }}>
                                🍜 校园卡日均 <span style={{ color: '#9aa0a6' }}>(近一年 · 已含)</span>
                              </span>
                              <span style={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0, color: C.sub }}>¥{campusDailyAvgYear.toFixed(2)}/天</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </>
        )}
      </Card>

      {/* 收支趋势 + 支出构成 */}
      <TrendCharts records={records} />

      {/* FIRE */}
      <section style={{ backgroundColor: '#fff', borderRadius: 16, padding: '18px 20px', marginBottom: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
          <button
            onClick={() => setFireExpanded((v) => !v)}
            style={{ display: 'flex', alignItems: 'center', gap: 7, border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', color: '#202124', userSelect: 'none' }}
          >
            <span style={{ fontSize: 15, fontWeight: 700 }}>FIRE</span>
            <span style={{ fontSize: 11, color: C.sub, transform: fireExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', display: 'inline-block' }}>▼</span>
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', backgroundColor: '#f1f3f4', borderRadius: 999, padding: 2, gap: 2 }} onClick={(e) => e.stopPropagation()}>
              {(['life', 'all'] as const).map((mode) => {
                const active = fireMode === mode;
                return (
                  <button key={mode} onClick={() => setFireMode(mode)} style={{ minWidth: 42, padding: '4px 10px', borderRadius: 999, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, backgroundColor: active ? '#fff' : 'transparent', color: active ? C.blue : C.sub, boxShadow: active ? '0 1px 2px rgba(0,0,0,0.12)' : 'none', transition: 'all 0.15s' }}>
                    {mode === 'life' ? '活' : '生活'}
                  </button>
                );
              })}
            </div>
            <select
              value={fireTargetYearSelectValue}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => updateFireTargetYears(e.target.value)}
              style={{ border: '1px solid #e0e0e0', borderRadius: 999, backgroundColor: '#fff', color: '#202124', fontSize: 12, fontWeight: 700, padding: '5px 8px', outline: 'none', cursor: 'pointer' }}
            >
              <option value="retire">退休</option>
              {fireTargetYearOptions.map((year) => (
                <option key={year} value={year}>{fmt年(year)}年</option>
              ))}
            </select>
          </div>
        </div>
        <div onClick={() => setFireExpanded((v) => !v)} style={{ cursor: 'pointer', userSelect: 'none' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 180, flex: '1 1 180px' }}>
              <div style={{ fontSize: 12, color: C.sub, marginBottom: 3 }}>最低税前年薪</div>
              <div style={{ fontSize: 32, lineHeight: 1.05, fontWeight: 800, color: C.red, fontVariantNumeric: 'tabular-nums' }}>{fmt万(fire.requiredAnnualGrossIncome)}</div>
              <div style={{ marginTop: 5, fontSize: 12, color: C.sub }}>{fireTargetYearLabel}达标 · 税后年需 {fmt万(fire.requiredAnnualNetIncome)}</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, flex: '1 1 230px', minWidth: 0 }}>
              {[
                { label: '目标年数', value: `${fmt年(fire.targetYears)}年`, color: '#202124' },
                { label: '完成进度', value: fireProgressLabel, color: C.blue },
                { label: '月需存入', value: fmt万(fire.monthlyNeeded), color: C.orange },
              ].map((item) => (
                <div key={item.label} style={{ backgroundColor: '#f8f9fa', border: '1px solid #f1f3f4', borderRadius: 10, padding: '8px 10px', minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: C.sub, marginBottom: 3, whiteSpace: 'nowrap' }}>{item.label}</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: item.color, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.value}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ marginTop: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: C.sub, marginBottom: 6 }}>
              <span>资产进度{fireProgressGap > 0 && <span style={{ marginLeft: 6, color: C.orange, fontVariantNumeric: 'tabular-nums' }}>还需 {fmt万(fireProgressGap)}</span>}</span>
              <span style={{ fontWeight: 700, color: C.blue, fontVariantNumeric: 'tabular-nums' }}>{fireProgressLabel}</span>
            </div>
            <div style={{ height: 8, backgroundColor: '#edf2f7', borderRadius: 999, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${fireProgressPercent}%`, backgroundColor: C.blue, borderRadius: 999, transition: 'width 0.3s' }} />
            </div>
          </div>
        </div>
        {fireExpanded && (
          <div style={{ marginTop: 16 }}>
            <FireDetailGroup title="收入资产">
              <StatRow label="个人资产/年收入" value={<span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: C.blue }}>{fmtRatio(fireIncomeAssetStats.assetIncomeRatio)}</span>} />
              <StatRow label="被动收入/年收入" value={<span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: fireIncomeAssetStats.passiveIncome >= 0 ? C.green : C.red }}>{fmtRatio(fireIncomeAssetStats.passiveIncomeRatio)}</span>} />
              <StatRow label={`近一年年收入${fireIncomeAssetStats.recentMonthCount < 12 ? ` · ${fireIncomeAssetStats.recentMonthCount}月` : ''}`} value={<span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>{fmt万(fireIncomeAssetStats.annualIncome)}</span>} />
              <StatRow label="近一年被动收入" value={<span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500, color: fireIncomeAssetStats.passiveIncome >= 0 ? C.green : C.red }}>{fmt万(fireIncomeAssetStats.passiveIncome)}</span>} />
              <StatRow
                label={(
                  <span>
                    个人净资产
                    {fireIncomeAssetStats.usdAssetsOriginal !== 0 && (
                      <span style={{ fontSize: 11, color: C.sub }}> · {fireIncomeAssetStats.usdAssetsIncluded ? usdRateSourceLabel : '未含美元'}</span>
                    )}
                  </span>
                )}
                value={<span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>{fmt万(fireIncomeAssetStats.personalNetAssets)}</span>}
              />
            </FireDetailGroup>
            <FireDetailGroup title="支出口径">
              <StatRow label="生活年支出" value={<span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500, color: C.blue }}>{fmt万(futureLifeAnnualExpense)}</span>} />
              <StatRow label="消费年支出" value={<span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500, color: C.purple }}>{fmt万(futureConsumptionAnnualExpense)}</span>} />
              <StatRow label="未来固定支出" value={<span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500, color: C.orange }}>{fmt万(activeFutureFireMonthly * 12)}</span>} />
            </FireDetailGroup>
            <FireDetailGroup title="资产目标">
              <StatRow label="目标资产" value={<span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>{fmt万(fire.fireTarget)}</span>} />
              <StatRow label="理财总额" value={<span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500, color: C.blue }}>{fmt万(totalInvest)}</span>} />
              <StatRow label="年理财增长" value={(
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={(fire.investAnnualGrowthRate * 100).toFixed(1).replace(/\.0$/, '')}
                    onChange={(e) => updateFireGrowthRate(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onFocus={(e) => e.target.select()}
                    style={{ width: 52, border: 'none', borderBottom: '1px solid #dadce0', outline: 'none', backgroundColor: 'transparent', fontSize: 13, fontWeight: 600, color: C.blue, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
                  />
                  <span style={{ fontSize: 12, color: C.sub }}>%</span>
                </span>
              )} />
              <StatRow label="到期现有资产" value={<span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500, color: fire.projectedInvestmentGrowth >= 0 ? C.green : C.red }}>{fmt万(fire.projectedCurrentInvest)}</span>} />
              <StatRow label="目标年数" value={<span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>{fmt年(fire.targetYears)}年 · 最晚{fmt年(fire.retireYearsLeft)}年</span>} />
            </FireDetailGroup>
            <FireDetailGroup title="收入需求">
              <StatRow label="月需存入" value={<span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500, color: C.orange }}>{fmt万(fire.monthlyNeeded)}</span>} />
              <StatRow label="估算月结余" value={<span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500, color: fire.monthlySurplus >= 0 ? C.green : C.red }}>{fmt万(fire.monthlySurplus)}</span>} />
              <StatRow label="税后年需" value={<span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>{fmt万(fire.requiredAnnualNetIncome)}</span>} />
              <StatRow label="预估个税" value={<span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500, color: C.orange }}>{fmt万(fire.requiredAnnualTax)} · 分段最高{(fire.requiredMarginalTaxRate * 100).toFixed(0)}%</span>} />
            </FireDetailGroup>
            <div style={{ paddingTop: 10, borderTop: '1px solid #f1f3f4' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#202124' }}>未来固定支出</span>
                <button onClick={addFutureFireExpense} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 999, border: 'none', backgroundColor: '#e8f0fe', color: C.blue, cursor: 'pointer', fontWeight: 600 }}>
                  + 添加
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {futureFireExpenses.length === 0 && (
                  <div style={{ fontSize: 12, color: C.sub, backgroundColor: '#f8f9fa', borderRadius: 8, padding: '8px 10px' }}>
                    暂无未来固定支出
                  </div>
                )}
                {futureFireExpenses.map((item) => (
                  <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 6, backgroundColor: item.isActive ? '#f8f9fa' : '#fff', border: `1px solid ${item.isActive ? '#e0e0e0' : '#f1f3f4'}`, borderRadius: 10, padding: '7px 8px' }}>
                    <button onClick={() => updateFutureFireExpense(item.id, 'isActive', !item.isActive)} style={{ flexShrink: 0, width: 16, height: 16, borderRadius: '50%', border: `2px solid ${item.isActive ? C.green : '#dadce0'}`, backgroundColor: item.isActive ? C.green : '#fff', cursor: 'pointer' }} />
                    <input
                      value={item.name}
                      onChange={(e) => updateFutureFireExpense(item.id, 'name', e.target.value)}
                      style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', backgroundColor: 'transparent', fontSize: 12, fontWeight: 600, color: item.isActive ? '#202124' : '#9aa0a6' }}
                    />
                    <span style={{ fontSize: 11, color: C.sub }}>¥</span>
                    <AmountInput
                      value={String(item.monthlyAmount || '')}
                      onFocus={(e) => e.target.select()}
                      onChange={(v) => updateFutureFireExpense(item.id, 'monthlyAmount', /^-?0\d/.test(v) ? (v.replace(/^(-?)0+/, '$1') || '0') : v)}
                      style={{ width: 72, border: 'none', borderBottom: '1px solid #dadce0', outline: 'none', backgroundColor: 'transparent', fontSize: 12, fontWeight: 600, color: C.orange, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
                    />
                    <span style={{ fontSize: 11, color: C.sub }}>/月</span>
                    <button onClick={() => removeFutureFireExpense(item.id)} style={{ flexShrink: 0, background: 'none', border: 'none', color: '#dadce0', fontSize: 16, cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}>×</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* 收入管理 */}
      <Card title="收入管理" subtitle="支持固定、日薪和扣税规则" collapsible defaultCollapsed>
        {holidayWarning && (
          <div style={{ marginBottom: 10, fontSize: 12, color: C.orange, backgroundColor: '#fff4e8', border: '1px solid #fed7aa', borderRadius: 10, padding: '8px 10px' }}>
            {holidayWarning}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {resolvedIncomeItems.map((item) => {
            const isDailyMode = item.dailyRate !== undefined;
            const hasTaxRule = Boolean(item.taxRuleText?.trim());
            const daysToNext = daysUntilDate(item.resolvedPayDate, today);
            const isPending = daysToNext >= 0 && daysToNext <= 3;
            const payrollCycle = item.payrollCycle;
            return (
              <div key={item.id} style={{ backgroundColor: isPending ? '#e6f4ea' : '#f8f9fa', borderRadius: 12, padding: '10px 12px', border: `1.5px solid ${isPending ? '#81c995' : '#e0e0e0'}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <button onClick={() => syncIncome(localIncome.map((x) => x.id === item.id ? { ...x, isActive: !x.isActive } : x))} style={{ flexShrink: 0, width: 18, height: 18, borderRadius: '50%', border: `2px solid ${item.isActive ? C.green : '#dadce0'}`, backgroundColor: item.isActive ? C.green : '#fff', cursor: 'pointer' }} />
                  <input value={item.name} onChange={(e) => updateIncomeField(item.id, 'name', e.target.value)} style={{ flex: 1, border: 'none', outline: 'none', backgroundColor: 'transparent', fontSize: 13, fontWeight: 600, color: item.isActive ? '#202124' : '#9aa0a6', minWidth: 0 }} />
                  <button onClick={() => toggleDailyRate(item.id)} style={{ flexShrink: 0, fontSize: 11, padding: '2px 8px', borderRadius: 6, border: `1px solid ${isDailyMode ? C.orange : '#dadce0'}`, backgroundColor: isDailyMode ? '#fff4e8' : '#f1f3f4', color: isDailyMode ? C.orange : C.sub, cursor: 'pointer', fontWeight: 600 }}>
                    {isDailyMode ? '日薪' : '固定'}
                  </button>
                  <button onClick={() => toggleTaxRule(item.id)} style={{ flexShrink: 0, fontSize: 11, padding: '2px 8px', borderRadius: 6, border: `1px solid ${hasTaxRule ? C.red : '#dadce0'}`, backgroundColor: hasTaxRule ? '#fce8e6' : '#f1f3f4', color: hasTaxRule ? C.red : C.sub, cursor: 'pointer', fontWeight: 600 }}>
                    扣税
                  </button>
                  <button onClick={() => removeIncomeItem(item.id)} style={{ flexShrink: 0, background: 'none', border: 'none', color: '#dadce0', fontSize: 16, cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}>×</button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  {item.isInternPayroll && payrollCycle ? (
                    <>
                      <span style={{ fontSize: 11, color: C.sub }}>最后一个工作日发薪</span>
                      <span style={{ fontSize: 11, color: C.blue, fontWeight: 600 }}>{dateLabel(payrollCycle.payDate)}</span>
                      <span style={{ fontSize: 11, color: C.sub }}>截止</span>
                      <span style={{ fontSize: 11, color: C.orange, fontWeight: 600 }}>{dateLabel(payrollCycle.cutoffDate)}</span>
                      <span style={{ fontSize: 11, color: C.sub }}>
                        区间 {dateLabel(payrollCycle.periodStartExclusive)} 后至 {dateLabel(payrollCycle.periodEndInclusive)}
                      </span>
                      <span style={{ flex: 1 }} />
                    </>
                  ) : (
                    <>
                      <span style={{ fontSize: 11, color: C.sub }}>每月</span>
                      <input type="number" inputMode="numeric" value={item.payDay === 0 ? '' : item.payDay} placeholder={item.payDay === 0 ? '末' : ''}
                        onChange={(e) => updateIncomeField(item.id, 'payDay', e.target.value || '0')}
                        onFocus={(e) => e.target.select()}
                        style={{ width: 36, border: 'none', borderBottom: '1px solid #dadce0', outline: 'none', backgroundColor: 'transparent', fontSize: 13, fontWeight: 600, color: C.blue, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}
                      />
                      <span style={{ fontSize: 11, color: C.sub }}>{item.payDay === 0 ? '月底发薪' : '号发薪'}</span>
                      <button onClick={() => updateIncomeField(item.id, 'payDay', item.payDay === 0 ? '1' : '0')} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 6, border: `1px solid ${item.payDay === 0 ? C.blue : '#dadce0'}`, backgroundColor: item.payDay === 0 ? '#e8f0fe' : '#f1f3f4', color: item.payDay === 0 ? C.blue : C.sub, cursor: 'pointer' }}>
                        月底
                      </button>
                      <span style={{ flex: 1 }} />
                    </>
                  )}
                  {isDailyMode ? (
                    <>
                      <span style={{ fontSize: 11, color: C.sub }}>¥</span>
                      <AmountInput value={String(item.dailyRate ?? 0)} onFocus={(e) => e.target.select()}
                        onChange={(v) => updateIncomeField(item.id, 'dailyRate', /^-?0\d/.test(v) ? (v.replace(/^(-?)0+/, '$1') || '0') : v)}
                        style={{ width: 60, border: 'none', borderBottom: '1px solid #dadce0', outline: 'none', backgroundColor: 'transparent', fontSize: 13, fontWeight: 600, color: C.orange, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
                      />
                      <span style={{ fontSize: 11, color: C.sub }}>/天 × {item.resolvedDayCount ?? 0}天</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: C.green, fontVariantNumeric: 'tabular-nums' }}>= ¥{formatCurrency(item.grossAmount)}</span>
                    </>
                  ) : (
                    <>
                      <span style={{ fontSize: 11, color: C.sub }}>¥</span>
                      <AmountInput value={String(item.amount ?? '')} onFocus={(e) => e.target.select()}
                        onChange={(v) => updateIncomeField(item.id, 'amount', /^-?0\d/.test(v) ? (v.replace(/^(-?)0+/, '$1') || '0') : v)}
                        style={{ width: 80, border: 'none', outline: 'none', backgroundColor: 'transparent', fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: C.green, textAlign: 'right' }}
                      />
                    </>
                  )}
                </div>
                {hasTaxRule && (
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {TAX_RULE_PRESETS.map((preset) => {
                        const active = item.taxRuleText === preset.text;
                        return (
                          <button
                            key={preset.key}
                            onClick={() => setTaxRuleText(item.id, preset.text)}
                            style={{ fontSize: 11, padding: '3px 8px', borderRadius: 999, border: `1px solid ${active ? C.red : '#dadce0'}`, backgroundColor: active ? '#fce8e6' : '#fff', color: active ? C.red : C.sub, cursor: 'pointer', fontWeight: 600 }}
                          >
                            {preset.label}
                          </button>
                        );
                      })}
                      <button
                        onClick={() => setTaxRuleText(item.id, item.taxRuleText?.trim() ? item.taxRuleText : '税=')}
                        style={{ fontSize: 11, padding: '3px 8px', borderRadius: 999, border: `1px solid ${TAX_RULE_PRESETS.some((preset) => preset.text === item.taxRuleText) ? '#dadce0' : C.blue}`, backgroundColor: TAX_RULE_PRESETS.some((preset) => preset.text === item.taxRuleText) ? '#fff' : '#e8f0fe', color: TAX_RULE_PRESETS.some((preset) => preset.text === item.taxRuleText) ? C.sub : C.blue, cursor: 'pointer', fontWeight: 600 }}
                      >
                        自定义
                      </button>
                    </div>
                    <input
                      value={item.taxRuleText ?? ''}
                      onChange={(e) => updateIncomeField(item.id, 'taxRuleText', e.target.value)}
                      placeholder="例：税=(0.8x-5000)*20%；税=(0.8*收入-5000)*0.2"
                      style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #fad2cf', borderRadius: 8, outline: 'none', backgroundColor: '#fff', fontSize: 12, color: '#202124', padding: '6px 8px' }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 11 }}>
                      <span style={{ color: item.taxRuleError ? C.red : C.sub }}>
                        {item.taxRuleError ?? item.taxRuleSummary ?? '已启用扣税'}
                      </span>
                      <span style={{ color: C.sub, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                        税前 ¥{formatCurrency(item.grossAmount)} - 税 ¥{formatCurrency(item.taxAmount)} = 到手 ¥{formatCurrency(item.resolvedAmount)}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {resolvedIncomeItems.filter((i) => i.isActive).map((item) => {
          const daysToNext = daysUntilDate(item.resolvedPayDate, today);
          if (daysToNext < 0 || daysToNext > 3) return null;
          const payInfo = item.isInternPayroll && item.payrollCycle
            ? `最后一个工作日 ${dateLabel(item.payrollCycle.payDate)} 发薪，截止 ${dateLabel(item.payrollCycle.cutoffDate)}`
            : `每月 ${item.payDay === 0 ? '月底' : `${Number(item.resolvedPayDate.slice(8, 10))}号`}`;
          return (
            <div key={item.id} style={{ marginTop: 8, fontSize: 13, color: '#0d9488', backgroundColor: '#e6f4ea', border: '1px solid #81c995', borderRadius: 10, padding: '8px 12px' }}>
              💰 {item.name} {daysToNext === 0 ? '今天发薪' : `还有 ${daysToNext} 天发薪`}（{payInfo}，¥{formatCurrency(item.resolvedAmount)}）
            </div>
          );
        })}
        <button onClick={addIncomeItem} style={{ width: '100%', marginTop: 10, padding: '8px 0', fontSize: 13, color: C.blue, backgroundColor: '#e8f0fe', border: 'none', borderRadius: 10, cursor: 'pointer', fontWeight: 600 }}>
          + 添加收入项
        </button>
      </Card>

      <div style={{ textAlign: 'center', fontSize: 11, color: '#bdc1c6', padding: '8px 0 4px' }}>
        盘账助手 v{APP_VERSION}
      </div>
    </div>
  );
}
