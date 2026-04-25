import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Card from '../components/Card';
import StatRow from '../components/StatRow';
import CurrencyDisplay, { formatCurrency } from '../components/CurrencyDisplay';
import { tagMeta, investMeta } from '../data/mockData';
import { parseBillFile, exportBillDefaults, exportCalendarDefaults, exportAppConfig, type BillItem, type BillExpenseMonth, type BillExpenseItem } from '../utils/importBill';
import { useBillDetailStore } from '../stores/billDetailStore';
import AmountInput from '../components/AmountInput';
import { calcHistoryStats } from '../calculations/history';
import { useCalendarStore } from '../stores/calendarStore';
import { useConfigStore } from '../stores/configStore';
import { useSnapshotStore } from '../stores/snapshotStore';
import { useMonthlyStore } from '../stores/monthlyStore';
import { usePrefsStore } from '../stores/prefsStore';
import { useDragSort } from '../hooks/useDragSort';
import type { TagKind, MonthlyRecord, MajorExpense, InvestHoldings } from '../models/types';

const C = { blue: '#1a73e8', red: '#ea4335', green: '#0d9488', purple: '#7c3aed', sub: '#5f6368', border: '#e0e0e0', weekend: '#ea4335', orange: '#e8710a' };
const CN_MONTH = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
const WEEK_HEADERS = ['一', '二', '三', '四', '五', '六', '日'];

