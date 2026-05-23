import type { PossessionItem, PossessionKind, PossessionTxn, TagKind } from '../models/types';
import { resolveExpenseScope, type ExpenseScopeOverrides } from '../stores/expenseScopeOverrideStore';
import { assignExpenseIds, type BillExpenseItem, type BillExpenseMonth } from './importBill';

const POSSESSION_CATEGORIES = new Set(['购物', '医疗']);
const EXCLUDED_KEYWORDS = ['体检', '周边', '医院'];
const CONSUMABLE_TAG = '消耗品';
const DONE_TAG = 'done';
const NOISE_TAGS = new Set(['周期生活', '波动生活', '消费', '吃好喝好', '红', '黑', '白', '消耗品', '家', 'doing', 'done']);
const QUANTITY_TAG_PATTERN = /^\d+(\.\d+)?\s*(kg|mg|ml|l|g|斤|两|升|毫升)$/i;

export interface AutoPossessionImportParams {
  expenseItems: Record<string, BillExpenseMonth>;
  tagMap: Record<string, TagKind>;
  overrides: ExpenseScopeOverrides;
  items: PossessionItem[];
  ignoredBillItemIds: string[];
  excludedNameTags: string[];
  makeId: () => string;
  today: string;
}

export interface AutoPossessionImportResult {
  items: PossessionItem[];
  importedCount: number;
  changed: boolean;
}

function tagsOf(item: BillExpenseItem) {
  return item.tags.split(',').map((tag) => tag.trim()).filter(Boolean);
}

function isQuantityTag(tag: string) {
  return QUANTITY_TAG_PATTERN.test(tag);
}

function isPossessionBill(item: BillExpenseItem, tags: string[]) {
  const searchable = [item.category, item.subcategory, item.note, ...tags].join(' ');
  if (EXCLUDED_KEYWORDS.some((keyword) => searchable.includes(keyword))) return false;
  return tags.includes(CONSUMABLE_TAG) || POSSESSION_CATEGORIES.has(item.category);
}

function possessionKind(tags: string[]): PossessionKind {
  return tags.includes(CONSUMABLE_TAG) ? 'consumable' : 'durable';
}

function itemName(item: BillExpenseItem, tags: string[], excludedNameTags: Set<string>) {
  const tag = tags.find((candidate) => candidate && !NOISE_TAGS.has(candidate) && !excludedNameTags.has(candidate) && !isQuantityTag(candidate));
  return tag || item.subcategory || item.note || item.category || '未命名物品';
}

function itemKey(kind: PossessionKind, name: string) {
  return `${kind}::${name.trim().toLowerCase()}`;
}

function sortTxns(txns: PossessionTxn[]) {
  return [...txns].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

function createPossessionFromBill(
  item: BillExpenseItem,
  kind: PossessionKind,
  name: string,
  isDoneConsumable: boolean,
  makeId: () => string,
  today: string,
): PossessionItem {
  return {
    id: makeId(),
    name,
    kind,
    category: item.subcategory || item.category || undefined,
    icon: kind === 'consumable' ? '🧴' : '📦',
    status: isDoneConsumable ? 'retired' : 'active',
    txns: [],
    unit: kind === 'consumable' ? '个' : undefined,
    retiredAt: isDoneConsumable ? item.date : undefined,
    createdAt: today,
  };
}

export function mergePossessionsFromBills({
  expenseItems,
  tagMap,
  overrides,
  items,
  ignoredBillItemIds,
  excludedNameTags,
  makeId,
  today,
}: AutoPossessionImportParams): AutoPossessionImportResult {
  const ignored = new Set(ignoredBillItemIds);
  const excludedNames = new Set(excludedNameTags);
  const referenced = new Set<string>();
  const billById = new Map<string, BillExpenseItem>();
  const billEntries = Object.entries(expenseItems)
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([, monthItems]) => assignExpenseIds(monthItems));

  for (const { item, id } of billEntries) billById.set(id, item);

  const nextItems = items.map((item) => ({ ...item, txns: [] as PossessionTxn[] }));
  const originalTxnCounts = new Map(items.map((item) => [item.id, item.txns.length]));
  const byId = new Map(nextItems.map((item) => [item.id, item]));
  const byName = new Map<string, PossessionItem>();

  for (const item of nextItems) {
    byName.set(itemKey(item.kind, item.name), item);
  }

  let changed = false;
  const ensureTarget = (billItem: BillExpenseItem, kind: PossessionKind, name: string, isDoneConsumable: boolean) => {
    const key = itemKey(kind, name);
    let possession = byName.get(key);
    if (!possession) {
      possession = createPossessionFromBill(billItem, kind, name, isDoneConsumable, makeId, today);
      nextItems.push(possession);
      byName.set(key, possession);
      changed = true;
    }
    if (isDoneConsumable && (possession.status !== 'retired' || possession.retiredAt !== billItem.date)) {
      possession.status = 'retired';
      possession.retiredAt = billItem.date;
      changed = true;
    }
    return possession;
  };

  for (const sourceItem of items) {
    const current = byId.get(sourceItem.id);
    if (!current) continue;
    for (const txn of sourceItem.txns) {
      let target = current;
      if (txn.billItemId && !ignored.has(txn.billItemId)) {
        const billItem = billById.get(txn.billItemId);
        const tags = billItem ? tagsOf(billItem) : [];
        if (billItem && isPossessionBill(billItem, tags)) {
          const kind = possessionKind(tags);
          const isDoneConsumable = kind === 'consumable' && tags.includes(DONE_TAG);
          const name = itemName(billItem, tags, excludedNames);
          target = ensureTarget(billItem, kind, name, isDoneConsumable);
          if (target.id !== current.id) changed = true;
        }
      }
      target.txns.push(txn);
      if (txn.billItemId) referenced.add(txn.billItemId);
    }
  }

  let importedCount = 0;
  for (const { item, id: billItemId } of billEntries) {
      if (ignored.has(billItemId) || referenced.has(billItemId)) continue;
      const tags = tagsOf(item);
      if (!isPossessionBill(item, tags)) continue;

      const kind = possessionKind(tags);
      const isDoneConsumable = kind === 'consumable' && tags.includes(DONE_TAG);
      const name = itemName(item, tags, excludedNames);
      const key = itemKey(kind, name);
      let possession = byName.get(key);
      if (!possession) {
        possession = createPossessionFromBill(item, kind, name, isDoneConsumable, makeId, today);
        nextItems.push(possession);
        byName.set(key, possession);
      } else if (isDoneConsumable) {
        possession.status = 'retired';
        possession.retiredAt = item.date;
      }

      const inferredScope = kind === 'consumable' ? resolveExpenseScope(item, overrides) : null;
      const scope = inferredScope ?? 'local';
      possession.txns.push({
        id: makeId(),
        date: item.date,
        amount: item.amount,
        quantity: kind === 'consumable' ? 1 : undefined,
        kind: 'purchase',
        billItemId,
        scope: kind === 'consumable' ? scope : undefined,
        scene: kind === 'consumable' && scope === 'local' ? tagMap[item.date] ?? 'school' : undefined,
        note: item.note || undefined,
      });
      possession.txns = sortTxns(possession.txns);
      referenced.add(billItemId);
      importedCount += 1;
  }

  const filteredItems = nextItems
    .map((item) => ({ ...item, txns: sortTxns(item.txns) }))
    .filter((item) => item.txns.length > 0 || (originalTxnCounts.get(item.id) ?? 0) === 0);

  return { items: filteredItems, importedCount, changed: changed || importedCount > 0 || filteredItems.length !== nextItems.length };
}
