import { useMemo, useState } from 'react';
import Card from '../components/Card';
import StatRow from '../components/StatRow';
import CurrencyDisplay, { formatCurrency } from '../components/CurrencyDisplay';
import { monthlyRecords } from '../data/mockData';
import type { MonthlyRecord } from '../models/types';

const C = { blue: '#1a73e8', red: '#ea4335', green: '#0d9488', purple: '#7c3aed', sub: '#5f6368' };

type ViewTab = 'monthly' | 'yearly';

export default function HistoryPage() {
  const [tab, setTab] = useState<ViewTab>('monthly');

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 14px' }}>历史记录</h1>

      {/* Tabs - Google 风格 pill */}
      <div style={{ display: 'flex', backgroundColor: '#e8eaed', borderRadius: 24, padding: 3, marginBottom: 16 }}>
        {(['monthly', 'yearly'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1,
              padding: '9px 0',
              borderRadius: 22,
              border: 'none',
              fontSize: 14,
              fontWeight: tab === t ? 600 : 400,
              backgroundColor: tab === t ? '#ffffff' : 'transparent',
              color: tab === t ? C.blue : C.sub,
              cursor: 'pointer',
              boxShadow: tab === t ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              transition: 'all 0.2s',
            }}
          >
            {t === 'monthly' ? '月度' : '年度'}
          </button>
        ))}
      </div>

      {tab === 'monthly' ? <MonthlyView /> : <YearlyView />}
    </div>
  );
}

function MonthlyView() {
  const [expanded, setExpanded] = useState<string | null>(null);
  const sorted = useMemo(
    () => [...monthlyRecords].sort((a, b) => (a.yearMonth < b.yearMonth ? 1 : -1)),
    [],
  );

  return (
    <>
      <Card title="月度列表" subtitle={`共 ${sorted.length} 个月`}>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e8eaed' }}>
              <th style={thStyle}>月份</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>收入</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>支出</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>结余</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>储蓄率</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => {
              const surplus = r.income - r.totalExpense;
              const rate = r.income > 0 ? surplus / r.income : 0;
              const isExpanded = expanded === r.yearMonth;
              return (
                <MonthRow
                  key={r.yearMonth}
                  record={r}
                  surplus={surplus}
                  rate={rate}
                  index={i}
                  expanded={isExpanded}
                  onToggle={() => setExpanded(isExpanded ? null : r.yearMonth)}
                />
              );
            })}
          </tbody>
        </table>
      </Card>

      {/* 趋势图占位 */}
      <Card title="月度趋势" subtitle="即将接入 Recharts">
        <div style={{ height: 140, backgroundColor: '#f8f9fa', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: '#9aa0a6', border: '1px dashed #dadce0' }}>
          📈 收入 vs 支出 vs 结余 趋势图
        </div>
        <div style={{ height: 110, backgroundColor: '#f8f9fa', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: '#9aa0a6', marginTop: 8, border: '1px dashed #dadce0' }}>
          📊 周期生活 / 波动生活 / 消费 堆叠图
        </div>
      </Card>
    </>
  );
}

