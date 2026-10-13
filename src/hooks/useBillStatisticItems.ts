import { useMemo } from 'react';
import { useBillDetailStore } from '../stores/billDetailStore';
import type { BillExpenseItem } from '../utils/importBill';

export type BillStatisticItem = BillExpenseItem & { transactionType: '支出' | '收入' };

export function useBillStatisticItems(): BillStatisticItem[] {
  const expenseItems = useBillDetailStore((state) => state.expenseItems);
  const incomeItems = useBillDetailStore((state) => state.incomeItems);
  return useMemo(() => [
    ...Object.values(expenseItems).flat().map((item) => ({ ...item, transactionType: '支出' as const })),
    ...Object.values(incomeItems).flat().map((item) => ({ ...item, transactionType: '收入' as const })),
  ], [expenseItems, incomeItems]);
}
