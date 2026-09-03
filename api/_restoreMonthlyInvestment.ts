const INVESTMENT_FIELDS = [
  'investTotal',
  'investBreakdown',
  'investBreakdownProfit',
  'investProfitComponents',
  'investBreakdownPastProfit',
  'investPastProfitComponents',
  'investPositionItems',
  'investmentTransactions',
  'importedInvestmentTransactionIds',
  'lastInvestmentMailUid',
  'investmentEditedAt',
  'investmentRolledOverFrom',
  'investmentInheritanceRevision',
  'investmentCategoryRepairVersion',
] as const;

type UnknownRecord = Record<string, unknown>;

function recordsFromState(state: unknown): UnknownRecord[] | null {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return null;
  const records = (state as UnknownRecord).records;
  if (!Array.isArray(records)) return null;
  return records.filter((record): record is UnknownRecord => Boolean(record) && typeof record === 'object' && !Array.isArray(record));
}

export function restoreMonthlyInvestmentState(
  currentState: unknown,
  backupState: unknown,
  yearMonth: string,
) {
  const currentRecords = recordsFromState(currentState);
  const backupRecords = recordsFromState(backupState);
  if (!currentRecords || !backupRecords) return { restored: false, state: currentState };

  const backupRecord = backupRecords.find((record) => record.yearMonth === yearMonth);
  const currentIndex = currentRecords.findIndex((record) => record.yearMonth === yearMonth);
  if (!backupRecord || currentIndex < 0) return { restored: false, state: currentState };

  const restoredRecord: UnknownRecord = { ...currentRecords[currentIndex] };
  for (const field of INVESTMENT_FIELDS) {
    delete restoredRecord[field];
    if (Object.prototype.hasOwnProperty.call(backupRecord, field)) restoredRecord[field] = backupRecord[field];
  }
  // 备份内容本身就是权威快照，后续加载不可再按名称或代码搬移、合并。
  restoredRecord.investmentCategoryRepairVersion = 2;

  const records = [...currentRecords];
  records[currentIndex] = restoredRecord;
  return {
    restored: true,
    state: { ...(currentState as UnknownRecord), records },
  };
}