function MonthRow({
  record: r,
  surplus,
  rate,
  index,
  expanded,
  onToggle,
}: {
  record: MonthlyRecord;
  surplus: number;
  rate: number;
  index: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        style={{
          backgroundColor: index % 2 === 0 ? '#fafafa' : '#fff',
          borderBottom: '1px solid #f1f3f4',
          cursor: 'pointer',
          transition: 'background-color 0.15s',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#e8f0fe')}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = index % 2 === 0 ? '#fafafa' : '#fff')}
      >
        <td style={{ padding: '10px 0', fontWeight: 600 }}>
          {expanded ? '▾' : '▸'} {r.yearMonth}
        </td>
        <td style={{ padding: '10px 0', textAlign: 'right', color: C.red, fontVariantNumeric: 'tabular-nums' }}>
          {formatCurrency(r.income)}
        </td>
        <td style={{ padding: '10px 0', textAlign: 'right', color: C.green, fontVariantNumeric: 'tabular-nums' }}>
          {formatCurrency(r.totalExpense)}
        </td>
        <td style={{ padding: '10px 0', textAlign: 'right', fontWeight: 600, color: surplus >= 0 ? C.green : C.red, fontVariantNumeric: 'tabular-nums' }}>
          {surplus >= 0 ? '+' : ''}{formatCurrency(surplus)}
        </td>
        <td style={{ padding: '10px 0', textAlign: 'right', color: rate >= 0 ? C.green : C.red, fontVariantNumeric: 'tabular-nums' }}>
          {(rate * 100).toFixed(1)}%
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={5} style={{ padding: 0 }}>
            <div style={{ backgroundColor: '#f8f9fa', borderRadius: 10, margin: '4px 0 8px', padding: 14 }}>
              <StatRow label="周期生活" value={<CurrencyDisplay value={r.periodicLife} color={C.blue} size="sm" />} />
              <StatRow label="波动生活" value={<CurrencyDisplay value={r.volatileLife} color={C.blue} size="sm" />} />
              <StatRow label="消费" value={<CurrencyDisplay value={r.consumption} color={C.purple} size="sm" />} />
              <StatRow label="校园卡" value={<CurrencyDisplay value={r.school} size="sm" />} />
              <div style={{ height: 1, backgroundColor: '#e8eaed', margin: '8px 0' }} />
              <StatRow label="在家" value={`${r.homeDays} 天`} />
              <StatRow label="出差/旅游" value={`${r.travelDays} 天`} />
              {r.investTotal !== undefined && (
                <StatRow label="月末理财" value={<CurrencyDisplay value={r.investTotal} size="sm" />} />
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function YearlyView() {
  const byYear = useMemo(() => {
    const map: Record<string, MonthlyRecord[]> = {};
    for (const r of monthlyRecords) {
      const y = r.yearMonth.slice(0, 4);
      (map[y] ||= []).push(r);
    }
    return Object.entries(map).sort(([a], [b]) => (a < b ? 1 : -1));
  }, []);

  return (
    <>
      {byYear.map(([year, records]) => {
        const income = records.reduce((s, r) => s + r.income, 0);
        const expense = records.reduce((s, r) => s + r.totalExpense, 0);
        const surplus = income - expense;
        const rate = income > 0 ? surplus / income : 0;
        return (
          <Card key={year} title={`${year} 年`} subtitle={`${records.length} 个月`}>
            <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
              <tbody>
                <tr style={{ borderBottom: '1px solid #f1f3f4' }}>
                  <td style={{ padding: '8px 0', color: C.sub }}>总收入</td>
                  <td style={{ padding: '8px 0', textAlign: 'right', fontWeight: 600, color: C.red, fontVariantNumeric: 'tabular-nums' }}>¥{formatCurrency(income)}</td>
                </tr>
                <tr style={{ borderBottom: '1px solid #f1f3f4' }}>
                  <td style={{ padding: '8px 0', color: C.sub }}>总支出</td>
                  <td style={{ padding: '8px 0', textAlign: 'right', fontWeight: 600, color: C.green, fontVariantNumeric: 'tabular-nums' }}>¥{formatCurrency(expense)}</td>
                </tr>
                <tr style={{ borderBottom: '1px solid #f1f3f4' }}>
                  <td style={{ padding: '8px 0', color: C.sub }}>总结余</td>
                  <td style={{ padding: '8px 0', textAlign: 'right', fontWeight: 600, color: surplus >= 0 ? C.green : C.red, fontVariantNumeric: 'tabular-nums' }}>
                    {surplus >= 0 ? '+' : ''}¥{formatCurrency(surplus)}
                  </td>
                </tr>
                <tr style={{ borderBottom: '1px solid #f1f3f4' }}>
                  <td style={{ padding: '8px 0', color: C.sub }}>储蓄率</td>
                  <td style={{ padding: '8px 0', textAlign: 'right', fontWeight: 600, color: rate >= 0 ? C.green : C.red }}>
                    {(rate * 100).toFixed(1)}%
                  </td>
                </tr>
                <tr style={{ borderBottom: '1px solid #f1f3f4', backgroundColor: '#fafafa' }}>
                  <td style={{ padding: '8px 0', color: C.sub }}>月均收入</td>
                  <td style={{ padding: '8px 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>¥{formatCurrency(income / records.length)}</td>
                </tr>
                <tr style={{ backgroundColor: '#fafafa' }}>
                  <td style={{ padding: '8px 0', color: C.sub }}>月均支出</td>
                  <td style={{ padding: '8px 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>¥{formatCurrency(expense / records.length)}</td>
                </tr>
              </tbody>
            </table>
          </Card>
        );
      })}

      <Card title="支出分类" subtitle="记账数据接入后填充">
        <div style={{ height: 140, backgroundColor: '#f8f9fa', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: '#9aa0a6', border: '1px dashed #dadce0' }}>
          🥧 饮食 / 生活 / 购物 / 娱乐 / 交通 / 课学 / 人际 / 医疗
        </div>
      </Card>
    </>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 0',
  fontSize: 12,
  color: '#5f6368',
  fontWeight: 500,
};
