export const MONTHLY_BACKUP_INDEX_KEY = 'sync-history:monthly:index';
export const MONTHLY_BACKUP_PREFIX = 'sync-history:monthly:';
export const MONTHLY_BACKUP_RETENTION = 12;
export const MANUAL_BACKUP_INDEX_KEY = 'sync-history:manual:index';
export const MANUAL_BACKUP_PREFIX = 'sync-history:manual:';
export const MANUAL_BACKUP_RETENTION = 20;

export interface MonthlyBackupIndexEntry {
  date: string;
  createdAt: string;
  key: string;
}

export function getShanghaiDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function mergeMonthlyBackupIndex(
  existing: MonthlyBackupIndexEntry[],
  current: MonthlyBackupIndexEntry,
  retention = MONTHLY_BACKUP_RETENTION,
) {
  const byDate = new Map(existing.map((entry) => [entry.date, entry]));
  byDate.set(current.date, current);
  const sorted = [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
  return {
    retained: sorted.slice(0, retention),
    removed: sorted.slice(retention),
  };
}

export function mergeManualBackupIndex(
  existing: MonthlyBackupIndexEntry[],
  current: MonthlyBackupIndexEntry,
  retention = MANUAL_BACKUP_RETENTION,
) {
  const byKey = new Map(existing.map((entry) => [entry.key, entry]));
  byKey.set(current.key, current);
  const sorted = [...byKey.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    retained: sorted.slice(0, retention),
    removed: sorted.slice(retention),
  };
}
