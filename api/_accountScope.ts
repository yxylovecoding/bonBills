import { AsyncLocalStorage } from 'node:async_hooks';

const accounts = new AsyncLocalStorage<{ accountId?: string }>();

export function runAccountRequest<T>(callback: () => T): T {
  return accounts.run({}, callback);
}

export function authorizeAccountScope(accountId: string) {
  if (accountId !== 'legacy' && !/^[a-f0-9]{32}$/.test(accountId)) throw new Error('Invalid account scope');
  const scope = accounts.getStore();
  if (scope) scope.accountId = accountId;
}

export function accountStorageKey(key: string): string {
  const scope = accounts.getStore();
  // 服务端定时任务和旧账本保持原键；浏览器请求必须先完成鉴权。
  if (!scope) return key;
  if (!scope.accountId) throw new Error('Unauthenticated data access');
  return !key || scope.accountId === 'legacy' ? key : `account:${scope.accountId}:${key}`;
}

export function isOwnerScope() {
  const scope = accounts.getStore();
  return !scope || scope.accountId === 'legacy';
}
