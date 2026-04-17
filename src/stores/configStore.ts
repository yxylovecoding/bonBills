import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AppConfig } from '../models/types';

const DEFAULT_CONFIG: AppConfig = {
  birthDate: '2002-12-29',
  retireAge: 55,
  safeWithdrawRate: 0.04,
  lifeExpectancy: 85,
  investAllocTargets: {
    us: 0.2333,
    eu: 0.0333,
    asia: 0.0333,
    a: 0.0333,
    longBond: 0.2333,
    usBond: 0.1,
    gold: 0.3333,
  },
  creditBillDate: 26,
  creditPayDate: 13,
  creditPrepDays: 5,
  reconcileDates: [1, 11, 21],
  incomeItems: [
    { id: 'advisor', name: '导师劳务费', amount: 1500, payDay: 15, isActive: true },
    { id: 'subsidy', name: '院校低保',   amount: 680,  payDay: 1,  isActive: true },
  ],
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
