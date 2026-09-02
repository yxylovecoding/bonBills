import type {
  AccountBalanceSyncCursor,
  AccountSnapshot,
  AutoAccountBalanceKey,
} from '../models/types';
import { useSnapshotStore } from '../stores/snapshotStore';
import type { BillAccountTransaction } from './importBill';

export const AUTO_ACCOUNT_BALANCE_KEYS: AutoAccountBalanceKey[] = [
  'credit', 'livingBank', 'incomeBank', 'investCnyBank', 'investUsdBank',
];

export const AUTO_ACCOUNT_BALANCE_LABELS: Record<AutoAccountBalanceKey, string> = {
  credit: '信用卡',
  livingBank: '生活',
  incomeBank: '收入',
  investCnyBank: '人民币理财现金',
  investUsdBank: '美元理财现金',
};

export type BillAccountBalanceImportResult = {
  initializedKeys: AutoAccountBalanceKey[];
  updatedKeys: AutoAccountBalanceKey[];
  appliedTransactions: number;
};

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function localTimestamp(iso: string) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso.slice(0, 19);
  return `${localDateKey(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
}

export function accountBalanceKeyForBillAccount(rawAccount: string): AutoAccountBalanceKey | null {
  const account = rawAccount.trim().replace(/\ufe0f/g, '');
  if (/工商银行|^工商|♑/.test(account)) return 'credit';
  if (/^(建设银行|建行|微信|微信钱包)$/.test(account)) return 'livingBank';
  if (/^(招商银行|招商|支付宝余额|余额)$/.test(account)) return 'incomeBank';
  if (/^(中国银行|中行)/.test(account) || account === '余额宝') return 'investCnyBank';
  if (/嘉信|Schwab|Charles/i.test(account)) return 'investUsdBank';
  return null;
}

function transactionDelta(transaction: BillAccountTransaction, key: AutoAccountBalanceKey) {
  if (key === 'credit') return transaction.transactionType === '支出' ? transaction.amount : -transaction.amount;
  return transaction.transactionType === '收入' ? transaction.amount : -transaction.amount;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function shouldApplyOnCursorDate(transaction: BillAccountTransaction, cursor: AccountBalanceSyncCursor) {
  if (cursor.transactionIdsOnDate.includes(transaction.id)) return false;
  if (transaction.occurredAt.length <= 10) return true;
  const editedDate = localDateKey(new Date(cursor.editedAt));
  if (cursor.throughDate !== editedDate || transaction.date !== editedDate) return true;
  return transaction.occurredAt > localTimestamp(cursor.editedAt);
}

export function syncAccountBalancesFromBill(
  transactions: BillAccountTransaction[],
): BillAccountBalanceImportResult {
  const store = useSnapshotStore.getState();
  const current = store.current;
  const now = new Date();
  const nowIso = now.toISOString();
  const grouped = Object.fromEntries(
    AUTO_ACCOUNT_BALANCE_KEYS.map((key) => [key, [] as BillAccountTransaction[]]),
  ) as Record<AutoAccountBalanceKey, BillAccountTransaction[]>;
  for (const transaction of transactions) {
    const key = accountBalanceKeyForBillAccount(transaction.account);
    if (key) grouped[key].push(transaction);
  }
  const globalLatestDate = transactions.reduce(
    (latest, transaction) => transaction.date > latest ? transaction.date : latest,
    '',
  );

  const accountPatch: Partial<AccountSnapshot['accounts']> = {};
  const syncPatch: Partial<Record<AutoAccountBalanceKey, AccountBalanceSyncCursor>> = {};
  const initializedKeys: AutoAccountBalanceKey[] = [];
  const updatedKeys: AutoAccountBalanceKey[] = [];
  let appliedTransactions = 0;

  for (const key of AUTO_ACCOUNT_BALANCE_KEYS) {
    const items = grouped[key].sort((a, b) => a.date.localeCompare(b.date) || a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
    const previous = current.accountBalanceSync?.[key];
    if (!previous) {
      if (!globalLatestDate) continue;
      initializedKeys.push(key);
      syncPatch[key] = {
        editedAt: nowIso,
        throughDate: globalLatestDate,
        transactionIdsOnDate: items.filter((item) => item.date === globalLatestDate).map((item) => item.id),
        syncedAt: nowIso,
      };
      continue;
    }
    if (items.length === 0) continue;
    const latestDate = items[items.length - 1].date;

    const newItems = items.filter((item) => (
      item.date > previous.throughDate
      || (item.date === previous.throughDate && shouldApplyOnCursorDate(item, previous))
    ));
    if (newItems.length > 0) {
      const delta = roundMoney(newItems.reduce((sum, item) => sum + transactionDelta(item, key), 0));
      const nextValue = roundMoney((current.accounts[key] ?? 0) + delta);
      accountPatch[key] = key === 'credit' ? Math.max(0, nextValue) : nextValue;
      updatedKeys.push(key);
      appliedTransactions += newItems.length;
    }
    const throughDate = latestDate > previous.throughDate ? latestDate : previous.throughDate;
    syncPatch[key] = {
      ...previous,
      throughDate,
      transactionIdsOnDate: throughDate === latestDate
        ? items.filter((item) => item.date === throughDate).map((item) => item.id)
        : previous.transactionIdsOnDate,
      syncedAt: nowIso,
    };
  }

  if (Object.keys(syncPatch).length > 0) store.applyImportedAccounts(accountPatch, syncPatch);
  return { initializedKeys, updatedKeys, appliedTransactions };
}
