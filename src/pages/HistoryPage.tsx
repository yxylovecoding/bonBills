import { useMemo, useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import Card from '../components/Card';
import StatRow from '../components/StatRow';
import CurrencyDisplay, { formatCurrency } from '../components/CurrencyDisplay';
import AmountInput from '../components/AmountInput';
import { useMonthlyStore } from '../stores/monthlyStore';
import { useCalendarStore } from '../stores/calendarStore';
import { useBillDetailStore } from '../stores/billDetailStore';
import { useLifePeriodOverrideStore } from '../stores/lifePeriodOverrideStore';
import { calcHistoryStats } from '../calculations/history';
import { investMeta, tagMeta } from '../data/mockData';
import type { MonthlyRecord, MajorExpense, InvestHoldings, TagKind } from '../models/types';

function Divider() {
  return <div style={{ height: 1, backgroundColor: '#f1f3f4', margin: '8px 0' }} />;
}

// 2021/2022 年份只在年度视图显示，月度列表跳过
const YEARLY_ONLY_BEFORE = '2023-01';

const C = { blue: '#1a73e8', red: '#ea4335', green: '#0d9488', purple: '#7c3aed', sub: '#5f6368', orange: '#e8710a' };

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

function MonthForm({ yearMonth, existing, prevRecord, tagCounts, onSave }: {
  yearMonth: string;
  existing?: MonthlyRecord;
  prevRecord?: MonthlyRecord;
  tagCounts: Record<TagKind, number>;
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
  // 天数从日历 tag 自动推算（若日历已标记则优先用日历；否则用已存记录）
  const homeDays   = tagCounts.home   > 0 ? tagCounts.home   : (existing?.homeDays   ?? 0);
  const travelDays = tagCounts.travel > 0 ? tagCounts.travel : (existing?.travelDays ?? 0);
  const schoolDays = tagCounts.school > 0 ? tagCounts.school : (existing?.schoolDays ?? 0);
  const internDays = tagCounts.intern > 0 ? tagCounts.intern : (existing?.internDays ?? 0);
  const [majorExpenses, setMajorExpenses]  = useState<MajorExpense[]>(existing?.majorExpenses ?? []);
  const [majorExpensesNote, setMajorExpensesNote] = useState<string>(existing?.majorExpensesNote ?? '');
  // 各品类持仓（月末）
  const [breakdown, setBreakdown] = useState<Partial<Record<keyof InvestHoldings, string>>>(
    () => Object.fromEntries(INVEST_KEYS.map((k) => [k, String(existing?.investBreakdown?.[k] ?? '')])) as Record<keyof InvestHoldings, string>
  );
  // 各品类累计收益（月末）
  const [breakdownProfit, setBreakdownProfit] = useState<Partial<Record<keyof InvestHoldings, string>>>(
    () => Object.fromEntries(INVEST_KEYS.map((k) => [k, String(existing?.investBreakdownProfit?.[k] ?? '')])) as Record<keyof InvestHoldings, string>
  );
  const [showBreakdown, setShowBreakdown] = useState(false);

  const n = (v: string) => parseFloat(v) || 0;
  const nOrNull = (v: string | undefined) => {
    if (v === undefined || v.trim() === '') return null;
    const parsed = parseFloat(v);
    return Number.isFinite(parsed) ? parsed : null;
  };

  // 自动计算
  const surplus      = n(income) - n(totalExpense);
  const investIncome = prevRecord ? n(accProfit) - (prevRecord.accumulatedProfit ?? 0) : null;
  const investAnnual = investIncome !== null && n(investTotal) > 0
    ? (investIncome / n(investTotal)) * 12 : null;
  const getBreakdownMonthlyProfit = (k: keyof InvestHoldings) => {
    const profit = nOrNull(breakdownProfit[k]);
    const prevProfit = prevRecord?.investBreakdownProfit?.[k];
    return profit !== null && prevProfit !== undefined && prevProfit !== null ? profit - prevProfit : null;
  };

  const addMajor = () => setMajorExpenses((p) => [...p, { type: '生活', name: '', amount: 0 }]);
  const removeMajor = (i: number) => setMajorExpenses((p) => p.filter((_, idx) => idx !== i));
  const updateMajor = (i: number, patch: Partial<MajorExpense>) =>
    setMajorExpenses((p) => p.map((e, idx) => idx === i ? { ...e, ...patch } : e));

  const handleSave = () => {
    const bd = Object.fromEntries(
      INVEST_KEYS.map((k) => [k, parseFloat(breakdown[k] ?? '') || 0])
    ) as unknown as InvestHoldings;
    const hasBreakdown = INVEST_KEYS.some((k) => (bd[k] || 0) > 0);
    const bp = Object.fromEntries(
      INVEST_KEYS.map((k) => [k, parseFloat(breakdownProfit[k] ?? '') || 0])
    ) as unknown as InvestHoldings;
    const hasBreakdownProfit = INVEST_KEYS.some((k) => (bp[k] || 0) !== 0);
    onSave({
      yearMonth,
      income: n(income), totalExpense: n(totalExpense),
      periodicLife: n(periodicLife), volatileLife: n(volatileLife),
      consumption: n(consumption), school: n(school),
      accumulatedProfit: n(accProfit), investTotal: n(investTotal),
      investBreakdown: hasBreakdown ? bd : undefined,
      investBreakdownProfit: hasBreakdownProfit ? bp : undefined,
      homeDays, travelDays, schoolDays, internDays,
      majorExpenses: majorExpenses.filter((e) => e.name.trim()),
      majorExpensesNote: majorExpensesNote.trim() || undefined,
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
        <div style={{ flex: 1, minWidth: 100, backgroundColor: surplus >= 0 ? '#fce8e6' : '#e6f4ea', borderRadius: 10, padding: '10px 14px' }}>
          <div style={{ fontSize: 11, color: C.sub }}>本月结余</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: surplus >= 0 ? C.red : C.green, fontVariantNumeric: 'tabular-nums' }}>
            {surplus >= 0 ? '+' : '-'}¥{formatCurrency(surplus)}
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
            <AmountInput value={val} onChange={set} placeholder="0.00" style={fieldStyle} />
          </div>
        ))}
      </div>

      {/* 理财各品类持仓 & 累计收益（可折叠） */}
      <div style={{ marginBottom: 12 }}>
        <button
          onClick={() => setShowBreakdown((v) => !v)}
          style={{ width: '100%', textAlign: 'left', fontSize: 12, color: C.sub, fontWeight: 500, padding: '6px 0', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }}
        >
          <span>📈 理财各品类持仓 & 累计收益（月末）</span>
          <span>{showBreakdown ? '▲' : '▼'}</span>
        </button>
        {showBreakdown && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 6, tableLayout: 'fixed' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e8eaed' }}>
                <th style={{ textAlign: 'left', padding: '4px 0', color: C.sub, fontWeight: 500, width: '25%' }}>品类</th>
                <th style={{ textAlign: 'right', padding: '4px 0', color: C.sub, fontWeight: 500, width: '25%' }}>持仓金额</th>
                <th style={{ textAlign: 'right', padding: '4px 0', color: C.sub, fontWeight: 500, width: '25%' }}>累计收益</th>
                <th style={{ textAlign: 'right', padding: '4px 0', color: C.sub, fontWeight: 500, width: '25%' }}>本月收益</th>
              </tr>
            </thead>
            <tbody>
              {INVEST_KEYS.map((k) => {
                const monthlyProfit = getBreakdownMonthlyProfit(k);
                return (
                  <tr key={k} style={{ borderBottom: '1px solid #f1f3f4' }}>
                    <td style={{ padding: '5px 0', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', backgroundColor: investMeta[k].color, flexShrink: 0 }} />
                      {investMeta[k].label}
                    </td>
                    <td style={{ padding: '4px 0', textAlign: 'right' }}>
                      <AmountInput
                        value={breakdown[k] ?? ''} placeholder="0"
                        onChange={(v) => setBreakdown((p) => ({ ...p, [k]: v }))}
                        style={{ width: '90%', border: 'none', borderBottom: '1px solid #fbbf24', outline: 'none', backgroundColor: 'transparent', fontSize: 12, fontVariantNumeric: 'tabular-nums', textAlign: 'right', padding: '2px 0' }}
                      />
                    </td>
                    <td style={{ padding: '4px 0', textAlign: 'right' }}>
                      <AmountInput
                        value={breakdownProfit[k] ?? ''} placeholder="0"
                        onChange={(v) => setBreakdownProfit((p) => ({ ...p, [k]: v }))}
                        style={{ width: '90%', border: 'none', borderBottom: `1px solid ${C.blue}`, outline: 'none', backgroundColor: 'transparent', fontSize: 12, fontVariantNumeric: 'tabular-nums', textAlign: 'right', padding: '2px 0', color: C.blue }}
                      />
                    </td>
                    <td style={{ padding: '4px 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: monthlyProfit !== null ? (monthlyProfit >= 0 ? C.red : C.green) : C.sub }}>
                      {monthlyProfit !== null ? `${monthlyProfit >= 0 ? '+' : ''}${Math.round(monthlyProfit)}` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* 天数（来自日历标签） */}
      <div style={{ backgroundColor: '#f8f9fa', borderRadius: 8, padding: '10px 12px', marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: C.sub, fontWeight: 500, marginBottom: 6 }}>天数（来自日历标签）</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6 }}>
          {([
            { key: 'school' as TagKind, val: schoolDays },
            { key: 'intern' as TagKind, val: internDays },
            { key: 'home'   as TagKind, val: homeDays },
            { key: 'travel' as TagKind, val: travelDays },
          ]).map(({ key, val }) => (
            <div key={key} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: C.sub }}>{tagMeta[key].icon} {tagMeta[key].label}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: tagMeta[key].color }}>{val}</div>
            </div>
          ))}
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
            <AmountInput value={e.amount ? String(e.amount) : ''} onChange={(v) => updateMajor(i, { amount: parseFloat(v) || 0 })} placeholder="金额" style={{ ...fieldStyle, padding: '6px 8px' }} />
            <button onClick={() => removeMajor(i)} style={{ color: C.red, border: 'none', background: 'none', fontSize: 16, cursor: 'pointer', padding: '0 4px' }}>×</button>
          </div>
        ))}
        <textarea
          value={majorExpensesNote}
          onChange={(ev) => setMajorExpensesNote(ev.target.value)}
          placeholder="备注（可选）"
          rows={1}
          style={{
            ...fieldStyle,
            width: '100%',
            marginTop: 6,
            padding: '6px 8px',
            fontSize: 12,
            resize: 'none',
            overflow: 'hidden',
            minHeight: 30,
            boxSizing: 'border-box',
            fontFamily: 'inherit',
          }}
          onInput={(ev) => {
            const el = ev.currentTarget;
            el.style.height = 'auto';
            el.style.height = el.scrollHeight + 'px';
          }}
          ref={(el) => { if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; } }}
        />
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
          width: '100%', display: 'grid', gridTemplateColumns: '72px 1fr 1fr 1fr',
          alignItems: 'center', padding: '12px 10px', borderRadius: 10, border: 'none',
          backgroundColor: open ? '#e8f0fe' : '#fafafa', cursor: 'pointer',
          textAlign: 'left', transition: 'background-color 0.15s',
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: open ? C.blue : '#202124' }}>{record.yearMonth}</span>
        <span style={{ fontSize: 13, color: C.red, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>+{formatCurrency(record.income)}</span>
        <span style={{ fontSize: 13, color: C.green, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>-{formatCurrency(record.totalExpense)}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: surplus >= 0 ? C.red : C.green, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>
          {surplus >= 0 ? '+' : '-'}{formatCurrency(surplus)}
        </span>
      </button>

      {open && (
        <div style={{ margin: '2px 0 8px', border: '1.5px solid #c5d9f8', borderRadius: 10, backgroundColor: '#f8fbff', padding: '14px 16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
            <div>
              <StatRow label="收入"  value={<CurrencyDisplay value={record.income} color={C.red} />} />
              <StatRow label="总支出" value={<CurrencyDisplay value={record.totalExpense} color={C.green} />} />
              <StatRow label="结余"  value={<CurrencyDisplay value={surplus} color={surplus >= 0 ? C.red : C.green} />} />
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
              {/* 各品类持仓及累计收益 */}
              {record.investBreakdown && (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #e8eaed' }}>
                      <th style={{ textAlign: 'left', padding: '3px 0', color: C.sub, fontWeight: 500 }}>品类</th>
                      <th style={{ textAlign: 'right', padding: '3px 0', color: C.sub, fontWeight: 500 }}>持仓</th>
                      <th style={{ textAlign: 'right', padding: '3px 0', color: C.sub, fontWeight: 500 }}>累计收益</th>
                      <th style={{ textAlign: 'right', padding: '3px 0', color: C.sub, fontWeight: 500 }}>本月收益</th>
                      <th style={{ textAlign: 'right', padding: '3px 0', color: C.sub, fontWeight: 500 }}>收益率</th>
                    </tr>
                  </thead>
                  <tbody>
                    {INVEST_KEYS.filter((k) => (record.investBreakdown![k] ?? 0) > 0).map((k) => {
                      const cur = record.investBreakdown![k] ?? 0;
                      const profit = record.investBreakdownProfit?.[k] ?? null;
                      const prevProfit = prev?.investBreakdownProfit?.[k] ?? null;
                      const monthlyProfit = (profit !== null && prevProfit !== null) ? profit - prevProfit : null;
                      const rate = (monthlyProfit !== null && cur > 0) ? monthlyProfit / cur : null;
                      return (
                        <tr key={k} style={{ borderBottom: '1px solid #f5f5f5' }}>
                          <td style={{ padding: '4px 0', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: investMeta[k].color, display: 'inline-block', flexShrink: 0 }} />
                            {investMeta[k].label}
                          </td>
                          <td style={{ padding: '4px 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(cur)}</td>
                          <td style={{ padding: '4px 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: profit !== null ? (profit >= 0 ? C.red : C.green) : C.sub }}>
                            {profit !== null ? `${profit >= 0 ? '+' : ''}${Math.round(profit)}` : '—'}
                          </td>
                          <td style={{ padding: '4px 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: monthlyProfit !== null ? (monthlyProfit >= 0 ? C.red : C.green) : C.sub }}>
                            {monthlyProfit !== null ? `${monthlyProfit >= 0 ? '+' : ''}${Math.round(monthlyProfit)}` : '—'}
                          </td>
                          <td style={{ padding: '4px 0', textAlign: 'right', color: rate !== null ? (rate >= 0 ? C.red : C.green) : C.sub }}>
                            {rate !== null ? `${rate >= 0 ? '+' : ''}${(rate * 100).toFixed(1)}%` : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}
          <div style={{ borderTop: '1px solid #dbe8fb', paddingTop: 10, display: 'flex', gap: 16, fontSize: 12, color: C.sub, flexWrap: 'wrap' }}>
            {([
              { key: 'school' as TagKind, days: record.schoolDays },
              { key: 'intern' as TagKind, days: record.internDays },
              { key: 'home'   as TagKind, days: record.homeDays },
              { key: 'travel' as TagKind, days: record.travelDays },
            ]).filter(({ days }) => days && days > 0).map(({ key, days }) => (
              <span key={key} style={{ color: tagMeta[key].color, fontWeight: 500 }}>
                {tagMeta[key].icon} {tagMeta[key].label} {days}天
              </span>
            ))}
            {record.school > 0 && <span>校园卡 ¥{formatCurrency(record.school)}</span>}
          </div>
          {((record.majorExpenses && record.majorExpenses.length > 0) || record.majorExpensesNote) && (
            <div style={{ borderTop: '1px solid #dbe8fb', paddingTop: 10, marginTop: 8 }}>
              <div style={{ fontSize: 12, color: C.sub, marginBottom: 6 }}>大额支出</div>
              {record.majorExpenses?.map((e, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '3px 0' }}>
                  <span>
                    <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 4, fontSize: 11, marginRight: 6, backgroundColor: e.type === '生活' ? '#e8f0fe' : '#f3e8fd', color: e.type === '生活' ? C.blue : C.purple }}>{e.type}</span>
                    {e.name}
                  </span>
                  <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>¥{formatCurrency(e.amount)}</span>
                </div>
              ))}
              {record.majorExpensesNote && (
                <div style={{ fontSize: 12, color: C.sub, marginTop: 6, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                  {record.majorExpensesNote}
                </div>
              )}
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

// ── 年度分组（可展开月度） ─────────────────────────────────────────
function YearSection({ year, recs, allRecords }: { year: string; recs: MonthlyRecord[]; allRecords: MonthlyRecord[] }) {
  const currentYear = String(new Date().getFullYear());
  const [expanded, setExpanded] = useState(year === currentYear);
  const totalIncome  = recs.reduce((s, r) => s + r.income, 0);
  const totalExpense = recs.reduce((s, r) => s + r.totalExpense, 0);
  const surplus = totalIncome - totalExpense;
  const hasMonths = `${year}-01` >= YEARLY_ONLY_BEFORE;

  return (
    <div style={{ marginBottom: 4 }}>
      <button
        onClick={() => setExpanded((o) => !o)}
        style={{
          width: '100%', display: 'grid', gridTemplateColumns: '72px 1fr 1fr 1fr',
          alignItems: 'center', padding: '12px 10px', borderRadius: 10, border: 'none',
          backgroundColor: expanded ? '#e8f0fe' : '#f1f3f4', cursor: 'pointer',
          textAlign: 'left', transition: 'background-color 0.15s',
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 700, color: expanded ? C.blue : '#202124' }}>{year} {expanded ? '▼' : '▶'}</span>
        <span style={{ fontSize: 13, color: C.red, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>+{formatCurrency(totalIncome)}</span>
        <span style={{ fontSize: 13, color: C.green, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>-{formatCurrency(totalExpense)}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: surplus >= 0 ? C.red : C.green, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>
          {surplus >= 0 ? '+' : '-'}{formatCurrency(surplus)}
        </span>
      </button>
      {expanded && (
        <div style={{ paddingLeft: 8, marginTop: 4, marginBottom: 8 }}>
          {hasMonths ? (
            recs.map((r, i, arr) => {
              const prevInArr = arr[i + 1];
              const prevRecord = prevInArr ?? allRecords.find((x) => x.yearMonth < r.yearMonth);
              return <MonthRow key={r.yearMonth} record={r} prev={prevRecord} />;
            })
          ) : (
            <div style={{ padding: '10px 14px', backgroundColor: '#fafafa', borderRadius: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <StatRow label="总收入"  value={<CurrencyDisplay value={totalIncome} color={C.red} />} />
                <StatRow label="总支出"  value={<CurrencyDisplay value={totalExpense} color={C.green} />} />
                <StatRow label="总结余"  value={<CurrencyDisplay value={surplus} color={surplus >= 0 ? C.red : C.green} />} />
                <StatRow label="月均收入" value={<CurrencyDisplay value={totalIncome / recs.length} color={C.red} />} />
                <StatRow label="月均支出" value={<CurrencyDisplay value={totalExpense / recs.length} color={C.green} />} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── 主组件 ────────────────────────────────────────────────────────
export default function HistoryPage() {
  const { records, upsert } = useMonthlyStore();
  const { countByTag, tagMap, confirmedExpenses } = useCalendarStore();
  const { expenseItems } = useBillDetailStore();
  const { overrides: lifePeriodOverrides } = useLifePeriodOverrideStore();
  const [formOpen, setFormOpen] = useState(false);
  const twoYearsAgo = `${new Date().getFullYear() - 1}-01`;
  const stats = useMemo(
    () => calcHistoryStats(records.filter((r) => r.yearMonth >= twoYearsAgo), tagMap, confirmedExpenses, expenseItems, lifePeriodOverrides),
    [records, tagMap, confirmedExpenses, expenseItems, lifePeriodOverrides],
  );

  const thisMonth = currentYearMonth();
  const existingThisMonth = records.find((r) => r.yearMonth === thisMonth);
  const prevMonthRecord   = records.find((r) => r.yearMonth === prevYearMonth(thisMonth));

  const years = useMemo(() => {
    const map: Record<string, MonthlyRecord[]> = {};
    for (const r of records) {
      const y = r.yearMonth.slice(0, 4);
      if (!map[y]) map[y] = [];
      map[y].push(r);
    }
    return Object.entries(map).sort((a, b) => b[0].localeCompare(a[0]));
  }, [records]);

  const handleSaveMonth = (r: MonthlyRecord) => {
    upsert(r);
    setFormOpen(false);
  };

  const tableHeader = (
    <div style={{ display: 'grid', gridTemplateColumns: '72px 1fr 1fr 1fr', padding: '6px 10px', fontSize: 11, color: C.sub, fontWeight: 500, marginBottom: 4 }}>
      <span>年/月</span>
      <span style={{ textAlign: 'right' }}>收入</span>
      <span style={{ textAlign: 'right' }}>支出</span>
      <span style={{ textAlign: 'right' }}>结余</span>
    </div>
  );

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 14px' }}>历史记录</h1>

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
              tagCounts={countByTag(thisMonth)}
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

      {/* 月度快照（历史均值） */}
      <Card title="月度快照" subtitle={`近两年均值 · 共 ${records.length} 个月`}>
        {(() => {
          const monthlySurplus = stats.monthlyIncomeAvg - stats.totalExpenseAvg;
          const sceneDailyRows: { tagKind: TagKind; val: number }[] = [
            { tagKind: 'school', val: stats.stateDailyAvg.school },
            { tagKind: 'home',   val: stats.stateDailyAvg.home },
            { tagKind: 'intern', val: stats.stateDailyAvg.intern },
            { tagKind: 'travel', val: stats.stateDailyAvg.travel },
          ];
          return (
            <>
              <StatRow label="月均收入" value={<CurrencyDisplay value={stats.monthlyIncomeAvg} color={C.red} />} />
              <StatRow label="月均支出" value={<CurrencyDisplay value={stats.totalExpenseAvg} color={C.green} />} />
              <StatRow label="周期生活" indent value={<CurrencyDisplay value={stats.periodicLifeAvg} color={C.blue} />} />
              <StatRow label="波动生活" indent value={<CurrencyDisplay value={stats.volatileLifeAvg} color={C.blue} />} />
              <StatRow label="消费" indent value={<CurrencyDisplay value={stats.consumptionAvg} color={C.purple} />} />
              <Divider />
              <StatRow label="月均结余" value={<CurrencyDisplay value={monthlySurplus} color={monthlySurplus >= 0 ? C.red : C.green} />} />
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
              {stats.longLifeDailyBase > 0 && (
                <div style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, padding: '6px 10px', backgroundColor: '#f1f3f4', borderRadius: 8 }}>
                  <span style={{ color: C.sub }}>📦 共享均摊 <span style={{ fontSize: 10 }}>(已含)</span></span>
                  <span style={{ fontWeight: 500, fontVariantNumeric: 'tabular-nums', color: C.sub }}>¥{formatCurrency(stats.longLifeDailyBase)}/天</span>
                </div>
              )}
            </>
          );
        })()}
      </Card>

      {/* 趋势图 */}
      <TrendCharts records={records} />

      {/* 历史明细（按年展开） */}
      <Card title="历史明细" subtitle="点击年份展开月度">
        {tableHeader}
        {years.map(([year, recs]) => (
          <YearSection key={year} year={year} recs={recs} allRecords={records} />
        ))}
      </Card>
    </div>
  );
}
