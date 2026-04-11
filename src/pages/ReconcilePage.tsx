import { useState } from 'react';
import Card from '../components/Card';
import StatRow from '../components/StatRow';
import CurrencyDisplay, { formatCurrency } from '../components/CurrencyDisplay';

// MVP 占位输入组件 - 淡黄色输入框
function InputField({
  label,
  value,
  onChange,
  placeholder = '0.00',
  prefix = '¥',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  prefix?: string;
}) {
  return (
    <label className="block mb-2">
      <div className="text-xs text-white/50 mb-1">{label}</div>
      <div className="flex items-center bg-amber-400/10 border border-amber-300/30 rounded-lg px-3 py-2">
        <span className="text-amber-300/70 text-sm mr-1">{prefix}</span>
        <input
          type="number"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 bg-transparent outline-none text-amber-100 text-sm tabular-nums"
        />
      </div>
    </label>
  );
}

// 硬编码的预算结果 (等接入 calculateBudget 后替换)
const mockBudget = {
  daysLeft: 19,
  schoolDaysLeft: 15,
  homeDaysLeft: 2,
  weekly: { income: 350.0, expense: 820.5 },
  monthly: { income: 2180.0, expense: 2546.05 },
  beyond: { income: 3081.35, expense: 3200.0 },
  recommended: {
    campusCard: 450.0,
    living: 820.5,
    consumption: 1200.0,
    wishJar: 200.0,
    invest: 1800.0,
  },
};

interface TransferRow {
  key: keyof typeof mockBudget.recommended;
  label: string;
  color?: string;
}

const TRANSFER_ROWS: TransferRow[] = [
  { key: 'campusCard', label: '🎓 校园卡' },
  { key: 'living', label: '🏦 生活', color: 'text-life' },
  { key: 'consumption', label: '💼 消费', color: 'text-consume' },
  { key: 'wishJar', label: '🏺 心愿罐' },
  { key: 'invest', label: '📈 理财' },
];

export default function ReconcilePage() {
  // Step 1: 账户余额录入
  const [credit, setCredit] = useState('2005.72');
  const [campusCard, setCampusCard] = useState('180.50');
  const [livingBank, setLivingBank] = useState('1246.30');
  const [consumptionBank, setConsumptionBank] = useState('892.15');

  // Step 3: 已转金额
  const [done, setDone] = useState<Record<string, string>>({
    campusCard: '200',
    living: '500',
    consumption: '800',
    wishJar: '0',
    invest: '0',
  });

  return (
    <div>
      <h1 className="text-xl font-semibold mb-1">对账 / 转账</h1>
      <p className="text-xs text-white/40 mb-4">今天 2026-04-11，对账模式：<span className="text-blue-400">常规（11 号）</span></p>

      {/* Step 1: 录入账户余额 */}
      <Card title="① 账户余额" subtitle="淡黄色为待录入">
        <InputField label="信用卡待还额" value={credit} onChange={setCredit} />
        <InputField label="校园卡" value={campusCard} onChange={setCampusCard} />
        <InputField label="生活银行卡" value={livingBank} onChange={setLivingBank} />
        <InputField label="消费 (交行)" value={consumptionBank} onChange={setConsumptionBank} />
      </Card>

      {/* Step 2: 预算结果 */}
      <Card title="② 预算计算" subtitle="系统计算">
        <div className="flex justify-between text-xs text-white/50 mb-3">
          <span>本月剩余 {mockBudget.daysLeft} 天</span>
          <span>在校 {mockBudget.schoolDaysLeft} · 回家 {mockBudget.homeDaysLeft}</span>
        </div>
        <div className="space-y-3">
          <BudgetLayer
            label="周内 (最近 7-10 天)"
            income={mockBudget.weekly.income}
            expense={mockBudget.weekly.expense}
          />
          <BudgetLayer
            label="月内 (本月剩余)"
            income={mockBudget.monthly.income}
            expense={mockBudget.monthly.expense}
          />
          <BudgetLayer
            label="月外 (跨月准备)"
            income={mockBudget.beyond.income}
            expense={mockBudget.beyond.expense}
          />
        </div>
      </Card>

      {/* Step 3: 转账建议 */}
      <Card title="③ 建议转账" subtitle="橙色为待执行">
        <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-x-2 gap-y-2 text-xs items-center">
          <div className="text-white/40">目的账户</div>
          <div className="text-white/40 text-right">应转</div>
          <div className="text-white/40 text-right">已转</div>
          <div className="text-white/40 text-right">还需转</div>
          {TRANSFER_ROWS.map((row) => {
            const rec = mockBudget.recommended[row.key];
            const doneVal = parseFloat(done[row.key] || '0') || 0;
            const remain = Math.max(rec - doneVal, 0);
            return (
              <RowTransfer
                key={row.key}
                label={row.label}
                labelClass={row.color}
                recommended={rec}
                doneValue={done[row.key]}
                remain={remain}
                onDoneChange={(v) =>
                  setDone((prev) => ({ ...prev, [row.key]: v }))
                }
              />
            );
          })}
        </div>
      </Card>

      {/* Step 4: 信用卡提醒 */}
      <Card title="④ 信用卡提醒">
        <div className="bg-orange-500/10 border border-orange-400/20 rounded-lg p-3 text-sm text-orange-300">
          ⚠️ 26 号出账，请确认消费
          <div className="text-xs text-orange-300/60 mt-1">
            建议提前 5 天准备还款资金 (约 <CurrencyDisplay value={2005.72} size="sm" />)
          </div>
        </div>
      </Card>

      <button
        onClick={() => alert('MVP：保存逻辑等接入 store 后实现')}
        className="w-full bg-blue-500 hover:bg-blue-600 text-white font-medium
                   py-3 rounded-xl mt-2 mb-4 active:scale-[0.99] transition-transform"
      >
        保存本次对账
      </button>
    </div>
  );
}

function BudgetLayer({
  label,
  income,
  expense,
}: {
  label: string;
  income: number;
  expense: number;
}) {
  return (
    <div className="bg-white/5 rounded-lg p-3">
      <div className="text-xs text-white/50 mb-1">{label}</div>
      <StatRow
        label="收入预算"
        value={<CurrencyDisplay value={income} className="text-income" size="sm" />}
      />
      <StatRow
        label="支出预算"
        value={<CurrencyDisplay value={expense} className="text-expense" size="sm" />}
      />
    </div>
  );
}

function RowTransfer({
  label,
  labelClass = '',
  recommended,
  doneValue,
  remain,
  onDoneChange,
}: {
  label: string;
  labelClass?: string;
  recommended: number;
  doneValue: string;
  remain: number;
  onDoneChange: (v: string) => void;
}) {
  return (
    <>
      <div className={`${labelClass}`}>{label}</div>
      <div className="text-right tabular-nums text-white/80">
        {formatCurrency(recommended)}
      </div>
      <input
        type="number"
        value={doneValue}
        onChange={(e) => onDoneChange(e.target.value)}
        className="bg-amber-400/10 border border-amber-300/30 rounded px-2 py-1
                   text-xs tabular-nums text-amber-100 text-right outline-none w-full"
      />
      <div
        className={`text-right tabular-nums rounded px-1 py-1
                    ${remain > 0 ? 'text-orange-400 bg-orange-500/10' : 'text-white/30'}`}
      >
        {formatCurrency(remain)}
      </div>
    </>
  );
}
