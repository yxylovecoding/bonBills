import { useLayoutEffect, useRef, useState } from 'react';

const PURPLE = '#7c3aed';
const MIN_RATE = 0.1;

export interface FireSalaryMatch {
  name: '活' | '生活';
  emoji: '🛋️' | '🧳';
  rate: number | null;
  annualGrossIncome: number;
}

function markerPosition(rate: number | null) {
  return rate !== null && Number.isFinite(rate) ? Math.min(Math.max((rate - MIN_RATE) / (1 - MIN_RATE), 0), 1) : 0.5;
}

function SalaryMatchMarker({ match, center, wrapped }: { match: FireSalaryMatch; center: number; wrapped: boolean }) {
  const rate = match.rate;
  const valid = rate !== null && Number.isFinite(rate);
  const inRange = valid && rate >= MIN_RATE && rate <= 1;
  const position = markerPosition(rate);
  const point = `calc(8px + ${position * 100}% - ${position * 16}px)`;
  const percentage = valid ? `${Math.round(rate * 100)}%` : '—';
  const displayPercentage = valid && rate >= 10 ? '>999%' : percentage;
  const label = `${match.name}同薪 ${percentage}`;
  const title = valid
    ? `${label} · 首年税前年薪 ${(match.annualGrossIncome / 10000).toFixed(2)}万${inRange ? '' : ' · 超出滑条范围'}`
    : `${match.name}同薪暂不可用`;

  return (
    <>
      {valid && <span aria-hidden="true" style={{ position: 'absolute', left: point, top: 13, width: 2, height: 5, transform: 'translateX(-50%)', backgroundColor: PURPLE, borderRadius: 999, pointerEvents: 'none' }} />}
      <span
        aria-label={label}
        title={title}
        style={{ position: 'absolute', left: center, top: 18, transform: 'translateX(-50%)', width: wrapped ? 42 : 64, display: 'flex', flexDirection: wrapped ? 'column' : 'row', alignItems: 'center', justifyContent: 'center', color: PURPLE, fontSize: 10, fontWeight: 700, lineHeight: '14px', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}
      >
        <span aria-hidden="true">{match.emoji}</span>
        <span aria-hidden="true">{displayPercentage}</span>
      </span>
    </>
  );
}

export default function FireAllocationSlider({ rate, onChange, lifeMatch, livingMatch }: {
  rate: number;
  onChange: (value: string) => void;
  lifeMatch: FireSalaryMatch;
  livingMatch: FireSalaryMatch;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [trackWidth, setTrackWidth] = useState(110);
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const updateWidth = () => setTrackWidth(track.getBoundingClientRect().width);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(track);
    return () => observer.disconnect();
  }, []);
  const point = (match: FireSalaryMatch) => 8 + markerPosition(match.rate) * (trackWidth - 16);
  const boundedCenter = (center: number, halfWidth: number) => Math.min(Math.max(center, halfWidth), trackWidth - halfWidth);
  const lifeCenter = boundedCenter(point(lifeMatch), 32);
  const livingCenter = boundedCenter(point(livingMatch), 32);
  const wrapped = Math.abs(lifeCenter - livingCenter) < 70;
  let centers = [lifeCenter, livingCenter];
  if (wrapped) {
    centers = [boundedCenter(point(lifeMatch), 21), boundedCenter(point(livingMatch), 21)];
    if (Math.abs(centers[0] - centers[1]) < 48) {
      const leftIndex = centers[0] <= centers[1] ? 0 : 1;
      const middle = (centers[0] + centers[1]) / 2;
      const left = Math.min(Math.max(middle - 24, 21), trackWidth - 69);
      centers[leftIndex] = left;
      centers[1 - leftIndex] = left + 48;
    }
  }
  return (
    <div
      onClick={(event) => event.stopPropagation()}
      style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14, padding: '9px 11px', borderRadius: 10, backgroundColor: '#f8f5ff', border: '1px solid #ede7f6' }}
    >
      <span style={{ fontSize: 12, fontWeight: 700, color: PURPLE, whiteSpace: 'nowrap' }}>活后分配</span>
      <div ref={trackRef} style={{ position: 'relative', flex: '1 1 110px', minWidth: 110, height: wrapped ? 47 : 32 }}>
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
        <SalaryMatchMarker match={lifeMatch} center={centers[0]} wrapped={wrapped} />
        <SalaryMatchMarker match={livingMatch} center={centers[1]} wrapped={wrapped} />
      </div>
      <span style={{ fontSize: 12, color: '#5f6368', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
        存 <strong style={{ color: '#1a73e8' }}>{Math.round(rate * 100)}%</strong>
        {' · '}消费/心愿 <strong style={{ color: PURPLE }}>{Math.round((1 - rate) * 100)}%</strong>
      </span>
    </div>
  );
}
