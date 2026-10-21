import type { CurrentStats, SceneCityStat, TagKind } from '../models/types';

export function sceneCitySummaries(stats: Pick<CurrentStats, 'sceneCityStats'>, tagKind: TagKind): SceneCityStat[] {
  return stats.sceneCityStats?.[tagKind] ?? [];
}
