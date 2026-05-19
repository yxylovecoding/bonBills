import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Card from '../components/Card';
import StatRow from '../components/StatRow';
import CurrencyDisplay, { formatCurrency } from '../components/CurrencyDisplay';
import { tagMeta, investMeta } from '../data/mockData';
import { aggregateExpenseItems, parseBillFile, assignExpenseIds, type BillItem, type BillExpenseMonth, type BillExpenseItem } from '../utils/importBill';
import { triggerUpload } from '../utils/syncEngine';
import { useBillDetailStore } from '../stores/billDetailStore';
import { useLifePeriodOverrideStore, resolveLifePeriod, type LifePeriod, type OverrideValue, type OverrideDimension } from '../stores/lifePeriodOverrideStore';
import AmountInput from '../components/AmountInput';
import { calcHistoryStats } from '../calculations/history';
import { buildLifePeriodStats, suggestPeriod, isInconsistent, type LifePeriodStatRow } from '../calculations/lifePeriodStats';
import { normalizeConfirmedSelection, useCalendarStore, type ConfirmedExpenseSelection } from '../stores/calendarStore';
import { useConfigStore } from '../stores/configStore';
import { useSnapshotStore } from '../stores/snapshotStore';
import { useMonthlyStore } from '../stores/monthlyStore';
import { usePrefsStore, REVIEWABLE_CATEGORIES, type ReviewableCategory } from '../stores/prefsStore';
import { useDragSort } from '../hooks/useDragSort';
import type { TagKind, MonthlyRecord, MajorExpense, InvestHoldings } from '../models/types';
import { useHolidayYears } from '../utils/holidays';
import { getPayrollScheduleForMonth } from '../utils/payroll';

const C = { blue: '#1a73e8', red: '#ea4335', green: '#0d9488', purple: '#7c3aed', sub: '#5f6368', border: '#e0e0e0', weekend: '#ea4335', orange: '#e8710a' };
const CN_MONTH = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
const WEEK_HEADERS = ['一', '二', '三', '四', '五', '六', '日'];
const HISTORY_GRID_COLUMNS = '64px 1fr 1fr 1fr 88px';

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

