import { kv as rawKv } from '@vercel/kv';
import { accountStorageKey } from './_accountScope.js';

// 所有个人数据命令统一隔离，包括事务脚本的 KEYS、照片、连接和同步锁。
// 未列出的命令拒绝执行，避免后续新增命令意外绕过账号边界。
export const kv = new Proxy({} as typeof rawKv, {
  get(_target, property: string) {
    return (...input: unknown[]) => {
      const args = [...input];
      if (['get', 'set', 'incr', 'hget', 'hgetall', 'hset', 'hdel'].includes(property)) {
        args[0] = accountStorageKey(args[0] as string);
      } else if (['del', 'mget'].includes(property)) {
        args.splice(0, args.length, ...args.map((key) => accountStorageKey(key as string)));
      } else if (property === 'mset') {
        args[0] = Object.fromEntries(Object.entries(args[0] as Record<string, unknown>)
          .map(([key, value]) => [accountStorageKey(key), value]));
      } else if (property === 'eval') {
        args[1] = (args[1] as string[]).map(accountStorageKey);
      } else {
        throw new Error(`Unsupported scoped storage command: ${property}`);
      }
      return (rawKv[property as keyof typeof rawKv] as (...values: unknown[]) => unknown)(...args);
    };
  },
});
