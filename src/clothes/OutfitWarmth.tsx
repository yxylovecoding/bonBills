import { BODY_REGIONS, REGION_LABELS, type ClothesItem } from './types';
import { environmentWarmth, isOutdoorCoat } from './warmth';

export default function OutfitWarmth({ items, indoorCoat = false, indoorOnly = false }: { items: ClothesItem[]; indoorCoat?: boolean; indoorOnly?: boolean }) {
  if (!items.length) return null;
  const totals = environmentWarmth(items, indoorCoat);
  const hasCoat = items.some(isOutdoorCoat);
  const regions = (environment: 'indoor' | 'outdoor') => BODY_REGIONS.map((region) => <span key={region}>{REGION_LABELS[region]} {Math.round(totals[environment][region] * 10) / 10}°C</span>);
  if (indoorOnly || items.every((item) => item.sleepwear)) return <div className="clothes-warmth clothes-muted" aria-label="衣物保暖值"><p><span>室内</span>{regions('indoor')}</p></div>;
  if (!hasCoat) return <div className="clothes-warmth clothes-muted" aria-label="衣物保暖值"><p>{regions('outdoor')}</p></div>;
  return <div className="clothes-warmth clothes-muted" aria-label="衣物保暖值">
    <p><span>室内 · {indoorCoat ? '穿外套' : '脱外套'}</span>{regions('indoor')}</p>
    <p><span>室外 · 穿外套</span>{regions('outdoor')}</p>
  </div>;
}
