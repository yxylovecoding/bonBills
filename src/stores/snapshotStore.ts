import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AccountSnapshot } from '../models/types';

const DEFAULT_SNAPSHOT: AccountSnapshot = {
  date: '2026-04-11',
  reconcileType: 'eleventh',
  accounts: {
    credit: 2005.72,
    campusCard: 180.5,
    livingBank: 1246.3,
    consumptionBank: 892.15,
    wishJar: 0,
  },
  investHoldings: {
    us: 3417.6,
    eu: 459.16,
    asia: 503.78,
    a: 485.45,
    longBond: 11314.13,
    usBond: 2381.37,
    gold: 4808.11,
  },
  transfersDone: {
    campusCard: 200,
    living: 500,
    consumption: 800,
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
      saveSnapshot: () =>
        set((s) => ({
          history: [s.current, ...s.history].slice(0, 50),
        })),
      resetToDefault: () => set({ current: DEFAULT_SNAPSHOT }),
    }),
    { name: 'account-snapshot' },
  ),
);
