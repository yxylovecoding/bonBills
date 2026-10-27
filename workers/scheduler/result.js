const readStages = new Set(['outlook-refresh', 'tasks-read', 'completion-history', 'template-read']);
const skipReasons = new Set(['rest-window', 'sleep-window', 'restore-pending', 'disconnected']);
export const actionTimeout = action => action === 'full' || action === 'hourly-replan' ? 320_000
  : action === 'life-periods' ? 80_000 : action === 'daily-email' ? 100_000 : 150_000;
// Persist only fixed categories, never provider errors, private records or response bodies.
export function classify(action, status, body, attempt) {
  const fail = reason => ({ outcome: 'failed', reason, http: status });
  const retry = (counter, delay) => ({ outcome: 'retry', counter, delay, http: status });
  if (status === 200 && body?.ok === true && body.skipped === 'rest-window') return { outcome: 'skipped', reason: 'rest-window' };
  if (action === 'life-periods') {
    if (status === 200 && body?.ok === true && (body.connected === false ||
        (body.connected === true && typeof body.syncedAt === 'string'))) return { outcome: 'success' };
    return ![401, 403].includes(status) && attempt.retries < 2
      ? retry('retries', 10_000) : fail('period-import');
  }
  // Persisted restoration batches are explicitly safe to continue.
  if ((action === 'full' && status === 202 ||
      ['daily-routine', 'routine-visibility'].includes(action) && status === 200 && body?.ok === true)
      && body?.sleepTags?.complete === false) return retry('batches', 1000);
  if (status === 202 || action === 'hourly-replan' && status === 200 && body?.deferred === true) {
    return attempt.busy < 12 ? retry('busy', 30_000) : fail('busy');
  }
  const safeRead = readStages.has(body?.failure?.stage) || action === 'full' && body?.failure?.stage === 'completion-archive';
  if (['full', 'hourly-replan'].includes(action) && status === 502 && body?.failure?.retryable === true
      && safeRead && attempt.retries < 2) return retry('retries', 30_000 * (attempt.retries + 1));
  if (action === 'daily-email') return status === 200 && body?.sent === true
    ? { outcome: 'success' } : fail('email-incomplete');
  if (status !== 200 || body?.ok !== true || body.busy || body.error) return fail('incomplete');
  if (action === 'full') {
    if (!body.dailyPlan || body.laundry?.outlook?.error || body.charging?.outlook?.error || body.hairWash?.outlook?.error) return fail('plan-incomplete');
  } else if (action === 'hourly-replan') {
    if (!body.dailyPlan && !skipReasons.has(body.skipped)) return fail('plan-incomplete');
  } else if (body.connected !== false) {
    if (action === 'reading-visibility' && !body.reading) return fail('visibility-incomplete');
    if (action === 'hair-wash' && (!body.hairWash || !body.reading)) return fail('visibility-incomplete');
    if (['night-routine', 'routine-visibility'].includes(action) && (!body.nightRoutine || !body.exercise)) return fail('visibility-incomplete');
    if (['daily-routine', 'routine-visibility'].includes(action) && body.sleepTags?.complete !== true) return fail('visibility-incomplete');
  }
  return { outcome: 'success' };
}
export async function callAction(action, env, attempt) {
  const url = new URL('/api/ticktick-trips', env.ORIGIN);
  url.searchParams.set('scheduler', '1');
  if (action !== 'full') url.searchParams.set('action', action);
  try {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${env.SCHEDULER_RUN_SECRET}` },
      redirect: 'manual', signal: AbortSignal.timeout(actionTimeout(action)) });
    const body = await response.json().catch(() => null);
    return classify(action, response.status, body, attempt);
  } catch {
    // Only the idempotent archive is safe without a response. Never replay uncertain writes.
    return action === 'life-periods' ? classify(action, 0, null, attempt)
      : { outcome: 'failed', reason: 'response-unknown', http: 0 };
  }
}
