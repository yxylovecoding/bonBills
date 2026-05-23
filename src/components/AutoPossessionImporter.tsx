import { useEffect } from 'react';
import { useBillDetailStore } from '../stores/billDetailStore';
import { useCalendarStore } from '../stores/calendarStore';
import { useExpenseScopeOverrideStore } from '../stores/expenseScopeOverrideStore';
import { usePossessionStore } from '../stores/possessionStore';
import { mergePossessionsFromBills } from '../utils/autoImportPossessions';

function makeId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `pos_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export default function AutoPossessionImporter() {
  const { expenseItems } = useBillDetailStore();
  const { tagMap } = useCalendarStore();
  const { overrides } = useExpenseScopeOverrideStore();
  const { items, ignoredBillItemIds, excludedNameTags, applyAutoImportedItems } = usePossessionStore();

  useEffect(() => {
    const result = mergePossessionsFromBills({
      expenseItems,
      tagMap,
      overrides,
      items,
      ignoredBillItemIds,
      excludedNameTags,
      makeId,
      today: todayKey(),
    });
    if (result.changed) applyAutoImportedItems(result.items);
  }, [expenseItems, tagMap, overrides, items, ignoredBillItemIds, excludedNameTags, applyAutoImportedItems]);

  return null;
}
