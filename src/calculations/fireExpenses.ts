import type { AppConfig, CurrentStats, TagKind } from '../models/types';

export const DEFAULT_FIRE_GRADUATION_DATE = '2028-06-20';
const SCENARIOS: TagKind[] = ['school', 'intern', 'home', 'travel'];

export function getFireGraduationDate(config: AppConfig): string {
  const milestone = config.wishDeadlineMilestones?.find((item) => item.id === 'milestone_graduation');
  for (const date of [config.fireGraduationDate, milestone?.date]) {
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      const parsed = new Date(`${date}T00:00:00`);
      if (!Number.isNaN(parsed.getTime()) && parsed.getDate() === Number(date.slice(-2))) return date;
    }
  }
  return DEFAULT_FIRE_GRADUATION_DATE;
}

/** FIRE 前的场景独立于退休选择：毕业前沿用四种场景占比，毕业后为班＋游。 */
export function calcPreFireExpenses(stats: CurrentStats, fixedMonthlyExpense: number) {
  const days = SCENARIOS.reduce((sum, kind) => sum + stats.stateDailyConfidence[kind], 0);
  const travelRatio = days > 0 ? stats.stateDailyConfidence.travel / days : 0;
  const weightedDaily = (values: Record<TagKind, number>, fallback: number) => days > 0
    ? SCENARIOS.reduce((sum, kind) => sum + values[kind] * stats.stateDailyConfidence[kind], 0) / days
    : fallback;
  const studentLifeDaily = weightedDaily(stats.stateDailyAvg, (stats.periodicLifeAvg + stats.volatileLifeAvg) * 12 / 365);
  const studentConsumptionDaily = weightedDaily(stats.stateConsumptionDailyAvg, stats.consumptionAvg * 12 / 365);
  const workSample = stats.stateDailyConfidence.intern > 0
    ? 'intern'
    : stats.stateDailyConfidence.school > 0 ? 'school' : null;
  const workLifeDaily = workSample ? stats.stateDailyAvg[workSample] : studentLifeDaily;
  const workConsumptionDaily = workSample ? stats.stateConsumptionDailyAvg[workSample] : studentConsumptionDaily;
  const travelLifeDaily = stats.stateDailyConfidence.travel > 0 ? stats.stateDailyAvg.travel : workLifeDaily;
  const travelConsumptionDaily = stats.stateDailyConfidence.travel > 0 ? stats.stateConsumptionDailyAvg.travel : workConsumptionDaily;
  const fixedAnnualExpense = Math.max(fixedMonthlyExpense, 0) * 12;
  return {
    beforeGraduation: {
      lifeAnnualExpense: studentLifeDaily * 365 + fixedAnnualExpense,
      consumptionAnnualExpense: studentConsumptionDaily * 365,
    },
    working: {
      lifeAnnualExpense: (workLifeDaily * (1 - travelRatio) + travelLifeDaily * travelRatio) * 365 + fixedAnnualExpense,
      consumptionAnnualExpense: (workConsumptionDaily * (1 - travelRatio) + travelConsumptionDaily * travelRatio) * 365,
    },
    workSample,
  };
}
