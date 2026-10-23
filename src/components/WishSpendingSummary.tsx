import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import type { WishItem } from '../models/types';
import { useBillStatisticItems } from '../hooks/useBillStatisticItems';
import { calculateWishFunding } from '../utils/wishes';
import TagLogicStats from './TagLogicStats';
import { formatCurrency } from './CurrencyDisplay';

const signedCurrency = (amount: number) => `${amount < 0 ? '−' : ''}¥${formatCurrency(amount)}`;

export default function WishSpendingSummary({ wish, completedAmount, travelDays }: { wish: WishItem; completedAmount?: ReactNode; travelDays?: number }) {
  const compact = completedAmount !== undefined;
  const funding = calculateWishFunding(wish);
  const spending = wish.billSpending;
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  return (
    <div className={`wish-spending-summary${compact ? ' wish-spending-summary--compact' : ''}`}>
      <div className={compact ? 'wish-spending-overview' : undefined}>
        {compact && completedAmount}
        <div style={{ minWidth: 0 }}>
          {!compact && <div className="wish-money-summary">
            <span>已花 <strong>¥{formatCurrency(funding.spentAmount)}</strong></span>
            <span>已还 <strong className="wish-repaid-amount">¥{formatCurrency(funding.repaidAmount)}</strong></span>
          </div>}
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
                {spending.count} 条账单
              </button>
            </div>
          ) : <div className="wish-spending-footer">暂无账单</div>}
        </div>
      </div>
      {spending && spending.count > 0 && expanded ? (
        <section
          id={detailsId}
          aria-label={`${wish.name}账单统计`}
          style={{ marginTop: 10 }}
          onClick={(event) => event.stopPropagation()}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 6, marginBottom: 8 }}>
            <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#202124' }}>账单统计</h3>
            <span style={{ fontSize: 11, color: '#5f6368', overflowWrap: 'anywhere' }}>{spending.tags.join('、')}</span>
          </div>
          <WishBillStats key={JSON.stringify(spending.tags)} tags={spending.tags} travelDays={travelDays} />
        </section>
      ) : null}
    </div>
  );
}

function WishBillStats({ tags, travelDays }: { tags: string[]; travelDays?: number }) {
  const items = useBillStatisticItems();
  return <TagLogicStats items={items} initialTags={tags} compact dailyAverageDays={travelDays} />;
}
