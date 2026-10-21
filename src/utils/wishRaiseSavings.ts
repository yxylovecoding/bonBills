import type { RaiseSavingsSettings } from '../models/types';
import { calculateMonthlyRaiseSavings, resolveRaiseSavingsSettings, resolveRecurringIncomeBaseline } from '../calculations/reconcileTransfers';

export function wishMonthlyRaiseSavings(income: number, baseline?: number, settings?: RaiseSavingsSettings): number {
  return calculateMonthlyRaiseSavings(income, 0, baseline, settings);
}

/** Net income required to leave this much available after the monthly reserve. */
export function wishRequiredIncome(available: number, baseline?: number, settings?: RaiseSavingsSettings): number {
  const cents = Math.ceil(available * 100 - 1e-7);
  const resolved = resolveRaiseSavingsSettings(settings);
  if (!resolved.enabled) return cents / 100;
  if (resolved.mode === 'manual') return cents / 100 + wishMonthlyRaiseSavings(0, baseline, resolved);
  const baselineCents = Math.round(resolveRecurringIncomeBaseline(baseline) * 100);
  return (cents <= baselineCents ? cents : 2 * cents - baselineCents) / 100;
}

export interface WishIncomeGroup {
  yearMonth: string;
  dates: string[];
  gains: number[];
  income: (count: number) => number;
}

/** Combine payrolls paid in the same month before applying the one monthly baseline. */
export function reserveWishIncomeGroups(groups: WishIncomeGroup[], baseIncome: Record<string, number>, baseline?: number, settings?: RaiseSavingsSettings, planningMonths?: string[]) {
  const months = [...new Set([...(planningMonths ?? []), ...Object.keys(baseIncome), ...groups.map(group => group.yearMonth)])].sort();
  const resolved = resolveRaiseSavingsSettings(settings);
  const manualMonths = new Set(planningMonths ?? months);
  const prepared = months.map(yearMonth => {
    const entries = groups.map((group, index) => ({ group, index })).filter(entry => entry.group.yearMonth === yearMonth);
    const base = baseIncome[yearMonth] ?? 0;
    // Manual mode reserves once per calendar month in the planning window, even without income.
    const saving = (income: number) => resolved.mode === 'manual' && !manualMonths.has(yearMonth)
      ? 0 : wishMonthlyRaiseSavings(income, baseline, resolved);
    const baseSaving = saving(base);
    type Choice = { income: number; cost: number; counts: number[] };
    let states: Choice[][] = [[{ income: 0, cost: 0, counts: [] }]];
    for (const { group } of entries) {
      const next: Choice[][] = [];
      for (let previous = 0; previous < states.length; previous++) {
        for (const state of states[previous] ?? []) {
          for (let count = 0; count <= group.dates.length; count++) {
            const income = group.income(count);
            const choice = { income: state.income + income, cost: state.cost + income - group.gains[count], counts: [...state.counts, count] };
            const bucket = next[previous + count] ?? [];
            // Preserve income/cost tradeoffs: tax and the savings threshold make raw gain alone insufficient.
            if (bucket.some(other => other.income >= choice.income - 1e-7 && other.cost <= choice.cost + 1e-7)) continue;
            next[previous + count] = bucket.filter(other => !(choice.income >= other.income - 1e-7 && choice.cost <= other.cost + 1e-7));
            next[previous + count].push(choice);
          }
        }
      }
      states = next;
    }
    const gain = (choice: Choice) => choice.income - choice.cost - (saving(base + choice.income) - baseSaving);
    const choices = states.map(bucket => bucket.reduce((best, choice) => gain(choice) > gain(best) + 1e-7 ? choice : best));
    return {
      dates: entries.flatMap(({ group }) => group.dates),
      gains: choices.map(gain),
      datesForCount: (count: number) => entries.flatMap(({ group }, index) => group.dates.slice(0, choices[count].counts[index])),
      saving: (count: number) => saving(base + choices[count].income),
      originalCounts: (count: number) => entries.map(({ index }, i) => ({ index, count: choices[count].counts[i] })),
    };
  });
  return {
    groups: prepared,
    baseSavings: prepared.reduce((sum, group) => sum + group.saving(0), 0),
    savings: (counts: number[]) => Math.round(prepared.reduce((sum, group, i) => sum + group.saving(counts[i] ?? 0), 0) * 100) / 100,
    originalCounts: (counts: number[]) => {
      const result = groups.map(() => 0);
      prepared.forEach((group, i) => group.originalCounts(counts[i] ?? 0).forEach(entry => { result[entry.index] = entry.count; }));
      return result;
    },
  };
}
