import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AccountSnapshot } from '../models/types';

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
  investHoldingReserves: {},
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
  updateTransfers: (transfers: Partial<AccountSnapshot['transfersDone']>) => void;
  updateHoldings: (holdings: Partial<AccountSnapshot['investHoldings']>) => void;
  updateHoldingReserves: (reserves: Partial<AccountSnapshot['investHoldings']>) => void;
  saveSnapshot: () => void;
  resetToDefault: () => void;
}

export const useSnapshotStore = create<SnapshotStore>()(
  persist(
    (set, _get) => ({
      current: DEFAULT_SNAPSHOT,
      history: [],
      updateAccounts: (accounts) =>
        set((s) => ({ current: { ...s.current, accounts: { ...s.current.accounts, ...accounts } } })),
      updateTransfers: (transfers) =>
        set((s) => ({ current: { ...s.current, transfersDone: { ...s.current.transfersDone, ...transfers } } })),
      updateHoldings: (holdings) =>
        set((s) => ({ current: { ...s.current, investHoldings: { ...s.current.investHoldings, ...holdings } } })),
      updateHoldingReserves: (reserves) =>
        set((s) => ({ current: { ...s.current, investHoldingReserves: { ...s.current.investHoldingReserves, ...reserves } } })),
      saveSnapshot: () =>
        set((s) => ({
          history: [s.current, ...s.history].slice(0, 50),
        })),
      resetToDefault: () => set({ current: DEFAULT_SNAPSHOT }),
    }),
    { name: 'account-snapshot' },
  ),
);
