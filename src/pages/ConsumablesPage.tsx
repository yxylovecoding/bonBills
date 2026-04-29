import { useMemo, useState } from 'react';
import Card from '../components/Card';
import AmountInput from '../components/AmountInput';
import { formatCurrency } from '../components/CurrencyDisplay';
import { useBillDetailStore } from '../stores/billDetailStore';
import { useConsumableStore } from '../stores/consumableStore';
import {
  extractConsumablePurchases,
  groupPurchasesByProduct,
  calcConsumptionStats,
  calcInventoryStatus,
  buildPriceRows,
  suggestProductName,
  type ConsumablePurchase,
  type PriceRow,
  type InventoryInfo,
} from '../utils/consumables';

const C = {
  blue: '#1a73e8',
  red: '#ea4335',
  green: '#0d9488',
  purple: '#7c3aed',
  orange: '#e8710a',
  sub: '#5f6368',
  border: '#e0e0e0',
  bgSoft: '#f8f9fa',
};

function Pill({ children, color = C.sub, bg = '#f1f3f4' }: { children: React.ReactNode; color?: string; bg?: string }) {
  return (
    <span style={{ display: 'inline-block', fontSize: 11, color, backgroundColor: bg, padding: '2px 8px', borderRadius: 8, fontWeight: 600 }}>
      {children}
    </span>
  );
}

