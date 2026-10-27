import { timingSafeEqual } from 'node:crypto';
import type { VercelRequest } from '@vercel/node';
const actions = new Set(['', 'hourly-replan', 'life-periods', 'night-routine', 'daily-routine', 'routine-visibility', 'hair-wash', 'reading-visibility', 'daily-email']);
// Independent credential created for this scheduler. It cannot authorize other APIs.
export function cloudSchedulerAuthOk(req: VercelRequest) {
  const secret = process.env.CLOUD_SCHEDULER_RUN_SECRET?.trim();
  if (!secret || req.method !== 'GET' || req.query?.scheduler !== '1'
      || !actions.has(typeof req.query?.action === 'string' ? req.query.action : req.query?.action ? 'invalid' : '')) return false;
  const actual = Buffer.from(req.headers.authorization || '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
