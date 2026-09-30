import { Link } from 'react-router-dom';
import type { WishItem } from '../models/types';
import { calculateWishFunding } from '../utils/wishes';
import { formatCurrency } from './CurrencyDisplay';

export default function WishSpendingSummary({ wish }: { wish: WishItem }) {
  const funding = calculateWishFunding(wish);
  const spending = wish.billSpending;
  return (
    <div className="wish-spending-summary">
      <div className="wish-money-summary">
        <span>已花 <strong>¥{formatCurrency(funding.spentAmount)}</strong></span>
        <span>已还 <strong className="wish-repaid-amount">¥{formatCurrency(funding.repaidAmount)}</strong></span>
      </div>
      {spending && spending.count > 0 ? (
        <div className="wish-money-summary" style={{ marginTop: 7 }}>
          <span>{spending.tags.join('、')}</span>
          <Link to={`/calendar?tab=month&month=${spending.month}`} style={{ flexShrink: 0, color: '#7c3aed' }}>
            {spending.count} 笔账单
          </Link>
        </div>
      ) : <div className="wish-spending-footer">暂无账单</div>}
    </div>
  );
}
