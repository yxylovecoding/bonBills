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

const POSITION_GROUP_KEYS = ['us', 'eu', 'asia', 'a', 'longBond', 'usBond', 'gold', 'account', 'aggregate'] as const;
const INVESTMENT_CATEGORY_KEYS = POSITION_GROUP_KEYS.slice(0, 7);

type PositionGroupKey = typeof POSITION_GROUP_KEYS[number];

function numeric(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function positionGroups(record: UnknownRecord): Record<string, UnknownRecord[]> {
  const raw = record.investPositionItems;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw as UnknownRecord).map(([key, value]) => [
    key,
    Array.isArray(value)
      ? value.filter((item): item is UnknownRecord => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
      : [],
  ]));
}

function groupMarketValue(items: UnknownRecord[]) {
  return Math.round(items.reduce((sum, item) => {
    if (item.status === 'closed') return sum;
    const stored = numeric(item.marketValueCny);
    if (stored !== 0) return sum + stored;
    return sum + numeric(item.shares) * numeric(item.lastPrice) * (numeric(item.lastFxRateToCny) || 1);
  }, 0) * 100) / 100;
}

function editedAt(record: UnknownRecord) {
  const value = typeof record.investmentEditedAt === 'string' ? Date.parse(record.investmentEditedAt) : 0;
  return Number.isFinite(value) ? value : 0;
}

function preferRecoveryGroup(
  currentItems: UnknownRecord[],
  recoveryItems: UnknownRecord[],
  currentRecord: UnknownRecord,
  recoveryRecord: UnknownRecord,
) {
  if (recoveryItems.length === 0) return false;
  if (currentItems.length === 0) return true;
  const currentDetailed = currentItems.filter((item) => typeof item.symbol === 'string' && item.symbol.trim()).length;
  const recoveryDetailed = recoveryItems.filter((item) => typeof item.symbol === 'string' && item.symbol.trim()).length;
  if (currentDetailed !== recoveryDetailed) return recoveryDetailed > currentDetailed;
  if (currentItems.length !== recoveryItems.length) return recoveryItems.length > currentItems.length;
  if (editedAt(currentRecord) !== editedAt(recoveryRecord)) return editedAt(recoveryRecord) > editedAt(currentRecord);
  return groupMarketValue(recoveryItems) > groupMarketValue(currentItems);
}

function categoryValues(record: UnknownRecord, field: string) {
  const raw = record[field];
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as UnknownRecord : {};
}

function mergeUniqueObjects(current: unknown, recovery: unknown) {
  const merged = new Map<string, UnknownRecord>();
  for (const item of [...(Array.isArray(current) ? current : []), ...(Array.isArray(recovery) ? recovery : [])]) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as UnknownRecord;
    const key = String(record.id ?? JSON.stringify(record));
    merged.set(key, record);
  }
  return [...merged.values()];
}

function mergeUniqueStrings(current: unknown, recovery: unknown) {
  return [...new Set([
    ...(Array.isArray(current) ? current.map(String) : []),
    ...(Array.isArray(recovery) ? recovery.map(String) : []),
  ])];
}

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

export function mergeRecoveredMonthlyInvestmentState(
  currentState: unknown,
  recoveryState: unknown,
  yearMonth: string,
) {
  const currentRecords = recordsFromState(currentState);
  const recoveryRecords = recordsFromState(recoveryState);
  if (!currentRecords || !recoveryRecords) return { merged: false, state: currentState };

  const currentIndex = currentRecords.findIndex((record) => record.yearMonth === yearMonth);
  const recoveryRecord = recoveryRecords.find((record) => record.yearMonth === yearMonth);
  if (currentIndex < 0 || !recoveryRecord) return { merged: false, state: currentState };

  const currentRecord = currentRecords[currentIndex];
  const currentGroups = positionGroups(currentRecord);
  const recoveryGroups = positionGroups(recoveryRecord);
  const mergedGroups: Record<string, UnknownRecord[]> = {};
  const selectedRecoveryGroups = new Set<PositionGroupKey>();

  for (const key of POSITION_GROUP_KEYS) {
    const currentItems = currentGroups[key] ?? [];
    const recoveryItems = recoveryGroups[key] ?? [];
    const useRecovery = preferRecoveryGroup(currentItems, recoveryItems, currentRecord, recoveryRecord);
    const chosen = useRecovery ? recoveryItems : currentItems;
    if (chosen.length > 0) mergedGroups[key] = chosen.map((item) => ({ ...item }));
    if (useRecovery) selectedRecoveryGroups.add(key);
  }

  const nextRecord: UnknownRecord = {
    ...currentRecord,
    investPositionItems: mergedGroups,
    investmentTransactions: mergeUniqueObjects(currentRecord.investmentTransactions, recoveryRecord.investmentTransactions),
    importedInvestmentTransactionIds: mergeUniqueStrings(
      currentRecord.importedInvestmentTransactionIds,
      recoveryRecord.importedInvestmentTransactionIds,
    ),
    lastInvestmentMailUid: Math.max(numeric(currentRecord.lastInvestmentMailUid), numeric(recoveryRecord.lastInvestmentMailUid)) || undefined,
    investmentEditedAt: editedAt(recoveryRecord) > editedAt(currentRecord)
      ? recoveryRecord.investmentEditedAt
      : currentRecord.investmentEditedAt,
    investmentInheritanceRevision: Math.max(
      numeric(currentRecord.investmentInheritanceRevision),
      numeric(recoveryRecord.investmentInheritanceRevision),
    ) || undefined,
    investmentCategoryRepairVersion: 2,
  };

  for (const field of ['investBreakdown', 'investBreakdownProfit', 'investBreakdownPastProfit'] as const) {
    const currentValues = categoryValues(currentRecord, field);
    const recoveryValues = categoryValues(recoveryRecord, field);
    const mergedValues: UnknownRecord = {};
    for (const key of INVESTMENT_CATEGORY_KEYS) {
      const source = selectedRecoveryGroups.has(key) ? recoveryValues : currentValues;
      if (Object.prototype.hasOwnProperty.call(source, key)) mergedValues[key] = source[key];
    }
    nextRecord[field] = mergedValues;
  }

  for (const field of ['investProfitComponents', 'investPastProfitComponents'] as const) {
    const currentValues = categoryValues(currentRecord, field);
    const recoveryValues = categoryValues(recoveryRecord, field);
    nextRecord[field] = {
      ...currentValues,
      ...(selectedRecoveryGroups.has('us') && recoveryValues.us ? { us: recoveryValues.us } : {}),
      ...(selectedRecoveryGroups.has('usBond') && recoveryValues.usBond ? { usBond: recoveryValues.usBond } : {}),
    };
  }

  const mergedBreakdown = categoryValues(nextRecord, 'investBreakdown');
  nextRecord.investTotal = Math.round(INVESTMENT_CATEGORY_KEYS.reduce((sum, key) => {
    const items = mergedGroups[key] ?? [];
    return sum + (items.length > 0 ? groupMarketValue(items) : numeric(mergedBreakdown[key]));
  }, 0) * 100) / 100;

  const records = [...currentRecords];
  records[currentIndex] = nextRecord;
  return {
    merged: true,
    selectedRecoveryGroups: [...selectedRecoveryGroups],
    state: { ...(currentState as UnknownRecord), records },
  };
}
