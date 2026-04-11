interface CurrencyDisplayProps {
  value: number;
  className?: string;
  showSign?: boolean; // 显示 +/-
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const sizeClass: Record<NonNullable<CurrencyDisplayProps['size']>, string> = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-lg',
  xl: 'text-3xl',
};

export function formatCurrency(value: number): string {
  return value.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function CurrencyDisplay({
  value,
  className = '',
  showSign = false,
  size = 'md',
}: CurrencyDisplayProps) {
  const formatted = formatCurrency(Math.abs(value));
  const sign = value < 0 ? '-' : showSign ? '+' : '';
  return (
    <span className={`tabular-nums ${sizeClass[size]} ${className}`}>
      {sign}¥{formatted}
    </span>
  );
}