function ProductCard({
  productId,
  name,
  unit,
  purchases,
  candidates,
  extras,
  onRename,
  onDelete,
  onSetUnit,
  onSetExtra,
  onClearExtra,
  onAddCandidate,
  onUpdateCandidate,
  onDeleteCandidate,
  onSetPinned,
}: {
  productId: string;
  name: string;
  unit?: string;
  purchases: ConsumablePurchase[];
  candidates: ReturnType<typeof useConsumableStore.getState>['candidates'];
  extras: Record<string, import('../models/types').PurchaseExtra>;
  onRename: (id: string, n: string) => void;
  onDelete: (id: string) => void;
  onSetUnit: (id: string, u: string) => void;
  onSetExtra: (itemId: string, patch: Partial<import('../models/types').PurchaseExtra>) => void;
  onClearExtra: (itemId: string) => void;
  onAddCandidate: (productId: string, source: string, totalPrice: number, spec?: string, qty?: number, note?: string) => void;
  onUpdateCandidate: (id: string, patch: Partial<Omit<import('../models/types').PriceCandidate, 'id' | 'productId' | 'addedAt'>>) => void;
  onDeleteCandidate: (id: string) => void;
  onSetPinned: (productId: string, candidateId: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [draftName, setDraftName] = useState(name);
  const [draftUnit, setDraftUnit] = useState(unit || '');

  // 候选表单
  const [cSource, setCSource] = useState('');
  const [cSpec, setCSpec] = useState('');
  const [cQty, setCQty] = useState('');
  const [cTotal, setCTotal] = useState('');
  const [cNote, setCNote] = useState('');

  const stats = useMemo(() => calcConsumptionStats(purchases), [purchases]);
  const rows = useMemo(() => buildPriceRows(purchases, candidates.filter((c) => c.productId === productId), extras), [purchases, candidates, productId, extras]);

  const overdueColor = stats.isOverdue ? C.red : C.sub;

  return (
    <div style={{ backgroundColor: C.bgSoft, borderRadius: 12, padding: '12px', marginBottom: 10, border: '1px solid ' + C.border }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <input
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onBlur={() => draftName !== name && onRename(productId, draftName.trim() || name)}
          style={{ flex: 1, border: 'none', background: 'transparent', fontSize: 14, fontWeight: 700, outline: 'none', minWidth: 0 }}
        />
        <span style={{ fontSize: 11, color: C.sub }}>单位</span>
        <input
          value={draftUnit}
          onChange={(e) => setDraftUnit(e.target.value)}
          onBlur={() => draftUnit !== (unit || '') && onSetUnit(productId, draftUnit.trim())}
          placeholder="—"
          style={{ width: 40, border: 'none', borderBottom: '1px solid ' + C.border, background: 'transparent', fontSize: 12, outline: 'none', textAlign: 'center' }}
        />
        <button onClick={() => onDelete(productId)} title="删除商品" style={{ background: 'none', border: 'none', color: '#bdc1c6', fontSize: 16, cursor: 'pointer', lineHeight: 1 }}>×</button>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 11, marginBottom: 6 }}>
        <Pill>已购 {stats.count}</Pill>
        {stats.avgIntervalDays !== undefined ? (
          <Pill color={C.blue} bg="#e8f0fe">平均 {stats.avgIntervalDays} 天/件</Pill>
        ) : (
          <Pill>样本不足</Pill>
        )}
        {stats.daysSinceLast !== undefined && (
          <Pill color={overdueColor} bg={stats.isOverdue ? '#fce8e6' : '#f1f3f4'}>
            距上次 {stats.daysSinceLast} 天{stats.isOverdue ? ' · 已超期' : ''}
          </Pill>
        )}
        {stats.expectedNextDate && (
          <Pill color={C.sub}>预期 {stats.expectedNextDate}</Pill>
        )}
        <Pill color={C.purple} bg="#f3e8fd">总支出 ¥{formatCurrency(stats.totalSpend)}</Pill>
      </div>

      <button
        onClick={() => setExpanded((v) => !v)}
        style={{ width: '100%', padding: '6px 0', fontSize: 12, color: C.blue, backgroundColor: 'transparent', border: '1px dashed ' + C.border, borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}
      >
        {expanded ? '收起比价 / 详情 ▲' : '展开比价 / 详情 ▼'}
      </button>

      {expanded && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 11, color: C.sub, marginBottom: 4 }}>比价（按单位价升序，置顶 = 下次买）</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {rows.length === 0 && <div style={{ fontSize: 12, color: C.sub }}>暂无购买记录</div>}
            {rows.map((row) => (
              <PriceRowView
                key={`${row.kind}_${row.id}`}
                row={row}
                unit={unit}
                productId={productId}
                onSetExtra={onSetExtra}
                onClearExtra={onClearExtra}
                onUpdateCandidate={onUpdateCandidate}
                onDeleteCandidate={onDeleteCandidate}
                onSetPinned={onSetPinned}
              />
            ))}
          </div>

          <div style={{ marginTop: 10, padding: 10, backgroundColor: '#fff', borderRadius: 8, border: '1px solid ' + C.border }}>
            <div style={{ fontSize: 11, color: C.sub, marginBottom: 6, fontWeight: 600 }}>+ 添加候选报价</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 12 }}>
              <input value={cSource} onChange={(e) => setCSource(e.target.value)} placeholder="来源 山姆/京东" style={inputStyle} />
              <input value={cSpec} onChange={(e) => setCSpec(e.target.value)} placeholder="规格 500ml×2" style={inputStyle} />
              <AmountInput value={cQty} onChange={setCQty} placeholder="数量" style={inputStyle} />
              <AmountInput value={cTotal} onChange={setCTotal} placeholder="总价 ¥" style={inputStyle} />
              <input value={cNote} onChange={(e) => setCNote(e.target.value)} placeholder="备注（可选）" style={{ ...inputStyle, gridColumn: '1 / span 2' }} />
            </div>
            <button
              onClick={() => {
                const total = parseFloat(cTotal);
                if (!cSource.trim() || isNaN(total) || total <= 0) return;
                const qty = parseFloat(cQty);
                onAddCandidate(productId, cSource.trim(), total, cSpec.trim() || undefined, isNaN(qty) || qty <= 0 ? undefined : qty, cNote.trim() || undefined);
                setCSource(''); setCSpec(''); setCQty(''); setCTotal(''); setCNote('');
              }}
              style={{ width: '100%', marginTop: 6, padding: '6px 0', fontSize: 12, color: C.blue, backgroundColor: '#e8f0fe', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
            >
              添加
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  border: '1px solid ' + C.border,
  borderRadius: 6,
  padding: '5px 8px',
  fontSize: 12,
  outline: 'none',
  minWidth: 0,
  width: '100%',
  boxSizing: 'border-box',
};

function PriceRowView({
  row,
  unit,
  productId,
  onSetExtra,
  onClearExtra,
  onUpdateCandidate,
  onDeleteCandidate,
  onSetPinned,
}: {
  row: PriceRow;
  unit?: string;
  productId: string;
  onSetExtra: (itemId: string, patch: Partial<import('../models/types').PurchaseExtra>) => void;
  onClearExtra: (itemId: string) => void;
  onUpdateCandidate: (id: string, patch: Partial<Omit<import('../models/types').PriceCandidate, 'id' | 'productId' | 'addedAt'>>) => void;
  onDeleteCandidate: (id: string) => void;
  onSetPinned: (productId: string, candidateId: string | null) => void;
}) {
  const isPurchase = row.kind === 'purchase';
  const [editing, setEditing] = useState(false);
  const [spec, setSpec] = useState(row.spec || '');
  const [qty, setQty] = useState(row.qty != null ? String(row.qty) : '');

  const bg = row.pinned ? '#e8f0fe' : '#fff';
  const border = row.pinned ? C.blue : C.border;

  return (
    <div style={{ padding: '8px 10px', backgroundColor: bg, border: '1px solid ' + border, borderRadius: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <Pill color={isPurchase ? C.green : C.orange} bg={isPurchase ? '#e6f4ea' : '#fff4e8'}>
          {isPurchase ? '历史' : '候选'}
        </Pill>
        <span style={{ fontSize: 12, fontWeight: 600 }}>{row.source}</span>
        <span style={{ flex: 1 }} />
        {row.unitPrice !== undefined ? (
          <span style={{ fontSize: 13, fontWeight: 700, color: C.purple, fontVariantNumeric: 'tabular-nums' }}>
            ¥{formatCurrency(row.unitPrice)}/{unit || '单位'}
          </span>
        ) : (
          <span style={{ fontSize: 13, fontWeight: 700, color: C.sub, fontVariantNumeric: 'tabular-nums' }}>
            ¥{formatCurrency(row.totalPrice)}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, fontSize: 11, color: C.sub, alignItems: 'center', flexWrap: 'wrap' }}>
        {row.date && <span>{row.date}</span>}
        {row.spec && <Pill>规格 {row.spec}</Pill>}
        {row.qty != null && <Pill>×{row.qty}</Pill>}
        {row.unitPrice !== undefined && (
          <Pill color={C.sub}>合计 ¥{formatCurrency(row.totalPrice)}</Pill>
        )}
        {row.note && <span style={{ color: C.sub }}>· {row.note}</span>}
        <span style={{ flex: 1 }} />
        {!isPurchase && (
          <button
            onClick={() => onSetPinned(productId, row.pinned ? null : row.id)}
            style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, border: `1px solid ${row.pinned ? C.blue : C.border}`, background: row.pinned ? '#e8f0fe' : '#fff', color: row.pinned ? C.blue : C.sub, cursor: 'pointer', fontWeight: 600 }}
          >
            {row.pinned ? '已选下次' : '下次买这个'}
          </button>
        )}
        <button
          onClick={() => setEditing((v) => !v)}
          style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, border: '1px solid ' + C.border, background: '#fff', color: C.sub, cursor: 'pointer' }}
        >
          {editing ? '收起' : '编辑'}
        </button>
        {!isPurchase && (
          <button
            onClick={() => onDeleteCandidate(row.id)}
            style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, border: '1px solid ' + C.border, background: '#fff', color: C.red, cursor: 'pointer' }}
          >
            删除
          </button>
        )}
      </div>
      {editing && (
        <div style={{ marginTop: 6, display: 'grid', gridTemplateColumns: '1fr 80px', gap: 6 }}>
          <input
            value={spec}
            onChange={(e) => setSpec(e.target.value)}
            placeholder="规格 500ml×2"
            style={inputStyle}
          />
          <AmountInput
            value={qty}
            onChange={setQty}
            placeholder="数量"
            style={inputStyle}
          />
          <button
            onClick={() => {
              const qtyNum = parseFloat(qty);
              const validQty = !isNaN(qtyNum) && qtyNum > 0 ? qtyNum : undefined;
              if (isPurchase) {
                if (!spec && validQty === undefined) onClearExtra(row.id);
                else onSetExtra(row.id, { spec: spec.trim() || undefined, qty: validQty });
              } else {
                onUpdateCandidate(row.id, { spec: spec.trim() || undefined, qty: validQty });
              }
              setEditing(false);
            }}
            style={{ gridColumn: '1 / span 2', padding: '4px 0', fontSize: 12, color: '#fff', backgroundColor: C.blue, border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
          >
            保存
          </button>
        </div>
      )}
    </div>
  );
}

