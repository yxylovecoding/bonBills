import { useState } from 'react';
import type { WishItem, WishSpentItem } from '../models/types';
import { calculateWishFunding } from '../utils/wishes';
import { tryEvalFormula } from '../utils/formula';
import { roundToSitePrecision } from '../utils/numberInput';
import AmountInput from './AmountInput';
import { formatCurrency } from './CurrencyDisplay';

interface Props {
  wish: WishItem;
  onChange: (patch: Partial<WishItem>) => void;
}

const inputStyle = { minWidth: 0, width: '100%', border: 'none', outline: 'none', background: 'transparent', fontSize: 11, color: '#202124' };

export default function WishSpendingEditor({ wish, onChange }: Props) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const items = wish.spentItems ?? [];
  const funding = calculateWishFunding(wish);

  const save = (patch: Partial<WishItem>) => {
    const next = { ...wish, ...patch };
    const spent = calculateWishFunding(next).spentAmount;
    setError('');
    onChange({ ...patch, repaidAmount: Math.min(wish.repaidAmount ?? 0, spent) });
    return true;
  };
  const commitAmount = (key: string, raw: string, itemId: string) => {
    const amount = Number(tryEvalFormula(raw) ?? raw);
    if (!Number.isFinite(amount) || amount < 0) {
      setError('请输入有效的非负金额');
      return;
    }
    const value = roundToSitePrecision(amount);
    const patch = { spentItems: items.map((item) => item.id === itemId ? { ...item, amount: value } : item) };
    if (save(patch)) setDrafts((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  };
  const changeItem = (id: string, patch: Partial<WishSpentItem>) => save({
    spentItems: items.map((item) => item.id === id ? { ...item, ...patch } : item),
  });

  return (
    <div className="wish-spending-editor">
      <div className="wish-money-summary">
        <span>已花 <strong>¥{formatCurrency(funding.spentAmount)}</strong></span>
        <span>已还 <strong className="wish-repaid-amount">¥{formatCurrency(funding.repaidAmount)}</strong></span>
      </div>
      <div className="wish-spent-items">
        {items.map((item, index) => (
          <div key={item.id} className="wish-expense-row">
            <input
              aria-label={`${wish.name} 第${index + 1}笔已花名称`}
              value={item.name}
              onChange={(event) => changeItem(item.id, { name: event.target.value })}
              placeholder="机票/高铁、酒店、其他"
              list={`spent-names-${wish.id}`}
              style={inputStyle}
            />
            <span className="wish-spent-amount">¥
              <AmountInput
                aria-label={`${wish.name} 第${index + 1}笔已花金额`}
                value={drafts[item.id] ?? (item.amount ? String(item.amount) : '')}
                onChange={(raw) => setDrafts((current) => ({ ...current, [item.id]: raw }))}
                onBlur={(event) => commitAmount(item.id, event.currentTarget.value, item.id)}
                onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
                placeholder="0"
                style={{ ...inputStyle, textAlign: 'right', fontWeight: 700 }}
              />
            </span>
            <button type="button" aria-label={`删除${item.name || `第${index + 1}笔已花`}`} onClick={() => save({ spentItems: items.filter((candidate) => candidate.id !== item.id) })}>×</button>
          </div>
        ))}
      </div>
      <datalist id={`spent-names-${wish.id}`}>
        {[...new Set(['机票/高铁', '酒店', ...(wish.travelExtraExpenseItems ?? []).map((item) => item.name.trim()).filter(Boolean)])].map((name) => <option key={name} value={name} />)}
      </datalist>
      <div className="wish-spending-footer">
        <span>欠自己 <strong>¥{formatCurrency(funding.debtAmount)}</strong></span>
        <button type="button" onClick={() => save({ spentItems: [...items, { id: crypto.randomUUID(), name: '', amount: 0 }] })}>+ 添加已花</button>
      </div>
      {error && <div className="wish-money-error" role="alert">{error}</div>}
    </div>
  );
}
