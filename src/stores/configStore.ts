import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AppConfig } from '../models/types';

export const DEFAULT_CONFIG: AppConfig = {
  birthDate: '',
  retireAge: 55,
  safeWithdrawRate: 0.04,
  lifeExpectancy: 85,
  investAllocTargets: { us: 0, eu: 0, asia: 0, a: 0, longBond: 0, usBond: 0, gold: 0 },
  creditBillDate: 1,
  creditPayDate: 1,
  creditPrepDays: 0,
  reconcileDates: [1, 11, 21],
  incomeItems: [],
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
