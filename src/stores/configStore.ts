import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AppConfig } from '../models/types';

export const DEFAULT_CONFIG: AppConfig = {
  birthDate: '',
  retireAge: 55,
  fireTargetYears: undefined,
  safeWithdrawRate: 0.04,
  lifeExpectancy: 85,
  investAllocTargets: { us: 0.2333, eu: 0.0333, asia: 0.0333, a: 0.0333, longBond: 0.2333, usBond: 0.1, gold: 0.3333 },
  creditBillDate: 1,
  creditPayDate: 1,
  creditPrepDays: 0,
  reconcileDates: [1, 11, 21],
  incomeItems: [],
  futureFireExpenses: [],
  majorExpenseThreshold: 500,
};

interface ConfigStore {
  config: AppConfig;
  setConfig: (c: Partial<AppConfig>) => void;
  resetConfig: () => void;
}

export const useConfigStore = create<ConfigStore>()(
  persist(
    (set) => ({
      config: DEFAULT_CONFIG,
      setConfig: (c) => set((s) => ({ config: { ...s.config, ...c } })),
      resetConfig: () => set({ config: DEFAULT_CONFIG }),
    }),
    { name: 'app-config' },
  ),
);
