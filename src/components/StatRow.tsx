import type { ReactNode } from 'react';

interface StatRowProps {
  label: ReactNode;
  value: ReactNode;
  indent?: boolean;
  labelClass?: string;
  valueClass?: string;
}

export default function StatRow({
  label,
  value,
  indent = false,
  labelClass = '',
  valueClass = '',
}: StatRowProps) {
  return (
    <div
      className={`flex items-center justify-between py-1.5 text-sm
                  ${indent ? 'pl-4' : ''}`}
    >
      <span className={`text-white/60 ${labelClass}`}>{label}</span>
      <span className={`font-medium tabular-nums ${valueClass}`}>{value}</span>
    </div>
  );
}
