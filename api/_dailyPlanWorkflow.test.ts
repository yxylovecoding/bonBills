import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

// Execute the actual inline Actions script so its retries and exit status are covered.
const workflow = readFileSync('.github/workflows/ticktick-daily-plan.yml', 'utf8');
const job = workflow.split('\n  recalculate:')[1].split('\n  daily-email:')[0];
const script = job.match(/node --input-type=module <<'NODE'\n([\s\S]*?)          NODE/)![1]
  .replace(/^          /gm, '').replace("import { appendFileSync } from 'node:fs';", '');
const success = () => Response.json({ ok: true, dailyPlan: { todayCount: 0 } });
const readFailure = (stage = 'completion-history') => Response.json({
  error: 'PRIVATE TASK DATA', failure: { stage, retryable: true },
}, { status: 502 });

function stepScript(name: string) {
  const step = workflow.split(`      - name: ${name}\n`)[1];
  return step.match(/node --input-type=module <<'NODE'\n([\s\S]*?)          NODE/)![1]
    .replace(/^          /gm, '').replace("import { appendFileSync } from 'node:fs';", '');
}
async function run(responses: (Response | Error)[], source = script) {
  const exited = Symbol('successful exit');
  const delays: number[] = [];
  const logs: string[] = [];
  const outputs: string[] = [];
  const fetcher = vi.fn(async () => {
    const response = responses.shift();
    if (response instanceof Error) throw response;
    if (!response) throw new Error('Unexpected request');
    return response;
  });
  let error: string | undefined;
  try {
    // A real process exit is not catchable; return models it even inside a retry try/catch.
    await runInNewContext(`(async () => {\n${source.replace(/process.exit\(0\);/g, 'return;')}\n})()`, {
      process: { env: { CRON_SECRET: 'PRIVATE SECRET', GITHUB_OUTPUT: 'output' }, exit: () => { throw exited; } },
      fetch: fetcher, appendFileSync: (_path: string, value: string) => outputs.push(value),
      AbortSignal: { timeout: () => undefined },
      console: { log: (message: string) => logs.push(message) },
      setTimeout: (resolve: () => void, delay: number) => { delays.push(delay); resolve(); },
    });
  } catch (cause) {
    if (cause !== exited) error = String(cause);
  }
  return { calls: fetcher.mock.calls.length, delays, logs, outputs, error };
}

describe('daily planning workflow recovery', () => {
  it.each(['Restore morning visibility before planning', 'Import and save Outlook periods', 'Send training and daily planning email'])(
    '%s stops during rest without reporting a completed prerequisite', async name => {
      const result = await run([Response.json({ ok: true, skipped: 'rest-window' })], stepScript(name));
      expect(result).toMatchObject({ calls: 1, error: undefined, outputs: [] });
      expect(result.logs.at(-1)).toContain('rest window');
    },
  );
  it('finishes restoration batches before enabling import and planning', async () => {
    const restored = () => Response.json({ ok: true, sleepTags: { complete: true }, nightRoutine: {}, exercise: {} });
    const source = stepScript('Restore morning visibility before planning');
    const result = await run([Response.json({ ok: true, sleepTags: { complete: false } }), restored()], source);
    expect(result).toMatchObject({ calls: 2, error: undefined, outputs: ['completed=true\n'] });
    const failed = await run([Response.json({ error: 'PRIVATE' }, { status: 502 }), restored()], source);
    expect(failed.calls).toBe(1); expect(failed.outputs).toEqual([]); expect(failed.error).toBeDefined();
    expect(JSON.stringify(failed)).not.toContain('PRIVATE');
    expect(workflow).toContain("steps.restore.outputs.completed == 'true'");
    expect(workflow).toContain("needs.archive-periods.outputs.restored == 'true'");
  });
  it('marks the archive complete only after the provider confirms it', async () => {
    const result = await run([Response.json({ ok: true, connected: false })], stepScript('Import and save Outlook periods'));
    expect(result).toMatchObject({ calls: 1, error: undefined, outputs: ['completed=true\n'] });
  });
  it('does not declare a skipped plan complete or allow it to satisfy the email prerequisite', async () => {
    const result = await run([Response.json({ ok: true, skipped: 'rest-window' })]);
    expect(result).toMatchObject({ calls: 1, error: undefined, outputs: [] });
    expect(result.logs.at(-1)).toContain('rest window');
    expect(workflow).toContain("needs.recalculate.outputs.completed == 'true'");
    expect((await run([success()])).outputs).toEqual(['completed=true\n']);
  });
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
