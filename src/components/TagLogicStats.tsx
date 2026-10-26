import { useMemo, useRef, useState } from 'react';
import type { BillStatisticItem } from '../hooks/useBillStatisticItems';
import { usePossessionStore } from '../stores/possessionStore';
import type { BillExpenseItem } from '../utils/importBill';
import { isMajorExcludedTag } from '../utils/tagCategory';
import { compileTagLogic, formatTagReference } from '../utils/tagLogic';
import { isDailyTripTagFormat } from '../utils/trips';
import { formatCurrency } from './CurrencyDisplay';

const formatBillCurrency = (amount: number) => `${amount < 0 ? '−' : ''}¥${formatCurrency(amount)}`;

const C = { blue: '#1a73e8', red: '#ea4335', green: '#0d9488', purple: '#7c3aed', sub: '#5f6368', orange: '#e8710a' };

function getRecentDateRange(months: 1 | 12, today: Date) {
  const start = new Date(today.getFullYear(), today.getMonth() - months, 1);
  const lastDay = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
  start.setDate(Math.min(today.getDate(), lastDay));
  const formatDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return { startDate: formatDate(start), endDate: formatDate(today) };
}

function surplusHighlightStyle(value: number): React.CSSProperties {
  const positive = value >= 0;
  return {
    justifySelf: 'end',
    padding: '3px 7px',
    borderRadius: 999,
    backgroundColor: positive ? '#fce8e6' : '#e6f4ea',
    boxShadow: `0 0 0 1px ${positive ? '#f6aea7' : '#a8dab5'}, 0 2px 8px ${positive ? 'rgba(234,67,53,0.18)' : 'rgba(13,148,136,0.18)'}`,
    color: positive ? C.red : C.green,
    fontSize: 13,
    fontWeight: 700,
    fontVariantNumeric: 'tabular-nums',
    textAlign: 'right',
    whiteSpace: 'nowrap',
  };
}

// ── Bill tag detail helpers ───────────────────────────────────────
const NOISE_TAGS = new Set(['周期生活', '波动生活', '消费', '吃好喝好', '红', '黑', '消耗品', '白', '家']);
const NOISE_NOTE_PATTERNS = [/账户余额补齐/, /美团平台商户/];
export function extractMeaningful(tagsRaw: string, note: string, hiddenTags?: ReadonlySet<string>): string {
  const tags = tagsRaw.split(',').map(t => t.trim()).filter(t => t && !NOISE_TAGS.has(t) && !hiddenTags?.has(t));
  const cleanNote = NOISE_NOTE_PATTERNS.some(p => p.test(note)) ? '' : note;
  return [...new Set([cleanNote, ...tags].filter(Boolean))].join(' · ');
}

function splitBillTags(tagsRaw: string): string[] {
  return [...new Set(tagsRaw.split(',').map((tag) => tag.trim()).filter(Boolean))];
}

type CategorizedBillItem = BillExpenseItem & { transactionType?: BillStatisticItem['transactionType'] };

function getStatisticTags(item: BillStatisticItem): string[] {
  const tags = splitBillTags(item.tags);
  return item.transactionType === '收入' && !tags.includes('收入') ? [...tags, '收入'] : tags;
}

function getStatisticAccount(account: string): string {
  const normalized = account.trim();
  if (normalized.includes('♑') || normalized.includes('花呗') || normalized.includes('先用后付')) return '信用卡';
  return normalized || '(无账户)';
}

type TagLogicOperator = 'AND' | 'OR' | 'NOT' | '(' | ')';
type TagLogicPart =
  | { kind: 'tag'; value: string }
  | { kind: 'operator'; value: TagLogicOperator };

function resolveTagLogicOperator(raw: string): TagLogicOperator | null {
  const value = raw.trim().toUpperCase();
  if (value === 'AND' || value === '且' || value === '与') return 'AND';
  if (value === 'OR' || value === '或') return 'OR';
  if (value === 'NOT' || value === '非') return 'NOT';
  if (value === '(' || value === '（') return '(';
  if (value === ')' || value === '）') return ')';
  return null;
}

