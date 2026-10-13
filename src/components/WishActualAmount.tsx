import { formatCurrency } from './CurrencyDisplay';

export default function WishActualAmount({ label, original, actual, showSpentLabel = true }: { label: string; original: number; actual: number; showSpentLabel?: boolean }) {
  return (
    <span className="wish-actual-amount" aria-label={`${label} 已花 ¥${formatCurrency(actual)}，已锁定`}>
      {Math.abs(original - actual) >= 0.005 && <del>¥{formatCurrency(original)}</del>}
      <strong>¥{formatCurrency(actual)}</strong>
      {showSpentLabel && <span>已花</span>}
    </span>
  );
}
