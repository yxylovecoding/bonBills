import type {
  AccountSnapshot,
  AutoAccountBalanceKey,
  InvestmentTransactionRecord,
  MonthlyRecord,
  PendingInvestmentBuy,
  PossessionCategoryConfig,
  PossessionItem,
} from '../models/types';
import type { ManualTagCategory } from './tagCategory';
import type { BillExpenseMonth, BillIncomeMonth, BillMonthlyAgg, BillTagMonth } from './importBill';
import { useBillDetailStore } from '../stores/billDetailStore';
import { useMonthlyStore } from '../stores/monthlyStore';
import { usePossessionStore } from '../stores/possessionStore';
import { useSnapshotStore } from '../stores/snapshotStore';
import { runWithSyncPaused, triggerUpload } from './syncEngine';
import { AUTO_ACCOUNT_BALANCE_KEYS } from './accountBalanceImport';
import { sameSyncValue } from './syncMerge';

export type FinanceImportState = {
  records: MonthlyRecord[];
  billDetails: {
    tagStats: Record<string, BillTagMonth>;
    aggregates: Record<string, BillMonthlyAgg>;
    expenseItems: Record<string, BillExpenseMonth>;
    incomeItems: Record<string, BillIncomeMonth>;
    hasOverride: boolean;
  };
  snapshot: {
    current: AccountSnapshot;
    history: AccountSnapshot[];
  };
  possessions: {
    items: PossessionItem[];
    ignoredBillItemIds: string[];
    tagCategory: Record<string, ManualTagCategory>;
    categoryConfig: PossessionCategoryConfig;
  };
};

export type FinanceImportPreviewMeta = {
  title: string;
  lines: string[];
  investmentMonths: string[];
  billMonths: string[];
  successMessage: string;
  changesOnly?: boolean;
};

export type FinanceImportPreviewDraft = {
  before: FinanceImportState;
  after: FinanceImportState;
  meta: FinanceImportPreviewMeta;
  confirmedAccountKeys?: AutoAccountBalanceKey[];
  remainderConfirmed?: boolean;
};

export type InvestmentOperationPreviewChange =
  | { kind: 'transaction'; change: 'added' | 'updated'; item: InvestmentTransactionRecord }
  | { kind: 'pending'; change: 'added' | 'updated' | 'removed'; item: PendingInvestmentBuy };

function collectInvestmentTransactions(records: MonthlyRecord[]) {
  const result = new Map<string, InvestmentTransactionRecord>();
  for (const record of [...records].sort((left, right) => left.yearMonth.localeCompare(right.yearMonth))) {
    for (const transaction of record.investmentTransactions ?? []) result.set(transaction.id, transaction);
  }
  return result;
}

function collectPendingInvestmentBuys(records: MonthlyRecord[]) {
  const result = new Map<string, PendingInvestmentBuy>();
  for (const record of [...records].sort((left, right) => left.yearMonth.localeCompare(right.yearMonth))) {
    for (const group of Object.values(record.investPositionItems ?? {})) {
      for (const position of group ?? []) {
        for (const pending of position.pendingBuys ?? []) {
          if (pending.booking) result.delete(pending.id);
          else result.set(pending.id, pending);
        }
      }
    }
  }
  return result;
}

function changed<T>(before: T, after: T) {
  return JSON.stringify(before) !== JSON.stringify(after);
}

