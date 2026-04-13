import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../components/Card';
import { formatCurrency } from '../components/CurrencyDisplay';
import { useSnapshotStore } from '../stores/snapshotStore';
import { useConfigStore } from '../stores/configStore';
import { useMonthlyStore } from '../stores/monthlyStore';
import { useCalendarStore } from '../stores/calendarStore';
import { calcBudget } from '../calculations/budget';
import { calcHistoryStats } from '../calculations/history';
import { calcRebalance } from '../calculations/rebalance';
import { investMeta } from '../data/mockData';
import type { DailyTag, InvestKey } from '../models/types';

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

  // 今天
  const today = new Date(2026, 3, 11); // 对账日固定（后续改为动态）

  // 历史均值
  const stats = useMemo(() => calcHistoryStats(records), [records]);

  // 将 tagMap 转为 DailyTag[]
  const tags: DailyTag[] = useMemo(
    () => Object.entries(tagMap).map(([date, tag]) => ({ date, tag })),
    [tagMap],
  );

  // 预算计算
  const budget = useMemo(
    () => calcBudget(config, stats, confirmed, tags, today),
    [config, stats, confirmed, tags],
  );

  // 理财再平衡建议
  const rebalance = useMemo(
    () => calcRebalance(current.investHoldings, config.investAllocTargets, parseFloat(investInput) || 0),
    [current.investHoldings, config.investAllocTargets, investInput],
  );
  const investKeys = Object.keys(current.investHoldings) as InvestKey[];
  const totalInvest = investKeys.reduce((s, k) => s + current.investHoldings[k], 0);

  const handleInvestExecute = () => {
    const newFunds = parseFloat(investInput) || 0;
    if (newFunds <= 0) return;
    const newHoldings = { ...current.investHoldings };
    for (const k of investKeys) newHoldings[k] = +(newHoldings[k] + rebalance[k]).toFixed(2);
    updateHoldings(newHoldings);
    setInvestInput('');
  };

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

  // 预算明细（静态说明，后续可从计算引擎生成）
  const budgetDetails: Record<BudgetKey, { income: BudgetDetailItem[]; expense: BudgetDetailItem[] }> = {
    weekly: {
      income: config.incomeItems.filter(i => i.isActive).map(i => ({
        icon: '💰', label: i.name, amount: Math.round(i.amount * 7 / 30 * 100) / 100, note: '按7天均摊',
      })),
      expense: [
        { icon: '🎓', label: '校园卡消费', amount: Math.round(stats.schoolDailyAvg * Math.min(budget.daysLeftInMonth, 7)), note: `均 ¥${stats.schoolDailyAvg.toFixed(0)}/天` },
        { icon: '🏦', label: '生活日常', amount: Math.round((stats.periodicLifeAvg + stats.volatileLifeAvg) / 30 * 7), note: '周期+波动均摊' },
      ],
    },
    monthly: {
      income: config.incomeItems.filter(i => i.isActive).map(i => ({
        icon: '💰', label: i.name, amount: Math.round(i.amount * budget.daysLeftInMonth / 30 * 100) / 100, note: `剩余${budget.daysLeftInMonth}天`,
      })),
      expense: [
        { icon: '💳', label: '信用卡还款', amount: current.accounts.credit, note: `${config.creditPayDate}号还款` },
        { icon: '🏦', label: '周期生活支出', amount: Math.round(stats.periodicLifeAvg), note: '月均' },
        { icon: '🌊', label: '波动生活支出', amount: Math.round(stats.volatileLifeAvg * budget.daysLeftInMonth / 30), note: '按剩余天数' },
      ],
    },
    beyond: {
      income: config.incomeItems.filter(i => i.isActive).map(i => ({
        icon: '💰', label: i.name, amount: i.amount, note: '次月全额',
      })),
      expense: [
        { icon: '📈', label: '定投计划', amount: budget.recommended.invest, note: '月末执行' },
        { icon: '💼', label: '消费账户预存', amount: budget.recommended.consumption },
        { icon: '🏺', label: '心愿罐', amount: budget.recommended.wishJar },
        { icon: '🏠', label: '回家额外开销', amount: budget.homeDaysLeft * 100, note: `预计${budget.homeDaysLeft}天` },
      ],
    },
  };

  const budgetRows: { key: BudgetKey; name: string; inc: number; exp: number }[] = [
    { key: 'weekly',  name: '周内 (近7天)',  inc: budget.weekly.income,  exp: budget.weekly.expense },
    { key: 'monthly', name: '月内 (本月余)', inc: budget.monthly.income, exp: budget.monthly.expense },
    { key: 'beyond',  name: '月外 (跨月)',   inc: budget.beyond.income,  exp: budget.beyond.expense },
  ];

  const reconcileMode = today.getDate() === 1 ? '月初归档' : today.getDate() <= 15 ? '常规（11号）' : '常规（21号）';

  // 信用卡提醒

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 4px' }}>对账 / 转账</h1>
      <p style={{ fontSize: 13, color: C.sub, margin: '0 0 16px' }}>
        今天 2026-04-11，对账模式：<span style={{ color: C.blue, fontWeight: 600 }}>{reconcileMode}</span>
      </p>

      {/* 对账流程引导 */}
      <Card title="对账流程" subtitle="按步骤完成各项操作">
        {[
          { num: '①', label: '日历标记', note: '标记本月各天状态', path: '/calendar', done: false },
          { num: '②', label: '更新账户余额', note: '在主页填写各账户余额', path: '/', done: false },
          { num: '③', label: '预算计算', note: '查看预算分层明细', path: null, done: false },
          { num: '④', label: '执行转账', note: '填写并执行各账户划转', path: null, done: false },
          { num: '⑤', label: '理财再平衡', note: '输入新资金，按比例分配', path: null, done: false },
          { num: '⑥', label: '历史记录', note: '录入本月数据', path: '/history', done: false },
        ].map((step) => (
          <div key={step.num} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid #f1f3f4' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: C.blue, width: 24 }}>{step.num}</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#202124' }}>{step.label}</div>
                <div style={{ fontSize: 11, color: C.sub }}>{step.note}</div>
              </div>
            </div>
            {step.path ? (
              <button
                onClick={() => navigate(step.path!)}
                style={{ fontSize: 12, color: C.blue, backgroundColor: '#e8f0fe', border: 'none', borderRadius: 8, padding: '5px 12px', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}
              >
                前往 →
              </button>
            ) : (
              <span style={{ fontSize: 12, color: C.sub, backgroundColor: '#f1f3f4', borderRadius: 8, padding: '5px 12px' }}>当前页</span>
            )}
          </div>
        ))}
      </Card>

      {/* Step 1: 预算计算 */}
      <Card title="① 预算计算" subtitle="点击行查看明细">
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.sub, marginBottom: 12 }}>
          <span>本月剩余 {budget.daysLeftInMonth} 天</span>
          <span>在校 {budget.schoolDaysLeft} · 回家 {budget.homeDaysLeft}</span>
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
                  width: '100%', display: 'grid', gridTemplateColumns: '1fr auto auto auto',
                  alignItems: 'center', gap: 8, padding: '10px 10px', borderRadius: 10,
                  border: 'none', cursor: 'pointer', textAlign: 'left',
                  backgroundColor: isOpen ? '#e8f0fe' : i % 2 === 0 ? '#fafafa' : '#fff',
                  transition: 'background-color 0.15s',
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 600, color: isOpen ? C.blue : '#202124' }}>{row.name}</span>
                <span style={{ fontSize: 12, color: C.red, fontVariantNumeric: 'tabular-nums' }}>+¥{formatCurrency(row.inc)}</span>
                <span style={{ fontSize: 12, color: C.green, fontVariantNumeric: 'tabular-nums' }}>-¥{formatCurrency(row.exp)}</span>
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
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 14px', backgroundColor: balance >= 0 ? '#e6f4ea' : '#fce8e6', fontSize: 13, fontWeight: 600 }}>
                    <span style={{ color: C.sub }}>本层结余</span>
                    <span style={{ color: balance >= 0 ? C.green : C.red, fontVariantNumeric: 'tabular-nums' }}>
                      {balance >= 0 ? '+' : ''}¥{formatCurrency(balance)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </Card>

      {/* Step 2: 建议转账 */}
      <Card title="② 建议转账" subtitle="填写各账户本次转账金额，一键执行">
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e8eaed' }}>
              <th style={thStyle}>目的账户</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>应转</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>已确认</th>
              <th style={{ ...thStyle, textAlign: 'center', width: 84 }}>本次转</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>还需转</th>
            </tr>
          </thead>
          <tbody>
            {TRANSFER_KEYS.map((key, i) => {
              const rec = budget.recommended[key];
              const conf = confirmed[key] || 0;
              const remain = Math.max(rec - conf, 0);
              return (
                <tr key={key} style={{ backgroundColor: i % 2 === 0 ? '#fafafa' : '#fff', borderBottom: '1px solid #f1f3f4' }}>
                  <td style={{ padding: '10px 0', fontWeight: 500 }}>{TRANSFER_META[key].label}</td>
                  <td style={{ padding: '10px 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: C.orange }}>¥{formatCurrency(rec)}</td>
                  <td style={{ padding: '10px 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: conf > 0 ? C.green : C.sub }}>¥{formatCurrency(conf)}</td>
                  <td style={{ padding: '6px 4px' }}>
                    <input
                      type="number"
                      value={pending[key]}
                      onChange={(e) => setPending((p) => ({ ...p, [key]: e.target.value }))}
                      placeholder="0"
                      style={{ width: '100%', border: '1.5px solid #fbbf24', borderRadius: 8, padding: '6px 8px', fontSize: 13, textAlign: 'right', fontVariantNumeric: 'tabular-nums', outline: 'none', backgroundColor: '#fffbeb' }}
                    />
                  </td>
                  <td style={{ padding: '10px 6px', textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: remain > 0 ? C.orange : C.sub }}>
                    ¥{formatCurrency(remain)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <button
          onClick={handleExecuteAll}
          disabled={!hasPending}
          style={{
            width: '100%', marginTop: 16,
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

      {/* Step 3: 理财再平衡 */}
      <Card title="③ 理财投入 & 再平衡" subtitle="输入本次投入金额，按目标比例分配">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', border: '1.5px solid #fbbf24', borderRadius: 10, padding: '10px 12px', backgroundColor: '#fffbeb' }}>
            <span style={{ color: C.sub, fontSize: 14, marginRight: 4 }}>¥</span>
            <input
              type="number" inputMode="decimal" value={investInput}
              onChange={(e) => setInvestInput(e.target.value)}
              placeholder="本次投入金额"
              style={{ flex: 1, border: 'none', outline: 'none', fontSize: 14, fontVariantNumeric: 'tabular-nums', backgroundColor: 'transparent' }}
            />
          </div>
        </div>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e8eaed' }}>
              <th style={thStyle}>品类</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>当前</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>目标%</th>
              <th style={{ ...thStyle, textAlign: 'right', color: C.orange }}>本次加仓</th>
            </tr>
          </thead>
          <tbody>
            {investKeys.map((k, i) => {
              const cur = current.investHoldings[k];
              const target = config.investAllocTargets[k];
              const add = rebalance[k];
              return (
                <tr key={k} style={{ backgroundColor: i % 2 === 0 ? '#fafafa' : '#fff', borderBottom: '1px solid #f1f3f4' }}>
                  <td style={{ padding: '9px 0', fontWeight: 500 }}>
                    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', backgroundColor: investMeta[k].color, marginRight: 6, verticalAlign: 'middle' }} />
                    {investMeta[k].label}
                  </td>
                  <td style={{ padding: '9px 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: C.sub }}>
                    ¥{formatCurrency(cur)}<br />
                    <span style={{ fontSize: 11 }}>{totalInvest > 0 ? ((cur / totalInvest) * 100).toFixed(1) : '0'}%</span>
                  </td>
                  <td style={{ padding: '9px 0', textAlign: 'right', color: C.sub, fontSize: 12 }}>{(target * 100).toFixed(1)}%</td>
                  <td style={{ padding: '9px 0', textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: add > 0 ? C.orange : C.sub }}>
                    {add > 0 ? `+¥${formatCurrency(add)}` : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <button
          onClick={handleInvestExecute}
          disabled={!(parseFloat(investInput) > 0)}
          style={{
            width: '100%', marginTop: 16,
            backgroundColor: parseFloat(investInput) > 0 ? C.orange : '#e8eaed',
            color: parseFloat(investInput) > 0 ? '#fff' : C.sub,
            fontWeight: 700, fontSize: 15, padding: '13px 0',
            borderRadius: 12, border: 'none',
            cursor: parseFloat(investInput) > 0 ? 'pointer' : 'default',
            transition: 'background-color 0.2s', letterSpacing: 1,
          }}
        >
          ✓ 一键执行再平衡
        </button>
      </Card>

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
