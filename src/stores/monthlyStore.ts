import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { InvestKey, InvestPastProfit, MonthlyRecord } from '../models/types';
import { normalizeBillYearMonth } from '../utils/importBill';

const INITIAL_RECORDS: MonthlyRecord[] = [];
const INITIAL_PAST_PROFITS: InvestPastProfit[] = [];
const INVEST_KEYS = ['us', 'eu', 'asia', 'a', 'longBond', 'usBond', 'gold'] as const;
const INVEST_KEY_SET = new Set<string>(INVEST_KEYS);

interface DayCounts {
  schoolDays: number;
  internDays: number;
  homeDays: number;
  travelDays: number;
}

interface MonthlyStore {
  records: MonthlyRecord[];
  investPastProfits: InvestPastProfit[];
  upsert: (record: MonthlyRecord) => void;
  updateDayCounts: (yearMonth: string, counts: DayCounts) => void;
  getByYearMonth: (ym: string) => MonthlyRecord | undefined;
  addInvestPastProfit: (input: { investKey: InvestKey; amount: number; note?: string }) => void;
  removeInvestPastProfit: (id: string) => void;
}

function makeInvestPastProfitId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `profit_past_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function mergeMonthlyRecord(a: MonthlyRecord | undefined, b: MonthlyRecord): MonthlyRecord {
  if (!a) return b;
  return {
    ...a,
    ...b,
    accumulatedProfit: b.accumulatedProfit || a.accumulatedProfit,
    investTotal: b.investTotal || a.investTotal,
    investBreakdown: b.investBreakdown ?? a.investBreakdown,
    investBreakdownProfit: b.investBreakdownProfit ?? a.investBreakdownProfit,
    investProfitComponents: b.investProfitComponents ?? a.investProfitComponents,
    majorExpenses: b.majorExpenses?.length ? b.majorExpenses : a.majorExpenses,
    majorExpensesNote: b.majorExpensesNote ?? a.majorExpensesNote,
  };
}

export function normalizeMonthlyRecords(input: unknown): MonthlyRecord[] {
  if (!Array.isArray(input)) return [];
  const byMonth = new Map<string, MonthlyRecord>();
  for (const record of input) {
    if (!record || typeof record !== 'object') continue;
    const ym = normalizeBillYearMonth((record as MonthlyRecord).yearMonth);
    if (!ym) continue;
    const normalized = { ...(record as MonthlyRecord), yearMonth: ym };
    byMonth.set(ym, mergeMonthlyRecord(byMonth.get(ym), normalized));
  }
  return [...byMonth.values()].sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));
}

export function normalizeInvestPastProfits(input: unknown): InvestPastProfit[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item): InvestPastProfit | null => {
      if (!item || typeof item !== 'object') return null;
      const raw = item as Partial<InvestPastProfit>;
      const investKey = raw.investKey;
      const amount = Number(raw.amount);
      if (!investKey || !INVEST_KEY_SET.has(investKey) || !Number.isFinite(amount) || amount === 0) return null;
      return {
        id: String(raw.id || makeInvestPastProfitId()),
        investKey: investKey as InvestKey,
        amount,
        note: typeof raw.note === 'string' && raw.note.trim() ? raw.note.trim() : undefined,
        createdAt: typeof raw.createdAt === 'string' && raw.createdAt ? raw.createdAt : new Date().toISOString(),
      };
    })
    .filter((item): item is InvestPastProfit => item !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export const useMonthlyStore = create<MonthlyStore>()(
  persist(
    (set, get) => ({
      records: INITIAL_RECORDS,
      investPastProfits: INITIAL_PAST_PROFITS,
      upsert: (record) =>
        set((s) => {
          const idx = s.records.findIndex((r) => r.yearMonth === record.yearMonth);
          if (idx >= 0) {
            const next = [...s.records];
            next[idx] = record;
            return { records: next };
          }
          return { records: [record, ...s.records].sort((a, b) => b.yearMonth.localeCompare(a.yearMonth)) };
        }),
      updateDayCounts: (yearMonth, counts) =>
        set((s) => {
          const idx = s.records.findIndex((r) => r.yearMonth === yearMonth);
          if (idx < 0) return s; // 没有对应记录则不操作
          const next = [...s.records];
          next[idx] = { ...next[idx], ...counts };
          return { records: next };
        }),
      getByYearMonth: (ym) => get().records.find((r) => r.yearMonth === ym),
      addInvestPastProfit: ({ investKey, amount, note }) =>
        set((s) => ({
          investPastProfits: [
            {
              id: makeInvestPastProfitId(),
              investKey,
              amount,
              note: note?.trim() || undefined,
              createdAt: new Date().toISOString(),
            },
            ...s.investPastProfits,
          ],
        })),
      removeInvestPastProfit: (id) =>
        set((s) => ({
          investPastProfits: s.investPastProfits.filter((item) => item.id !== id),
        })),
    }),
    {
      name: 'monthly-records',
      version: 1,
      migrate: (persistedState) => {
        if (!persistedState || typeof persistedState !== 'object') return persistedState;
        const persisted = persistedState as Partial<MonthlyStore> & { investProfitBackfills?: unknown };
        return {
          ...persisted,
          records: normalizeMonthlyRecords(persisted.records),
          investPastProfits: normalizeInvestPastProfits(persisted.investPastProfits ?? persisted.investProfitBackfills),
        };
      },
      merge: (persistedState, currentState) => {
        const persisted = (persistedState ?? {}) as Partial<MonthlyStore> & { investProfitBackfills?: unknown };
        return {
          ...currentState,
          ...persisted,
          records: normalizeMonthlyRecords(persisted.records ?? currentState.records),
          investPastProfits: normalizeInvestPastProfits(persisted.investPastProfits ?? persisted.investProfitBackfills ?? currentState.investPastProfits),
        };
      },
    },
  ),
);
