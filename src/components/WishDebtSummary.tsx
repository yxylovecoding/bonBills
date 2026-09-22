import { useState } from 'react';
import type { WishItem } from '../models/types';
import { calculateWishDebtSummary } from '../utils/wishes';
import { tryEvalFormula } from '../utils/formula';
import { roundToSitePrecision } from '../utils/numberInput';
import AmountInput from './AmountInput';
import Card from './Card';
import { formatCurrency } from './CurrencyDisplay';

export default function WishDebtSummary({ wishes, total, onChange }: {
  wishes: WishItem[];
  total?: number;
  onChange: (value: number | undefined) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState('');
  const summary = calculateWishDebtSummary(wishes, total);
  const commit = (raw: string) => {
    if (draft === null) return;
    const amount = Number(tryEvalFormula(raw) ?? raw);
    if (!Number.isFinite(amount) || amount < 0) {
      setError('请输入有效的非负金额');
      return;
    }
    onChange(raw.trim() ? roundToSitePrecision(amount) : undefined);
    setDraft(null);
    setError('');
  };
  return (
    <Card title="还欠自己" className="wish-debt-summary">
      <label className="wish-debt-total">
        <span>总欠款</span>
        <span>¥
          <AmountInput
            aria-label="还欠自己总额"
            value={draft ?? String(summary.totalAmount)}
            onChange={setDraft}
            onBlur={(event) => commit(event.currentTarget.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
            placeholder="0"
          />
        </span>
      </label>
      <div className="wish-debt-breakdown">
        <span>心愿内 <strong>¥{formatCurrency(summary.assignedAmount)}</strong></span>
        <span>未归属心愿 <strong>¥{formatCurrency(summary.unassignedAmount)}</strong></span>
      </div>
      {summary.discrepancyAmount > 0 && <div className="wish-money-error" role="status">总欠款待核对 · 相差 ¥{formatCurrency(summary.discrepancyAmount)}</div>}
      {error && <div className="wish-money-error" role="alert">{error}</div>}
    </Card>
  );
}
