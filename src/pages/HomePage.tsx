import { useMemo, useState } from 'react';
import Card from '../components/Card';
import StatRow from '../components/StatRow';
import CurrencyDisplay, { formatCurrency } from '../components/CurrencyDisplay';
import { useSnapshotStore } from '../stores/snapshotStore';
import { useConfigStore } from '../stores/configStore';
import { useMonthlyStore } from '../stores/monthlyStore';
import { investMeta } from '../data/mockData';
import { calcHistoryStats } from '../calculations/history';
import { calcFire } from '../calculations/fire';
import { calcDeviation } from '../calculations/rebalance';
import type { InvestKey } from '../models/types';

const C = { blue: '#1a73e8', red: '#ea4335', green: '#0d9488', purple: '#7c3aed', sub: '#5f6368', orange: '#e8710a' };

function ProgressBar({ progress, color = C.blue, height = 8 }: { progress: number; color?: string; height?: number }) {
  return (
    <div style={{ height, backgroundColor: '#e8eaed', borderRadius: height / 2, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${Math.min(progress * 100, 100)}%`, backgroundColor: color, borderRadius: height / 2, transition: 'width 0.3s' }} />
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, backgroundColor: '#e8eaed', margin: '10px 0' }} />;
}

export default function HomePage() {
  const { current, updateAccounts } = useSnapshotStore();
  const { config } = useConfigStore();
  const { records } = useMonthlyStore();

  const [localAccounts, setLocalAccounts] = useState({
    credit:      String(current.accounts.credit),
    campusCard:  String(current.accounts.campusCard),
    livingBank:  String(current.accounts.livingBank),
  });

  const syncAccounts = () => updateAccounts({
    credit:      parseFloat(localAccounts.credit)     || 0,
    campusCard:  parseFloat(localAccounts.campusCard) || 0,
    livingBank:  parseFloat(localAccounts.livingBank) || 0,
  });

  const stats  = useMemo(() => calcHistoryStats(records), [records]);
  const fire   = useMemo(() => calcFire(config, stats, current.investHoldings ? Object.values(current.investHoldings).reduce((s, v) => s + v, 0) : 0), [config, stats, current.investHoldings]);
  const dev    = useMemo(() => calcDeviation(current.investHoldings, config.investAllocTargets), [current.investHoldings, config.investAllocTargets]);

  const holdings   = current.investHoldings;
  const totalInvest = Object.values(holdings).reduce((s, v) => s + v, 0);
  const investKeys  = Object.keys(holdings) as InvestKey[];

  const netWorth = totalInvest + current.accounts.campusCard + current.accounts.livingBank + current.accounts.consumptionBank - current.accounts.credit;

  const today        = new Date(2026, 3, 11);
  const daysInMonth  = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const monthProgress = today.getDate() / daysInMonth;

  const monthlySurplus = stats.monthlyIncomeAvg - stats.totalExpenseAvg;

  // 信用卡还款提醒
  const d = today.getDate();
  const showPayWarning = d >= 8 && d <= config.creditPayDate;

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 4px' }}>盘账助手</h1>
      <p style={{ fontSize: 13, color: C.sub, margin: '0 0 16px' }}>
        {today.getFullYear()}年{today.getMonth() + 1}月 · 第 {today.getDate()} 天
      </p>

      {/* 卡片1: 财务概览 */}
      <Card title="财务概览">
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: C.sub, marginBottom: 4 }}>理财总额</div>
          <CurrencyDisplay value={totalInvest} size="xl" color={C.blue} />
        </div>
        <StatRow label="净资产" value={<CurrencyDisplay value={netWorth} />} />
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.sub, marginBottom: 6 }}>
            <span>本月进度</span>
            <span>{today.getDate()}/{daysInMonth} 天</span>
          </div>
          <ProgressBar progress={monthProgress} />
        </div>
      </Card>

      {/* 卡片2: 月度快照 */}
      <Card title="月度快照" subtitle="历史均值">
        <StatRow label="月均收入" value={<CurrencyDisplay value={stats.monthlyIncomeAvg} color={C.red} />} />
        <StatRow label="月均支出" value={<CurrencyDisplay value={stats.totalExpenseAvg} color={C.green} />} />
        <StatRow label="周期生活" indent value={<CurrencyDisplay value={stats.periodicLifeAvg} color={C.blue} />} />
        <StatRow label="波动生活" indent value={<CurrencyDisplay value={stats.volatileLifeAvg} color={C.blue} />} />
        <StatRow label="消费" indent value={<CurrencyDisplay value={stats.consumptionAvg} color={C.purple} />} />
        <Divider />
        <StatRow label="月均结余" value={<CurrencyDisplay value={monthlySurplus} color={monthlySurplus >= 0 ? C.green : C.red} />} />
        <StatRow
          label="储蓄率"
          value={<span style={{ color: stats.savingsRate >= 0 ? C.green : C.red, fontWeight: 500 }}>{(stats.savingsRate * 100).toFixed(1)}%</span>}
        />
        <Divider />
        <div style={{ fontSize: 12, color: C.sub, marginBottom: 4 }}>场景日均</div>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <tbody>
            {[
              { icon: '📚', name: '在校', val: stats.schoolDailyAvg },
              { icon: '🏠', name: '在家', val: 89.5 },
              { icon: '💼', name: '实习', val: 156.3 },
              { icon: '✈️', name: '出差', val: 312.0 },
            ].map((r) => (
              <tr key={r.name}>
                <td style={{ padding: '5px 0', color: C.sub }}>{r.icon} {r.name}</td>
                <td style={{ padding: '5px 0', textAlign: 'right', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>¥{formatCurrency(r.val)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* 卡片3: FIRE */}
      <Card title="FIRE 提前退休" subtitle="4% 法则">
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.sub, marginBottom: 6 }}>
            <span>进度</span>
            <span style={{ fontWeight: 600, color: C.blue }}>{(fire.progress * 100).toFixed(2)}%</span>
          </div>
          <ProgressBar progress={fire.progress} height={10} />
        </div>
        <StatRow label="目标资产" value={<CurrencyDisplay value={fire.fireTarget} />} />
        <StatRow label="已积累" value={<CurrencyDisplay value={totalInvest} color={C.blue} />} />
        <StatRow label="月需存入" value={<CurrencyDisplay value={fire.monthlyNeeded} color={C.orange} />} />
        <StatRow label="当前月结余" value={<CurrencyDisplay value={fire.monthlySurplus} color={fire.monthlySurplus >= 0 ? C.green : C.red} />} />
        <Divider />
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <div style={{ fontVariantNumeric: 'tabular-nums', fontSize: 32, fontWeight: 700, letterSpacing: 2, color: '#202124', fontFamily: 'monospace' }}>
            {fire.lifeClockStr}
          </div>
          <div style={{ fontSize: 13, color: C.sub }}>{fire.lifeClockPeriod}</div>
        </div>
      </Card>

      {/* 卡片4: 资产配置 */}
      <Card title="资产配置">
        <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', marginBottom: 16 }}>
          {investKeys.map((k) => (
            <div key={k} style={{ width: `${(holdings[k] / totalInvest) * 100}%`, backgroundColor: investMeta[k].color }} />
          ))}
        </div>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e8eaed' }}>
              <th style={{ textAlign: 'left', padding: '6px 0', fontSize: 12, color: C.sub, fontWeight: 500 }}>品类</th>
              <th style={{ textAlign: 'right', padding: '6px 0', fontSize: 12, color: C.sub, fontWeight: 500 }}>金额</th>
              <th style={{ textAlign: 'right', padding: '6px 0', fontSize: 12, color: C.sub, fontWeight: 500 }}>占比</th>
              <th style={{ textAlign: 'right', padding: '6px 0', fontSize: 12, color: C.sub, fontWeight: 500 }}>偏差</th>
            </tr>
          </thead>
          <tbody>
            {investKeys.map((k, i) => {
              const amount = holdings[k];
              const pct    = totalInvest > 0 ? amount / totalInvest : 0;
              const diff   = dev[k];
              const diffAbs = Math.abs(diff);
              const diffColor = diffAbs <= 0.02 ? C.green : diff > 0 ? C.red : C.blue;
              return (
                <tr key={k} style={{ borderBottom: '1px solid #f1f3f4', backgroundColor: i % 2 === 0 ? '#fafafa' : '#fff' }}>
                  <td style={{ padding: '8px 0' }}>
                    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', backgroundColor: investMeta[k].color, marginRight: 6, verticalAlign: 'middle' }} />
                    {investMeta[k].label}
                  </td>
                  <td style={{ textAlign: 'right', padding: '8px 0', fontVariantNumeric: 'tabular-nums' }}>¥{formatCurrency(amount)}</td>
                  <td style={{ textAlign: 'right', padding: '8px 0', color: C.sub, fontVariantNumeric: 'tabular-nums' }}>{(pct * 100).toFixed(1)}%</td>
                  <td style={{ textAlign: 'right', padding: '8px 0', color: diffColor, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{diff >= 0 ? '+' : ''}{(diff * 100).toFixed(1)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {/* 卡片5: 账户余额（可编辑，失焦保存） */}
      <Card title="账户余额" subtitle="点击金额可编辑">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {([
            { key: 'credit',     icon: '💳', name: '信用卡 (待还)', bg: '#fce8e6', border: '#f28b82' },
            { key: 'campusCard', icon: '🎓', name: '校园卡',         bg: '#f1f3f4', border: '#dadce0' },
            { key: 'livingBank', icon: '🏦', name: '生活',           bg: '#e8f0fe', border: '#a8c7fa' },
          ] as const).map((r) => (
            <div key={r.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: r.bg, borderRadius: 12, padding: '10px 14px', border: `1.5px solid ${r.border}` }}>
              <span style={{ fontSize: 14, color: '#202124', fontWeight: 500, flexShrink: 0 }}>{r.icon} {r.name}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <span style={{ fontSize: 13, color: '#5f6368' }}>¥</span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={localAccounts[r.key]}
                  onChange={(e) => setLocalAccounts((p) => ({ ...p, [r.key]: e.target.value }))}
                  onBlur={syncAccounts}
                  style={{ width: 90, border: 'none', outline: 'none', backgroundColor: 'transparent', fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: '#202124', textAlign: 'right' }}
                />
              </div>
            </div>
          ))}
        </div>
        {showPayWarning && (
          <div style={{ marginTop: 12, fontSize: 13, color: '#c5221f', backgroundColor: '#fce8e6', border: '1px solid #f28b82', borderRadius: 12, padding: '10px 14px' }}>
            ⚠️ 信用卡 {config.creditPayDate} 号还款，剩余 {config.creditPayDate - d} 天
          </div>
        )}
      </Card>
    </div>
  );
}
