import { feelingEntries } from './feelings.js';
import { wearId, type ClothesItem, type Sensation, type WearRecord } from './types.js';
import { COMFORT_TEMPERATURE, isOutdoorCoat, itemRegions, itemWarmth } from './warmth.js';

const sensations: Record<Sensation, number> = { 很冷: -4, 偏冷: -2, 舒适: 0, 偏热: 2, 很热: 4 };
export function calibratedItems(items: ClothesItem[], records: WearRecord[], today: string): ClothesItem[] {
  const base = new Map(items.map((item) => [item.id, itemWarmth({ ...item, learnedWarmth: undefined })]));
  const values = new Map(base), observations = new Map<string, number>();
  const history = [...new Map(records.map((record) => [wearId(record), record])).values()]
    .filter((record) => record.kind !== 'styled' && record.date <= today && record.purpose !== '运动' && !record.context?.active)
    .sort((a, b) => a.date.localeCompare(b.date) || a.confirmedAt.localeCompare(b.confirmedAt) || wearId(a).localeCompare(wearId(b)));
  for (const record of history) for (const entry of feelingEntries(record)) {
    for (const environment of ['indoor', 'outdoor'] as const) {
      const sensation = entry[environment], temperature = entry[`${environment}Temperature`];
      if (!sensation || temperature == null || !Number.isFinite(temperature) || (record.purpose === '睡觉' && environment === 'outdoor')) continue;
      const worn = record.items.filter((item) => environment !== 'indoor' || record.indoorCoat || !isOutdoorCoat(item));
      const updated = new Set<string>();
      const before = new Map(values);
      // Whole-body feedback only calibrates torso layers; it cannot tell us
      // whether a hat, sock or glove was too warm at its own local threshold.
      for (const region of ['upper', 'lower'] as const) {
        const pieces = worn.filter((item) => itemRegions(item).includes(region));
        if (!pieces.length) continue;
        const adjustable = pieces.filter((item) => base.has(item.id));
        if (!adjustable.length) continue;
        const total = pieces.reduce((sum, item) => sum + (before.get(item.id) ?? itemWarmth(item)), 0);
        const target = Math.max(0, COMFORT_TEMPERATURE + sensations[sensation] - temperature);
        const error = Math.max(-4, Math.min(4, target - total));
        const weight = adjustable.reduce((sum, item) => sum + Math.max(.5, base.get(item.id)!), 0);
        for (const item of adjustable) {
          const prior = base.get(item.id)!;
          // Share one observation across all regions covered by this garment.
          const rate = .25 / itemRegions(item).filter((part) => part === 'upper' || part === 'lower').length;
          const next = values.get(item.id)! + error * rate * Math.max(.5, prior) / weight;
          values.set(item.id, Math.max(0, prior - 3, Math.min(40, prior + 3, next)));
          updated.add(item.id);
        }
      }
      for (const id of updated) observations.set(id, (observations.get(id) ?? 0) + 1);
    }
  }
  return items.map((item) => ({ ...item, learnedWarmth: (observations.get(item.id) ?? 0) >= 2 ? Math.round(values.get(item.id)! * 2) / 2 : undefined }));
}
