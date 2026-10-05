import type { SessionStatus } from './authClient';

const CACHE_KEY = 'bonbills-sync-cache-v1';
const PENDING_KEY = 'bonbills-sync-pending-v1';

export function createAccountStorage(accountId: string) {
  if (accountId !== 'legacy' && !/^[a-f0-9]{32}$/.test(accountId)) throw new Error('账号无效');
  const keyFor = (key: string) => accountId === 'legacy' ? key : `bonbills-account:${accountId}:${key}`;
  return {
    getItem: (key: string) => localStorage.getItem(keyFor(key)),
    setItem: (key: string, value: string) => localStorage.setItem(keyFor(key), value),
    removeItem: (key: string) => localStorage.removeItem(keyFor(key)),
  };
}

let accountStorage = createAccountStorage('legacy');
export const getAccountStorage = () => accountStorage;

// 在加载 store 之前固定当前页面的缓存归属；其他标签页换账号也不会改变它。
// 旧账号继续使用原键，原账本及未上传修改无需搬移或清理。
export function prepareAccountCache(session: SessionStatus): string {
  if (!session.authenticated || !session.accountId) throw new Error('请重新登录');
  const owner = session.accountId;
  accountStorage = createAccountStorage(owner);
  if (owner === 'legacy') {
    try {
      const pending = JSON.parse(accountStorage.getItem(PENDING_KEY) || 'null');
      if (pending && (pending.owner === session.username || pending.owner === 'Key')) {
        accountStorage.setItem(PENDING_KEY, JSON.stringify({ ...pending, owner }));
      }
    } catch { /* 保留损坏的原始草稿，后续同步仍可读取云端数据。 */ }
  }
  accountStorage.setItem(CACHE_KEY, owner);
  return owner;
}
