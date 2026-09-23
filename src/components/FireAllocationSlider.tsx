const PURPLE = '#7c3aed';
const MIN_RATE = 0.1;

interface FireSalaryMatch {
  rate: number | null;
  annualGrossIncome: number;
}

export default function FireAllocationSlider({ rate, onChange, livingMatch }: {
  rate: number;
  onChange: (value: string) => void;
  livingMatch: FireSalaryMatch;
}) {
  const matchRate = livingMatch.rate;
  const inRange = matchRate !== null && Number.isFinite(matchRate) && matchRate >= MIN_RATE && matchRate <= 1;
  const position = inRange ? (matchRate - MIN_RATE) / (1 - MIN_RATE) : 0;
  const point = `calc(8px + ${position * 100}% - ${position * 16}px)`;
  const label = `当前生活水平 ${inRange ? `${Math.round(matchRate * 100)}%` : '—'}`;
  const title = inRange
    ? `与当前生活水平所需首年税前年薪 ${(livingMatch.annualGrossIncome / 10000).toFixed(2)}万 相同`
    : '当前生活水平同薪点不在10%–100%的分配范围内';

  return (
    <div
      onClick={(event) => event.stopPropagation()}
      style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14, padding: '9px 11px', borderRadius: 10, backgroundColor: '#f8f5ff', border: '1px solid #ede7f6' }}
    >
      <span style={{ fontSize: 12, fontWeight: 700, color: PURPLE, whiteSpace: 'nowrap' }}>活后分配</span>
      <div style={{ flex: '1 1 140px', minWidth: 140, padding: '0 36px', boxSizing: 'border-box' }}>
        <div style={{ position: 'relative', height: 32 }}>
          <input
            type="range"
            min="10"
            max="100"
            step="10"
            value={Math.round(rate * 100)}
            onChange={(event) => onChange(event.target.value)}
            aria-label="覆盖活后收入的存入比例"
            style={{ display: 'block', width: '100%', height: 16, margin: 0, accentColor: PURPLE, cursor: 'pointer' }}
          />
          {inRange && <span aria-hidden="true" style={{ position: 'absolute', left: point, top: 13, width: 2, height: 5, transform: 'translateX(-50%)', backgroundColor: PURPLE, borderRadius: 999, pointerEvents: 'none' }} />}
          <span
            aria-label={label}
            title={title}
            style={{ position: 'absolute', left: inRange ? point : '50%', top: 18, transform: 'translateX(-50%)', color: PURPLE, fontSize: 10, fontWeight: 700, lineHeight: '14px', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}
          >
            {label}
          </span>
        </div>
      </div>
      <span style={{ fontSize: 12, color: '#5f6368', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
        存 <strong style={{ color: '#1a73e8' }}>{Math.round(rate * 100)}%</strong>
        {' · '}消费/心愿 <strong style={{ color: PURPLE }}>{Math.round((1 - rate) * 100)}%</strong>
      </span>
    </div>
  );
}
