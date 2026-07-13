import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AppConfig } from '../models/types';

export const DEFAULT_CONFIG: AppConfig = {
  birthDate: '2002-12-29',
  retireAge: 55,
  fireTargetYears: undefined,
  safeWithdrawRate: 0.04,
  investAnnualGrowthRate: 0.04,
  fireHousingFundRate: 0.12,
  fireExpenseTagKind: 'intern',
  fireTalentDegree: 'master',
  fireHasHangzhouHome: false,
  fireExpectedAnnualWageIncome: 500000,
  fireExpectedTalentClass: 'e',
  fireETalentRecognitionYear: 3,
  fireTalentSubsidyEnabled: true,
  fireRentTaxDeductionEnabled: true,
  fireHousingFundRentWithdrawalEnabled: true,
  lifeExpectancy: 85,
  investAllocTargets: { us: 0.2333, eu: 0.0333, asia: 0.0333, a: 0.0333, longBond: 0.2333, usBond: 0.1, gold: 0.3333 },
  creditBillDate: 1,
  creditPayDate: 1,
  creditPrepDays: 0,
  reconcileDates: [1, 11, 21],
  incomeItems: [],
  futureFireExpenses: [],
  majorFireWishes: [],
  majorExpenseThreshold: 500,
  dramDecision: {
    symbol: 'DRAM',
    shares: 2.8255,
    costPrice: 70.77,
    targetWeight: 0.2,
    hardLimit: 0.25,
    minBuyWeight: 0.1,
    drawdownClear: 0.3,
  },
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
