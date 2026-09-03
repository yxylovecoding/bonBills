import type { AccountSnapshot, MonthlyRecord, PossessionCategoryConfig, PossessionItem } from '../models/types';
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
};

export type FinanceImportPreviewDraft = {
  before: FinanceImportState;
  after: FinanceImportState;
  meta: FinanceImportPreviewMeta;
};

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
