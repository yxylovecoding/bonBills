import { useState, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../components/Card';
import { formatCurrency } from '../components/CurrencyDisplay';
import { useSnapshotStore } from '../stores/snapshotStore';
import { useConfigStore } from '../stores/configStore';
import { useMonthlyStore } from '../stores/monthlyStore';
import { useCalendarStore } from '../stores/calendarStore';
import { calcBudget, resolvePayDay } from '../calculations/budget';
import { calcHistoryStats } from '../calculations/history';
import { calcRebalance } from '../calculations/rebalance';
import { investMeta, tagMeta } from '../data/mockData';
import type { DailyTag, InvestKey, TagKind } from '../models/types';

const C = { blue: '#1a73e8', red: '#ea4335', green: '#0d9488', sub: '#5f6368', orange: '#e8710a' };


const TRANSFER_KEYS = ['campusCard', 'living', 'consumption', 'wishJar', 'invest'] as const;
type TransferKey = typeof TRANSFER_KEYS[number];
const TRANSFER_META: Record<TransferKey, { label: string; accountKey?: string }> = {
  campusCard:  { label: '🎓 校园卡',   accountKey: 'campusCard' },
  living:      { label: '🏦 生活',      accountKey: 'livingBank' },
  consumption: { label: '💼 消费',      accountKey: 'consumptionBank' },
  wishJar:     { label: '🏺 心愿罐' },
  invest:      { label: '📈 理财' },
};

type BudgetKey = 'weekly' | 'monthly' | 'beyond';

interface BudgetDetailItem { icon: string; label: string; amount: number; note?: string }

export default function ReconcilePage() {
  const navigate = useNavigate();
  const { current, updateAccounts, updateTransfers, updateHoldings, saveSnapshot } = useSnapshotStore();
  const { config } = useConfigStore();
  const { records } = useMonthlyStore();
  const { tagMap } = useCalendarStore();


  // 账户余额本地编辑
  const [localAccounts, setLocalAccounts] = useState({
    credit:        String(current.accounts.credit),
    creditMonthly: String(current.accounts.creditMonthly ?? 0),
    campusCard:    String(current.accounts.campusCard ?? 0),
    livingBank:    String(current.accounts.livingBank),
    incomeBank:    String(current.accounts.incomeBank ?? 0),
  });
  const accountInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const focusNextAccount = (i: number) => { setTimeout(() => accountInputRefs.current[i + 1]?.focus(), 0); };
  const syncAccounts = (next = localAccounts) => updateAccounts({
    credit:        parseFloat(next.credit)        || 0,
    creditMonthly: parseFloat(next.creditMonthly) || 0,
    campusCard:    parseFloat(next.campusCard)    || 0,
    livingBank:    parseFloat(next.livingBank)    || 0,
    incomeBank:    parseFloat(next.incomeBank)    || 0,
  });

  // 已确认转账（累计）+ 本次输入
  const [confirmed, setConfirmed] = useState<Record<TransferKey, number>>(
    current.transfersDone as Record<TransferKey, number>,
  );
  const [pending, setPending] = useState<Record<TransferKey, string>>(
    { campusCard: '', living: '', consumption: '', wishJar: '', invest: '' },
  );

  const [expandedBudget, setExpandedBudget] = useState<BudgetKey | null>(null);
  const [saved, setSaved] = useState(false);

  // 理财本次投入金额
  const [investInput, setInvestInput] = useState('');

  // 理财持仓本地编辑
  const [localHoldings, setLocalHoldings] = useState<Record<InvestKey, string>>(
    () => Object.fromEntries((Object.keys(current.investHoldings) as InvestKey[]).map((k) => [k, String(current.investHoldings[k])])) as Record<InvestKey, string>
  );
  const holdingInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const syncHolding = (k: InvestKey) => {
    updateHoldings({ ...current.investHoldings, [k]: parseFloat(localHoldings[k]) || 0 });
  };

  // 今天
  const today = new Date();

  // 历史均值（只取近两年）
  const twoYearsAgo = `${today.getFullYear() - 1}-01`;
  const stats = useMemo(() => calcHistoryStats(records.filter((r) => r.yearMonth >= twoYearsAgo)), [records]);

  // 将 tagMap 转为 DailyTag[]
  const tags: DailyTag[] = useMemo(
    () => Object.entries(tagMap).map(([date, tag]) => ({ date, tag })),
    [tagMap],
  );

  // 当月各标签天数（日薪计算用）
  const curYM = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const tagCountThisMonth = useMemo(() => {
    const counts: Record<string, number> = { intern: 0, school: 0, home: 0, travel: 0 };
    for (const [date, tag] of Object.entries(tagMap)) {
      if (date.startsWith(curYM)) counts[tag] = (counts[tag] || 0) + 1;
    }
    return counts;
  }, [tagMap, curYM]);

  // 次月各标签天数（月外收入计算用）
  const nextMonthDate = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const nextYM = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, '0')}`;
  const tagCountNextMonth = useMemo(() => {
    const counts: Record<string, number> = { intern: 0, school: 0, home: 0, travel: 0 };
    for (const [date, tag] of Object.entries(tagMap)) {
      if (date.startsWith(nextYM)) counts[tag] = (counts[tag] || 0) + 1;
    }
    return counts;
  }, [tagMap, nextYM]);

  // 有效收入项（日薪模式按标签天数计算实际金额）
  const effectiveIncomeItems = useMemo(() =>
    config.incomeItems.map((item) => {
      if (item.isActive && item.dailyRate !== undefined && item.tagKind) {
        return { ...item, amount: item.dailyRate * (tagCountThisMonth[item.tagKind] || 0) };
      }
      return item;
    }), [config.incomeItems, tagCountThisMonth]);

  const effectiveConfig = useMemo(() => ({ ...config, incomeItems: effectiveIncomeItems }), [config, effectiveIncomeItems]);

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
  const rebalanceSuggested = useMemo(
    () => calcRebalance(current.investHoldings, config.investAllocTargets, parseFloat(investInput) || 0),
    [current.investHoldings, config.investAllocTargets, investInput],
  );
  const investKeys = Object.keys(current.investHoldings) as InvestKey[];

  // 最新一期有各品类累计收益数据的月度记录
  const latestBreakdownProfit = useMemo(
    () => [...records].sort((a, b) => b.yearMonth.localeCompare(a.yearMonth))
      .find((r) => r.investBreakdownProfit && Object.keys(r.investBreakdownProfit).length > 0)
      ?.investBreakdownProfit ?? {},
    [records],
  );

  const rebalanceInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  // 已加仓（本次会话输入，执行后归零）
  const [localConfirmed, setLocalConfirmed] = useState<Record<InvestKey, string>>(
    () => Object.fromEntries(investKeys.map((k) => [k, '0'])) as Record<InvestKey, string>
  );
  const totalInvest = investKeys.reduce((s, k) => s + current.investHoldings[k], 0);


  // 一键执行转账
  const handleExecuteAll = () => {
    const newConfirmed = { ...confirmed };
    const accountDelta: Partial<typeof current.accounts> = {};

    for (const key of TRANSFER_KEYS) {
      const amt = parseFloat(pending[key] || '0') || 0;
      if (amt <= 0) continue;
      newConfirmed[key] += amt;
      const acctKey = TRANSFER_META[key].accountKey as keyof typeof current.accounts | undefined;
      if (acctKey) {
        accountDelta[acctKey] = (current.accounts[acctKey] || 0) + amt;
      }
    }
    setConfirmed(newConfirmed);
    setPending({ campusCard: '', living: '', consumption: '', wishJar: '', invest: '' });
    if (Object.keys(accountDelta).length > 0) updateAccounts(accountDelta);
    updateTransfers(newConfirmed);
  };

  const hasPending = TRANSFER_KEYS.some((k) => parseFloat(pending[k] || '0') > 0);

  // 保存快照
  const handleSave = () => {
    updateTransfers(confirmed);
    saveSnapshot();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const todayDate = today.getDate();
  const weekEnd = todayDate + Math.min(budget.daysLeftInMonth, 7);
  const rPD = (payDay: number) => resolvePayDay(payDay, today.getFullYear(), today.getMonth());
  const pdLabel = (payDay: number) => payDay === 0 ? '月底' : `${rPD(payDay)}号`;

  const makeIncomeNote = (i: typeof effectiveIncomeItems[0], base: string) =>
    i.dailyRate !== undefined && i.tagKind
      ? `${base}（${tagCountThisMonth[i.tagKind] || 0}天×¥${i.dailyRate}/天）`
      : base;

  // 预算明细（收入按发薪日判断是否已发，日薪项显示计算方式）
  const weekFraction = Math.min(budget.daysLeftInMonth, 7) / Math.max(budget.daysLeftInMonth, 1);

  const budgetDetails: Record<BudgetKey, { income: BudgetDetailItem[]; expense: BudgetDetailItem[] }> = {
    weekly: {
      income: effectiveIncomeItems.filter(i => { const pd = rPD(i.payDay); return i.isActive && pd > todayDate && pd <= weekEnd; }).map(i => ({
        icon: '💰', label: i.name, amount: i.amount, note: makeIncomeNote(i, `${pdLabel(i.payDay)}发薪`),
      })),
      expense: [
        { icon: '💳', label: '信用卡本月待还', amount: current.accounts.creditMonthly ?? 0, note: `${config.creditPayDate}号还款` },
        ...(['school', 'intern', 'home', 'travel'] as TagKind[]).map((k) => {
          const days = Math.round(budget.stateDaysLeft[k] * weekFraction);
          return {
            icon: tagMeta[k].icon, label: tagMeta[k].label,
            amount: Math.round(days * stats.stateDailyAvg[k]),
            note: `约${days}天×¥${Math.round(stats.stateDailyAvg[k])}/天`,
          };
        }).filter((item) => item.amount > 0),
      ],
    },
    monthly: {
      income: effectiveIncomeItems.filter(i => i.isActive).map(i => {
        const pd = rPD(i.payDay);
        const received = pd <= todayDate;
        return { icon: received ? '✅' : '💰', label: i.name, amount: received ? 0 : i.amount, note: makeIncomeNote(i, received ? `${pdLabel(i.payDay)}已发` : `${pdLabel(i.payDay)}待发`) };
      }),
      expense: [
        ...(['school', 'intern', 'home', 'travel'] as TagKind[]).map((k) => ({
          icon: tagMeta[k].icon, label: tagMeta[k].label,
          amount: Math.round(budget.stateDaysLeft[k] * stats.stateDailyAvg[k]),
          note: `${budget.stateDaysLeft[k]}天×¥${Math.round(stats.stateDailyAvg[k])}/天`,
        })).filter((item) => item.amount > 0),
      ],
    },
    beyond: {
      income: config.incomeItems.filter(i => i.isActive).map(i => {
        const nextAmount = (i.dailyRate !== undefined && i.tagKind)
          ? i.dailyRate * (tagCountNextMonth[i.tagKind] || 0)
          : i.amount;
        const note = (i.dailyRate !== undefined && i.tagKind)
          ? `次月${pdLabel(i.payDay)}（${tagCountNextMonth[i.tagKind] || 0}天×¥${i.dailyRate}/天）`
          : `次月${pdLabel(i.payDay)}`;
        return { icon: '💰', label: i.name, amount: nextAmount, note };
      }),
      expense: [
        { icon: '💳', label: '信用卡下期', amount: Math.max((current.accounts.credit ?? 0) - (current.accounts.creditMonthly ?? 0), 0), note: '总待还-本月待还' },
        ...(['school', 'intern', 'home', 'travel'] as TagKind[]).map((k) => ({
          icon: tagMeta[k].icon, label: tagMeta[k].label,
          amount: Math.round(budget.stateDaysNextMonth[k] * stats.stateDailyAvg[k]),
          note: `${budget.stateDaysNextMonth[k]}天×¥${Math.round(stats.stateDailyAvg[k])}/天`,
        })).filter((item) => item.amount > 0),
      ],
    },
  };

  const sumDetailExp = (key: BudgetKey) =>
    budgetDetails[key].expense.reduce((s, i) => s + i.amount, 0);
  const sumDetailInc = (key: BudgetKey) =>
    budgetDetails[key].income.reduce((s, i) => s + i.amount, 0);

  const budgetRows: { key: BudgetKey; name: string; inc: number; exp: number }[] = [
    { key: 'weekly',  name: '周内 (近7天)',  inc: sumDetailInc('weekly'),  exp: sumDetailExp('weekly') },
    { key: 'monthly', name: '月内 (本月余)', inc: sumDetailInc('monthly'), exp: sumDetailExp('monthly') },
    { key: 'beyond',  name: '月外 (跨月)',   inc: sumDetailInc('beyond'),  exp: sumDetailExp('beyond') },
  ];

  const reconcileMode = today.getDate() === 1 ? '月初归档' : today.getDate() <= 15 ? '常规（11号）' : '常规（21号）';
  const isMonthEnd = reconcileMode === '月初归档'; // 月初 = 上月月末结算

  const [doneSteps, setDoneSteps] = useState<Set<number>>(new Set());
  const toggleDone = (i: number) =>
    setDoneSteps((prev) => { const next = new Set(prev); next.has(i) ? next.delete(i) : next.add(i); return next; });

  const ALL_STEPS = [
    { label: '日历标记',   note: '标记本月各天状态',   monthEndOnly: false, action: () => navigate('/calendar') },
    { label: '更新余额',   note: '填写各账户最新余额', monthEndOnly: false, action: () => document.getElementById('sec-accounts')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) },
    { label: '预算计算',   note: '查看三层预算明细',   monthEndOnly: false, action: () => document.getElementById('sec-budget')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) },
    { label: '执行转账',   note: '划转资金到各账户',   monthEndOnly: false, action: () => document.getElementById('sec-transfer')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) },
    { label: '理财再平衡', note: '按比例投入新资金',   monthEndOnly: true,  action: () => document.getElementById('sec-invest')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) },
    { label: '历史记录',   note: '录入本月收支数据',   monthEndOnly: true,  action: () => navigate('/calendar?tab=year') },
  ];
  const STEPS = ALL_STEPS.filter((s) => !s.monthEndOnly || isMonthEnd);

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 4px' }}>对账 / 转账</h1>
      <p style={{ fontSize: 13, color: C.sub, margin: '0 0 16px' }}>
        今天 {today.getFullYear()}-{String(today.getMonth()+1).padStart(2,'0')}-{String(today.getDate()).padStart(2,'0')}，对账模式：<span style={{ color: C.blue, fontWeight: 600 }}>{reconcileMode}</span>
      </p>

      {/* 对账流程引导 */}
      <Card title="对账流程">
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

          {/* 信用卡：总待还 + 本月待还 */}
          <div style={{ backgroundColor: '#fce8e6', borderRadius: 12, padding: '10px 14px', border: '1.5px solid #f28b82' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#202124', marginBottom: 8 }}>💳 信用卡</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {([
                { key: 'credit',        label: '总待还',   idx: 0 },
                { key: 'creditMonthly', label: '本月待还', idx: 1 },
              ] as const).map(({ key, label, idx }) => (
                <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13, color: '#5f6368' }}>{label}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: '#c5221f' }}>¥</span>
                    <input
                      ref={(el) => { accountInputRefs.current[idx] = el; }}
                      type="number" inputMode="decimal"
                      value={localAccounts[key]}
                      onChange={(e) => { const v = e.target.value; setLocalAccounts((p) => ({ ...p, [key]: /^-?0\d/.test(v) ? (v.replace(/^(-?)0+/, '$1') || '0') : v })); }}
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
              <input
                ref={(el) => { accountInputRefs.current[2] = el; }}
                type="number" inputMode="decimal"
                value={localAccounts.campusCard}
                onChange={(e) => { const v = e.target.value; setLocalAccounts((p) => ({ ...p, campusCard: /^-?0\d/.test(v) ? (v.replace(/^(-?)0+/, '$1') || '0') : v })); }}
                onFocus={(e) => e.target.select()}
                onBlur={() => syncAccounts()}
                onKeyDown={(e) => { if (e.key === 'Enter') { syncAccounts(); focusNextAccount(2); } }}
                style={{ width: 100, border: 'none', outline: 'none', backgroundColor: 'transparent', fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: '#f57c00', textAlign: 'right' }}
              />
            </div>
          </div>

          {/* 生活账户 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#e8f0fe', borderRadius: 12, padding: '10px 14px', border: '1.5px solid #a8c7fa' }}>
            <span style={{ fontSize: 14, color: '#202124', fontWeight: 500 }}>🏦 生活</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#1a73e8' }}>¥</span>
              <input
                ref={(el) => { accountInputRefs.current[3] = el; }}
                type="number" inputMode="decimal"
                value={localAccounts.livingBank}
                onChange={(e) => { const v = e.target.value; setLocalAccounts((p) => ({ ...p, livingBank: /^-?0\d/.test(v) ? (v.replace(/^(-?)0+/, '$1') || '0') : v })); }}
                onFocus={(e) => e.target.select()}
                onBlur={() => syncAccounts()}
                onKeyDown={(e) => { if (e.key === 'Enter') { syncAccounts(); focusNextAccount(3); } }}
                style={{ width: 100, border: 'none', outline: 'none', backgroundColor: 'transparent', fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: '#1a73e8', textAlign: 'right' }}
              />
            </div>
          </div>

          {/* 收入账户 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#e6f4ea', borderRadius: 12, padding: '10px 14px', border: '1.5px solid #81c995' }}>
            <span style={{ fontSize: 14, color: '#202124', fontWeight: 500 }}>💰 收入</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#188038' }}>¥</span>
              <input
                ref={(el) => { accountInputRefs.current[4] = el; }}
                type="number" inputMode="decimal"
                value={localAccounts.incomeBank}
                onChange={(e) => { const v = e.target.value; setLocalAccounts((p) => ({ ...p, incomeBank: /^-?0\d/.test(v) ? (v.replace(/^(-?)0+/, '$1') || '0') : v })); }}
                onFocus={(e) => e.target.select()}
                onBlur={() => syncAccounts()}
                onKeyDown={(e) => { if (e.key === 'Enter') { syncAccounts(); focusNextAccount(4); } }}
                style={{ width: 100, border: 'none', outline: 'none', backgroundColor: 'transparent', fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: '#188038', textAlign: 'right' }}
              />
            </div>
          </div>

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
                  width: '100%', display: 'grid', gridTemplateColumns: '1fr auto auto auto auto',
                  alignItems: 'center', gap: 8, padding: '10px 10px', borderRadius: 10,
                  border: 'none', cursor: 'pointer', textAlign: 'left',
                  backgroundColor: isOpen ? '#e8f0fe' : i % 2 === 0 ? '#fafafa' : '#fff',
                  transition: 'background-color 0.15s',
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 600, color: isOpen ? C.blue : '#202124' }}>{row.name}</span>
                <span style={{ fontSize: 12, color: C.red, fontVariantNumeric: 'tabular-nums' }}>+¥{formatCurrency(row.inc)}</span>
                <span style={{ fontSize: 12, color: C.green, fontVariantNumeric: 'tabular-nums' }}>-¥{formatCurrency(row.exp)}</span>
                <span style={{ fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: balance >= 0 ? C.red : C.green }}>
                  {balance >= 0 ? '+' : '-'}¥{formatCurrency(Math.abs(balance))}
                </span>
                <span style={{ fontSize: 11, color: C.sub, display: 'inline-block', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▼</span>
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
      <Card title="② 建议转账" subtitle="收入优先补齐必要账户，剩余按比例分配">

        {/* 收入资金流向概览 */}
        {budget.recommended.needsRedemption > 0 ? (
          <div style={{ backgroundColor: '#fce8e6', border: '1px solid #f28b82', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 13 }}>
            ⚠️ 收入账户 <b>¥{formatCurrency(current.accounts.incomeBank ?? 0)}</b> 不足以补齐必要账户，建议赎回理财 <b style={{ color: C.red }}>¥{formatCurrency(budget.recommended.needsRedemption)}</b>
          </div>
        ) : (
          <div style={{ backgroundColor: '#e6f4ea', border: '1px solid #81c995', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 13 }}>
            💰 收入账户 <b>¥{formatCurrency(current.accounts.incomeBank ?? 0)}</b> → 补充必要 <b>¥{formatCurrency((budget.recommended.campusCard) + (budget.recommended.living))}</b> → 可分配 <b style={{ color: C.green }}>¥{formatCurrency(budget.recommended.incomeAfterEssentials)}</b>
          </div>
        )}

        {/* 必要账户（校园卡 + 生活）：显示当前余额和月需 */}
        {(['campusCard', 'living'] as const).map((key, i) => {
          const acctKey = TRANSFER_META[key].accountKey as keyof typeof current.accounts;
          const currentBal = current.accounts[acctKey] ?? 0;
          const need = key === 'campusCard' ? budget.needs.campusCard : budget.needs.living;
          const rec = budget.recommended[key];
          const conf = confirmed[key] || 0;
          const remain = Math.max(rec - conf, 0);
          return (
            <div key={key} style={{ backgroundColor: i % 2 === 0 ? '#fafafa' : '#fff', borderRadius: 8, padding: '8px 10px', marginBottom: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{TRANSFER_META[key].label}</span>
                <div style={{ display: 'flex', gap: 10, fontSize: 12 }}>
                  <span style={{ color: C.sub }}>余 <b style={{ color: currentBal < need * 0.5 ? C.red : '#202124' }}>¥{formatCurrency(currentBal)}</b></span>
                  <span style={{ color: C.sub }}>需 <b style={{ color: C.orange }}>¥{formatCurrency(need)}</b></span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <div style={{ flex: 1, fontSize: 12, color: C.sub }}>
                  建议转 <span style={{ color: rec > 0 ? C.blue : C.sub, fontWeight: 600 }}>¥{formatCurrency(rec)}</span>
                  {conf > 0 && <span style={{ marginLeft: 8 }}>已确认 <span style={{ color: C.green, fontWeight: 600 }}>¥{formatCurrency(conf)}</span></span>}
                </div>
                <input
                  type="number" value={pending[key]}
                  onChange={(e) => { const v = e.target.value; setPending((p) => ({ ...p, [key]: /^-?0\d/.test(v) ? (v.replace(/^(-?)0+/, '$1') || '0') : v })); }}
                  placeholder={remain > 0 ? String(remain) : '0'}
                  style={{ width: 90, border: '1.5px solid #fbbf24', borderRadius: 8, padding: '5px 8px', fontSize: 13, textAlign: 'right', outline: 'none', backgroundColor: '#fffbeb' }}
                />
                {remain > 0 && <span style={{ fontSize: 11, color: C.orange, minWidth: 44, textAlign: 'right' }}>还需¥{formatCurrency(remain)}</span>}
              </div>
            </div>
          );
        })}

        {/* 分配账户（消费 + 心愿 + 理财） */}
        <div style={{ marginTop: 8, borderTop: '1px dashed #dadce0', paddingTop: 8 }}>
          <div style={{ fontSize: 11, color: C.sub, marginBottom: 6 }}>盈余分配</div>
          {(['consumption', 'wishJar', 'invest'] as const).map((key, i) => {
            const rec = budget.recommended[key];
            const conf = confirmed[key] || 0;
            const remain = Math.max(rec - conf, 0);
            return (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', borderBottom: i < 2 ? '1px solid #f1f3f4' : 'none' }}>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{TRANSFER_META[key].label}</span>
                <span style={{ fontSize: 12, color: C.orange, fontVariantNumeric: 'tabular-nums' }}>¥{formatCurrency(rec)}</span>
                {conf > 0 && <span style={{ fontSize: 11, color: C.green, fontVariantNumeric: 'tabular-nums' }}>✓{formatCurrency(conf)}</span>}
                <input
                  type="number" value={pending[key]}
                  onChange={(e) => { const v = e.target.value; setPending((p) => ({ ...p, [key]: /^-?0\d/.test(v) ? (v.replace(/^(-?)0+/, '$1') || '0') : v })); }}
                  placeholder={remain > 0 ? String(remain) : '0'}
                  style={{ width: 80, border: '1.5px solid #fbbf24', borderRadius: 8, padding: '5px 8px', fontSize: 13, textAlign: 'right', outline: 'none', backgroundColor: '#fffbeb' }}
                />
              </div>
            );
          })}
        </div>

        <button
          onClick={handleExecuteAll}
          disabled={!hasPending}
          style={{
            width: '100%', marginTop: 14,
            backgroundColor: hasPending ? C.green : '#e8eaed',
            color: hasPending ? '#fff' : C.sub,
            fontWeight: 700, fontSize: 15, padding: '13px 0',
            borderRadius: 12, border: 'none',
            cursor: hasPending ? 'pointer' : 'default',
            transition: 'background-color 0.2s', letterSpacing: 1,
          }}
        >
          ✓ 一键执行转账
        </button>
      </Card>
      </div>

      {/* Step 3: 理财配置 & 再平衡 */}
      <div id="sec-invest">
      <Card title="③ 理财配置 & 再平衡" subtitle="编辑持仓金额，输入本次投入后执行">
        {/* 色条 */}
        <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: 14 }}>
          {investKeys.map((k) => (
            <div key={k} style={{ width: `${totalInvest > 0 ? (current.investHoldings[k] / totalInvest) * 100 : 0}%`, backgroundColor: investMeta[k].color }} />
          ))}
        </div>

        {/* 持仓表（固定列宽） */}
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', marginBottom: 16, tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '20%' }} />
            <col style={{ width: '22%' }} />
            <col style={{ width: '20%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '24%' }} />
          </colgroup>
          <thead>
            <tr style={{ borderBottom: '2px solid #e8eaed' }}>
              <th style={thStyle}>品类</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>当前金额</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>累计收益</th>
              <th style={{ ...thStyle, textAlign: 'right', color: C.orange }}>需加</th>
              <th style={{ ...thStyle, textAlign: 'right', color: C.green }}>已加</th>
            </tr>
          </thead>
          <tbody>
            {investKeys.map((k, i) => {
              const cur = current.investHoldings[k];
              const profit = latestBreakdownProfit[k as keyof typeof latestBreakdownProfit] ?? null;
              const costBasis = profit !== null ? cur - profit : null;
              const profitRate = costBasis !== null && costBasis > 0 ? profit! / costBasis : null;
              const suggested = Math.round(rebalanceSuggested[k]);
              // 需加 = max(建议 - 已加, 0)，实时根据 localConfirmed 计算
              const localDone = parseFloat(localConfirmed[k]) || 0;
              const remaining = Math.max(suggested - localDone, 0);
              return (
                <tr key={k} style={{ backgroundColor: i % 2 === 0 ? '#fafafa' : '#fff', borderBottom: '1px solid #f1f3f4' }}>
                  <td style={{ padding: '8px 0', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', backgroundColor: investMeta[k].color, marginRight: 4, verticalAlign: 'middle', flexShrink: 0 }} />
                    {investMeta[k].label}
                  </td>
                  <td style={{ padding: '4px 0', textAlign: 'right' }}>
                    <input
                      ref={(el) => { holdingInputRefs.current[i] = el; }}
                      type="number" inputMode="decimal"
                      value={localHoldings[k]}
                      onChange={(e) => {
                        const v = e.target.value;
                        setLocalHoldings((p) => ({ ...p, [k]: /^-?0\d/.test(v) ? (v.replace(/^(-?)0+/, '$1') || '0') : v }));
                      }}
                      onFocus={(e) => e.target.select()}
                      onBlur={() => syncHolding(k)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { syncHolding(k); holdingInputRefs.current[i + 1]?.focus(); }
                      }}
                      style={{ width: '100%', border: 'none', borderBottom: '1px solid #dadce0', outline: 'none', backgroundColor: 'transparent', fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: '#202124', textAlign: 'right' }}
                    />
                  </td>
                  {/* 累计收益 */}
                  <td style={{ padding: '8px 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {profit !== null ? (
                      <>
                        <div style={{ fontSize: 12, fontWeight: 600, color: profit >= 0 ? C.red : C.green }}>
                          {profit >= 0 ? '+' : ''}{Math.round(profit)}
                        </div>
                        {profitRate !== null && (
                          <div style={{ fontSize: 10, color: C.sub }}>
                            {profitRate >= 0 ? '+' : ''}{(profitRate * 100).toFixed(1)}%
                          </div>
                        )}
                      </>
                    ) : (
                      <span style={{ fontSize: 11, color: C.sub }}>—</span>
                    )}
                  </td>
                  {/* 需加（实时 = 建议 - 已加，整数显示） */}
                  <td style={{ padding: '8px 0', textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: remaining > 0 ? C.orange : C.sub }}>
                    {suggested > 0 ? (remaining > 0 ? `+${Math.round(remaining)}` : '✓') : '—'}
                  </td>
                  {/* 已加（编辑后按执行键生效） */}
                  <td style={{ padding: '4px 0', textAlign: 'right' }}>
                    <input
                      ref={(el) => { rebalanceInputRefs.current[i] = el; }}
                      type="number" inputMode="decimal"
                      value={localConfirmed[k]}
                      onChange={(e) => {
                        const v = e.target.value;
                        setLocalConfirmed((p) => ({ ...p, [k]: /^-?0\d/.test(v) ? (v.replace(/^(-?)0+/, '$1') || '0') : v }));
                      }}
                      onFocus={(e) => e.target.select()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') rebalanceInputRefs.current[i + 1]?.focus();
                      }}
                      style={{ width: '100%', border: 'none', borderBottom: `1px solid ${C.green}`, outline: 'none', backgroundColor: 'transparent', fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: C.green, textAlign: 'right' }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* 执行按钮：将"已加"数值写入持仓，然后清零 */}
        <button
          onClick={() => {
            const newHoldings = { ...current.investHoldings };
            for (const k of investKeys) {
              const added = parseFloat(localConfirmed[k]) || 0;
              if (added !== 0) {
                newHoldings[k] = +(newHoldings[k] + added).toFixed(2);
              }
            }
            updateHoldings(newHoldings);
            setLocalHoldings(Object.fromEntries(investKeys.map((k) => [k, String(newHoldings[k])])) as Record<InvestKey, string>);
            // 重置已加为 0
            setLocalConfirmed(Object.fromEntries(investKeys.map((k) => [k, '0'])) as Record<InvestKey, string>);
          }}
          style={{
            width: '100%', padding: '10px 0', borderRadius: 10, border: 'none',
            backgroundColor: C.green, color: '#fff', fontWeight: 600, fontSize: 14,
            cursor: 'pointer', marginBottom: 12,
          }}
        >
          执行加仓
        </button>

        {/* 本次投入总额（仅显示，供参考） */}
        <div style={{ display: 'flex', alignItems: 'center', border: '1.5px solid #fbbf24', borderRadius: 10, padding: '10px 12px', backgroundColor: '#fffbeb', marginBottom: 12 }}>
          <span style={{ color: C.sub, fontSize: 14, marginRight: 4 }}>本次投入 ¥</span>
          <input
            type="number" inputMode="decimal" value={investInput}
            onChange={(e) => { const v = e.target.value; setInvestInput(/^-?0\d/.test(v) ? (v.replace(/^(-?)0+/, '$1') || '0') : v); }}
            placeholder="输入总额，自动分配到各行"
            style={{ flex: 1, border: 'none', outline: 'none', fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums', backgroundColor: 'transparent', textAlign: 'right' }}
          />
        </div>
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
