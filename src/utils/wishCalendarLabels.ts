import type { WishInternSavingRecord } from '../models/types';

// Future and unconfirmed dates always use the current plan. Historical records
// remain stored, but stale free-text themes cannot invent a current wish label.
export function savedWishCalendarLabels(records: readonly WishInternSavingRecord[], namesById: Record<string, string>, today: string) {
  return new Map(records.filter((record) => record.confirmed && record.date < today && namesById[record.wishId])
    .map((record) => [record.date, namesById[record.wishId]]));
}
