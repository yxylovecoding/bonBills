import { feelingEntries } from './feelings.js';
import { categoryLabel, wearId, type ClothesItem, type Sensation, type WearRecord } from './types.js';
import { isOutdoorCoat, itemWarmth } from './warmth.js';

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
      for (const region of [['内衣', '上衣', '外套', '连衣裙'], ['下装', '连衣裙']]) {
        const pieces = worn.filter((item) => region.includes(categoryLabel(item.category)));
        if (!pieces.length) continue;
        const adjustable = pieces.filter((item) => base.has(item.id));
        if (!adjustable.length) continue;
        const total = pieces.reduce((sum, item) => sum + (values.get(item.id) ?? itemWarmth(item)), 0);
        const target = Math.max(0, 26 + sensations[sensation] - temperature);
        const error = Math.max(-4, Math.min(4, target - total));
        const weight = adjustable.reduce((sum, item) => sum + Math.max(.5, base.get(item.id)!), 0);
        for (const item of adjustable) {
          const prior = base.get(item.id)!;
          // A dress contributes to both regions; don't count one sensation twice.
          const rate = categoryLabel(item.category) === '连衣裙' ? .125 : .25;
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
