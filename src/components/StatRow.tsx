import type { ReactNode } from 'react';

interface StatRowProps {
  label: ReactNode;
  value: ReactNode;
  indent?: boolean;
}

export default function StatRow({ label, value, indent = false }: StatRowProps) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '7px 0',
        paddingLeft: indent ? 16 : 0,
        fontSize: 14,
      }}
    >
      <span style={{ color: '#5f6368' }}>{label}</span>
      <span style={{ fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </span>
    </div>
  );
}