export function diffInvestmentOperations(
  beforeRecords: MonthlyRecord[],
  afterRecords: MonthlyRecord[],
): InvestmentOperationPreviewChange[] {
  const beforeTransactions = collectInvestmentTransactions(beforeRecords);
  const afterTransactions = collectInvestmentTransactions(afterRecords);
  const beforePending = collectPendingInvestmentBuys(beforeRecords);
  const afterPending = collectPendingInvestmentBuys(afterRecords);
  const changes: InvestmentOperationPreviewChange[] = [];

  for (const [id, item] of afterTransactions) {
    const before = beforeTransactions.get(id);
    if (!before) changes.push({ kind: 'transaction', change: 'added', item });
    else if (changed(
      { ...before, autoBuy: undefined, applicationOrder: undefined },
      { ...item, autoBuy: undefined, applicationOrder: undefined },
    )) changes.push({ kind: 'transaction', change: 'updated', item });
  }
  for (const [id, item] of afterPending) {
    const before = beforePending.get(id);
    if (!before) changes.push({ kind: 'pending', change: 'added', item });
    else if (changed(before, item)) changes.push({ kind: 'pending', change: 'updated', item });
  }
  for (const [id, item] of beforePending) {
    if (!afterPending.has(id)) changes.push({ kind: 'pending', change: 'removed', item });
  }

  return changes.sort((left, right) => {
    const leftDate = left.kind === 'transaction'
      ? left.item.operationAt || left.item.occurredAt || left.item.date
      : left.item.operationAt;
    const rightDate = right.kind === 'transaction'
      ? right.item.operationAt || right.item.occurredAt || right.item.date
      : right.item.operationAt;
    return rightDate.localeCompare(leftDate) || left.item.id.localeCompare(right.item.id);
  });
}

function cloneData<T>(value: T): T {
  return structuredClone(value);
}

function billRecordAfterPreview(before: MonthlyRecord | undefined, after: MonthlyRecord): MonthlyRecord {
  if (before) {
    return {
      ...before,
      income: after.income,
      totalExpense: after.totalExpense,
      volatileLife: after.volatileLife,
      periodicLife: after.periodicLife,
      consumption: after.consumption,
      school: after.school,
    };
  }
  return {
    yearMonth: after.yearMonth,
    income: after.income,
    totalExpense: after.totalExpense,
    accumulatedProfit: 0,
    investTotal: 0,
    volatileLife: after.volatileLife,
    periodicLife: after.periodicLife,
    consumption: after.consumption,
    school: after.school,
    homeDays: after.homeDays ?? 0,
    travelDays: after.travelDays ?? 0,
    schoolDays: after.schoolDays,
    internDays: after.internDays,
    majorExpenses: after.majorExpenses ?? [],
    majorExpensesNote: after.majorExpensesNote,
  };
}

export function stateWithCommittedBills(
  before: FinanceImportState,
  after: FinanceImportState,
  billMonths: string[],
): FinanceImportState {
  const records = new Map(before.records.map((record) => [record.yearMonth, record]));
  const afterRecords = new Map(after.records.map((record) => [record.yearMonth, record]));
  for (const month of new Set(billMonths)) {
    const afterRecord = afterRecords.get(month);
    if (!afterRecord) continue;
    records.set(month, billRecordAfterPreview(records.get(month), afterRecord));
  }
  return {
    records: [...records.values()].sort((left, right) => right.yearMonth.localeCompare(left.yearMonth)),
    billDetails: cloneData(after.billDetails),
    snapshot: cloneData(before.snapshot),
    possessions: cloneData(after.possessions),
  };
}

export function captureFinanceImportState(): FinanceImportState {
  const monthly = useMonthlyStore.getState();
  const bills = useBillDetailStore.getState();
  const snapshot = useSnapshotStore.getState();
  const possessions = usePossessionStore.getState();
  return cloneData({
    records: monthly.records,
    billDetails: {
      tagStats: bills.tagStats,
      aggregates: bills.aggregates,
      expenseItems: bills.expenseItems,
      incomeItems: bills.incomeItems,
      hasOverride: bills.hasOverride,
    },
    snapshot: { current: snapshot.current, history: snapshot.history },
    possessions: {
      items: possessions.items,
      ignoredBillItemIds: possessions.ignoredBillItemIds,
      tagCategory: possessions.tagCategory,
      categoryConfig: possessions.categoryConfig,
    },
  });
}

export function applyFinanceImportState(state: FinanceImportState) {
  useMonthlyStore.setState({ records: cloneData(state.records) });
  useBillDetailStore.setState(cloneData(state.billDetails));
  useSnapshotStore.setState(cloneData(state.snapshot));
  usePossessionStore.setState(cloneData(state.possessions));
}

