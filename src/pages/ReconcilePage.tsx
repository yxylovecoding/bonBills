import { useState } from 'react';
import Card from '../components/Card';
import CurrencyDisplay, { formatCurrency } from '../components/CurrencyDisplay';

const C = { blue: '#1a73e8', red: '#ea4335', green: '#0d9488', sub: '#5f6368', orange: '#e8710a' };

function InputField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label style={{ display: 'block', marginBottom: 14 }}>
      <div style={{ fontSize: 12, color: C.sub, marginBottom: 4, fontWeight: 500 }}>{label}</div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          border: '1.5px solid #dadce0',
          borderRadius: 10,
          padding: '10px 12px',
          backgroundColor: '#fff',
          transition: 'border-color 0.2s',
        }}
        onFocus={(e) => (e.currentTarget.style.borderColor = C.blue)}
        onBlur={(e) => (e.currentTarget.style.borderColor = '#dadce0')}
      >
        <span style={{ color: C.sub, fontSize: 14, marginRight: 4 }}>¥</span>
        <input
          type="number"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0.00"
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            fontSize: 14,
            fontVariantNumeric: 'tabular-nums',
            backgroundColor: 'transparent',
          }}
        />
      </div>
    </label>
  );
}

const mockBudget = {
  daysLeft: 19, schoolDaysLeft: 15, homeDaysLeft: 2,
  weekly: { income: 350.0, expense: 820.5 },
  monthly: { income: 2180.0, expense: 2546.05 },
  beyond: { income: 3081.35, expense: 3200.0 },
  recommended: { campusCard: 450.0, living: 820.5, consumption: 1200.0, wishJar: 200.0, invest: 1800.0 },
};

const TRANSFER_ROWS: { key: keyof typeof mockBudget.recommended; label: string }[] = [
  { key: 'campusCard', label: '🎓 校园卡' },
  { key: 'living', label: '🏦 生活' },
  { key: 'consumption', label: '💼 消费' },
  { key: 'wishJar', label: '🏺 心愿罐' },
  { key: 'invest', label: '📈 理财' },
];

