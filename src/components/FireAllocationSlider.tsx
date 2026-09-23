import { useLayoutEffect, useRef, useState } from 'react';

const PURPLE = '#7c3aed';
const MIN_RATE = 0.1;

export interface FireSalaryMatch {
  name: '活' | '生活';
  emoji: '🛋️' | '🧳';
  rate: number | null;
  annualGrossIncome: number;
}

function isInRange(match: FireSalaryMatch) {
  return match.rate !== null && Number.isFinite(match.rate) && match.rate >= MIN_RATE && match.rate <= 1;
}

function matchTitle(match: FireSalaryMatch) {
  return `${match.name}同薪 ${Math.round(match.rate! * 100)}% · 首年税前年薪 ${(match.annualGrossIncome / 10000).toFixed(2)}万`;
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
  const matches = [lifeMatch, livingMatch];
  const visible = matches.filter(isInRange);
  const unavailable = matches.filter((match) => !isInRange(match));
  const point = (match: FireSalaryMatch) => 8 + (match.rate! - MIN_RATE) / (1 - MIN_RATE) * (trackWidth - 16);
  const distance = visible.length === 2 ? Math.abs(point(visible[0]) - point(visible[1])) : Infinity;
  const wrapped = distance < 44;
  const samePercent = visible.length === 2 && Math.round(visible[0].rate! * 100) === Math.round(visible[1].rate! * 100);
  // 极近的刻度共用标签组；短线始终留在实际比例位置，不为文字避让而移动。
  const groups = distance < 28 ? [visible] : visible.map((match) => [match]);

  return (
    <div
      onClick={(event) => event.stopPropagation()}
      style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14, padding: '9px 11px', borderRadius: 10, backgroundColor: '#f8f5ff', border: '1px solid #ede7f6' }}
    >
      <span style={{ fontSize: 12, fontWeight: 700, color: PURPLE, whiteSpace: 'nowrap' }}>活后分配</span>
      <div style={{ flex: '1 1 110px', minWidth: 110, padding: '0 20px', boxSizing: 'border-box' }}>
        <div ref={trackRef} style={{ position: 'relative', height: wrapped ? 47 : 32 }}>
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
          {visible.map((match) => <span key={match.name} aria-hidden="true" style={{ position: 'absolute', left: point(match), top: 13, width: 2, height: 5, transform: 'translateX(-50%)', backgroundColor: PURPLE, borderRadius: 999, pointerEvents: 'none' }} />)}
          {groups.map((group) => (
            <span
              key={group.map((match) => match.name).join('-')}
              aria-label={group.map((match) => `${match.name}同薪 ${Math.round(match.rate! * 100)}%`).join('，')}
              title={group.map(matchTitle).join('\n')}
              style={{ position: 'absolute', left: group.reduce((sum, match) => sum + point(match), 0) / group.length, top: 18, transform: 'translateX(-50%)', display: 'flex', flexDirection: samePercent ? 'column' : 'row', gap: samePercent ? 0 : 6, alignItems: 'center', color: PURPLE, fontSize: 10, fontWeight: 700, lineHeight: '14px', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}
            >
              {samePercent ? <>
                <span aria-hidden="true">{group.map((match) => match.emoji).join(' ')}</span>
                <span aria-hidden="true">{Math.round(group[0].rate! * 100)}%</span>
              </> : group.map((match) => (
                <span key={match.name} aria-hidden="true" style={{ display: 'flex', flexDirection: wrapped ? 'column' : 'row', alignItems: 'center' }}>
                  <span>{match.emoji}</span>
                  <span>{Math.round(match.rate! * 100)}%</span>
                </span>
              ))}
            </span>
          ))}
        </div>
        {unavailable.length > 0 && <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, fontSize: 10, color: '#5f6368', lineHeight: '14px', whiteSpace: 'nowrap' }}>
          {unavailable.map((match) => (
            <span key={match.name} aria-label={`${match.name}同薪不可达`} title={`${match.name}同薪不在10%–100%的分配范围内`}>
              {match.emoji}不可达
            </span>
          ))}
        </div>}
      </div>
      <span style={{ fontSize: 12, color: '#5f6368', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
        存 <strong style={{ color: '#1a73e8' }}>{Math.round(rate * 100)}%</strong>
        {' · '}消费/心愿 <strong style={{ color: PURPLE }}>{Math.round((1 - rate) * 100)}%</strong>
      </span>
    </div>
  );
}
