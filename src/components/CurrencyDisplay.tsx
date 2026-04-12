interface CurrencyDisplayProps {
  value: number;
  color?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const sizeMap = { sm: 12, md: 14, lg: 18, xl: 28 };

export function formatCurrency(value: number): string {
  return Math.abs(value).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function CurrencyDisplay({
  value,
  color,
  size = 'md',
}: CurrencyDisplayProps) {
  const sign = value < 0 ? '-' : '';
  return (
    <span
      style={{
        fontVariantNumeric: 'tabular-nums',
        fontSize: sizeMap[size],
        color: color || 'inherit',
        fontWeight: size === 'xl' ? 700 : 500,
      }}
    >
      {sign}¥{formatCurrency(value)}
    </span>
  );
}
