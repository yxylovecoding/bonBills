import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AccountBalanceSyncCursor, AccountSnapshot, AutoAccountBalanceKey } from '../models/types';

const AUTO_ACCOUNT_KEYS = new Set<AutoAccountBalanceKey>([
  'credit', 'livingBank', 'incomeBank', 'investCnyBank', 'investUsdBank',
]);

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export const DEFAULT_SNAPSHOT: AccountSnapshot = {
  date: '',
  reconcileType: 'eleventh',
  accounts: {
    credit: 0,
    creditMonthly: 0,
    savingsCard: 0,
    incomeBank: 0,
    livingBank: 0,
    campusCard: 0,
    consumptionBank: 0,
    wishJar: 0,
    investCnyBank: 0,
    usdLivingBank: 0,
    usdConsumptionBank: 0,
    usdWishJar: 0,
    investUsdBank: 0,
  },
  investHoldings: {
    us: 0,
    eu: 0,
    asia: 0,
    a: 0,
    longBond: 0,
    usBond: 0,
    gold: 0,
  },
  usStockHoldings: [
    { id: 'dram', name: 'DRAM', symbol: 'DRAM', amountCny: 0, shares: 2.8255, costPrice: 70.77 },
    { id: 'sp500', name: '标普', symbol: 'SPY', amountCny: 0 },
  ],
  transfersDone: {
    campusCard: 0,
    repayment: 0,
    living: 0,
    consumption: 0,
    wishJar: 0,
    invest: 0,
  },
};

interface SnapshotStore {
  current: AccountSnapshot;
  history: AccountSnapshot[];
  updateAccounts: (accounts: Partial<AccountSnapshot['accounts']>) => void;
  applyImportedAccounts: (
    accounts: Partial<AccountSnapshot['accounts']>,
    sync: Partial<Record<AutoAccountBalanceKey, AccountBalanceSyncCursor>>,
  ) => void;
  updateTransfers: (transfers: Partial<AccountSnapshot['transfersDone']>) => void;
  updateHoldings: (holdings: Partial<AccountSnapshot['investHoldings']>) => void;
  updateUsStockHoldings: (items: AccountSnapshot['usStockHoldings']) => void;
  restoreCurrent: (snapshot: AccountSnapshot) => void;
  saveSnapshot: () => void;
  resetToDefault: () => void;
}

export const useSnapshotStore = create<SnapshotStore>()(
  persist(
    (set, _get) => ({
      current: DEFAULT_SNAPSHOT,
      history: [],
      updateAccounts: (accounts) =>
        set((s) => {
          const now = new Date();
          const editedAt = now.toISOString();
          const today = localDateKey(now);
          const nextSync = { ...(s.current.accountBalanceSync ?? {}) };
          const accountsChanged = Object.entries(accounts).some(([rawKey, value]) => (
            s.current.accounts[rawKey as keyof AccountSnapshot['accounts']] !== value
          ));
          for (const [rawKey, value] of Object.entries(accounts)) {
            const key = rawKey as keyof AccountSnapshot['accounts'];
            if (!AUTO_ACCOUNT_KEYS.has(key as AutoAccountBalanceKey) || s.current.accounts[key] === value) continue;
            const autoKey = key as AutoAccountBalanceKey;
            const previous = nextSync[autoKey];
            const throughDate = previous?.throughDate && previous.throughDate > today ? previous.throughDate : today;
            nextSync[autoKey] = {
              editedAt,
              throughDate,
              transactionIdsOnDate: previous?.throughDate === throughDate ? previous.transactionIdsOnDate : [],
              syncedAt: previous?.syncedAt,
            };
          }
          return {
            current: {
              ...s.current,
              date: today,
              accounts: { ...s.current.accounts, ...accounts },
              accountBalanceUpdatedAt: accountsChanged ? editedAt : s.current.accountBalanceUpdatedAt,
              accountBalanceSync: nextSync,
            },
          };
        }),
      applyImportedAccounts: (accounts, sync) =>
        set((s) => ({
          current: {
            ...s.current,
            accounts: { ...s.current.accounts, ...accounts },
            accountBalanceUpdatedAt: new Date().toISOString(),
            accountBalanceSync: { ...(s.current.accountBalanceSync ?? {}), ...sync },
          },
        })),
      updateTransfers: (transfers) =>
        set((s) => ({ current: { ...s.current, transfersDone: { ...s.current.transfersDone, ...transfers } } })),
      updateHoldings: (holdings) =>
        set((s) => ({ current: { ...s.current, investHoldings: { ...s.current.investHoldings, ...holdings } } })),
      updateUsStockHoldings: (items) =>
        set((s) => ({ current: { ...s.current, usStockHoldings: items ?? [] } })),
      restoreCurrent: (snapshot) => set({ current: snapshot }),
      saveSnapshot: () =>
        set((s) => ({
          history: [s.current, ...s.history].slice(0, 50),
        })),
      resetToDefault: () => set({ current: DEFAULT_SNAPSHOT }),
    }),
    { name: 'account-snapshot' },
  ),
);
