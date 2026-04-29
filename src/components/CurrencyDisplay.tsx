interface CurrencyDisplayProps {
  value: number;
  color?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  kFormat?: boolean;
}

const sizeMap = { sm: 12, md: 14, lg: 18, xl: 28 };

export function formatCurrency(value: number): string {
  return Math.abs(value).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatK(value: number): string {
  const k = Math.round(Math.abs(value) / 100) / 10;
  return `${Number.isInteger(k) ? k.toFixed(0) : k.toFixed(1)}k`;
}

export default function CurrencyDisplay({
  value,
  color,
  size = 'md',
  kFormat = false,
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
      {sign}¥{kFormat ? formatK(value) : formatCurrency(value)}
    </span>
  );
}
