import Card from '../components/Card';
import StatRow from '../components/StatRow';
import CurrencyDisplay, { formatCurrency } from '../components/CurrencyDisplay';
import {
  currentStats,
  latestSnapshot,
  investTargets,
  investMeta,
} from '../data/mockData';

const C = { blue: '#1a73e8', red: '#ea4335', green: '#0d9488', purple: '#7c3aed', sub: '#5f6368', orange: '#e8710a' };

const netWorth =
  latestSnapshot.investTotal +
  latestSnapshot.campusCard +
  latestSnapshot.livingBank +
  latestSnapshot.consumptionBank -
  latestSnapshot.credit;

const age = 23;
const retireAge = 55;
const annualExpense = currentStats.totalExpenseAvg * 12;
const fireTarget4 = annualExpense / 0.04;
const fireTargetAge = annualExpense * (retireAge - age);
const fireTarget = Math.min(fireTarget4, fireTargetAge);
const fireProgress = latestSnapshot.investTotal / fireTarget;
const monthlyNeeded = (fireTarget - latestSnapshot.investTotal) / ((retireAge - age) * 12);
const monthlySurplus = currentStats.monthlyIncomeAvg - currentStats.totalExpenseAvg;

const lifeExpectancy = 85;
const lifeProgress = age / lifeExpectancy;

const today = new Date(2026, 3, 11);
const daysInMonth = 30;
const monthProgress = today.getDate() / daysInMonth;

const holdings = latestSnapshot.investHoldings;
const totalInvest = latestSnapshot.investTotal;
const investKeys = Object.keys(holdings) as (keyof typeof holdings)[];

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
  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 4px' }}>盘账助手</h1>
      <p style={{ fontSize: 13, color: C.sub, margin: '0 0 16px' }}>2026年4月 · 第 11 天</p>

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
      <Card title="月度快照" subtitle="近期均值">
        <StatRow label="月均收入" value={<CurrencyDisplay value={currentStats.monthlyIncomeAvg} color={C.red} />} />
        <StatRow label="月均支出" value={<CurrencyDisplay value={currentStats.totalExpenseAvg} color={C.green} />} />
        <StatRow label="周期生活" indent value={<CurrencyDisplay value={currentStats.periodicLifeAvg} color={C.blue} />} />
        <StatRow label="波动生活" indent value={<CurrencyDisplay value={currentStats.volatileLifeAvg} color={C.blue} />} />
        <StatRow label="消费" indent value={<CurrencyDisplay value={currentStats.consumptionAvg} color={C.purple} />} />
        <Divider />
        <StatRow
          label="月均结余"
          value={<CurrencyDisplay value={monthlySurplus} color={monthlySurplus >= 0 ? C.green : C.red} />}
        />
        <StatRow
          label="储蓄率"
          value={<span style={{ color: currentStats.savingsRate >= 0 ? C.green : C.red, fontWeight: 500 }}>{(currentStats.savingsRate * 100).toFixed(1)}%</span>}
        />
        <Divider />
        <div style={{ fontSize: 12, color: C.sub, marginBottom: 4 }}>场景日均</div>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <tbody>
            {[
              { icon: '📚', name: '在校', val: currentStats.schoolDailyAvg },
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
            <span style={{ fontWeight: 600, color: C.blue }}>{(fireProgress * 100).toFixed(2)}%</span>
          </div>
          <ProgressBar progress={fireProgress} height={10} />
        </div>
        <StatRow label="目标资产" value={<CurrencyDisplay value={fireTarget} />} />
        <StatRow label="已积累" value={<CurrencyDisplay value={latestSnapshot.investTotal} color={C.blue} />} />
        <StatRow label="月需存入" value={<CurrencyDisplay value={monthlyNeeded} color={C.orange} />} />
        <StatRow
          label="当前月结余"
          value={<CurrencyDisplay value={monthlySurplus} color={monthlySurplus >= 0 ? C.green : C.red} />}
        />
        <Divider />
        <div style={{ fontSize: 12, color: C.sub, marginBottom: 6 }}>人生进度 {age}/{lifeExpectancy}</div>
        <ProgressBar progress={lifeProgress} color="#9aa0a6" height={6} />
      </Card>

      {/* 卡片4: 资产配置 */}
      <Card title="资产配置">
        {/* 堆叠条 */}
        <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', marginBottom: 16 }}>
          {investKeys.map((k) => (
            <div key={k} style={{ width: `${(holdings[k] / totalInvest) * 100}%`, backgroundColor: investMeta[k].color }} />
          ))}
        </div>
        {/* 表格 */}
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
              const pct = amount / totalInvest;
              const target = investTargets[k];
              const diff = pct - target;
              const diffAbs = Math.abs(diff);
              let diffColor = C.green;
              if (diffAbs > 0.02) diffColor = diff > 0 ? C.red : C.blue;
              return (
                <tr key={k} style={{ borderBottom: '1px solid #f1f3f4', backgroundColor: i % 2 === 0 ? '#fafafa' : '#ffffff' }}>
                  <td style={{ padding: '8px 0 8px 0' }}>
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

      {/* 卡片5: 账户余额 */}
      <Card title="账户余额">
        <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
          <tbody>
            {[
              { icon: '💳', name: '信用卡 (待还)', val: latestSnapshot.credit, color: C.red },
              { icon: '🎓', name: '校园卡', val: latestSnapshot.campusCard },
              { icon: '🏦', name: '生活', val: latestSnapshot.livingBank, color: C.blue },
              { icon: '💼', name: '消费 (交行)', val: latestSnapshot.consumptionBank, color: C.purple },
              { icon: '📈', name: '理财', val: latestSnapshot.investTotal, color: C.blue },
            ].map((r) => (
              <tr key={r.name} style={{ borderBottom: '1px solid #f1f3f4' }}>
                <td style={{ padding: '10px 0', color: C.sub }}>{r.icon} {r.name}</td>
                <td style={{ padding: '10px 0', textAlign: 'right', fontWeight: 500, color: r.color || '#202124', fontVariantNumeric: 'tabular-nums' }}>¥{formatCurrency(r.val)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ marginTop: 12, fontSize: 13, color: '#e8710a', backgroundColor: '#fef7e0', border: '1px solid #fdd663', borderRadius: 12, padding: '10px 14px' }}>
          ⚠️ 信用卡 13 号还款，剩余 2 天
        </div>
      </Card>
    </div>
  );
}