export default function ReconcilePage() {
  const [credit, setCredit] = useState('2005.72');
  const [campusCard, setCampusCard] = useState('180.50');
  const [livingBank, setLivingBank] = useState('1246.30');
  const [consumptionBank, setConsumptionBank] = useState('892.15');

  const [done, setDone] = useState<Record<string, string>>({
    campusCard: '200', living: '500', consumption: '800', wishJar: '0', invest: '0',
  });

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 4px' }}>对账 / 转账</h1>
      <p style={{ fontSize: 13, color: C.sub, margin: '0 0 16px' }}>
        今天 2026-04-11，对账模式：<span style={{ color: C.blue, fontWeight: 600 }}>常规（11 号）</span>
      </p>

      {/* Step 1 */}
      <Card title="① 账户余额" subtitle="录入各账户当前余额">
        <InputField label="信用卡待还额" value={credit} onChange={setCredit} />
        <InputField label="校园卡" value={campusCard} onChange={setCampusCard} />
        <InputField label="生活银行卡" value={livingBank} onChange={setLivingBank} />
        <InputField label="消费 (交行)" value={consumptionBank} onChange={setConsumptionBank} />
      </Card>

      {/* Step 2 */}
      <Card title="② 预算计算" subtitle="系统计算">
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.sub, marginBottom: 12 }}>
          <span>本月剩余 {mockBudget.daysLeft} 天</span>
          <span>在校 {mockBudget.schoolDaysLeft} · 回家 {mockBudget.homeDaysLeft}</span>
        </div>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e8eaed' }}>
              <th style={thStyle}>层级</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>收入预算</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>支出预算</th>
            </tr>
          </thead>
          <tbody>
            {[
              { name: '周内 (7-10天)', inc: mockBudget.weekly.income, exp: mockBudget.weekly.expense },
              { name: '月内 (本月余)', inc: mockBudget.monthly.income, exp: mockBudget.monthly.expense },
              { name: '月外 (跨月)', inc: mockBudget.beyond.income, exp: mockBudget.beyond.expense },
            ].map((row, i) => (
              <tr key={row.name} style={{ backgroundColor: i % 2 === 0 ? '#fafafa' : '#fff', borderBottom: '1px solid #f1f3f4' }}>
                <td style={{ padding: '10px 0', color: '#202124', fontWeight: 500 }}>{row.name}</td>
                <td style={{ padding: '10px 0', textAlign: 'right', color: C.red, fontVariantNumeric: 'tabular-nums' }}>¥{formatCurrency(row.inc)}</td>
                <td style={{ padding: '10px 0', textAlign: 'right', color: C.green, fontVariantNumeric: 'tabular-nums' }}>¥{formatCurrency(row.exp)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Step 3 */}
      <Card title="③ 建议转账" subtitle="橙色为待执行">
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e8eaed' }}>
              <th style={thStyle}>目的账户</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>应转</th>
              <th style={{ ...thStyle, textAlign: 'center', width: 80 }}>已转</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>还需转</th>
            </tr>
          </thead>
          <tbody>
            {TRANSFER_ROWS.map((row, i) => {
              const rec = mockBudget.recommended[row.key];
              const doneVal = parseFloat(done[row.key] || '0') || 0;
              const remain = Math.max(rec - doneVal, 0);
              return (
                <tr key={row.key} style={{ backgroundColor: i % 2 === 0 ? '#fafafa' : '#fff', borderBottom: '1px solid #f1f3f4' }}>
                  <td style={{ padding: '10px 0', fontWeight: 500 }}>{row.label}</td>
                  <td style={{ padding: '10px 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>¥{formatCurrency(rec)}</td>
                  <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                    <input
                      type="number"
                      value={done[row.key]}
                      onChange={(e) => setDone((p) => ({ ...p, [row.key]: e.target.value }))}
                      style={{
                        width: '100%',
                        border: '1.5px solid #dadce0',
                        borderRadius: 8,
                        padding: '6px 8px',
                        fontSize: 13,
                        textAlign: 'right',
                        fontVariantNumeric: 'tabular-nums',
                        outline: 'none',
                        backgroundColor: '#fff',
                      }}
                    />
                  </td>
                  <td style={{
                    padding: '10px 0',
                    textAlign: 'right',
                    fontWeight: 600,
                    fontVariantNumeric: 'tabular-nums',
                    color: remain > 0 ? C.orange : C.sub,
                    backgroundColor: remain > 0 ? '#fef7e0' : 'transparent',
                    borderRadius: remain > 0 ? 6 : 0,
                  }}>
                    ¥{formatCurrency(remain)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {/* Step 4 */}
      <Card title="④ 信用卡提醒">
        <div style={{ backgroundColor: '#fef7e0', border: '1px solid #fdd663', borderRadius: 12, padding: '12px 16px', fontSize: 14, color: '#b06000' }}>
          ⚠️ 26 号出账，请确认消费
          <div style={{ fontSize: 12, color: '#b06000', marginTop: 4, opacity: 0.8 }}>
            建议提前 5 天准备还款资金 (约 <CurrencyDisplay value={2005.72} size="sm" />)
          </div>
        </div>
      </Card>

      <button
        onClick={() => alert('MVP：保存逻辑等接入 store 后实现')}
        style={{
          width: '100%',
          backgroundColor: C.blue,
          color: '#fff',
          fontWeight: 600,
          fontSize: 15,
          padding: '14px 0',
          borderRadius: 12,
          border: 'none',
          cursor: 'pointer',
          marginTop: 8,
          marginBottom: 16,
          boxShadow: '0 1px 3px rgba(26,115,232,0.3)',
        }}
      >
        保存本次对账
      </button>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 0',
  fontSize: 12,
  color: '#5f6368',
  fontWeight: 500,
};
