import type { WishDeadlineMilestone } from '../models/types';

export function validMilestoneDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}
export function visibleWishMilestones(items: readonly WishDeadlineMilestone[], today: string) {
  return items.filter((item) => !validMilestoneDate(item.date) || item.date >= today)
    .slice().sort((a, b) => (validMilestoneDate(a.date) ? a.date : '9999').localeCompare(validMilestoneDate(b.date) ? b.date : '9999') || a.id.localeCompare(b.id));
}
export function defaultWishDeadline(items: readonly WishDeadlineMilestone[], id: string | null | undefined, today: string): string | null {
  const item = items.find((candidate) => candidate.id === id);
  return item && item.name.trim() && validMilestoneDate(item.date) && item.date >= today ? item.date : null;
}
