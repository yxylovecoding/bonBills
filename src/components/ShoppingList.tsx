import { useMemo, useState } from 'react';
import type { ShoppingItem, ShoppingPriceRecord } from '../models/types';
import AmountInput from './AmountInput';
import Card from './Card';
import { formatCurrency } from './CurrencyDisplay';

const COLORS = { purple: '#7c3aed', green: '#0d9488', red: '#ea4335', sub: '#5f6368' };

interface ShoppingListProps {
  items: ShoppingItem[];
  onChange: (items: ShoppingItem[]) => void;
  onBack: () => void;
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function todayKey(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export default function ShoppingList({ items, onChange, onBack }: ShoppingListProps) {
  const [showBought, setShowBought] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const visibleItems = useMemo(
    () => items.filter((item) => showBought || item.status === 'pending'),
    [items, showBought],
  );
  const pendingCount = items.filter((item) => item.status === 'pending').length;

  const updateItem = (id: string, patch: Partial<ShoppingItem>) => {
    onChange(items.map((item) => item.id === id ? { ...item, ...patch } : item));
  };

  const addItem = () => {
    const id = createId('shopping');
    onChange([...items, { id, name: '', status: 'pending', priceHistory: [], createdAt: new Date().toISOString() }]);
    setExpandedId(id);
  };

  const addPrice = (item: ShoppingItem) => {
    const record: ShoppingPriceRecord = { id: createId('price'), price: 0, date: todayKey(), note: '' };
    updateItem(item.id, { priceHistory: [...item.priceHistory, record] });
    setExpandedId(item.id);
  };

  const updatePrice = (item: ShoppingItem, recordId: string, patch: Partial<ShoppingPriceRecord>) => {
    updateItem(item.id, { priceHistory: item.priceHistory.map((record) => record.id === recordId ? { ...record, ...patch } : record) });
  };

  return (
    <div className="wishes-page-shell">
      <div className="wishes-page-content">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, marginBottom: 16 }}>
          <div>
            <button type="button" onClick={onBack} style={{ border: 'none', background: 'transparent', color: COLORS.purple, padding: '0 0 5px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>← 返回心愿</button>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 2px' }}>购物清单</h1>
            <p style={{ fontSize: 13, color: COLORS.sub, margin: 0 }}>{pendingCount} 件待买 · 记下见过的好价再决定</p>
          </div>
          <button type="button" onClick={addItem} style={{ border: 'none', borderRadius: 999, backgroundColor: COLORS.purple, color: '#fff', fontSize: 12, fontWeight: 700, padding: '7px 12px', cursor: 'pointer' }}>+ 添加商品</button>
        </div>

        <Card>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: COLORS.sub, fontSize: 11, cursor: 'pointer' }}>
              <input type="checkbox" checked={showBought} onChange={(event) => setShowBought(event.target.checked)} />
              显示已购买
            </label>
          </div>
          {visibleItems.length === 0 ? (
            <button type="button" onClick={addItem} style={{ width: '100%', border: '1px dashed #ddd6fe', borderRadius: 12, background: '#faf7ff', color: COLORS.purple, padding: '28px 12px', fontSize: 13, cursor: 'pointer' }}>
              {items.length > 0 ? '没有待买商品' : '添加第一件想买的商品'}
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {visibleItems.map((item) => {
                const bestPrice = item.priceHistory.length > 0 ? Math.min(...item.priceHistory.map((record) => record.price).filter((price) => price > 0)) : 0;
                const expanded = expandedId === item.id;
                return (
                  <section key={item.id} style={{ border: '1px solid #ede9fe', borderRadius: 12, background: item.status === 'bought' ? '#f9fafb' : '#fff', padding: 11, opacity: item.status === 'bought' ? 0.72 : 1 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) auto', alignItems: 'center', gap: 8 }}>
                      <input aria-label={`${item.name || '未命名商品'}购买状态`} type="checkbox" checked={item.status === 'bought'} onChange={(event) => updateItem(item.id, { status: event.target.checked ? 'bought' : 'pending' })} />
                      <input aria-label="商品名称" autoFocus={!item.name} value={item.name} onChange={(event) => updateItem(item.id, { name: event.target.value })} placeholder="想买什么？" style={{ minWidth: 0, border: 'none', outline: 'none', background: 'transparent', fontSize: 14, fontWeight: 700, color: '#202124', textDecoration: item.status === 'bought' ? 'line-through' : 'none' }} />
                      <button type="button" aria-label={`删除${item.name || '商品'}`} onClick={() => onChange(items.filter((candidate) => candidate.id !== item.id))} style={{ border: 'none', background: 'transparent', color: '#9ca3af', fontSize: 18, cursor: 'pointer' }}>×</button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
                      <label style={{ fontSize: 10, color: COLORS.sub }}>预算价
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4, border: '1px solid #e5e7eb', borderRadius: 8, padding: '6px 8px' }}><span>¥</span><AmountInput aria-label={`${item.name || '商品'}预算价`} value={item.targetPrice ? String(item.targetPrice) : ''} onChange={(raw) => updateItem(item.id, { targetPrice: Math.max(Number(raw) || 0, 0) })} placeholder="0" style={{ width: '100%', minWidth: 0, border: 'none', outline: 'none', textAlign: 'right', fontWeight: 700 }} /></div>
                      </label>
                      <div style={{ fontSize: 10, color: COLORS.sub }}>历史好价<div style={{ marginTop: 6, textAlign: 'right', color: bestPrice > 0 ? COLORS.green : COLORS.sub, fontSize: 14, fontWeight: 800 }}>{bestPrice > 0 ? `¥${formatCurrency(bestPrice)}` : '暂无'}</div></div>
                    </div>
                    <input aria-label={`${item.name || '商品'}备注或链接`} value={item.note ?? ''} onChange={(event) => updateItem(item.id, { note: event.target.value })} placeholder="备注或商品链接（可选）" style={{ width: '100%', boxSizing: 'border-box', marginTop: 8, border: 'none', borderBottom: '1px solid #e5e7eb', outline: 'none', padding: '6px 2px', fontSize: 11, color: COLORS.sub }} />
                    <button type="button" onClick={() => setExpandedId(expanded ? null : item.id)} style={{ border: 'none', background: 'transparent', color: COLORS.purple, padding: '9px 0 0', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>{expanded ? '收起价格记录' : `价格记录 (${item.priceHistory.length})`}</button>
                    {expanded && <div style={{ marginTop: 8, borderTop: '1px dashed #ddd6fe', paddingTop: 8 }}>
                      {item.priceHistory.map((record) => <div key={record.id} style={{ display: 'grid', gridTemplateColumns: '110px 90px minmax(0, 1fr) auto', gap: 6, marginBottom: 6 }}>
                        <input type="date" aria-label="好价日期" value={record.date} onChange={(event) => updatePrice(item, record.id, { date: event.target.value })} style={{ minWidth: 0, border: '1px solid #e5e7eb', borderRadius: 7, padding: '5px', fontSize: 10 }} />
                        <AmountInput aria-label="好价金额" value={record.price ? String(record.price) : ''} onChange={(raw) => updatePrice(item, record.id, { price: Math.max(Number(raw) || 0, 0) })} placeholder="价格" style={{ minWidth: 0, width: '100%', boxSizing: 'border-box', border: '1px solid #e5e7eb', borderRadius: 7, padding: '5px', fontSize: 10 }} />
                        <input aria-label="好价备注" value={record.note ?? ''} onChange={(event) => updatePrice(item, record.id, { note: event.target.value })} placeholder="平台 / 活动" style={{ minWidth: 0, border: '1px solid #e5e7eb', borderRadius: 7, padding: '5px', fontSize: 10 }} />
                        <button type="button" aria-label="删除好价记录" onClick={() => updateItem(item.id, { priceHistory: item.priceHistory.filter((candidate) => candidate.id !== record.id) })} style={{ border: 'none', background: 'transparent', color: COLORS.red, cursor: 'pointer' }}>×</button>
                      </div>)}
                      <button type="button" onClick={() => addPrice(item)} style={{ width: '100%', border: '1px dashed #c4b5fd', borderRadius: 8, background: '#faf7ff', color: COLORS.purple, padding: '6px', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>+ 记录一次好价</button>
                    </div>}
                  </section>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
