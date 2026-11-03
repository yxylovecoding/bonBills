import { kv } from './_accountKv.js';

export const READ_MAKE_QUOTA = `
local calls = redis.call('ZRANGEBYSCORE', KEYS[1], '(' .. ARGV[1], '+inf', 'WITHSCORES')
local count = #calls / 2
if count < 200 then return {count, 0} end
return {count, tonumber(calls[(count - 199) * 2])}
`;

// Inspect the existing rolling safety budget without consuming a relay call,
// removing history, or resetting the allowance when a connection is changed.
export async function readOutlookMakeQuota(now = Date.now()) {
  const window = 2_764_800_000;
  const [used, releasedCall] = await kv.eval<[number], [number, number]>(READ_MAKE_QUOTA, ['outlook:make-calls:v1'], [now - window]);
  return { used, limit: 200, ...(used >= 200 ? { retryAt: new Date(releasedCall + window).toISOString() } : {}) };
}
