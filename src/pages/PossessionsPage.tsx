import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../components/Card';
import CurrencyDisplay, { formatCurrency } from '../components/CurrencyDisplay';
import AmountInput from '../components/AmountInput';
import { calcConsumableStats, calcDurableStats, type ConsumableStats } from '../calculations/possessions';
import { tagMeta } from '../data/mockData';
import type { PossessionItem, PossessionKind, TagKind } from '../models/types';
import { useBillDetailStore } from '../stores/billDetailStore';
import { useCalendarStore } from '../stores/calendarStore';
import {
  resolveExpenseScope,
  useExpenseScopeOverrideStore,
  type ExpenseScope,
} from '../stores/expenseScopeOverrideStore';
import { usePossessionStore } from '../stores/possessionStore';
import { parsePossessionQuantity } from '../utils/autoImportPossessions';
import { assignExpenseIds, type BillExpenseItem } from '../utils/importBill';
import { isTripTagFormat } from '../utils/trips';

const C = { blue: '#1a73e8', red: '#ea4335', green: '#0d9488', sub: '#5f6368', orange: '#e8710a', purple: '#7c3aed' };
const TAG_KINDS: TagKind[] = ['school', 'home', 'travel'];
const SCOPE_LABEL: Record<ExpenseScope, string> = { local: '本地', shared: '共享' };

type TabKind = PossessionKind;
type StatusFilter = 'all' | 'active' | 'retired';
type ScopeFilter = 'all' | ExpenseScope;
type SceneFilter = 'all' | TagKind;

interface BillChoice {
  id: string;
  item: BillExpenseItem;
  yearMonth: string;
}

interface ItemForm {
  kind: PossessionKind;
  name: string;
  category: string;
  icon: string;
  unit: string;
}

interface TxnForm {
  itemId: string;
  date: string;
  amount: string;
  quantity: string;
  kind: 'purchase' | 'resale';
  billItemId: string;
  scope: ExpenseScope;
  scene: TagKind;
  note: string;
}

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function normalizeAmountInput(v: string) {
  return /^-?0\d/.test(v) ? (v.replace(/^(-?)0+/, '$1') || '0') : v;
}

function numberFromInput(raw: string) {
  const value = parseFloat(raw);
  return Number.isFinite(value) ? value : 0;
}

function txnKindLabel(kind: 'purchase' | 'resale', itemKind: PossessionKind) {
  if (itemKind === 'consumable') return '补货';
  return kind === 'purchase' ? '购入' : '卖出';
}

function retiredLabel(kind: PossessionKind) {
  return kind === 'consumable' ? '已用完' : '已卖出';
}

function retiredFilterLabel(tab: TabKind) {
  return tab === 'consumable' ? '已用完' : '已结束';
}

function tagsOf(item: BillExpenseItem) {
  return item.tags.split(',').map((tag) => tag.trim()).filter(Boolean);
}

function itemIsDone(item: PossessionItem) {
  if (item.kind === 'durable') return item.status === 'retired';
  const purchases = item.txns.filter((txn) => txn.kind === 'purchase');
  return purchases.length > 0 && purchases.every((txn) => txn.done);
}

function itemIsActive(item: PossessionItem) {
  if (item.kind === 'durable') return item.status === 'active';
  return !itemIsDone(item);
}

function txnUnitPrice(amount: number, quantity?: number) {
  return quantity && quantity > 0 ? amount / quantity : 0;
}

function formatQty(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function Modal({
  title,
  children,
  footer,
  onClose,
}: {
  title: string;
  children: ReactNode;
  footer: ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, backgroundColor: 'rgba(32,33,36,0.32)' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 430, maxHeight: '88vh', display: 'flex', flexDirection: 'column', backgroundColor: '#fff', borderRadius: 16, boxShadow: '0 16px 48px rgba(0,0,0,0.2)', overflow: 'hidden' }}
      >
        <div style={{ padding: '18px 20px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>{title}</div>
          <button type="button" onClick={onClose} style={{ border: 'none', background: 'transparent', color: '#9aa0a6', fontSize: 22, lineHeight: 1, cursor: 'pointer', padding: 0 }}>×</button>
        </div>
        <div style={{ padding: '0 20px 16px', overflowY: 'auto' }}>{children}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 20px 18px', borderTop: '1px solid #f1f3f4' }}>
          {footer}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: C.sub }}>{label}</span>
      {children}
    </label>
  );
}

const inputStyle = {
  width: '100%',
  border: '1px solid #e0e0e0',
  borderRadius: 10,
  padding: '9px 10px',
  outline: 'none',
  backgroundColor: '#fff',
  fontSize: 13,
} as const;

function MiniButton({
  active,
  children,
  onClick,
}: {
  active?: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ border: `1px solid ${active ? C.blue : '#dadce0'}`, backgroundColor: active ? '#e8f0fe' : '#fff', color: active ? C.blue : C.sub, borderRadius: 999, padding: '6px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
    >
      {children}
    </button>
  );
}

