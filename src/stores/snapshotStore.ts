import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { getAccountStorage } from '../utils/accountCache';
import type { AccountBalanceSyncCursor, AccountSnapshot, AutoAccountBalanceKey } from '../models/types';
import { calculateTransferChanges, TRANSFER_KEYS, type TransferKey } from '../calculations/reconcileTransfers';

const AUTO_ACCOUNT_KEYS = new Set<AutoAccountBalanceKey>([
  'credit', 'livingBank', 'incomeBank', 'investCnyBank', 'investUsdBank',
]);

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function withUpdatedAccounts(current: AccountSnapshot, accounts: Partial<AccountSnapshot['accounts']>, now = new Date()): AccountSnapshot {
  const editedAt = now.toISOString();
  const today = localDateKey(now);
  const nextSync = { ...(current.accountBalanceSync ?? {}) };
  const accountsChanged = Object.entries(accounts).some(([rawKey, value]) => (
    current.accounts[rawKey as keyof AccountSnapshot['accounts']] !== value
  ));
  for (const [rawKey, value] of Object.entries(accounts)) {
    const key = rawKey as keyof AccountSnapshot['accounts'];
    if (!AUTO_ACCOUNT_KEYS.has(key as AutoAccountBalanceKey) || current.accounts[key] === value) continue;
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
    ...current,
    date: today,
    accounts: { ...current.accounts, ...accounts },
    accountBalanceUpdatedAt: accountsChanged ? editedAt : current.accountBalanceUpdatedAt,
    accountBalanceSync: nextSync,
  };
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
    raiseSavings: 0,
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
  executeTransfers: (transfers: Partial<Record<TransferKey, number>>, yearMonth: string) => void;
  updateHoldings: (holdings: Partial<AccountSnapshot['investHoldings']>) => void;
  updateReconcileHoldings: (holdings: AccountSnapshot['investHoldings']) => void;
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
        set((s) => ({ current: withUpdatedAccounts(s.current, accounts) })),
      executeTransfers: (transfers, yearMonth) =>
        set((s) => {
          const changes = calculateTransferChanges(s.current, transfers, yearMonth);
          if (Object.keys(changes.accounts).length === 0) return s;
          return {
            current: {
              ...withUpdatedAccounts(s.current, changes.accounts),
              raiseSavingsByMonth: changes.raiseSavingsByMonth,
              transfersDone: Object.fromEntries(TRANSFER_KEYS.map((key) => [key, 0])) as AccountSnapshot['transfersDone'],
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
      updateReconcileHoldings: (holdings) =>
        set((s) => ({ current: { ...s.current, reconcileInvestHoldings: { ...holdings }, reconcileInvestHoldingsVersion: 2 } })),
      updateUsStockHoldings: (items) =>
        set((s) => ({ current: { ...s.current, usStockHoldings: items ?? [] } })),
      restoreCurrent: (snapshot) => set({ current: snapshot }),
      saveSnapshot: () =>
        set((s) => ({
          history: [s.current, ...s.history].slice(0, 50),
        })),
      resetToDefault: () => set({ current: DEFAULT_SNAPSHOT }),
    }),
    { name: 'account-snapshot', storage: createJSONStorage(getAccountStorage) },
  ),
);
