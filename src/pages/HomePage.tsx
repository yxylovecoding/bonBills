import Card from '../components/Card';
import StatRow from '../components/StatRow';
import CurrencyDisplay, { formatCurrency } from '../components/CurrencyDisplay';
import {
  currentStats,
  latestSnapshot,
  investTargets,
  investMeta,
} from '../data/mockData';

// 估算值 (MVP 硬编码，后续由计算引擎给出)
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

// 本月天数进度 (今天 2026-04-11)
const today = new Date(2026, 3, 11);
const daysInMonth = 30; // 四月
const monthProgress = today.getDate() / daysInMonth;

const holdings = latestSnapshot.investHoldings;
const totalInvest = latestSnapshot.investTotal;
const investKeys = Object.keys(holdings) as (keyof typeof holdings)[];

export default function HomePage() {
  return (
    <div>
      <h1 className="text-xl font-semibold mb-3">盘账助手</h1>
      <p className="text-xs text-white/40 mb-4">2026年4月 · 第 11 天</p>

      {/* 卡片1: 财务概览 */}
      <Card title="财务概览">
        <div className="mb-3">
          <div className="text-xs text-white/40 mb-1">理财总额</div>
          <CurrencyDisplay value={totalInvest} size="xl" className="text-white" />
        </div>
        <StatRow
          label="净资产"
          value={<CurrencyDisplay value={netWorth} />}
        />
        <div className="mt-2">
          <div className="flex justify-between text-xs text-white/40 mb-1">
            <span>本月进度</span>
            <span>{today.getDate()}/{daysInMonth} 天</span>
          </div>
          <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500"
              style={{ width: `${monthProgress * 100}%` }}
            />
          </div>
        </div>
      </Card>

      {/* 卡片2: 月度快照 */}
      <Card title="月度快照" subtitle="近期均值">
        <StatRow
          label="月均收入"
          value={<CurrencyDisplay value={currentStats.monthlyIncomeAvg} className="text-income" />}
        />
        <StatRow
          label="月均支出"
          value={<CurrencyDisplay value={currentStats.totalExpenseAvg} className="text-expense" />}
        />
        <StatRow
          label="周期生活"
          indent
          value={<CurrencyDisplay value={currentStats.periodicLifeAvg} className="text-life" />}
        />
        <StatRow
          label="波动生活"
          indent
          value={<CurrencyDisplay value={currentStats.volatileLifeAvg} className="text-life" />}
        />
        <StatRow
          label="消费"
          indent
          value={<CurrencyDisplay value={currentStats.consumptionAvg} className="text-consume" />}
        />
        <div className="h-px bg-white/5 my-2" />
        <StatRow
          label="月均结余"
          value={
            <CurrencyDisplay
              value={monthlySurplus}
              className={monthlySurplus >= 0 ? 'text-expense' : 'text-income'}
            />
          }
        />
        <StatRow
          label="储蓄率"
          value={
            <span className={currentStats.savingsRate >= 0 ? 'text-expense' : 'text-income'}>
              {(currentStats.savingsRate * 100).toFixed(1)}%
            </span>
          }
        />
        <div className="h-px bg-white/5 my-2" />
        <div className="text-xs text-white/40 mb-1">场景日均</div>
        <StatRow label="📚 在校" value={<CurrencyDisplay value={currentStats.schoolDailyAvg} size="sm" />} />
        <StatRow label="🏠 在家" value={<CurrencyDisplay value={89.5} size="sm" />} />
        <StatRow label="💼 实习" value={<CurrencyDisplay value={156.3} size="sm" />} />
        <StatRow label="✈️ 出差" value={<CurrencyDisplay value={312.0} size="sm" />} />
      </Card>

      {/* 卡片3: FIRE */}
      <Card title="FIRE 提前退休" subtitle="4% 法则">
        <div className="mb-3">
          <div className="flex justify-between text-xs text-white/40 mb-1">
            <span>进度</span>
            <span>{(fireProgress * 100).toFixed(2)}%</span>
          </div>
          <div className="h-2 bg-white/5 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-emerald-500"
              style={{ width: `${Math.min(fireProgress * 100, 100)}%` }}
            />
          </div>
        </div>
        <StatRow label="目标资产" value={<CurrencyDisplay value={fireTarget} />} />
        <StatRow label="已积累" value={<CurrencyDisplay value={latestSnapshot.investTotal} />} />
        <StatRow
          label="月需存入"
          value={<CurrencyDisplay value={monthlyNeeded} className="text-orange-400" />}
        />
        <StatRow
          label="当前月结余"
          value={
            <CurrencyDisplay
              value={monthlySurplus}
              className={monthlySurplus >= 0 ? 'text-expense' : 'text-income'}
            />
          }
        />
        <div className="h-px bg-white/5 my-2" />
        <div className="text-xs text-white/40 mb-1">人生进度 {age}/{lifeExpectancy}</div>
        <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
          <div
            className="h-full bg-white/40"
            style={{ width: `${lifeProgress * 100}%` }}
          />
        </div>
      </Card>

      {/* 卡片4: 资产配置 */}
      <Card title="资产配置">
        <div className="flex h-3 rounded-full overflow-hidden mb-3">
          {investKeys.map((k) => {
            const pct = (holdings[k] / totalInvest) * 100;
            return (
              <div
                key={k}
                style={{ width: `${pct}%`, backgroundColor: investMeta[k].color }}
              />
            );
          })}
        </div>
        <div className="space-y-1.5">
          {investKeys.map((k) => {
            const amount = holdings[k];
            const currentPct = amount / totalInvest;
            const targetPct = investTargets[k];
            const diff = currentPct - targetPct;
            const diffAbs = Math.abs(diff);
            let diffColor = 'text-expense';
            if (diffAbs > 0.02) diffColor = diff > 0 ? 'text-income' : 'text-life';
            return (
              <div key={k} className="flex items-center gap-2 text-xs">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: investMeta[k].color }}
                />
                <span className="text-white/80 w-10">{investMeta[k].label}</span>
                <span className="tabular-nums text-white/60 flex-1">
                  ¥{formatCurrency(amount)}
                </span>
                <span className="tabular-nums text-white/40 w-12 text-right">
                  {(currentPct * 100).toFixed(1)}%
                </span>
                <span className={`tabular-nums w-14 text-right ${diffColor}`}>
                  {diff >= 0 ? '+' : ''}{(diff * 100).toFixed(1)}%
                </span>
              </div>
            );
          })}
        </div>
      </Card>

      {/* 卡片5: 账户余额 */}
      <Card title="账户余额">
        <StatRow
          label="💳 信用卡 (待还)"
          value={<CurrencyDisplay value={latestSnapshot.credit} className="text-income" />}
        />
        <StatRow
          label="🎓 校园卡"
          value={<CurrencyDisplay value={latestSnapshot.campusCard} />}
        />
        <StatRow
          label="🏦 生活"
          value={<CurrencyDisplay value={latestSnapshot.livingBank} className="text-life" />}
        />
        <StatRow
          label="💼 消费 (交行)"
          value={<CurrencyDisplay value={latestSnapshot.consumptionBank} className="text-consume" />}
        />
        <StatRow
          label="📈 理财"
          value={<CurrencyDisplay value={latestSnapshot.investTotal} />}
        />
        <div className="mt-3 text-xs text-orange-400 bg-orange-500/10 rounded-lg p-2">
          ⚠️ 信用卡 13 号还款，剩余 2 天
        </div>
      </Card>
    </div>
  );
}
