import { randomUUID } from 'node:crypto';
import { kv } from '@vercel/kv';

const KEY = 'ticktick:trip-sync:lock';
export async function acquireTickTickLock() {
  const id = randomUUID();
  return await kv.set(KEY, id, { nx: true, ex: 330 }) ? id : null;
}
export async function releaseTickTickLock(id: string) {
  await kv.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0", [KEY], [id]);
}