export default function TagLogicStats({ items, initialTags = [], compact = false, dailyAverageDays }: {
  items: BillStatisticItem[];
  initialTags?: readonly string[];
  compact?: boolean;
  dailyAverageDays?: number;
}) {
  const [logicParts, setLogicParts] = useState<TagLogicPart[]>(() => (
    [...new Set(initialTags.map((tag) => tag.trim()).filter(Boolean))].flatMap<TagLogicPart>((tag, index) => (
      index === 0
        ? [{ kind: 'tag', value: tag }]
        : [{ kind: 'operator', value: 'OR' }, { kind: 'tag', value: tag }]
    ))
  ));
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(true);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [accountsExpanded, setAccountsExpanded] = useState(false);
  const queryInputRef = useRef<HTMLInputElement>(null);
  const today = new Date();
  const rangePresets = [
    { label: '近一年', ...getRecentDateRange(12, today) },
    { label: '近一月', ...getRecentDateRange(1, today) },
    { label: '全部时间', startDate: '', endDate: '' },
  ];

  const availableRange = useMemo(() => {
    let earliest = '';
    let latest = '';
    for (const item of items) {
      if (!earliest || item.date < earliest) earliest = item.date;
      if (!latest || item.date > latest) latest = item.date;
    }
    return { earliest, latest };
  }, [items]);
  const rangedItems = useMemo(
    () => items.filter((item) => (!startDate || item.date >= startDate) && (!endDate || item.date <= endDate)),
    [items, startDate, endDate],
  );

  const accountOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of rangedItems) {
      const account = getStatisticAccount(item.account);
      counts.set(account, (counts.get(account) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([account, count]) => ({ account, count }))
      .sort((a, b) => b.count - a.count || a.account.localeCompare(b.account, 'zh-CN'));
  }, [rangedItems]);
  const accountFilteredItems = useMemo(() => {
    if (selectedAccounts.length === 0) return rangedItems;
    const selected = new Set(selectedAccounts);
    return rangedItems.filter((item) => selected.has(getStatisticAccount(item.account)));
  }, [rangedItems, selectedAccounts]);
  const creditCardCount = accountOptions.find(({ account }) => account === '信用卡')?.count ?? 0;
  const selectedAccountLabel = selectedAccounts.length === 0 ? '全部账户' : selectedAccounts.join('、');

  const tagOptions = useMemo(() => {
    const counts = new Map<string, number>();
    let lifeCount = 0;
    for (const item of accountFilteredItems) {
      const tags = getStatisticTags(item);
      for (const tag of tags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
      if (item.transactionType !== '收入' && (tags.includes('周期生活') || tags.includes('波动生活'))) {
        lifeCount += 1;
      }
    }
    if (lifeCount > 0) counts.set('生活', lifeCount);
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh-CN'));
  }, [accountFilteredItems]);

  const expression = useMemo(
    () => logicParts.map((part) => part.kind === 'tag' ? formatTagReference(part.value) : part.value).join(' '),
    [logicParts],
  );
  const logicLabel = useMemo(
    () => logicParts.map((part) => part.value).join(' '),
    [logicParts],
  );
  const compiledLogic = useMemo(() => compileTagLogic(expression), [expression]);
  const referencedTagSet = useMemo(() => new Set(compiledLogic.referencedTags), [compiledLogic.referencedTags]);
  const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN');
  const inputOperator = resolveTagLogicOperator(query);
  const suggestions = inputOperator || !normalizedQuery
    ? []
    : tagOptions
      .filter(({ tag }) => !referencedTagSet.has(tag) && tag.toLocaleLowerCase('zh-CN').includes(normalizedQuery))
      .slice(0, 8);
  const matchedItems = useMemo(() => {
    if (!compiledLogic.test) return selectedAccounts.length > 0 ? accountFilteredItems : [];
    return accountFilteredItems.filter((item) => {
      const tags = new Set(getStatisticTags(item));
      return compiledLogic.test?.(tags) ?? false;
    });
  }, [accountFilteredItems, compiledLogic, selectedAccounts.length]);
  const matchedDayCount = useMemo(() => {
    if (dailyAverageDays !== undefined && Number.isFinite(dailyAverageDays) && dailyAverageDays > 0) {
      return Math.max(Math.round(dailyAverageDays), 1);
    }
    let earliest = '';
    let latest = '';
    for (const item of matchedItems) {
      if (!earliest || item.date < earliest) earliest = item.date;
      if (!latest || item.date > latest) latest = item.date;
    }
    const days = (Date.parse(latest) - Date.parse(earliest)) / 86_400_000 + 1;
    return Number.isFinite(days) ? Math.max(days, 1) : 1;
  }, [matchedItems, dailyAverageDays]);
  const matchedTransactionSections = useMemo(() => {
    return (['支出', '收入'] as const).map((transactionType) => {
      const sectionItems = matchedItems.filter((item) => item.transactionType === transactionType);
      const groups = new Map<string, BillStatisticItem[]>();
      for (const item of sectionItems) {
        const category = item.category || '';
        const categoryItems = groups.get(category) ?? [];
        categoryItems.push(item);
        groups.set(category, categoryItems);
      }
      return {
        transactionType,
        items: sectionItems,
        total: sectionItems.reduce((sum, item) => sum + item.amount, 0),
        categoryGroups: [...groups.entries()]
          .map(([category, categoryItems]) => ({
            category,
            items: categoryItems,
            total: categoryItems.reduce((sum, item) => sum + item.amount, 0),
          }))
          .sort((a, b) => b.total - a.total),
      };
    }).filter((section) => section.items.length > 0);
  }, [matchedItems]);
  const totalAmount = matchedItems.reduce((sum, item) => sum + item.amount, 0);
  const expenseAmount = matchedItems.reduce((sum, item) => sum + (item.transactionType === '支出' ? item.amount : 0), 0);
  const incomeAmount = matchedItems.reduce((sum, item) => sum + (item.transactionType === '收入' ? item.amount : 0), 0);
  const balanceAmount = incomeAmount - expenseAmount;
  const rangedAmount = accountFilteredItems.reduce((sum, item) => sum + item.amount, 0);
  const averageAmount = matchedItems.length > 0 ? totalAmount / matchedItems.length : 0;
  const dailyAverageAmount = balanceAmount / matchedDayCount;
  const rangedShare = rangedAmount > 0 ? totalAmount / rangedAmount * 100 : 0;
  const rangeLabel = !startDate && !endDate
    ? `全部时间 · ${accountFilteredItems.length} 笔`
    : `${startDate || availableRange.earliest} 至 ${endDate || availableRange.latest} · ${accountFilteredItems.length} 笔`;
  const amountLeadLabel = expenseAmount !== 0 && incomeAmount !== 0
    ? `支出 ${formatBillCurrency(expenseAmount)} · 收入 ${formatBillCurrency(incomeAmount)}`
    : incomeAmount !== 0
      ? `收入 ${formatBillCurrency(incomeAmount)}`
      : `支出 ${formatBillCurrency(expenseAmount)}`;
  const hasActiveFilter = logicParts.length > 0 || selectedAccounts.length > 0;

  const toggleAccount = (account: string) => {
    setSelectedAccounts((current) => current.includes(account)
      ? current.filter((item) => item !== account)
      : [...current, account]);
    setExpanded(true);
  };

  const focusQueryInput = () => {
    window.requestAnimationFrame(() => queryInputRef.current?.focus());
  };

  const addTag = (tag: string) => {
    if (!tag) return;
    setLogicParts((current) => {
      const next = [...current];
      const last = next[next.length - 1];
      if (last?.kind === 'tag' || (last?.kind === 'operator' && last.value === ')')) {
        next.push({ kind: 'operator', value: 'AND' });
      }
      next.push({ kind: 'tag', value: tag });
      return next;
    });
    setQuery('');
    setExpanded(true);
    focusQueryInput();
  };

  const appendLogicToken = (token: TagLogicOperator) => {
    setLogicParts((current) => {
      const next = [...current];
      const last = next[next.length - 1];
      const endsWithValue = last?.kind === 'tag' || (last?.kind === 'operator' && last.value === ')');
      if (token === 'AND' || token === 'OR') {
        if (!last) return current;
        if (last.kind === 'operator' && (last.value === 'AND' || last.value === 'OR')) {
          next[next.length - 1] = { kind: 'operator', value: token };
          return next;
        }
        if (!endsWithValue) return current;
      } else if (token === 'NOT' || token === '(') {
        if (endsWithValue) next.push({ kind: 'operator', value: 'AND' });
      } else {
        const openCount = next.reduce((count, part) => {
          if (part.kind !== 'operator') return count;
          if (part.value === '(') return count + 1;
          if (part.value === ')') return count - 1;
          return count;
        }, 0);
        if (!endsWithValue || openCount <= 0) return current;
      }
      next.push({ kind: 'operator', value: token });
      return next;
    });
    setExpanded(true);
  };

  const appendLogicTokenFromButton = (token: TagLogicOperator) => {
    const firstSuggestedTag = suggestions[0]?.tag;
    if (firstSuggestedTag) addTag(firstSuggestedTag);
    appendLogicToken(token);
    focusQueryInput();
  };

  return (
    <div style={{ padding: 12, borderRadius: 12, border: '1px solid #ddd6fe', backgroundColor: '#faf8ff' }}>
      {!compact && <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#202124' }}>时间范围</span>
        <span style={{ fontSize: 10, color: C.purple }}>{rangeLabel}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
        <label style={{ flex: '1 1 130px', minWidth: 0 }}>
          <span style={{ display: 'block', marginBottom: 4, fontSize: 10, color: C.sub }}>开始日期</span>
          <input
            type="date"
            value={startDate}
            max={endDate || undefined}
            onChange={(event) => {
              const next = event.target.value;
              setStartDate(next);
              if (next && endDate && next > endDate) setEndDate(next);
            }}
            style={{ width: '100%', minWidth: 0, border: '1px solid #d8d1ee', borderRadius: 8, padding: '6px 7px', backgroundColor: '#fff', fontSize: 11 }}
          />
        </label>
        <label style={{ flex: '1 1 130px', minWidth: 0 }}>
          <span style={{ display: 'block', marginBottom: 4, fontSize: 10, color: C.sub }}>结束日期</span>
          <input
            type="date"
            value={endDate}
            min={startDate || undefined}
            onChange={(event) => {
              const next = event.target.value;
              setEndDate(next);
              if (next && startDate && next < startDate) setStartDate(next);
            }}
            style={{ width: '100%', minWidth: 0, border: '1px solid #d8d1ee', borderRadius: 8, padding: '6px 7px', backgroundColor: '#fff', fontSize: 11 }}
          />
        </label>
        <div role="group" aria-label="快捷时间范围" style={{ flexBasis: '100%', display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 6 }}>
          {rangePresets.map((preset) => {
            const active = startDate === preset.startDate && endDate === preset.endDate;
            return (
              <button
                key={preset.label}
                type="button"
                aria-pressed={active}
                onClick={() => { setStartDate(preset.startDate); setEndDate(preset.endDate); }}
                style={{ flexShrink: 0, border: `1px solid ${active ? '#c4b5fd' : '#e5e7eb'}`, backgroundColor: active ? '#ede9fe' : '#fff', color: active ? C.purple : C.sub, borderRadius: 8, padding: '7px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12, paddingTop: 10, borderTop: '1px solid #ede9fe', flexWrap: 'wrap' }}>
        <button
          type="button"
          aria-expanded={accountsExpanded}
          onClick={() => setAccountsExpanded((current) => !current)}
          style={{ minWidth: 0, flex: '1 1 130px', display: 'flex', alignItems: 'center', gap: 5, border: 'none', background: 'none', color: '#202124', padding: '3px 0', fontSize: 12, fontWeight: 700, cursor: 'pointer', textAlign: 'left' }}
        >
          <span>{accountsExpanded ? '▼' : '▶'}</span>
          <span>账户</span>
          <span title={selectedAccountLabel} style={{ minWidth: 0, color: C.purple, fontSize: 10, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>· {selectedAccountLabel}</span>
        </button>
        <button
          type="button"
          aria-pressed={selectedAccounts.length === 0}
          onClick={() => { setSelectedAccounts([]); setExpanded(true); }}
          style={{ border: `1px solid ${selectedAccounts.length === 0 ? '#c4b5fd' : '#e5e7eb'}`, backgroundColor: selectedAccounts.length === 0 ? '#ede9fe' : '#fff', color: selectedAccounts.length === 0 ? C.purple : C.sub, borderRadius: 14, padding: '4px 8px', fontSize: 10, fontWeight: selectedAccounts.length === 0 ? 700 : 500, cursor: 'pointer' }}
        >
          全部 · {rangedItems.length}
        </button>
        <button
          type="button"
          aria-pressed={selectedAccounts.includes('信用卡')}
          disabled={creditCardCount === 0}
          onClick={() => { setSelectedAccounts(['信用卡']); setExpanded(true); }}
          style={{ border: `1px solid ${selectedAccounts.includes('信用卡') ? '#c4b5fd' : '#e5e7eb'}`, backgroundColor: selectedAccounts.includes('信用卡') ? '#ede9fe' : '#fff', color: selectedAccounts.includes('信用卡') ? C.purple : C.sub, borderRadius: 14, padding: '4px 8px', fontSize: 10, fontWeight: selectedAccounts.includes('信用卡') ? 700 : 500, cursor: creditCardCount === 0 ? 'not-allowed' : 'pointer', opacity: creditCardCount === 0 ? 0.45 : 1 }}
        >
          💳 信用卡 · {creditCardCount}
        </button>
      </div>
      {accountsExpanded && (
        <div style={{ marginTop: 7 }}>
          <div style={{ marginBottom: 6, fontSize: 10, color: C.sub }}>可多选 · ♑️ / 花呗 / 先用后付 → 信用卡</div>
          <div role="group" aria-label="账户筛选" style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {accountOptions.filter(({ account }) => account !== '信用卡').map(({ account, count }) => {
              const active = selectedAccounts.includes(account);
              return (
                <button
                  key={account}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleAccount(account)}
                  style={{ border: `1px solid ${active ? '#c4b5fd' : '#e5e7eb'}`, backgroundColor: active ? '#ede9fe' : '#fff', color: active ? C.purple : C.sub, borderRadius: 14, padding: '4px 9px', fontSize: 10, fontWeight: active ? 700 : 500, cursor: 'pointer' }}
                >
                  {account} · {count}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, margin: '12px 0 8px', paddingTop: 10, borderTop: '1px solid #ede9fe' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#202124' }}>标签逻辑</span>
        <span style={{ fontSize: 10, color: C.purple }}>输入标签或逻辑符</span>
      </div>
      <div role="group" aria-label="标签逻辑编辑器" style={{ minHeight: 42, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 5, padding: 8, border: `1px solid ${compiledLogic.error ? '#fca5a5' : '#d8d1ee'}`, borderRadius: 8, backgroundColor: '#fff' }}>
        {logicParts.map((part, index) => {
          const isTag = part.kind === 'tag';
          return (
            <button
              key={`${part.kind}-${part.value}-${index}`}
              type="button"
              aria-label={`移除 ${part.value}`}
              title="点击移除"
              onClick={() => setLogicParts((current) => current.filter((_, partIndex) => partIndex !== index))}
              style={{ border: `1px solid ${isTag ? '#c4b5fd' : '#d1d5db'}`, backgroundColor: isTag ? '#ede9fe' : '#f3f4f6', color: isTag ? C.purple : '#374151', borderRadius: isTag ? 14 : 7, padding: isTag ? '4px 8px' : '4px 7px', fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: isTag ? 'inherit' : 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
            >
              {part.value} ×
            </button>
          );
        })}
        <input
          ref={queryInputRef}
          value={query}
          aria-label="输入标签或逻辑符"
          disabled={accountFilteredItems.length === 0}
          placeholder={accountFilteredItems.length === 0 ? '当前范围暂无账单' : logicParts.length === 0 ? '输入标签或 AND / OR / NOT' : '继续输入…'}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Backspace' && !query && logicParts.length > 0) {
              setLogicParts((current) => current.slice(0, -1));
              return;
            }
            const shouldCommitOperator = inputOperator && (event.key === 'Enter' || event.key === ' ');
            if (shouldCommitOperator) {
              event.preventDefault();
              appendLogicToken(inputOperator);
              setQuery('');
              return;
            }
            if (event.key !== 'Enter' || suggestions.length === 0) return;
            event.preventDefault();
            addTag(suggestions[0].tag);
          }}
          style={{ flex: '1 1 150px', minWidth: 120, border: 'none', padding: '4px 3px', backgroundColor: 'transparent', color: accountFilteredItems.length === 0 ? '#9aa0a6' : '#202124', fontSize: 11, outline: 'none' }}
        />

        {query.trim() && (
          <div style={{ flexBasis: '100%', display: 'flex', flexWrap: 'wrap', gap: 5, paddingTop: 7, borderTop: '1px dashed #ede9fe' }}>
            {inputOperator ? (
              <button
                type="button"
                onClick={() => { appendLogicToken(inputOperator); setQuery(''); focusQueryInput(); }}
                style={{ border: '1px solid #c4b5fd', backgroundColor: '#ede9fe', color: C.purple, borderRadius: 7, padding: '4px 8px', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}
              >
                添加逻辑符 {inputOperator}
              </button>
            ) : suggestions.length > 0 ? suggestions.map(({ tag, count }) => (
              <button
                key={tag}
                type="button"
                onClick={() => addTag(tag)}
                style={{ border: '1px solid #e5e7eb', backgroundColor: '#fff', color: C.sub, borderRadius: 14, padding: '3px 8px', fontSize: 11, cursor: 'pointer' }}
              >
                ＋{tag} · {count}
              </button>
            )) : (
              <span style={{ padding: '3px 2px', fontSize: 10, color: '#9aa0a6' }}>没有匹配标签</span>
            )}
          </div>
        )}

        <div style={{ flexBasis: '100%', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 5, paddingTop: 7, borderTop: '1px dashed #ede9fe' }}>
          {[
            { token: 'AND' as const, title: '且：左右条件都满足' },
            { token: 'OR' as const, title: '或：左右条件满足一个即可' },
            { token: 'NOT' as const, title: '非：排除后面的条件' },
            { token: '(' as const, title: '左括号' },
            { token: ')' as const, title: '右括号' },
          ].map(({ token, title }) => (
          <button
            key={token}
            type="button"
            title={title}
            onClick={() => appendLogicTokenFromButton(token)}
            style={{ border: '1px solid #c4b5fd', backgroundColor: '#ede9fe', color: C.purple, borderRadius: 7, padding: '4px 8px', fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
          >
            {token}
          </button>
          ))}
          {logicParts.length > 0 && (
            <button
              type="button"
              onClick={() => { setLogicParts([]); setQuery(''); }}
              style={{ marginLeft: 'auto', border: 'none', background: 'none', color: C.sub, padding: '4px 2px', fontSize: 10, cursor: 'pointer' }}
            >
              清空逻辑
            </button>
          )}
        </div>
      </div>
      <div style={{ marginTop: 5, fontSize: 10, color: compiledLogic.error ? C.red : C.sub }} role={compiledLogic.error ? 'alert' : undefined}>
        {compiledLogic.error ? `逻辑有误：${compiledLogic.error}` : '非逻辑符输入会匹配标签；优先级：NOT ＞ AND ＞ OR。'}
      </div>
      </>}

      {!hasActiveFilter ? (
        <div style={{ marginTop: 9, fontSize: 11, color: C.sub }}>
          {rangedItems.length === 0 ? '该时间范围暂无账单。' : '选择账户，或输入标签前几个字符并点击匹配。'}
        </div>
      ) : compiledLogic.error ? (
        <div style={{ marginTop: 9, fontSize: 11, color: C.red }}>修正标签逻辑后即可查看统计结果。</div>
      ) : (
        <div style={compact ? undefined : { marginTop: 10, borderTop: '1px solid #ede9fe', paddingTop: 8 }}>
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
            style={{ width: '100%', border: 'none', background: 'none', padding: 0, display: 'flex', flexWrap: compact ? 'wrap' : undefined, justifyContent: 'space-between', alignItems: 'baseline', gap: 8, textAlign: 'left', cursor: 'pointer' }}
          >
            <span title={logicLabel} style={{ minWidth: 0, fontSize: 11, color: C.sub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {expanded ? '▾' : '▸'} {compact ? '账单明细' : '按当前筛选匹配'}
            </span>
            <span style={{ minWidth: 0, display: compact ? 'inline-flex' : undefined, alignItems: 'baseline', gap: 8, marginLeft: compact ? 'auto' : undefined, whiteSpace: compact ? 'nowrap' : undefined, fontSize: 13, fontWeight: 700, color: C.purple, fontVariantNumeric: 'tabular-nums', textAlign: 'right', lineHeight: 1.45 }}>
              {!compact && <>{amountLeadLabel} ·{' '}</>}
              <span style={{ ...surplusHighlightStyle(balanceAmount), display: 'inline-block', margin: '0 2px' }}>
                结余 {balanceAmount >= 0 ? '+' : '-'}¥{formatCurrency(Math.abs(balanceAmount))}
              </span>
              {!compact && <>{' '}· {matchedItems.length} 笔</>}
              {compact && <span style={{ fontSize: 10, fontWeight: 400, color: C.sub }}>日均 {formatBillCurrency(dailyAverageAmount)}</span>}
            </span>
          </button>
          {!compact && <div style={{ marginTop: 4, fontSize: 10, color: C.sub, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
            均 {formatBillCurrency(averageAmount)} · 占当前范围 {rangedShare.toFixed(1)}%
          </div>}
          {expanded && (
            <div style={{ marginTop: 6, maxHeight: 360, overflowY: 'auto' }}>
              {matchedItems.length === 0 ? (
                <div style={{ padding: '8px 0 2px', fontSize: 11, color: '#9aa0a6', textAlign: 'center' }}>暂无符合当前筛选的账单</div>
              ) : (
                <>
                  {matchedTransactionSections.map((section, sectionIndex) => {
                    const color = section.transactionType === '收入' ? C.red : C.green;
                    return (
                      <div key={section.transactionType} style={{ marginTop: sectionIndex > 0 ? 10 : 0, paddingTop: sectionIndex > 0 ? 9 : 0, borderTop: sectionIndex > 0 ? '1px solid #ede9fe' : 'none' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 3, color, fontSize: 11, fontWeight: 700 }}>
                          <span>{section.transactionType}</span>
                          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatBillCurrency(section.total)} · {section.items.length}笔</span>
                        </div>
                        {section.categoryGroups.map((group) => (
                          <CategoryRow
                            key={`${section.transactionType}-${group.category}`}
                            cat={group.category}
                            items={group.items}
                            total={section.total}
                            fullDate
                            hiddenTags={referencedTagSet}
                          />
                        ))}
                      </div>
                    );
                  })}
                  <CoreBillTagStats items={matchedItems} hiddenTags={referencedTagSet} />
                  <RepresentativeTagExpenses items={matchedItems} hiddenTags={referencedTagSet} />
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Category drill-down ────────────────────────────────────────────
export function ExpenseItemLine({ it, fullDate = false, hiddenTags }: { it: CategorizedBillItem; fullDate?: boolean; hiddenTags?: ReadonlySet<string> }) {
  const isIncome = it.transactionType === '收入';
  const detail = extractMeaningful(it.tags, it.note, hiddenTags) || it.subcategory || it.category || '—';
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '2px 0 2px 32px', color: '#5f6368' }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        <span style={{ color: C.sub, marginRight: 6 }}>{fullDate ? it.date : it.date.slice(5)}</span>
        {isIncome && <span style={{ color: C.red, marginRight: 6 }}>收入</span>}
        {detail}
      </span>
      <span style={{ color: isIncome ? C.red : 'inherit', fontVariantNumeric: 'tabular-nums', flexShrink: 0, marginLeft: 8 }}>{it.amount < 0 ? (isIncome ? '−' : '退款 −') : isIncome ? '+' : ''}¥{formatCurrency(it.amount)}</span>
    </div>
  );
}

const CORE_BILL_TAGS = [
  { label: '消费', color: C.purple },
  { label: '波动生活', color: C.orange },
  { label: '周期生活', color: C.blue },
  { label: '收入', color: C.red, hint: '含周期/波动' },
] as const;

function CoreBillTagStats({ items, hiddenTags }: { items: CategorizedBillItem[]; hiddenTags?: ReadonlySet<string> }) {
  // 四类是互斥的账单类型；任一类型已作为筛选条件时，整组汇总都不再重复展示。
  if (CORE_BILL_TAGS.some(({ label }) => hiddenTags?.has(label))) return null;
  const stats = CORE_BILL_TAGS.map((coreTag) => {
    const { label } = coreTag;
    const tagged = items.filter((item) => {
      if (label === '收入') return item.transactionType === '收入';
      if (item.transactionType === '收入') return false;
      return splitBillTags(item.tags).includes(label);
    });
    return {
      ...coreTag,
      count: tagged.length,
      amount: tagged.reduce((sum, item) => sum + item.amount, 0),
    };
  });
  return (
    <div style={{ margin: '8px 0 6px', paddingTop: 8, borderTop: '1px solid #ede9fe', display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 4 }}>
      {stats.map((stat) => (
        <div key={stat.label} style={{ minWidth: 0, padding: '4px 6px', borderRadius: 7, backgroundColor: `${stat.color}0d`, border: `1px solid ${stat.color}26` }}>
          <div style={{ fontSize: 9, color: stat.color, fontWeight: 700 }}>
            {stat.label}{'hint' in stat && stat.hint ? <span style={{ marginLeft: 3, fontWeight: 500 }}>· {stat.hint}</span> : null}
          </div>
          <div style={{ marginTop: 1, fontSize: 10, color: stat.count > 0 ? '#3c4043' : '#9aa0a6', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {formatBillCurrency(stat.amount)} · {stat.count}笔
          </div>
        </div>
      ))}
    </div>
  );
}

function RepresentativeTagExpenses({ items, hiddenTags }: { items: CategorizedBillItem[]; hiddenTags?: ReadonlySet<string> }) {
  const { tagCategory } = usePossessionStore();
  const rows = useMemo(() => {
    const expenseItems = items.filter((item) => item.transactionType === '支出');
    const tagIndices = new Map<string, Set<number>>();
    for (let index = 0; index < expenseItems.length; index += 1) {
      for (const tag of splitBillTags(expenseItems[index].tags)) {
        const isDailyTripTag = isDailyTripTagFormat(tag);
        if (hiddenTags?.has(tag) || CORE_BILL_TAGS.some(({ label }) => label === tag) || (isMajorExcludedTag(tag, tagCategory) && !isDailyTripTag)) continue;
        const indices = tagIndices.get(tag) ?? new Set<number>();
        indices.add(index);
        tagIndices.set(tag, indices);
      }
    }

    const candidateTags = [...tagIndices.keys()];
    const representativeTags = candidateTags.filter((tag) => {
      if (isDailyTripTagFormat(tag)) return true;
      const ownIndices = tagIndices.get(tag)!;
      return !candidateTags.some((otherTag) => {
        if (otherTag === tag) return false;
        const otherIndices = tagIndices.get(otherTag)!;
        if (otherIndices.size < ownIndices.size) return false;
        const isCovered = [...ownIndices].every((index) => otherIndices.has(index));
        if (!isCovered) return false;
        return otherIndices.size > ownIndices.size
          || (otherIndices.size === ownIndices.size && otherTag.localeCompare(tag, 'zh-CN') < 0);
      });
    });

    const sortedRows = representativeTags.map((tag) => {
      const indices = [...tagIndices.get(tag)!];
      const taggedItems = indices.map((index) => expenseItems[index]);
      const amount = taggedItems.reduce((sum, item) => sum + item.amount, 0);
      let consumptionAmount = 0;
      let lifeAmount = 0;
      for (const item of taggedItems) {
        const tags = splitBillTags(item.tags);
        if (tags.includes('消费')) consumptionAmount += item.amount;
        if (tags.includes('周期生活') || tags.includes('波动生活')) lifeAmount += item.amount;
      }
      return {
        tag,
        amount,
        count: taggedItems.length,
        type: consumptionAmount > lifeAmount ? '消费' as const : '生活' as const,
        isDailyTripTag: isDailyTripTagFormat(tag),
      };
    }).sort((a, b) => b.amount - a.amount || a.tag.localeCompare(b.tag, 'zh-CN'));
    const dailyTripRows = sortedRows.filter((row) => row.isDailyTripTag);
    const otherRows = sortedRows.filter((row) => !row.isDailyTripTag);
    return [...dailyTripRows, ...otherRows.slice(0, Math.max(0, 8 - dailyTripRows.length))]
      .sort((a, b) => b.amount - a.amount || a.tag.localeCompare(b.tag, 'zh-CN'));
  }, [hiddenTags, items, tagCategory]);

  if (rows.length === 0) return null;
  const amounts = rows.map((row) => row.amount);
  const maxAmount = Math.max(...amounts);
  const minAmount = Math.min(...amounts);
  return (
    <div style={{ margin: '8px 0 5px', paddingTop: 7, borderTop: '1px solid #ede9fe' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 5, fontSize: 10, color: C.sub }}>
        <span style={{ fontWeight: 700, color: '#202124' }}>支出标签</span>
        <span>金额前 {rows.length} 项</span>
      </div>
      {rows.map((row) => {
        const ratio = maxAmount > minAmount ? (row.amount - minAmount) / (maxAmount - minAmount) : 1;
        const hue = 120 - ratio * 120;
        const typeColor = row.type === '生活' ? C.blue : C.purple;
        return (
          <div key={row.tag} style={{ display: 'grid', gridTemplateColumns: '34px minmax(0, 1fr) 68px', gap: 4, alignItems: 'center', marginBottom: 3 }}>
            <span style={{ padding: '3px 1px', border: `1px solid ${typeColor}`, borderRadius: 5, backgroundColor: `${typeColor}0d`, color: typeColor, fontSize: 9, fontWeight: 700, textAlign: 'center' }}>
              {row.type}
            </span>
            <span title={row.tag} style={{ minWidth: 0, padding: '2px 3px', color: '#202124', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {row.tag}<span style={{ marginLeft: 4, color: '#9aa0a6', fontSize: 9 }}>· {row.count}笔</span>
            </span>
            <span style={{ padding: '3px 5px', border: `1px solid hsl(${hue}, 65%, 55%)`, borderRadius: 5, backgroundColor: `hsl(${hue}, 72%, 92%)`, color: `hsl(${hue}, 70%, 30%)`, fontSize: 10, fontWeight: 700, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              {formatBillCurrency(row.amount)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function SubcategoryRow({ sub, items, total, fullDate = false, hiddenTags }: { sub: string; items: CategorizedBillItem[]; total: number; fullDate?: boolean; hiddenTags?: ReadonlySet<string> }) {
  const [open, setOpen] = useState(false);
  const sum = items.reduce((s, i) => s + i.amount, 0);
  const pct = total > 0 ? (sum / total) * 100 : 0;
  const sorted = [...items].sort((a, b) => b.amount - a.amount);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{ width: '100%', display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0 3px 16px', cursor: 'pointer', color: '#3c4043', border: 'none', background: 'none', textAlign: 'left' }}
      >
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{open ? '▼' : '▶'} {sub || '(无二级分类)'}</span>
        <span style={{ flexShrink: 0, marginLeft: 8, fontVariantNumeric: 'tabular-nums' }}>{formatBillCurrency(sum)} · {items.length}笔 · {pct.toFixed(1)}%</span>
      </button>
      {open && sorted.map((it, i) => <ExpenseItemLine key={`${it.date}-${it.amount}-${it.note}-${i}`} it={it} fullDate={fullDate} hiddenTags={hiddenTags} />)}
    </div>
  );
}

export function CategoryRow({ cat, items, total, fullDate = false, hiddenTags }: { cat: string; items: CategorizedBillItem[]; total: number; fullDate?: boolean; hiddenTags?: ReadonlySet<string> }) {
  const [open, setOpen] = useState(false);
  const sum = items.reduce((s, i) => s + i.amount, 0);
  const pct = total > 0 ? (sum / total) * 100 : 0;
  const subMap = new Map<string, CategorizedBillItem[]>();
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
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{ width: '100%', display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', cursor: 'pointer', color: '#202124', fontWeight: 500, border: 'none', background: 'none', textAlign: 'left' }}
      >
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{open ? '▼' : '▶'} {cat || '(未分类)'}</span>
        <span style={{ flexShrink: 0, marginLeft: 8, fontVariantNumeric: 'tabular-nums' }}>{formatBillCurrency(sum)} · {items.length}笔 · {pct.toFixed(1)}%</span>
      </button>
      {open && subs.map((s) => <SubcategoryRow key={s.sub} sub={s.sub} items={s.items} total={total} fullDate={fullDate} hiddenTags={hiddenTags} />)}
    </div>
  );
}
