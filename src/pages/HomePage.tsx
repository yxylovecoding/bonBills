import { useMemo, useState } from 'react';
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
import { calcHistoryStats } from '../calculations/history';
import { calcFire } from '../calculations/fire';
import { tagMeta } from '../data/mockData';
import type { IncomeItem, TagKind, MonthlyRecord } from '../models/types';
import { useHolidayYears } from '../utils/holidays';
import { dateLabel, daysUntilDate, resolveIncomeForMonth } from '../utils/payroll';

import { version as APP_VERSION } from '../../package.json';
const C = { blue: '#1a73e8', red: '#ea4335', green: '#0d9488', purple: '#7c3aed', sub: '#5f6368', orange: '#e8710a' };

function fmt万(v: number) { return (v / 10000).toFixed(2) + '万'; }
function Divider() { return <div style={{ height: 1, backgroundColor: '#f1f3f4', margin: '8px 0' }} />; }

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
  const { current } = useSnapshotStore();
  const { config, setConfig } = useConfigStore();
  const { records } = useMonthlyStore();
  const { tagMap } = useCalendarStore();

  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth();
  const { holidayDataByYear, holidayWarning } = useHolidayYears([currentYear - 1, currentYear]);

  const twoYearsAgo = `${today.getFullYear() - 1}-01`;
  const stats = useMemo(() => calcHistoryStats(records.filter((r) => r.yearMonth >= twoYearsAgo)), [records]);

  // 近一年校园卡日均
  const oneYearAgo = `${today.getFullYear() - 1}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const campusDailyAvgYear = useMemo(() => {
    const recent = records.filter((r) => r.yearMonth >= oneYearAgo && (r.schoolDays ?? 0) > 0 && r.school > 0);
    if (recent.length === 0) return 0;
    return recent.reduce((s, r) => s + r.school / (r.schoolDays ?? 1), 0) / recent.length;
  }, [records, oneYearAgo]);

  const totalInvest = Object.values(current.investHoldings).reduce((s, v) => s + v, 0);

  // FIRE 模式切换
  const [fireMode, setFireMode] = useState<'life' | 'all'>('all');
  const fireExpenseAvg = fireMode === 'life'
    ? stats.periodicLifeAvg + stats.volatileLifeAvg
    : stats.totalExpenseAvg;
  const fireStats = useMemo(() => ({ ...stats, totalExpenseAvg: fireExpenseAvg }), [stats, fireExpenseAvg]);
  const fire = useMemo(() => calcFire(config, fireStats, totalInvest), [config, fireStats, totalInvest]);

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
      return item;
    });
    syncIncome(items);
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

  return (
    <div>
      {/* 页头：标题 + 人生时钟 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', margin: '0 0 16px' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 2px' }}>盘账助手</h1>
          <p style={{ fontSize: 13, color: C.sub, margin: 0 }}>
            {today.getFullYear()}年{today.getMonth() + 1}月 · 第 {today.getDate()} 天
          </p>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 30, fontWeight: 700, fontFamily: 'monospace', color: '#202124', letterSpacing: 1 }}>
            {fire.lifeClockStr}
          </div>
          <div style={{ fontSize: 11, color: C.sub }}>{fire.lifeClockPeriod}</div>
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
            <div style={{ fontSize: 12, color: C.sub, marginBottom: 4 }}>场景日均</div>
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <tbody>
                {sceneDailyRows.map((r) => {
                  const m = tagMeta[r.tagKind];
                  return (
                    <tr key={r.tagKind}>
                      <td style={{ padding: '5px 0', color: C.sub }}>{m.icon} {m.label}</td>
                      <td style={{ padding: '5px 0', textAlign: 'right', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>¥{formatCurrency(r.val)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
        {campusDailyAvgYear > 0 && (
          <>
            <Divider />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
              <span style={{ color: C.sub }}>🍜 校园卡日均 <span style={{ fontSize: 11 }}>(近一年)</span></span>
              <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: C.blue }}>¥{formatCurrency(campusDailyAvgYear)}</span>
            </div>
          </>
        )}
      </Card>

      {/* 收支趋势 + 支出构成 */}
      <TrendCharts records={records} />

      {/* FIRE 提前退休 */}
      <Card title="FIRE 提前退休" subtitle="4% 法则">
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <div style={{ display: 'flex', backgroundColor: '#e8eaed', borderRadius: 20, padding: 3, gap: 2 }}>
            {(['life', 'all'] as const).map((mode) => {
              const active = fireMode === mode;
              return (
                <button key={mode} onClick={() => setFireMode(mode)} style={{ padding: '4px 14px', borderRadius: 16, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, backgroundColor: active ? '#fff' : 'transparent', color: active ? C.blue : C.sub, boxShadow: active ? '0 1px 3px rgba(0,0,0,0.15)' : 'none', transition: 'all 0.15s' }}>
                  {mode === 'life' ? '活' : '生活'}
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.sub, marginBottom: 6 }}>
            <span>进度</span>
            <span style={{ fontWeight: 600, color: C.blue }}>{(fire.progress * 100).toFixed(2)}%</span>
          </div>
          <div style={{ height: 10, backgroundColor: '#e8eaed', borderRadius: 5, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.min(fire.progress * 100, 100)}%`, backgroundColor: C.blue, borderRadius: 5, transition: 'width 0.3s' }} />
          </div>
        </div>
        <StatRow label="目标资产"  value={<span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>{fmt万(fire.fireTarget)}</span>} />
        <StatRow label="理财总额"  value={<span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500, color: C.blue }}>{fmt万(totalInvest)}</span>} />
        <StatRow label="月需存入"  value={<span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500, color: C.orange }}>{fmt万(fire.monthlyNeeded)}</span>} />
        <StatRow label="当前月结余" value={<span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500, color: fire.monthlySurplus >= 0 ? C.green : C.red }}>{fmt万(fire.monthlySurplus)}</span>} />
      </Card>

      {/* 收入管理 */}
      <Card title="收入管理" subtitle="支持固定月收入和按天计薪两种模式">
        {holidayWarning && (
          <div style={{ marginBottom: 10, fontSize: 12, color: C.orange, backgroundColor: '#fff4e8', border: '1px solid #fed7aa', borderRadius: 10, padding: '8px 10px' }}>
            {holidayWarning}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {resolvedIncomeItems.map((item) => {
            const isDailyMode = item.dailyRate !== undefined;
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
                      <span style={{ fontSize: 13, fontWeight: 700, color: C.green, fontVariantNumeric: 'tabular-nums' }}>= ¥{formatCurrency(item.resolvedAmount)}</span>
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
