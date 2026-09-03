import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { MonthlyRecord } from '../models/types';
import { normalizeBillYearMonth } from '../utils/importBill';
import {
  createInvestmentRolloverRecord,
  hasInvestmentEndingState,
  hasSameInvestmentEnding,
  normalizeInvestmentRecordInstruments,
  propagateInvestmentInheritance,
} from '../utils/investmentRollover';

const INITIAL_RECORDS: MonthlyRecord[] = [];

interface DayCounts {
  schoolDays: number;
  internDays: number;
  homeDays: number;
  travelDays: number;
}

export type InvestmentMutationSource = 'manual' | 'import' | 'rollover';

export interface MonthlyUpsertOptions {
  investmentSource?: InvestmentMutationSource;
}

interface MonthlyStore {
  records: MonthlyRecord[];
  upsert: (record: MonthlyRecord, options?: MonthlyUpsertOptions) => void;
  upsertMany: (records: MonthlyRecord[], options?: MonthlyUpsertOptions) => void;
  ensureInvestmentMonth: (yearMonth: string) => boolean;
  ensureInvestmentImportCutoff: () => boolean;
  updateDayCounts: (yearMonth: string, counts: DayCounts) => void;
  getByYearMonth: (ym: string) => MonthlyRecord | undefined;
}

function mergeMonthlyRecord(a: MonthlyRecord | undefined, b: MonthlyRecord): MonthlyRecord {
  if (!a) return b;
  const transactionLedger = new Map(
    [...(a.investmentTransactions ?? []), ...(b.investmentTransactions ?? [])]
      .map((transaction) => [transaction.id, transaction]),
  );
  return {
    ...a,
    ...b,
    accumulatedProfit: b.accumulatedProfit,
    investTotal: b.investTotal,
    investBreakdown: b.investBreakdown ?? a.investBreakdown,
    investBreakdownProfit: b.investBreakdownProfit ?? a.investBreakdownProfit,
    investProfitComponents: b.investProfitComponents ?? a.investProfitComponents,
    investBreakdownPastProfit: b.investBreakdownPastProfit ?? a.investBreakdownPastProfit,
    investPastProfitComponents: b.investPastProfitComponents ?? a.investPastProfitComponents,
    investPositionItems: b.investPositionItems ?? a.investPositionItems,
    investmentTransactions: transactionLedger.size > 0
      ? [...transactionLedger.values()].sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id))
      : undefined,
    importedInvestmentTransactionIds: [...new Set([
      ...(a.importedInvestmentTransactionIds ?? []),
      ...(b.importedInvestmentTransactionIds ?? []),
    ])],
    lastInvestmentMailUid: Math.max(a.lastInvestmentMailUid ?? 0, b.lastInvestmentMailUid ?? 0) || undefined,
    investmentEditedAt: b.investmentEditedAt ?? a.investmentEditedAt,
    majorExpenses: b.majorExpenses?.length ? b.majorExpenses : a.majorExpenses,
    majorExpensesNote: b.majorExpensesNote ?? a.majorExpensesNote,
  };
}

function mergeAndPropagateMonthlyRecords(
  current: MonthlyRecord[],
  incoming: MonthlyRecord[],
  options?: MonthlyUpsertOptions,
) {
  const byMonth = new Map(current.map((record) => [record.yearMonth, record]));
  const changedMonths = new Set<string>();
  for (const rawRecord of incoming) {
    const record = options?.investmentSource === 'manual'
      ? { ...rawRecord, investmentRolledOverFrom: undefined }
      : rawRecord;
    byMonth.set(record.yearMonth, mergeMonthlyRecord(byMonth.get(record.yearMonth), record));
    changedMonths.add(record.yearMonth);
  }
  return propagateInvestmentInheritance([...byMonth.values()], changedMonths);
}

