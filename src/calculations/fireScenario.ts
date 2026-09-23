import type { CurrentStats, FireExpenseScenario, FutureFireExpense } from '../models/types';

export type FireBaseScenario = 'home' | 'independent';

export function resolveFireScenario(scenario: FireExpenseScenario = 'independent') {
  const base: FireBaseScenario = scenario === 'home' || scenario === 'homeTravel' ? 'home' : 'independent';
  const includesTravel = scenario === 'homeTravel' || scenario === 'independentTravel'
    || scenario === 'schoolTravel' || scenario === 'travel';
  return { base, includesTravel, sampleKind: base === 'home' ? 'home' as const : 'school' as const };
}

export function encodeFireScenario(base: FireBaseScenario, includesTravel: boolean): FireExpenseScenario {
  return includesTravel ? (base === 'home' ? 'homeTravel' : 'independentTravel') : base;
}

export function getFireFixedExpenses(expenses: readonly FutureFireExpense[]) {
  let rent = 0;
  let other = 0;
  for (const expense of expenses) {
    if (!expense.isActive || !Number.isFinite(expense.monthlyAmount)) continue;
    const amount = Math.max(expense.monthlyAmount, 0);
    if (/租房|房租|住房租金/.test(expense.name)) rent += amount;
    else other += amount;
  }
  return { rent, other, total: rent + other };
}

/** 退休后的独居使用校样本，房租按全年计入，旅行仅对日常支出加权。 */
export function calcPostFireExpenses(stats: CurrentStats, expenses: readonly FutureFireExpense[], scenario?: FireExpenseScenario) {
  const { base, includesTravel, sampleKind } = resolveFireScenario(scenario);
  const days = Object.values(stats.stateDailyConfidence).reduce((sum, count) => sum + count, 0);
  const travelRatio = days > 0 ? stats.stateDailyConfidence.travel / days : 0;
  const hasData = stats.stateDailyConfidence[sampleKind] > 0 || (includesTravel && stats.stateDailyConfidence.travel > 0);
  const fallbackSample = stats.stateDailyConfidence[sampleKind] > 0
    ? sampleKind
    : stats.stateDailyConfidence.school > 0 || !includesTravel ? 'school' : 'travel';
  const baseLifeDaily = stats.stateDailyAvg[fallbackSample];
  const baseConsumptionDaily = stats.stateConsumptionDailyAvg[fallbackSample];
  const travelLifeDaily = stats.stateDailyConfidence.travel > 0 ? stats.stateDailyAvg.travel : baseLifeDaily;
  const travelConsumptionDaily = stats.stateDailyConfidence.travel > 0 ? stats.stateConsumptionDailyAvg.travel : baseConsumptionDaily;
  const lifeDaily = includesTravel ? baseLifeDaily * (1 - travelRatio) + travelLifeDaily * travelRatio : baseLifeDaily;
  const consumptionDaily = includesTravel ? baseConsumptionDaily * (1 - travelRatio) + travelConsumptionDaily * travelRatio : baseConsumptionDaily;
  const fixed = getFireFixedExpenses(expenses);
  const monthlyRentExpense = base === 'independent' ? fixed.rent : 0;
  const monthlyFixedExpense = fixed.other + monthlyRentExpense;
  return {
    base, includesTravel, sampleKind, fallbackSample, travelRatio,
    annualizedTravelDays: travelRatio * 365,
    configuredMonthlyFixedExpense: fixed.total,
    monthlyFixedExpense,
    monthlyRentExpense,
    lifeAnnualExpense: lifeDaily * 365 + monthlyFixedExpense * 12,
    consumptionAnnualExpense: hasData ? consumptionDaily * 365 : stats.consumptionAvg * 12,
  };
}
