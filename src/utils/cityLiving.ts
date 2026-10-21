import type { CurrentStats, TagKind } from '../models/types';
import { cityKey, resolveDailyContext, type InternshipContext } from './internship';

export function dailyLivingAmount(date: string, tag: TagKind | undefined, stats: Pick<CurrentStats, 'stateDailyAvg' | 'cityLivingStats'>, context?: InternshipContext) {
  if (!context) return stats.stateDailyAvg[tag ?? 'school'];
  const day = resolveDailyContext(date, tag, context);
  const samples = Object.values(stats.cityLivingStats ?? {});
  const own = samples.find(row => row.kind === day.livingKind && cityKey(row.city) === cityKey(day.city));
  if (own && own.days > 0) return own.dailyAverage;
  const peers = samples.filter(row => row.kind === day.livingKind && row.days > 0);
  if (peers.length) return peers.reduce((sum, row) => sum + row.dailyAverage * row.days, 0) / peers.reduce((sum, row) => sum + row.days, 0);
  return stats.stateDailyAvg[day.livingKind === 'rest' ? 'school' : day.tag];
}