export async function prepareFinanceImport(
  run: () => Promise<FinanceImportPreviewMeta>,
): Promise<FinanceImportPreviewDraft> {
  const before = captureFinanceImportState();
  const draft = await runWithSyncPaused(async () => {
    try {
      const meta = await run();
      const after = captureFinanceImportState();
      applyFinanceImportState(meta.billMonths.length > 0
        ? stateWithCommittedBills(before, after, meta.billMonths)
        : before);
      return { before, after, meta };
    } catch (error) {
      applyFinanceImportState(before);
      throw error;
    }
  });
  if (draft.meta.billMonths.length > 0) await triggerUpload();
  return draft;
}

export function financeImportAccountChanges(draft: FinanceImportPreviewDraft) {
  return AUTO_ACCOUNT_BALANCE_KEYS.flatMap((key) => {
    const before = draft.before.snapshot.current;
    const after = draft.after.snapshot.current;
    // A cursor can advance even when transactions cancel each other out.
    const beforeCursor = before.accountBalanceSync?.[key];
    const afterCursor = after.accountBalanceSync?.[key];
    const cursorChanged = changed(
      beforeCursor && { ...beforeCursor, syncedAt: undefined },
      afterCursor && { ...afterCursor, syncedAt: undefined },
    );
    return before.accounts[key] === after.accounts[key] && !cursorChanged
      ? []
      : [{ key, before: before.accounts[key], after: after.accounts[key] }];
  });
}

function preservingAccounts(state: FinanceImportState, current: AccountSnapshot): FinanceImportState {
  const accounts = { ...state.snapshot.current.accounts };
  for (const key of AUTO_ACCOUNT_BALANCE_KEYS) accounts[key] = current.accounts[key];
  return {
    ...state,
    snapshot: {
      ...state.snapshot,
      current: {
        ...state.snapshot.current,
        accounts,
        date: current.date,
        accountBalanceSync: current.accountBalanceSync,
        accountBalanceUpdatedAt: current.accountBalanceUpdatedAt,
      },
    },
  };
}

export function hasFinanceImportRemainder(draft: FinanceImportPreviewDraft) {
  if (draft.remainderConfirmed) return false;
  const committed = draft.meta.billMonths.length > 0
    ? stateWithCommittedBills(draft.before, draft.after, draft.meta.billMonths)
    : draft.before;
  const comparable = (state: FinanceImportState) => ({
    ...state,
    records: state.records.map((record) => ({
      ...record,
      importedInvestmentTransactionIds: record.importedInvestmentTransactionIds ?? [],
    })),
  });
  return !sameSyncValue(comparable(committed), comparable(preservingAccounts(draft.after, committed.snapshot.current)));
}

export async function confirmFinanceImportAccount(
  draft: FinanceImportPreviewDraft,
  key: AutoAccountBalanceKey,
): Promise<FinanceImportPreviewDraft> {
  if (draft.confirmedAccountKeys?.includes(key)
    || !financeImportAccountChanges(draft).some((change) => change.key === key)) return draft;
  await runWithSyncPaused(async () => {
    const after = draft.after.snapshot.current;
    const current = useSnapshotStore.getState().current;
    const sync = { ...current.accountBalanceSync };
    if (after.accountBalanceSync?.[key]) sync[key] = cloneData(after.accountBalanceSync[key]);
    else delete sync[key];
    useSnapshotStore.setState({
      current: {
        ...current,
        accounts: { ...current.accounts, [key]: after.accounts[key] },
        accountBalanceSync: sync,
        accountBalanceUpdatedAt: new Date().toISOString(),
      },
    });
    await triggerUpload();
  });
  return { ...draft, confirmedAccountKeys: [...(draft.confirmedAccountKeys ?? []), key] };
}

export async function confirmFinanceImport(
  draft: FinanceImportPreviewDraft,
  options: { preserveAccounts?: boolean } = {},
) {
  await runWithSyncPaused(async () => {
    applyFinanceImportState(options.preserveAccounts
      ? preservingAccounts(draft.after, useSnapshotStore.getState().current)
      : draft.after);
    await triggerUpload();
  });
}