function formatSignedCurrency(value: number) {
  return `${value >= 0 ? '+' : '-'}¥${formatCurrency(Math.abs(value))}`;
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

// ── 长/短周期 override 设置弹窗 ────────────────────────────────────
function PeriodChip({
  current,
  suggestion,
  onChange,
  allowIgnore,
}: {
  current: OverrideValue | undefined;
  suggestion: LifePeriod | null;
  onChange: (next: OverrideValue | null) => void;
  allowIgnore?: boolean;
}) {
  const opts: { v: OverrideValue | null; label: string; bg: string; fg: string }[] = [
    { v: null,     label: '默认', bg: '#f1f3f4', fg: '#5f6368' },
    { v: 'short',  label: '短',   bg: '#e8f0fe', fg: '#1a73e8' },
    { v: 'long',   label: '长',   bg: '#fff4e8', fg: '#e8710a' },
  ];
  if (allowIgnore) {
    opts.push({ v: 'ignore', label: '忽略', bg: '#f3e8ff', fg: '#7c3aed' });
  }
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {opts.map((o) => {
        const active = (o.v === null && current === undefined) || current === o.v;
        const isSuggested = current === undefined && (o.v === 'short' || o.v === 'long') && suggestion === o.v;
        return (
          <button
            key={String(o.v)}
            onClick={() => onChange(o.v)}
            style={{
              padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
              border: active ? `1.5px solid ${o.fg}` : (isSuggested ? `1px dashed ${o.fg}` : '1px solid #dadce0'),
              backgroundColor: active ? o.bg : '#fff',
              color: active ? o.fg : (isSuggested ? o.fg : '#5f6368'),
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function PeriodRow({
  row,
  current,
  suggestion,
  inconsistent,
  onChange,
  displayName,
  allowIgnore,
}: {
  row: LifePeriodStatRow;
  current: OverrideValue | undefined;
  suggestion: LifePeriod | null;
  inconsistent: boolean;
  onChange: (next: OverrideValue | null) => void;
  displayName: string;
  allowIgnore?: boolean;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
      padding: '6px 8px', borderRadius: 8, marginBottom: 4,
      border: inconsistent && current === undefined ? '1px solid #f59e0b' : '1px solid transparent',
      backgroundColor: inconsistent && current === undefined ? '#fffbeb' : '#fafbfc',
    }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: '#202124', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {inconsistent && current === undefined && <span title="历史勾选不一致" style={{ color: '#f59e0b', marginRight: 4 }}>⚠️</span>}
          {displayName}
        </div>
        <div style={{ fontSize: 10, color: '#5f6368', marginTop: 1, fontVariantNumeric: 'tabular-nums' }}>
          {row.shortCount > 0 && <span style={{ color: '#1a73e8', marginRight: 8 }}>短×{row.shortCount}</span>}
          {row.longCount > 0 && <span style={{ color: '#e8710a' }}>长×{row.longCount}</span>}
        </div>
      </div>
      <PeriodChip current={current} suggestion={suggestion} onChange={onChange} allowIgnore={allowIgnore} />
    </div>
  );
}

function SettingsModal({
  onClose,
  thresholdInput,
  setThresholdInput,
  showPayrollCutoffMarkers,
  setShowPayrollCutoffMarkers,
  reviewableCategories,
  setReviewableCategories,
  onSave,
  tagMap,
  confirmedExpenses,
  expenseItems,
  overrides,
  setOverride,
}: {
  onClose: () => void;
  thresholdInput: string;
  setThresholdInput: (v: string) => void;
  showPayrollCutoffMarkers: boolean;
  setShowPayrollCutoffMarkers: (v: boolean) => void;
  reviewableCategories: ReviewableCategory[];
  setReviewableCategories: (cats: ReviewableCategory[]) => void;
  onSave: () => void;
  tagMap: Record<string, TagKind>;
  confirmedExpenses: Record<string, { ids: string[]; reviewed: boolean } | string[]>;
  expenseItems: Record<string, BillExpenseMonth>;
  overrides: { categories: Record<string, OverrideValue>; subcategories: Record<string, OverrideValue>; tags: Record<string, OverrideValue> };
  setOverride: (dim: OverrideDimension, name: string, value: OverrideValue | null) => void;
}) {
  const [periodTab, setPeriodTab] = useState<'subcategory' | 'tag'>('subcategory');
  const stats = useMemo(
    () => buildLifePeriodStats(tagMap, confirmedExpenses, expenseItems),
    [tagMap, confirmedExpenses, expenseItems],
  );

  const overrideMap = periodTab === 'subcategory' ? overrides.subcategories : overrides.tags;
  const tabRows = useMemo(() => {
    const rows = periodTab === 'subcategory' ? stats.subcategories : stats.tags;
    return [...rows].sort((a, b) => {
      const aSet = overrideMap[a.name] !== undefined;
      const bSet = overrideMap[b.name] !== undefined;
      if (aSet !== bSet) return aSet ? 1 : -1;
      return (b.shortCount + b.longCount) - (a.shortCount + a.longCount);
    });
  }, [periodTab, stats, overrideMap]);

  const tabBtnStyle = (active: boolean): React.CSSProperties => ({
    flex: 1, padding: '6px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
    border: 'none',
    backgroundColor: active ? '#e8f0fe' : '#f1f3f4',
    color: active ? '#1a73e8' : '#5f6368',
  });

  const overrideCount =
    Object.keys(overrides.subcategories).length +
    Object.keys(overrides.tags).length;

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.3)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={onClose}>
      <div style={{ backgroundColor: '#fff', borderRadius: 16, width: '100%', maxWidth: 380, maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}
        onClick={(e) => e.stopPropagation()}>
        {/* 头部 */}
        <div style={{ padding: '20px 20px 12px' }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>设置</div>
        </div>
        {/* 滚动内容 */}
        <div style={{ overflowY: 'auto', padding: '0 20px', flex: 1 }}>
          {/* 大额阈值 */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: '#5f6368', marginBottom: 6 }}>大额支出筛选门槛（元）</div>
            <input type="number" value={thresholdInput} onChange={(e) => setThresholdInput(e.target.value)}
              style={{ width: '100%', border: '1.5px solid #dadce0', borderRadius: 8, padding: '8px 10px', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
          </div>
          {/* 截标记开关 */}
          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16, cursor: 'pointer' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#202124' }}>显示发薪数据截止日标记</div>
              <div style={{ fontSize: 11, color: '#5f6368', marginTop: 2 }}>仅影响月历上的"截"标记显示，不影响实习工资计算</div>
            </div>
            <input type="checkbox" checked={showPayrollCutoffMarkers} onChange={(e) => setShowPayrollCutoffMarkers(e.target.checked)}
              style={{ width: 16, height: 16, accentColor: '#1a73e8', flexShrink: 0 }} />
          </label>
          {/* 明细模式：勾选时显示哪些类型 */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#202124', marginBottom: 4 }}>明细模式：勾选时显示</div>
            <div style={{ fontSize: 11, color: '#5f6368', marginBottom: 8 }}>仅显示选中标签的账单，便于聚焦勾选</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {REVIEWABLE_CATEGORIES.map((cat) => {
                const checked = reviewableCategories.includes(cat);
                return (
                  <label key={cat} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 8, backgroundColor: checked ? '#e8f0fe' : '#f1f3f4', cursor: 'pointer', fontSize: 12, color: checked ? '#1a73e8' : '#5f6368', fontWeight: 500 }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        if (e.target.checked) setReviewableCategories([...reviewableCategories, cat]);
                        else setReviewableCategories(reviewableCategories.filter((c) => c !== cat));
                      }}
                      style={{ width: 14, height: 14, accentColor: '#1a73e8' }}
                    />
                    {cat}
                  </label>
                );
              })}
            </div>
          </div>
          {/* 长短周期分类 */}
          <div style={{ borderTop: '1px solid #f1f3f4', paddingTop: 14, marginBottom: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#202124', marginBottom: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>长/短周期分类规则</span>
              {overrideCount > 0 && (
                <span style={{ fontSize: 10, fontWeight: 500, color: '#1a73e8', backgroundColor: '#e8f0fe', padding: '2px 6px', borderRadius: 6 }}>
                  已设 {overrideCount}
                </span>
              )}
            </div>
            <div style={{ fontSize: 11, color: '#5f6368', marginBottom: 10 }}>
              命中的账单将自动归为短/长周期生活，不再需要逐条勾选。优先级：子分类 &gt; 标签。标签可设「忽略」表示与长短无关。虚线 = 历史推荐值；⚠️ = 历史勾选不一致。
            </div>
            <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
              <button onClick={() => setPeriodTab('subcategory')} style={tabBtnStyle(periodTab === 'subcategory')}>子分类 ({stats.subcategories.length})</button>
              <button onClick={() => setPeriodTab('tag')} style={tabBtnStyle(periodTab === 'tag')}>标签 ({stats.tags.length})</button>
            </div>
            {tabRows.length === 0 ? (
              <div style={{ fontSize: 11, color: '#9aa0a6', padding: '16px 8px', textAlign: 'center' }}>
                暂无数据。在日历「明细」模式下勾选过的账单会出现在这里。
              </div>
            ) : (
              <div>
                {tabRows.map((row) => {
                  const current = overrideMap[row.name];
                  const sug = suggestPeriod(row);
                  const inc = isInconsistent(row);
                  // displayName：子分类把 "category|subcategory" 美化为 "category · subcategory"
                  const displayName = periodTab === 'subcategory' && row.name.includes('|')
                    ? row.name.split('|').filter(Boolean).join(' · ')
                    : row.name;
                  return (
                    <PeriodRow
                      key={row.name}
                      row={row}
                      current={current}
                      suggestion={sug}
                      inconsistent={inc}
                      displayName={displayName}
                      allowIgnore
                      onChange={(next) => setOverride(periodTab, row.name, next)}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </div>
        {/* 底部按钮 */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '12px 20px 20px', borderTop: '1px solid #f1f3f4' }}>
          <button onClick={onClose}
            style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #dadce0', backgroundColor: '#fff', color: '#5f6368', fontSize: 13, cursor: 'pointer' }}>
            取消
          </button>
          <button onClick={onSave}
            style={{ padding: '8px 16px', borderRadius: 8, border: 'none', backgroundColor: '#1a73e8', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

// ── MonthForm ─────────────────────────────────────────────────────
const MAJOR_EXCLUDED_TAGS = ['红', '黑', '白', '周期生活', '波动生活', '消费', '吃好喝好', '消耗品', 'doing', 'done'];
// 纯「数字 + 单位」的标签（如 500ml、1.5kg、8L）不视为大额支出聚合维度
const QUANTITY_TAG_PATTERN = /^\d+(\.\d+)?\s*(kg|mg|ml|l|g|斤|两|升|毫升)$/i;
function isMajorExcludedTag(tag: string): boolean {
  return MAJOR_EXCLUDED_TAGS.includes(tag) || QUANTITY_TAG_PATTERN.test(tag);
}

type MonthFormProps = {
  yearMonth: string;
  existing?: MonthlyRecord;
  prevRecord?: MonthlyRecord;
  tagCounts: Record<TagKind, number>;
  expenseItems?: BillExpenseMonth;
  onSave: (r: MonthlyRecord) => void;
};

function useMonthForm({ yearMonth, existing, prevRecord, tagCounts, expenseItems, onSave }: MonthFormProps) {
  const [income,       setIncome]       = useState(String(existing?.income        ?? ''));
  const [totalExpense, setTotalExpense]  = useState(String(existing?.totalExpense  ?? ''));
  const [periodicLife, setPeriodicLife]  = useState(String(existing?.periodicLife  ?? ''));
  const [volatileLife, setVolatileLife]  = useState(String(existing?.volatileLife  ?? ''));
  const [consumption,  setConsumption]   = useState(String(existing?.consumption   ?? ''));
  const [school,       setSchool]        = useState(String(existing?.school        ?? ''));
  const [accProfit,    setAccProfit]     = useState(String(existing?.accumulatedProfit ?? ''));

  // 自动保存的跳过标志：声明在同步 effect 之前，便于同步时复位
  const isFirstSave = useRef(true);
  // 记录本组件最近一次写出的核心字段；用来识别"自己 upsert 引发的 existing 反弹"，
  // 区分外部刷新（导入账单 / 跨端同步）所引起的 existing 变化
  const ourLastWrittenRef = useRef<{
    income: number; totalExpense: number; periodicLife: number;
    volatileLife: number; consumption: number; school: number;
  } | null>(null);

  useEffect(() => {
    const our = ourLastWrittenRef.current;
    const isBounceback =
      our !== null
      && our.income        === (existing?.income        ?? 0)
      && our.totalExpense  === (existing?.totalExpense  ?? 0)
      && our.periodicLife  === (existing?.periodicLife  ?? 0)
      && our.volatileLife  === (existing?.volatileLife  ?? 0)
      && our.consumption   === (existing?.consumption   ?? 0)
      && our.school        === (existing?.school        ?? 0);
    // 自己保存后 store 反弹回来：state 已经是最新值，不要再 setState/复位 flag，
    // 否则用户连续输入会被下一次 sync 触发的 isFirstSave 复位吃掉
    if (isBounceback) return;
    setIncome(String(existing?.income ?? ''));
    setTotalExpense(String(existing?.totalExpense ?? ''));
    setPeriodicLife(String(existing?.periodicLife ?? ''));
    setVolatileLife(String(existing?.volatileLife ?? ''));
    setConsumption(String(existing?.consumption ?? ''));
    setSchool(String(existing?.school ?? ''));
    // existing 由外部刷新（导入账单 upsert 等）时，跳过下一次由派生依赖触发的自动保存，
    // 避免在 setState 还未应用的闭包里读到空字符串把 store 清零
    isFirstSave.current = true;
  }, [
    existing?.income,
    existing?.totalExpense,
    existing?.periodicLife,
    existing?.volatileLife,
    existing?.consumption,
    existing?.school,
  ]);

  const homeDays   = tagCounts.home   > 0 ? tagCounts.home   : (existing?.homeDays   ?? 0);
  const travelDays = tagCounts.travel > 0 ? tagCounts.travel : (existing?.travelDays ?? 0);
  const schoolDays = tagCounts.school > 0 ? tagCounts.school : (existing?.schoolDays ?? 0);
  const internDays = tagCounts.intern > 0 ? tagCounts.intern : (existing?.internDays ?? 0);

  const [majorExpensesNote, setMajorExpensesNote] = useState<string>(existing?.majorExpensesNote ?? '');
  const [breakdown, setBreakdown] = useState<Partial<Record<keyof InvestHoldings, string>>>(
    () => Object.fromEntries(INVEST_KEYS.map((k) => [k, String(existing?.investBreakdown?.[k] ?? '')])) as Record<keyof InvestHoldings, string>
  );
  const [breakdownProfit, setBreakdownProfit] = useState<Partial<Record<keyof InvestHoldings, string>>>(
    () => Object.fromEntries(INVEST_KEYS.map((k) => [k, String(existing?.investBreakdownProfit?.[k] ?? '')])) as Record<keyof InvestHoldings, string>
  );
  const [showBreakdown, setShowBreakdown] = useState(true);
  const [usdComponents, setUsdComponents] = useState<Partial<Record<'us' | 'usBond', { cny: string; rate: string; usd: string }>>>(() => {
    const init: Partial<Record<'us' | 'usBond', { cny: string; rate: string; usd: string }>> = {};
    for (const k of ['us', 'usBond'] as const) {
      const c = existing?.investProfitComponents?.[k];
      if (c) init[k] = { cny: String(c.cny), rate: String(c.rate), usd: String(c.usd) };
    }
    return init;
  });
  const [sharedUsdRate, setSharedUsdRate] = useState(() => {
    const rate = existing?.investProfitComponents?.us?.rate ?? existing?.investProfitComponents?.usBond?.rate;
    return rate !== undefined ? String(rate) : '';
  });
  const [profitModalKey, setProfitModalKey] = useState<'us' | 'usBond' | null>(null);
  const { current: snapshotCurrent } = useSnapshotStore();
  const { config } = useConfigStore();
  const mainFieldRefs = useRef<(HTMLInputElement | null)[]>([]);
  const breakdownRefs = useRef<(HTMLInputElement | null)[]>([]);
  const breakdownProfitRefs = useRef<(HTMLInputElement | null)[]>([]);
  const copyHoldingsFromReconcile = () => {
    setBreakdown(
      Object.fromEntries(INVEST_KEYS.map((k) => [k, String(snapshotCurrent.investHoldings[k] ?? 0)])) as Partial<Record<keyof InvestHoldings, string>>,
    );
  };

  const n = (v: string) => parseFloat(v) || 0;
  const nOrNull = (v: string | undefined) => {
    if (v === undefined || v.trim() === '') return null;
    const parsed = parseFloat(v);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const investTotal = INVEST_KEYS.reduce((sum, k) => sum + (parseFloat(breakdown[k] ?? '') || 0), 0);
  const surplus = n(income) - n(totalExpense);
  const investIncome = prevRecord ? n(accProfit) - (prevRecord.accumulatedProfit ?? 0) : null;
  const investMonthly = investIncome !== null && investTotal > 0 ? investIncome / investTotal : null;
  const investAnnual = investMonthly !== null ? investMonthly * 12 : null;
  const getBreakdownMonthlyProfit = (k: keyof InvestHoldings) => {
    const profit = nOrNull(breakdownProfit[k]);
    const prevProfit = prevRecord?.investBreakdownProfit?.[k];
    return profit !== null && prevProfit !== undefined && prevProfit !== null ? profit - prevProfit : null;
  };

  const majorExpenses = useMemo<MajorExpense[]>(() => {
    if (!expenseItems || expenseItems.length === 0) {
      return existing?.majorExpenses ?? [];
    }
    // 按标签聚合：统计每个标签对应的条目集合与总金额
    const tagIndices = new Map<string, Set<number>>();
    for (let i = 0; i < expenseItems.length; i++) {
      const tags = expenseItems[i].tags.split(',').map(t => t.trim()).filter(Boolean);
      for (const tag of tags) {
        if (!tagIndices.has(tag)) tagIndices.set(tag, new Set());
        tagIndices.get(tag)!.add(i);
      }
    }
    const threshold = config.majorExpenseThreshold ?? 500;
    const tagTotals = new Map<string, number>();
    for (const [tag, idxs] of tagIndices) {
      if (isMajorExcludedTag(tag)) continue;
      const total = [...idxs].reduce((s, i) => s + expenseItems[i].amount, 0);
      if (total >= threshold) tagTotals.set(tag, total);
    }
    // 去除子标签：B 的条目集合 ⊊ A 的条目集合（真子集）→ B 被过滤
    // 集合相等时，按 tag 名 tie-break，保留较小者，避免互相过滤导致两边都丢
    const topTags = [...tagTotals.keys()].filter(tag => {
      const myIdxs = tagIndices.get(tag)!;
      return ![...tagTotals.keys()].some(other => {
        if (other === tag) return false;
        const otherIdxs = tagIndices.get(other)!;
        if (otherIdxs.size < myIdxs.size) return false;
        const contained = [...myIdxs].every(i => otherIdxs.has(i));
        if (!contained) return false;
        if (otherIdxs.size > myIdxs.size) return true; // 真子集
        return other < tag; // 集合相等，名字小的保留
      });
    });
    topTags.sort((a, b) => tagTotals.get(b)! - tagTotals.get(a)!);
    return topTags.map(tag => {
      let lifeAmt = 0, consumeAmt = 0;
      for (const i of tagIndices.get(tag)!) {
        const item = expenseItems[i];
        const itemTags = item.tags.split(',').map(t => t.trim());
        if (itemTags.includes('消费')) consumeAmt += item.amount;
        if (itemTags.includes('波动生活') || itemTags.includes('周期生活')) lifeAmt += item.amount;
      }
      const type: '生活' | '消费' = consumeAmt > lifeAmt ? '消费' : '生活';
      return { type, name: tag, amount: Math.round(tagTotals.get(tag)! * 100) / 100 };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenseItems, config.majorExpenseThreshold]);

  const buildProfitComponents = (): MonthlyRecord['investProfitComponents'] => {
    const out: NonNullable<MonthlyRecord['investProfitComponents']> = {};
    for (const k of ['us', 'usBond'] as const) {
      const c = usdComponents[k];
      if (!c) continue;
      const cny = parseFloat(c.cny);
      const rate = parseFloat(sharedUsdRate);
      const usd = parseFloat(c.usd);
      if (isNaN(cny) || isNaN(rate) || isNaN(usd)) continue;
      out[k] = { cny, rate, usd };
    }
    return Object.keys(out).length ? out : undefined;
  };

  const handleSave = () => {
    const bd = Object.fromEntries(INVEST_KEYS.map((k) => [k, parseFloat(breakdown[k] ?? '') || 0])) as unknown as InvestHoldings;
    const hasBreakdown = INVEST_KEYS.some((k) => (bd[k] || 0) > 0);
    const bp = Object.fromEntries(INVEST_KEYS.map((k) => [k, parseFloat(breakdownProfit[k] ?? '') || 0])) as unknown as InvestHoldings;
    const hasBreakdownProfit = INVEST_KEYS.some((k) => (bp[k] || 0) !== 0);
    const incomeNum       = n(income);
    const totalExpenseNum = n(totalExpense);
    const periodicLifeNum = n(periodicLife);
    const volatileLifeNum = n(volatileLife);
    const consumptionNum  = n(consumption);
    const schoolNum       = n(school);
    // 记录本次写出的核心字段，便于 sync effect 识别 store 反弹（避免误复位 isFirstSave）
    ourLastWrittenRef.current = {
      income: incomeNum, totalExpense: totalExpenseNum,
      periodicLife: periodicLifeNum, volatileLife: volatileLifeNum,
      consumption: consumptionNum, school: schoolNum,
    };
    onSave({
      yearMonth, income: incomeNum, totalExpense: totalExpenseNum,
      periodicLife: periodicLifeNum, volatileLife: volatileLifeNum,
      consumption: consumptionNum, school: schoolNum,
      accumulatedProfit: n(accProfit), investTotal,
      investBreakdown: hasBreakdown ? bd : undefined,
      investBreakdownProfit: hasBreakdownProfit ? bp : undefined,
      investProfitComponents: buildProfitComponents(),
      homeDays, travelDays, schoolDays, internDays,
      majorExpenses: majorExpenses.filter((e) => e.name.trim()),
      majorExpensesNote: majorExpensesNote.trim() || undefined,
    });
  };

  // 自动保存：任何字段变化都立即写回 store（首次渲染、或 existing 被外部刷新后的同步轮跳过）
  useEffect(() => {
    if (isFirstSave.current) { isFirstSave.current = false; return; }
    handleSave();
  }, [income, totalExpense, periodicLife, volatileLife, consumption, school, accProfit, majorExpenses, majorExpensesNote, breakdown, breakdownProfit, usdComponents, sharedUsdRate]); // eslint-disable-line react-hooks/exhaustive-deps

  const fieldStyle: React.CSSProperties = {
    width: '100%', border: '1.5px solid #fbbf24', borderRadius: 8,
    padding: '8px 10px', fontSize: 13, fontVariantNumeric: 'tabular-nums',
    outline: 'none', backgroundColor: '#fffbeb', boxSizing: 'border-box',
  };
  const labelStyle: React.CSSProperties = { fontSize: 12, color: C.sub, marginBottom: 3, fontWeight: 500 };

  return {
    income, setIncome, totalExpense, setTotalExpense, periodicLife, setPeriodicLife,
    volatileLife, setVolatileLife, consumption, setConsumption, school, setSchool,
    accProfit, setAccProfit, investTotal,
    majorExpenses, majorExpensesNote, setMajorExpensesNote, breakdown, setBreakdown, breakdownProfit, setBreakdownProfit,
    usdComponents, setUsdComponents, sharedUsdRate, setSharedUsdRate, profitModalKey, setProfitModalKey,
    showBreakdown, setShowBreakdown,
    surplus, investIncome, investMonthly, investAnnual, n,
    getBreakdownMonthlyProfit,
    mainFieldRefs, breakdownRefs, breakdownProfitRefs,
    copyHoldingsFromReconcile,
    handleSave,
    fieldStyle, labelStyle,
  };
}

type MonthFormState = ReturnType<typeof useMonthForm>;

function MonthDataSection({ state }: { state: MonthFormState }) {
  const {
    income, totalExpense, periodicLife, volatileLife, consumption, school,
    accProfit, setAccProfit, investTotal,
    surplus, investIncome, investMonthly, investAnnual, n,
    mainFieldRefs, breakdownRefs, labelStyle,
  } = state;
  return (
    <>
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
        <div style={{ flex: 1, minWidth: 100, backgroundColor: '#fffbeb', borderRadius: 10, padding: '10px 14px' }}>
          <div style={{ fontSize: 11, color: C.sub }}>累计盈利</div>
          <AmountInput
            ref={(el) => { mainFieldRefs.current[0] = el; }}
            value={accProfit}
            onChange={setAccProfit}
            placeholder="0.00"
            style={{ width: '100%', border: 'none', borderBottom: '1.5px solid #fbbf24', borderRadius: 0, padding: '2px 0', fontSize: 16, fontWeight: 700, fontVariantNumeric: 'tabular-nums', outline: 'none', backgroundColor: 'transparent', boxSizing: 'border-box', color: '#202124' }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setTimeout(() => breakdownRefs.current[0]?.focus(), 0); } }}
          />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
        {([
          { label: '总收入',     val: income,       kind: 'auto' as const },
          { label: '总支出',     val: totalExpense, kind: 'auto' as const },
          { label: '周期生活',   val: periodicLife, kind: 'auto' as const, theme: 'green' as const },
          { label: '波动生活',   val: volatileLife, kind: 'auto' as const, theme: 'green' as const },
          { label: '消费（交行）', val: consumption,  kind: 'auto' as const, theme: 'purple' as const },
          { label: '校园卡支出', val: school,       kind: 'auto' as const },
          { label: '理财总额',   val: String(investTotal || ''), kind: 'sum'  as const },
        ]).map(({ label, val, kind, theme }) => {
          const bg = theme === 'green' ? '#e6f4ea' : theme === 'purple' ? '#f3e8ff' : '#f1f3f4';
          const fg = theme === 'green' ? C.green : theme === 'purple' ? C.purple : '#3c4043';
          return (
            <div key={label}>
              <div style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 4 }}>
                {label}
                {kind === 'auto' && <span style={{ fontSize: 10, color: C.sub }}>（账单自动）</span>}
                {kind === 'sum' && <span style={{ fontSize: 10, color: C.sub }}>（持仓求和）</span>}
              </div>
              <div style={{ padding: '8px 10px', fontSize: 13, fontVariantNumeric: 'tabular-nums', borderRadius: 8, backgroundColor: bg, color: fg, minHeight: 20 }}>
                {val ? formatCurrency(n(val)) : '—'}
              </div>
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
    </>
  );
}

function UsdProfitModal({
  investKey,
  initial,
  sharedRate,
  onCancel,
  onConfirm,
}: {
  investKey: 'us' | 'usBond';
  initial?: { cny: string; rate: string; usd: string };
  sharedRate: string;
  onCancel: () => void;
  onConfirm: (c: { cny: string; rate: string; usd: string }) => void;
}) {
  const [cny, setCny] = useState(initial?.cny ?? '');
  const [rate, setRate] = useState(sharedRate || initial?.rate || '');
  const [usd, setUsd] = useState(initial?.usd ?? '');
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const total = (parseFloat(cny) || 0) + (parseFloat(rate) || 0) * (parseFloat(usd) || 0);
  const totalRounded = Math.round(total * 100) / 100;
  const focusNext = (i: number) => setTimeout(() => refs.current[i + 1]?.focus(), 0);
  const inputStyle: React.CSSProperties = {
    width: '100%', border: '1.5px solid #fbbf24', borderRadius: 8,
    padding: '8px 10px', fontSize: 13, fontVariantNumeric: 'tabular-nums',
    outline: 'none', backgroundColor: '#fffbeb', boxSizing: 'border-box',
  };
  return (
    <div
      onClick={onCancel}
      style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 360, backgroundColor: '#fff', borderRadius: 12, padding: 16, boxShadow: '0 4px 24px rgba(0,0,0,0.18)' }}
      >
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>{investMeta[investKey].label} 累计收益拆分</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            { label: '人民币收益 (¥)', val: cny, set: setCny },
            { label: '美元汇率（美股/美债共用）', val: rate, set: setRate },
            { label: '美元收益 ($)',   val: usd, set: setUsd },
          ].map(({ label, val, set }, i, arr) => (
            <div key={label}>
              <div style={{ fontSize: 12, color: C.sub, marginBottom: 3 }}>{label}</div>
              <AmountInput
                ref={(el) => { refs.current[i] = el; }}
                value={val}
                onChange={set}
                placeholder="0"
                style={inputStyle}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (i < arr.length - 1) focusNext(i);
                    else onConfirm({ cny, rate, usd });
                  }
                }}
              />
            </div>
          ))}
        </div>
        <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 8, backgroundColor: '#f1f3f4', display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
          <span style={{ color: C.sub }}>累计收益 = 人民币 + 汇率 × 美元</span>
          <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: totalRounded >= 0 ? C.red : C.green }}>{totalRounded >= 0 ? '+' : ''}{formatCurrency(totalRounded)}</span>
        </div>
        <div style={{ marginTop: 14, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #dadce0', backgroundColor: '#fff', cursor: 'pointer', fontSize: 13 }}>取消</button>
          <button onClick={() => onConfirm({ cny, rate, usd })} style={{ padding: '6px 14px', borderRadius: 8, border: 'none', backgroundColor: C.blue, color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>确认</button>
        </div>
      </div>
    </div>
  );
}

function HoldingsSection({ state }: { state: MonthFormState }) {
  const {
    showBreakdown, setShowBreakdown, copyHoldingsFromReconcile,
    breakdown, setBreakdown, breakdownProfit, setBreakdownProfit,
    getBreakdownMonthlyProfit,
    breakdownRefs, breakdownProfitRefs,
    usdComponents, profitModalKey, setProfitModalKey,
    sharedUsdRate, setSharedUsdRate,
  } = state;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginBottom: 4 }}>
        {showBreakdown && (
          <button
            onClick={copyHoldingsFromReconcile}
            style={{ fontSize: 11, color: C.blue, border: `1px solid ${C.blue}`, borderRadius: 6, padding: '3px 8px', backgroundColor: '#fff', cursor: 'pointer', whiteSpace: 'nowrap' }}
            title="从对账页当前持仓复制到本月各品类持仓"
          >
            📋 从对账页复制
          </button>
        )}
        <button
          onClick={() => setShowBreakdown((v) => !v)}
          style={{ fontSize: 12, color: C.sub, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}
          title={showBreakdown ? '收起' : '展开'}
        >
          {showBreakdown ? '▲' : '▼'}
        </button>
      </div>
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
            {INVEST_KEYS.map((k, i) => {
              const monthlyProfit = getBreakdownMonthlyProfit(k);
              return (
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
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return;
                        e.preventDefault();
                        if (i < INVEST_KEYS.length - 1) breakdownRefs.current[i + 1]?.focus();
                        else breakdownProfitRefs.current[0]?.focus();
                      }}
                      style={{ width: '90%', border: 'none', borderBottom: '1px solid #fbbf24', outline: 'none', backgroundColor: 'transparent', fontSize: 12, fontVariantNumeric: 'tabular-nums', textAlign: 'right', padding: '2px 0' }}
                    />
                  </td>
                  <td style={{ padding: '4px 0', textAlign: 'right' }}>
                    {(k === 'us' || k === 'usBond') ? (
                      <button
                        type="button"
                        onClick={() => setProfitModalKey(k)}
                        style={{ width: '90%', border: 'none', borderBottom: `1px dashed ${C.blue}`, background: 'transparent', cursor: 'pointer', fontSize: 12, fontVariantNumeric: 'tabular-nums', textAlign: 'right', padding: '2px 0', color: C.blue }}
                        title="点击拆分为人民币 + 汇率 × 美元"
                      >
                        {breakdownProfit[k] && breakdownProfit[k] !== '0' && breakdownProfit[k] !== '' ? breakdownProfit[k] : '—'}
                      </button>
                    ) : (
                      <AmountInput
                        ref={(el) => { breakdownProfitRefs.current[i] = el; }}
                        value={breakdownProfit[k] ?? ''} placeholder="0"
                        onChange={(v) => setBreakdownProfit((p) => ({ ...p, [k]: v }))}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter') return;
                          e.preventDefault();
                          if (i < INVEST_KEYS.length - 1) breakdownProfitRefs.current[i + 1]?.focus();
                          else e.currentTarget.blur();
                        }}
                        style={{ width: '90%', border: 'none', borderBottom: `1px solid ${C.blue}`, outline: 'none', backgroundColor: 'transparent', fontSize: 12, fontVariantNumeric: 'tabular-nums', textAlign: 'right', padding: '2px 0', color: C.blue }}
                      />
                    )}
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
      {profitModalKey && (
        <UsdProfitModal
          investKey={profitModalKey}
          initial={usdComponents[profitModalKey] ? { ...usdComponents[profitModalKey], rate: sharedUsdRate } : { cny: '', rate: sharedUsdRate, usd: '' }}
          sharedRate={sharedUsdRate}
          onCancel={() => setProfitModalKey(null)}
          onConfirm={(c) => {
            const nextComponents = { ...usdComponents, [profitModalKey]: c };
            setSharedUsdRate(c.rate);
            const rate = parseFloat(c.rate) || 0;
            state.setUsdComponents(nextComponents);
            setBreakdownProfit((p) => {
              const next = { ...p };
              for (const k of ['us', 'usBond'] as const) {
                const item = nextComponents[k];
                if (!item) continue;
                const cny = parseFloat(item.cny) || 0;
                const usd = parseFloat(item.usd) || 0;
                const total = Math.round((cny + rate * usd) * 100) / 100;
                next[k] = String(total);
              }
              return next;
            });
            setProfitModalKey(null);
          }}
        />
      )}
    </div>
  );
}

function MajorExpensesSection({ state }: { state: MonthFormState }) {
  const { majorExpenses, majorExpensesNote, setMajorExpensesNote, fieldStyle } = state;
  return (
    <div style={{ marginBottom: 12 }}>
      {(() => {
        const amounts = majorExpenses.map((x) => x.amount || 0);
        const maxAmt = Math.max(0, ...amounts);
        const minAmt = Math.min(...amounts.filter((a) => a > 0), maxAmt);
        return majorExpenses.map((e, i) => {
        const amt = e.amount || 0;
        const hasRange = maxAmt > minAmt && amt > 0;
        const ratio = hasRange ? (amt - minAmt) / (maxAmt - minAmt) : (amt > 0 ? 1 : 0);
        const hue = 120 - ratio * 120;
        const amtBg = amt > 0 ? `hsl(${hue}, 72%, 92%)` : '#fffbeb';
        const amtBorder = amt > 0 ? `hsl(${hue}, 65%, 55%)` : '#fbbf24';
        const amtColor = amt > 0 ? `hsl(${hue}, 70%, 30%)` : '#202124';
        const typeColor = e.type === '生活' ? C.blue : C.purple;
        return (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '46px 1fr 76px', gap: 5, marginBottom: 6, alignItems: 'center' }}>
          <span style={{ border: `1.5px solid ${typeColor}`, borderRadius: 6, padding: '6px 2px', fontSize: 11, color: typeColor, fontWeight: 600, backgroundColor: `${typeColor}12`, textAlign: 'center' }}>{e.type}</span>
          <span style={{ fontSize: 13, padding: '6px 8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</span>
          <span style={{ ...fieldStyle, padding: '6px 8px', backgroundColor: amtBg, borderColor: amtBorder, color: amtColor, fontWeight: 600, textAlign: 'right', display: 'block' }}>{amt ? Math.round(amt) : ''}</span>
        </div>
        );
        });
      })()}
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
  );
}

function MonthForm(props: MonthFormProps) {
  const state = useMonthForm(props);
  return (
    <div>
      <MonthDataSection state={state} />
      <HoldingsSection state={state} />
      <MajorExpensesSection state={state} />
    </div>
  );
}

function MonthFormCards(props: MonthFormProps & { subtitle?: string }) {
  const state = useMonthForm(props);
  const majorTotal = state.majorExpenses.reduce((s, e) => s + Math.round(e.amount || 0), 0);
  const lifeTotal = state.majorExpenses.reduce((s, e) => s + (e.type === '生活' ? Math.round(e.amount || 0) : 0), 0);
  const consumeTotal = state.majorExpenses.reduce((s, e) => s + (e.type === '消费' ? Math.round(e.amount || 0) : 0), 0);
  const fmtK = (v: number) => {
    const k = Math.round(v / 100) / 10;
    return `${Number.isInteger(k) ? k.toFixed(0) : k.toFixed(1)}k`;
  };
  const majorSubtitle = majorTotal > 0
    ? `¥${fmtK(majorTotal)} (生活${fmtK(lifeTotal)}, 消费${fmtK(consumeTotal)})`
    : undefined;
  return (
    <>
      <Card title={`${props.yearMonth} 数据`} subtitle={props.subtitle}>
        <MonthDataSection state={state} />
      </Card>
      <Card title="大额支出" subtitle={majorSubtitle}>
        <MajorExpensesSection state={state} />
      </Card>
      <Card title="理财各品类持仓 & 累计收益">
        <HoldingsSection state={state} />
      </Card>
    </>
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

function PendingManualPanel({ entries, onSetPeriod, onClose }: {
  entries: { date: string; id: string; item: BillExpenseItem }[];
  onSetPeriod: (date: string, id: string, period: LifePeriod) => void;
  onClose: () => void;
}) {
  const total = entries.reduce((s, e) => s + e.item.amount, 0);
  const grouped = useMemo(() => {
    const map = new Map<string, { date: string; id: string; item: BillExpenseItem }[]>();
    for (const e of entries) {
      const arr = map.get(e.date) ?? [];
      arr.push(e);
      map.set(e.date, arr);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [entries]);
  return (
    <Card
      title="待手动分类"
      subtitle={entries.length === 0
        ? '本月没有未规则覆盖的待分类账单'
        : `共 ${entries.length} 条 · ¥${formatCurrency(total)}`}
    >
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <button
          onClick={onClose}
          style={{ fontSize: 12, color: C.sub, border: 'none', background: 'none', cursor: 'pointer' }}
        >✕ 收起</button>
      </div>
      {entries.length === 0 ? (
        <div style={{ fontSize: 13, color: C.sub, textAlign: 'center', padding: '12px 0' }}>
          全部账单都已被「长/短周期分类规则」覆盖，或已手动确认过。
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {grouped.map(([date, rows]) => {
            const daySum = rows.reduce((s, r) => s + r.item.amount, 0);
            return (
              <div key={date}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 12, color: C.sub, marginBottom: 4 }}>
                  <span style={{ fontWeight: 600, color: '#202124' }}>{date}</span>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>{rows.length} 条 · ¥{formatCurrency(daySum)}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {rows.map(({ date: d, id, item }) => (
                    <div
                      key={`${d}|${id}`}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8,
                        backgroundColor: '#fffaf0', border: '1px solid #fdba74', fontSize: 13,
                      }}
                    >
                      <div style={{ display: 'inline-flex', borderRadius: 6, border: `1px solid ${C.border}`, overflow: 'hidden', flexShrink: 0 }}>
                        {(['short', 'long'] as const).map((p) => {
                          const activeBg = p === 'short' ? C.blue : C.orange;
                          return (
                            <button
                              key={p}
                              type="button"
                              onClick={() => onSetPeriod(d, id, p)}
                              style={{
                                padding: '3px 10px', fontSize: 11, fontWeight: 600, lineHeight: 1.3,
                                border: 'none', borderLeft: p === 'long' ? `1px solid ${C.border}` : 'none',
                                backgroundColor: '#fff', color: activeBg, cursor: 'pointer',
                              }}
                            >{p === 'short' ? '短' : '长'}</button>
                          );
                        })}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 500, color: '#202124', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.note || item.subcategory || item.category || '—'}
                        </div>
                        <div style={{ fontSize: 11, color: C.sub, marginTop: 2 }}>
                          {item.category}{item.subcategory ? ` · ${item.subcategory}` : ''}{item.tags ? ` · ${item.tags}` : ''}
                        </div>
                      </div>
                      <span style={{ fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: '#202124', flexShrink: 0 }}>¥{formatCurrency(item.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function DayDetailPanel({ date, items, selection, onSetPeriod, onMarkZero, onClear, resolveOverride }: {
  date: string;
  items: BillExpenseItem[];
  selection: ConfirmedExpenseSelection;
  onSetPeriod: (id: string, period: LifePeriod) => void;
  onMarkZero: () => void;
  onClear: () => void;
  resolveOverride: (item: BillExpenseItem) => LifePeriod | null;
}) {
  const isReviewed = selection.reviewed;
  const hasExplicitLong = selection.longIds !== undefined;
  const withIds = useMemo(() => assignExpenseIds(items), [items]);
  const shortSet = useMemo(() => new Set(selection.ids), [selection.ids]);
  const longSet = useMemo(() => new Set(selection.longIds ?? []), [selection.longIds]);
  const rows = withIds.map(({ item, id }) => {
    const auto = resolveOverride(item);
    let manualPeriod: LifePeriod | null = null;
    if (!auto) {
      if (shortSet.has(id)) manualPeriod = 'short';
      else if (longSet.has(id)) manualPeriod = 'long';
      else if (isReviewed && !hasExplicitLong) manualPeriod = 'long'; // 旧数据兜底
    }
    const period: LifePeriod | null = auto ?? manualPeriod;
    const checked = period === 'short';
    return { item, id, auto, manualPeriod, period, checked, needsManual: auto === null && manualPeriod === null };
  });
  const manualRows = rows.filter((row) => row.auto === null);
  const pendingRows = rows.filter((row) => row.needsManual);
  const autoRows = rows.filter((row) => row.auto !== null);
  const displayRows = [...manualRows, ...autoRows];
  const manualTotal = pendingRows.reduce((s, row) => s + row.item.amount, 0);
  const confirmedSum = rows.reduce((s, row) => s + (row.checked ? row.item.amount : 0), 0);
  const effectiveCount = rows.reduce((c, row) => c + (row.checked ? 1 : 0), 0);
  const totalSum = items.reduce((s, i) => s + i.amount, 0);
  const isZeroSpend = isReviewed && effectiveCount === 0;
  if (withIds.length === 0) {
    return (
      <Card title={`${date} 当日账单`} subtitle={isZeroSpend ? '已确认当天 0 支出' : '当天无账单数据'}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 13, color: C.sub, textAlign: 'center', paddingTop: 6 }}>
            {isZeroSpend ? '这一天已记为 0 支出' : '当天无账单数据'}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onMarkZero}
              style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: `1px solid ${isZeroSpend ? C.green : C.blue}`, backgroundColor: isZeroSpend ? '#e6f4ea' : '#fff', color: isZeroSpend ? C.green : C.blue, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >
              记为 0 支出
            </button>
            {isReviewed && (
              <button
                onClick={onClear}
                style={{ padding: '9px 14px', borderRadius: 8, border: `1px solid ${C.border}`, backgroundColor: '#fff', color: C.sub, fontSize: 13, cursor: 'pointer' }}
              >
                重置
              </button>
            )}
          </div>
        </div>
      </Card>
    );
  }
  return (
    <Card
      title={`${date} 当日账单`}
      subtitle={isZeroSpend
        ? `已确认 0/${withIds.length} 条 · 当天 0 支出`
        : `已勾 ${effectiveCount}/${withIds.length} 条 · ¥${formatCurrency(confirmedSum)}/¥${formatCurrency(totalSum)}`}
    >
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <button
          onClick={onMarkZero}
          style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: `1px solid ${isZeroSpend ? C.green : C.blue}`, backgroundColor: isZeroSpend ? '#e6f4ea' : '#fff', color: isZeroSpend ? C.green : C.blue, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
        >
          记为 0 支出
        </button>
        {isReviewed && (
          <button
            onClick={onClear}
            style={{ padding: '9px 14px', borderRadius: 8, border: `1px solid ${C.border}`, backgroundColor: '#fff', color: C.sub, fontSize: 13, cursor: 'pointer' }}
          >
            重置
          </button>
        )}
      </div>
      {pendingRows.length > 0 && (
        <div style={{
          marginBottom: 10,
          padding: '8px 10px',
          borderRadius: 8,
          border: '1px solid #fed7aa',
          backgroundColor: '#fff7ed',
          color: C.orange,
          fontSize: 12,
          lineHeight: 1.5,
        }}>
          {`这天还有 ${pendingRows.length} 条账单没被规则覆盖，请手动分类。`}
          <span style={{ marginLeft: 6, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
            ¥{formatCurrency(manualTotal)}
          </span>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {displayRows.map(({ item, id, auto, manualPeriod, period, needsManual }) => {
          const bg = period === 'short' ? '#e8f0fe' : period === 'long' ? '#fff4e8' : (isReviewed ? '#f8f9fa' : '#fffaf0');
          const isManualRow = auto === null;
          return (
            <div
              key={id}
              title={auto ? '已被「长/短周期分类规则」覆盖，去设置修改' : (needsManual ? '这条账单没被规则覆盖，需要你手动分类' : '已手动分类，可点击切换')}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8,
                backgroundColor: bg, cursor: auto ? 'not-allowed' : 'default', fontSize: 13,
                opacity: auto === 'long' ? 0.7 : 1,
                border: needsManual ? '1px solid #fdba74' : '1px solid transparent',
              }}
            >
              {isManualRow ? (
                <div style={{ display: 'inline-flex', borderRadius: 6, border: `1px solid ${C.border}`, overflow: 'hidden', flexShrink: 0 }}>
                  {(['short', 'long'] as const).map((p) => {
                    const active = manualPeriod === p;
                    const activeBg = p === 'short' ? C.blue : C.orange;
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => onSetPeriod(id, p)}
                        style={{
                          padding: '3px 8px', fontSize: 11, fontWeight: 600, lineHeight: 1.3,
                          border: 'none', borderLeft: p === 'long' ? `1px solid ${C.border}` : 'none',
                          backgroundColor: active ? activeBg : '#fff',
                          color: active ? '#fff' : C.sub, cursor: 'pointer',
                        }}
                      >
                        {p === 'short' ? '短' : '长'}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <span style={{
                  width: 22, height: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: 4, fontSize: 10, fontWeight: 700, flexShrink: 0,
                  backgroundColor: auto === 'short' ? C.blue : C.orange, color: '#fff',
                }}>{auto === 'short' ? '短' : '长'}</span>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, color: '#202124', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.note || item.subcategory || item.category || '—'}
                </div>
                <div style={{ fontSize: 11, color: C.sub, marginTop: 2 }}>
                  {item.category}{item.subcategory ? ` · ${item.subcategory}` : ''}{item.tags ? ` · ${item.tags}` : ''}
                  {auto && (
                    <span style={{
                      marginLeft: 6, padding: '1px 5px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                      backgroundColor: auto === 'short' ? '#1a73e8' : '#e8710a', color: '#fff',
                    }}>📌 自动归{auto === 'short' ? '短' : '长'}</span>
                  )}
                  {!auto && (
                    <span style={{
                      marginLeft: 6, padding: '1px 5px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                      backgroundColor: manualPeriod ? '#f1f3f4' : '#fff7ed',
                      color: manualPeriod ? C.sub : C.orange,
                      border: manualPeriod ? '1px solid #dadce0' : '1px solid #fdba74',
                    }}>{manualPeriod ? '手动项' : '待手动分类'}</span>
                  )}
                </div>
              </div>
              <span style={{ fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: period === 'short' ? C.blue : period === 'long' ? C.orange : '#202124', flexShrink: 0 }}>¥{formatCurrency(item.amount)}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function CategoryBreakdown({ items }: { items: BillExpenseItem[] }) {
  const [open, setOpen] = useState(false);
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
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 12, color: C.sub, marginBottom: open ? 6 : 0 }}
      >
        <span>分类支出</span>
        <span>{open ? '▲' : '▼'}</span>
      </button>
      {open && cats.map((c) => <CategoryRow key={c.cat} cat={c.cat} items={c.items} total={total} />)}
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
  const investIncome = prev ? record.accumulatedProfit - (prev.accumulatedProfit ?? 0) : null;
  const investMonthly = investIncome !== null && record.investTotal > 0 ? investIncome / record.investTotal : null;

  return (
    <div style={{ marginBottom: 4 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%', display: 'grid', gridTemplateColumns: HISTORY_GRID_COLUMNS,
          alignItems: 'center', padding: '12px 10px', borderRadius: 10, border: 'none',
          backgroundColor: open ? '#e8f0fe' : '#fafafa', cursor: 'pointer',
          textAlign: 'left', transition: 'background-color 0.15s',
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: open ? C.blue : '#202124' }}>
          {record.yearMonth.slice(2)}
          {expenseMismatch && <span title={`三项之和 ${formatCurrency(expenseSum)} ≠ 总支出 ${formatCurrency(record.totalExpense)}`} style={{ marginLeft: 4, color: '#c5221f' }}>⚠️</span>}
        </span>
        <span style={{ fontSize: 13, color: C.red,   fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>+{formatCurrency(record.income)}</span>
        <span style={{ fontSize: 13, color: C.green,  fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>-{formatCurrency(record.totalExpense)}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: surplus >= 0 ? C.red : C.green, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>
          {surplus >= 0 ? '+' : '-'}{formatCurrency(Math.abs(surplus))}
        </span>
        <span style={{ fontSize: 12, color: investMonthly !== null ? (investMonthly >= 0 ? C.red : C.green) : C.sub, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>
          {investMonthly !== null ? `${(investMonthly * 100).toFixed(2)}%` : '—'}
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
                {investMonthly !== null && <StatRow label="月收益率" value={<span style={{ color: investMonthly >= 0 ? C.red : C.green, fontWeight: 500 }}>{(investMonthly * 100).toFixed(2)}%</span>} />}
              </div>
              {record.investBreakdown && (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #e8eaed' }}>
                      <th style={{ textAlign: 'left',  padding: '3px 0', color: C.sub, fontWeight: 500 }}>品类</th>
                      <th style={{ textAlign: 'right', padding: '3px 0', color: C.sub, fontWeight: 500 }}>持仓</th>
                      <th style={{ textAlign: 'right', padding: '3px 0', color: C.sub, fontWeight: 500 }}>累计收益</th>
                      <th style={{ textAlign: 'right', padding: '3px 0', color: C.sub, fontWeight: 500 }}>本月收益</th>
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
          {expenseItems && expenseItems.length > 0 && (() => {
            const CORE = ['消费', '波动生活', '周期生活'];
            const noTag: BillExpenseItem[] = [];
            const multiTag: BillExpenseItem[] = [];
            for (const it of expenseItems) {
              const tags = it.tags.split(',').map(t => t.trim()).filter(Boolean);
              const matched = CORE.filter(c => tags.includes(c));
              if (matched.length === 0) noTag.push(it);
              else if (matched.length > 1) multiTag.push(it);
            }
            if (noTag.length === 0 && multiTag.length === 0) return null;
            return (
              <div style={{ borderTop: '1px solid #dbe8fb', paddingTop: 10, marginBottom: 8 }}>
                <div style={{ fontSize: 12, color: '#c5221f', marginBottom: 6, fontWeight: 600 }}>⚠️ 异常支出</div>
                {noTag.length > 0 && (
                  <div style={{ marginBottom: 6 }}>
                    <div style={{ fontSize: 11, color: C.sub, marginBottom: 2 }}>缺少消费/波动生活/周期生活标签（{noTag.length}）</div>
                    {noTag.map((it, i) => <ExpenseItemLine key={i} it={it} />)}
                  </div>
                )}
                {multiTag.length > 0 && (
                  <div>
                    <div style={{ fontSize: 11, color: C.sub, marginBottom: 2 }}>同时有多个核心标签（{multiTag.length}）</div>
                    {multiTag.map((it, i) => <ExpenseItemLine key={i} it={it} />)}
                  </div>
                )}
              </div>
            );
          })()}
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
          {((record.majorExpenses && record.majorExpenses.length > 0) || record.majorExpensesNote) && (
            <div style={{ borderTop: '1px solid #dbe8fb', paddingTop: 10, marginTop: 8 }}>
              <div style={{ fontSize: 12, color: C.sub, marginBottom: 6 }}>大额支出</div>
              {record.majorExpenses?.map((e, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13, padding: '3px 0' }}>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 4, fontSize: 11, marginRight: 6, backgroundColor: e.type === '生活' ? '#e8f0fe' : '#f3e8fd', color: e.type === '生活' ? C.blue : C.purple }}>{e.type}</span>
                    {e.name}
                  </span>
                  <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500, flexShrink: 0 }}>¥{formatCurrency(e.amount)}</span>
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

type YearProfitMode = 'rate' | 'amount';

// ── YearSection ───────────────────────────────────────────────────
function YearSection({
  year,
  recs,
  allRecords,
  yearProfitMode,
  onToggleYearProfitMode,
  onJumpToMonth,
  expenseItemsByMonth,
}: {
  year: string;
  recs: MonthlyRecord[];
  allRecords: MonthlyRecord[];
  yearProfitMode: YearProfitMode;
  onToggleYearProfitMode: () => void;
  onJumpToMonth?: (ym: string) => void;
  expenseItemsByMonth?: Record<string, BillExpenseMonth>;
}) {
  const currentYear = String(_NOW.getFullYear());
  const [expanded, setExpanded] = useState(year === currentYear);
  const totalIncome  = recs.reduce((s, r) => s + r.income, 0);
  const totalExpense = recs.reduce((s, r) => s + r.totalExpense, 0);
  const surplus = totalIncome - totalExpense;
  const hasMonths = `${year}-01` >= YEARLY_ONLY_BEFORE;

  // 年度收益率：每月收益率（=本月收益/本月理财额）之和
  const monthlyProfits = recs.map(r => {
    const prev = allRecords.find(x => x.yearMonth === prevYearMonth(r.yearMonth));
    return prev ? r.accumulatedProfit - (prev.accumulatedProfit ?? 0) : null;
  }).filter((x): x is number => x !== null);
  const monthlyRates = recs.map(r => {
    const prev = allRecords.find(x => x.yearMonth === prevYearMonth(r.yearMonth));
    if (!prev || r.investTotal <= 0) return null;
    return (r.accumulatedProfit - (prev.accumulatedProfit ?? 0)) / r.investTotal;
  }).filter((x): x is number => x !== null);
  const yearRate = monthlyRates.length > 0 ? monthlyRates.reduce((a, b) => a + b, 0) : null;
  const yearProfitAmount = monthlyProfits.length > 0 ? monthlyProfits.reduce((a, b) => a + b, 0) : null;
  const yearProfitValue = yearProfitMode === 'rate' ? yearRate : yearProfitAmount;

  return (
    <div style={{ marginBottom: 4 }}>
      <button
        onClick={() => setExpanded((o) => !o)}
        style={{
          width: '100%', display: 'grid', gridTemplateColumns: HISTORY_GRID_COLUMNS,
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
        <span
          role="button"
          tabIndex={0}
          title={yearProfitMode === 'rate' ? '点击切换为收益金额' : '点击切换为收益率'}
          onClick={(e) => {
            e.stopPropagation();
            onToggleYearProfitMode();
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            e.stopPropagation();
            onToggleYearProfitMode();
          }}
          style={{ fontSize: 12, fontWeight: 600, color: yearProfitValue !== null ? (yearProfitValue >= 0 ? C.red : C.green) : C.sub, fontVariantNumeric: 'tabular-nums', textAlign: 'right', cursor: 'pointer' }}
        >
          {yearProfitMode === 'rate'
            ? (yearRate !== null ? `${(yearRate * 100).toFixed(1)}%` : '—')
            : (yearProfitAmount !== null ? formatSignedCurrency(yearProfitAmount) : '—')}
        </span>
      </button>
      {expanded && (
        <div style={{ paddingLeft: 8, marginTop: 4, marginBottom: 8 }}>
          {hasMonths ? (
            recs.map(r => {
              const prevRecord = allRecords.find((x) => x.yearMonth === prevYearMonth(r.yearMonth));
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
  const [selectMode, setSelectMode]   = useState<'single' | 'range' | 'detail'>('single');
  const [rangeStart, setRangeStart]   = useState<string | null>(null);
  const [rangeHover, setRangeHover]   = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [showWeekTemplate, setShowWeekTemplate] = useState(false);
  const [showPendingPanel, setShowPendingPanel] = useState(false);

  // ── History state ──
  const [formOpen, setFormOpen] = useState(false);
  const [yearProfitMode, setYearProfitMode] = useState<YearProfitMode>('rate');
  const toggleYearProfitMode = () => setYearProfitMode((m) => m === 'rate' ? 'amount' : 'rate');

  // ── Stores ──
  const { tagMap, setTag, toggleTag, countByTag, bulkFillSchool, confirmedExpenses, setConfirmedExpensePeriod, markConfirmedExpenseZero, clearConfirmedExpenseSelection } = useCalendarStore();
  const { config, setConfig } = useConfigStore();
  const { records, upsert, updateDayCounts } = useMonthlyStore();
  const { tagStats: billTagStats, expenseItems: billExpenseItems, updateFromImport: billUpdateFromImport } = useBillDetailStore();
  const { overrides: lifePeriodOverrides, setOverride: setLifePeriodOverride } = useLifePeriodOverrideStore();
  const {
    tagOrder, setTagOrder, weekdayTags, setWeekdayTags,
    showPayrollCutoffMarkers, setShowPayrollCutoffMarkers,
    reviewableCategories, setReviewableCategories,
  } = usePrefsStore();
  const tagDrag = useDragSort(tagOrder, setTagOrder, 'horizontal');
  const { holidayDataByYear, holidayWarning } = useHolidayYears([year]);


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
    () => calcHistoryStats(records.filter((r) => r.yearMonth >= twoYearsAgo), tagMap, confirmedExpenses, billExpenseItems, lifePeriodOverrides),
    [records, tagMap, confirmedExpenses, billExpenseItems, lifePeriodOverrides],
  );

  // ── Calendar computed ──
  const yearMonth    = `${year}-${pad(month + 1)}`;
  const daysInMonth  = getDaysInMonth(year, month);
  const firstDayWeekIdx = (new Date(year, month, 1).getDay() + 6) % 7;
  const payrollCutoffDate = useMemo(
    () => getPayrollScheduleForMonth(year, month, holidayDataByYear).cutoffDate,
    [year, month, holidayDataByYear],
  );

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

  const pendingManualEntries = useMemo(() => {
    const allowedSet = new Set(reviewableCategories);
    if (allowedSet.size === 0) return [] as { date: string; id: string; item: BillExpenseItem }[];
    const items = billExpenseItems[yearMonth] ?? [];
    const itemsByDate = new Map<string, BillExpenseItem[]>();
    for (const it of items) {
      const arr = itemsByDate.get(it.date) ?? [];
      arr.push(it);
      itemsByDate.set(it.date, arr);
    }
    const out: { date: string; id: string; item: BillExpenseItem }[] = [];
    const dates = [...itemsByDate.keys()].sort();
    for (const date of dates) {
      const sel = normalizeConfirmedSelection(confirmedExpenses[date]);
      const shortSet = new Set(sel.ids);
      const longSet = new Set(sel.longIds ?? []);
      const hasExplicitLong = sel.longIds !== undefined;
      // 旧数据：reviewed 且没存 longIds → 整天兜底为长，不算待分类
      if (sel.reviewed && !hasExplicitLong) continue;
      const withIds = assignExpenseIds(itemsByDate.get(date) ?? []);
      for (const { item, id } of withIds) {
        const tagList = (item.tags || '').split(',').map((t) => t.trim()).filter(Boolean);
        if (!tagList.some((t) => allowedSet.has(t as ReviewableCategory))) continue;
        if (resolveLifePeriod(item, lifePeriodOverrides) !== null) continue;
        if (shortSet.has(id) || longSet.has(id)) continue;
        out.push({ date, id, item });
      }
    }
    return out;
  }, [billExpenseItems, yearMonth, lifePeriodOverrides, confirmedExpenses, reviewableCategories]);

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
    if (selectMode === 'detail') { setSelectedDay((cur) => cur === key ? null : key); return; }
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
  const switchMode  = (m: 'single' | 'range' | 'detail') => {
    setSelectMode(m); cancelRange();
    if (m !== 'detail') setSelectedDay(null);
  };
  const prevMonth   = () => { cancelRange(); setSelectedDay(null); if (month === 0) { setYear((y) => y - 1); setMonth(11); } else setMonth((m) => m - 1); };
  const nextMonth   = () => { cancelRange(); setSelectedDay(null); if (month === 11) { setYear((y) => y + 1); setMonth(0); } else setMonth((m) => m + 1); };

  // ── 年月快捷跳转面板 ──
  const [pickerOpen, setPickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [thresholdInput, setThresholdInput] = useState(String(config.majorExpenseThreshold ?? 500));
  const [expandedTag, setExpandedTag] = useState<null | 'eat' | 'red' | 'black'>(null);
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
          investProfitComponents: prev?.investProfitComponents,
          homeDays: prev?.homeDays ?? 0,
          travelDays: prev?.travelDays ?? 0,
          majorExpenses: prev?.majorExpenses ?? [],
          majorExpensesNote: prev?.majorExpensesNote,
        });
        updated += 1;
      }
      setBillImportMsg(`已导入 ${updated} 个月记录 · ${file.name}`);
      triggerUpload();
    } catch (err) {
      setBillImportMsg(`导入失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const handleBillFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await importBillFromFile(file);
    if (billFileRef.current) billFileRef.current.value = '';
  };
  const dragCounter = useRef(0);
  useEffect(() => {
    const onEnter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      dragCounter.current++;
      if (dragCounter.current === 1) setBillDragOver(true);
    };
    const onLeave = () => {
      dragCounter.current--;
      if (dragCounter.current === 0) setBillDragOver(false);
    };
    const onOver = (e: DragEvent) => { e.preventDefault(); };
    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current = 0;
      setBillDragOver(false);
      const file = e.dataTransfer?.files?.[0];
      if (file) await importBillFromFile(file);
    };
    document.addEventListener('dragenter', onEnter);
    document.addEventListener('dragleave', onLeave);
    document.addEventListener('dragover', onOver);
    document.addEventListener('drop', onDrop);
    return () => {
      document.removeEventListener('dragenter', onEnter);
      document.removeEventListener('dragleave', onLeave);
      document.removeEventListener('dragover', onOver);
      document.removeEventListener('drop', onDrop);
    };
  }, []);
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
  const derivedExpenseForYearMonth = useMemo(
    () => aggregateExpenseItems(billExpenseItems[yearMonth] ?? []),
    [billExpenseItems, yearMonth],
  );
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
    <div style={{ display: 'grid', gridTemplateColumns: HISTORY_GRID_COLUMNS, padding: '6px 10px', fontSize: 11, color: C.sub, fontWeight: 500, marginBottom: 4 }}>
      <span>年/月</span>
      <span style={{ textAlign: 'right' }}>收入</span>
      <span style={{ textAlign: 'right' }}>支出</span>
      <span style={{ textAlign: 'right' }}>结余</span>
      <button
        type="button"
        onClick={toggleYearProfitMode}
        title={yearProfitMode === 'rate' ? '点击切换为收益金额' : '点击切换为收益率'}
        style={{ textAlign: 'right', color: C.sub, font: 'inherit', fontWeight: 500, border: 'none', background: 'transparent', padding: 0, cursor: 'pointer' }}
      >
        {yearProfitMode === 'rate' ? '收益率' : '收益'}
      </button>
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
      <input ref={billFileRef} type="file" accept=".xls,.xlsx,.csv" style={{ display: 'none' }} onChange={handleBillFile} />
      {billDragOver && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 999, backgroundColor: 'rgba(26,115,232,0.12)', border: '3px dashed #1a73e8', borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{ backgroundColor: '#fff', borderRadius: 12, padding: '20px 32px', fontSize: 16, fontWeight: 600, color: '#1a73e8', boxShadow: '0 4px 20px rgba(0,0,0,0.12)' }}>
            📥 松手导入账单
          </div>
        </div>
      )}
      {/* 页头 + 胶囊切换 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '0 0 16px' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>
          {tab === 'month' ? '日历标记' : '历史记录'}
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => billFileRef.current?.click()}
            style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, border: `1px solid ${C.border}`, backgroundColor: '#fff', color: C.sub, cursor: 'pointer' }}
          >
            📥 导入账单
          </button>
          {billImportMsg && <span style={{ fontSize: 11, color: C.sub, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{billImportMsg}</span>}
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
        <button onClick={() => {
          setThresholdInput(String(config.majorExpenseThreshold ?? 500));
          setSettingsOpen(true);
        }}
          style={{ fontSize: 16, background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px', color: C.sub, lineHeight: 1 }}>
          ⚙️
        </button>
        </div>
      </div>
      {holidayWarning && (
        <div style={{ margin: '0 0 16px', fontSize: 12, color: C.orange, backgroundColor: '#fff4e8', border: '1px solid #fed7aa', borderRadius: 10, padding: '8px 10px' }}>
          {holidayWarning}
        </div>
      )}

      {settingsOpen && (
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          thresholdInput={thresholdInput}
          setThresholdInput={setThresholdInput}
          showPayrollCutoffMarkers={showPayrollCutoffMarkers}
          setShowPayrollCutoffMarkers={setShowPayrollCutoffMarkers}
          reviewableCategories={reviewableCategories}
          setReviewableCategories={setReviewableCategories}
          onSave={() => { setConfig({ majorExpenseThreshold: parseFloat(thresholdInput) || 500 }); setSettingsOpen(false); }}
          tagMap={tagMap}
          confirmedExpenses={confirmedExpenses}
          expenseItems={billExpenseItems}
          overrides={lifePeriodOverrides}
          setOverride={setLifePeriodOverride}
        />
      )}

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
                          onClick={() => { cancelRange(); setSelectedDay(null); setMonth(i); setPickerOpen(false); }}
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
                    ? ((existingForYearMonth.periodicLife + existingForYearMonth.volatileLife) || (derivedExpenseForYearMonth.periodicLife + derivedExpenseForYearMonth.volatileLife))
                    : (derivedExpenseForYearMonth.periodicLife + derivedExpenseForYearMonth.volatileLife);
                  const totalCons = existingForYearMonth
                    ? (existingForYearMonth.consumption || derivedExpenseForYearMonth.consumption)
                    : derivedExpenseForYearMonth.consumption;

                  const wLife = historyStats.stateDailyAvg;
                  const wCons = historyStats.stateConsumptionDailyAvg;
                  const TAG_KINDS = ['school','intern','home','travel'] as TagKind[];

                  // 把当月已勾选的"确切支出"按 状态 × 类型(life/cons) 聚合
                  // 状态来自 tagMap[date]；无标签的勾选忽略（不进入估算）
                  // 类型分类：tags 含 周期生活|波动生活 → life；含 消费 → cons；都不含则忽略
                  const monthItems = billExpenseItems[yearMonth] ?? [];
                  const itemsById = new Map<string, BillExpenseItem>();
                  for (const day of Object.keys(confirmedExpenses)) {
                    if (!day.startsWith(yearMonth)) continue;
                    const dayItems = assignExpenseIds(monthItems.filter((it) => it.date === day));
                    for (const { item, id } of dayItems) itemsById.set(`${day}|${id}`, item);
                  }
                  const confirmedLifeByState: Record<TagKind, number> = { school: 0, intern: 0, home: 0, travel: 0 };
                  const confirmedConsByState: Record<TagKind, number> = { school: 0, intern: 0, home: 0, travel: 0 };
                  const confirmedDaysByState: Record<TagKind, number> = { school: 0, intern: 0, home: 0, travel: 0 };
                  for (const [day, selection] of Object.entries(confirmedExpenses)) {
                    if (!day.startsWith(yearMonth)) continue;
                    const tag = tagMap[day];
                    if (!tag) continue; // 未标记的天不参与状态聚合
                    const normalized = normalizeConfirmedSelection(selection);
                    const ids = normalized.ids;
                    for (const id of ids) {
                      const item = itemsById.get(`${day}|${id}`);
                      if (!item) continue;
                      const tags = item.tags.split(',').map(t => t.trim());
                      if (tags.includes('周期生活') || tags.includes('波动生活')) {
                        confirmedLifeByState[tag] += item.amount;
                      } else if (tags.includes('消费')) {
                        confirmedConsByState[tag] += item.amount;
                      }
                    }
                    if (normalized.reviewed) confirmedDaysByState[tag] += 1;
                  }

                  // 剩余预算（不动 totalLife / totalCons 本身）
                  const confirmedLifeAll = TAG_KINDS.reduce((s, k) => s + confirmedLifeByState[k], 0);
                  const confirmedConsAll = TAG_KINDS.reduce((s, k) => s + confirmedConsByState[k], 0);
                  const remainLife = Math.max(0, totalLife - confirmedLifeAll);
                  const remainCons = Math.max(0, totalCons - confirmedConsAll);

                  // 剩余加权基数（仅未确切的天）
                  const remainDenomLife = TAG_KINDS.reduce((s, k) => s + Math.max(0, statsToDate[k] - confirmedDaysByState[k]) * wLife[k], 0);
                  const remainDenomCons = TAG_KINDS.reduce((s, k) => s + Math.max(0, statsToDate[k] - confirmedDaysByState[k]) * wCons[k], 0);

                  return tagOrder.map((t) => {
                  const meta  = tagMeta[t];
                  const count = stats.counts[t];
                  const countToDate = statsToDate[t];
                  const pct   = stats.total > 0 ? (count / stats.total) * 100 : 0;
                  const cd = confirmedDaysByState[t];
                  const remainDays = Math.max(0, countToDate - cd);
                  // 未确切日均（沿用比例分配）
                  const estUnconfirmedLife = remainDenomLife > 0 ? wLife[t] * remainLife / remainDenomLife : 0;
                  const estUnconfirmedCons = remainDenomCons > 0 ? wCons[t] * remainCons / remainDenomCons : 0;
                  // 展示日均 = (确切总额 + 估算未确切部分) / 该状态总天数
                  const avgLife = countToDate > 0 ? (confirmedLifeByState[t] + estUnconfirmedLife * remainDays) / countToDate : 0;
                  const avgCons = countToDate > 0 ? (confirmedConsByState[t] + estUnconfirmedCons * remainDays) / countToDate : 0;
                  const fmtLife = (v: number) => v > 0
                    ? <span style={{ backgroundColor: 'rgba(26,115,232,0.08)', color: C.blue, borderRadius: 6, padding: '2px 6px', display: 'inline-block' }}>¥{Math.round(v)}</span>
                    : <span style={{ color: '#dadce0' }}>—</span>;
                  const fmtCons = (v: number) => v > 0
                    ? <span style={{ backgroundColor: 'rgba(124,58,237,0.08)', color: C.purple, borderRadius: 6, padding: '2px 6px', display: 'inline-block' }}>¥{Math.round(v)}</span>
                    : <span style={{ color: '#dadce0' }}>—</span>;
                  const anchor = cd > 0 ? <span style={{ fontSize: 10, color: C.sub, marginLeft: 4 }}>📌{cd}</span> : null;
                  return (
                    <tr key={t}>
                      <td style={{ padding: '6px 0', color: C.sub }}>{meta.icon} {meta.label}</td>
                      <td style={{ padding: '6px 8px' }}>
                        <div style={{ height: 8, backgroundColor: '#e8eaed', borderRadius: 4, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${pct}%`, backgroundColor: meta.color, borderRadius: 4, transition: 'width 0.3s' }} />
                        </div>
                      </td>
                      <td style={{ padding: '6px 0', textAlign: 'right', fontWeight: 500, fontVariantNumeric: 'tabular-nums', color: C.sub }}>{count}</td>
                      <td style={{ padding: '6px 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>{fmtLife(avgLife)}{anchor}</td>
                      <td style={{ padding: '6px 0 6px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>{fmtCons(avgCons)}</td>
                    </tr>
                  );
                  });
                })()}
              </tbody>
            </table>
            {(() => {
              const schoolSpend = existingForYearMonth?.school || derivedExpenseForYearMonth.school;
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
            {billExpenseItems[yearMonth] && billExpenseItems[yearMonth]!.length > 0 && (
              <CategoryBreakdown items={billExpenseItems[yearMonth]!} />
            )}
            {stats.tagged < stats.total && (
              <div style={{ marginTop: 12, fontSize: 13, color: C.orange, backgroundColor: '#fef7e0', border: '1px solid #fdd663', borderRadius: 12, padding: '10px 14px' }}>
                💡 还有 {stats.total - stats.tagged} 天未标记
              </div>
            )}
          </Card>

          {/* 月度数据 / 大额支出 / 各品类持仓 三张卡片 */}
          <MonthFormCards
            key={yearMonth}
            yearMonth={yearMonth}
            existing={existingForYearMonth}
            prevRecord={prevForYearMonth}
            tagCounts={countByTag(yearMonth)}
            expenseItems={billExpenseItems[yearMonth]}
            onSave={(r) => upsert(r)}
            subtitle={existingForYearMonth ? '已有数据，可修改' : '尚未录入'}
          />

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
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 0, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
              {(['single', 'range', 'detail'] as const).map((m) => (
                <button key={m} onClick={() => switchMode(m)} style={{ padding: '6px 16px', fontSize: 13, border: 'none', cursor: 'pointer', backgroundColor: selectMode === m ? C.blue : '#fff', color: selectMode === m ? '#fff' : C.sub, fontWeight: selectMode === m ? 600 : 400 }}>
                  {m === 'single' ? '单击' : m === 'range' ? '起止' : '明细'}
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowPendingPanel((v) => !v)}
              title="集中处理所有未被规则覆盖的待手动分类账单"
              style={{
                padding: '6px 14px', fontSize: 13, borderRadius: 10, cursor: 'pointer', fontWeight: 600,
                border: `1px solid ${pendingManualEntries.length > 0 ? '#fdba74' : C.border}`,
                backgroundColor: showPendingPanel ? '#fff7ed' : '#fff',
                color: pendingManualEntries.length > 0 ? C.orange : C.sub,
              }}
            >
              待分类 {pendingManualEntries.length}
            </button>
          </div>

          {selectMode === 'range' && (
            <div style={{ fontSize: 13, color: rangeStart ? C.blue : C.sub, backgroundColor: rangeStart ? '#e8f0fe' : '#f8f9fa', border: `1px solid ${rangeStart ? '#a8c7fa' : C.border}`, borderRadius: 10, padding: '8px 14px', marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{rangeStart ? `已选起点 ${rangeStart}，点击终点日期` : '点击起点日期'}</span>
              {rangeStart && <button onClick={cancelRange} style={{ fontSize: 12, color: C.sub, border: 'none', background: 'none', cursor: 'pointer' }}>✕ 取消</button>}
            </div>
          )}

          {selectMode === 'detail' && (
            <div style={{ fontSize: 13, color: C.sub, backgroundColor: '#f0f7ff', border: '1px solid #a8c7fa', borderRadius: 10, padding: '8px 14px', marginBottom: 12 }}>
              点击日期查看当日账单，勾选确切支出；也可以直接记为 0 支出，用于优化日均估算
            </div>
          )}

          {showPendingPanel && (
            <PendingManualPanel
              entries={pendingManualEntries}
              onSetPeriod={(date, id, period) => setConfirmedExpensePeriod(date, id, period)}
              onClose={() => setShowPendingPanel(false)}
            />
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
                const isPayrollCutoff = showPayrollCutoffMarkers && cell.key === payrollCutoffDate;
                const isRangeStart = cell.key === rangeStart;
                const isSelectedDay = cell.key === selectedDay;
                const inPreview  = previewRange.has(cell.key);
                const displayTag  = inPreview ? selectedTag : tag;
                const displayMeta = displayTag ? tagMeta[displayTag] : null;
                const confirmedState = normalizeConfirmedSelection(confirmedExpenses[cell.key]);
                const hasReviewed = confirmedState.reviewed;
                const hasConfirmed = confirmedState.ids.length > 0;
                const isZeroConfirmed = hasReviewed && !hasConfirmed;
                let borderStyle = 'none';
                if (isToday || isRangeStart || isSelectedDay) borderStyle = `2px solid ${C.blue}`;
                else if (inPreview) borderStyle = `1.5px dashed ${C.blue}`;
                return (
                  <button key={cell.key}
                    onClick={() => handleCellClick(cell.key)}
                    onMouseEnter={() => { if (selectMode === 'range' && rangeStart) setRangeHover(cell.key); }}
                    style={{ aspectRatio: '1', borderRadius: 10, fontSize: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: borderStyle, backgroundColor: displayMeta ? `${displayMeta.color}20` : weekend ? '#fff0f0' : '#f8f9fa', color: displayMeta ? displayMeta.color : weekend ? C.weekend : '#202124', cursor: 'pointer', fontWeight: 500, transition: 'all 0.1s', outline: 'none', position: 'relative' }}
                  >
                    {cell.day}
                    {displayMeta && <span style={{ fontSize: 8, marginTop: 1 }}>{displayMeta.icon}</span>}
                    {isPayrollCutoff && <span style={{ position: 'absolute', top: 3, right: 4, fontSize: 9, fontWeight: 700, color: C.blue }}>截</span>}
                    {hasReviewed && <span style={{ position: 'absolute', top: 3, left: 4, width: 5, height: 5, borderRadius: '50%', backgroundColor: isZeroConfirmed ? C.green : C.orange }} />}
                  </button>
                );
              })}
            </div>
          </Card>

          {selectMode === 'detail' && selectedDay && (() => {
            const selectedConfirmedState = normalizeConfirmedSelection(confirmedExpenses[selectedDay]);
            const allowedSet = new Set(reviewableCategories);
            const dayItems = (billExpenseItems[yearMonth] ?? []).filter((it) => {
              if (it.date !== selectedDay) return false;
              if (allowedSet.size === 0) return false;
              const tagList = (it.tags || '').split(',').map((t) => t.trim()).filter(Boolean);
              return tagList.some((t) => allowedSet.has(t as ReviewableCategory));
            });
            return (
              <DayDetailPanel
                date={selectedDay}
                items={dayItems}
                selection={selectedConfirmedState}
                onSetPeriod={(id, period) => setConfirmedExpensePeriod(selectedDay, id, period)}
                onMarkZero={() => markConfirmedExpenseZero(selectedDay)}
                onClear={() => clearConfirmedExpenseSelection(selectedDay)}
                resolveOverride={(it) => resolveLifePeriod(it, lifePeriodOverrides)}
              />
            );
          })()}
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
                  expenseItems={billExpenseItems[thisMonth]}
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
              <YearSection
                key={yr}
                year={yr}
                recs={recs}
                allRecords={records}
                yearProfitMode={yearProfitMode}
                onToggleYearProfitMode={toggleYearProfitMode}
                onJumpToMonth={handleJumpToMonth}
                expenseItemsByMonth={billExpenseItems}
              />
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
