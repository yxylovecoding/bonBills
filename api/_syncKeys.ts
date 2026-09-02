export const SYNC_STORE_KEYS = [
  'bill-details',
  'monthly-records',
  'calendar-tags',
  'trip-tags',
  'account-snapshot',
  'app-config',
  'user-prefs',
  'possessions',
  'expense-scope-overrides',
  'life-period-overrides',
] as const;

export type SyncStoreKey = typeof SYNC_STORE_KEYS[number];
export type SyncPayload = Partial<Record<SyncStoreKey, unknown>>;
