import type { PossessionItem, PossessionKind, PossessionTxn, TagKind } from '../models/types';
import { resolveExpenseScope, type ExpenseScopeOverrides } from '../stores/expenseScopeOverrideStore';
import { assignExpenseIds, type BillExpenseItem, type BillExpenseMonth } from './importBill';
import { classifyTag, type ManualTagCategory } from './tagCategory';

const POSSESSION_CATEGORIES = new Set(['购物', '医疗']);
const EXCLUDED_KEYWORDS = ['体检', '周边', '医院'];
const CONSUMABLE_TAG = '消耗品';
const DONE_TAG = 'done';
const QUANTITY_PATTERN = /(\d+(?:\.\d+)?)\s*(kg|mg|ml|l|g|斤|两|升|毫升|瓶|盒|支|个|包|袋|片|颗|粒|罐|条|卷|套|只|双|斤装|毫升装)/i;

export interface ParsedPossessionQuantity {
  quantity: number;
  unit: string;
}

export interface AutoPossessionImportParams {
  expenseItems: Record<string, BillExpenseMonth>;
  tagMap: Record<string, TagKind>;
  overrides: ExpenseScopeOverrides;
  items: PossessionItem[];
  ignoredBillItemIds: string[];
  tagCategory: Record<string, ManualTagCategory>;
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

export function parsePossessionQuantity(item: Pick<BillExpenseItem, 'note' | 'tags'>): ParsedPossessionQuantity | null {
  const candidates = [
    ...item.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
    item.note,
  ].filter(Boolean);
  for (const candidate of candidates) {
    const match = candidate.match(QUANTITY_PATTERN);
    if (!match) continue;
    const quantity = Number(match[1]);
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    return { quantity, unit: match[2] };
  }
  return null;
}

function isPossessionBill(item: BillExpenseItem, tags: string[]) {
  const searchable = [item.category, item.subcategory, item.note, ...tags].join(' ');
  if (EXCLUDED_KEYWORDS.some((keyword) => searchable.includes(keyword))) return false;
  return tags.includes(CONSUMABLE_TAG) || POSSESSION_CATEGORIES.has(item.category);
}

function possessionKind(tags: string[]): PossessionKind {
  return tags.includes(CONSUMABLE_TAG) ? 'consumable' : 'durable';
}

function itemName(item: BillExpenseItem, tags: string[], tagCategory: Record<string, ManualTagCategory>) {
  // 优先 name > brand > unclassified；自动 3 类（system/trip/quantity）+ person/ignore 都不当物品名
  const pickByCategory = (target: 'name' | 'brand' | 'unclassified') =>
    tags.find((candidate) => candidate && classifyTag(candidate, tagCategory) === target);
  const tag = pickByCategory('name') ?? pickByCategory('brand') ?? pickByCategory('unclassified');
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
  parsedQuantity: ParsedPossessionQuantity | null,
  makeId: () => string,
  today: string,
): PossessionItem {
  return {
    id: makeId(),
    name,
    kind,
    category: item.subcategory || item.category || undefined,
    icon: kind === 'consumable' ? '🧴' : '📦',
    status: 'active',
    txns: [],
    unit: kind === 'consumable' ? (parsedQuantity?.unit ?? '个') : undefined,
    retiredAt: undefined,
    createdAt: today,
  };
}

function normalizeImportedTxn(
  txn: PossessionTxn,
  billItem: BillExpenseItem,
  kind: PossessionKind,
  tags: string[],
  tagMap: Record<string, TagKind>,
  overrides: ExpenseScopeOverrides,
) {
  if (kind !== 'consumable') return txn;
  const parsed = parsePossessionQuantity(billItem);
  const isDone = tags.includes(DONE_TAG);
  const done = isDone || txn.done || undefined;
  const inferredScope = resolveExpenseScope(billItem, overrides);
  const scope = inferredScope ?? txn.scope ?? 'local';
  const nextQuantity = parsed && (txn.quantity === undefined || txn.quantity === 1) ? parsed.quantity : txn.quantity;
  return {
    ...txn,
    quantity: nextQuantity ?? 1,
    done,
    doneAt: done ? (txn.doneAt ?? billItem.date) : undefined,
    scope,
    scene: scope === 'local' ? (txn.scene ?? tagMap[billItem.date] ?? 'school') : undefined,
  };
}

export function mergePossessionsFromBills({
  expenseItems,
  tagMap,
  overrides,
  items,
  ignoredBillItemIds,
  tagCategory,
  makeId,
  today,
}: AutoPossessionImportParams): AutoPossessionImportResult {
  const ignored = new Set(ignoredBillItemIds);
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
  const ensureTarget = (billItem: BillExpenseItem, kind: PossessionKind, name: string, parsedQuantity: ParsedPossessionQuantity | null) => {
    const key = itemKey(kind, name);
    let possession = byName.get(key);
    if (!possession) {
      possession = createPossessionFromBill(billItem, kind, name, parsedQuantity, makeId, today);
      nextItems.push(possession);
      byName.set(key, possession);
      changed = true;
    }
    if (kind === 'consumable') {
      if ((!possession.unit || possession.unit === '个') && parsedQuantity?.unit && possession.unit !== parsedQuantity.unit) {
        possession.unit = parsedQuantity.unit;
        changed = true;
      }
      if (possession.status === 'retired') {
        possession.status = 'active';
        possession.retiredAt = undefined;
        changed = true;
      }
    }
    return possession;
  };

  const pushTxn = (target: PossessionItem, txn: PossessionTxn, billItem?: BillExpenseItem, tags: string[] = []) => {
    const nextTxn = billItem ? normalizeImportedTxn(txn, billItem, target.kind, tags, tagMap, overrides) : txn;
    target.txns.push(nextTxn);
    if (
      nextTxn.done !== txn.done
      || nextTxn.doneAt !== txn.doneAt
      || nextTxn.quantity !== txn.quantity
      || nextTxn.scope !== txn.scope
      || nextTxn.scene !== txn.scene
    ) {
      changed = true;
    }
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
          const name = itemName(billItem, tags, tagCategory);
          target = ensureTarget(billItem, kind, name, parsePossessionQuantity(billItem));
          if (target.id !== current.id) changed = true;
        }
      }
      const billItem = txn.billItemId ? billById.get(txn.billItemId) : undefined;
      pushTxn(target, txn, billItem, billItem ? tagsOf(billItem) : []);
      if (txn.billItemId) referenced.add(txn.billItemId);
    }
  }

  let importedCount = 0;
  for (const { item, id: billItemId } of billEntries) {
    if (ignored.has(billItemId) || referenced.has(billItemId)) continue;
    const tags = tagsOf(item);
    if (!isPossessionBill(item, tags)) continue;

    const kind = possessionKind(tags);
    const parsedQuantity = parsePossessionQuantity(item);
    const isDoneConsumable = kind === 'consumable' && tags.includes(DONE_TAG);
    const name = itemName(item, tags, tagCategory);
    const key = itemKey(kind, name);
    let possession = byName.get(key);
    if (!possession) {
      possession = createPossessionFromBill(item, kind, name, parsedQuantity, makeId, today);
      nextItems.push(possession);
      byName.set(key, possession);
    } else if (kind === 'consumable') {
      if ((!possession.unit || possession.unit === '个') && parsedQuantity?.unit && possession.unit !== parsedQuantity.unit) {
        possession.unit = parsedQuantity.unit;
        changed = true;
      }
      if (possession.status === 'retired') {
        possession.status = 'active';
        possession.retiredAt = undefined;
        changed = true;
      }
    }

    const inferredScope = kind === 'consumable' ? resolveExpenseScope(item, overrides) : null;
    const scope = inferredScope ?? 'local';
    possession.txns.push({
      id: makeId(),
      date: item.date,
      amount: item.amount,
      quantity: kind === 'consumable' ? (parsedQuantity?.quantity ?? 1) : undefined,
      kind: 'purchase',
      done: isDoneConsumable || undefined,
      doneAt: isDoneConsumable ? item.date : undefined,
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