// ── Calendar helpers ──────────────────────────────────────────────
function pad(n: number) { return String(n).padStart(2, '0'); }
function getDaysInMonth(year: number, month: number) { return new Date(year, month + 1, 0).getDate(); }
function getDayOfWeek(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}
function isWeekend(key: string) { const dow = getDayOfWeek(key); return dow === 0 || dow === 6; }
function getRange(a: string, b: string): string[] {
  const [s, e] = a <= b ? [a, b] : [b, a];
  const result: string[] = [];
  const cur = new Date(s + 'T00:00:00');
  const end = new Date(e + 'T00:00:00');
  while (cur <= end) {
    result.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`);
    cur.setDate(cur.getDate() + 1);
  }
  return result;
}

// ── Bill tag detail helpers ───────────────────────────────────────
const NOISE_TAGS = new Set(['周期生活', '波动生活', '消费', '吃好喝好', '红', '黑', '消耗品', '白', '家']);
const NOISE_NOTE_PATTERNS = [/账户余额补齐/, /美团平台商户/];
function extractMeaningful(tagsRaw: string, note: string): string {
  const tags = tagsRaw.split(',').map(t => t.trim()).filter(t => t && !NOISE_TAGS.has(t));
  const cleanNote = NOISE_NOTE_PATTERNS.some(p => p.test(note)) ? '' : note;
  return [cleanNote, ...tags].filter(Boolean).join(' · ');
}

// ── History helpers ───────────────────────────────────────────────
const YEARLY_ONLY_BEFORE = '2023-01';
const INVEST_KEYS = ['us', 'eu', 'asia', 'a', 'longBond', 'usBond', 'gold'] as const;
const _NOW = new Date();

function currentYearMonth() {
  return `${_NOW.getFullYear()}-${String(_NOW.getMonth() + 1).padStart(2, '0')}`;
}
function prevYearMonth(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

// ── MonthForm ─────────────────────────────────────────────────────
function MonthForm({ yearMonth, existing, prevRecord, tagCounts, onSave }: {
  yearMonth: string;
  existing?: MonthlyRecord;
  prevRecord?: MonthlyRecord;
  tagCounts: Record<TagKind, number>;
  onSave: (r: MonthlyRecord) => void;
}) {
  const [income,       setIncome]       = useState(String(existing?.income        ?? ''));
  const [totalExpense, setTotalExpense]  = useState(String(existing?.totalExpense  ?? ''));
  const [periodicLife, setPeriodicLife]  = useState(String(existing?.periodicLife  ?? ''));
  const [volatileLife, setVolatileLife]  = useState(String(existing?.volatileLife  ?? ''));
  const [consumption,  setConsumption]   = useState(String(existing?.consumption   ?? ''));
  const [school,       setSchool]        = useState(String(existing?.school        ?? ''));
  const [accProfit,    setAccProfit]     = useState(String(existing?.accumulatedProfit ?? ''));
  const [investTotal,  setInvestTotal]   = useState(String(existing?.investTotal   ?? ''));

  const homeDays   = tagCounts.home   > 0 ? tagCounts.home   : (existing?.homeDays   ?? 0);
  const travelDays = tagCounts.travel > 0 ? tagCounts.travel : (existing?.travelDays ?? 0);
  const schoolDays = tagCounts.school > 0 ? tagCounts.school : (existing?.schoolDays ?? 0);
  const internDays = tagCounts.intern > 0 ? tagCounts.intern : (existing?.internDays ?? 0);

  const [majorExpenses, setMajorExpenses] = useState<MajorExpense[]>(existing?.majorExpenses ?? []);
  const [breakdown, setBreakdown] = useState<Partial<Record<keyof InvestHoldings, string>>>(
    () => Object.fromEntries(INVEST_KEYS.map((k) => [k, String(existing?.investBreakdown?.[k] ?? '')])) as Record<keyof InvestHoldings, string>
  );
  const [breakdownProfit, setBreakdownProfit] = useState<Partial<Record<keyof InvestHoldings, string>>>(
    () => Object.fromEntries(INVEST_KEYS.map((k) => [k, String(existing?.investBreakdownProfit?.[k] ?? '')])) as Record<keyof InvestHoldings, string>
  );
  const [showBreakdown, setShowBreakdown] = useState(false);
  const { current: snapshotCurrent } = useSnapshotStore();
  const mainFieldRefs = useRef<(HTMLInputElement | null)[]>([]);
  const breakdownRefs = useRef<(HTMLInputElement | null)[]>([]);
  const breakdownProfitRefs = useRef<(HTMLInputElement | null)[]>([]);
  const focusNext = (refs: React.MutableRefObject<(HTMLInputElement | null)[]>, i: number) => {
    setTimeout(() => refs.current[i + 1]?.focus(), 0);
  };
  const copyHoldingsFromReconcile = () => {
    setBreakdown(
      Object.fromEntries(INVEST_KEYS.map((k) => [k, String(snapshotCurrent.investHoldings[k] ?? 0)])) as Partial<Record<keyof InvestHoldings, string>>,
    );
  };

  const importInvestTotalFromReconcile = () => {
    const total = INVEST_KEYS.reduce((sum, k) => sum + (snapshotCurrent.investHoldings[k] || 0), 0);
    setInvestTotal(total.toFixed(2));
  };

  const n = (v: string) => parseFloat(v) || 0;
  const surplus = n(income) - n(totalExpense);
  const investIncome = prevRecord ? n(accProfit) - (prevRecord.accumulatedProfit ?? 0) : null;
  const investMonthly = investIncome !== null && n(investTotal) > 0 ? investIncome / n(investTotal) : null;
  const investAnnual = investMonthly !== null ? investMonthly * 12 : null;

  const addMajor    = () => setMajorExpenses((p) => [...p, { type: '生活', name: '', amount: 0 }]);
  const removeMajor = (i: number) => setMajorExpenses((p) => p.filter((_, idx) => idx !== i));
  const updateMajor = (i: number, patch: Partial<MajorExpense>) =>
    setMajorExpenses((p) => p.map((e, idx) => idx === i ? { ...e, ...patch } : e));

  const handleSave = () => {
    const bd = Object.fromEntries(INVEST_KEYS.map((k) => [k, parseFloat(breakdown[k] ?? '') || 0])) as unknown as InvestHoldings;
    const hasBreakdown = INVEST_KEYS.some((k) => (bd[k] || 0) > 0);
    const bp = Object.fromEntries(INVEST_KEYS.map((k) => [k, parseFloat(breakdownProfit[k] ?? '') || 0])) as unknown as InvestHoldings;
    const hasBreakdownProfit = INVEST_KEYS.some((k) => (bp[k] || 0) !== 0);
    onSave({
      yearMonth, income: n(income), totalExpense: n(totalExpense),
      periodicLife: n(periodicLife), volatileLife: n(volatileLife),
      consumption: n(consumption), school: n(school),
      accumulatedProfit: n(accProfit), investTotal: n(investTotal),
      investBreakdown: hasBreakdown ? bd : undefined,
      investBreakdownProfit: hasBreakdownProfit ? bp : undefined,
      homeDays, travelDays, schoolDays, internDays,
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
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 100, backgroundColor: surplus >= 0 ? '#fce8e6' : '#e6f4ea', borderRadius: 10, padding: '10px 14px' }}>
          <div style={{ fontSize: 11, color: C.sub }}>本月结余</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: surplus >= 0 ? C.red : C.green, fontVariantNumeric: 'tabular-nums' }}>
            {surplus >= 0 ? '+' : '-'}¥{formatCurrency(Math.abs(surplus))}
          </div>
        </div>
        {investIncome !== null && (
          <div style={{ flex: 1, minWidth: 100, backgroundColor: investIncome >= 0 ? '#fce8e6' : '#e6f4ea', borderRadius: 10, padding: '10px 14px' }}>
            <div style={{ fontSize: 11, color: C.sub }}>理财收入</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: investIncome >= 0 ? C.red : C.green, fontVariantNumeric: 'tabular-nums' }}>
              {investIncome >= 0 ? '+' : ''}¥{formatCurrency(investIncome)}
              {investMonthly !== null && <span style={{ fontSize: 11, marginLeft: 6, color: C.sub }}>月 {(investMonthly * 100).toFixed(2)}% · 年化 {(investAnnual! * 100).toFixed(1)}%</span>}
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
        {([
          { label: '总收入',    val: income,       set: setIncome,       editable: false },
          { label: '总支出',    val: totalExpense,  set: setTotalExpense,  editable: false },
          { label: '周期生活',  val: periodicLife,  set: setPeriodicLife,  editable: false },
          { label: '波动生活',  val: volatileLife,  set: setVolatileLife,  editable: false },
          { label: '消费（交行）', val: consumption, set: setConsumption,   editable: false },
          { label: '校园卡支出', val: school,       set: setSchool,        editable: false },
          { label: '累计盈利',  val: accProfit,     set: setAccProfit,     editable: true  },
          { label: '理财总额',  val: investTotal,   set: setInvestTotal,   editable: true  },
        ] as const).map(({ label, val, set, editable }, i) => {
          const editableIndices = [6, 7];
          const editIdx = editableIndices.indexOf(i);
          return (
            <div key={label}>
              <div style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 4 }}>
                {label}
                {!editable && <span style={{ fontSize: 10, color: C.sub }}>（账单自动）</span>}
                {label === '理财总额' && (
                  <button onClick={importInvestTotalFromReconcile} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, border: `1px solid ${C.blue}`, backgroundColor: 'transparent', color: C.blue, cursor: 'pointer' }}>
                    ← 对账
                  </button>
                )}
              </div>
              {editable ? (
                <AmountInput
                  ref={(el) => { mainFieldRefs.current[editIdx] = el; }}
                  value={val}
                  onChange={set}
                  placeholder="0.00"
                  style={fieldStyle}
                  onKeyDown={(e) => { if (e.key === 'Enter' && editIdx < editableIndices.length - 1) { e.preventDefault(); setTimeout(() => mainFieldRefs.current[editIdx + 1]?.focus(), 0); } }}
                />
              ) : (
                <div style={{ padding: '8px 10px', fontSize: 13, fontVariantNumeric: 'tabular-nums', borderRadius: 8, backgroundColor: '#f1f3f4', color: '#3c4043', minHeight: 20 }}>
                  {val ? formatCurrency(n(val)) : '—'}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {(() => {
        const pe = parseFloat(periodicLife) || 0;
        const vo = parseFloat(volatileLife) || 0;
        const co = parseFloat(consumption) || 0;
        const te = parseFloat(totalExpense) || 0;
        if (!periodicLife && !volatileLife && !consumption && !totalExpense) return null;
        const diff = Math.round((pe + vo + co - te) * 100) / 100;
        const ok = Math.abs(diff) <= 0.01;
        return (
          <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 10, fontSize: 12, backgroundColor: ok ? '#e6f4ea' : '#fce8e6', color: ok ? '#137333' : '#c5221f', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>三项之和 − 总支出</span>
            <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
              {ok ? '✓' : `${diff > 0 ? '+' : ''}${formatCurrency(diff)}`}
            </span>
          </div>
        );
      })()}

      {/* 理财各品类持仓 & 累计收益 */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => setShowBreakdown((v) => !v)}
            style={{ flex: 1, textAlign: 'left', fontSize: 12, color: C.sub, fontWeight: 500, padding: '6px 0', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }}
          >
            <span>📈 理财各品类持仓 & 累计收益（月末）</span>
            <span>{showBreakdown ? '▲' : '▼'}</span>
          </button>
          {showBreakdown && (
            <button
              onClick={(e) => { e.stopPropagation(); copyHoldingsFromReconcile(); }}
              style={{ fontSize: 11, color: C.blue, border: `1px solid ${C.blue}`, borderRadius: 6, padding: '3px 8px', backgroundColor: '#fff', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
              title="从对账页当前持仓复制到本月各品类持仓"
            >
              📋 从对账页复制
            </button>
          )}
        </div>
        {showBreakdown && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 6, tableLayout: 'fixed' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e8eaed' }}>
                <th style={{ textAlign: 'left', padding: '4px 0', color: C.sub, fontWeight: 500, width: '30%' }}>品类</th>
                <th style={{ textAlign: 'right', padding: '4px 0', color: C.sub, fontWeight: 500, width: '35%' }}>持仓金额</th>
                <th style={{ textAlign: 'right', padding: '4px 0', color: C.sub, fontWeight: 500, width: '35%' }}>累计收益</th>
              </tr>
            </thead>
            <tbody>
              {INVEST_KEYS.map((k, i) => (
                <tr key={k} style={{ borderBottom: '1px solid #f1f3f4' }}>
                  <td style={{ padding: '5px 0', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', backgroundColor: investMeta[k].color, flexShrink: 0 }} />
                    {investMeta[k].label}
                  </td>
                  <td style={{ padding: '4px 0', textAlign: 'right' }}>
                    <AmountInput
                      ref={(el) => { breakdownRefs.current[i] = el; }}
                      value={breakdown[k] ?? ''} placeholder="0"
                      onChange={(v) => setBreakdown((p) => ({ ...p, [k]: v }))}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); focusNext(breakdownRefs, i); } }}
                      style={{ width: '90%', border: 'none', borderBottom: '1px solid #fbbf24', outline: 'none', backgroundColor: 'transparent', fontSize: 12, fontVariantNumeric: 'tabular-nums', textAlign: 'right', padding: '2px 0' }}
                    />
                  </td>
                  <td style={{ padding: '4px 0', textAlign: 'right' }}>
                    <AmountInput
                      ref={(el) => { breakdownProfitRefs.current[i] = el; }}
                      value={breakdownProfit[k] ?? ''} placeholder="0"
                      onChange={(v) => setBreakdownProfit((p) => ({ ...p, [k]: v }))}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); focusNext(breakdownProfitRefs, i); } }}
                      style={{ width: '90%', border: 'none', borderBottom: `1px solid ${C.blue}`, outline: 'none', backgroundColor: 'transparent', fontSize: 12, fontVariantNumeric: 'tabular-nums', textAlign: 'right', padding: '2px 0', color: C.blue }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 大额支出 */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontSize: 12, color: C.sub, fontWeight: 500 }}>大额支出明细</div>
          <button onClick={addMajor} style={{ fontSize: 12, color: C.blue, border: `1px solid ${C.blue}`, borderRadius: 6, padding: '3px 10px', backgroundColor: '#fff', cursor: 'pointer' }}>+ 添加</button>
        </div>
        {(() => {
          const amounts = majorExpenses.map((x) => x.amount || 0);
          const maxAmt = Math.max(0, ...amounts);
          const minAmt = Math.min(...amounts.filter((a) => a > 0), maxAmt);
          return majorExpenses.map((e, i) => {
          // 色阶：当月大额支出相对比较，最大→红，最小→绿
          const amt = e.amount || 0;
          const hasRange = maxAmt > minAmt && amt > 0;
          const ratio = hasRange ? (amt - minAmt) / (maxAmt - minAmt) : (amt > 0 ? 1 : 0);
          const hue = 120 - ratio * 120; // 120 绿 → 0 红
          const amtBg = amt > 0 ? `hsl(${hue}, 72%, 92%)` : '#fffbeb';
          const amtBorder = amt > 0 ? `hsl(${hue}, 65%, 55%)` : '#fbbf24';
          const amtColor = amt > 0 ? `hsl(${hue}, 70%, 30%)` : '#202124';
          return (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '60px 1fr 90px auto', gap: 6, marginBottom: 6, alignItems: 'center' }}>
            <select value={e.type} onChange={(ev) => updateMajor(i, { type: ev.target.value as '生活' | '消费' })}
              style={{ border: '1.5px solid #dadce0', borderRadius: 6, padding: '6px 4px', fontSize: 12, outline: 'none' }}>
              <option value="生活">生活</option>
              <option value="消费">消费</option>
            </select>
            <input type="text" value={e.name} onChange={(ev) => updateMajor(i, { name: ev.target.value })} placeholder="项目名称" style={{ ...fieldStyle, padding: '6px 8px' }} />
            <AmountInput value={e.amount ? String(e.amount) : ''} onChange={(v) => updateMajor(i, { amount: parseFloat(v) || 0 })} placeholder="金额"
              style={{ ...fieldStyle, padding: '6px 8px', backgroundColor: amtBg, borderColor: amtBorder, color: amtColor, fontWeight: 600, transition: 'background-color 0.2s, border-color 0.2s, color 0.2s' }}
            />
            <button onClick={() => removeMajor(i)} style={{ color: C.red, border: 'none', background: 'none', fontSize: 16, cursor: 'pointer', padding: '0 4px' }}>×</button>
          </div>
          );
          });
        })()}
      </div>

      <button
        onClick={handleSave}
        style={{ width: '100%', backgroundColor: C.blue, color: '#fff', fontWeight: 700, fontSize: 15, padding: '13px 0', borderRadius: 12, border: 'none', cursor: 'pointer', letterSpacing: 1 }}
      >
        保存本月数据
      </button>
    </div>
  );
}

// ── Category drill-down ────────────────────────────────────────────
function ExpenseItemLine({ it }: { it: BillExpenseItem }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '2px 0 2px 32px', color: '#5f6368' }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        <span style={{ color: C.sub, marginRight: 6 }}>{it.date.slice(5)}</span>
        {it.note || it.subcategory || it.category || '—'}
      </span>
      <span style={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0, marginLeft: 8 }}>¥{formatCurrency(it.amount)}</span>
    </div>
  );
}

function SubcategoryRow({ sub, items, total }: { sub: string; items: BillExpenseItem[]; total: number }) {
  const [open, setOpen] = useState(false);
  const sum = items.reduce((s, i) => s + i.amount, 0);
  const pct = total > 0 ? (sum / total) * 100 : 0;
  const sorted = [...items].sort((a, b) => b.amount - a.amount);
  return (
    <div>
      <div
        onClick={() => setOpen((o) => !o)}
        style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0 3px 16px', cursor: 'pointer', color: '#3c4043' }}
      >
        <span>{open ? '▼' : '▶'} {sub || '(无二级)'}</span>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>¥{formatCurrency(sum)} · {pct.toFixed(1)}%</span>
      </div>
      {open && sorted.map((it, i) => <ExpenseItemLine key={i} it={it} />)}
    </div>
  );
}

function CategoryRow({ cat, items, total }: { cat: string; items: BillExpenseItem[]; total: number }) {
  const [open, setOpen] = useState(false);
  const sum = items.reduce((s, i) => s + i.amount, 0);
  const pct = total > 0 ? (sum / total) * 100 : 0;
  const subMap = new Map<string, BillExpenseItem[]>();
  for (const it of items) {
    const s = it.subcategory || '';
    if (!subMap.has(s)) subMap.set(s, []);
    subMap.get(s)!.push(it);
  }
  const subs = [...subMap.entries()]
    .map(([sub, arr]) => ({ sub, items: arr, total: arr.reduce((s, i) => s + i.amount, 0) }))
    .sort((a, b) => b.total - a.total);
  return (
    <div>
      <div
        onClick={() => setOpen((o) => !o)}
        style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', cursor: 'pointer', color: '#202124', fontWeight: 500 }}
      >
        <span>{open ? '▼' : '▶'} {cat || '(无分类)'}</span>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>¥{formatCurrency(sum)} · {pct.toFixed(1)}%</span>
      </div>
      {open && subs.map((s) => <SubcategoryRow key={s.sub} sub={s.sub} items={s.items} total={total} />)}
    </div>
  );
}

// ── MonthRow ──────────────────────────────────────────────────────
function MonthRow({ record, prev, onJumpToMonth, expenseItems }: { record: MonthlyRecord; prev?: MonthlyRecord; onJumpToMonth?: (ym: string) => void; expenseItems?: BillExpenseMonth }) {
  const [open, setOpen] = useState(false);
  const surplus = record.income - record.totalExpense;
  const expenseSum = record.periodicLife + record.volatileLife + record.consumption;
  const expenseDiff = Math.round((expenseSum - record.totalExpense) * 100) / 100;
  const expenseMismatch = Math.abs(expenseDiff) > 0.01;
  const investIncome = prev?.accumulatedProfit ? record.accumulatedProfit - prev.accumulatedProfit : null;
  const investAnnual = investIncome !== null && record.investTotal > 0 ? (investIncome / record.investTotal) * 12 : null;

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
        <span style={{ fontSize: 13, fontWeight: 600, color: open ? C.blue : '#202124' }}>
          {record.yearMonth}
          {expenseMismatch && <span title={`三项之和 ${formatCurrency(expenseSum)} ≠ 总支出 ${formatCurrency(record.totalExpense)}`} style={{ marginLeft: 4, color: '#c5221f' }}>⚠️</span>}
        </span>
        <span style={{ fontSize: 13, color: C.red,   fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>+{formatCurrency(record.income)}</span>
        <span style={{ fontSize: 13, color: C.green,  fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>-{formatCurrency(record.totalExpense)}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: surplus >= 0 ? C.red : C.green, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>
          {surplus >= 0 ? '+' : '-'}{formatCurrency(Math.abs(surplus))}
        </span>
      </button>

      {open && (
        <div style={{ margin: '2px 0 8px', border: '1.5px solid #c5d9f8', borderRadius: 10, backgroundColor: '#f8fbff', padding: '14px 16px' }}>
          {expenseMismatch && (
            <div style={{ marginBottom: 10, padding: '6px 10px', borderRadius: 8, fontSize: 12, backgroundColor: '#fce8e6', color: '#c5221f', display: 'flex', justifyContent: 'space-between' }}>
              <span>三项之和 − 总支出</span>
              <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{expenseDiff > 0 ? '+' : ''}{formatCurrency(expenseDiff)}</span>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
            <div>
              <StatRow label="收入"   value={<CurrencyDisplay value={record.income}       color={C.red}   />} />
              <StatRow label="总支出" value={<CurrencyDisplay value={record.totalExpense}  color={C.green} />} />
              <StatRow label="结余"   value={<CurrencyDisplay value={surplus} color={surplus >= 0 ? C.red : C.green} />} />
            </div>
            <div>
              <StatRow label="周期生活" value={<CurrencyDisplay value={record.periodicLife} color={C.blue}   />} />
              <StatRow label="波动生活" value={<CurrencyDisplay value={record.volatileLife} color={C.blue}   />} />
              <StatRow label="消费"     value={<CurrencyDisplay value={record.consumption}  color={C.purple} />} />
            </div>
          </div>
          {investIncome !== null && (
            <div style={{ borderTop: '1px solid #dbe8fb', paddingTop: 10, marginBottom: 8 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 6 }}>
                <StatRow label="理财收入" value={<CurrencyDisplay value={investIncome} color={investIncome >= 0 ? C.red : C.green} />} />
                {investAnnual !== null && <StatRow label="年化" value={<span style={{ color: investAnnual >= 0 ? C.red : C.green, fontWeight: 500 }}>{(investAnnual * 100).toFixed(1)}%</span>} />}
              </div>
              {record.investBreakdown && (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #e8eaed' }}>
                      <th style={{ textAlign: 'left',  padding: '3px 0', color: C.sub, fontWeight: 500 }}>品类</th>
                      <th style={{ textAlign: 'right', padding: '3px 0', color: C.sub, fontWeight: 500 }}>持仓</th>
                      <th style={{ textAlign: 'right', padding: '3px 0', color: C.sub, fontWeight: 500 }}>累计收益</th>
                      <th style={{ textAlign: 'right', padding: '3px 0', color: C.sub, fontWeight: 500 }}>收益率</th>
                    </tr>
                  </thead>
                  <tbody>
                    {INVEST_KEYS.filter((k) => (record.investBreakdown![k] ?? 0) > 0).map((k) => {
                      const cur    = record.investBreakdown![k] ?? 0;
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
          {expenseItems && expenseItems.length > 0 && (() => {
            const total = expenseItems.reduce((s, i) => s + i.amount, 0);
            const catMap = new Map<string, BillExpenseItem[]>();
            for (const it of expenseItems) {
              const c = it.category || '';
              if (!catMap.has(c)) catMap.set(c, []);
              catMap.get(c)!.push(it);
            }
            const cats = [...catMap.entries()]
              .map(([cat, arr]) => ({ cat, items: arr, total: arr.reduce((s, i) => s + i.amount, 0) }))
              .sort((a, b) => b.total - a.total);
            return (
              <div style={{ borderTop: '1px solid #dbe8fb', paddingTop: 10, marginBottom: 8 }}>
                <div style={{ fontSize: 12, color: C.sub, marginBottom: 6 }}>分类支出</div>
                {cats.map((c) => <CategoryRow key={c.cat} cat={c.cat} items={c.items} total={total} />)}
              </div>
            );
          })()}
          <div style={{ borderTop: '1px solid #dbe8fb', paddingTop: 10, display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: C.sub, flexWrap: 'wrap' }}>
            {([
              { key: 'school' as TagKind, days: record.schoolDays },
              { key: 'intern' as TagKind, days: record.internDays },
              { key: 'home'   as TagKind, days: record.homeDays },
              { key: 'travel' as TagKind, days: record.travelDays },
            ]).filter(({ days }) => days && days > 0).map(({ key, days }) => (
              <span key={key} style={{ color: tagMeta[key].color, fontWeight: 500 }}>{tagMeta[key].icon} {tagMeta[key].label} {days}天</span>
            ))}
            {record.school > 0 && <span>校园卡 ¥{formatCurrency(record.school)}</span>}
            <span style={{ flex: 1 }} />
            {onJumpToMonth && (
              <button
                onClick={() => onJumpToMonth(record.yearMonth)}
                style={{ fontSize: 11, color: C.blue, border: `1px solid #a8c7fa`, borderRadius: 8, padding: '3px 10px', backgroundColor: '#e8f0fe', cursor: 'pointer', fontWeight: 600, flexShrink: 0 }}
              >
                → 日历
              </button>
            )}
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