function ScopeBreakdown({ stats }: { stats: ConsumableStats }) {
  const localPct = stats.byScope.local.share * 100;
  const sharedPct = stats.byScope.shared.share * 100;
  const sceneParts = TAG_KINDS
    .filter((key) => stats.byScene[key].cost > 0)
    .map((key) => `${tagMeta[key].label} ${(stats.byScene[key].share * 100).toFixed(0)}%`);
  return (
    <div style={{ marginTop: 10, padding: '10px 0', borderTop: '1px dashed #e0e0e0', borderBottom: '1px dashed #e0e0e0' }}>
      <div style={{ height: 8, display: 'flex', overflow: 'hidden', borderRadius: 999, backgroundColor: '#f1f3f4', marginBottom: 7 }}>
        <div style={{ width: `${localPct}%`, backgroundColor: C.blue }} />
        <div style={{ width: `${sharedPct}%`, backgroundColor: C.green }} />
      </div>
      <div style={{ fontSize: 11, color: C.sub, lineHeight: 1.6 }}>
        本地 {localPct.toFixed(0)}%
        {sceneParts.length > 0 && ` (${sceneParts.join(' · ')})`}
        {' · '}共享 {sharedPct.toFixed(0)}%
      </div>
    </div>
  );
}

export default function PossessionsPage() {
  const navigate = useNavigate();
  const today = todayKey();
  const { items, excludedNameTags, addItem, updateItem, removeItem, addTxn, removeTxn, setTxnDone, setStatus, toggleExcludedNameTag } = usePossessionStore();
  const { expenseItems } = useBillDetailStore();
  const { tagMap } = useCalendarStore();
  const { overrides } = useExpenseScopeOverrideStore();

  const [tab, setTab] = useState<TabKind>('consumable');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('all');
  const [sceneFilter, setSceneFilter] = useState<SceneFilter>('all');
  const [itemForm, setItemForm] = useState<ItemForm | null>(null);
  const [txnForm, setTxnForm] = useState<TxnForm | null>(null);
  const [billPickerOpen, setBillPickerOpen] = useState(false);
  const [billPeriodicOnly, setBillPeriodicOnly] = useState(true);
  const [billQuery, setBillQuery] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [nameTagQuery, setNameTagQuery] = useState('');

  const billChoices = useMemo<BillChoice[]>(() => (
    Object.entries(expenseItems)
      .flatMap(([yearMonth, monthItems]) => assignExpenseIds(monthItems).map(({ item, id }) => ({ id, item, yearMonth })))
      .sort((a, b) => b.item.date.localeCompare(a.item.date))
  ), [expenseItems]);

  const nameTagCandidates = useMemo(() => {
    const counts = new Map<string, number>();
    for (const choice of billChoices) {
      for (const tag of tagsOf(choice.item)) {
        if (isTripTagFormat(tag)) continue; // 出游 tag（yy.m.d 描述）不算物品名候选
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    const q = nameTagQuery.trim().toLowerCase();
    return [...counts.entries()]
      .filter(([tag]) => !q || tag.toLowerCase().includes(q))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'))
      .slice(0, 80);
  }, [billChoices, nameTagQuery]);

  const excludedNameTagSet = useMemo(() => new Set(excludedNameTags), [excludedNameTags]);

  const referencedBillMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items) {
      for (const txn of item.txns) {
        if (txn.billItemId && !map.has(txn.billItemId)) map.set(txn.billItemId, item.name);
      }
    }
    return map;
  }, [items]);

  const categories = useMemo(() => (
    [...new Set(items.map((item) => item.category?.trim()).filter((v): v is string => Boolean(v)))].sort()
  ), [items]);

  const activeItems = items.filter(itemIsActive);
  const activeConsumables = items.filter((item) => item.kind === 'consumable' && itemIsActive(item));
  const durableItems = items.filter((item) => item.kind === 'durable');
  const consumableMonthlyCost = activeConsumables.reduce((sum, item) => sum + calcConsumableStats(item, today).monthlyCost, 0);
  const activeConsumableStock = activeConsumables.reduce((sum, item) => sum + calcConsumableStats(item, today).activeQty, 0);
  const durableNetCost = durableItems.reduce((sum, item) => sum + calcDurableStats(item, today).netCost, 0);

  const filteredItems = items.filter((item) => {
    if (item.kind !== tab) return false;
    if (statusFilter === 'active' && !itemIsActive(item)) return false;
    if (statusFilter === 'retired' && !itemIsDone(item)) return false;
    if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;
    if (item.kind === 'consumable') {
      if (scopeFilter !== 'all' && !item.txns.some((txn) => txn.scope === scopeFilter)) return false;
      if (sceneFilter !== 'all' && !item.txns.some((txn) => txn.scope === 'local' && txn.scene === sceneFilter)) return false;
    }
    return true;
  });

  const txnItem = txnForm ? items.find((item) => item.id === txnForm.itemId) : undefined;
  const selectedBill = txnForm?.billItemId
    ? billChoices.find((choice) => choice.id === txnForm.billItemId)
    : undefined;

  const visibleBillChoices = useMemo(() => {
    if (!txnItem) return [];
    const q = billQuery.trim().toLowerCase();
    return billChoices.filter((choice) => {
      if (txnItem.kind === 'consumable' && billPeriodicOnly && !tagsOf(choice.item).includes('周期生活')) return false;
      if (!q) return true;
      const searchable = `${choice.item.date} ${choice.item.category} ${choice.item.subcategory} ${choice.item.note} ${choice.item.tags}`.toLowerCase();
      return searchable.includes(q);
    }).slice(0, 80);
  }, [billChoices, billPeriodicOnly, billQuery, txnItem]);

  const openItemModal = (kind: PossessionKind = tab) => {
    setItemForm({
      kind,
      name: '',
      category: '',
      icon: kind === 'consumable' ? '🧴' : '📷',
      unit: kind === 'consumable' ? '个' : '',
    });
  };

  const saveItem = () => {
    if (!itemForm || !itemForm.name.trim()) return;
    addItem({
      kind: itemForm.kind,
      name: itemForm.name.trim(),
      category: itemForm.category.trim() || undefined,
      icon: itemForm.icon.trim() || undefined,
      unit: itemForm.kind === 'consumable' ? (itemForm.unit.trim() || '个') : undefined,
      retiredAt: undefined,
    });
    setTab(itemForm.kind);
    setItemForm(null);
  };

  const openTxnModal = (item: PossessionItem) => {
    const lastConsumableTxn = [...item.txns].reverse().find((txn) => txn.scope === 'local' || txn.scope === 'shared');
    const scene = tagMap[today] ?? lastConsumableTxn?.scene ?? 'school';
    setBillPickerOpen(false);
    setBillQuery('');
    setBillPeriodicOnly(item.kind === 'consumable');
    setTxnForm({
      itemId: item.id,
      date: today,
      amount: '',
      quantity: item.kind === 'consumable' ? '1' : '',
      kind: 'purchase',
      billItemId: '',
      scope: lastConsumableTxn?.scope ?? 'local',
      scene,
      note: '',
    });
  };

  const saveTxn = () => {
    if (!txnForm || !txnItem) return;
    const amount = numberFromInput(txnForm.amount);
    const quantity = numberFromInput(txnForm.quantity);
    if (!txnForm.date || amount <= 0) return;
    if (txnItem.kind === 'consumable' && quantity <= 0) return;
    addTxn(txnItem.id, {
      date: txnForm.date,
      amount,
      quantity: txnItem.kind === 'consumable' ? quantity : undefined,
      kind: txnItem.kind === 'consumable' ? 'purchase' : txnForm.kind,
      billItemId: txnForm.billItemId || undefined,
      scope: txnItem.kind === 'consumable' ? txnForm.scope : undefined,
      scene: txnItem.kind === 'consumable' && txnForm.scope === 'local' ? txnForm.scene : undefined,
      note: txnForm.note.trim() || undefined,
    });
    if (txnItem.kind === 'durable' && txnForm.kind === 'resale') setStatus(txnItem.id, 'retired', txnForm.date);
    setTxnForm(null);
  };

  const selectBill = (choice: BillChoice) => {
    if (!txnForm || !txnItem) return;
    const inferredScope = txnItem.kind === 'consumable' ? resolveExpenseScope(choice.item, overrides) : null;
    const parsedQuantity = txnItem.kind === 'consumable' ? parsePossessionQuantity(choice.item) : null;
    setTxnForm({
      ...txnForm,
      date: choice.item.date,
      amount: String(choice.item.amount),
      quantity: parsedQuantity ? String(parsedQuantity.quantity) : txnForm.quantity,
      billItemId: choice.id,
      scope: inferredScope ?? txnForm.scope,
      scene: tagMap[choice.item.date] ?? txnForm.scene,
      note: choice.item.note || txnForm.note,
    });
    if (parsedQuantity?.unit && (!txnItem.unit || txnItem.unit === '个')) updateItem(txnItem.id, { unit: parsedQuantity.unit });
    setBillPickerOpen(false);
  };

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
        <div>
          <button type="button" onClick={() => navigate('/')} style={{ border: 'none', background: 'transparent', color: C.sub, fontSize: 12, padding: 0, marginBottom: 4, cursor: 'pointer' }}>
            ← 主页
          </button>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>物品台账</h1>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={() => setSettingsOpen(true)} title="设置" style={{ border: '1px solid #dadce0', borderRadius: 12, backgroundColor: '#fff', color: C.sub, fontSize: 15, fontWeight: 800, padding: '8px 10px', cursor: 'pointer' }}>
            ⚙️
          </button>
          <button type="button" onClick={() => openItemModal()} style={{ border: 'none', borderRadius: 12, backgroundColor: C.blue, color: '#fff', fontSize: 13, fontWeight: 800, padding: '9px 12px', cursor: 'pointer', boxShadow: '0 4px 12px rgba(26,115,232,0.22)' }}>
            + 物品
          </button>
        </div>
      </div>

      <Card title="持有概览" subtitle="本地持久化">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, marginBottom: 10 }}>
          {[
            { label: '在用', value: activeItems.length, color: C.blue },
            { label: '消耗品', value: activeConsumables.length, color: C.green },
            { label: '在库数量', value: activeConsumableStock, color: C.orange },
          ].map((row) => (
            <div key={row.label} style={{ border: '1px solid #f1f3f4', borderRadius: 10, padding: '9px 8px', backgroundColor: '#f8f9fa', minWidth: 0 }}>
              <div style={{ fontSize: 11, color: C.sub, marginBottom: 3 }}>{row.label}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: row.color, fontVariantNumeric: 'tabular-nums' }}>{typeof row.value === 'number' ? formatQty(row.value) : row.value}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div style={{ border: '1px solid #f1f3f4', borderRadius: 10, padding: '10px 10px', backgroundColor: '#fff' }}>
            <div style={{ fontSize: 11, color: C.sub, marginBottom: 5 }}>长期净支出</div>
            <CurrencyDisplay value={durableNetCost} color={C.purple} size="lg" />
          </div>
          <div style={{ border: '1px solid #f1f3f4', borderRadius: 10, padding: '10px 10px', backgroundColor: '#fff' }}>
            <div style={{ fontSize: 11, color: C.sub, marginBottom: 5 }}>消耗月均</div>
            <CurrencyDisplay value={consumableMonthlyCost} color={C.green} size="lg" />
          </div>
        </div>
      </Card>

      <div style={{ display: 'flex', backgroundColor: '#e8eaed', borderRadius: 12, padding: 3, gap: 3, marginBottom: 10 }}>
        {[
          { key: 'consumable' as const, label: '消耗品' },
          { key: 'durable' as const, label: '长期物品' },
        ].map((option) => {
          const active = tab === option.key;
          return (
            <button
              key={option.key}
              type="button"
              onClick={() => setTab(option.key)}
              style={{ flex: 1, border: 'none', borderRadius: 10, padding: '8px 0', backgroundColor: active ? '#fff' : 'transparent', color: active ? C.blue : C.sub, fontSize: 13, fontWeight: 800, cursor: 'pointer', boxShadow: active ? '0 1px 2px rgba(0,0,0,0.12)' : 'none' }}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} style={{ ...inputStyle, width: 'auto', padding: '7px 9px', fontSize: 12 }}>
          <option value="all">全部状态</option>
          <option value="active">在用</option>
          <option value="retired">{retiredFilterLabel(tab)}</option>
        </select>
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} style={{ ...inputStyle, width: 'auto', padding: '7px 9px', fontSize: 12, maxWidth: 138 }}>
          <option value="all">全部分类</option>
          {categories.map((category) => <option key={category} value={category}>{category}</option>)}
        </select>
        {tab === 'consumable' && (
          <>
            <select value={scopeFilter} onChange={(e) => setScopeFilter(e.target.value as ScopeFilter)} style={{ ...inputStyle, width: 'auto', padding: '7px 9px', fontSize: 12 }}>
              <option value="all">全部范围</option>
              <option value="local">本地</option>
              <option value="shared">共享</option>
            </select>
            <select value={sceneFilter} onChange={(e) => setSceneFilter(e.target.value as SceneFilter)} style={{ ...inputStyle, width: 'auto', padding: '7px 9px', fontSize: 12 }}>
              <option value="all">全部场景</option>
              {TAG_KINDS.map((key) => <option key={key} value={key}>{tagMeta[key].icon} {tagMeta[key].label}</option>)}
            </select>
          </>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {filteredItems.length === 0 && (
          <div style={{ border: '1px dashed #dadce0', borderRadius: 14, backgroundColor: '#fff', color: C.sub, fontSize: 13, textAlign: 'center', padding: '24px 12px' }}>
            暂无物品
          </div>
        )}
        {filteredItems.map((item) => {
          const expanded = expandedIds.has(item.id);
          const consumableStats = item.kind === 'consumable' ? calcConsumableStats(item, today) : null;
          const durableStats = item.kind === 'durable' ? calcDurableStats(item, today) : null;
          const done = itemIsDone(item);
          const activeBatchCount = item.kind === 'consumable'
            ? item.txns.filter((txn) => txn.kind === 'purchase' && !txn.done).length
            : 0;
          return (
            <section key={item.id} style={{ backgroundColor: '#fff', borderRadius: 14, boxShadow: '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
              <button
                type="button"
                onClick={() => toggleExpanded(item.id)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, border: 'none', backgroundColor: '#fff', padding: '14px 14px', cursor: 'pointer', textAlign: 'left' }}
              >
                <span style={{ width: 36, height: 36, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f1f3f4', fontSize: 21, flexShrink: 0 }}>
                  {item.icon || (item.kind === 'consumable' ? '🧴' : '📦')}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    <span style={{ fontSize: 14, fontWeight: 800, color: '#202124', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
                    {item.category && <span style={{ fontSize: 10, color: C.sub, backgroundColor: '#f1f3f4', borderRadius: 999, padding: '2px 6px', flexShrink: 0 }}>{item.category}</span>}
                    {done && <span style={{ fontSize: 10, color: C.orange, backgroundColor: '#fff4e8', borderRadius: 999, padding: '2px 6px', flexShrink: 0 }}>{retiredLabel(item.kind)}</span>}
                  </span>
                  <span style={{ display: 'block', marginTop: 4, fontSize: 12, color: C.sub, lineHeight: 1.5 }}>
                    {consumableStats && (
                      <>
                        在用 {activeBatchCount} 批 · 剩 {formatQty(consumableStats.estimatedRemainingQty)} {item.unit || '个'} · 日均 {formatQty(consumableStats.avgUsagePerDay)} {item.unit || '个'} · 最低 <CurrencyDisplay value={consumableStats.minPricePerUnit} size="sm" />
                      </>
                    )}
                    {durableStats && (
                      <>
                        持有 {durableStats.days} 天 · 净 <CurrencyDisplay value={durableStats.netCost} size="sm" /> · 日均 <CurrencyDisplay value={durableStats.costPerDay} size="sm" />
                        {durableStats.resale && <> · 已卖出 <CurrencyDisplay value={durableStats.resale.amount} size="sm" /></>}
                      </>
                    )}
                  </span>
                </span>
                <span style={{ color: '#9aa0a6', fontSize: 13, transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.18s' }}>▼</span>
              </button>

              {expanded && (
                <div style={{ padding: '0 14px 14px', borderTop: '1px solid #f1f3f4' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: item.kind === 'consumable' ? '1fr 82px' : '1fr 110px', gap: 8, paddingTop: 12 }}>
                    <input
                      value={item.category ?? ''}
                      onChange={(e) => updateItem(item.id, { category: e.target.value || undefined })}
                      placeholder="分类"
                      style={{ ...inputStyle, padding: '7px 8px', fontSize: 12 }}
                    />
                    {item.kind === 'consumable' && (
                      <input
                        value={item.unit ?? ''}
                        onChange={(e) => updateItem(item.id, { unit: e.target.value || undefined })}
                        placeholder="单位"
                        style={{ ...inputStyle, padding: '7px 8px', fontSize: 12 }}
                      />
                    )}
                    {item.kind === 'durable' && (
                      <select
                        value={item.status}
                        onChange={(e) => setStatus(item.id, e.target.value as 'active' | 'retired', e.target.value === 'retired' ? (item.retiredAt ?? today) : undefined)}
                        style={{ ...inputStyle, padding: '7px 8px', fontSize: 12 }}
                      >
                        <option value="active">持有中</option>
                        <option value="retired">{retiredLabel(item.kind)}</option>
                      </select>
                    )}
                  </div>
                  {item.kind === 'durable' && item.status === 'retired' && (
                    <input
                      type="date"
                      value={item.retiredAt ?? today}
                      onChange={(e) => setStatus(item.id, 'retired', e.target.value)}
                      style={{ ...inputStyle, marginTop: 8, padding: '7px 8px', fontSize: 12 }}
                    />
                  )}
                  {consumableStats && (
                    <>
                      <div style={{ marginTop: 10, padding: '10px 0', borderTop: '1px dashed #e0e0e0', borderBottom: '1px dashed #e0e0e0' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
                          {[
                            { label: '最近单价', value: consumableStats.latestPricePerUnit, color: C.blue },
                            { label: '平均单价', value: consumableStats.avgPricePerUnit, color: C.green },
                            { label: '最低单价', value: consumableStats.minPricePerUnit, color: C.orange },
                          ].map((row) => (
                            <div key={row.label} style={{ backgroundColor: '#f8f9fa', borderRadius: 10, padding: '8px 7px', minWidth: 0 }}>
                              <div style={{ fontSize: 10, color: C.sub, marginBottom: 3 }}>{row.label}</div>
                              <CurrencyDisplay value={row.value} size="sm" color={row.color} />
                            </div>
                          ))}
                        </div>
                        <div style={{ marginTop: 10 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11, color: C.sub, marginBottom: 5 }}>
                            <span>在用进度 {Math.round(consumableStats.progress * 100)}%</span>
                            <span>{formatQty(consumableStats.estimatedRemainingQty)} / {formatQty(consumableStats.activeQty)} {item.unit || '个'}</span>
                          </div>
                          <div style={{ height: 8, borderRadius: 999, overflow: 'hidden', backgroundColor: '#f1f3f4' }}>
                            <div style={{ width: `${Math.round(consumableStats.progress * 100)}%`, height: '100%', backgroundColor: C.green }} />
                          </div>
                          <div style={{ marginTop: 6, fontSize: 11, color: C.sub, lineHeight: 1.6 }}>
                            日均 {formatQty(consumableStats.avgUsagePerDay)} {item.unit || '个'} · 月均 {formatQty(consumableStats.avgUsagePerMonth)} {item.unit || '个'}
                            {consumableStats.runoutDate ? ` · 预计 ${consumableStats.runoutDate} 用完` : ' · 暂无用完预估'}
                          </div>
                        </div>
                      </div>
                      <ScopeBreakdown stats={consumableStats} />
                    </>
                  )}
                  {durableStats && (
                    <div style={{ marginTop: 10, padding: '10px 0', borderTop: '1px dashed #e0e0e0', borderBottom: '1px dashed #e0e0e0', fontSize: 12, color: C.sub }}>
                      {durableStats.label} · 从 {durableStats.startDate ?? '未购入'} 到 {durableStats.endDate}
                    </div>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, marginBottom: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: '#202124' }}>账单批次</div>
                    <button type="button" onClick={() => openTxnModal(item)} style={{ border: 'none', borderRadius: 999, backgroundColor: '#e8f0fe', color: C.blue, padding: '5px 10px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                      + 新增动作
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {item.txns.length === 0 && <div style={{ fontSize: 12, color: C.sub, backgroundColor: '#f8f9fa', borderRadius: 10, padding: '9px 10px' }}>暂无动作</div>}
                    {item.txns.map((txn) => {
                      const price = txnUnitPrice(txn.amount, txn.quantity);
                      const isConsumablePurchase = item.kind === 'consumable' && txn.kind === 'purchase';
                      return (
                        <div key={txn.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, backgroundColor: txn.done ? '#fffaf4' : '#f8f9fa', border: `1px solid ${txn.done ? '#fce8d6' : '#f1f3f4'}`, borderRadius: 10, padding: '8px 9px' }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 12, fontWeight: 800 }}>{txn.date}</span>
                              <span style={{ fontSize: 10, color: txn.kind === 'resale' ? C.green : C.blue, backgroundColor: txn.kind === 'resale' ? '#e6f4ea' : '#e8f0fe', borderRadius: 999, padding: '2px 6px' }}>{txnKindLabel(txn.kind, item.kind)}</span>
                              {isConsumablePurchase && (
                                <button
                                  type="button"
                                  onClick={() => setTxnDone(item.id, txn.id, !txn.done, txn.doneAt ?? today)}
                                  style={{ border: 'none', backgroundColor: txn.done ? '#fff4e8' : '#e6f4ea', color: txn.done ? C.orange : C.green, borderRadius: 999, padding: '2px 6px', fontSize: 10, fontWeight: 800, cursor: 'pointer' }}
                                >
                                  {txn.done ? '已用完' : '在用'}
                                </button>
                              )}
                              {txn.quantity !== undefined && <span style={{ fontSize: 11, color: C.sub }}>{formatQty(txn.quantity)} {item.unit || '个'}</span>}
                              {price > 0 && <span style={{ fontSize: 11, color: C.sub }}>单价 ¥{formatCurrency(price)}</span>}
                              {txn.scope && <span style={{ fontSize: 11, color: C.sub }}>{SCOPE_LABEL[txn.scope]}{txn.scope === 'local' && txn.scene ? ` · ${tagMeta[txn.scene].label}` : ''}</span>}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginTop: 4, fontSize: 11, color: C.sub }}>
                              <CurrencyDisplay value={txn.amount} size="sm" color={txn.kind === 'resale' ? C.green : undefined} />
                              {txn.billItemId && <span style={{ color: C.blue }}>已关联账单</span>}
                              {txn.doneAt && <span>用完日 {txn.doneAt}</span>}
                              {txn.note && <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{txn.note}</span>}
                            </div>
                          </div>
                          <button type="button" onClick={() => removeTxn(item.id, txn.id)} style={{ border: 'none', background: 'transparent', color: '#bdc1c6', fontSize: 17, lineHeight: 1, padding: 0, cursor: 'pointer' }}>×</button>
                        </div>
                      );
                    })}
                  </div>
                  <button type="button" onClick={() => removeItem(item.id)} style={{ width: '100%', marginTop: 10, border: '1px solid #fad2cf', borderRadius: 10, color: C.red, backgroundColor: '#fff', padding: '7px 0', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                    删除物品
                  </button>
                </div>
              )}
            </section>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => openItemModal()}
        style={{ position: 'fixed', right: 'max(16px, calc((100vw - 480px) / 2 + 16px))', bottom: 'calc(env(safe-area-inset-bottom, 0px) + 76px)', width: 50, height: 50, borderRadius: '50%', border: 'none', backgroundColor: C.blue, color: '#fff', fontSize: 24, fontWeight: 700, cursor: 'pointer', boxShadow: '0 8px 24px rgba(26,115,232,0.35)', zIndex: 60 }}
      >
        +
      </button>

      {itemForm && (
        <Modal
          title="新增物品"
          onClose={() => setItemForm(null)}
          footer={(
            <>
              <button type="button" onClick={() => setItemForm(null)} style={{ border: '1px solid #dadce0', backgroundColor: '#fff', color: C.sub, borderRadius: 10, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>取消</button>
              <button type="button" onClick={saveItem} style={{ border: 'none', backgroundColor: C.blue, color: '#fff', borderRadius: 10, padding: '8px 16px', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>保存</button>
            </>
          )}
        >
          <Field label="类型">
            <div style={{ display: 'flex', gap: 8 }}>
              <MiniButton active={itemForm.kind === 'consumable'} onClick={() => setItemForm({ ...itemForm, kind: 'consumable', icon: itemForm.icon || '🧴', unit: itemForm.unit || '个' })}>消耗品</MiniButton>
              <MiniButton active={itemForm.kind === 'durable'} onClick={() => setItemForm({ ...itemForm, kind: 'durable', icon: itemForm.icon || '📷', unit: '' })}>长期物品</MiniButton>
            </div>
          </Field>
          <Field label="名称">
            <input value={itemForm.name} onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })} style={inputStyle} autoFocus />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '82px 1fr', gap: 8 }}>
            <Field label="图标">
              <input value={itemForm.icon} onChange={(e) => setItemForm({ ...itemForm, icon: e.target.value.slice(0, 2) })} style={inputStyle} />
            </Field>
            <Field label="分类">
              <input value={itemForm.category} onChange={(e) => setItemForm({ ...itemForm, category: e.target.value })} style={inputStyle} />
            </Field>
          </div>
          {itemForm.kind === 'consumable' && (
            <Field label="单位">
              <input value={itemForm.unit} onChange={(e) => setItemForm({ ...itemForm, unit: e.target.value })} style={inputStyle} />
            </Field>
          )}
        </Modal>
      )}

      {settingsOpen && (
        <Modal
          title="物品设置"
          onClose={() => setSettingsOpen(false)}
          footer={(
            <button type="button" onClick={() => setSettingsOpen(false)} style={{ border: 'none', backgroundColor: C.blue, color: '#fff', borderRadius: 10, padding: '8px 16px', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>完成</button>
          )}
        >
          <Field label="不能作为物品名称的标签">
            <input value={nameTagQuery} onChange={(e) => setNameTagQuery(e.target.value)} placeholder="搜索标签" style={inputStyle} autoFocus />
          </Field>

          <div style={{ fontSize: 12, fontWeight: 700, color: C.sub, marginTop: 12, marginBottom: 4 }}>
            已选 · {excludedNameTags.length}
          </div>
          <div style={{ maxHeight: 80, overflowY: 'auto', display: 'flex', gap: 4, flexWrap: 'wrap', paddingRight: 2, border: '1px solid #f1f3f4', borderRadius: 8, padding: 6, backgroundColor: '#fafbfc' }}>
            {excludedNameTags.length === 0 ? (
              <div style={{ fontSize: 11, color: C.sub, padding: '2px 4px' }}>未选标签</div>
            ) : excludedNameTags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => toggleExcludedNameTag(tag)}
                style={{ border: '1px solid #d2e3fc', backgroundColor: '#e8f0fe', color: C.blue, borderRadius: 999, padding: '2px 7px', fontSize: 10, fontWeight: 700, cursor: 'pointer', lineHeight: 1.4 }}
              >
                {tag} ×
              </button>
            ))}
          </div>

          <div style={{ fontSize: 12, fontWeight: 700, color: C.sub, marginTop: 12, marginBottom: 4 }}>
            候选 · {nameTagCandidates.length}
          </div>
          <div style={{ maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4, border: '1px solid #f1f3f4', borderRadius: 8, padding: 6, backgroundColor: '#fafbfc' }}>
            {nameTagCandidates.length === 0 ? (
              <div style={{ fontSize: 12, color: C.sub, textAlign: 'center', padding: '14px 0' }}>暂无标签</div>
            ) : nameTagCandidates.map(([tag, count]) => {
              const checked = excludedNameTagSet.has(tag);
              return (
                <label key={tag} style={{ display: 'flex', alignItems: 'center', gap: 8, border: `1px solid ${checked ? '#d2e3fc' : '#e8eaed'}`, backgroundColor: checked ? '#e8f0fe' : '#fff', borderRadius: 8, padding: '5px 8px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={checked} onChange={() => toggleExcludedNameTag(tag)} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tag}</span>
                  <span style={{ fontSize: 11, color: C.sub }}>{count}</span>
                </label>
              );
            })}
          </div>
        </Modal>
      )}

      {txnForm && txnItem && (
        <Modal
          title={`${txnItem.name} · 新增动作`}
          onClose={() => setTxnForm(null)}
          footer={(
            <>
              <button type="button" onClick={() => setTxnForm(null)} style={{ border: '1px solid #dadce0', backgroundColor: '#fff', color: C.sub, borderRadius: 10, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>取消</button>
              <button type="button" onClick={saveTxn} style={{ border: 'none', backgroundColor: C.blue, color: '#fff', borderRadius: 10, padding: '8px 16px', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>保存</button>
            </>
          )}
        >
          <div style={{ display: 'grid', gridTemplateColumns: txnItem.kind === 'durable' ? '1fr 1fr' : '1fr', gap: 8 }}>
            <Field label="日期">
              <input type="date" value={txnForm.date} onChange={(e) => setTxnForm({ ...txnForm, date: e.target.value })} style={inputStyle} />
            </Field>
            {txnItem.kind === 'durable' && (
              <Field label="动作">
                <div style={{ display: 'flex', gap: 8 }}>
                  <MiniButton active={txnForm.kind === 'purchase'} onClick={() => setTxnForm({ ...txnForm, kind: 'purchase' })}>购入</MiniButton>
                  <MiniButton active={txnForm.kind === 'resale'} onClick={() => setTxnForm({ ...txnForm, kind: 'resale' })}>卖二手</MiniButton>
                </div>
              </Field>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: txnItem.kind === 'consumable' ? '1fr 1fr' : '1fr', gap: 8 }}>
            <Field label="金额">
              <AmountInput value={txnForm.amount} onChange={(v) => setTxnForm({ ...txnForm, amount: normalizeAmountInput(v) })} style={inputStyle} />
            </Field>
            {txnItem.kind === 'consumable' && (
              <Field label={`数量（${txnItem.unit || '个'}）`}>
                <AmountInput value={txnForm.quantity} onChange={(v) => setTxnForm({ ...txnForm, quantity: normalizeAmountInput(v) })} style={inputStyle} />
              </Field>
            )}
          </div>

          {txnItem.kind === 'consumable' && (
            <>
              <Field label="范围">
                <div style={{ display: 'flex', gap: 8 }}>
                  <MiniButton active={txnForm.scope === 'local'} onClick={() => setTxnForm({ ...txnForm, scope: 'local' })}>本地</MiniButton>
                  <MiniButton active={txnForm.scope === 'shared'} onClick={() => setTxnForm({ ...txnForm, scope: 'shared' })}>共享</MiniButton>
                </div>
              </Field>
              {txnForm.scope === 'local' && (
                <Field label="场景">
                  <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                    {TAG_KINDS.map((key) => (
                      <MiniButton key={key} active={txnForm.scene === key} onClick={() => setTxnForm({ ...txnForm, scene: key })}>
                        {tagMeta[key].icon} {tagMeta[key].label}
                      </MiniButton>
                    ))}
                  </div>
                </Field>
              )}
            </>
          )}

          <Field label="备注">
            <input value={txnForm.note} onChange={(e) => setTxnForm({ ...txnForm, note: e.target.value })} style={inputStyle} />
          </Field>

          <div style={{ marginTop: 12, border: '1px solid #f1f3f4', borderRadius: 12, padding: 10, backgroundColor: '#fafafa' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: '#202124' }}>关联账单</div>
                <div style={{ fontSize: 11, color: selectedBill ? C.blue : C.sub, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {selectedBill ? `${selectedBill.item.date} · ${selectedBill.item.category || selectedBill.item.subcategory || selectedBill.item.note || '账单'} · ¥${formatCurrency(selectedBill.item.amount)}` : '未关联'}
                </div>
              </div>
              <button type="button" onClick={() => setBillPickerOpen((v) => !v)} style={{ border: 'none', borderRadius: 999, backgroundColor: '#e8f0fe', color: C.blue, padding: '6px 10px', fontSize: 12, fontWeight: 800, cursor: 'pointer', flexShrink: 0 }}>
                从账单选择
              </button>
            </div>
            {billPickerOpen && (
              <div style={{ marginTop: 10 }}>
                <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                  <input value={billQuery} onChange={(e) => setBillQuery(e.target.value)} placeholder="日期 / 分类 / 备注" style={{ ...inputStyle, padding: '7px 8px', fontSize: 12 }} />
                  {txnItem.kind === 'consumable' && (
                    <button
                      type="button"
                      onClick={() => setBillPeriodicOnly((v) => !v)}
                      style={{ border: `1px solid ${billPeriodicOnly ? C.blue : '#dadce0'}`, backgroundColor: billPeriodicOnly ? '#e8f0fe' : '#fff', color: billPeriodicOnly ? C.blue : C.sub, borderRadius: 10, padding: '0 9px', fontSize: 11, fontWeight: 800, cursor: 'pointer', flexShrink: 0 }}
                    >
                      周期
                    </button>
                  )}
                </div>
                <div style={{ maxHeight: 230, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {visibleBillChoices.length === 0 && <div style={{ fontSize: 12, color: C.sub, textAlign: 'center', padding: '12px 0' }}>暂无账单</div>}
                  {visibleBillChoices.map((choice) => {
                    const refName = referencedBillMap.get(choice.id);
                    return (
                      <button
                        key={`${choice.yearMonth}-${choice.id}`}
                        type="button"
                        onClick={() => selectBill(choice)}
                        style={{ width: '100%', border: `1px solid ${choice.id === txnForm.billItemId ? C.blue : '#f1f3f4'}`, backgroundColor: choice.id === txnForm.billItemId ? '#e8f0fe' : '#fff', borderRadius: 10, padding: '8px 9px', cursor: 'pointer', textAlign: 'left' }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, fontWeight: 800 }}>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{choice.item.date} · {choice.item.category || '未分类'} / {choice.item.subcategory || '未细分'}</span>
                          <span style={{ color: C.green, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>¥{formatCurrency(choice.item.amount)}</span>
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4, fontSize: 11, color: C.sub }}>
                          {choice.item.note && <span>{choice.item.note}</span>}
                          {choice.item.tags && <span>{choice.item.tags}</span>}
                          {refName && <span style={{ color: C.orange }}>已被『{refName}』引用</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
