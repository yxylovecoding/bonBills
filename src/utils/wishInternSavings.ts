import type { WishInternSavingRecord, WishItem } from '../models/types';

export const WISH_INTERN_SAVING_START_DATE = '2026-08-21';

export function pendingWishInternSavingRecords(
  records: readonly WishInternSavingRecord[],
  today: string,
): WishInternSavingRecord[] {
  return records.filter((record) => (
    !record.confirmed
    && record.date >= WISH_INTERN_SAVING_START_DATE
    && record.date < today
    && record.amount > 0
  ));
}

export function pendingWishInternSavingsByWish(
  records: readonly WishInternSavingRecord[],
  today: string,
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const record of pendingWishInternSavingRecords(records, today)) {
    result[record.wishId] = (result[record.wishId] ?? 0) + record.amount;
  }
  return result;
}

export function applyPendingWishInternSavings(
  wishes: readonly WishItem[],
  records: readonly WishInternSavingRecord[],
  today: string,
): WishItem[] {
  const pendingByWish = pendingWishInternSavingsByWish(records, today);
  return wishes.map((wish) => ({
    ...wish,
    savedAmount: wish.savedAmount + (pendingByWish[wish.id] ?? 0),
  }));
}
