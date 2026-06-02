import type { MonthlyRecord } from '../models/types';
import { useBillDetailStore } from '../stores/billDetailStore';
import { useCalendarStore } from '../stores/calendarStore';
import { useExpenseScopeOverrideStore } from '../stores/expenseScopeOverrideStore';
import { useMonthlyStore } from '../stores/monthlyStore';
import { usePossessionStore } from '../stores/possessionStore';
import { mergePossessionsFromBills } from './autoImportPossessions';
import { parseBillFile, type BillMonthlyAgg } from './importBill';
import { triggerUpload } from './syncEngine';

const BILL_CORE_FIELDS: readonly (keyof BillMonthlyAgg)[] = [
  'income', 'totalExpense', 'periodicLife', 'volatileLife', 'consumption', 'school',
];

function makePossessionImportId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `pos_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// 按字段判断：MonthlyRecord 上某个核心字段 ≈ 0、但账单聚合那一项有值 -> 需要回填。
export function fieldsNeedingRestore(record: MonthlyRecord | undefined, a: BillMonthlyAgg): (keyof BillMonthlyAgg)[] {
  return BILL_CORE_FIELDS.filter((k) => {
    const recordVal = record ? Math.abs(record[k] ?? 0) : 0;
    const aggVal = Math.abs(a[k] ?? 0);
    return recordVal <= 0.01 && aggVal > 0.01;
  });
}

export function recordFromBillAggregate(yearMonth: string, a: BillMonthlyAgg, prev?: MonthlyRecord): MonthlyRecord {
  // 仅覆盖账单侧确实有值的字段；已有手填值（或其他来源）的字段保留 prev。
  const pick = (k: keyof BillMonthlyAgg, fallback: number) =>
    Math.abs(a[k] ?? 0) > 0.01 ? a[k] : fallback;
  return {
    yearMonth,
    income: pick('income', prev?.income ?? 0),
    totalExpense: pick('totalExpense', prev?.totalExpense ?? 0),
    periodicLife: pick('periodicLife', prev?.periodicLife ?? 0),
    volatileLife: pick('volatileLife', prev?.volatileLife ?? 0),
    consumption: pick('consumption', prev?.consumption ?? 0),
    school: pick('school', prev?.school ?? 0),
    accumulatedProfit: prev?.accumulatedProfit ?? 0,
    investTotal: prev?.investTotal ?? 0,
    investBreakdown: prev?.investBreakdown,
    investBreakdownProfit: prev?.investBreakdownProfit,
    investProfitComponents: prev?.investProfitComponents,
    homeDays: prev?.homeDays ?? 0,
    travelDays: prev?.travelDays ?? 0,
    schoolDays: prev?.schoolDays,
    internDays: prev?.internDays,
    majorExpenses: prev?.majorExpenses ?? [],
    majorExpensesNote: prev?.majorExpensesNote,
  };
}

export async function importBillFileIntoStores(file: File) {
  const { tagStats, aggregates, expenseItems } = await parseBillFile(file);
  useBillDetailStore.getState().updateFromImport(tagStats, expenseItems, aggregates);

  const possessionStore = usePossessionStore.getState();
  const possessionImport = mergePossessionsFromBills({
    expenseItems,
    tagMap: useCalendarStore.getState().tagMap,
    overrides: useExpenseScopeOverrideStore.getState().overrides,
    items: possessionStore.items,
    ignoredBillItemIds: possessionStore.ignoredBillItemIds,
    tagCategory: possessionStore.tagCategory,
    makeId: makePossessionImportId,
    today: todayKey(),
  });
  if (possessionImport.changed) {
    possessionStore.applyAutoImportedItems(possessionImport.items);
  }

  const monthlyStore = useMonthlyStore.getState();
  const existing = monthlyStore.records;
  let updatedMonths = 0;
  for (const ym of Object.keys(aggregates)) {
    const a = aggregates[ym];
    const prev = existing.find((r) => r.yearMonth === ym);
    monthlyStore.upsert(recordFromBillAggregate(ym, a, prev));
    updatedMonths += 1;
  }

  triggerUpload();
  return {
    fileName: file.name,
    updatedMonths,
    importedPossessions: possessionImport.importedCount,
  };
}
