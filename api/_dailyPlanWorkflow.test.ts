import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

// Execute the actual inline Actions script so its retries and exit status are covered.
const workflow = readFileSync('.github/workflows/ticktick-daily-plan.yml', 'utf8');
const job = workflow.split('\n  recalculate:')[1].split('\n  daily-email:')[0];
const script = job.match(/node --input-type=module <<'NODE'\n([\s\S]*?)          NODE/)![1]
  .replace(/^          /gm, '');
const success = () => Response.json({ ok: true, dailyPlan: { todayCount: 0 } });
const readFailure = (stage = 'completion-history') => Response.json({
  error: 'PRIVATE TASK DATA', failure: { stage, retryable: true },
}, { status: 502 });

async function run(responses: (Response | Error)[]) {
  const exited = Symbol('successful exit');
  const delays: number[] = [];
  const logs: string[] = [];
  const fetcher = vi.fn(async () => {
    const response = responses.shift();
    if (response instanceof Error) throw response;
    if (!response) throw new Error('Unexpected request');
    return response;
  });
  let error: string | undefined;
  try {
    await runInNewContext(`(async () => {\n${script}\n})()`, {
      process: { env: { CRON_SECRET: 'PRIVATE SECRET' }, exit: () => { throw exited; } },
      fetch: fetcher,
      AbortSignal: { timeout: () => undefined },
      console: { log: (message: string) => logs.push(message) },
      setTimeout: (resolve: () => void, delay: number) => { delays.push(delay); resolve(); },
    });
  } catch (cause) {
    if (cause !== exited) error = String(cause);
  }
  return { calls: fetcher.mock.calls.length, delays, logs, error };
}

describe('daily planning workflow recovery', () => {
  it.each(['completion-archive', 'outlook-refresh', 'tasks-read', 'completion-history', 'template-read'])(
    'retries a safe %s failure and succeeds only after a complete plan', async stage => {
      const result = await run([readFailure(stage), success()]);
      expect(result).toMatchObject({ calls: 2, delays: [30_000], error: undefined });
      expect(result.logs.at(-1)).toContain('completed successfully');
      expect(JSON.stringify(result)).not.toMatch(/PRIVATE/);
    },
  );

  it('backs off twice and still fails when the read never recovers', async () => {
    const result = await run([readFailure(), readFailure(), readFailure(), success()]);
    expect(result).toMatchObject({ calls: 3, delays: [30_000, 60_000] });
    expect(result.error).toContain('HTTP 502, stage=completion-history');
    expect(result.logs.join(' ')).not.toMatch(/completed successfully|PRIVATE/);
  });

  it.each([
    Response.json({ error: 'PRIVATE', failure: { stage: 'planning', retryable: false } }, { status: 502 }),
    Response.json({ error: 'PRIVATE', failure: { stage: 'finalize', retryable: false } }, { status: 502 }),
    readFailure('PRIVATE UNKNOWN STAGE'),
    Response.json({ error: 'PRIVATE' }, { status: 502 }),
    new Response('PRIVATE gateway body', { status: 504 }),
    Response.json({ error: 'PRIVATE' }, { status: 401 }),
    new Error('PRIVATE network failure'),
  ])('does not replay writes, unknown failures, auth failures, or missing responses (%#)', async response => {
    const result = await run([response, success()]);
    expect(result).toMatchObject({ calls: 1, delays: [] });
    expect(result.error).toBeDefined();
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });

  it('resumes restoration batches and waits for the lock without losing the read retry', async () => {
    const result = await run([
      Response.json({ sleepTags: { complete: false } }, { status: 202 }),
      Response.json({ busy: true }, { status: 202 }),
      readFailure(), success(),
    ]);
    expect(result).toMatchObject({ calls: 4, delays: [30_000, 30_000], error: undefined });
  });

  it.each([
    { ok: true }, { ok: false, dailyPlan: {} }, { ok: true, busy: true, dailyPlan: {} },
    { ok: true, error: 'PRIVATE', dailyPlan: {} },
    { ok: true, dailyPlan: {}, laundry: { outlook: { error: 'PRIVATE' } } },
    { ok: true, dailyPlan: {}, charging: { outlook: { error: 'PRIVATE' } } },
  ])('rejects incomplete or partially failed HTTP 200 responses (%#)', async body => {
    const result = await run([Response.json(body)]);
    expect(result.calls).toBe(1);
    expect(result.error).toBeDefined();
    expect(result.logs).toEqual([]);
    expect(result.error).not.toContain('PRIVATE');
  });
});
