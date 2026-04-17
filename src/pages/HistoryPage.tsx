import { useMemo, useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import Card from '../components/Card';
import StatRow from '../components/StatRow';
import CurrencyDisplay, { formatCurrency } from '../components/CurrencyDisplay';
import { useMonthlyStore } from '../stores/monthlyStore';
import { calcHistoryStats } from '../calculations/history';
import { investMeta } from '../data/mockData';
import type { MonthlyRecord, MajorExpense, InvestHoldings } from '../models/types';

// 2021/2022 年份只在年度视图显示，月度列表跳过
const YEARLY_ONLY_BEFORE = '2023-01';

const C = { blue: '#1a73e8', red: '#ea4335', green: '#0d9488', purple: '#7c3aed', sub: '#5f6368', orange: '#e8710a' };
type ViewTab = 'monthly' | 'yearly';

// ── 当前年月 ──────────────────────────────────────────────────────
const NOW = new Date();
function currentYearMonth() {
  return `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, '0')}`;
}
function prevYearMonth(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

// ── 本月填写表单 ───────────────────────────────────────────────────
const INVEST_KEYS = ['us', 'eu', 'asia', 'a', 'longBond', 'usBond', 'gold'] as const;

function MonthForm({ yearMonth, existing, prevRecord, onSave }: {
  yearMonth: string;
  existing?: MonthlyRecord;
  prevRecord?: MonthlyRecord;
  onSave: (r: MonthlyRecord) => void;
}) {
  const [income,        setIncome]        = useState(String(existing?.income        ?? ''));
  const [totalExpense,  setTotalExpense]   = useState(String(existing?.totalExpense  ?? ''));
  const [periodicLife,  setPeriodicLife]   = useState(String(existing?.periodicLife  ?? ''));
  const [volatileLife,  setVolatileLife]   = useState(String(existing?.volatileLife  ?? ''));
  const [consumption,   setConsumption]    = useState(String(existing?.consumption   ?? ''));
  const [school,        setSchool]         = useState(String(existing?.school        ?? ''));
  const [accProfit,     setAccProfit]      = useState(String(existing?.accumulatedProfit ?? ''));
  const [investTotal,   setInvestTotal]    = useState(String(existing?.investTotal   ?? ''));
  const [homeDays,      setHomeDays]       = useState(String(existing?.homeDays      ?? '0'));
  const [travelDays,    setTravelDays]     = useState(String(existing?.travelDays    ?? '0'));
  const [majorExpenses, setMajorExpenses]  = useState<MajorExpense[]>(existing?.majorExpenses ?? []);
  // 各品类持仓（月末）
  const [breakdown, setBreakdown] = useState<Partial<Record<keyof InvestHoldings, string>>>(
    () => Object.fromEntries(INVEST_KEYS.map((k) => [k, String(existing?.investBreakdown?.[k] ?? '')])) as Record<keyof InvestHoldings, string>
  );
  const [showBreakdown, setShowBreakdown] = useState(false);

  const n = (v: string) => parseFloat(v) || 0;

  // 自动计算
  const surplus      = n(income) - n(totalExpense);
  const investIncome = prevRecord ? n(accProfit) - (prevRecord.accumulatedProfit ?? 0) : null;
  const investAnnual = investIncome !== null && n(investTotal) > 0
    ? (investIncome / n(investTotal)) * 12 : null;

  const addMajor = () => setMajorExpenses((p) => [...p, { type: '生活', name: '', amount: 0 }]);
  const removeMajor = (i: number) => setMajorExpenses((p) => p.filter((_, idx) => idx !== i));
  const updateMajor = (i: number, patch: Partial<MajorExpense>) =>
    setMajorExpenses((p) => p.map((e, idx) => idx === i ? { ...e, ...patch } : e));

  const handleSave = () => {
    const bd = Object.fromEntries(
      INVEST_KEYS.map((k) => [k, parseFloat(breakdown[k] ?? '') || 0])
    ) as unknown as InvestHoldings;
    const hasBreakdown = INVEST_KEYS.some((k) => (bd[k] || 0) > 0);
    onSave({
      yearMonth,
      income: n(income), totalExpense: n(totalExpense),
      periodicLife: n(periodicLife), volatileLife: n(volatileLife),
      consumption: n(consumption), school: n(school),
      accumulatedProfit: n(accProfit), investTotal: n(investTotal),
      investBreakdown: hasBreakdown ? bd : undefined,
      homeDays: n(homeDays), travelDays: n(travelDays),
      majorExpenses: majorExpenses.filter((e) => e.name.trim()),
    });
  };

  const fieldStyle: React.CSSProperties = {
    width: '100%', border: '1.5px solid #fbbf24', borderRadius: 8,
    padding: '8px 10px', fontSize: 13, fontVariantNumeric: 'tabular-nums',
    outline: 'none', backgroundColor: '#fffbeb', boxSizing: 'border-box',
  };
  const labelStyle: React.CSSProperties = { fontSize: 12, color: C.sub, marginBottom: 3, fontWeight: 500 };

  return (
    <div>
      {/* 自动计算提示 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 100, backgroundColor: surplus >= 0 ? '#e6f4ea' : '#fce8e6', borderRadius: 10, padding: '10px 14px' }}>
          <div style={{ fontSize: 11, color: C.sub }}>本月结余</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: surplus >= 0 ? C.green : C.red, fontVariantNumeric: 'tabular-nums' }}>
            {surplus >= 0 ? '+' : ''}¥{formatCurrency(surplus)}
          </div>
        </div>
        {investIncome !== null && (
          <div style={{ flex: 1, minWidth: 100, backgroundColor: investIncome >= 0 ? '#e6f4ea' : '#fce8e6', borderRadius: 10, padding: '10px 14px' }}>
            <div style={{ fontSize: 11, color: C.sub }}>理财收入</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: investIncome >= 0 ? C.green : C.red, fontVariantNumeric: 'tabular-nums' }}>
              {investIncome >= 0 ? '+' : ''}¥{formatCurrency(investIncome)}
              {investAnnual !== null && <span style={{ fontSize: 11, marginLeft: 6, color: C.sub }}>年化 {(investAnnual * 100).toFixed(1)}%</span>}
            </div>
          </div>
        )}
      </div>

      {/* 主要数字 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
        {[
          { label: '总收入', val: income, set: setIncome },
          { label: '总支出', val: totalExpense, set: setTotalExpense },
          { label: '周期生活', val: periodicLife, set: setPeriodicLife },
          { label: '波动生活', val: volatileLife, set: setVolatileLife },
          { label: '消费（交行）', val: consumption, set: setConsumption },
          { label: '校园卡支出', val: school, set: setSchool },
          { label: '累计盈利', val: accProfit, set: setAccProfit },
          { label: '理财总额', val: investTotal, set: setInvestTotal },
        ].map(({ label, val, set }) => (
          <div key={label}>
            <div style={labelStyle}>{label}</div>
            <input type="number" value={val} onChange={(e) => set(e.target.value)} placeholder="0.00" style={fieldStyle} />
          </div>
        ))}
      </div>

      {/* 理财各品类持仓（可折叠） */}
      <div style={{ marginBottom: 12 }}>
        <button
          onClick={() => setShowBreakdown((v) => !v)}
          style={{ width: '100%', textAlign: 'left', fontSize: 12, color: C.sub, fontWeight: 500, padding: '6px 0', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }}
        >
          <span>📈 理财各品类持仓（月末）</span>
          <span>{showBreakdown ? '▲' : '▼'}</span>
        </button>
        {showBreakdown && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 6 }}>
            {INVEST_KEYS.map((k) => (
              <div key={k}>
                <div style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', backgroundColor: investMeta[k].color }} />
                  {investMeta[k].label}
                </div>
                <input
                  type="number" value={breakdown[k] ?? ''} placeholder="0.00"
                  onChange={(e) => setBreakdown((p) => ({ ...p, [k]: e.target.value }))}
                  style={fieldStyle}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 天数 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
        <div>
          <div style={labelStyle}>在家天数</div>
          <input type="number" value={homeDays} onChange={(e) => setHomeDays(e.target.value)} placeholder="0" style={fieldStyle} />
        </div>
        <div>
          <div style={labelStyle}>出行天数</div>
          <input type="number" value={travelDays} onChange={(e) => setTravelDays(e.target.value)} placeholder="0" style={fieldStyle} />
        </div>
      </div>

      {/* 大额支出 */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontSize: 12, color: C.sub, fontWeight: 500 }}>大额支出明细</div>
          <button onClick={addMajor} style={{ fontSize: 12, color: C.blue, border: `1px solid ${C.blue}`, borderRadius: 6, padding: '3px 10px', backgroundColor: '#fff', cursor: 'pointer' }}>+ 添加</button>
        </div>
        {majorExpenses.map((e, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '60px 1fr 90px auto', gap: 6, marginBottom: 6, alignItems: 'center' }}>
            <select
              value={e.type}
              onChange={(ev) => updateMajor(i, { type: ev.target.value as '生活' | '消费' })}
              style={{ border: '1.5px solid #dadce0', borderRadius: 6, padding: '6px 4px', fontSize: 12, outline: 'none' }}
            >
              <option value="生活">生活</option>
              <option value="消费">消费</option>
            </select>
            <input type="text" value={e.name} onChange={(ev) => updateMajor(i, { name: ev.target.value })} placeholder="项目名称" style={{ ...fieldStyle, padding: '6px 8px' }} />
            <input type="number" value={e.amount || ''} onChange={(ev) => updateMajor(i, { amount: parseFloat(ev.target.value) || 0 })} placeholder="金额" style={{ ...fieldStyle, padding: '6px 8px' }} />
            <button onClick={() => removeMajor(i)} style={{ color: C.red, border: 'none', background: 'none', fontSize: 16, cursor: 'pointer', padding: '0 4px' }}>×</button>
          </div>
        ))}
      </div>

      <button
        onClick={handleSave}
        style={{
          width: '100%', backgroundColor: C.blue, color: '#fff', fontWeight: 700,
          fontSize: 15, padding: '13px 0', borderRadius: 12, border: 'none',
          cursor: 'pointer', letterSpacing: 1,
        }}
      >
        保存本月数据
      </button>
    </div>
  );
}

// ── 月度列表行 ────────────────────────────────────────────────────
function MonthRow({ record, prev }: { record: MonthlyRecord; prev?: MonthlyRecord }) {
  const [open, setOpen] = useState(false);
  const surplus = record.income - record.totalExpense;
  const investIncome = prev && prev.accumulatedProfit
    ? record.accumulatedProfit - prev.accumulatedProfit : null;
  const investAnnual = investIncome !== null && record.investTotal > 0
    ? (investIncome / record.investTotal) * 12 : null;

  return (
    <div style={{ marginBottom: 4 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%', display: 'grid', gridTemplateColumns: '72px 1fr 1fr 1fr 1fr',
          alignItems: 'center', padding: '12px 10px', borderRadius: 10, border: 'none',
          backgroundColor: open ? '#e8f0fe' : '#fafafa', cursor: 'pointer',
          textAlign: 'left', transition: 'background-color 0.15s',
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: open ? C.blue : '#202124' }}>{record.yearMonth}</span>
        <span style={{ fontSize: 13, color: C.red, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>+{formatCurrency(record.income)}</span>
        <span style={{ fontSize: 13, color: C.green, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>-{formatCurrency(record.totalExpense)}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: surplus >= 0 ? C.green : C.red, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>
          {surplus >= 0 ? '+' : ''}{formatCurrency(surplus)}
        </span>
        <span style={{ fontSize: 11, color: C.sub, textAlign: 'right' }}>
          {record.income > 0 ? ((surplus / record.income) * 100).toFixed(0) : '0'}%
        </span>
      </button>

      {open && (
        <div style={{ margin: '2px 0 8px', border: '1.5px solid #c5d9f8', borderRadius: 10, backgroundColor: '#f8fbff', padding: '14px 16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
            <div>
              <StatRow label="收入"  value={<CurrencyDisplay value={record.income} color={C.red} />} />
              <StatRow label="总支出" value={<CurrencyDisplay value={record.totalExpense} color={C.green} />} />
              <StatRow label="结余"  value={<CurrencyDisplay value={surplus} color={surplus >= 0 ? C.green : C.red} />} />
            </div>
            <div>
              <StatRow label="周期生活" value={<CurrencyDisplay value={record.periodicLife} color={C.blue} />} />
              <StatRow label="波动生活" value={<CurrencyDisplay value={record.volatileLife} color={C.blue} />} />
              <StatRow label="消费"    value={<CurrencyDisplay value={record.consumption} color={C.purple} />} />
            </div>
          </div>
          {investIncome !== null && (
            <div style={{ borderTop: '1px solid #dbe8fb', paddingTop: 10, marginBottom: 8 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 6 }}>
                <StatRow label="理财收入" value={<CurrencyDisplay value={investIncome} color={investIncome >= 0 ? C.green : C.red} />} />
                {investAnnual !== null && <StatRow label="年化" value={<span style={{ color: investAnnual >= 0 ? C.green : C.red, fontWeight: 500 }}>{(investAnnual * 100).toFixed(1)}%</span>} />}
              </div>
              {/* 各品类持仓及收益 */}
              {record.investBreakdown && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                  {INVEST_KEYS.filter((k) => (record.investBreakdown![k] ?? 0) > 0).map((k) => {
                    const cur = record.investBreakdown![k] ?? 0;
                    const prv = prev?.investBreakdown?.[k];
                    const diff = prv !== undefined ? cur - prv : null;
                    return (
                      <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '2px 0' }}>
                        <span style={{ color: C.sub, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: investMeta[k].color, display: 'inline-block' }} />
                          {investMeta[k].label}
                        </span>
                        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {formatCurrency(cur)}
                          {diff !== null && <span style={{ marginLeft: 4, fontSize: 11, color: diff >= 0 ? C.green : C.red }}>{diff >= 0 ? '+' : ''}{formatCurrency(diff)}</span>}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          <div style={{ borderTop: '1px solid #dbe8fb', paddingTop: 10, display: 'flex', gap: 16, fontSize: 12, color: C.sub }}>
            <span>在家 {record.homeDays} 天</span>
            <span>出行 {record.travelDays} 天</span>
            {record.school > 0 && <span>校园卡 ¥{formatCurrency(record.school)}</span>}
          </div>
          {record.majorExpenses && record.majorExpenses.length > 0 && (
            <div style={{ borderTop: '1px solid #dbe8fb', paddingTop: 10, marginTop: 8 }}>
              <div style={{ fontSize: 12, color: C.sub, marginBottom: 6 }}>大额支出</div>
              {record.majorExpenses.map((e, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '3px 0' }}>
                  <span>
                    <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 4, fontSize: 11, marginRight: 6, backgroundColor: e.type === '生活' ? '#e8f0fe' : '#f3e8fd', color: e.type === '生活' ? C.blue : C.purple }}>{e.type}</span>
                    {e.name}
                  </span>
                  <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>¥{formatCurrency(e.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

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
            <Line type="monotone" dataKey="收入" stroke={C.red} strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="支出" stroke={C.green} strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="结余" stroke={C.blue} strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
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
            <Bar dataKey="消费" stackId="a" fill={C.purple} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </>
  );
}

// ── 年度视图 ──────────────────────────────────────────────────────
function YearlyView({ records }: { records: MonthlyRecord[] }) {
  const years = useMemo(() => {
    const map: Record<string, MonthlyRecord[]> = {};
    for (const r of records) {
      const y = r.yearMonth.slice(0, 4);
      if (!map[y]) map[y] = [];
      map[y].push(r);
    }
    return Object.entries(map).sort((a, b) => b[0].localeCompare(a[0]));
  }, [records]);

  return (
    <>
      {years.map(([year, recs]) => {
        const totalIncome  = recs.reduce((s, r) => s + r.income, 0);
        const totalExpense = recs.reduce((s, r) => s + r.totalExpense, 0);
        const surplus = totalIncome - totalExpense;
        const n = recs.length;
        return (
          <Card key={year} title={`${year} 年`} subtitle={`${n} 个月数据`}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <StatRow label="总收入"  value={<CurrencyDisplay value={totalIncome} color={C.red} />} />
              <StatRow label="总支出"  value={<CurrencyDisplay value={totalExpense} color={C.green} />} />
              <StatRow label="总结余"  value={<CurrencyDisplay value={surplus} color={surplus >= 0 ? C.green : C.red} />} />
              <StatRow label="储蓄率"  value={<span style={{ color: surplus >= 0 ? C.green : C.red, fontWeight: 500 }}>{totalIncome > 0 ? ((surplus / totalIncome) * 100).toFixed(1) : '0'}%</span>} />
              <StatRow label="月均收入" value={<CurrencyDisplay value={totalIncome / n} color={C.red} />} />
              <StatRow label="月均支出" value={<CurrencyDisplay value={totalExpense / n} color={C.green} />} />
            </div>
          </Card>
        );
      })}
    </>
  );
}

// ── 主组件 ────────────────────────────────────────────────────────
export default function HistoryPage() {
  const { records, upsert } = useMonthlyStore();
  const [tab, setTab] = useState<ViewTab>('monthly');
  const [formOpen, setFormOpen] = useState(false);
  const stats = useMemo(() => calcHistoryStats(records), [records]);

  const thisMonth = currentYearMonth();
  const existingThisMonth = records.find((r) => r.yearMonth === thisMonth);
  const prevMonthRecord   = records.find((r) => r.yearMonth === prevYearMonth(thisMonth));

  const handleSaveMonth = (r: MonthlyRecord) => {
    upsert(r);
    setFormOpen(false);
  };

  const tableHeader = (
    <div style={{ display: 'grid', gridTemplateColumns: '72px 1fr 1fr 1fr 1fr', padding: '6px 10px', fontSize: 11, color: C.sub, fontWeight: 500, marginBottom: 4 }}>
      <span>月份</span>
      <span style={{ textAlign: 'right' }}>收入</span>
      <span style={{ textAlign: 'right' }}>支出</span>
      <span style={{ textAlign: 'right' }}>结余</span>
      <span style={{ textAlign: 'right' }}>储蓄率</span>
    </div>
  );

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 14px' }}>历史记录</h1>

      {/* Tabs */}
      <div style={{ display: 'flex', backgroundColor: '#e8eaed', borderRadius: 24, padding: 3, marginBottom: 16 }}>
        {(['monthly', 'yearly'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1, padding: '9px 0', borderRadius: 22, border: 'none', fontSize: 14,
            fontWeight: tab === t ? 600 : 400,
            backgroundColor: tab === t ? '#fff' : 'transparent',
            color: tab === t ? '#202124' : C.sub,
            cursor: 'pointer', transition: 'all 0.2s',
            boxShadow: tab === t ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
          }}>
            {t === 'monthly' ? '月度' : '年度'}
          </button>
        ))}
      </div>

      {tab === 'monthly' && (
        <>
          {/* 本月填写入口 */}
          <Card
            title={`${thisMonth} 本月`}
            subtitle={existingThisMonth ? '已有数据，点击修改' : '尚未填写，点击录入'}
          >
            {!formOpen ? (
              <button
                onClick={() => setFormOpen(true)}
                style={{
                  width: '100%', padding: '11px 0', borderRadius: 10, border: `1.5px dashed ${C.blue}`,
                  backgroundColor: '#f0f4ff', color: C.blue, fontWeight: 600, fontSize: 14, cursor: 'pointer',
                }}
              >
                {existingThisMonth ? '✏️ 修改本月数据' : '＋ 录入本月数据'}
              </button>
            ) : (
              <>
                <MonthForm
                  yearMonth={thisMonth}
                  existing={existingThisMonth}
                  prevRecord={prevMonthRecord}
                  onSave={handleSaveMonth}
                />
                <button
                  onClick={() => setFormOpen(false)}
                  style={{ width: '100%', marginTop: 8, padding: '10px 0', borderRadius: 10, border: '1px solid #dadce0', backgroundColor: '#fff', color: C.sub, fontSize: 13, cursor: 'pointer' }}
                >
                  取消
                </button>
              </>
            )}
          </Card>

          {/* 均值概览 */}
          <Card title="历史均值" subtitle={`共 ${records.length} 个月`}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              <StatRow label="月均收入" value={<CurrencyDisplay value={stats.monthlyIncomeAvg} color={C.red} />} />
              <StatRow label="月均支出" value={<CurrencyDisplay value={stats.totalExpenseAvg} color={C.green} />} />
              <StatRow label="储蓄率" value={<span style={{ color: stats.savingsRate >= 0 ? C.green : C.red, fontWeight: 500 }}>{(stats.savingsRate * 100).toFixed(1)}%</span>} />
              <StatRow label="在校日均" value={<span style={{ fontWeight: 500 }}>¥{formatCurrency(stats.schoolDailyAvg)}</span>} />
            </div>
          </Card>

          {/* 趋势图 */}
          <TrendCharts records={records} />

          {/* 月度列表（2021/2022 仅年度视图显示） */}
          <Card title="月度明细" subtitle="2023年起逐月，更早年份见年度视图">
            {tableHeader}
            {records
              .filter((r) => r.yearMonth >= YEARLY_ONLY_BEFORE)
              .map((r, i, arr) => (
                <MonthRow key={r.yearMonth} record={r} prev={arr[i + 1] ?? records.find((x) => x.yearMonth < r.yearMonth)} />
              ))}
          </Card>
        </>
      )}

      {tab === 'yearly' && <YearlyView records={records} />}
    </div>
  );
}