// ── YearSection ───────────────────────────────────────────────────
function YearSection({ year, recs, allRecords, onJumpToMonth, expenseItemsByMonth }: { year: string; recs: MonthlyRecord[]; allRecords: MonthlyRecord[]; onJumpToMonth?: (ym: string) => void; expenseItemsByMonth?: Record<string, BillExpenseMonth> }) {
  const currentYear = String(_NOW.getFullYear());
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
        <span style={{ fontSize: 13, color: C.red,   fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>+{formatCurrency(totalIncome)}</span>
        <span style={{ fontSize: 13, color: C.green,  fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>-{formatCurrency(totalExpense)}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: surplus >= 0 ? C.red : C.green, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>
          {surplus >= 0 ? '+' : '-'}{formatCurrency(Math.abs(surplus))}
        </span>
      </button>
      {expanded && (
        <div style={{ paddingLeft: 8, marginTop: 4, marginBottom: 8 }}>
          {hasMonths ? (
            recs.map((r, i, arr) => {
              const prevInArr = arr[i + 1];
              const prevRecord = prevInArr ?? allRecords.find((x) => x.yearMonth < r.yearMonth);
              return <MonthRow key={r.yearMonth} record={r} prev={prevRecord} onJumpToMonth={onJumpToMonth} expenseItems={expenseItemsByMonth?.[r.yearMonth]} />;
            })
          ) : (
            <div style={{ padding: '10px 14px', backgroundColor: '#fafafa', borderRadius: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <StatRow label="总收入"  value={<CurrencyDisplay value={totalIncome}  color={C.red}   />} />
                <StatRow label="总支出"  value={<CurrencyDisplay value={totalExpense} color={C.green} />} />
                <StatRow label="总结余"  value={<CurrencyDisplay value={surplus} color={surplus >= 0 ? C.red : C.green} />} />
                <StatRow label="月均收入" value={<CurrencyDisplay value={totalIncome  / recs.length} color={C.red}   />} />
                <StatRow label="月均支出" value={<CurrencyDisplay value={totalExpense / recs.length} color={C.green} />} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────
export default function CalendarPage() {
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<'month' | 'year'>(
    searchParams.get('tab') === 'year' ? 'year' : 'month'
  );

  // ── Calendar state ──
  const _now = _NOW;
  const today = `${_now.getFullYear()}-${String(_now.getMonth()+1).padStart(2,'0')}-${String(_now.getDate()).padStart(2,'0')}`;
  const [year,  setYear]  = useState(_now.getFullYear());
  const [month, setMonth] = useState(_now.getMonth());
  const [selectedTag, setSelectedTag] = useState<TagKind>('school');
  const [selectMode, setSelectMode]   = useState<'single' | 'range'>('single');
  const [rangeStart, setRangeStart]   = useState<string | null>(null);
  const [rangeHover, setRangeHover]   = useState<string | null>(null);
  const [showWeekTemplate, setShowWeekTemplate] = useState(false);

  // ── History state ──
  const [formOpen, setFormOpen] = useState(false);

  // ── Stores ──
  const { tagMap, setTag, toggleTag, countByTag, bulkFillSchool } = useCalendarStore();
  const { config } = useConfigStore();
  const { current } = useSnapshotStore();
  const { records, upsert, updateDayCounts } = useMonthlyStore();
  const { tagOrder, setTagOrder, weekdayTags, setWeekdayTags } = usePrefsStore();
  const tagDrag = useDragSort(tagOrder, setTagOrder, 'horizontal');


  // ── 批量补填"学"：历史未标记天 + 切换月份时自动补当月 ──
  useEffect(() => {
    if (records.length === 0) return;
    const earliest = records[records.length - 1].yearMonth + '-01';
    const todayStr = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-${String(_now.getDate()).padStart(2, '0')}`;
    bulkFillSchool(earliest, todayStr);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (records.length === 0) return;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const ym = `${year}-${String(month + 1).padStart(2, '0')}`;
    bulkFillSchool(`${ym}-01`, `${ym}-${String(daysInMonth).padStart(2, '0')}`);
  }, [year, month]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── tagMap → MonthlyRecord 天数字段同步 ──
  useEffect(() => {
    // 按月聚合 tagMap 中的状态天数
    const countsByMonth: Record<string, { school: number; intern: number; home: number; travel: number }> = {};
    for (const [date, tag] of Object.entries(tagMap)) {
      const ym = date.slice(0, 7);
      if (!countsByMonth[ym]) countsByMonth[ym] = { school: 0, intern: 0, home: 0, travel: 0 };
      countsByMonth[ym][tag]++;
    }
    // 只更新已有 MonthlyRecord 的月份
    for (const [ym, counts] of Object.entries(countsByMonth)) {
      const rec = records.find((r) => r.yearMonth === ym);
      if (!rec) continue;
      if (
        rec.schoolDays !== counts.school ||
        rec.internDays !== counts.intern ||
        rec.homeDays   !== counts.home   ||
        rec.travelDays !== counts.travel
      ) {
        updateDayCounts(ym, {
          schoolDays: counts.school,
          internDays: counts.intern,
          homeDays:   counts.home,
          travelDays: counts.travel,
        });
      }
    }
  }, [tagMap]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 历史回归均值（近两年，用作当月按比例拆分的权重）──
  const twoYearsAgo = `${_now.getFullYear() - 1}-01`;
  const historyStats = useMemo(
    () => calcHistoryStats(records.filter((r) => r.yearMonth >= twoYearsAgo), tagMap),
    [records, tagMap],
  );

  // ── Calendar computed ──
  const todayDate      = _now.getDate();
  const daysInCurMonth = getDaysInMonth(_now.getFullYear(), _now.getMonth());
  const daysToPayDate  = config.creditPayDate - todayDate;
  const daysToBillDate = config.creditBillDate - todayDate;
  const showPayWarn    = todayDate >= config.creditPayDate - 5 && todayDate <= config.creditPayDate;
  const showBillWarn   = todayDate >= config.creditBillDate - 6 && todayDate <= config.creditBillDate;

  const upcomingPaydays = config.incomeItems.filter((item) => {
    if (!item.isActive) return false;
    const daysToNext = item.payDay >= todayDate ? item.payDay - todayDate : (daysInCurMonth - todayDate + item.payDay);
    return daysToNext <= 3;
  }).map((item) => ({
    ...item,
    daysToNext: item.payDay >= todayDate ? item.payDay - todayDate : (daysInCurMonth - todayDate + item.payDay),
  }));

  const yearMonth    = `${year}-${pad(month + 1)}`;
  const daysInMonth  = getDaysInMonth(year, month);
  const firstDayWeekIdx = (new Date(year, month, 1).getDay() + 6) % 7;

  const cells = useMemo(() => {
    const arr: { key: string; day: number | null }[] = [];
    for (let i = 0; i < firstDayWeekIdx; i++) arr.push({ key: `empty-${i}`, day: null });
    for (let d = 1; d <= daysInMonth; d++) arr.push({ key: `${year}-${pad(month + 1)}-${pad(d)}`, day: d });
    while (arr.length < 42) arr.push({ key: `tail-${arr.length}`, day: null });
    return arr;
  }, [year, month, firstDayWeekIdx, daysInMonth]);

  const TAG_CYCLE: (TagKind | undefined)[] = [undefined, 'intern', 'school', 'home', 'travel'];
  const cycleWeekday = (dow: number) => {
    const cur = weekdayTags[dow];
    const idx = TAG_CYCLE.indexOf(cur);
    const next = TAG_CYCLE[(idx + 1) % TAG_CYCLE.length];
    const next_ = { ...weekdayTags };
    if (next === undefined) { delete next_[dow]; } else { next_[dow] = next; }
    setWeekdayTags(next_);
  };
  const applyWeekdayTemplate = () => {
    for (const cell of cells) {
      if (cell.day === null) continue;
      const dow = getDayOfWeek(cell.key);
      const tag = weekdayTags[dow];
      if (!tag) continue;
      if (tag === 'intern' && isWeekend(cell.key)) continue;
      setTag(cell.key, tag);
    }
  };

  const previewRange = useMemo<Set<string>>(() => {
    if (selectMode !== 'range' || !rangeStart) return new Set();
    return new Set(getRange(rangeStart, rangeHover ?? rangeStart));
  }, [selectMode, rangeStart, rangeHover]);

  const stats = useMemo(() => {
    const counts: Record<TagKind, number> = { intern: 0, school: 0, home: 0, travel: 0 };
    for (const cell of cells) {
      if (cell.day === null) continue;
      const tag = tagMap[cell.key];
      if (tag) counts[tag]++;
    }
    return { counts, tagged: Object.values(counts).reduce((a, b) => a + b, 0), total: daysInMonth };
  }, [cells, tagMap, daysInMonth]);

  // 截止今天的 tag 天数（用于日均计算，未来的天不算）
  const statsToDate = useMemo(() => {
    const isCurrentMonth = yearMonth === today.slice(0, 7);
    const counts: Record<TagKind, number> = { intern: 0, school: 0, home: 0, travel: 0 };
    for (const cell of cells) {
      if (cell.day === null) continue;
      if (isCurrentMonth && cell.key > today) continue;
      const tag = tagMap[cell.key];
      if (tag) counts[tag]++;
    }
    return counts;
  }, [cells, tagMap, yearMonth, today]);

  const handleCellClick = (key: string) => {
    if (selectMode === 'single') { toggleTag(key, selectedTag); return; }
    if (!rangeStart) { setRangeStart(key); setRangeHover(key); }
    else {
      const range = getRange(rangeStart, key);
      const validKeys = new Set(cells.filter(c => c.day !== null).map(c => c.key));
      for (const k of range) { if (validKeys.has(k)) setTag(k, selectedTag); }
      setRangeStart(null); setRangeHover(null);
    }
  };
  const cancelRange = () => { setRangeStart(null); setRangeHover(null); };
  const switchMode  = (m: 'single' | 'range') => { setSelectMode(m); cancelRange(); };
  const prevMonth   = () => { cancelRange(); if (month === 0) { setYear((y) => y - 1); setMonth(11); } else setMonth((m) => m - 1); };
  const nextMonth   = () => { cancelRange(); if (month === 11) { setYear((y) => y + 1); setMonth(0); } else setMonth((m) => m + 1); };

  // ── 年月快捷跳转面板 ──
  const [pickerOpen, setPickerOpen] = useState(false);
  const [expandedTag, setExpandedTag] = useState<null | 'eat' | 'red' | 'black'>(null);
  const { tagStats: billTagStats, expenseItems: billExpenseItems, hasOverride: billHasOverride, updateFromImport: billUpdateFromImport, resetToDefaults: billResetToDefaults } = useBillDetailStore();
  const [billImportMsg, setBillImportMsg] = useState<string>('');
  const billFileRef = useRef<HTMLInputElement>(null);
  const [billDragOver, setBillDragOver] = useState(false);
  const importBillFromFile = async (file: File) => {
    try {
      const { tagStats, aggregates, expenseItems } = await parseBillFile(file);
      billUpdateFromImport(tagStats, expenseItems);
      const existing = useMonthlyStore.getState().records;
      let updated = 0;
      for (const ym of Object.keys(aggregates)) {
        const a = aggregates[ym];
        const prev = existing.find((r) => r.yearMonth === ym);
        upsert({
          yearMonth: ym,
          income: a.income,
          totalExpense: a.totalExpense,
          periodicLife: a.periodicLife,
          volatileLife: a.volatileLife,
          consumption: a.consumption,
          school: a.school,
          accumulatedProfit: prev?.accumulatedProfit ?? 0,
          investTotal: prev?.investTotal ?? 0,
          investBreakdown: prev?.investBreakdown,
          investBreakdownProfit: prev?.investBreakdownProfit,
          homeDays: prev?.homeDays ?? 0,
          travelDays: prev?.travelDays ?? 0,
          majorExpenses: prev?.majorExpenses ?? [],
        });
        updated += 1;
      }
      setBillImportMsg(`已导入 ${updated} 个月记录 · ${file.name}`);
    } catch (err) {
      setBillImportMsg(`导入失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const handleBillFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await importBillFromFile(file);
    if (billFileRef.current) billFileRef.current.value = '';
  };
  const handleBillDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setBillDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) await importBillFromFile(file);
  };
  const handleBillClear = () => {
    billResetToDefaults();
    setBillImportMsg('已重置为默认数据');
  };
  const handleExportDefaults = () => {
    exportBillDefaults(billTagStats, billExpenseItems);
    setTimeout(() => exportCalendarDefaults(useCalendarStore.getState().tagMap), 600);
    setTimeout(() => exportAppConfig(config), 900);
    setBillImportMsg('已导出 4 个 JSON 文件，请放入 src/data/ 后重新构建');
  };
  const pickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [pickerOpen]);

  // ── History computed ──
  const thisMonth         = currentYearMonth();
  const existingThisMonth = records.find((r) => r.yearMonth === thisMonth);
  const prevMonthRecord   = records.find((r) => r.yearMonth === prevYearMonth(thisMonth));

  // 当前日历所在月的数据（月视图用）
  const existingForYearMonth = records.find((r) => r.yearMonth === yearMonth);
  const prevForYearMonth     = records.find((r) => r.yearMonth === prevYearMonth(yearMonth));
  const years = useMemo(() => {
    const map: Record<string, MonthlyRecord[]> = {};
    for (const r of records) {
      const y = r.yearMonth.slice(0, 4);
      if (!map[y]) map[y] = [];
      map[y].push(r);
    }
    return Object.entries(map).sort((a, b) => b[0].localeCompare(a[0]));
  }, [records]);

  // 快捷跳转面板可选年份：最早记录年 → 当前查看年与今年的较大者
  const yearOptions = useMemo(() => {
    const earliest = records.length
      ? parseInt(records[records.length - 1].yearMonth.slice(0, 4), 10)
      : _now.getFullYear();
    const latest = Math.max(_now.getFullYear(), year);
    return Array.from({ length: latest - earliest + 1 }, (_, i) => earliest + i);
  }, [records, year, _now]);

  const tableHeader = (
    <div style={{ display: 'grid', gridTemplateColumns: '72px 1fr 1fr 1fr', padding: '6px 10px', fontSize: 11, color: C.sub, fontWeight: 500, marginBottom: 4 }}>
      <span>年/月</span>
      <span style={{ textAlign: 'right' }}>收入</span>
      <span style={{ textAlign: 'right' }}>支出</span>
      <span style={{ textAlign: 'right' }}>结余</span>
    </div>
  );

  // 从"年"跳转到"月"并定位到指定月份
  const handleJumpToMonth = (ym: string) => {
    const [y, m] = ym.split('-').map(Number);
    setYear(y);
    setMonth(m - 1);
    setTab('month');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div>
      {/* 页头 + 胶囊切换 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '0 0 16px' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>
          {tab === 'month' ? '日历标记' : '历史记录'}
        </h1>
        <div style={{ display: 'flex', backgroundColor: '#e8eaed', borderRadius: 20, padding: 3, gap: 2 }}>
          {(['month', 'year'] as const).map((t) => {
            const active = tab === t;
            return (
              <button key={t} onClick={() => setTab(t)} style={{
                padding: '5px 14px', borderRadius: 16, border: 'none', cursor: 'pointer',
                fontSize: 13, fontWeight: 600,
                backgroundColor: active ? '#fff' : 'transparent',
                color: active ? C.blue : C.sub,
                boxShadow: active ? '0 1px 3px rgba(0,0,0,0.15)' : 'none',
                transition: 'all 0.15s',
              }}>
                {t === 'month' ? '月' : '年'}
              </button>
            );
          })}
        </div>
      </div>

      {tab === 'month' ? (
        /* ── 统计月：日历标记 ── */
        <>
          {/* 月份导航（sticky） */}
          <div style={{
            position: 'sticky', top: 0, zIndex: 10,
            backgroundColor: '#f0f2f5',
            marginLeft: -16, marginRight: -16,
            paddingLeft: 16, paddingRight: 16,
            paddingTop: 8, paddingBottom: 8,
            marginBottom: 6,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative' }} ref={pickerRef}>
              <button onClick={prevMonth} style={navBtnStyle}>‹</button>
              <button
                onClick={() => setPickerOpen((v) => !v)}
                style={{ fontSize: 16, fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: '4px 10px', borderRadius: 8, color: pickerOpen ? C.blue : '#202124' }}
              >
                {CN_MONTH[month]} {year}
              </button>
              <button onClick={nextMonth} style={navBtnStyle}>›</button>
              {pickerOpen && (
                <div style={{
                  position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)',
                  marginTop: 6, zIndex: 20,
                  backgroundColor: '#fff', borderRadius: 12, padding: 12,
                  boxShadow: '0 4px 16px rgba(0,0,0,0.12)', border: '1px solid #e8eaed',
                  minWidth: 260,
                }}>
                  {/* 年份行 */}
                  <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 8, marginBottom: 8, borderBottom: '1px solid #f1f3f4' }}>
                    {yearOptions.map((y) => {
                      const active = y === year;
                      return (
                        <button
                          key={y}
                          onClick={() => setYear(y)}
                          style={{
                            flexShrink: 0, padding: '4px 10px', borderRadius: 16,
                            border: 'none', cursor: 'pointer', fontSize: 13,
                            backgroundColor: active ? C.blue : '#f1f3f4',
                            color: active ? '#fff' : C.sub,
                            fontWeight: active ? 600 : 400,
                          }}
                        >
                          {y}
                        </button>
                      );
                    })}
                  </div>
                  {/* 月份网格 3×4 */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                    {CN_MONTH.map((name, i) => {
                      const active = i === month;
                      return (
                        <button
                          key={i}
                          onClick={() => { cancelRange(); setMonth(i); setPickerOpen(false); }}
                          style={{
                            padding: '8px 0', borderRadius: 8,
                            border: 'none', cursor: 'pointer', fontSize: 13,
                            backgroundColor: active ? C.blue : '#f8f9fa',
                            color: active ? '#fff' : '#202124',
                            fontWeight: active ? 600 : 400,
                          }}
                        >
                          {name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Tag 选择器 */}
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, marginBottom: 8, alignItems: 'center' }}>
            {tagOrder.map((t, i) => {
              const meta    = tagMeta[t];
              const active  = selectedTag === t;
              const dragging = tagDrag.draggingIdx === i;
              const hp      = tagDrag.handleProps(i);
              return (
                <button key={t} ref={(el) => tagDrag.itemRef(el, i)} {...hp}
                  onClick={() => { setSelectedTag(t); cancelRange(); }}
                  style={{ ...hp.style, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4, padding: '6px 14px', borderRadius: 20, fontSize: 13, border: active ? `2px solid ${C.blue}` : `1px solid ${C.border}`, backgroundColor: active ? '#e8f0fe' : '#ffffff', color: active ? C.blue : C.sub, fontWeight: active ? 600 : 400, cursor: 'pointer', opacity: dragging ? 0.5 : 1, transition: 'opacity 0.15s' }}
                >
                  {meta.icon} {meta.label}
                </button>
              );
            })}
          </div>

          {/* 周模板 */}
          <div style={{ marginBottom: 12 }}>
            <button onClick={() => setShowWeekTemplate((v) => !v)}
              style={{ fontSize: 13, color: C.blue, background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 600, marginBottom: showWeekTemplate ? 8 : 0 }}
            >
              {showWeekTemplate ? '▾' : '▸'} 按周模板
            </button>
            {showWeekTemplate && (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 8 }}>
                  {([1,2,3,4,5,6,0] as number[]).map((dow, colIdx) => {
                    const LABELS = ['一','二','三','四','五','六','日'];
                    const tag    = weekdayTags[dow];
                    const meta   = tag ? tagMeta[tag] : null;
                    const isWknd = dow === 0 || dow === 6;
                    return (
                      <button key={dow} onClick={() => cycleWeekday(dow)} style={{ borderRadius: 8, padding: '6px 0', fontSize: 12, border: `1.5px solid ${meta ? meta.color : C.border}`, backgroundColor: meta ? `${meta.color}18` : '#f8f9fa', color: meta ? meta.color : isWknd ? C.weekend : C.sub, fontWeight: meta ? 600 : 400, cursor: 'pointer', textAlign: 'center' }}>
                        <div style={{ fontSize: 10, marginBottom: 2, color: isWknd ? C.weekend : C.sub }}>{LABELS[colIdx]}</div>
                        <div>{meta ? meta.icon : '—'}</div>
                      </button>
                    );
                  })}
                </div>
                <button onClick={applyWeekdayTemplate} style={{ width: '100%', padding: '8px 0', fontSize: 13, fontWeight: 600, color: '#fff', backgroundColor: C.blue, border: 'none', borderRadius: 8, cursor: 'pointer' }}>
                  应用到 {CN_MONTH[month]} 全月
                </button>
              </div>
            )}
          </div>

          {/* 选择模式切换 */}
          <div style={{ display: 'flex', gap: 0, marginBottom: 12, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden', alignSelf: 'flex-start', width: 'fit-content' }}>
            {(['single', 'range'] as const).map((m) => (
              <button key={m} onClick={() => switchMode(m)} style={{ padding: '6px 16px', fontSize: 13, border: 'none', cursor: 'pointer', backgroundColor: selectMode === m ? C.blue : '#fff', color: selectMode === m ? '#fff' : C.sub, fontWeight: selectMode === m ? 600 : 400 }}>
                {m === 'single' ? '单击' : '起止'}
              </button>
            ))}
          </div>

          {selectMode === 'range' && (
            <div style={{ fontSize: 13, color: rangeStart ? C.blue : C.sub, backgroundColor: rangeStart ? '#e8f0fe' : '#f8f9fa', border: `1px solid ${rangeStart ? '#a8c7fa' : C.border}`, borderRadius: 10, padding: '8px 14px', marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{rangeStart ? `已选起点 ${rangeStart}，点击终点日期` : '点击起点日期'}</span>
              {rangeStart && <button onClick={cancelRange} style={{ fontSize: 12, color: C.sub, border: 'none', background: 'none', cursor: 'pointer' }}>✕ 取消</button>}
            </div>
          )}

          {/* 月历 */}
          <Card>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, textAlign: 'center', fontSize: 11, marginBottom: 4, fontWeight: 500 }}>
              {WEEK_HEADERS.map((w, i) => <div key={w} style={{ color: (i === 5 || i === 6) ? C.weekend : C.sub }}>{w}</div>)}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
              {cells.map((cell) => {
                if (cell.day === null) return <div key={cell.key} style={{ aspectRatio: '1' }} />;
                const tag = tagMap[cell.key];
                const isToday    = cell.key === today;
                const weekend    = isWeekend(cell.key);
                const isRangeStart = cell.key === rangeStart;
                const inPreview  = previewRange.has(cell.key);
                const displayTag  = inPreview ? selectedTag : tag;
                const displayMeta = displayTag ? tagMeta[displayTag] : null;
                let borderStyle = 'none';
                if (isToday || isRangeStart) borderStyle = `2px solid ${C.blue}`;
                else if (inPreview) borderStyle = `1.5px dashed ${C.blue}`;
                return (
                  <button key={cell.key}
                    onClick={() => handleCellClick(cell.key)}
                    onMouseEnter={() => { if (selectMode === 'range' && rangeStart) setRangeHover(cell.key); }}
                    style={{ aspectRatio: '1', borderRadius: 10, fontSize: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: borderStyle, backgroundColor: displayMeta ? `${displayMeta.color}20` : weekend ? '#fff0f0' : '#f8f9fa', color: displayMeta ? displayMeta.color : weekend ? C.weekend : '#202124', cursor: 'pointer', fontWeight: 500, transition: 'all 0.1s', outline: 'none' }}
                  >
                    {cell.day}
                    {displayMeta && <span style={{ fontSize: 8, marginTop: 1 }}>{displayMeta.icon}</span>}
                  </button>
                );
              })}
            </div>
          </Card>

          {/* 本月统计 */}
          <Card title="本月统计" subtitle={`${yearMonth} · 已标记 ${stats.tagged}/${stats.total}`}>
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <colgroup>
                <col style={{ width: '20%' }} />
                <col />
                <col style={{ width: '24px' }} />
                <col style={{ width: '68px' }} />
                <col style={{ width: '68px' }} />
              </colgroup>
              <thead>
                <tr>
                  <th />
                  <th />
                  <th />
                  <th style={{ fontSize: 11, fontWeight: 600, textAlign: 'right', paddingBottom: 4 }}>
                    <span style={{ backgroundColor: 'rgba(26,115,232,0.12)', color: C.blue, borderRadius: 6, padding: '2px 6px' }}>生活/天</span>
                  </th>
                  <th style={{ fontSize: 11, fontWeight: 600, textAlign: 'right', paddingBottom: 4, paddingLeft: 6 }}>
                    <span style={{ backgroundColor: 'rgba(124,58,237,0.12)', color: C.purple, borderRadius: 6, padding: '2px 6px' }}>消费/天</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  // 当月实际总支出
                  const totalLife = existingForYearMonth
                    ? (existingForYearMonth.periodicLife + existingForYearMonth.volatileLife) : 0;
                  const totalCons = existingForYearMonth ? existingForYearMonth.consumption : 0;

                  // 用历史回归权重做比例分配：
                  // avgLife[k] = w[k] × (totalLife / Σ days[k]×w[k])
                  // 保证 Σ days[k] × avgLife[k] = totalLife
                  const wLife = historyStats.stateDailyAvg;
                  const wCons = historyStats.stateConsumptionDailyAvg;
                  // 日均计算只用截止今天的天数
                  const denomLife = (['school','intern','home','travel'] as TagKind[])
                    .reduce((s, k) => s + statsToDate[k] * wLife[k], 0);
                  const denomCons = (['school','intern','home','travel'] as TagKind[])
                    .reduce((s, k) => s + statsToDate[k] * wCons[k], 0);

                  return tagOrder.map((t) => {
                  const meta  = tagMeta[t];
                  const count = stats.counts[t];
                  const countToDate = statsToDate[t];
                  const pct   = stats.total > 0 ? (count / stats.total) * 100 : 0;
                  // 比例缩放：各状态日均 × 当月总额 / 加权基数（截止今天）
                  const avgLife = countToDate > 0 && denomLife > 0 ? wLife[t] * totalLife / denomLife : 0;
                  const avgCons = countToDate > 0 && denomCons > 0 ? wCons[t] * totalCons / denomCons : 0;
                  const fmtLife = (v: number) => v > 0
                    ? <span style={{ backgroundColor: 'rgba(26,115,232,0.08)', color: C.blue, borderRadius: 6, padding: '2px 6px', display: 'inline-block' }}>¥{Math.round(v)}</span>
                    : <span style={{ color: '#dadce0' }}>—</span>;
                  const fmtCons = (v: number) => v > 0
                    ? <span style={{ backgroundColor: 'rgba(124,58,237,0.08)', color: C.purple, borderRadius: 6, padding: '2px 6px', display: 'inline-block' }}>¥{Math.round(v)}</span>
                    : <span style={{ color: '#dadce0' }}>—</span>;
                  return (
                    <tr key={t}>
                      <td style={{ padding: '6px 0', color: C.sub }}>{meta.icon} {meta.label}</td>
                      <td style={{ padding: '6px 8px' }}>
                        <div style={{ height: 8, backgroundColor: '#e8eaed', borderRadius: 4, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${pct}%`, backgroundColor: meta.color, borderRadius: 4, transition: 'width 0.3s' }} />
                        </div>
                      </td>
                      <td style={{ padding: '6px 0', textAlign: 'right', fontWeight: 500, fontVariantNumeric: 'tabular-nums', color: C.sub }}>{count}</td>
                      <td style={{ padding: '6px 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>{fmtLife(avgLife)}</td>
                      <td style={{ padding: '6px 0 6px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>{fmtCons(avgCons)}</td>
                    </tr>
                  );
                  });
                })()}
              </tbody>
            </table>
            {(() => {
              const schoolSpend = existingForYearMonth?.school ?? 0;
              const schoolDays = statsToDate.school;
              if (schoolDays > 0 && schoolSpend > 0) {
                const campusDailyAvg = schoolSpend / schoolDays;
                return (
                  <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, padding: '8px 12px', backgroundColor: '#f0f7ff', borderRadius: 10 }}>
                    <span style={{ color: C.sub }}>🍜 校园卡日均</span>
                    <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: C.blue }}>¥{Math.round(campusDailyAvg)}</span>
                  </div>
                );
              }
              return null;
            })()}
            {(() => {
              const source = billTagStats;
              const ts = source[yearMonth];
              if (!ts) return null;
              const totalExpense = existingForYearMonth?.totalExpense ?? 0;
              const eatAvg = ts.eatDrinkCount > 0 ? ts.eatDrinkAmount / ts.eatDrinkCount : 0;
              const redPct = totalExpense > 0 ? (ts.redAmount / totalExpense) * 100 : 0;
              const blackPct = totalExpense > 0 ? (ts.blackAmount / totalExpense) * 100 : 0;
              const rowStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, padding: '6px 12px', borderRadius: 10, marginTop: 6, cursor: 'pointer', userSelect: 'none' };
              const toggle = (key: 'eat' | 'red' | 'black') => setExpandedTag(prev => prev === key ? null : key);
              const caret = (open: boolean) => <span style={{ fontSize: 10, color: C.sub, marginLeft: 4 }}>{open ? '▾' : '▸'}</span>;
              const renderItems = (items: BillItem[]) => (
                <div style={{ margin: '2px 12px 6px', fontSize: 12 }}>
                  {items.map((it, i) => {
                    const info = extractMeaningful(it.tags, it.note);
                    const cat = it.subcategory ? `${it.category}·${it.subcategory}` : it.category;
                    return (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, padding: '4px 0', borderBottom: '1px dashed #eee' }}>
                        <span style={{ color: C.sub, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{it.date.slice(5)}</span> · {cat}
                          {info && <span style={{ color: '#9aa0a6', marginLeft: 6 }}>{info}</span>}
                        </span>
                        <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>¥{formatCurrency(it.amount)}</span>
                      </div>
                    );
                  })}
                </div>
              );
              return (
                <>
                  {ts.eatDrinkCount > 0 && (
                    <>
                      <div style={{ ...rowStyle, backgroundColor: '#fff7ed' }} onClick={() => toggle('eat')}>
                        <span style={{ color: C.sub }}>🍽️ 吃好喝好 <span style={{ fontSize: 11 }}>({ts.eatDrinkCount} 顿)</span>{caret(expandedTag === 'eat')}</span>
                        <span style={{ fontVariantNumeric: 'tabular-nums', color: '#c2410c' }}>
                          ¥{formatCurrency(ts.eatDrinkAmount)} · <span style={{ fontWeight: 600 }}>均 ¥{Math.round(eatAvg)}/顿</span>
                        </span>
                      </div>
                      {expandedTag === 'eat' && renderItems(ts.eatDrinkItems)}
                    </>
                  )}
                  {ts.redAmount > 0 && (
                    <>
                      <div style={{ ...rowStyle, backgroundColor: '#fef2f2' }} onClick={() => toggle('red')}>
                        <span style={{ color: C.sub }}>🔴 红{caret(expandedTag === 'red')}</span>
                        <span style={{ fontVariantNumeric: 'tabular-nums', color: C.red }}>
                          ¥{formatCurrency(ts.redAmount)} · <span style={{ fontWeight: 600 }}>{redPct.toFixed(1)}%</span>
                        </span>
                      </div>
                      {expandedTag === 'red' && renderItems(ts.redItems)}
                    </>
                  )}
                  {ts.blackAmount > 0 && (
                    <>
                      <div style={{ ...rowStyle, backgroundColor: '#f3f4f6' }} onClick={() => toggle('black')}>
                        <span style={{ color: C.sub }}>⚫ 黑{caret(expandedTag === 'black')}</span>
                        <span style={{ fontVariantNumeric: 'tabular-nums', color: '#1f2937' }}>
                          ¥{formatCurrency(ts.blackAmount)} · <span style={{ fontWeight: 600 }}>{blackPct.toFixed(1)}%</span>
                        </span>
                      </div>
                      {expandedTag === 'black' && renderItems(ts.blackItems)}
                    </>
                  )}
                </>
              );
            })()}
            {(() => {
              const items = billExpenseItems[yearMonth];
              if (!items || items.length === 0) return null;
              const total = items.reduce((s, i) => s + i.amount, 0);
              const catMap = new Map<string, BillExpenseItem[]>();
              for (const it of items) {
                const c = it.category || '';
                if (!catMap.has(c)) catMap.set(c, []);
                catMap.get(c)!.push(it);
              }
              const cats = [...catMap.entries()]
                .map(([cat, arr]) => ({ cat, items: arr, total: arr.reduce((s, i) => s + i.amount, 0) }))
                .sort((a, b) => b.total - a.total);
              return (
                <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #e8eaed' }}>
                  <div style={{ fontSize: 12, color: C.sub, marginBottom: 6 }}>分类支出</div>
                  {cats.map((c) => <CategoryRow key={c.cat} cat={c.cat} items={c.items} total={total} />)}
                </div>
              );
            })()}
            {stats.tagged < stats.total && (
              <div style={{ marginTop: 12, fontSize: 13, color: C.orange, backgroundColor: '#fef7e0', border: '1px solid #fdd663', borderRadius: 12, padding: '10px 14px' }}>
                💡 还有 {stats.total - stats.tagged} 天未标记
              </div>
            )}
            <div
              onDragOver={(e) => { e.preventDefault(); if (!billDragOver) setBillDragOver(true); }}
              onDragLeave={(e) => { if (e.currentTarget.contains(e.relatedTarget as Node)) return; setBillDragOver(false); }}
              onDrop={handleBillDrop}
              style={{
                marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                padding: 10, borderRadius: 10,
                border: `1px dashed ${billDragOver ? C.blue : 'transparent'}`,
                backgroundColor: billDragOver ? '#e8f0fe' : 'transparent',
                transition: 'background-color 0.15s, border-color 0.15s',
              }}
            >
              <input
                ref={billFileRef}
                type="file"
                accept=".xls,.xlsx,.csv"
                style={{ display: 'none' }}
                onChange={handleBillFile}
              />
              <button
                onClick={() => billFileRef.current?.click()}
                style={{ fontSize: 12, padding: '6px 12px', borderRadius: 8, border: `1px solid ${C.border}`, backgroundColor: '#fff', color: C.sub, cursor: 'pointer' }}
              >
                📥 导入账单
              </button>
              {billHasOverride && (
                <button
                  onClick={handleBillClear}
                  style={{ fontSize: 12, padding: '6px 10px', borderRadius: 8, border: `1px solid ${C.border}`, backgroundColor: '#fff', color: C.sub, cursor: 'pointer' }}
                >
                  重置
                </button>
              )}
              <button
                onClick={handleExportDefaults}
                style={{ fontSize: 12, padding: '6px 10px', borderRadius: 8, border: `1px solid ${C.border}`, backgroundColor: '#fff', color: C.sub, cursor: 'pointer' }}
              >
                导出为内置数据
              </button>
              <span style={{ fontSize: 11, color: billDragOver ? C.blue : C.sub }}>
                {billDragOver ? '松手导入' : (billImportMsg || (billHasOverride ? '使用导入数据 · 也可拖文件到此' : '使用内置数据 · 也可拖文件到此'))}
              </span>
            </div>
          </Card>

          {/* 月度数据录入（与年视图同步） */}
          <Card
            title={`${yearMonth} 数据`}
            subtitle={existingForYearMonth ? '已有数据，可修改' : '尚未录入'}
          >
            <MonthForm
              key={yearMonth}
              yearMonth={yearMonth}
              existing={existingForYearMonth}
              prevRecord={prevForYearMonth}
              tagCounts={countByTag(yearMonth)}
              onSave={(r) => upsert(r)}
            />
          </Card>

          {/* 信用卡 + 发薪日提醒 */}
          {(showPayWarn || showBillWarn || upcomingPaydays.length > 0) && (
            <div style={{ marginBottom: 16 }}>
              {upcomingPaydays.map((item) => (
                <div key={item.id} style={{ backgroundColor: '#e6f4ea', border: '1px solid #81c995', borderRadius: 12, padding: '12px 16px', fontSize: 13, color: '#0d9488', marginBottom: 8 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>💰 发薪提醒</div>
                  <div>{item.name}：{item.daysToNext === 0 ? '今天发薪' : `还有 ${item.daysToNext} 天`}（每月 {item.payDay} 号，¥{formatCurrency(item.amount)}）</div>
                </div>
              ))}
              {showPayWarn && (
                <div style={{ backgroundColor: '#fce8e6', border: '1px solid #f28b82', borderRadius: 12, padding: '12px 16px', fontSize: 13, color: '#c5221f', marginBottom: 8 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>💳 还款提醒</div>
                  <div>{config.creditPayDate} 号还款，还有 {daysToPayDate} 天</div>
                  <div style={{ marginTop: 4, opacity: 0.85 }}>待还金额 ¥{formatCurrency(current.accounts.credit)}</div>
                </div>
              )}
              {showBillWarn && (
                <div style={{ backgroundColor: '#fef7e0', border: '1px solid #fdd663', borderRadius: 12, padding: '12px 16px', fontSize: 13, color: '#b06000' }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>🧾 出账提醒</div>
                  <div>{config.creditBillDate} 号出账，还有 {daysToBillDate} 天，请确认消费</div>
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        /* ── 统计年：历史明细 ── */
        <>
          {/* 本月录入 */}
          <Card
            title={`${thisMonth} 本月`}
            subtitle={existingThisMonth ? '已有数据，点击修改' : '尚未填写，点击录入'}
          >
            {!formOpen ? (
              <button onClick={() => setFormOpen(true)} style={{ width: '100%', padding: '11px 0', borderRadius: 10, border: `1.5px dashed ${C.blue}`, backgroundColor: '#f0f4ff', color: C.blue, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                {existingThisMonth ? '✏️ 修改本月数据' : '＋ 录入本月数据'}
              </button>
            ) : (
              <>
                <MonthForm
                  yearMonth={thisMonth}
                  existing={existingThisMonth}
                  prevRecord={prevMonthRecord}
                  tagCounts={countByTag(thisMonth)}
                  onSave={(r) => { upsert(r); setFormOpen(false); }}
                />
                <button onClick={() => setFormOpen(false)} style={{ width: '100%', marginTop: 8, padding: '10px 0', borderRadius: 10, border: '1px solid #dadce0', backgroundColor: '#fff', color: C.sub, fontSize: 13, cursor: 'pointer' }}>
                  取消
                </button>
              </>
            )}
          </Card>

          {/* 历史明细（按年展开） */}
          <Card title="历史明细" subtitle="点击年份展开月度">
            {tableHeader}
            {years.map(([yr, recs]) => (
              <YearSection key={yr} year={yr} recs={recs} allRecords={records} onJumpToMonth={handleJumpToMonth} expenseItemsByMonth={billExpenseItems} />
            ))}
          </Card>
        </>
      )}
    </div>
  );
}

const navBtnStyle: React.CSSProperties = {
  width: 36, height: 36, borderRadius: '50%', backgroundColor: '#ffffff',
  border: '1px solid #e0e0e0', color: '#5f6368', fontSize: 18, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};
