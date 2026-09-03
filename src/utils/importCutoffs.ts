import type { AccountSnapshot, MonthlyRecord } from '../models/types';

export function investmentImportCutoff(records: MonthlyRecord[]) {
  return records.reduce<string | undefined>(
    (latest, record) => record.investmentEditedAt && (!latest || record.investmentEditedAt > latest)
      ? record.investmentEditedAt
      : latest,
    undefined,
  );
}

export function accountBalanceUpdatedAt(snapshot: AccountSnapshot) {
  if (snapshot.accountBalanceUpdatedAt) return snapshot.accountBalanceUpdatedAt;
  const cursors = Object.values(snapshot.accountBalanceSync ?? {}).filter(
    (cursor): cursor is NonNullable<typeof cursor> => Boolean(cursor?.editedAt),
  );
  return cursors.reduce<string | undefined>(
    (latest, cursor) => {
      const updatedAt = cursor.syncedAt ?? cursor.editedAt;
      return !latest || updatedAt > latest ? updatedAt : latest;
    },
    undefined,
  );
}

export function formatImportCutoff(value?: string) {
  if (!value) return '待设起点';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value.slice(5, 16).replace('T', ' ');
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
