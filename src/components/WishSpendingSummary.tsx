import { useId, useMemo, useState } from 'react';
import type { WishItem } from '../models/types';
import { useBillDetailStore } from '../stores/billDetailStore';
import { flattenExpenseItems } from '../utils/trips';
import { calculateWishFunding, classifyWishBill } from '../utils/wishes';
import { formatCurrency } from './CurrencyDisplay';

const BILL_KIND_LABELS = { consumption: '消费', life: '生活', unclassified: '待分类' };
const signedCurrency = (amount: number) => `${amount < 0 ? '−' : ''}¥${formatCurrency(amount)}`;

export default function WishSpendingSummary({ wish }: { wish: WishItem }) {
  const funding = calculateWishFunding(wish);
  const spending = wish.billSpending;
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const expenseItems = useBillDetailStore((state) => state.expenseItems);
  const items = useMemo(() => {
    if (!expanded || !spending?.tags.length) return [];
    const tags = new Set(spending.tags);
    // 从所有月份取命中账单；一笔账单即使命中多个标签也只展示一次。
    return flattenExpenseItems(expenseItems)
      .filter((item) => (item.tags || '').split(',').some((tag) => tags.has(tag.trim())))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [expanded, spending?.tags, expenseItems]);
  return (
    <div className="wish-spending-summary">
      <div className="wish-money-summary">
        <span>已花 <strong>¥{formatCurrency(funding.spentAmount)}</strong></span>
        <span>已还 <strong className="wish-repaid-amount">¥{formatCurrency(funding.repaidAmount)}</strong></span>
      </div>
      {spending && spending.count > 0 ? (
        <div className="wish-spending-breakdown">
          <span>消费 <strong>{signedCurrency(spending.consumptionAmount)}</strong></span>
          <span>生活 <strong>{signedCurrency(spending.lifeAmount)}</strong></span>
          {spending.unclassifiedCount > 0 ? <span>待分类 <strong>{signedCurrency(spending.unclassifiedAmount)}</strong></span> : null}
        </div>
      ) : null}
      {spending && spending.count > 0 ? (
        <div className="wish-money-summary" style={{ marginTop: 7 }}>
          <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{spending.tags.join('、')}</span>
          <button
            type="button"
            className="wish-bills-toggle"
            aria-expanded={expanded}
            aria-controls={detailsId}
            onClick={(event) => {
              event.stopPropagation();
              setExpanded((value) => !value);
            }}
          >
            {spending.count} 笔账单
          </button>
        </div>
      ) : <div className="wish-spending-footer">暂无账单</div>}
      {spending && spending.count > 0 && expanded ? (
        <ul id={detailsId} className="wish-bill-list" aria-label={`${wish.name}账单明细`}>
          {items.map((item, index) => (
            <li key={index} className="wish-bill-row">
              <div className="wish-bill-description">
                <div>{item.note || item.subcategory || item.category || '账单'}</div>
                <div className="wish-bill-meta">
                  <span className={`wish-bill-kind wish-bill-kind--${classifyWishBill(item)}`}>{BILL_KIND_LABELS[classifyWishBill(item)]}</span>
                  {' · '}
                  <time dateTime={item.date}>{item.date}</time>
                  {item.account ? ` · ${item.account}` : ''}
                </div>
              </div>
              <span className="wish-bill-amount">{item.amount < 0 ? '退款 ' : ''}¥{formatCurrency(item.amount)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