export function normalizeMonthlyRecords(input: unknown): MonthlyRecord[] {
  if (!Array.isArray(input)) return [];
  const byMonth = new Map<string, MonthlyRecord>();
  for (const record of input) {
    if (!record || typeof record !== 'object') continue;
    const ym = normalizeBillYearMonth((record as MonthlyRecord).yearMonth);
    if (!ym) continue;
    const source = normalizeInvestmentRecordInstruments(record as MonthlyRecord);
    const rolledOverFrom = typeof source.investmentRolledOverFrom === 'string'
      ? normalizeBillYearMonth(source.investmentRolledOverFrom)
      : null;
    const normalized = {
      ...source,
      yearMonth: ym,
      manualAccumulatedProfit: typeof source.manualAccumulatedProfit === 'number'
        && Number.isFinite(source.manualAccumulatedProfit)
        ? source.manualAccumulatedProfit
        : source.accumulatedProfit,
      investmentRolledOverFrom: rolledOverFrom && rolledOverFrom < ym ? rolledOverFrom : undefined,
      investmentInheritanceRevision: typeof source.investmentInheritanceRevision === 'number'
        && Number.isFinite(source.investmentInheritanceRevision)
        ? Math.max(0, Math.floor(source.investmentInheritanceRevision))
        : undefined,
      isBaseline: undefined,
    };
    byMonth.set(ym, mergeMonthlyRecord(byMonth.get(ym), normalized));
  }
  return [...byMonth.values()].sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));
}

export const useMonthlyStore = create<MonthlyStore>()(
  persist(
    (set, get) => ({
      records: INITIAL_RECORDS,
      upsert: (record, options) =>
        set((s) => ({ records: mergeAndPropagateMonthlyRecords(s.records, [record], options) })),
      upsertMany: (records, options) => {
        if (records.length === 0) return;
        set((s) => ({ records: mergeAndPropagateMonthlyRecords(s.records, records, options) }));
      },
      ensureInvestmentMonth: (yearMonth) => {
        let changed = false;
        set((s) => {
          const existing = s.records.find((record) => record.yearMonth === yearMonth);
          const previous = [...s.records]
            .filter((record) => record.yearMonth < yearMonth && hasInvestmentEndingState(record))
            .sort((left, right) => right.yearMonth.localeCompare(left.yearMonth))[0];
          let records = s.records;
          const existingCanJoinPrevious = Boolean(
            previous
            && existing
            && !existing.investmentRolledOverFrom
            && (existing.investmentTransactions?.length ?? 0) === 0
            && hasSameInvestmentEnding(existing, previous),
          );
          if (previous && (!existing || !hasInvestmentEndingState(existing) || existingCanJoinPrevious)) {
            const rollover = createInvestmentRolloverRecord(previous, yearMonth, existing);
            records = mergeAndPropagateMonthlyRecords(records, [rollover], { investmentSource: 'rollover' });
            changed = true;
          }
          const inheritedParents = records
            .map((record) => record.investmentRolledOverFrom)
            .filter((month): month is string => Boolean(month));
          const reconciled = propagateInvestmentInheritance(records, inheritedParents);
          if (reconciled.some((record, index) => record !== records[index])) changed = true;
          return changed ? { records: reconciled } : s;
        });
        return changed;
      },
      ensureInvestmentImportCutoff: () => {
        let changed = false;
        set((state) => {
          if (state.records.some((record) => Boolean(record.investmentEditedAt))) return state;
          const latest = [...state.records]
            .filter(hasInvestmentEndingState)
            .sort((left, right) => right.yearMonth.localeCompare(left.yearMonth))[0];
          if (!latest) return state;
          changed = true;
          return {
            records: mergeAndPropagateMonthlyRecords(state.records, [{
              ...latest,
              investmentEditedAt: new Date().toISOString(),
            }], { investmentSource: 'import' }),
          };
        });
        return changed;
      },
      updateDayCounts: (yearMonth, counts) =>
        set((s) => {
          const idx = s.records.findIndex((r) => r.yearMonth === yearMonth);
          if (idx < 0) return s; // 没有对应记录则不操作
          const next = [...s.records];
          next[idx] = { ...next[idx], ...counts };
          return { records: next };
        }),
      getByYearMonth: (ym) => get().records.find((r) => r.yearMonth === ym),
    }),
    {
      name: 'monthly-records',
      version: 3,
      migrate: (persistedState) => {
        if (!persistedState || typeof persistedState !== 'object') return persistedState;
        const persisted = persistedState as Partial<MonthlyStore>;
        return {
          ...persisted,
          records: normalizeMonthlyRecords(persisted.records),
        };
      },
      merge: (persistedState, currentState) => {
        const persisted = (persistedState ?? {}) as Partial<MonthlyStore>;
        return {
          ...currentState,
          ...persisted,
          records: normalizeMonthlyRecords(persisted.records ?? currentState.records),
        };
      },
    },
  ),
);
