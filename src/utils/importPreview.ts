import type {
  AccountSnapshot,
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
        for (const pending of position.pendingBuys ?? []) result.set(pending.id, pending);
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
    else if (changed(before, item)) changes.push({ kind: 'transaction', change: 'updated', item });
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
  return runWithSyncPaused(async () => {
    try {
      const meta = await run();
      const after = captureFinanceImportState();
      applyFinanceImportState(before);
      return { before, after, meta };
    } catch (error) {
      applyFinanceImportState(before);
      throw error;
    }
  });
}

export async function confirmFinanceImport(draft: FinanceImportPreviewDraft) {
  await runWithSyncPaused(async () => {
    applyFinanceImportState(draft.after);
    await triggerUpload();
  });
}