type Mode = 'inventory' | 'price';

const SUBCAT_FALLBACK = '未归类';

export default function ConsumablesPage() {
  const { expenseItems } = useBillDetailStore();
  const {
    products,
    purchaseExtras,
    candidates,
    tagBlacklist,
    createProduct,
    updateProduct,
    deleteProduct,
    attachMatchKey,
    markUsedUp,
    clearUsedUp,
    setPurchaseExtra,
    clearPurchaseExtra,
    addCandidate,
    updateCandidate,
    deleteCandidate,
    setPinnedCandidate,
  } = useConsumableStore();

  const [mode, setMode] = useState<Mode>('inventory');
  const [showUsedUp, setShowUsedUp] = useState(false);

  const purchases = useMemo(
    () => extractConsumablePurchases(expenseItems, tagBlacklist),
    [expenseItems, tagBlacklist],
  );
  const { grouped, suggestions } = useMemo(
    () => groupPurchasesByProduct(products, purchases, purchaseExtras),
    [products, purchases, purchaseExtras],
  );

  const activeProducts = products.filter((p) => !p.archived);
  const archivedProducts = products.filter((p) => p.archived);

  // 为每个 product 计算库存状态（用于 inventory 排序 + 隐藏 manual-out）
  const productInfo = useMemo(() => {
    const map = new Map<string, { stats: ReturnType<typeof calcConsumptionStats>; inv: InventoryInfo }>();
    for (const p of activeProducts) {
      const stats = calcConsumptionStats(grouped[p.id] || []);
      const inv = calcInventoryStatus(stats, p.usedUpAt);
      map.set(p.id, { stats, inv });
    }
    return map;
  }, [activeProducts, grouped]);

  // 按 subcategory 分组
  const productsBySubcat = useMemo(() => {
    const map = new Map<string, typeof activeProducts>();
    for (const p of activeProducts) {
      const sub = (p.subcategory || '').trim() || SUBCAT_FALLBACK;
      if (!map.has(sub)) map.set(sub, []);
      map.get(sub)!.push(p);
    }
    // 把 SUBCAT_FALLBACK 放最末
    const entries = Array.from(map.entries()).sort((a, b) => {
      if (a[0] === SUBCAT_FALLBACK) return 1;
      if (b[0] === SUBCAT_FALLBACK) return -1;
      return a[0].localeCompare(b[0], 'zh');
    });
    return entries;
  }, [activeProducts]);

  const usedUpCount = activeProducts.filter((p) => productInfo.get(p.id)?.inv.status === 'manual-out').length;

  const totalCount = purchases.length;
  const totalSpend = purchases.reduce((s, p) => s + p.item.amount, 0);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '0 0 16px', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 2px' }}>消费品</h1>
          <p style={{ fontSize: 13, color: C.sub, margin: 0 }}>
            自动汇总账单中带「消耗品」标签的购买，按子类分组管理库存与比价。
          </p>
        </div>
        <div style={{ display: 'flex', backgroundColor: '#e8eaed', borderRadius: 20, padding: 3, gap: 2, flexShrink: 0 }}>
          {(['inventory', 'price'] as const).map((m) => {
            const active = mode === m;
            return (
              <button
                key={m}
                onClick={() => setMode(m)}
                style={{
                  padding: '5px 14px', borderRadius: 16, border: 'none', cursor: 'pointer',
                  fontSize: 13, fontWeight: 600,
                  backgroundColor: active ? '#fff' : 'transparent',
                  color: active ? C.blue : C.sub,
                  boxShadow: active ? '0 1px 3px rgba(0,0,0,0.15)' : 'none',
                  transition: 'all 0.15s',
                }}
              >
                {m === 'inventory' ? '库存' : '比价'}
              </button>
            );
          })}
        </div>
      </div>

      <Card title="总览" subtitle={`商品 ${activeProducts.length} · 历史购买 ${totalCount}`}>
        <div style={{ display: 'flex', gap: 12, fontSize: 13 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: C.sub }}>总历史支出</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.purple, fontVariantNumeric: 'tabular-nums' }}>
              ¥{formatCurrency(totalSpend)}
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: C.sub }}>未归类条目</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: suggestions && Object.keys(suggestions).length ? C.orange : C.sub, fontVariantNumeric: 'tabular-nums' }}>
              {Object.values(suggestions).reduce((s, arr) => s + arr.length, 0)}
            </div>
          </div>
        </div>
        {totalCount === 0 && (
          <div style={{ marginTop: 10, fontSize: 12, color: C.sub, lineHeight: 1.5 }}>
            目前没有读取到带「消耗品」标签的账单条目。请先在「记录」页或外部记账软件中给条目打上「消耗品」标签并导入账单。
          </div>
        )}
      </Card>

      {productsBySubcat.map(([sub, list]) => {
        // 隐藏 manual-out（除非 showUsedUp）
        const visible = list.filter((p) => {
          const inv = productInfo.get(p.id)?.inv;
          if (inv?.status === 'manual-out' && !showUsedUp) return false;
          return true;
        });
        if (visible.length === 0) return null;
        return (
          <Card key={sub} title={sub} subtitle={`${visible.length} 个商品`}>
            {visible.map((p) => {
              const info = productInfo.get(p.id);
              if (mode === 'inventory') {
                return (
                  <InventoryRow
                    key={p.id}
                    productId={p.id}
                    name={p.name}
                    unit={p.unit}
                    purchases={grouped[p.id] || []}
                    extras={purchaseExtras}
                    candidates={candidates}
                    inv={info?.inv || { status: 'no-data' }}
                    onRename={(id, n) => updateProduct(id, { name: n })}
                    onMarkUsedUp={markUsedUp}
                    onClearUsedUp={clearUsedUp}
                  />
                );
              }
              return (
                <ProductCard
                  key={p.id}
                  productId={p.id}
                  name={p.name}
                  unit={p.unit}
                  purchases={grouped[p.id] || []}
                  candidates={candidates}
                  extras={purchaseExtras}
                  onRename={(id, n) => updateProduct(id, { name: n })}
                  onDelete={(id) => {
                    if (confirm('删除商品？历史购买仍会回到「未归类」。')) deleteProduct(id);
                  }}
                  onSetUnit={(id, u) => updateProduct(id, { unit: u || undefined })}
                  onSetExtra={setPurchaseExtra}
                  onClearExtra={clearPurchaseExtra}
                  onAddCandidate={(productId, source, totalPrice, spec, qty, note) =>
                    addCandidate({ productId, source, totalPrice, spec, qty, note })
                  }
                  onUpdateCandidate={updateCandidate}
                  onDeleteCandidate={deleteCandidate}
                  onSetPinned={setPinnedCandidate}
                />
              );
            })}
          </Card>
        );
      })}

      {usedUpCount > 0 && (
        <button
          onClick={() => setShowUsedUp((v) => !v)}
          style={{ width: '100%', padding: '8px 0', fontSize: 12, color: C.sub, backgroundColor: 'transparent', border: '1px dashed ' + C.border, borderRadius: 8, cursor: 'pointer', fontWeight: 600, marginBottom: 16 }}
        >
          {showUsedUp ? `收起已用完 (${usedUpCount}) ▲` : `显示已用完 (${usedUpCount}) ▼`}
        </button>
      )}

      {Object.keys(suggestions).length > 0 && (
        <Card title="未归类条目" subtitle="一键创建商品，或合并到已有商品">
          {Object.entries(suggestions).map(([key, items]) => {
            const sample = items[0];
            const suggestedName = suggestProductName(key, items);
            const totalSpend = items.reduce((s, p) => s + p.item.amount, 0);
            return (
              <UngroupedRow
                key={key}
                matchKey={key}
                items={items}
                sampleSubcategory={sample.item.subcategory}
                suggestedName={suggestedName}
                totalSpend={totalSpend}
                products={activeProducts}
                onCreate={(name) => createProduct({ name, matchKeys: [key], subcategory: sample.item.subcategory })}
                onMergeTo={(productId) => attachMatchKey(productId, key)}
                onExclude={(itemId) => setPurchaseExtra(itemId, { excluded: true })}
              />
            );
          })}
        </Card>
      )}

      {archivedProducts.length > 0 && (
        <Card title="已归档" subtitle={`${archivedProducts.length} 个`}>
          {archivedProducts.map((p) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid ' + C.border }}>
              <span style={{ flex: 1, fontSize: 13, color: C.sub }}>{p.name}</span>
              <button
                onClick={() => updateProduct(p.id, { archived: false })}
                style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, border: '1px solid ' + C.border, background: '#fff', color: C.blue, cursor: 'pointer' }}
              >
                恢复
              </button>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

function InventoryRow({
  productId,
  name,
  unit,
  purchases,
  extras,
  candidates,
  inv,
  onRename,
  onMarkUsedUp,
  onClearUsedUp,
}: {
  productId: string;
  name: string;
  unit?: string;
  purchases: ConsumablePurchase[];
  extras: Record<string, import('../models/types').PurchaseExtra>;
  candidates: ReturnType<typeof useConsumableStore.getState>['candidates'];
  inv: InventoryInfo;
  onRename: (id: string, n: string) => void;
  onMarkUsedUp: (id: string) => void;
  onClearUsedUp: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [draftName, setDraftName] = useState(name);

  const rows = useMemo(
    () => buildPriceRows(purchases, [], extras).filter((r) => r.kind === 'purchase'),
    [purchases, extras],
  );
  void candidates; // 保留接口对称，inventory 行不展开候选

  let badgeColor = C.sub;
  let badgeBg = '#f1f3f4';
  let badgeText = '—';
  switch (inv.status) {
    case 'ok': badgeColor = C.green; badgeBg = '#e6f4ea'; badgeText = '充足'; break;
    case 'soon': badgeColor = C.orange; badgeBg = '#fff4e8'; badgeText = '将耗尽'; break;
    case 'overdue': badgeColor = C.red; badgeBg = '#fce8e6'; badgeText = '需补货'; break;
    case 'manual-out': badgeColor = '#fff'; badgeBg = C.sub; badgeText = '已用完'; break;
    case 'no-data': badgeText = '无数据'; break;
  }

  const isOut = inv.status === 'manual-out';

  return (
    <div style={{ backgroundColor: isOut ? '#fafafa' : C.bgSoft, borderRadius: 12, padding: '10px 12px', marginBottom: 8, border: '1px solid ' + C.border, opacity: isOut ? 0.7 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <input
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onBlur={() => draftName !== name && onRename(productId, draftName.trim() || name)}
          style={{ flex: 1, border: 'none', background: 'transparent', fontSize: 14, fontWeight: 700, outline: 'none', minWidth: 0 }}
        />
        <span style={{ display: 'inline-block', fontSize: 11, color: badgeColor, backgroundColor: badgeBg, padding: '3px 10px', borderRadius: 10, fontWeight: 700 }}>
          {badgeText}
        </span>
        {isOut ? (
          <button
            onClick={() => onClearUsedUp(productId)}
            style={{ fontSize: 11, padding: '4px 10px', borderRadius: 8, border: '1px solid ' + C.border, background: '#fff', color: C.blue, cursor: 'pointer', fontWeight: 600 }}
          >
            取消
          </button>
        ) : (
          <button
            onClick={() => onMarkUsedUp(productId)}
            style={{ fontSize: 11, padding: '4px 10px', borderRadius: 8, border: '1px solid ' + C.border, background: '#fff', color: C.red, cursor: 'pointer', fontWeight: 600 }}
          >
            已用完
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11, color: C.sub }}>
        {inv.lastDate ? (
          <span>上次 {inv.lastDate}{inv.daysSinceLast !== undefined ? ` · ${inv.daysSinceLast} 天前` : ''}</span>
        ) : (
          <span>暂无购买</span>
        )}
        {inv.avgIntervalDays !== undefined && (
          <span>· 平均 {inv.avgIntervalDays} 天/件</span>
        )}
        {inv.expectedNextDate && !isOut && (
          <span>· 预期 {inv.expectedNextDate}</span>
        )}
        <span style={{ flex: 1 }} />
        {purchases.length > 0 && (
          <button
            onClick={() => setExpanded((v) => !v)}
            style={{ fontSize: 11, color: C.blue, background: 'transparent', border: 'none', cursor: 'pointer', fontWeight: 600, padding: 0 }}
          >
            {expanded ? '收起 ▲' : `历史 ${purchases.length} 条 ▼`}
          </button>
        )}
      </div>

      {expanded && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {rows.map((row) => (
            <div key={row.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, padding: '4px 8px', backgroundColor: '#fff', borderRadius: 6 }}>
              <span style={{ color: C.sub }}>{row.date}</span>
              <span>{row.source}</span>
              {row.spec && <span style={{ color: C.sub }}>· {row.spec}</span>}
              {row.qty != null && <span style={{ color: C.sub }}>×{row.qty}</span>}
              <span style={{ flex: 1 }} />
              {row.unitPrice !== undefined && unit && (
                <span style={{ color: C.purple, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                  ¥{formatCurrency(row.unitPrice)}/{unit}
                </span>
              )}
              <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>¥{formatCurrency(row.totalPrice)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function UngroupedRow({
  matchKey,
  items,
  sampleSubcategory,
  suggestedName,
  totalSpend,
  products,
  onCreate,
  onMergeTo,
  onExclude,
}: {
  matchKey: string;
  items: ConsumablePurchase[];
  sampleSubcategory: string;
  suggestedName: string;
  totalSpend: number;
  products: import('../models/types').ConsumableProduct[];
  onCreate: (name: string) => void;
  onMergeTo: (productId: string) => void;
  onExclude: (itemId: string) => void;
}) {
  const [name, setName] = useState(suggestedName);
  const [showItems, setShowItems] = useState(false);
  const [mergeTarget, setMergeTarget] = useState('');
  const lastDate = items[items.length - 1].item.date;

  return (
    <div style={{ padding: '10px', backgroundColor: C.bgSoft, borderRadius: 10, marginBottom: 8, border: '1px solid ' + C.border }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ flex: 1, fontSize: 13, fontWeight: 600, border: 'none', borderBottom: '1px solid ' + C.border, background: 'transparent', outline: 'none', minWidth: 0 }}
        />
        <button
          onClick={() => onCreate(name)}
          style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, border: 'none', background: C.blue, color: '#fff', cursor: 'pointer', fontWeight: 600 }}
        >
          创建商品
        </button>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 11, marginBottom: 6 }}>
        <Pill>{sampleSubcategory || '无子类'}</Pill>
        <Pill>{items.length} 次</Pill>
        <Pill color={C.sub}>最近 {lastDate}</Pill>
        <Pill color={C.purple} bg="#f3e8fd">¥{formatCurrency(totalSpend)}</Pill>
        <span style={{ flex: 1 }} />
        <span style={{ color: C.sub, fontSize: 10 }}>键 {matchKey}</span>
      </div>
      {products.length > 0 && (
        <div style={{ display: 'flex', gap: 6, fontSize: 11, marginBottom: 6 }}>
          <select
            value={mergeTarget}
            onChange={(e) => setMergeTarget(e.target.value)}
            style={{ flex: 1, fontSize: 12, padding: '4px 6px', border: '1px solid ' + C.border, borderRadius: 6, outline: 'none' }}
          >
            <option value="">合并到已有商品…</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button
            disabled={!mergeTarget}
            onClick={() => { if (mergeTarget) { onMergeTo(mergeTarget); setMergeTarget(''); } }}
            style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, border: 'none', background: mergeTarget ? C.green : '#dadce0', color: '#fff', cursor: mergeTarget ? 'pointer' : 'not-allowed', fontWeight: 600 }}
          >
            合并
          </button>
        </div>
      )}
      <button
        onClick={() => setShowItems((v) => !v)}
        style={{ width: '100%', padding: '4px 0', fontSize: 11, color: C.sub, background: 'transparent', border: '1px dashed ' + C.border, borderRadius: 6, cursor: 'pointer' }}
      >
        {showItems ? '隐藏明细 ▲' : `查看 ${items.length} 条明细 ▼`}
      </button>
      {showItems && (
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {items.map((it) => (
            <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, padding: '4px 6px', backgroundColor: '#fff', borderRadius: 6 }}>
              <span style={{ color: C.sub }}>{it.item.date}</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {it.item.note || it.item.subcategory}
              </span>
              <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>¥{formatCurrency(it.item.amount)}</span>
              <button
                onClick={() => onExclude(it.id)}
                title="标记为不属于消费品（隐藏）"
                style={{ background: 'none', border: 'none', color: '#bdc1c6', fontSize: 13, cursor: 'pointer' }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
