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

export function confirmPendingWishInternSavings(
  wishes: readonly WishItem[],
  records: readonly WishInternSavingRecord[],
  wishId: string,
  today: string,
): { confirmedAmount: number; wishes: WishItem[]; records: WishInternSavingRecord[] } {
  if (!wishes.some((wish) => wish.id === wishId)) {
    return { confirmedAmount: 0, wishes: [...wishes], records: [...records] };
  }
  const pendingRecords = pendingWishInternSavingRecords(records, today)
    .filter((record) => record.wishId === wishId);
  const confirmedAmount = Math.round(
    pendingRecords.reduce((sum, record) => sum + record.amount, 0) * 100,
  ) / 100;
  if (confirmedAmount <= 0) {
    return { confirmedAmount: 0, wishes: [...wishes], records: [...records] };
  }
  const pendingRecordSet = new Set(pendingRecords);
  return {
    confirmedAmount,
    wishes: wishes.map((wish) => wish.id === wishId
      ? { ...wish, savedAmount: Math.round((wish.savedAmount + confirmedAmount) * 100) / 100 }
      : wish),
    records: records.map((record) => pendingRecordSet.has(record)
      ? { ...record, confirmed: true }
      : record),
  };
}
