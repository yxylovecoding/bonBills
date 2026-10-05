import type { ClothesItem } from './types';
import { environmentWarmth, isOutdoorCoat } from './warmth';

export default function OutfitWarmth({ items, indoorCoat = false, indoorOnly = false }: { items: ClothesItem[]; indoorCoat?: boolean; indoorOnly?: boolean }) {
  if (!items.length) return null;
  const totals = environmentWarmth(items, indoorCoat);
  const hasCoat = items.some(isOutdoorCoat);
  if (indoorOnly || items.every((item) => item.sleepwear)) return <p className="clothes-muted">室内 · 上身 {totals.indoor.upper}°C · 下身 {totals.indoor.lower}°C</p>;
  if (!hasCoat) return <p className="clothes-muted">上身 {totals.outdoor.upper}°C · 下身 {totals.outdoor.lower}°C</p>;
  return <div className="clothes-warmth clothes-muted" aria-label="衣物保暖值">
    <p><span>室内 · {indoorCoat ? '穿外套' : '脱外套'}</span><span>上身 {totals.indoor.upper}°C · 下身 {totals.indoor.lower}°C</span></p>
    <p><span>室外 · 穿外套</span><span>上身 {totals.outdoor.upper}°C · 下身 {totals.outdoor.lower}°C</span></p>
  </div>;
}
