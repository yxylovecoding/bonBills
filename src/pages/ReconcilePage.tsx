import { Fragment, useEffect, useState, useMemo, useRef, type PointerEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../components/Card';
import { formatCurrency } from '../components/CurrencyDisplay';
import AmountInput from '../components/AmountInput';

const fmtInt = (v: number) => Math.round(v).toLocaleString('zh-CN');
import { useSnapshotStore } from '../stores/snapshotStore';
import { DEFAULT_CONFIG, useConfigStore } from '../stores/configStore';
import { useMonthlyStore } from '../stores/monthlyStore';
import { useCalendarStore } from '../stores/calendarStore';
import { useBillDetailStore } from '../stores/billDetailStore';
import { useExpenseScopeOverrideStore } from '../stores/expenseScopeOverrideStore';
import { useTripStore } from '../stores/tripStore';
import { usePrefsStore } from '../stores/prefsStore';
import { calcBudget } from '../calculations/budget';
import { calcHistoryStats } from '../calculations/history';
import { calcRebalance } from '../calculations/rebalance';
import { investMeta, tagMeta } from '../data/mockData';
import type { AccountSnapshot, DailyTag, InvestAllocTargets, InvestKey, TagKind, UsStockHoldingItem } from '../models/types';
import { useHolidayYears } from '../utils/holidays';
import { normalizeDecimalPunctuation, sanitizeDecimalNumberInput } from '../utils/numberInput';
import { tryEvalFormula } from '../utils/formula';
import { dateLabel, resolveIncomeForMonth, type ResolvedIncomeItem } from '../utils/payroll';
import { getCategoryProfit } from '../utils/investRecords';
import {
  buildDramDecision,
  normalizeDramDecisionConfig,
  type DramDecisionKind,
  type MarketChartResponse,
} from '../utils/dramDecision';

const C = { blue: '#1a73e8', red: '#ea4335', green: '#0d9488', sub: '#5f6368', orange: '#e8710a' };
const RESERVABLE_HOLDING_KEY: InvestKey = 'longBond';
const LONG_BOND_PRIORITY_FLOOR = 10000; // 加仓时长债总额优先补到此下限
const INVEST_TARGET_KEYS: InvestKey[] = ['us', 'eu', 'asia', 'a', 'longBond', 'usBond', 'gold'];
const USD_INVEST_KEYS: InvestKey[] = ['us', 'usBond'];
const USD_VIRTUAL_ACCOUNT_KEYS = ['usdLivingBank', 'usdConsumptionBank', 'usdWishJar', 'investUsdBank'] as const;
const EMPTY_US_STOCK_ITEMS: UsStockHoldingItem[] = [];
type UsdVirtualAccountKey = typeof USD_VIRTUAL_ACCOUNT_KEYS[number];
const USD_REPLACE_BUCKETS: {
  usdKey: UsdVirtualAccountKey;
  cnyKey: keyof AccountSnapshot['accounts'];
  label: string;
}[] = [
  { usdKey: 'usdLivingBank', cnyKey: 'livingBank', label: '生活' },
  { usdKey: 'usdConsumptionBank', cnyKey: 'consumptionBank', label: '消费' },
  { usdKey: 'usdWishJar', cnyKey: 'wishJar', label: '心愿' },
];
type RebalanceFundingBucket = typeof USD_REPLACE_BUCKETS[number] & {
  amountCny: number;
};
// 配平转账的腿币种标注：cny/usd=假置换同步对敲、无手续费；forex=真换汇、有手续费
type FundingBadgeKind = 'cny' | 'usd' | 'forex';

const INVEST_GROUPS = [
  { key: 'stock', label: '股', keys: ['us', 'eu', 'asia', 'a'] as InvestKey[], color: C.blue },
  { key: 'bond', label: '债', keys: ['longBond', 'usBond'] as InvestKey[], color: C.green },
  { key: 'commodity', label: '商', keys: ['gold'] as InvestKey[], color: C.orange },
] as const;
type InvestGroupKey = typeof INVEST_GROUPS[number]['key'];
type GroupedTargetInputs = {
  groups: Record<InvestGroupKey, string>;
  assets: Record<InvestKey, string>;
};
type UsStockItemInput = {
  id: string;
  name: string;
  symbol: string;
  amountCny: string;
  shares: string;
  costPrice: string;
};
type UsdRateResponse = {
  rate: number;
  date: string;
  source: string;
};

const parseAmountPart = (raw: string | undefined) => {
  const value = raw?.trim() ?? '';
  if (!value) return 0;
  const evaluated = tryEvalFormula(value);
  const parsed = parseFloat(evaluated ?? value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeAmountInput = (v: string) => {
  const normalized = normalizeDecimalPunctuation(v);
  return /^-?0\d/.test(normalized) ? (normalized.replace(/^(-?)0+/, '$1') || '0') : normalized;
};
const fmtUsd = (value: number) => {
  const abs = Math.abs(value);
  const body = abs >= 100 ? Math.round(abs).toLocaleString('zh-CN') : abs.toFixed(2);
  return `${value > 0 ? '+' : value < 0 ? '-' : ''}$${body}`;
};
const fmtDollar = (value: number) => `$${value >= 100 ? Math.round(value).toLocaleString('zh-CN') : value.toFixed(2)}`;
const fmtPct = (value: number | null, digits = 1) => value === null ? '—' : `${(value * 100).toFixed(digits)}%`;
const roundMoney = (value: number) => Math.round(value * 100) / 100;
const latestMarketBar = (chart: MarketChartResponse | null | undefined) => {
  const bars = chart?.bars?.filter((bar) => Number.isFinite(Number(bar.adjClose ?? bar.close))) ?? [];
  return bars.length > 0 ? bars[bars.length - 1] : null;
};
const usStockCostAmountCny = (item: UsStockItemInput, usdRate: number | null) => {
  if (usdRate === null) return null;
  const shares = item.shares.trim() ? Math.max(0, parseAmountPart(item.shares)) : 0;
  const costPrice = item.costPrice.trim() ? Math.max(0, parseAmountPart(item.costPrice)) : 0;
  return shares > 0 && costPrice > 0 ? roundMoney(shares * costPrice * usdRate) : null;
};
const isSpyUsStockInput = (item: UsStockItemInput) =>
  item.symbol.trim().toUpperCase() === 'SPY' || item.name.trim() === '标普';
const syncSpyUsStockAmount = (items: UsStockItemInput[], usTotalCny: number) => {
  const spyIndex = items.findIndex(isSpyUsStockInput);
  if (spyIndex < 0) return items;
  const nonSpyTotal = items.reduce((sum, item, index) => (
    index === spyIndex || isSpyUsStockInput(item) ? sum : sum + Math.max(0, parseAmountPart(item.amountCny))
  ), 0);
  let usedSpy = false;
  const spyAmount = String(roundMoney(Math.max(0, usTotalCny - nonSpyTotal)));
  return items.map((item) => {
    if (!isSpyUsStockInput(item)) return item;
    if (usedSpy) return { ...item, amountCny: '0' };
    usedSpy = true;
    return { ...item, amountCny: spyAmount };
  });
};
const effectiveInvestTargets = (targets: InvestAllocTargets) =>
  INVEST_TARGET_KEYS.some((k) => (targets[k] ?? 0) > 0) ? targets : DEFAULT_CONFIG.investAllocTargets;
const fmtPctInput = (value: number) => String(Math.round(value * 100) / 100);
const groupedTargetInputFromConfig = (targets: InvestAllocTargets): GroupedTargetInputs => {
  const groups = {} as Record<InvestGroupKey, string>;
  const assets = {} as Record<InvestKey, string>;
  for (const group of INVEST_GROUPS) {
    const groupTotal = group.keys.reduce((sum, k) => sum + (targets[k] ?? 0) * 100, 0);
    groups[group.key] = fmtPctInput(groupTotal);
    for (const k of group.keys) {
      assets[k] = groupTotal > 0 ? fmtPctInput(((targets[k] ?? 0) * 100 / groupTotal) * 100) : '0';
    }
  }
  return { groups, assets };
};
const groupedTargetInputsToConfig = (inputs: GroupedTargetInputs): InvestAllocTargets =>
  Object.fromEntries(INVEST_TARGET_KEYS.map((k) => {
    const group = INVEST_GROUPS.find((g) => g.keys.includes(k))!;
    const groupPct = parseFloat(inputs.groups[group.key]) || 0;
    const assetPct = parseFloat(inputs.assets[k]) || 0;
    return [k, (groupPct / 100) * (assetPct / 100)];
  })) as unknown as InvestAllocTargets;
const usStockInputsFromItems = (items: UsStockHoldingItem[]): UsStockItemInput[] =>
  items.map((item) => ({
    id: item.id,
    name: item.name,
    symbol: item.symbol,
    amountCny: String(item.amountCny ?? 0),
    shares: item.shares !== undefined ? String(item.shares) : '',
    costPrice: item.costPrice !== undefined ? String(item.costPrice) : '',
  }));

function RebalanceSettingsModal({
  groupedTargetInputs,
  setGroupedTargetInputs,
  onRevealConsumptionWish,
  onHideConsumptionWish,
  onClose,
  onSave,
}: {
  groupedTargetInputs: GroupedTargetInputs;
  setGroupedTargetInputs: (v: GroupedTargetInputs) => void;
  onRevealConsumptionWish: () => void;
  onHideConsumptionWish: () => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const total = INVEST_GROUPS.reduce((sum, group) => sum + (parseFloat(groupedTargetInputs.groups[group.key]) || 0), 0);
  const totalOk = Math.abs(total - 100) < 0.01;
  const setGroupInput = (group: InvestGroupKey, value: string) =>
    setGroupedTargetInputs({ ...groupedTargetInputs, groups: { ...groupedTargetInputs.groups, [group]: value } });
  const setAssetInput = (key: InvestKey, value: string) =>
    setGroupedTargetInputs({ ...groupedTargetInputs, assets: { ...groupedTargetInputs.assets, [key]: value } });

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.3)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={onClose}>
      <div style={{ backgroundColor: '#fff', borderRadius: 16, width: '100%', maxWidth: 380, boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}
        onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: '20px 20px 12px' }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>再平衡设置</div>
        </div>
        <div style={{ padding: '0 20px 4px' }}>
          <div style={{ border: '1px solid #f1f3f4', borderRadius: 10, padding: '9px 10px', backgroundColor: '#fafafa', marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#202124' }}>账户显示</div>
                <div style={{ fontSize: 11, color: C.sub, marginTop: 2 }}>消费、心愿美元为 0 时默认隐藏</div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button
                  type="button"
                  onClick={onRevealConsumptionWish}
                  style={{ border: 'none', borderRadius: 8, padding: '7px 10px', backgroundColor: '#e8f0fe', color: C.blue, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
                >
                  开启录入
                </button>
                <button
                  type="button"
                  onClick={onHideConsumptionWish}
                  style={{ border: 'none', borderRadius: 8, padding: '7px 10px', backgroundColor: '#f1f3f4', color: C.sub, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#202124' }}>大类目标比例</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: totalOk ? C.green : C.orange }}>
              合计 {total.toFixed(2)}%
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {INVEST_GROUPS.map((group) => {
              const groupTotal = parseFloat(groupedTargetInputs.groups[group.key]) || 0;
              const assetTotal = group.keys.reduce((sum, k) => sum + (parseFloat(groupedTargetInputs.assets[k]) || 0), 0);
              const remaining = 100 - assetTotal;
              const remainingOk = Math.abs(remaining) < 0.01;
              return (
                <div key={group.key} style={{ border: '1px solid #f1f3f4', borderRadius: 10, padding: '9px 10px', backgroundColor: '#fff' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: group.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#202124' }}>{group.label}</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={groupedTargetInputs.groups[group.key]}
                      onChange={(e) => {
                        const next = sanitizeDecimalNumberInput(e.target.value);
                        if (next !== null) setGroupInput(group.key, next);
                      }}
                      onFocus={(e) => e.target.select()}
                      style={{ marginLeft: 'auto', width: 58, border: 'none', borderBottom: '1px solid #dadce0', outline: 'none', backgroundColor: 'transparent', fontSize: 13, fontWeight: 700, textAlign: 'right', color: '#202124', fontVariantNumeric: 'tabular-nums' }}
                    />
                    <span style={{ fontSize: 11, color: C.sub }}>%</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    {group.keys.map((k) => (
                      <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, backgroundColor: '#f8f9fa', borderRadius: 8, padding: '6px 8px' }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: investMeta[k].color, flexShrink: 0 }} />
                        <span style={{ flex: 1, fontSize: 12, color: C.sub, whiteSpace: 'nowrap' }}>{investMeta[k].label}</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={groupedTargetInputs.assets[k]}
                          onChange={(e) => {
                            const next = sanitizeDecimalNumberInput(e.target.value);
                            if (next !== null) setAssetInput(k, next);
                          }}
                          onFocus={(e) => e.target.select()}
                          style={{ width: 48, border: 'none', borderBottom: '1px solid #dadce0', outline: 'none', backgroundColor: 'transparent', fontSize: 13, fontWeight: 600, textAlign: 'right', color: '#202124', fontVariantNumeric: 'tabular-nums' }}
                        />
                        <span style={{ fontSize: 11, color: C.sub }}>%</span>
                      </label>
                    ))}
                  </div>
                  <div style={{ marginTop: 6, fontSize: 11, color: remainingOk ? C.green : C.orange }}>
                    {group.label}类剩余 {remaining.toFixed(2)}% 未分配
                    {groupTotal > 0 && (
                      <span style={{ color: C.sub }}> · 占总资产 {groupTotal.toFixed(2)}%</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '12px 20px 20px', borderTop: '1px solid #f1f3f4' }}>
          <button onClick={onClose}
            style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #dadce0', backgroundColor: '#fff', color: C.sub, fontSize: 13, cursor: 'pointer' }}>
            取消
          </button>
          <button onClick={onSave}
            style={{ padding: '8px 16px', borderRadius: 8, border: 'none', backgroundColor: C.blue, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}


const TRANSFER_KEYS = ['campusCard', 'repayment', 'living', 'consumption', 'wishJar', 'invest'] as const;
type TransferKey = typeof TRANSFER_KEYS[number];
const TRANSFER_META: Record<TransferKey, { label: string; accountKey?: string }> = {
  campusCard:  { label: '🎓 校园卡',   accountKey: 'campusCard' },
  repayment:   { label: '💳 还款',      accountKey: 'savingsCard' },
  living:      { label: '🏦 生活',      accountKey: 'livingBank' },
  consumption: { label: '💼 消费',      accountKey: 'consumptionBank' },
  wishJar:     { label: '🏺 心愿罐' },
  invest:      { label: '📈 理财',      accountKey: 'investCnyBank' },
};

type BudgetKey = 'weekly' | 'monthly' | 'beyond';
type ReconcileMode = 'monthStart' | 'monthMiddle';

interface BudgetDetailItem { icon: string; label: string; amount: number; note?: string }

const RECONCILE_MODES: { key: ReconcileMode; label: string; hint: string }[] = [
  { key: 'monthStart', label: '月初', hint: '1-13号' },
  { key: 'monthMiddle', label: '月中', hint: '11/21' },
];
const defaultReconcileMode = (date: Date): ReconcileMode => (date.getDate() >= 1 && date.getDate() <= 13 ? 'monthStart' : 'monthMiddle');

export default function ReconcilePage() {
  const navigate = useNavigate();
  const { current, updateAccounts, updateTransfers, updateHoldings, updateHoldingReserves, updateUsStockHoldings, saveSnapshot } = useSnapshotStore();
  const { config, setConfig } = useConfigStore();
  const { records } = useMonthlyStore();
  const { tagMap, confirmedExpenses } = useCalendarStore();
  const { expenseItems } = useBillDetailStore();
  const { overrides: expenseScopeOverrides } = useExpenseScopeOverrideStore();
  const { tripTags } = useTripStore();


  // 账户余额本地编辑
  const [localAccounts, setLocalAccounts] = useState({
    credit:        String(current.accounts.credit ?? 0),
    creditMonthly: String(current.accounts.creditMonthly ?? 0),
    savingsCard:   String(current.accounts.savingsCard ?? 0),
    campusCard:    String(current.accounts.campusCard ?? 0),
    livingBank:    String(current.accounts.livingBank ?? 0),
    consumptionBank: String(current.accounts.consumptionBank ?? 0),
    wishJar:       String(current.accounts.wishJar ?? 0),
    incomeBank:    String(current.accounts.incomeBank ?? 0),
    investCnyBank: String(current.accounts.investCnyBank ?? 0),
    usdLivingBank: String(current.accounts.usdLivingBank ?? 0),
    usdConsumptionBank: String(current.accounts.usdConsumptionBank ?? 0),
    usdWishJar:    String(current.accounts.usdWishJar ?? 0),
    investUsdBank: String(current.accounts.investUsdBank ?? 0),
  });
  const accountInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const swipeStartXRef = useRef<Partial<Record<UsdVirtualAccountKey, number>>>({});
  const revealConsumptionWishUsd = usePrefsStore((s) => s.revealConsumptionWishUsd);
  const setRevealConsumptionWishUsd = usePrefsStore((s) => s.setRevealConsumptionWishUsd);
  const [revealedUsdAccounts, setRevealedUsdAccounts] = useState<Set<UsdVirtualAccountKey>>(
    () => new Set(revealConsumptionWishUsd ? (['usdConsumptionBank', 'usdWishJar'] as UsdVirtualAccountKey[]) : []),
  );
  const [investUsdInputMode, setInvestUsdInputMode] = useState<'cny' | 'usd'>('cny');
  const [investUsdCnyInput, setInvestUsdCnyInput] = useState('');
  const focusNextAccount = (i: number) => {
    setTimeout(() => {
      for (let next = i + 1; next < accountInputRefs.current.length; next += 1) {
        const input = accountInputRefs.current[next];
        if (!input) continue;
        input.focus();
        return;
      }
    }, 0);
  };
  const syncAccounts = (next = localAccounts) => updateAccounts({
    credit:        parseFloat(next.credit)        || 0,
    creditMonthly: parseFloat(next.creditMonthly) || 0,
    savingsCard:   parseFloat(next.savingsCard)   || 0,
    campusCard:    parseFloat(next.campusCard)    || 0,
    livingBank:    parseFloat(next.livingBank)    || 0,
    consumptionBank: parseFloat(next.consumptionBank) || 0,
    wishJar:       parseFloat(next.wishJar)       || 0,
    incomeBank:    parseFloat(next.incomeBank)    || 0,
    investCnyBank: parseFloat(next.investCnyBank) || 0,
    usdLivingBank: parseFloat(next.usdLivingBank) || 0,
    usdConsumptionBank: parseFloat(next.usdConsumptionBank) || 0,
    usdWishJar:    parseFloat(next.usdWishJar)    || 0,
    investUsdBank: parseFloat(next.investUsdBank) || 0,
  });
  const showUsdAccount = (usdKey: UsdVirtualAccountKey) =>
    parseAmountPart(localAccounts[usdKey]) !== 0 || (current.accounts[usdKey] ?? 0) !== 0 || revealedUsdAccounts.has(usdKey);
  const revealUsdAccount = (usdKey: UsdVirtualAccountKey) =>
    setRevealedUsdAccounts((prev) => {
      const next = new Set(prev);
      next.add(usdKey);
      return next;
    });
  const hideUsdAccount = (usdKey: UsdVirtualAccountKey) => {
    if (parseAmountPart(localAccounts[usdKey]) !== 0 || (current.accounts[usdKey] ?? 0) !== 0) return;
    setRevealedUsdAccounts((prev) => {
      const next = new Set(prev);
      next.delete(usdKey);
      return next;
    });
  };
  const makeUsdSwipeHandlers = (usdKey: UsdVirtualAccountKey) => ({
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
      swipeStartXRef.current[usdKey] = e.clientX;
    },
    onPointerUp: (e: PointerEvent<HTMLDivElement>) => {
      const startX = swipeStartXRef.current[usdKey];
      if (startX === undefined) return;
      const delta = e.clientX - startX;
      if (delta < -36) revealUsdAccount(usdKey);
      if (delta > 36) hideUsdAccount(usdKey);
      delete swipeStartXRef.current[usdKey];
    },
  });

  // 信用卡实际待还（储蓄卡先抵本期，溢出抵下期）
  // 长债超 1 万的部分可赎回用于偿还信用卡本期待还（储蓄卡抵扣后仍欠的部分）
  const longBondTotalForRepay = current.investHoldings.longBond ?? 0;
  const longBondExcess = Math.max(longBondTotalForRepay - LONG_BOND_PRIORITY_FLOOR, 0);
  const creditMonthlyAfterSavings = Math.max(
    (current.accounts.creditMonthly ?? 0) - (current.accounts.savingsCard ?? 0),
    0,
  );
  const longBondRepay = Math.min(longBondExcess, creditMonthlyAfterSavings);
  const effectiveCreditMonthly = Math.max(creditMonthlyAfterSavings - longBondRepay, 0);
  const effectiveCreditNext = Math.max(
    (current.accounts.credit ?? 0)
      - Math.max(current.accounts.savingsCard ?? 0, current.accounts.creditMonthly ?? 0),
    0,
  );

  // 已转金额（用户直接编辑）— 每次进入页面默认为 0
  const [confirmed, setConfirmed] = useState<Record<TransferKey, number>>(
    () => Object.fromEntries(TRANSFER_KEYS.map(k => [k, 0])) as Record<TransferKey, number>,
  );
  const [localTransferred, setLocalTransferred] = useState<Record<TransferKey, string>>(
    () => Object.fromEntries(TRANSFER_KEYS.map(k => [k, '0'])) as Record<TransferKey, string>,
  );

  const [expandedBudget, setExpandedBudget] = useState<BudgetKey | null>(null);
  const [expandedTransfer, setExpandedTransfer] = useState<TransferKey | null>(null);
  const [consumptionWishOpen, setConsumptionWishOpen] = useState(revealConsumptionWishUsd);
  const hideConsumptionWishAccounts = () => {
    setRevealedUsdAccounts((prev) => {
      const next = new Set(prev);
      next.delete('usdConsumptionBank');
      next.delete('usdWishJar');
      return next;
    });
    setConsumptionWishOpen(false);
    setRevealConsumptionWishUsd(false);
  };
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [groupedTargetInputs, setGroupedTargetInputs] = useState<GroupedTargetInputs>(
    () => groupedTargetInputFromConfig(effectiveInvestTargets(config.investAllocTargets)),
  );
  const [remoteUsdRate, setRemoteUsdRate] = useState<UsdRateResponse | null>(null);
  const [usdRateError, setUsdRateError] = useState(false);
  const [usdRebalanceCells, setUsdRebalanceCells] = useState<Set<InvestKey>>(() => new Set());
  const [saved, setSaved] = useState(false);
  const [reconcileMode, setReconcileMode] = useState<ReconcileMode>(() => defaultReconcileMode(new Date()));
  const isMonthStartMode = reconcileMode === 'monthStart';

  const [allowRebalanceSell, setAllowRebalanceSell] = useState(false);

  // 理财持仓本地编辑
  const [localHoldings, setLocalHoldings] = useState<Record<InvestKey, string>>(
    () => Object.fromEntries((Object.keys(current.investHoldings) as InvestKey[]).map((k) => [
      k,
      String(current.investHoldings[k]),
    ])) as Record<InvestKey, string>
  );
  const [localHoldingReserves, setLocalHoldingReserves] = useState<Record<InvestKey, string>>(
    () => Object.fromEntries((Object.keys(current.investHoldings) as InvestKey[]).map((k) => [
      k,
      String(current.investHoldingReserves?.[k] ?? 0),
    ])) as Record<InvestKey, string>
  );
  const holdingInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const longBondReserveInputRef = useRef<HTMLInputElement | null>(null);
  const transferInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const syncHolding = (k: InvestKey) => {
    const nextHolding = parseAmountPart(localHoldings[k]);
    updateHoldings({ ...current.investHoldings, [k]: nextHolding });
    if (k === 'us') {
      const nextInputs = normalizeUsStockInputs(localUsStockItems, { usTotalCny: nextHolding });
      setLocalUsStockItems(nextInputs);
      updateUsStockHoldings(usStockInputsToItems(nextInputs));
    }
    if (k === RESERVABLE_HOLDING_KEY) {
      updateHoldingReserves({ [k]: Math.max(0, parseAmountPart(localHoldingReserves[k])) });
    }
  };

  // 今天
  const today = new Date();
  const showCreditMonthlyInput = isMonthStartMode;
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth();
  const nextMonthDate = new Date(currentYear, currentMonth + 1, 1);
  const nextYear = nextMonthDate.getFullYear();
  const nextMonth = nextMonthDate.getMonth();
  const { holidayDataByYear, holidayWarning } = useHolidayYears([currentYear - 1, currentYear, nextYear]);

  // 历史均值（只取近两年）
  const twoYearsAgo = `${today.getFullYear() - 1}-01`;
  const stats = useMemo(
    () => calcHistoryStats(records.filter((r) => r.yearMonth >= twoYearsAgo), tagMap, confirmedExpenses, expenseItems, expenseScopeOverrides, tripTags),
    [records, tagMap, confirmedExpenses, expenseItems, expenseScopeOverrides, tripTags],
  );

  // 将 tagMap 转为 DailyTag[]
  const tags: DailyTag[] = useMemo(
    () => Object.entries(tagMap).map(([date, tag]) => ({ date, tag })),
    [tagMap],
  );

  const curYM = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
  const currentResolvedIncomeItems = useMemo(
    () => config.incomeItems.map((item) => resolveIncomeForMonth(item, currentYear, currentMonth, tagMap, holidayDataByYear)),
    [config.incomeItems, currentYear, currentMonth, tagMap, holidayDataByYear],
  );
  const nextResolvedIncomeItems = useMemo(
    () => config.incomeItems.map((item) => resolveIncomeForMonth(item, nextYear, nextMonth, tagMap, holidayDataByYear)),
    [config.incomeItems, nextYear, nextMonth, tagMap, holidayDataByYear],
  );

  const effectiveConfig = useMemo(() => ({
    ...config,
    incomeItems: currentResolvedIncomeItems.map((item) => ({
      id: item.id,
      name: item.name,
      amount: item.resolvedAmount,
      payDay: Number(item.resolvedPayDate.slice(8, 10)),
      isActive: item.isActive,
      dailyRate: item.dailyRate,
      tagKind: item.tagKind,
    })),
  }), [config, currentResolvedIncomeItems]);

  // 预算计算（传入当前账户余额，启用收入优先逻辑）
  const budget = useMemo(
    () => calcBudget(effectiveConfig, stats, confirmed, tags, today, {
      incomeBank:      current.accounts.incomeBank      ?? 0,
      campusCard:      current.accounts.campusCard      ?? 0,
      livingBank:      current.accounts.livingBank      ?? 0,
      consumptionBank: current.accounts.consumptionBank ?? 0,
    }),
    [effectiveConfig, stats, confirmed, tags, current.accounts],
  );

  // 理财再平衡建议（算法值）
  const effectiveInvestHoldings = useMemo(() => ({
    ...current.investHoldings,
    [RESERVABLE_HOLDING_KEY]: Math.max(
      0,
      current.investHoldings[RESERVABLE_HOLDING_KEY] - (current.investHoldingReserves?.[RESERVABLE_HOLDING_KEY] ?? 0),
    ),
  }), [current.investHoldings, current.investHoldingReserves]);
  const investKeys = Object.keys(current.investHoldings) as InvestKey[];
  const investAllocTargets = useMemo(
    () => investKeys.some((k) => (config.investAllocTargets[k] ?? 0) > 0)
      ? config.investAllocTargets
      : DEFAULT_CONFIG.investAllocTargets,
    [config.investAllocTargets, investKeys],
  );
  // 各品类最新一期累计收益 = now + past（past 逐月继承，已落在最新记录上）
  const latestBreakdownProfit = useMemo(
    () => {
      const sorted = [...records].sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));
      const out: Partial<Record<InvestKey, { profit: number; pastTotal: number; yearMonth?: string }>> = {};
      for (const k of INVEST_TARGET_KEYS) {
        const record = sorted.find((r) => getCategoryProfit(r, k) !== null);
        if (!record) continue;
        out[k] = {
          profit: getCategoryProfit(record, k) ?? 0,
          pastTotal: record.investBreakdownPastProfit?.[k] ?? 0,
          yearMonth: record.yearMonth,
        };
      }
      return out;
    },
    [records],
  );
  const fallbackUsdRate = useMemo(
    () => [...records].sort((a, b) => b.yearMonth.localeCompare(a.yearMonth))
      .map((r) => r.investProfitComponents?.us?.rate ?? r.investProfitComponents?.usBond?.rate)
      .find((rate) => rate !== undefined && Number.isFinite(rate) && rate > 0) ?? null,
    [records],
  );
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
  const usdRateLabel = remoteUsdRate
    ? `${remoteUsdRate.source}${remoteUsdRate.date ? ` · ${remoteUsdRate.date}` : ''}`
    : fallbackUsdRate !== null
      ? `${usdRateError ? '联网失败 · ' : ''}历史汇率`
      : '暂无汇率';
  const storedUsStockItems = current.usStockHoldings ?? EMPTY_US_STOCK_ITEMS;
  const storedDramItem = useMemo(
    () => storedUsStockItems.find((item) => item.symbol.trim().toUpperCase() === 'DRAM' || item.name.trim().toUpperCase() === 'DRAM') ?? null,
    [storedUsStockItems],
  );
  const dramConfig = useMemo(() => normalizeDramDecisionConfig({
    ...config.dramDecision,
    ...(storedDramItem ? {
      symbol: storedDramItem.symbol || config.dramDecision?.symbol,
      shares: storedDramItem.shares ?? config.dramDecision?.shares,
      costPrice: storedDramItem.costPrice ?? config.dramDecision?.costPrice,
    } : {}),
  }), [config.dramDecision, storedDramItem]);
  const [dramConfigInputs, setDramConfigInputs] = useState({
    shares: String(dramConfig.shares),
    costPrice: String(dramConfig.costPrice),
  });
  useEffect(() => {
    setDramConfigInputs({
      shares: String(dramConfig.shares),
      costPrice: String(dramConfig.costPrice),
    });
  }, [dramConfig.shares, dramConfig.costPrice]);
  const commitDramConfig = (patch?: Partial<typeof dramConfig>) => {
    const next = {
      ...dramConfig,
      shares: Math.max(0, parseAmountPart(patch?.shares !== undefined ? String(patch.shares) : dramConfigInputs.shares)),
      costPrice: Math.max(0, parseAmountPart(patch?.costPrice !== undefined ? String(patch.costPrice) : dramConfigInputs.costPrice)),
      ...patch,
    };
    setConfig({ dramDecision: next });
    if (storedDramItem) {
      updateUsStockHoldings(storedUsStockItems.map((item) => (
        item.id === storedDramItem.id
          ? { ...item, symbol: next.symbol, shares: next.shares, costPrice: next.costPrice }
          : item
      )));
    }
  };
  const [dramChart, setDramChart] = useState<MarketChartResponse | null>(null);
  const [dramChartLoading, setDramChartLoading] = useState(false);
  const [dramChartError, setDramChartError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setDramChartLoading(true);
    setDramChartError(false);
    fetch(`/api/market-chart?symbol=${encodeURIComponent(dramConfig.symbol)}&range=6mo&interval=1d`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        setDramChart((await response.json()) as MarketChartResponse);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setDramChartError(true);
      })
      .finally(() => setDramChartLoading(false));
    return () => controller.abort();
  }, [dramConfig.symbol]);
  const dramDecision = useMemo(
    () => dramChart ? buildDramDecision({
      chart: dramChart,
      config: dramConfig,
      usdRate: latestUsdRate,
      usStockValueCny: current.investHoldings.us ?? 0,
    }) : null,
    [current.investHoldings.us, dramChart, dramConfig, latestUsdRate],
  );
  const effectiveUsStockItems = useMemo<UsStockHoldingItem[]>(() => {
    if (storedUsStockItems.length > 0) return storedUsStockItems;
    const dramValue = dramDecision?.dramValueCny ?? 0;
    return [
      {
        id: 'dram',
        name: 'DRAM',
        symbol: dramConfig.symbol,
        amountCny: roundMoney(dramValue),
        shares: dramConfig.shares,
        costPrice: dramConfig.costPrice,
      },
      {
        id: 'sp500',
        name: '标普',
        symbol: 'SPY',
        amountCny: roundMoney(Math.max((current.investHoldings.us ?? 0) - dramValue, 0)),
      },
    ];
  }, [current.investHoldings.us, dramConfig, dramDecision?.dramValueCny, storedUsStockItems]);
  const [usStockExpanded, setUsStockExpanded] = useState(false);
  const [localUsStockItems, setLocalUsStockItems] = useState<UsStockItemInput[]>(
    () => syncSpyUsStockAmount(usStockInputsFromItems(effectiveUsStockItems), current.investHoldings.us ?? 0),
  );
  useEffect(() => {
    setLocalUsStockItems(syncSpyUsStockAmount(usStockInputsFromItems(effectiveUsStockItems), current.investHoldings.us ?? 0));
  }, [current.investHoldings.us, effectiveUsStockItems]);
  const usStockSymbols = useMemo(
    () => [...new Set(localUsStockItems.map((item) => item.symbol.trim().toUpperCase()).filter(Boolean))],
    [localUsStockItems],
  );
  const [usStockCharts, setUsStockCharts] = useState<Record<string, MarketChartResponse>>({});
  const [usStockPriceErrors, setUsStockPriceErrors] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (usStockSymbols.length === 0) return;
    const controller = new AbortController();
    const loadCharts = async () => {
      const results = await Promise.allSettled(usStockSymbols.map(async (symbol) => {
        const response = await fetch(`/api/market-chart?symbol=${encodeURIComponent(symbol)}&range=6mo&interval=1d`, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return [symbol, await response.json() as MarketChartResponse] as const;
      }));
      if (controller.signal.aborted) return;
      const failed = new Set<string>();
      setUsStockCharts((prev) => {
        const next = { ...prev };
        results.forEach((result, index) => {
          const symbol = usStockSymbols[index];
          if (result.status === 'fulfilled') next[result.value[0]] = result.value[1];
          else failed.add(symbol);
        });
        return next;
      });
      setUsStockPriceErrors(failed);
    };
    loadCharts().catch((error) => {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setUsStockPriceErrors(new Set(usStockSymbols));
    });
    return () => controller.abort();
  }, [usStockSymbols.join('|')]);
  const autoFillUsStockAmount = (item: UsStockItemInput) => {
    if (isSpyUsStockInput(item)) return item;
    const amountCny = usStockCostAmountCny(item, latestUsdRate);
    return amountCny !== null ? { ...item, amountCny: String(amountCny) } : item;
  };
  const normalizeUsStockInputs = (inputs: UsStockItemInput[], options?: { autoAmount?: boolean; usTotalCny?: number }) => {
    const amountInputs = options?.autoAmount ? inputs.map(autoFillUsStockAmount) : inputs;
    return syncSpyUsStockAmount(amountInputs, options?.usTotalCny ?? (current.investHoldings.us ?? 0));
  };
  const usStockInputsToItems = (inputs: UsStockItemInput[]) => (
    inputs.map((item, index) => {
      const amountCny = roundMoney(Math.max(0, parseAmountPart(item.amountCny)));
      const shares = item.shares.trim() ? Math.max(0, parseAmountPart(item.shares)) : undefined;
      const costPrice = item.costPrice.trim() ? Math.max(0, parseAmountPart(item.costPrice)) : undefined;
      return {
        id: item.id || `us-stock-${Date.now()}-${index}`,
        name: item.name.trim() || `项目${index + 1}`,
        symbol: item.symbol.trim().toUpperCase(),
        amountCny,
        ...(shares !== undefined ? { shares } : {}),
        ...(costPrice !== undefined ? { costPrice } : {}),
      };
    })
  );
  const commitUsStockItems = (inputs = localUsStockItems, options?: { autoAmount?: boolean }) => {
    const normalizedInputs = normalizeUsStockInputs(inputs, options);
    setLocalUsStockItems(normalizedInputs);
    const items = usStockInputsToItems(normalizedInputs);
    updateUsStockHoldings(items);
    const nextDram = items.find((item) => item.symbol === 'DRAM' || item.name.trim().toUpperCase() === 'DRAM');
    if (nextDram) {
      setConfig({
        dramDecision: {
          ...dramConfig,
          symbol: nextDram.symbol || 'DRAM',
          shares: nextDram.shares ?? dramConfig.shares,
          costPrice: nextDram.costPrice ?? dramConfig.costPrice,
        },
      });
    }
  };
  const patchUsStockItem = (item: UsStockItemInput, patch: Partial<UsStockItemInput>, options?: { autoAmount?: boolean }) => {
    const next = { ...item, ...patch };
    return options?.autoAmount ? autoFillUsStockAmount(next) : next;
  };
  const setLocalUsStockItem = (id: string, patch: Partial<UsStockItemInput>, options?: { autoAmount?: boolean }) =>
    setLocalUsStockItems((prev) => normalizeUsStockInputs(prev.map((item) => item.id === id ? patchUsStockItem(item, patch, options) : item)));
  const addUsStockItem = () => {
    const next = normalizeUsStockInputs([
      ...localUsStockItems,
      { id: `us-stock-${Date.now()}`, name: '新项目', symbol: '', amountCny: '0', shares: '', costPrice: '' },
    ]);
    setLocalUsStockItems(next);
    commitUsStockItems(next);
    setUsStockExpanded(true);
  };
  const removeUsStockItem = (id: string) => {
    const next = normalizeUsStockInputs(localUsStockItems.filter((item) => item.id !== id));
    setLocalUsStockItems(next);
    commitUsStockItems(next);
  };
  const usStockDetailTotal = localUsStockItems.reduce((sum, item) => sum + Math.max(0, parseAmountPart(item.amountCny)), 0);
  const usStockDetailGap = roundMoney(usStockDetailTotal - (current.investHoldings.us ?? 0));
  const commitInvestUsdCnyInput = (rawCny = investUsdCnyInput) => {
    if (latestUsdRate === null) {
      syncAccounts();
      return;
    }
    const nextAccounts = {
      ...localAccounts,
      investUsdBank: String(roundMoney(parseAmountPart(rawCny) / latestUsdRate)),
    };
    setLocalAccounts(nextAccounts);
    syncAccounts(nextAccounts);
  };
  const switchInvestUsdInputMode = (mode: 'cny' | 'usd') => {
    if (mode === 'usd') {
      commitInvestUsdCnyInput();
      setInvestUsdInputMode('usd');
      return;
    }
    if (latestUsdRate !== null) {
      setInvestUsdCnyInput(String(roundMoney(parseAmountPart(localAccounts.investUsdBank) * latestUsdRate)));
    }
    syncAccounts();
    setInvestUsdInputMode('cny');
  };
  useEffect(() => {
    if (investUsdInputMode !== 'cny' || latestUsdRate === null) return;
    setInvestUsdCnyInput(String(roundMoney(parseAmountPart(localAccounts.investUsdBank) * latestUsdRate)));
  }, [investUsdInputMode, latestUsdRate, localAccounts.investUsdBank]);
  const rebalanceNewFunds = useMemo(
    () => roundMoney((current.accounts.investCnyBank ?? 0) + (latestUsdRate !== null ? (current.accounts.investUsdBank ?? 0) * latestUsdRate : 0)),
    [current.accounts.investCnyBank, current.accounts.investUsdBank, latestUsdRate],
  );
  const rawRebalanceSuggested = useMemo(() => {
    // 加仓优先：长债总额不足 1 万时，先把新资金补到长债，剩余再按目标比例分配
    if (!allowRebalanceSell && rebalanceNewFunds > 0) {
      const longBondTotal = current.investHoldings.longBond ?? 0; // 用「总额」判定，honor「总额>1万」
      const shortfall = Math.max(0, LONG_BOND_PRIORITY_FLOOR - longBondTotal);
      const topUp = Math.min(rebalanceNewFunds, shortfall);
      if (topUp > 0) {
        const remaining = roundMoney(rebalanceNewFunds - topUp);
        const holdingsAfterTopUp = {
          ...effectiveInvestHoldings,
          longBond: effectiveInvestHoldings.longBond + topUp,
        };
        const rest = calcRebalance(holdingsAfterTopUp, investAllocTargets, remaining, false);
        return { ...rest, longBond: (rest.longBond ?? 0) + topUp };
      }
    }
    return calcRebalance(effectiveInvestHoldings, investAllocTargets, rebalanceNewFunds, allowRebalanceSell);
  }, [effectiveInvestHoldings, investAllocTargets, rebalanceNewFunds, allowRebalanceSell, current.investHoldings.longBond]);
  const rebalanceSuggested = useMemo(() => {
    const rounded = Object.fromEntries(
      investKeys.map((k) => [k, roundMoney(rawRebalanceSuggested[k] ?? 0)]),
    ) as Record<InvestKey, number>;
    if (allowRebalanceSell || rebalanceNewFunds <= 0) return rounded;

    const isUsdKey = (k: InvestKey) => USD_INVEST_KEYS.includes(k);
    const cnyNeed = investKeys.reduce((s, k) => s + (!isUsdKey(k) ? Math.max(rawRebalanceSuggested[k] ?? 0, 0) : 0), 0);
    const cnyCapacity = roundMoney(
      Math.max(current.accounts.investCnyBank ?? 0, 0)
      + Math.max(current.accounts.livingBank ?? 0, 0)
      + Math.max(current.accounts.consumptionBank ?? 0, 0)
      + Math.max(current.accounts.wishJar ?? 0, 0),
    );
    if (cnyNeed <= cnyCapacity || cnyNeed <= 0) return rounded;

    const factor = cnyCapacity / cnyNeed;
    const cnyKeys = investKeys.filter((k) => !isUsdKey(k) && (rawRebalanceSuggested[k] ?? 0) > 0);
    let scaledTotal = 0;
    let largestKey: InvestKey | null = null;
    for (const k of cnyKeys) {
      const scaled = roundMoney((rawRebalanceSuggested[k] ?? 0) * factor);
      rounded[k] = scaled;
      scaledTotal = roundMoney(scaledTotal + scaled);
      if (largestKey === null || (rawRebalanceSuggested[k] ?? 0) > (rawRebalanceSuggested[largestKey] ?? 0)) {
        largestKey = k;
      }
    }
    const drift = roundMoney(cnyCapacity - scaledTotal);
    if (largestKey && Math.abs(drift) >= 0.01) {
      rounded[largestKey] = roundMoney(Math.max(rounded[largestKey] + drift, 0));
    }
    return rounded;
  }, [allowRebalanceSell, current.accounts, investKeys, rawRebalanceSuggested, rebalanceNewFunds]);
  const rebalanceCnyGiveUpCny = useMemo(() => {
    if (allowRebalanceSell || rebalanceNewFunds <= 0) return 0;
    const rawCnyNeed = investKeys.reduce((s, k) => s + (!USD_INVEST_KEYS.includes(k) ? Math.max(rawRebalanceSuggested[k] ?? 0, 0) : 0), 0);
    const cappedCnyNeed = investKeys.reduce((s, k) => s + (!USD_INVEST_KEYS.includes(k) ? Math.max(rebalanceSuggested[k] ?? 0, 0) : 0), 0);
    return roundMoney(Math.max(rawCnyNeed - cappedCnyNeed, 0));
  }, [allowRebalanceSell, investKeys, rawRebalanceSuggested, rebalanceNewFunds, rebalanceSuggested]);

  const rebalanceInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  // 已加仓（本次会话输入，执行后归零）
  const [localConfirmed, setLocalConfirmed] = useState<Record<InvestKey, string>>(
    () => Object.fromEntries(investKeys.map((k) => [k, '0'])) as Record<InvestKey, string>
  );
  const totalInvest = investKeys.reduce((s, k) => s + effectiveInvestHoldings[k], 0);
  const rebalanceFunding = useMemo(() => {
    const isUsdKey = (k: InvestKey) => USD_INVEST_KEYS.includes(k);
    const usdBuyCny = investKeys.reduce((s, k) => s + (isUsdKey(k) ? Math.max(rebalanceSuggested[k], 0) : 0), 0);
    const usdSellCny = investKeys.reduce((s, k) => s + (isUsdKey(k) ? Math.max(-rebalanceSuggested[k], 0) : 0), 0);
    const cnyBuy = investKeys.reduce((s, k) => s + (!isUsdKey(k) ? Math.max(rebalanceSuggested[k], 0) : 0), 0);
    const cnySell = investKeys.reduce((s, k) => s + (!isUsdKey(k) ? Math.max(-rebalanceSuggested[k], 0) : 0), 0);
    const usdInvestCny = latestUsdRate !== null ? (current.accounts.investUsdBank ?? 0) * latestUsdRate : 0;
    const investCny = current.accounts.investCnyBank ?? 0;
    const baseFunding = {
      usdBuyCny,
      usdSellCny,
      cnyBuy,
      cnySell,
      usdInvestCny,
      usdReplaceCny: 0,
      usdReplaceUseCny: 0,
      usdCompensateCny: 0,
      cnyToUsdCny: 0,
      usdSurplusCny: 0,
      usdParkCny: 0,
      cnyFromRmbBuffer: 0,
      cnyGiveUpCny: allowRebalanceSell ? 0 : rebalanceCnyGiveUpCny,
      usdReplaceRows: [] as RebalanceFundingBucket[],
      cnyBufferRows: [] as RebalanceFundingBucket[],
      needConsumption: false,
      needWish: false,
      cnyCashNeeded: Math.max(cnyBuy - cnySell, 0),
      cnyCashAfter: investCny - Math.max(cnyBuy - cnySell, 0),
    };

    if (allowRebalanceSell) {
      return baseFunding;
    }

    let usdAfterInvest = Math.max(usdBuyCny - usdInvestCny, 0);
    let usdReplaceCny = 0;
    let usdReplaceUseCny = 0;
    let usdCompensateCny = 0;
    const usdReplaceRows: RebalanceFundingBucket[] = [];
    let needConsumption = false;
    let needWish = false;
    if (latestUsdRate !== null) {
      for (const bucket of USD_REPLACE_BUCKETS) {
        const availableCny = Math.max(current.accounts[bucket.usdKey] ?? 0, 0) * latestUsdRate;
        usdReplaceCny += availableCny;
        const useCny = Math.min(usdAfterInvest, availableCny);
        if (useCny > 0) {
          usdReplaceUseCny += useCny;
          usdCompensateCny += useCny;
          usdReplaceRows.push({ ...bucket, amountCny: roundMoney(useCny) });
          if (bucket.usdKey === 'usdConsumptionBank') needConsumption = true;
          if (bucket.usdKey === 'usdWishJar') needWish = true;
          usdAfterInvest -= useCny;
        }
      }
    }
    const cnyToUsdCny = Math.max(usdAfterInvest, 0);
    const usdSurplusCny = latestUsdRate !== null ? Math.max(usdInvestCny - usdBuyCny, 0) : 0;
    let cnyAfterInvest = Math.max(cnyBuy - Math.max(investCny, 0), 0);
    let usdSurplusToPark = usdSurplusCny;
    let usdParkCny = 0;
    let cnyFromRmbBuffer = 0;
    const cnyBufferRows: RebalanceFundingBucket[] = [];
    if (latestUsdRate !== null && cnyAfterInvest > 0 && usdSurplusToPark > 0) {
      for (const bucket of USD_REPLACE_BUCKETS) {
        const availableCny = Math.max(current.accounts[bucket.cnyKey] ?? 0, 0);
        const useCny = Math.min(cnyAfterInvest, availableCny, usdSurplusToPark);
        if (useCny <= 0) continue;
        const roundedUseCny = roundMoney(useCny);
        cnyFromRmbBuffer += roundedUseCny;
        usdParkCny += roundedUseCny;
        cnyBufferRows.push({ ...bucket, amountCny: roundedUseCny });
        cnyAfterInvest = roundMoney(cnyAfterInvest - roundedUseCny);
        usdSurplusToPark = roundMoney(usdSurplusToPark - roundedUseCny);
        if (bucket.usdKey === 'usdConsumptionBank') needConsumption = true;
        if (bucket.usdKey === 'usdWishJar') needWish = true;
      }
    }
    const cnyGiveUpCny = roundMoney(Math.max(cnyAfterInvest, 0) + rebalanceCnyGiveUpCny);
    const cnyCashNeeded = Math.max(cnyBuy + usdCompensateCny + cnyToUsdCny - cnySell - cnyFromRmbBuffer, 0);
    const cnyCashAfter = investCny - cnyCashNeeded;
    return {
      usdBuyCny,
      usdSellCny,
      cnyBuy,
      cnySell,
      usdInvestCny,
      usdReplaceCny: roundMoney(usdReplaceCny),
      usdReplaceUseCny: roundMoney(usdReplaceUseCny),
      usdCompensateCny: roundMoney(usdCompensateCny),
      cnyToUsdCny: roundMoney(cnyToUsdCny),
      usdSurplusCny: roundMoney(usdSurplusCny),
      usdParkCny: roundMoney(usdParkCny),
      cnyFromRmbBuffer: roundMoney(cnyFromRmbBuffer),
      cnyGiveUpCny,
      usdReplaceRows,
      cnyBufferRows,
      needConsumption,
      needWish,
      cnyCashNeeded: roundMoney(cnyCashNeeded),
      cnyCashAfter: roundMoney(cnyCashAfter),
    };
  }, [allowRebalanceSell, current.accounts, investKeys, latestUsdRate, rebalanceCnyGiveUpCny, rebalanceSuggested]);

  useEffect(() => {
    if (!rebalanceFunding.needConsumption && !rebalanceFunding.needWish) return;
    setRevealedUsdAccounts((prev) => {
      const next = new Set(prev);
      if (rebalanceFunding.needConsumption) next.add('usdConsumptionBank');
      if (rebalanceFunding.needWish) next.add('usdWishJar');
      if (next.size === prev.size && [...next].every((key) => prev.has(key))) return prev;
      return next;
    });
    setConsumptionWishOpen(true);
  }, [rebalanceFunding.needConsumption, rebalanceFunding.needWish]);


  // 一键执行转账：把已转金额加到对应账户，收入账户相应减少，然后已转归零
  // 校园卡 例外：钱来自信用卡刷一笔，所以不扣 incomeBank，而是挂到信用卡总待还
  const handleExecuteAll = () => {
    const accountDelta: Partial<typeof current.accounts> = {};
    let totalOut = 0;

    for (const key of TRANSFER_KEYS) {
      const amount = parseFloat(localTransferred[key] || '0') || 0;
      if (amount === 0) continue;
      if (key === 'campusCard') {
        const baseCampus = accountDelta.campusCard ?? (current.accounts.campusCard ?? 0);
        accountDelta.campusCard = baseCampus + amount;
        const baseCredit = accountDelta.credit ?? (current.accounts.credit ?? 0);
        accountDelta.credit = baseCredit + amount;
        continue;
      }
      totalOut += amount;
      const acctKey = TRANSFER_META[key].accountKey as keyof typeof current.accounts | undefined;
      if (!acctKey) continue;
      const base = accountDelta[acctKey] ?? (current.accounts[acctKey] ?? 0);
      accountDelta[acctKey] = base + amount;
    }

    if (totalOut > 0) {
      const incomeBase = accountDelta.incomeBank ?? (current.accounts.incomeBank ?? 0);
      accountDelta.incomeBank = incomeBase - totalOut;
    }

    const zeroed = Object.fromEntries(TRANSFER_KEYS.map((k) => [k, 0])) as Record<TransferKey, number>;
    const zeroedStr = Object.fromEntries(TRANSFER_KEYS.map((k) => [k, '0'])) as Record<TransferKey, string>;

    if (Object.keys(accountDelta).length > 0) {
      updateAccounts(accountDelta);
      setLocalAccounts((prev) => {
        const next = { ...prev };
        for (const [k, v] of Object.entries(accountDelta)) {
          if (k in next) (next as Record<string, string>)[k] = String(v);
        }
        return next;
      });
    }
    updateTransfers(zeroed);
    setConfirmed(zeroed);
    setLocalTransferred(zeroedStr);
  };

  const hasTransferChanges = TRANSFER_KEYS.some((k) => (parseFloat(localTransferred[k] || '0') || 0) !== 0);

  // 赎回长债超 1 万的部分用于还款：长债↓ → 储蓄卡↑（储蓄卡再抵信用卡本期待还）
  const handleRedeemLongBond = () => {
    const amount = roundMoney(longBondRepay);
    if (amount <= 0) return;
    const newLongBond = roundMoney((current.investHoldings.longBond ?? 0) - amount);
    const newSavings = roundMoney((current.accounts.savingsCard ?? 0) + amount);
    const curReserve = current.investHoldingReserves?.[RESERVABLE_HOLDING_KEY] ?? 0;
    updateHoldings({ ...current.investHoldings, longBond: newLongBond });
    setLocalHoldings((p) => ({ ...p, longBond: String(newLongBond) }));
    if (curReserve > newLongBond) {
      updateHoldingReserves({ [RESERVABLE_HOLDING_KEY]: Math.max(0, newLongBond) });
      setLocalHoldingReserves((p) => ({ ...p, [RESERVABLE_HOLDING_KEY]: String(Math.max(0, newLongBond)) }));
    }
    updateAccounts({ savingsCard: newSavings });
    setLocalAccounts((p) => ({ ...p, savingsCard: String(newSavings) }));
  };

  const handleExecuteRebalance = () => {
    const entries = investKeys.map((k) => [k, parseFloat(localConfirmed[k]) || 0] as const);
    const hasUsdExecution = entries.some(([k, amount]) => USD_INVEST_KEYS.includes(k) && amount !== 0);
    if (hasUsdExecution && latestUsdRate === null) {
      window.alert('暂无美元汇率，先在月度记录里录入美股/美债美元收益汇率后再执行美元资产加减仓。');
      return;
    }

    const newHoldings = { ...current.investHoldings };
    const nextAccounts: AccountSnapshot['accounts'] = {
      credit: current.accounts.credit ?? 0,
      creditMonthly: current.accounts.creditMonthly ?? 0,
      savingsCard: current.accounts.savingsCard ?? 0,
      incomeBank: current.accounts.incomeBank ?? 0,
      livingBank: current.accounts.livingBank ?? 0,
      campusCard: current.accounts.campusCard ?? 0,
      consumptionBank: current.accounts.consumptionBank ?? 0,
      wishJar: current.accounts.wishJar ?? 0,
      investCnyBank: current.accounts.investCnyBank ?? 0,
      usdLivingBank: current.accounts.usdLivingBank ?? 0,
      usdConsumptionBank: current.accounts.usdConsumptionBank ?? 0,
      usdWishJar: current.accounts.usdWishJar ?? 0,
      investUsdBank: current.accounts.investUsdBank ?? 0,
    };

    const buyUsdAsset = (amountCny: number) => {
      const rate = latestUsdRate!;
      let needUsd = amountCny / rate;

      const usdFromInvest = Math.min(Math.max(nextAccounts.investUsdBank, 0), needUsd);
      if (usdFromInvest > 0) {
        nextAccounts.investUsdBank = roundMoney(nextAccounts.investUsdBank - usdFromInvest);
        needUsd -= usdFromInvest;
      }

      for (const bucket of USD_REPLACE_BUCKETS) {
        if (needUsd <= 0.0001) break;
        const usdFromBucket = Math.min(Math.max(nextAccounts[bucket.usdKey], 0), needUsd);
        if (usdFromBucket <= 0) continue;
        const cnyEquivalent = roundMoney(usdFromBucket * rate);
        nextAccounts[bucket.usdKey] = roundMoney(nextAccounts[bucket.usdKey] - usdFromBucket);
        nextAccounts[bucket.cnyKey] = roundMoney(nextAccounts[bucket.cnyKey] + cnyEquivalent);
        nextAccounts.investCnyBank = roundMoney(nextAccounts.investCnyBank - cnyEquivalent);
        needUsd -= usdFromBucket;
      }

      if (needUsd > 0.0001) {
        nextAccounts.investCnyBank = roundMoney(nextAccounts.investCnyBank - needUsd * rate);
      }
    };

    const buyCnyAsset = (amountCny: number) => {
      let remaining = amountCny;
      let covered = 0;

      const fromInvest = roundMoney(Math.min(Math.max(nextAccounts.investCnyBank, 0), remaining));
      if (fromInvest > 0) {
        nextAccounts.investCnyBank = roundMoney(nextAccounts.investCnyBank - fromInvest);
        remaining = roundMoney(remaining - fromInvest);
        covered = roundMoney(covered + fromInvest);
      }

      if (remaining > 0.0001 && latestUsdRate !== null) {
        const rate = latestUsdRate;
        for (const bucket of USD_REPLACE_BUCKETS) {
          if (remaining <= 0.0001) break;
          const availableCny = Math.max(nextAccounts[bucket.cnyKey], 0);
          const parkableCny = Math.max(nextAccounts.investUsdBank, 0) * rate;
          const fromBuffer = roundMoney(Math.min(availableCny, parkableCny, remaining));
          if (fromBuffer <= 0) continue;

          const usdToPark = roundMoney(Math.min(Math.max(nextAccounts.investUsdBank, 0), fromBuffer / rate));
          nextAccounts[bucket.cnyKey] = roundMoney(nextAccounts[bucket.cnyKey] - fromBuffer);
          nextAccounts.investUsdBank = roundMoney(nextAccounts.investUsdBank - usdToPark);
          nextAccounts[bucket.usdKey] = roundMoney(nextAccounts[bucket.usdKey] + usdToPark);
          remaining = roundMoney(remaining - fromBuffer);
          covered = roundMoney(covered + fromBuffer);
        }
      }

      return covered;
    };

    for (const [k, executed] of entries) {
      if (executed === 0) continue;
      let holdingDelta = executed;

      if (USD_INVEST_KEYS.includes(k)) {
        const rate = latestUsdRate!;
        if (executed > 0) {
          buyUsdAsset(executed);
        } else {
          nextAccounts.investUsdBank = roundMoney(nextAccounts.investUsdBank + (-executed / rate));
        }
      } else if (executed > 0) {
        holdingDelta = buyCnyAsset(executed);
      } else {
        nextAccounts.investCnyBank = roundMoney(nextAccounts.investCnyBank + (-executed));
      }
      newHoldings[k] = roundMoney(newHoldings[k] + holdingDelta);
    }

    updateHoldings(newHoldings);
    updateAccounts(nextAccounts);
    setLocalHoldings(Object.fromEntries(investKeys.map((k) => [
      k,
      String(newHoldings[k]),
    ])) as Record<InvestKey, string>);
    setLocalAccounts((prev) => ({
      ...prev,
      livingBank: String(nextAccounts.livingBank),
      consumptionBank: String(nextAccounts.consumptionBank),
      wishJar: String(nextAccounts.wishJar),
      incomeBank: String(nextAccounts.incomeBank),
      investCnyBank: String(nextAccounts.investCnyBank),
      usdLivingBank: String(nextAccounts.usdLivingBank),
      usdConsumptionBank: String(nextAccounts.usdConsumptionBank),
      usdWishJar: String(nextAccounts.usdWishJar),
      investUsdBank: String(nextAccounts.investUsdBank),
    }));
    setLocalConfirmed(Object.fromEntries(investKeys.map((k) => [k, '0'])) as Record<InvestKey, string>);
  };

  // 保存快照
  const handleSave = () => {
    updateTransfers(confirmed);
    saveSnapshot();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const todayDate = today.getDate();
  const weekEnd = todayDate + Math.min(budget.daysLeftInMonth, 7);
  const payDateDay = (item: ResolvedIncomeItem) => Number(item.resolvedPayDate.slice(8, 10));
  const makeIncomeNote = (item: ResolvedIncomeItem, status: 'upcoming' | 'received' | 'next') => {
    const baseLabel = status === 'received'
      ? `${payDateDay(item)}号已发`
      : status === 'next'
        ? `次月${payDateDay(item)}号发薪`
        : `${payDateDay(item)}号发薪`;
    const taxLabel = item.taxAmount > 0
      ? `；扣税¥${fmtInt(item.taxAmount)}，到手¥${fmtInt(item.resolvedAmount)}`
      : item.taxRuleError
        ? `；${item.taxRuleError}`
        : '';
    if (item.isInternPayroll && item.payrollCycle) {
      return `${baseLabel}（截止${dateLabel(item.payrollCycle.cutoffDate)}；${item.payrollCycle.internDays}天×¥${item.dailyRate ?? 0}/天${taxLabel}）`;
    }
    if (item.dailyRate !== undefined && item.tagKind) {
      return `${baseLabel}（${item.resolvedDayCount ?? 0}天×¥${item.dailyRate}/天${taxLabel}）`;
    }
    return taxLabel ? `${baseLabel}（${taxLabel.slice(1)}）` : baseLabel;
  };

  // 周内（近7天）各状态实际天数（直接从 tagMap 计数，不用比例估算）
  const tagCountWeek = useMemo(() => {
    const counts: Record<TagKind, number> = { intern: 0, school: 0, home: 0, travel: 0 };
    const weekEndDay = todayDate + Math.min(budget.daysLeftInMonth, 7);
    for (const [date, tag] of Object.entries(tagMap)) {
      if (!date.startsWith(curYM)) continue;
      const day = parseInt(date.slice(8), 10);
      if (day > todayDate && day <= weekEndDay) counts[tag as TagKind]++;
    }
    return counts;
  }, [tagMap, curYM, todayDate, budget.daysLeftInMonth]);

  // 预算明细（收入按发薪日判断是否已发，日薪项显示计算方式）

  // 信用卡本期待还条目：月初模式归入本月，月中模式归入月外。
  const creditMonthlyItem: BudgetDetailItem = {
    icon: '💳',
    label: '信用卡本期待还',
    amount: effectiveCreditMonthly,
    note: `${config.creditPayDate}号还款${(current.accounts.savingsCard ?? 0) > 0 || longBondRepay > 0 ? ` · ¥${fmtInt(current.accounts.creditMonthly ?? 0)}${(current.accounts.savingsCard ?? 0) > 0 ? `-储蓄¥${fmtInt(current.accounts.savingsCard ?? 0)}` : ''}${longBondRepay > 0 ? `-长债¥${fmtInt(longBondRepay)}` : ''}` : ''}`,
  };
  const creditInThisMonth = isMonthStartMode;

  const budgetDetails: Record<BudgetKey, { income: BudgetDetailItem[]; expense: BudgetDetailItem[] }> = {
    weekly: {
      income: [
        { icon: '🏦', label: '生活账户余额', amount: current.accounts.livingBank ?? 0, note: '当前余额' },
        ...currentResolvedIncomeItems.filter((item) => item.isActive && payDateDay(item) > todayDate && payDateDay(item) <= weekEnd).map((item) => ({
          icon: '💰', label: item.name, amount: item.resolvedAmount, note: makeIncomeNote(item, 'upcoming'),
        })),
      ],
      expense: [
        ...(['school', 'intern', 'home', 'travel'] as TagKind[]).map((k) => {
          const days  = tagCountWeek[k];
          const dLife = stats.stateDailyAvg[k];
          if (dLife > 0 && days > 0) return [{ icon: tagMeta[k].icon, label: `${tagMeta[k].label}·生活`, amount: Math.round(days * dLife), note: `${days}天×¥${Math.round(dLife)}/天` }];
          return [] as BudgetDetailItem[];
        }).flat(),
      ],
    },
    monthly: {
      income: [
        { icon: '🏦', label: '生活账户余额', amount: current.accounts.livingBank ?? 0, note: '当前余额' },
        ...currentResolvedIncomeItems.filter((item) => item.isActive).map((item) => {
          const received = payDateDay(item) <= todayDate;
          return {
            icon: received ? '✅' : '💰',
            label: item.name,
            amount: received ? 0 : item.resolvedAmount,
            note: makeIncomeNote(item, received ? 'received' : 'upcoming'),
          };
        }),
      ],
      expense: [
        ...(creditInThisMonth && effectiveCreditMonthly > 0 ? [creditMonthlyItem] : []),
        ...(['school', 'intern', 'home', 'travel'] as TagKind[]).map((k) => {
          const days  = budget.stateDaysLeft[k];
          const dLife = stats.stateDailyAvg[k];
          if (dLife > 0 && days > 0) return [{ icon: tagMeta[k].icon, label: `${tagMeta[k].label}·生活`, amount: Math.round(days * dLife), note: `${days}天×¥${Math.round(dLife)}/天` }];
          return [] as BudgetDetailItem[];
        }).flat(),
      ],
    },
    beyond: {
      income: nextResolvedIncomeItems.filter((item) => item.isActive).map((item) => ({
        icon: '💰',
        label: item.name,
        amount: item.resolvedAmount,
        note: makeIncomeNote(item, 'next'),
      })),
      expense: [
        ...(!creditInThisMonth ? [creditMonthlyItem] : []),
        { icon: '💳', label: '信用卡下期', amount: effectiveCreditNext, note: (current.accounts.savingsCard ?? 0) > (current.accounts.creditMonthly ?? 0) ? '总待还-储蓄卡溢出-本期' : '总待还-本期待还' },
        ...(['school', 'intern', 'home', 'travel'] as TagKind[]).map((k) => {
          const days  = budget.stateDaysNextMonth[k];
          const dLife = stats.stateDailyAvg[k];
          if (dLife > 0 && days > 0) return [{ icon: tagMeta[k].icon, label: `${tagMeta[k].label}·生活`, amount: Math.round(days * dLife), note: `${days}天×¥${Math.round(dLife)}/天` }];
          return [] as BudgetDetailItem[];
        }).flat(),
      ],
    },
  };

  const sumDetailExp = (key: BudgetKey) =>
    budgetDetails[key].expense.reduce((s, i) => s + i.amount, 0);
  const sumDetailInc = (key: BudgetKey) =>
    budgetDetails[key].income.reduce((s, i) => s + i.amount, 0);

  // 建议转账直接引用「预算计算」里展开后的月内支出口径，避免两边口径不一致
  const monthlyExpenseForTransfer = sumDetailExp('monthly');
  const campusShortfallForTransfer = Math.max(budget.needs.campusCard - (current.accounts.campusCard ?? 0), 0);
  const repaymentNeedForTransfer = current.accounts.creditMonthly ?? 0;
  const repaymentShortfallForTransfer = creditInThisMonth
    ? Math.max(repaymentNeedForTransfer - (current.accounts.savingsCard ?? 0) - longBondRepay, 0)
    : 0;
  const livingNeedForTransfer = Math.max(
    monthlyExpenseForTransfer
      - repaymentShortfallForTransfer
      - budget.needs.campusCard,
    0,
  );
  const livingShortfallForTransfer = Math.max(livingNeedForTransfer - (current.accounts.livingBank ?? 0), 0);
  // 校园卡走信用卡，不占工资 → 不计入「收入要补齐」的必要账户
  const essentialTotalForTransfer = repaymentShortfallForTransfer + livingShortfallForTransfer;
  const incomeAvailableForTransfer = current.accounts.incomeBank ?? 0;
  const needsRedemptionForTransfer = Math.max(essentialTotalForTransfer - incomeAvailableForTransfer, 0);
  const incomeAfterEssentialsForTransfer = Math.max(incomeAvailableForTransfer - essentialTotalForTransfer, 0);
  const investForTransfer = Math.round(incomeAfterEssentialsForTransfer * 0.5);
  const consumeTotalForTransfer = incomeAfterEssentialsForTransfer - investForTransfer;
  const wishJarForTransfer = Math.round(consumeTotalForTransfer * 0.8);
  const consumptionForTransfer = consumeTotalForTransfer - wishJarForTransfer;

  // 月内结余结转：月外吸纳月内的本层结余（正→月外收入，负→月外支出）
  const monthlyBalance = sumDetailInc('monthly') - sumDetailExp('monthly');
  if (monthlyBalance >= 0) {
    budgetDetails.beyond.income.unshift({ icon: '🔁', label: '月内结余结转', amount: monthlyBalance, note: '月内 (本月余) 结余' });
  } else {
    budgetDetails.beyond.expense.unshift({ icon: '🔁', label: '月内赤字结转', amount: -monthlyBalance, note: '月内 (本月余) 赤字' });
  }

  const budgetRows: { key: BudgetKey; name: string; inc: number; exp: number }[] = [
    { key: 'weekly',  name: '周内 (近7天)',  inc: sumDetailInc('weekly'),  exp: sumDetailExp('weekly') },
    { key: 'monthly', name: '月内 (本月余)', inc: sumDetailInc('monthly'), exp: sumDetailExp('monthly') },
    { key: 'beyond',  name: '月外 (跨月)',   inc: sumDetailInc('beyond'),  exp: sumDetailExp('beyond') },
  ];

  const [doneSteps, setDoneSteps] = useState<Set<number>>(new Set());
  const toggleDone = (i: number) =>
    setDoneSteps((prev) => { const next = new Set(prev); next.has(i) ? next.delete(i) : next.add(i); return next; });

  // 配平转账拆成独立的「单腿」：每条都是同币种账户互转（或一笔真换汇），可分开调、分开执行
  type FundingLegOp = 'cnyBufferToInvest' | 'investUsdToBuffer' | 'bufferUsdToInvest' | 'investCnyToBuffer' | 'forex';
  type FundingLeg = {
    key: string;
    kind: FundingBadgeKind;
    op: FundingLegOp;
    amountCny: number;
    text: string;
    usdHint?: boolean;
    cnyKey?: keyof AccountSnapshot['accounts'];
    usdKey?: UsdVirtualAccountKey;
  };
  const [localFundingLeg, setLocalFundingLeg] = useState<Record<string, string>>({});
  const fundingLegValue = (key: string) => localFundingLeg[key] ?? '0';
  const setFundingLegValue = (key: string, v: string) => setLocalFundingLeg((p) => ({ ...p, [key]: v }));
  const resetFundingLegs = (legs: FundingLeg[]) =>
    setLocalFundingLeg((p) => { const n = { ...p }; for (const l of legs) n[l.key] = '0'; return n; });

  const rebalanceFundingRows = rebalanceFunding.cnyBufferRows.filter((row) => Math.abs(row.amountCny) >= 0.5);
  const usdReplaceRows = rebalanceFunding.usdReplaceRows.filter((row) => Math.abs(row.amountCny) >= 0.5);
  const usdForexCny = !allowRebalanceSell ? rebalanceFunding.cnyToUsdCny : 0;

  // 每个 buffer 一组转换：人民币腿 + 美元腿（同一笔金额、人民币口径）
  type FundingRow = { key: string; label: string; cnyLeg: FundingLeg; usdLeg: FundingLeg };

  // 理财调拨（人民币加仓）= 美元→人民币：理财卖美元(↓转出)、得人民币(↑进入)
  const cnyFundingRows: FundingRow[] = rebalanceFundingRows.map((row) => ({
    key: row.usdKey,
    label: row.label,
    cnyLeg: { key: `${row.usdKey}__cnyIn`, kind: 'cny', op: 'cnyBufferToInvest', cnyKey: row.cnyKey, amountCny: row.amountCny, text: `人民币${row.label} → 人民币理财` },
    usdLeg: { key: `${row.usdKey}__usdPark`, kind: 'usd', op: 'investUsdToBuffer', usdKey: row.usdKey, amountCny: row.amountCny, usdHint: true, text: `美元理财 → 美元${row.label}（停泊）` },
  }));
  const cnyFundingLegs: FundingLeg[] = cnyFundingRows.flatMap((r) => [r.cnyLeg, r.usdLeg]);

  // 美元调拨（美元加仓）= 人民币→美元：买美元（buffer 对敲假置换 + 真换汇）
  const usdFundingRows: FundingRow[] = usdReplaceRows.map((row) => ({
    key: row.usdKey,
    label: row.label,
    cnyLeg: { key: `${row.usdKey}__cnyComp`, kind: 'cny', op: 'investCnyToBuffer', cnyKey: row.cnyKey, amountCny: row.amountCny, text: `人民币理财 → 人民币${row.label}（补偿）` },
    usdLeg: { key: `${row.usdKey}__usdIn`, kind: 'usd', op: 'bufferUsdToInvest', usdKey: row.usdKey, amountCny: row.amountCny, usdHint: true, text: `美元${row.label} → 美元理财` },
  }));
  const forexLeg: FundingLeg | null = usdForexCny >= 0.5
    ? { key: 'forex', kind: 'forex', op: 'forex', amountCny: usdForexCny, usdHint: true, text: '人民币理财 兑换 美元理财（有手续费）' }
    : null;
  const usdFundingLegs: FundingLeg[] = [
    ...usdFundingRows.flatMap((r) => [r.usdLeg, r.cnyLeg]),
    ...(forexLeg ? [forexLeg] : []),
  ];
  const cnyFundingInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const usdFundingInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const hasCnyFundingChanges = cnyFundingLegs.some((l) => parseAmountPart(fundingLegValue(l.key)) > 0);
  const hasUsdFundingChanges = usdFundingLegs.some((l) => parseAmountPart(fundingLegValue(l.key)) > 0);
  // 执行单腿：每条都是「同币种账户互转」或一笔真换汇，按用户输入金额（人民币口径）落账，受可用额封顶
  const applyFundingLeg = (acc: AccountSnapshot['accounts'], leg: FundingLeg, inputCny: number, rate: number): boolean => {
    if (inputCny <= 0) return false;
    switch (leg.op) {
      case 'cnyBufferToInvest': {  // 人民币 buffer → 人民币理财
        const m = roundMoney(Math.min(inputCny, leg.amountCny, Math.max(acc[leg.cnyKey!] ?? 0, 0)));
        if (m <= 0) return false;
        acc[leg.cnyKey!] = roundMoney((acc[leg.cnyKey!] ?? 0) - m);
        acc.investCnyBank = roundMoney((acc.investCnyBank ?? 0) + m);
        return true;
      }
      case 'investCnyToBuffer': {  // 人民币理财 → 人民币 buffer（补偿）
        const m = roundMoney(Math.min(inputCny, leg.amountCny, Math.max(acc.investCnyBank ?? 0, 0)));
        if (m <= 0) return false;
        acc.investCnyBank = roundMoney((acc.investCnyBank ?? 0) - m);
        acc[leg.cnyKey!] = roundMoney((acc[leg.cnyKey!] ?? 0) + m);
        return true;
      }
      case 'investUsdToBuffer': {  // 美元理财 → 美元 buffer（停泊）
        const t = Math.min(inputCny, leg.amountCny, Math.max(acc.investUsdBank ?? 0, 0) * rate);
        const usd = roundMoney(Math.min(Math.max(acc.investUsdBank ?? 0, 0), t / rate));
        if (usd <= 0) return false;
        acc.investUsdBank = roundMoney((acc.investUsdBank ?? 0) - usd);
        acc[leg.usdKey!] = roundMoney((acc[leg.usdKey!] ?? 0) + usd);
        return true;
      }
      case 'bufferUsdToInvest': {  // 美元 buffer → 美元理财
        const t = Math.min(inputCny, leg.amountCny, Math.max(acc[leg.usdKey!] ?? 0, 0) * rate);
        const usd = roundMoney(Math.min(Math.max(acc[leg.usdKey!] ?? 0, 0), t / rate));
        if (usd <= 0) return false;
        acc[leg.usdKey!] = roundMoney((acc[leg.usdKey!] ?? 0) - usd);
        acc.investUsdBank = roundMoney((acc.investUsdBank ?? 0) + usd);
        return true;
      }
      case 'forex': {  // 人民币理财 兑换 美元理财（真换汇）
        const t = Math.min(inputCny, leg.amountCny, Math.max(acc.investCnyBank ?? 0, 0));
        const usd = roundMoney(t / rate);
        const spent = roundMoney(usd * rate);
        if (usd <= 0 || spent <= 0) return false;
        acc.investCnyBank = roundMoney((acc.investCnyBank ?? 0) - spent);
        acc.investUsdBank = roundMoney((acc.investUsdBank ?? 0) + usd);
        return true;
      }
    }
    return false;
  };
  const executeFundingLegs = (legs: FundingLeg[]) => {
    if (latestUsdRate === null) {
      window.alert('暂无美元汇率，先录入汇率后再执行调拨。');
      return;
    }
    const acc: AccountSnapshot['accounts'] = { ...current.accounts };
    let changed = false;
    for (const leg of legs) {
      if (applyFundingLeg(acc, leg, parseAmountPart(fundingLegValue(leg.key)), latestUsdRate)) changed = true;
    }
    if (!changed) return;
    updateAccounts(acc);
    setLocalAccounts((prev) => ({
      ...prev,
      livingBank: String(acc.livingBank),
      consumptionBank: String(acc.consumptionBank),
      wishJar: String(acc.wishJar),
      investCnyBank: String(acc.investCnyBank),
      usdLivingBank: String(acc.usdLivingBank),
      usdConsumptionBank: String(acc.usdConsumptionBank),
      usdWishJar: String(acc.usdWishJar),
      investUsdBank: String(acc.investUsdBank),
    }));
    resetFundingLegs(legs);
  };
  const fmtLegNeed = (leg: FundingLeg) =>
    leg.usdHint && latestUsdRate !== null ? `≈${fmtUsd(leg.amountCny / latestUsdRate)}` : `¥${fmtInt(leg.amountCny)}`;
  const fmtUsdFromCny = (cny: number) =>
    latestUsdRate !== null ? `≈${fmtUsd(cny / latestUsdRate)}` : `¥${fmtInt(cny)}`;
  const renderLegInput = (
    leg: FundingLeg,
    refs: { current: (HTMLInputElement | null)[] },
    refIndex: number,
  ) => {
    const transferred = parseAmountPart(fundingLegValue(leg.key));
    return (
      <AmountInput
        ref={(el) => { refs.current[refIndex] = el; }}
        value={fundingLegValue(leg.key)}
        onChange={(v) => setFundingLegValue(leg.key, normalizeAmountInput(v))}
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); refs.current[refIndex + 1]?.focus(); } }}
        style={{ width: '100%', border: `1.5px solid ${transferred > 0 ? '#81c995' : '#dadce0'}`, borderRadius: 8, padding: '5px 8px', fontSize: 13, fontWeight: 600, textAlign: 'right', outline: 'none', backgroundColor: transferred > 0 ? '#e6f4ea' : '#fff', color: transferred > 0 ? C.green : '#202124', boxSizing: 'border-box' }}
      />
    );
  };
  const SwapTag = ({ fee }: { fee?: boolean }) => (
    <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, borderRadius: 4, padding: '1px 5px', whiteSpace: 'nowrap',
      color: fee ? '#e8710a' : '#137333', backgroundColor: fee ? '#fef3e8' : '#e6f4ea' }}>
      {fee ? '真换汇·手续费' : '假置换·免手续费'}
    </span>
  );
  // 以「理财」为主体的大色块：人民币理财(绿)/美元理财(蓝)，块内挂各 bucket 小色块
  // dir: 'in'=转入理财(↑)、'out'=转出理财(↓)
  const renderBigBlock = (
    kind: 'cny' | 'usd',
    dir: 'in' | 'out',
    legs: { label: string; leg: FundingLeg }[],
    refs: { current: (HTMLInputElement | null)[] },
    startIndex: number,
  ) => {
    const s = kind === 'cny'
      ? { bg: '#e6f4ea', border: '#ceead6', color: C.green, name: '人民币理财' }
      : { bg: '#e8f0fe', border: '#d2e3fc', color: C.blue, name: '美元理财' };
    return (
      <div style={{ backgroundColor: s.bg, border: `1px solid ${s.border}`, borderRadius: 12, padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: s.color }}>{s.name}</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: s.color }}>{dir === 'in' ? '↑ 转入理财' : '↓ 转出理财'}</span>
        </div>
        {legs.map(({ label, leg }, j) => {
          const remain = Math.max(leg.amountCny - parseAmountPart(fundingLegValue(leg.key)), 0);
          return (
            <div key={leg.key} style={{ backgroundColor: '#fff', borderRadius: 8, padding: '5px 7px' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 4, marginBottom: 3 }}>
                <span style={{ fontSize: 11, color: C.sub, fontWeight: 600 }}>{label}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: s.color, fontVariantNumeric: 'tabular-nums' }}>{fmtLegNeed(leg)}</span>
              </div>
              {renderLegInput(leg, refs, startIndex + j)}
              {remain >= 1 && <div style={{ fontSize: 10, color: C.orange, textAlign: 'right', marginTop: 2 }}>还需¥{fmtInt(remain)}</div>}
            </div>
          );
        })}
      </div>
    );
  };
  // 真换汇：人民币理财 ——转¥X——→ 美元理财（buffer 美元为 0 时的直接换汇，无 bucket）
  const renderForexArrow = (leg: FundingLeg, refs: { current: (HTMLInputElement | null)[] }, refIndex: number) => {
    const remain = Math.max(leg.amountCny - parseAmountPart(fundingLegValue(leg.key)), 0);
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', columnGap: 8 }}>
        <div style={{ backgroundColor: '#e6f4ea', border: '1px solid #ceead6', borderRadius: 12, padding: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: C.green, marginBottom: 4 }}>人民币理财</div>
          {renderLegInput(leg, refs, refIndex)}
          {remain >= 1 && <div style={{ fontSize: 10, color: C.orange, textAlign: 'right', marginTop: 2 }}>还需¥{fmtInt(remain)}</div>}
        </div>
        <div style={{ textAlign: 'center', minWidth: 58 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: C.orange, lineHeight: 1 }}>→</div>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.orange, fontVariantNumeric: 'tabular-nums' }}>转¥{fmtInt(leg.amountCny)}</div>
          <div style={{ fontSize: 9, color: C.sub }}>真换汇·手续费</div>
        </div>
        <div style={{ backgroundColor: '#e8f0fe', border: '1px solid #d2e3fc', borderRadius: 12, padding: 8, alignSelf: 'stretch', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: C.blue, marginBottom: 4 }}>美元理财</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.blue, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtUsdFromCny(leg.amountCny)}</div>
        </div>
      </div>
    );
  };
  const dramTone: Record<DramDecisionKind, { bg: string; border: string; color: string }> = {
    clear: { bg: '#fce8e6', border: '#f28b82', color: C.red },
    trim: { bg: '#fff4e5', border: '#fbbc04', color: C.orange },
    pause: { bg: '#fff4e5', border: '#fbbc04', color: C.orange },
    buy: { bg: '#e6f4ea', border: '#81c995', color: C.green },
    hold: { bg: '#e8f0fe', border: '#a8c7fa', color: C.blue },
    wait: { bg: '#f8f9fa', border: '#dadce0', color: C.sub },
  };
  const activeDramTone = dramTone[dramDecision?.kind ?? 'wait'];
  const updateDramField = (field: 'shares' | 'costPrice', value: string) => {
    const next = normalizeAmountInput(value);
    setDramConfigInputs((prev) => ({ ...prev, [field]: next }));
  };

  const ALL_STEPS = [
    { label: '日历标记',   note: '标记本月各天状态',   monthEndOnly: false, action: () => navigate('/calendar') },
    { label: '更新余额',   note: '填写各账户最新余额', monthEndOnly: false, action: () => document.getElementById('sec-accounts')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) },
    { label: '预算计算',   note: '查看三层预算明细',   monthEndOnly: false, action: () => document.getElementById('sec-budget')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) },
    { label: '执行转账',   note: '划转资金到各账户',   monthEndOnly: false, action: () => document.getElementById('sec-transfer')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) },
    { label: '理财再平衡', note: '按比例投入新资金',   monthEndOnly: true,  action: () => document.getElementById('sec-invest')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) },
    { label: '历史记录',   note: '录入本月收支数据',   monthEndOnly: true,  action: () => navigate('/calendar?tab=year') },
  ];
  const STEPS = ALL_STEPS.filter((s) => !s.monthEndOnly || isMonthStartMode);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, margin: '0 0 4px' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>对账 / 转账</h1>
        <button
          onClick={() => {
            setGroupedTargetInputs(groupedTargetInputFromConfig(effectiveInvestTargets(config.investAllocTargets)));
            setSettingsOpen(true);
          }}
          style={{ fontSize: 16, background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px', color: C.sub, lineHeight: 1 }}
        >
          ⚙️
        </button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 13, color: C.sub, margin: '0 0 16px' }}>
        <span>今天 {today.getFullYear()}-{String(today.getMonth()+1).padStart(2,'0')}-{String(today.getDate()).padStart(2,'0')}，对账模式</span>
        <div role="group" aria-label="对账模式" style={{ display: 'inline-flex', border: '1px solid #d2e3fc', borderRadius: 8, overflow: 'hidden', backgroundColor: '#fff' }}>
          {RECONCILE_MODES.map((mode) => {
            const active = reconcileMode === mode.key;
            return (
              <button
                key={mode.key}
                type="button"
                onClick={() => setReconcileMode(mode.key)}
                title={`${mode.label}模式：${mode.hint}`}
                aria-pressed={active}
                style={{
                  border: 'none',
                  borderRight: mode.key === 'monthStart' ? '1px solid #d2e3fc' : 'none',
                  backgroundColor: active ? C.blue : '#fff',
                  color: active ? '#fff' : C.blue,
                  padding: '4px 10px',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {mode.label}
              </button>
            );
          })}
        </div>
      </div>
      {settingsOpen && (
        <RebalanceSettingsModal
          groupedTargetInputs={groupedTargetInputs}
          setGroupedTargetInputs={setGroupedTargetInputs}
          onRevealConsumptionWish={() => {
            revealUsdAccount('usdConsumptionBank');
            revealUsdAccount('usdWishJar');
            setConsumptionWishOpen(true);
            setRevealConsumptionWishUsd(true);
            setSettingsOpen(false);
          }}
          onHideConsumptionWish={() => {
            hideConsumptionWishAccounts();
            setSettingsOpen(false);
          }}
          onClose={() => setSettingsOpen(false)}
          onSave={() => {
            const investAllocTargets = groupedTargetInputsToConfig(groupedTargetInputs);
            setConfig({ investAllocTargets });
            setSettingsOpen(false);
          }}
        />
      )}
      {holidayWarning && (
        <div style={{ margin: '0 0 16px', fontSize: 12, color: C.orange, backgroundColor: '#fff4e8', border: '1px solid #fed7aa', borderRadius: 10, padding: '8px 10px' }}>
          {holidayWarning}
        </div>
      )}

      {/* 对账流程引导 */}
      <Card title="对账流程" collapsible defaultCollapsed>
        {STEPS.map((step, i) => {
          const done = doneSteps.has(i);
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: i < STEPS.length - 1 ? '1px solid #f1f3f4' : 'none' }}>
              {/* 完成键 */}
              <button
                onClick={() => toggleDone(i)}
                style={{
                  flexShrink: 0, width: 22, height: 22, borderRadius: '50%',
                  border: `2px solid ${done ? C.green : '#dadce0'}`,
                  backgroundColor: done ? C.green : '#fff',
                  color: '#fff', fontSize: 12, fontWeight: 700,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                {done ? '✓' : ''}
              </button>
              {/* 文字 */}
              <div style={{ flex: 1, opacity: done ? 0.45 : 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#202124', textDecoration: done ? 'line-through' : 'none' }}>{step.label}</div>
                <div style={{ fontSize: 11, color: C.sub }}>{step.note}</div>
              </div>
              {/* 跳转键 */}
              <button
                onClick={step.action}
                style={{ flexShrink: 0, fontSize: 12, color: C.blue, backgroundColor: '#e8f0fe', border: 'none', borderRadius: 8, padding: '5px 12px', cursor: 'pointer', fontWeight: 600 }}
              >
                前往 →
              </button>
            </div>
          );
        })}
      </Card>

      {/* 账户余额 */}
      <div id="sec-accounts">
      <Card title="账户余额" subtitle="填写各账户当前实际余额，回车跳下一项">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: C.sub, backgroundColor: '#f8f9fa', borderRadius: 8, padding: '6px 10px' }}>
            <span>美元汇率</span>
            <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
              {latestUsdRate !== null ? `$1 ≈ ¥${latestUsdRate.toFixed(4)} · ${usdRateLabel}` : usdRateLabel}
            </span>
          </div>

          {/* 信用卡：总待还 + 本期待还 */}
          <div style={{ backgroundColor: '#fce8e6', borderRadius: 12, padding: '10px 14px', border: '1.5px solid #f28b82' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#202124', marginBottom: 8 }}>💳 信用卡</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {([
                { key: 'credit',        label: '总待还',   idx: 0 },
                ...(showCreditMonthlyInput ? [{ key: 'creditMonthly', label: '本期待还', idx: 1 } as const] : []),
                { key: 'savingsCard',   label: '储蓄卡',   idx: 2 },
              ] as const).map(({ key, label, idx }) => (
                <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13, color: '#5f6368' }}>{label}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: '#c5221f' }}>¥</span>
                    <AmountInput
                      ref={(el) => { accountInputRefs.current[idx] = el; }}
                      value={localAccounts[key]}
                      onChange={(v) => setLocalAccounts((p) => ({ ...p, [key]: /^-?0\d/.test(v) ? (v.replace(/^(-?)0+/, '$1') || '0') : v }))}
                      onFocus={(e) => e.target.select()}
                      onBlur={() => syncAccounts()}
                      onKeyDown={(e) => { if (e.key === 'Enter') { syncAccounts(); focusNextAccount(idx); } }}
                      style={{ width: 100, border: 'none', outline: 'none', backgroundColor: 'transparent', fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: '#c5221f', textAlign: 'right' }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 校园卡 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fff8e1', borderRadius: 12, padding: '10px 14px', border: '1.5px solid #ffe082' }}>
            <span style={{ fontSize: 14, color: '#202124', fontWeight: 500 }}>🎓 校园卡</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#f57c00' }}>¥</span>
              <AmountInput
                ref={(el) => { accountInputRefs.current[3] = el; }}
                value={localAccounts.campusCard}
                onChange={(v) => setLocalAccounts((p) => ({ ...p, campusCard: /^-?0\d/.test(v) ? (v.replace(/^(-?)0+/, '$1') || '0') : v }))}
                onFocus={(e) => e.target.select()}
                onBlur={() => syncAccounts()}
                onKeyDown={(e) => { if (e.key === 'Enter') { syncAccounts(); focusNextAccount(3); } }}
                style={{ width: 100, border: 'none', outline: 'none', backgroundColor: 'transparent', fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: '#f57c00', textAlign: 'right' }}
              />
            </div>
          </div>

          {([
            { cnyKey: 'livingBank', usdKey: 'usdLivingBank', label: '🏦 生活', cnyIdx: 4, usdIdx: 5, color: '#1a73e8', bg: '#e8f0fe', border: '#a8c7fa' },
          ] as const).map(({ cnyKey, usdKey, label, cnyIdx, usdIdx, color, bg, border }) => (
            <div key={cnyKey} {...makeUsdSwipeHandlers(usdKey)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, backgroundColor: bg, borderRadius: 12, padding: '10px 14px', border: `1.5px solid ${border}`, touchAction: 'pan-y' }}>
              <div>
                <div style={{ fontSize: 14, color: '#202124', fontWeight: 500 }}>{label}</div>
                <div style={{ fontSize: 11, color: C.sub, marginTop: 2 }}>
                  {latestUsdRate !== null ? `$≈¥${fmtInt((current.accounts[usdKey] ?? 0) * latestUsdRate)}` : '暂无汇率'}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color }}>¥</span>
                  <AmountInput
                    ref={(el) => { accountInputRefs.current[cnyIdx] = el; }}
                    value={localAccounts[cnyKey]}
                    onChange={(v) => setLocalAccounts((p) => ({ ...p, [cnyKey]: normalizeAmountInput(v) }))}
                    onFocus={(e) => e.target.select()}
                    onBlur={() => syncAccounts()}
                    onKeyDown={(e) => { if (e.key === 'Enter') { syncAccounts(); focusNextAccount(cnyIdx); } }}
                    style={{ width: 74, border: 'none', outline: 'none', backgroundColor: 'transparent', borderBottom: `1px solid ${color}`, fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color, textAlign: 'right' }}
                  />
                </div>
                {showUsdAccount(usdKey) && <span style={{ color: C.sub, fontSize: 13 }}>·</span>}
                {showUsdAccount(usdKey) && <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: C.blue }}>$</span>
                  <AmountInput
                    ref={(el) => { accountInputRefs.current[usdIdx] = el; }}
                    value={localAccounts[usdKey]}
                    onChange={(v) => setLocalAccounts((p) => ({ ...p, [usdKey]: normalizeAmountInput(v) }))}
                    onFocus={(e) => e.target.select()}
                    onBlur={() => { syncAccounts(); hideUsdAccount(usdKey); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { syncAccounts(); focusNextAccount(usdIdx); } }}
                    style={{ width: 68, border: 'none', outline: 'none', backgroundColor: 'transparent', borderBottom: `1px solid ${C.blue}`, fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: C.blue, textAlign: 'right' }}
                  />
                </div>}
              </div>
            </div>
          ))}

          {/* 收入账户 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#e6f4ea', borderRadius: 12, padding: '10px 14px', border: '1.5px solid #81c995' }}>
            <span style={{ fontSize: 14, color: '#202124', fontWeight: 500 }}>💰 收入</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#188038' }}>¥</span>
              <AmountInput
                ref={(el) => { accountInputRefs.current[6] = el; }}
                value={localAccounts.incomeBank}
                onChange={(v) => setLocalAccounts((p) => ({ ...p, incomeBank: /^-?0\d/.test(v) ? (v.replace(/^(-?)0+/, '$1') || '0') : v }))}
                onFocus={(e) => e.target.select()}
                onBlur={() => syncAccounts()}
                onKeyDown={(e) => { if (e.key === 'Enter') { syncAccounts(); focusNextAccount(6); } }}
                style={{ width: 100, border: 'none', outline: 'none', backgroundColor: 'transparent', fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: '#188038', textAlign: 'right' }}
              />
            </div>
          </div>

          {([
            { usdKey: 'usdConsumptionBank', label: '💼 消费', usdIdx: 8, bg: '#f3e8ff', border: '#c4b5fd' },
          ] as const).map(({ usdKey, label, usdIdx, bg, border }) => (
            (showUsdAccount(usdKey) || showUsdAccount('usdWishJar')) && (
            <Fragment key={usdKey}>
              <div {...makeUsdSwipeHandlers(usdKey)} style={{ touchAction: 'pan-y', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, backgroundColor: bg, borderRadius: 12, padding: '10px 14px', border: `1.5px solid ${border}` }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 14, color: '#202124', fontWeight: 500 }}>{label}</span>
                    <button
                      type="button"
                      onClick={() => setConsumptionWishOpen((v) => !v)}
                      style={{ border: 'none', background: 'transparent', color: C.sub, cursor: 'pointer', padding: '1px 4px', fontSize: 11, lineHeight: 1, transform: consumptionWishOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}
                      title="展开心愿"
                    >
                      ▼
                    </button>
                  </div>
                  <div style={{ fontSize: 11, color: C.sub, marginTop: 2 }}>
                    {latestUsdRate !== null ? `$≈¥${fmtInt((current.accounts[usdKey] ?? 0) * latestUsdRate)}` : '暂无汇率'}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  {showUsdAccount(usdKey) && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: C.blue }}>$</span>
                      <AmountInput
                        ref={(el) => { accountInputRefs.current[usdIdx] = el; }}
                        value={localAccounts[usdKey]}
                        onChange={(v) => setLocalAccounts((p) => ({ ...p, [usdKey]: normalizeAmountInput(v) }))}
                        onFocus={(e) => e.target.select()}
                        onBlur={() => { syncAccounts(); hideUsdAccount(usdKey); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') { syncAccounts(); focusNextAccount(usdIdx); } }}
                        style={{ width: 82, border: 'none', outline: 'none', backgroundColor: 'transparent', borderBottom: `1px solid ${C.blue}`, fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: C.blue, textAlign: 'right' }}
                      />
                    </div>
                  )}
                </div>
              </div>
              {(consumptionWishOpen || showUsdAccount('usdWishJar')) && (
                <div {...makeUsdSwipeHandlers('usdWishJar')} style={{ marginTop: -4, marginLeft: 16, touchAction: 'pan-y', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, backgroundColor: '#fff7ed', borderRadius: 10, padding: '8px 12px', border: '1px solid #fed7aa' }}>
                  <div>
                    <div style={{ fontSize: 13, color: '#202124', fontWeight: 500 }}>🏺 心愿</div>
                    <div style={{ fontSize: 11, color: C.sub, marginTop: 2 }}>
                      {latestUsdRate !== null ? `$≈¥${fmtInt((current.accounts.usdWishJar ?? 0) * latestUsdRate)}` : '暂无汇率'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: C.blue }}>$</span>
                    <AmountInput
                      ref={(el) => { accountInputRefs.current[9] = el; }}
                      value={localAccounts.usdWishJar}
                      onChange={(v) => setLocalAccounts((p) => ({ ...p, usdWishJar: normalizeAmountInput(v) }))}
                      onFocus={(e) => e.target.select()}
                      onBlur={() => { syncAccounts(); hideUsdAccount('usdWishJar'); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') { syncAccounts(); focusNextAccount(9); } }}
                      style={{ width: 82, border: 'none', outline: 'none', backgroundColor: 'transparent', borderBottom: `1px solid ${C.blue}`, fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: C.blue, textAlign: 'right' }}
                    />
                  </div>
                </div>
              )}
            </Fragment>
            )
          ))}

        </div>
      </Card>
      </div>

      {/* Step 1: 预算计算 */}
      <div id="sec-budget">
      <Card title="① 预算计算" subtitle="点击行查看明细">
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.sub, marginBottom: 12 }}>
          <span>本月剩余 {budget.daysLeftInMonth} 天</span>
          <span>
            {(['school', 'intern', 'home', 'travel'] as TagKind[]).map((k, i) => (
              <span key={k}>{i > 0 ? ' · ' : ''}{tagMeta[k].icon}{tagMeta[k].label} {budget.stateDaysLeft[k]}</span>
            ))}
          </span>
        </div>

        {budgetRows.map((row, i) => {
          const isOpen = expandedBudget === row.key;
          const detail = budgetDetails[row.key];
          const balance = row.inc - row.exp;
          return (
            <div key={row.key} style={{ marginBottom: 4 }}>
              <button
                onClick={() => setExpandedBudget(isOpen ? null : row.key)}
                style={{
                  width: '100%', display: 'grid', gridTemplateColumns: '1fr minmax(0, 70px) minmax(0, 70px) 1px minmax(0, 80px) 20px',
                  alignItems: 'center', gap: 4, padding: '10px 10px', borderRadius: 10,
                  border: 'none', cursor: 'pointer', textAlign: 'left',
                  backgroundColor: isOpen ? '#e8f0fe' : i % 2 === 0 ? '#fafafa' : '#fff',
                  transition: 'background-color 0.15s',
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 600, color: isOpen ? C.blue : '#202124' }}>{row.name}</span>
                <span style={{ fontSize: 12, color: C.red, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>+¥{formatCurrency(row.inc)}</span>
                <span style={{ fontSize: 12, color: C.green, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>-¥{formatCurrency(row.exp)}</span>
                <span style={{ width: 1, height: 16, backgroundColor: '#dadce0', justifySelf: 'center' }} />
                <span style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums', textAlign: 'right', color: balance >= 0 ? C.red : C.green }}>
                  {balance >= 0 ? '+' : '-'}¥{formatCurrency(Math.abs(balance))}
                </span>
                <span style={{ fontSize: 11, color: C.sub, textAlign: 'center', display: 'inline-block', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▼</span>
              </button>

              {isOpen && (
                <div style={{ margin: '2px 0 8px', border: '1.5px solid #c5d9f8', borderRadius: 10, backgroundColor: '#f8fbff', overflow: 'hidden' }}>
                  {detail.income.length > 0 && (
                    <div style={{ padding: '10px 14px 6px' }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: C.red, marginBottom: 6 }}>收入来源</div>
                      {detail.income.map((item) => (
                        <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                          <div><span style={{ fontSize: 13 }}>{item.icon} {item.label}</span>
                            {item.note && <span style={{ fontSize: 11, color: C.sub, marginLeft: 6 }}>{item.note}</span>}
                          </div>
                          <span style={{ fontSize: 13, fontWeight: 500, color: C.red, fontVariantNumeric: 'tabular-nums' }}>+¥{formatCurrency(item.amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ height: 1, backgroundColor: '#dbe8fb' }} />
                  {detail.expense.length > 0 && (
                    <div style={{ padding: '6px 14px 10px' }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: C.green, marginBottom: 6 }}>支出去向</div>
                      {detail.expense.map((item) => (
                        <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                          <div><span style={{ fontSize: 13 }}>{item.icon} {item.label}</span>
                            {item.note && <span style={{ fontSize: 11, color: C.sub, marginLeft: 6 }}>{item.note}</span>}
                          </div>
                          <span style={{ fontSize: 13, fontWeight: 500, color: C.green, fontVariantNumeric: 'tabular-nums' }}>-¥{formatCurrency(item.amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 14px', backgroundColor: balance >= 0 ? '#fce8e6' : '#e6f4ea', fontSize: 13, fontWeight: 600 }}>
                    <span style={{ color: C.sub }}>本层结余</span>
                    <span style={{ color: balance >= 0 ? C.red : C.green, fontVariantNumeric: 'tabular-nums' }}>
                      {balance >= 0 ? '+' : '-'}¥{formatCurrency(Math.abs(balance))}
                    </span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </Card>
      </div>

      {/* Step 2: 建议转账 */}
      <div id="sec-transfer">
      <Card title="② 建议转账" subtitle="收入优先补齐必要账户，剩余转入人民币理财账户">

        {/* 收入资金流向概览 */}
        {needsRedemptionForTransfer > 0 ? (
          <div style={{ backgroundColor: '#fce8e6', border: '1px solid #f28b82', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 13 }}>
            ⚠️ 收入账户 <b>¥{fmtInt(current.accounts.incomeBank ?? 0)}</b> 不足以补齐必要账户，建议赎回理财 <b style={{ color: C.red }}>¥{fmtInt(needsRedemptionForTransfer)}</b>
          </div>
        ) : (
          <div style={{ backgroundColor: '#e6f4ea', border: '1px solid #81c995', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 13 }}>
            💰 收入账户 <b>¥{fmtInt(current.accounts.incomeBank ?? 0)}</b>
          </div>
        )}

        {/* 统一转账列表 */}
        {(() => {
          const transferRows: { key: TransferKey; rec: number; calc: string }[] = [
            {
              key: 'campusCard',
              rec: campusShortfallForTransfer,
              calc: `月需¥${fmtInt(budget.needs.campusCard)}（${budget.stateDaysLeft.school}天×¥${Math.round(stats.schoolDailyAvg)}/天）− 余¥${fmtInt(current.accounts.campusCard ?? 0)}`,
            },
            ...(creditInThisMonth ? [{
              key: 'repayment' as TransferKey,
              rec: repaymentShortfallForTransfer,
              calc: `本期待还¥${fmtInt(repaymentNeedForTransfer)} − 储蓄卡¥${fmtInt(current.accounts.savingsCard ?? 0)}${longBondRepay > 0 ? ` − 长债¥${fmtInt(longBondRepay)}（超1万部分赎回）` : ''}`,
            }] : []),
            {
              key: 'living',
              rec: livingShortfallForTransfer,
              calc: creditInThisMonth
                ? `月需¥${fmtInt(livingNeedForTransfer)}（月内支出¥${fmtInt(monthlyExpenseForTransfer)} − 还款¥${fmtInt(repaymentShortfallForTransfer)} − 校园卡¥${fmtInt(budget.needs.campusCard)}）− 余¥${fmtInt(current.accounts.livingBank ?? 0)}`
                : `月需¥${fmtInt(livingNeedForTransfer)}（月内支出¥${fmtInt(monthlyExpenseForTransfer)} − 校园卡¥${fmtInt(budget.needs.campusCard)}）− 余¥${fmtInt(current.accounts.livingBank ?? 0)}`,
            },
            {
              key: 'consumption',
              rec: consumptionForTransfer,
              calc: `可分配¥${fmtInt(incomeAfterEssentialsForTransfer)}×50%消费×20%`,
            },
            {
              key: 'wishJar',
              rec: wishJarForTransfer,
              calc: `可分配¥${fmtInt(incomeAfterEssentialsForTransfer)}×50%消费×80%`,
            },
            {
              key: 'invest',
              rec: investForTransfer,
              calc: `可分配¥${fmtInt(incomeAfterEssentialsForTransfer)}×50%`,
            },
          ];
          return transferRows.map((row, i) => {
            const transferred = parseFloat(localTransferred[row.key] || '0') || 0;
            const remain = Math.max(row.rec - transferred, 0);
            const header = row.key === 'campusCard'
              ? { label: '补充必要', amount: essentialTotalForTransfer, color: C.blue }
              : row.key === 'consumption'
                ? { label: '可分配', amount: incomeAfterEssentialsForTransfer, color: C.green }
                : null;
            return (
              <Fragment key={row.key}>
                {header && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: i === 0 ? 0 : 10, marginBottom: 4, fontSize: 12, color: C.sub, fontWeight: 600 }}>
                    <span>{header.label}</span>
                    <span style={{ color: header.color, fontVariantNumeric: 'tabular-nums' }}>¥{fmtInt(header.amount)}</span>
                    <div style={{ flex: 1, borderBottom: '1px dashed #dadce0' }} />
                  </div>
                )}
              <div style={{ backgroundColor: i % 2 === 0 ? '#fafafa' : '#fff', borderRadius: 10, padding: '10px 12px', marginBottom: 4 }}>
                {/* 第一行：名称 | 需转 | 还需 | 已转 | 输入（grid 固定列宽） */}
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(40px, 1fr) minmax(0, 90px) minmax(0, 80px) 26px minmax(60px, 80px)', alignItems: 'center', columnGap: 4 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap' }}>{TRANSFER_META[row.key].label}</span>
                  <span
                    onClick={() => setExpandedTransfer((prev) => (prev === row.key ? null : row.key))}
                    style={{ fontSize: 12, color: C.blue, fontWeight: 600, fontVariantNumeric: 'tabular-nums', cursor: 'pointer', userSelect: 'none', textAlign: 'right', whiteSpace: 'nowrap' }}
                  >需¥{fmtInt(row.rec)} {expandedTransfer === row.key ? '▾' : '▸'}</span>
                  <span style={{ fontSize: 12, color: C.orange, fontWeight: 600, fontVariantNumeric: 'tabular-nums', textAlign: 'right', whiteSpace: 'nowrap' }}>还需¥{fmtInt(remain)}</span>
                  <span style={{ fontSize: 12, color: C.sub, textAlign: 'right' }}>已转</span>
                  <AmountInput
                    ref={(el) => { transferInputRefs.current[i] = el; }}
                    value={localTransferred[row.key]}
                    onChange={(v) => setLocalTransferred((p) => ({ ...p, [row.key]: /^-?0\d/.test(v) ? (v.replace(/^(-?)0+/, '$1') || '0') : v }))}
                    onFocus={(e) => e.target.select()}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); transferInputRefs.current[i + 1]?.focus(); } }}
                    style={{ width: '100%', border: `1.5px solid ${transferred > 0 ? '#81c995' : '#dadce0'}`, borderRadius: 8, padding: '5px 8px', fontSize: 13, fontWeight: 600, textAlign: 'right', outline: 'none', backgroundColor: transferred > 0 ? '#e6f4ea' : '#fff', color: transferred > 0 ? C.green : '#202124', boxSizing: 'border-box' }}
                  />
                </div>
                {/* 第二行：计算说明（点击"需¥"展开） */}
                {expandedTransfer === row.key && (
                  <div style={{ fontSize: 11, color: C.sub, marginTop: 4 }}>{row.calc}</div>
                )}
                {/* 长债超 1 万部分赎回还款：一键 长债↓ → 储蓄卡↑ */}
                {row.key === 'repayment' && longBondRepay > 0 && (
                  <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, backgroundColor: '#e6f4ea', border: '1px solid #81c995', borderRadius: 8, padding: '8px 10px' }}>
                    <span style={{ fontSize: 12, color: '#188038', lineHeight: 1.4 }}>
                      🟢 赎回长债 <b style={{ fontVariantNumeric: 'tabular-nums' }}>¥{fmtInt(longBondRepay)}</b> → 储蓄卡<br />
                      <span style={{ fontSize: 11, color: C.sub }}>长债¥{fmtInt(longBondTotalForRepay)}超1万部分</span>
                    </span>
                    <button
                      onClick={handleRedeemLongBond}
                      style={{ flexShrink: 0, backgroundColor: C.green, color: '#fff', fontWeight: 700, fontSize: 12, padding: '7px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}
                    >✓ 赎回还款</button>
                  </div>
                )}
              </div>
              </Fragment>
            );
          });
        })()}

        <button
          onClick={handleExecuteAll}
          disabled={!hasTransferChanges}
          style={{
            width: '100%', marginTop: 14,
            backgroundColor: hasTransferChanges ? C.green : '#e8eaed',
            color: hasTransferChanges ? '#fff' : C.sub,
            fontWeight: 700, fontSize: 15, padding: '13px 0',
            borderRadius: 12, border: 'none',
            cursor: hasTransferChanges ? 'pointer' : 'default',
            transition: 'background-color 0.2s', letterSpacing: 1,
          }}
        >
          ✓ 一键执行转账
        </button>
      </Card>
      </div>

      {/* Step 3: 理财配置 & 再平衡 */}
      <div id="sec-invest">
      <Card title="③ 理财配置 & 再平衡" subtitle="编辑持仓金额，可选择仅加仓或加减仓换仓">
        {/* 本次投入 */}
        <div {...makeUsdSwipeHandlers('investUsdBank')} style={{ touchAction: 'pan-y', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, border: '1.5px solid #fbbf24', borderRadius: 10, padding: '10px 12px', backgroundColor: '#fffbeb', marginBottom: 14 }}>
          {([
            { cnyKey: 'investCnyBank', usdKey: 'investUsdBank', cnyIdx: 10, usdIdx: 11, color: C.orange },
          ] as const).map(({ cnyKey, usdKey, cnyIdx, usdIdx, color }) => (
            <Fragment key={cnyKey}>
              <div>
                <div style={{ fontSize: 14, color: '#202124', fontWeight: 700 }}>本次投入</div>
                <div style={{ fontSize: 11, color: C.sub, marginTop: 2 }}>
                  合计 ¥{fmtInt(rebalanceNewFunds)}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: C.sub }}>境内</span>
                  <span style={{ fontSize: 14, fontWeight: 600, color }}>¥</span>
                  <AmountInput
                    ref={(el) => { accountInputRefs.current[cnyIdx] = el; }}
                    value={localAccounts[cnyKey]}
                    onChange={(v) => setLocalAccounts((p) => ({ ...p, [cnyKey]: normalizeAmountInput(v) }))}
                    onFocus={(e) => e.target.select()}
                    onBlur={() => syncAccounts()}
                    onKeyDown={(e) => { if (e.key === 'Enter') { syncAccounts(); focusNextAccount(cnyIdx); } }}
                    style={{ width: 74, border: 'none', outline: 'none', backgroundColor: 'transparent', borderBottom: `1px solid ${color}`, fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color, textAlign: 'right' }}
                  />
                </div>
                {showUsdAccount(usdKey) && (
                  <>
                    <span style={{ color: C.sub, fontSize: 13 }}>·</span>
                    {investUsdInputMode === 'usd' ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: C.sub }}>境外</span>
                        <button
                          type="button"
                          onClick={() => switchInvestUsdInputMode('cny')}
                          style={{ border: 'none', background: 'transparent', padding: 0, fontSize: 14, fontWeight: 700, color: C.blue, cursor: 'pointer' }}
                          aria-label="切换境外投入为人民币折算"
                        >
                          $
                        </button>
                        <AmountInput
                          ref={(el) => { accountInputRefs.current[usdIdx] = el; }}
                          value={localAccounts[usdKey]}
                          onChange={(v) => setLocalAccounts((p) => ({ ...p, [usdKey]: normalizeAmountInput(v) }))}
                          onFocus={(e) => e.target.select()}
                          onBlur={() => { syncAccounts(); hideUsdAccount(usdKey); }}
                          onKeyDown={(e) => { if (e.key === 'Enter') { syncAccounts(); holdingInputRefs.current[0]?.focus(); } }}
                          style={{ width: 68, border: 'none', outline: 'none', backgroundColor: 'transparent', borderBottom: `1px solid ${C.blue}`, fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: C.blue, textAlign: 'right' }}
                        />
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: C.sub }}>境外</span>
                        <button
                          type="button"
                          onClick={() => switchInvestUsdInputMode('usd')}
                          style={{ border: 'none', background: 'transparent', padding: 0, fontSize: 14, fontWeight: 700, color: C.blue, cursor: 'pointer' }}
                          aria-label="切换境外投入为美元编辑"
                        >
                          $
                        </button>
                        <span style={{ fontSize: 14, fontWeight: 600, color: C.blue }}>¥</span>
                        {latestUsdRate !== null ? (
                          <AmountInput
                            ref={(el) => { accountInputRefs.current[usdIdx] = el; }}
                            value={investUsdCnyInput}
                            onChange={(v) => setInvestUsdCnyInput(normalizeAmountInput(v))}
                            onFocus={(e) => e.target.select()}
                            onBlur={() => { commitInvestUsdCnyInput(); hideUsdAccount(usdKey); }}
                            onKeyDown={(e) => { if (e.key === 'Enter') { commitInvestUsdCnyInput(); holdingInputRefs.current[0]?.focus(); } }}
                            style={{ width: 74, border: 'none', outline: 'none', backgroundColor: 'transparent', borderBottom: `1px solid ${C.blue}`, fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: C.blue, textAlign: 'right' }}
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => switchInvestUsdInputMode('usd')}
                            style={{ border: 'none', background: 'transparent', padding: 0, fontSize: 13, fontWeight: 700, color: C.orange, cursor: 'pointer' }}
                          >
                            暂无汇率
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </Fragment>
          ))}
        </div>
        <div style={{ border: `1.5px solid ${activeDramTone.border}`, borderRadius: 12, padding: '10px 12px', backgroundColor: activeDramTone.bg, marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 14, color: '#202124', fontWeight: 800 }}>DRAM 决策树</div>
              <div style={{ fontSize: 11, color: C.sub, marginTop: 2 }}>
                用美股总仓位做分母 · 每周检查一次
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ display: 'inline-flex', borderRadius: 999, padding: '3px 9px', backgroundColor: '#fff', color: activeDramTone.color, fontSize: 12, fontWeight: 800, border: `1px solid ${activeDramTone.border}` }}>
                {dramChartLoading ? '加载中' : dramDecision?.headline ?? (dramChartError ? '价格失败' : '等待价格')}
              </div>
              <div style={{ fontSize: 10, color: C.sub, marginTop: 3 }}>
                {dramDecision ? `${dramDecision.latestDate} · ${dramChart?.source ?? '市场数据'}` : dramChartError ? '稍后重试' : dramConfig.symbol}
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <label style={{ backgroundColor: '#fff', borderRadius: 8, padding: '7px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 12, color: C.sub, fontWeight: 700 }}>股数</span>
              <AmountInput
                value={dramConfigInputs.shares}
                onChange={(v) => updateDramField('shares', v)}
                onFocus={(e) => e.target.select()}
                onBlur={() => commitDramConfig()}
                style={{ width: 78, border: 'none', borderBottom: '1px solid #dadce0', outline: 'none', backgroundColor: 'transparent', fontSize: 13, fontWeight: 700, textAlign: 'right', color: '#202124', fontVariantNumeric: 'tabular-nums' }}
              />
            </label>
            <label style={{ backgroundColor: '#fff', borderRadius: 8, padding: '7px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 12, color: C.sub, fontWeight: 700 }}>成本价</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <span style={{ fontSize: 12, color: C.sub, fontWeight: 700 }}>$</span>
                <AmountInput
                  value={dramConfigInputs.costPrice}
                  onChange={(v) => updateDramField('costPrice', v)}
                  onFocus={(e) => e.target.select()}
                  onBlur={() => commitDramConfig()}
                  style={{ width: 68, border: 'none', borderBottom: '1px solid #dadce0', outline: 'none', backgroundColor: 'transparent', fontSize: 13, fontWeight: 700, textAlign: 'right', color: '#202124', fontVariantNumeric: 'tabular-nums' }}
                />
              </div>
            </label>
          </div>

          {dramDecision ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6, marginBottom: 8 }}>
                {[
                  { label: '现价', value: fmtDollar(dramDecision.latestPrice), color: '#202124' },
                  { label: '成本盈亏', value: fmtPct(dramDecision.costProfitRate), color: (dramDecision.costProfitRate ?? 0) >= 0 ? C.red : C.green },
                  { label: '占美股', value: fmtPct(dramDecision.weight), color: (dramDecision.weight ?? 0) > dramConfig.targetWeight ? C.orange : C.blue },
                  { label: 'MA5', value: dramDecision.ma5 ? fmtDollar(dramDecision.ma5) : '—', color: dramDecision.priceState.aboveMa5 === false ? C.orange : C.green },
                  { label: 'MA20', value: dramDecision.ma20 ? fmtDollar(dramDecision.ma20) : '—', color: dramDecision.priceState.aboveMa20 === false ? C.orange : C.green },
                  { label: '高点回撤', value: fmtPct(dramDecision.drawdownFromPeak), color: -dramDecision.drawdownFromPeak >= dramConfig.drawdownClear ? C.red : C.sub },
                ].map((item) => (
                  <div key={item.label} style={{ backgroundColor: '#fff', borderRadius: 8, padding: '6px 7px', minWidth: 0 }}>
                    <div style={{ fontSize: 10, color: C.sub, fontWeight: 700 }}>{item.label}</div>
                    <div style={{ fontSize: 12, color: item.color, fontWeight: 800, marginTop: 2, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.value}</div>
                  </div>
                ))}
              </div>

              <div style={{ backgroundColor: '#fff', borderRadius: 9, padding: '8px 9px', fontSize: 12, color: '#202124', lineHeight: 1.45 }}>
                <div style={{ fontWeight: 800, color: activeDramTone.color, marginBottom: 3 }}>
                  {dramDecision.kind === 'clear' ? '清仓信号' : dramDecision.kind === 'trim' ? '减仓信号' : dramDecision.kind === 'buy' ? '买入许可' : dramDecision.kind === 'pause' ? '暂停信号' : '持仓信号'}
                </div>
                <div>{dramDecision.detail}</div>
                {dramDecision.sellShares > 0 && (
                  <div style={{ marginTop: 5, color: C.orange, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                    建议卖出 {dramDecision.sellShares.toFixed(4)} 股 · 约 ¥{fmtInt(dramDecision.sellCny)}
                  </div>
                )}
                {dramDecision.buyCapacityCny > 0 && (
                  <div style={{ marginTop: 5, color: C.green, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                    DRAM 可买上限 ¥{fmtInt(dramDecision.buyCapacityCny)}，剩余美股资金投 SPY
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8, fontSize: 10, color: C.sub }}>
                <span>美股总额 ¥{fmtInt(dramDecision.usStockValueCny)}</span>
                {dramDecision.dramValueCny !== null && <span>DRAM 市值 ¥{fmtInt(dramDecision.dramValueCny)}</span>}
                <span>清仓线：两周&lt;MA20 或回撤{Math.round(dramConfig.drawdownClear * 100)}%</span>
              </div>
            </>
          ) : (
            <div style={{ backgroundColor: '#fff', borderRadius: 9, padding: '8px 9px', fontSize: 12, color: dramChartError ? C.orange : C.sub }}>
              {dramChartError ? '暂时没有拿到 DRAM 最新价格，保留原有美股再平衡建议。' : '正在获取 DRAM 最新价格和均线。'}
            </div>
          )}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 2px', marginBottom: 14, fontSize: 13, color: allowRebalanceSell ? C.blue : C.sub, fontWeight: 600, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={allowRebalanceSell}
            onChange={(e) => setAllowRebalanceSell(e.target.checked)}
            style={{ width: 16, height: 16, accentColor: C.blue, cursor: 'pointer' }}
          />
          <span>允许减仓换仓</span>
        </label>
        {!allowRebalanceSell && latestUsdRate !== null && cnyFundingLegs.length > 0 && (
          <div style={{ border: '1px solid #e8eaed', borderRadius: 10, padding: '9px 10px', backgroundColor: '#fff', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: 12, color: C.sub, fontWeight: 700 }}>
              <span>理财调拨 · 美元 → 人民币</span>
              <span style={{ color: C.orange, fontVariantNumeric: 'tabular-nums' }}>¥{fmtInt(rebalanceFunding.cnyFromRmbBuffer)}</span>
              <SwapTag />
              <div style={{ flex: 1, borderBottom: '1px dashed #dadce0' }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 10 }}>
              {renderBigBlock('cny', 'in', cnyFundingRows.map((r) => ({ label: r.label, leg: r.cnyLeg })), cnyFundingInputRefs, 0)}
              {renderBigBlock('usd', 'out', cnyFundingRows.map((r) => ({ label: r.label, leg: r.usdLeg })), cnyFundingInputRefs, cnyFundingRows.length)}
            </div>
            <button
              onClick={() => executeFundingLegs(cnyFundingLegs)}
              disabled={!hasCnyFundingChanges}
              style={{
                width: '100%', marginTop: 8,
                backgroundColor: hasCnyFundingChanges ? C.green : '#e8eaed',
                color: hasCnyFundingChanges ? '#fff' : C.sub,
                fontWeight: 700, fontSize: 14, padding: '10px 0',
                borderRadius: 10, border: 'none',
                cursor: hasCnyFundingChanges ? 'pointer' : 'default',
                transition: 'background-color 0.2s',
              }}
            >
              ✓ 一键执行理财调拨
            </button>
          </div>
        )}
        {!allowRebalanceSell && latestUsdRate !== null && usdFundingLegs.length > 0 && (
          <div style={{ border: '1px solid #e8eaed', borderRadius: 10, padding: '9px 10px', backgroundColor: '#fff', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: 12, color: C.sub, fontWeight: 700 }}>
              <span>理财调拨 · 人民币 → 美元</span>
              <span style={{ color: C.orange, fontVariantNumeric: 'tabular-nums' }}>¥{fmtInt(rebalanceFunding.usdReplaceUseCny + rebalanceFunding.cnyToUsdCny)}</span>
              {usdFundingRows.length > 0 && <SwapTag />}
              <div style={{ flex: 1, borderBottom: '1px dashed #dadce0' }} />
            </div>
            {usdFundingRows.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 10, marginBottom: forexLeg ? 8 : 0 }}>
                {renderBigBlock('cny', 'out', usdFundingRows.map((r) => ({ label: r.label, leg: r.cnyLeg })), usdFundingInputRefs, 0)}
                {renderBigBlock('usd', 'in', usdFundingRows.map((r) => ({ label: r.label, leg: r.usdLeg })), usdFundingInputRefs, usdFundingRows.length)}
              </div>
            )}
            {forexLeg && renderForexArrow(forexLeg, usdFundingInputRefs, usdFundingRows.length * 2)}
            <button
              onClick={() => executeFundingLegs(usdFundingLegs)}
              disabled={!hasUsdFundingChanges}
              style={{
                width: '100%', marginTop: 8,
                backgroundColor: hasUsdFundingChanges ? C.green : '#e8eaed',
                color: hasUsdFundingChanges ? '#fff' : C.sub,
                fontWeight: 700, fontSize: 14, padding: '10px 0',
                borderRadius: 10, border: 'none',
                cursor: hasUsdFundingChanges ? 'pointer' : 'default',
                transition: 'background-color 0.2s',
              }}
            >
              ✓ 一键执行美元调拨
            </button>
          </div>
        )}
        {/* 色条 */}
        <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: 14 }}>
          {investKeys.map((k) => (
            <div key={k} style={{ width: `${totalInvest > 0 ? (effectiveInvestHoldings[k] / totalInvest) * 100 : 0}%`, backgroundColor: investMeta[k].color }} />
          ))}
        </div>

        {/* 持仓表（固定列宽） */}
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', marginBottom: 16, tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '18%' }} />
            <col style={{ width: '30%' }} />
            <col style={{ width: '18%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '20%' }} />
          </colgroup>
          <thead>
            <tr style={{ borderBottom: '2px solid #e8eaed' }}>
              <th style={thStyle}>品类</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>当前金额</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>累计收益率</th>
              <th style={{ ...thStyle, textAlign: 'right', color: allowRebalanceSell ? C.blue : C.orange }}>{allowRebalanceSell ? '需加/赎' : '需加'}</th>
              <th style={{ ...thStyle, textAlign: 'right', color: C.green }}>{allowRebalanceSell ? '已执行' : '已加'}</th>
            </tr>
          </thead>
          <tbody>
            {investKeys.map((k, i) => {
              const cur = current.investHoldings[k];
              const profitInfo = latestBreakdownProfit[k] ?? null;
              const profit = profitInfo?.profit ?? null;
              const pastTotal = profitInfo?.pastTotal ?? 0;
              const costBasis = profit !== null ? cur - profit : null;
              const profitRate = costBasis !== null && costBasis > 0 ? profit! / costBasis : null;
              const suggested = Math.round(rebalanceSuggested[k]);
              // 需加/需赎 = 建议 - 已加，赎回时为负数
              const localDone = parseFloat(localConfirmed[k]) || 0;
              const remaining = suggested - localDone;
              const showUsd = (USD_INVEST_KEYS.includes(k) || usdRebalanceCells.has(k)) && latestUsdRate !== null;
              const remainingLabel = suggested === 0
                ? '—'
                : Math.abs(remaining) < 0.5
                  ? '✓'
                  : showUsd
                    ? fmtUsd(remaining / latestUsdRate)
                    : remaining > 0
                      ? `+${Math.round(remaining)}`
                      : `${Math.round(remaining)}`;
              return (
                <Fragment key={k}>
                <tr style={{ backgroundColor: i % 2 === 0 ? '#fafafa' : '#fff', borderBottom: '1px solid #f1f3f4' }}>
                  <td style={{ padding: '8px 0', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {k === 'us' && (
                      <button
                        type="button"
                        onClick={() => setUsStockExpanded((prev) => !prev)}
                        aria-label={usStockExpanded ? '收起美股明细' : '展开美股明细'}
                        style={{ border: 'none', borderRadius: 8, backgroundColor: '#eef4ff', color: C.blue, width: 32, height: 32, padding: 0, margin: '-6px 2px -6px -6px', cursor: 'pointer', fontSize: 17, fontWeight: 900, lineHeight: 1, verticalAlign: 'middle' }}
                      >
                        {usStockExpanded ? '▾' : '▸'}
                      </button>
                    )}
                    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', backgroundColor: investMeta[k].color, marginRight: 4, verticalAlign: 'middle', flexShrink: 0 }} />
                    {investMeta[k].label}
                  </td>
                  <td style={{ padding: '4px 0', textAlign: 'right' }}>
                    {k === RESERVABLE_HOLDING_KEY ? (
                      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'flex-end', gap: 2, width: '100%', fontVariantNumeric: 'tabular-nums' }}>
                        <AmountInput
                          ref={(el) => { holdingInputRefs.current[i] = el; }}
                          value={localHoldings[k]}
                          onChange={(v) => setLocalHoldings((p) => ({ ...p, [k]: normalizeAmountInput(v) }))}
                          onFocus={(e) => e.target.select()}
                          onBlur={() => syncHolding(k)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { syncHolding(k); holdingInputRefs.current[i + 1]?.focus(); }
                          }}
                          style={{ width: 72, minWidth: 0, border: 'none', borderBottom: '1px solid #dadce0', outline: 'none', backgroundColor: 'transparent', fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: '#202124', textAlign: 'right' }}
                        />
                        <span style={{ color: C.sub, fontSize: 12, lineHeight: 1 }}>(</span>
                        <AmountInput
                          ref={longBondReserveInputRef}
                          value={localHoldingReserves[k]}
                          onChange={(v) => setLocalHoldingReserves((p) => ({ ...p, [k]: normalizeAmountInput(v) }))}
                          onFocus={(e) => e.target.select()}
                          onBlur={() => syncHolding(k)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { syncHolding(k); holdingInputRefs.current[i + 1]?.focus(); }
                          }}
                          style={{ width: 54, minWidth: 0, border: 'none', borderBottom: '1px solid #dadce0', outline: 'none', backgroundColor: 'transparent', fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: C.sub, textAlign: 'right' }}
                        />
                        <span style={{ color: C.sub, fontSize: 12, lineHeight: 1 }}>)</span>
                      </div>
                    ) : (
                      <AmountInput
                        ref={(el) => { holdingInputRefs.current[i] = el; }}
                        value={localHoldings[k]}
                        onChange={(v) => setLocalHoldings((p) => ({ ...p, [k]: normalizeAmountInput(v) }))}
                        onFocus={(e) => e.target.select()}
                        onBlur={() => syncHolding(k)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { syncHolding(k); holdingInputRefs.current[i + 1]?.focus(); }
                        }}
                        style={{ width: '100%', border: 'none', borderBottom: '1px solid #dadce0', outline: 'none', backgroundColor: 'transparent', fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: '#202124', textAlign: 'right' }}
                      />
                    )}
                  </td>
                  {/* 累计收益率 */}
                  <td
                    title={pastTotal !== 0 ? `${profitInfo?.yearMonth ?? '历史'} 累计收益含 past ${pastTotal >= 0 ? '+' : ''}${Math.round(pastTotal)}` : undefined}
                    style={{ padding: '8px 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
                  >
                    {profitRate !== null ? (
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: profitRate >= 0 ? C.red : C.green }}>
                          {profitRate >= 0 ? '+' : ''}{(profitRate * 100).toFixed(1)}%
                        </div>
                        {pastTotal !== 0 && <div style={{ fontSize: 10, color: C.orange, lineHeight: 1.1 }}>past</div>}
                      </div>
                    ) : profit !== null ? (
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: profit >= 0 ? C.red : C.green }}>
                          {profit >= 0 ? '+' : ''}¥{Math.round(profit)}
                        </div>
                        {pastTotal !== 0 && <div style={{ fontSize: 10, color: C.orange, lineHeight: 1.1 }}>past</div>}
                      </div>
                    ) : (
                      <span style={{ fontSize: 11, color: C.sub }}>—</span>
                    )}
                  </td>
                  {/* 需加/需赎（实时 = 建议 - 已加；正=加仓，负=赎回） */}
                  <td
                    onClick={() => {
                      if (latestUsdRate === null || suggested === 0 || Math.abs(remaining) < 0.5) return;
                      setUsdRebalanceCells((prev) => {
                        const next = new Set(prev);
                        if (next.has(k)) next.delete(k);
                        else next.add(k);
                        return next;
                      });
                    }}
                    title={latestUsdRate === null ? '暂无美元汇率' : '点击切换人民币/美元'}
                    style={{ padding: '8px 0', textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: remaining > 0 ? C.orange : remaining < 0 ? C.blue : C.sub, cursor: latestUsdRate !== null && suggested !== 0 && Math.abs(remaining) >= 0.5 ? 'pointer' : 'default', userSelect: 'none' }}
                  >
                    {remainingLabel}
                  </td>
                  {/* 已加（编辑后按执行键生效） */}
                  <td style={{ padding: '4px 0', textAlign: 'right' }}>
                    <AmountInput
                      ref={(el) => { rebalanceInputRefs.current[i] = el; }}
                      value={localConfirmed[k]}
                      onChange={(v) => setLocalConfirmed((p) => ({ ...p, [k]: /^-?0\d/.test(v) ? (v.replace(/^(-?)0+/, '$1') || '0') : v }))}
                      onFocus={(e) => e.target.select()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') rebalanceInputRefs.current[i + 1]?.focus();
                      }}
                      style={{ width: '100%', border: 'none', borderBottom: `1px solid ${C.green}`, outline: 'none', backgroundColor: 'transparent', fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: C.green, textAlign: 'right' }}
                    />
                  </td>
                </tr>
                {k === 'us' && usStockExpanded && (
                  <tr style={{ backgroundColor: '#f8fbff', borderBottom: '1px solid #e8f0fe' }}>
                    <td colSpan={5} style={{ padding: '8px 0 10px' }}>
                      <div style={{ border: '1px solid #d2e3fc', borderRadius: 10, padding: '8px 9px', backgroundColor: '#fff' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 800, color: '#202124' }}>美股明细</div>
                            <div style={{ fontSize: 10, color: Math.abs(usStockDetailGap) >= 1 ? C.orange : C.sub, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
                              合计 ¥{fmtInt(usStockDetailTotal)} · 美股 ¥{fmtInt(current.investHoldings.us ?? 0)}
                              {Math.abs(usStockDetailGap) >= 1 ? ` · 差额 ${usStockDetailGap > 0 ? '+' : ''}¥${fmtInt(usStockDetailGap)}` : ''}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={addUsStockItem}
                            style={{ border: 'none', borderRadius: 8, backgroundColor: '#e8f0fe', color: C.blue, padding: '6px 9px', fontSize: 12, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap' }}
                          >
                            + 项目
                          </button>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                          {localUsStockItems.map((item) => {
                            const amount = Math.max(0, parseAmountPart(item.amountCny));
                            const weight = (current.investHoldings.us ?? 0) > 0 ? amount / (current.investHoldings.us ?? 0) : null;
                            const symbol = item.symbol.trim().toUpperCase();
                            const isSpyItem = isSpyUsStockInput(item);
                            const isDramItem = symbol === 'DRAM' || item.name.trim().toUpperCase() === 'DRAM';
                            const symbolMatchesName = Boolean(symbol) && item.name.trim().toUpperCase() === symbol;
                            const chart = isDramItem ? (dramChart ?? usStockCharts[symbol]) : usStockCharts[symbol];
                            const priceBar = latestMarketBar(chart);
                            const currentPrice = priceBar ? Number(priceBar.adjClose ?? priceBar.close) : null;
                            const shares = item.shares.trim() ? Math.max(0, parseAmountPart(item.shares)) : 0;
                            const estimatedCny = currentPrice !== null && latestUsdRate !== null && shares > 0
                              ? roundMoney(currentPrice * shares * latestUsdRate)
                              : null;
                            const priceLabel = currentPrice !== null
                              ? fmtDollar(currentPrice)
                              : (symbol && (usStockPriceErrors.has(symbol) || (isDramItem && dramChartError)))
                                ? '价格失败'
                                : symbol
                                  ? '取价中'
                                  : '填代码';
                            const itemDecision = isDramItem ? dramDecision : null;
                            const itemTone = itemDecision ? dramTone[itemDecision.kind] : null;
                            return (
                              <div key={item.id} style={{ border: '1px solid #edf2fb', borderRadius: 9, padding: '7px 8px', backgroundColor: '#fbfdff' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(58px, 76px) 92px 28px', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                                  <input
                                    value={item.name}
                                    onChange={(e) => {
                                      const nextName = e.target.value;
                                      const previousName = item.name.trim().toUpperCase();
                                      const previousSymbol = item.symbol.trim().toUpperCase();
                                      setLocalUsStockItem(item.id, {
                                        name: nextName,
                                        ...(previousSymbol && previousSymbol === previousName ? { symbol: nextName.toUpperCase() } : {}),
                                      });
                                    }}
                                    onBlur={() => commitUsStockItems()}
                                    style={{ width: '100%', border: 'none', borderBottom: '1px solid #dadce0', outline: 'none', backgroundColor: 'transparent', fontSize: 13, fontWeight: 800, color: '#202124' }}
                                  />
                                  <div style={{ minWidth: 0, textAlign: 'right' }}>
                                    <div style={{ fontSize: 10, color: C.sub, fontWeight: 700, lineHeight: 1.1 }}>现价</div>
                                    <div title={priceBar?.date ?? undefined} style={{ fontSize: 12, color: currentPrice !== null ? C.blue : C.orange, fontWeight: 800, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                      {priceLabel}
                                    </div>
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                    <span style={{ fontSize: 11, color: C.sub, fontWeight: 700 }}>¥</span>
                                    <AmountInput
                                      value={item.amountCny}
                                      onChange={(v) => {
                                        if (isSpyItem) return;
                                        setLocalUsStockItem(item.id, { amountCny: normalizeAmountInput(v) });
                                      }}
                                      onFocus={(e) => e.target.select()}
                                      onBlur={() => {
                                        if (!isSpyItem) commitUsStockItems();
                                      }}
                                      readOnly={isSpyItem}
                                      tabIndex={isSpyItem ? -1 : undefined}
                                      title={isSpyItem ? '由美股总额扣除其他美股自动计算' : undefined}
                                      style={{ width: '100%', border: 'none', borderBottom: '1px solid #dadce0', outline: 'none', backgroundColor: isSpyItem ? '#f8fbff' : 'transparent', fontSize: 13, fontWeight: 800, color: isSpyItem ? C.blue : '#202124', textAlign: 'right', fontVariantNumeric: 'tabular-nums', cursor: isSpyItem ? 'default' : 'text' }}
                                    />
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => removeUsStockItem(item.id)}
                                    aria-label={`删除${item.name || item.symbol || '美股项目'}`}
                                    style={{ border: 'none', borderRadius: 7, width: 26, height: 26, backgroundColor: '#fce8e6', color: C.red, fontSize: 14, fontWeight: 800, cursor: 'pointer', lineHeight: 1 }}
                                  >
                                    ×
                                  </button>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: symbolMatchesName ? 'minmax(0, 1fr) minmax(0, 1fr) auto' : 'minmax(0, 0.9fr) minmax(0, 1fr) minmax(0, 1fr) auto', gap: 8, alignItems: 'center' }}>
                                  {!symbolMatchesName && (
                                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                                      <span style={{ fontSize: 10, color: C.sub, fontWeight: 700, whiteSpace: 'nowrap' }}>代码</span>
                                      <input
                                        value={item.symbol}
                                        onChange={(e) => setLocalUsStockItem(item.id, { symbol: e.target.value.toUpperCase() })}
                                        onBlur={() => commitUsStockItems()}
                                        style={{ minWidth: 0, width: '100%', border: 'none', borderBottom: '1px solid #e8eaed', outline: 'none', backgroundColor: 'transparent', fontSize: 12, fontWeight: 800, color: C.blue, textAlign: 'right', textTransform: 'uppercase' }}
                                      />
                                    </label>
                                  )}
                                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                                    <span style={{ fontSize: 10, color: C.sub, fontWeight: 700, whiteSpace: 'nowrap' }}>股数</span>
                                    <AmountInput
                                      value={item.shares}
                                      onChange={(v) => setLocalUsStockItem(item.id, { shares: normalizeAmountInput(v) }, { autoAmount: true })}
                                      onFocus={(e) => e.target.select()}
                                      onBlur={() => commitUsStockItems(undefined, { autoAmount: true })}
                                      style={{ minWidth: 0, width: '100%', border: 'none', borderBottom: '1px solid #e8eaed', outline: 'none', backgroundColor: 'transparent', fontSize: 12, fontWeight: 700, color: C.sub, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
                                    />
                                  </label>
                                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                                    <span style={{ fontSize: 10, color: C.sub, fontWeight: 700, whiteSpace: 'nowrap' }}>成本$</span>
                                    <AmountInput
                                      value={item.costPrice}
                                      onChange={(v) => setLocalUsStockItem(item.id, { costPrice: normalizeAmountInput(v) }, { autoAmount: true })}
                                      onFocus={(e) => e.target.select()}
                                      onBlur={() => commitUsStockItems(undefined, { autoAmount: true })}
                                      style={{ minWidth: 0, width: '100%', border: 'none', borderBottom: '1px solid #e8eaed', outline: 'none', backgroundColor: 'transparent', fontSize: 12, fontWeight: 700, color: C.sub, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
                                    />
                                  </label>
                                  <span style={{ fontSize: 10, color: C.sub, fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                                    {weight !== null ? `${(weight * 100).toFixed(1)}%` : '—'}
                                  </span>
                                </div>
                                {(estimatedCny !== null || itemDecision) && (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 7 }}>
                                    {estimatedCny !== null && (
                                      <div style={{ fontSize: 10, color: C.sub, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                                        按现价估值 ¥{fmtInt(estimatedCny)}
                                        {Math.abs(estimatedCny - amount) >= 1 && <span style={{ color: C.orange }}> · 与录入差 ¥{fmtInt(estimatedCny - amount)}</span>}
                                      </div>
                                    )}
                                    {itemDecision && itemTone && (
                                      <div style={{ border: `1px solid ${itemTone.border}`, backgroundColor: itemTone.bg, color: '#202124', borderRadius: 8, padding: '6px 7px', fontSize: 11, lineHeight: 1.35 }}>
                                        <span style={{ color: itemTone.color, fontWeight: 900 }}>现在：{itemDecision.headline}</span>
                                        <span style={{ color: C.sub }}> · </span>
                                        <span>{itemDecision.detail}</span>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
          </tbody>
        </table>

        {/* 执行按钮：将"已加/已执行"数值写入持仓，然后清零 */}
        <button
          onClick={handleExecuteRebalance}
          style={{
            width: '100%', padding: '10px 0', borderRadius: 10, border: 'none',
            backgroundColor: C.green, color: '#fff', fontWeight: 600, fontSize: 14,
            cursor: 'pointer', marginBottom: 12,
          }}
        >
          {allowRebalanceSell ? '执行再平衡' : '执行加仓'}
        </button>
      </Card>
      </div>

      {/* 保存 */}
      <button
        onClick={handleSave}
        style={{
          width: '100%', backgroundColor: saved ? C.green : C.blue, color: '#fff',
          fontWeight: 600, fontSize: 15, padding: '14px 0', borderRadius: 12,
          border: 'none', cursor: 'pointer', marginTop: 8, marginBottom: 16,
          boxShadow: '0 1px 3px rgba(26,115,232,0.3)', transition: 'background-color 0.3s',
        }}
      >
        {saved ? '✓ 已保存' : '保存本次对账'}
      </button>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '8px 0', fontSize: 12, color: '#5f6368', fontWeight: 500,
};
