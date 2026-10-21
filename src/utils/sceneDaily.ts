import type { CurrentStats, LocalLifeBreakdownRow, SceneCity, TagKind } from '../models/types';
import { cityKey } from './internship';

export interface SceneCitySummary {
  key: string;
  city: SceneCity;
  days: number;
  lifeVal: number;
  consumptionVal: number;
  localLifeBreakdown: LocalLifeBreakdownRow[];
}

export function sceneCitySummaries(stats: Pick<CurrentStats, 'cityLivingStats'>, tagKind: TagKind): SceneCitySummary[] {
  if (tagKind !== 'school' && tagKind !== 'intern') return [];
  const cities = new Map<string, SceneCitySummary>();
  for (const sample of Object.values(stats.cityLivingStats ?? {})) {
    if (sample.days <= 0 || (tagKind === 'school' ? sample.kind !== 'school' : sample.kind !== 'work' && sample.kind !== 'rest')) continue;
    const key = cityKey(sample.city);
    const city = cities.get(key) ?? { key, city: sample.city, days: 0, lifeVal: 0, consumptionVal: 0, localLifeBreakdown: [] };
    city.days += sample.days;
    city.lifeVal += sample.dailyAverage * sample.days;
    city.consumptionVal += sample.consumptionAmount ?? 0;
    for (const row of sample.localLifeBreakdown ?? []) {
      let category = city.localLifeBreakdown.find(r => r.category === row.category);
      if (!category) city.localLifeBreakdown.push(category = { category: row.category, amountTotal: 0, dailyBase: 0, subcategories: [] });
      category.amountTotal += row.amountTotal;
      for (const sub of row.subcategories) {
        let subcategory = category.subcategories.find(r => r.subcategory === sub.subcategory);
        if (!subcategory) category.subcategories.push(subcategory = { subcategory: sub.subcategory, amountTotal: 0, dailyBase: 0 });
        subcategory.amountTotal += sub.amountTotal;
      }
    }
    cities.set(key, city);
  }
  for (const city of cities.values()) {
    city.lifeVal /= city.days;
    city.consumptionVal /= city.days;
    for (const category of city.localLifeBreakdown) {
      category.dailyBase = category.amountTotal / city.days;
      for (const sub of category.subcategories) sub.dailyBase = sub.amountTotal / city.days;
    }
  }
  return [...cities.values()];
}
