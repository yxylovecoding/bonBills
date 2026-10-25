import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatchFullReplan } from './_cloudScheduler';
import { schedulerResponse } from './_schedulerResponse';
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe('cloud manual dispatch', () => {
  it('dispatches a durable job without GitHub credentials or email', async () => {
    vi.stubEnv('CLOUD_SCHEDULER_URL', 'https://bonbills-scheduler.example.workers.dev');
    vi.stubEnv('CLOUD_SCHEDULER_SECRET', 'secret');
    const fn = vi.fn().mockResolvedValue(Response.json({ ok: true, jobs: [{ id: 'manual-test' }] }, { status: 202 }));
    vi.stubGlobal('fetch', fn);
    expect(await dispatchFullReplan()).toEqual({ jobId: 'manual-test' });
    const [url, init] = fn.mock.calls[0];
    expect(String(url)).toBe('https://bonbills-scheduler.example.workers.dev/dispatch');
    expect(JSON.parse(init.body)).toMatchObject({ kind: 'full' });
    expect(init.redirect).toBe('error');
  });
  it('rejects unconfigured dispatch without silently falling back to GitHub', async () => {
    vi.stubEnv('CLOUD_SCHEDULER_URL', ''); vi.stubGlobal('fetch', vi.fn());
    await expect(dispatchFullReplan()).rejects.toThrow('尚未配置'); expect(fetch).not.toHaveBeenCalled();
  });
  it('does not expose errors or private contents to the dispatcher', () => {
    const body = schedulerResponse({ ok: false, dailyPlan: { tasks: ['PRIVATE'] }, error: 'PRIVATE URL',
      failure: { stage: 'PRIVATE', retryable: false }, laundry: { outlook: { error: 'PRIVATE' } },
      hairWash: { outlook: { error: 'PRIVATE' } },
      connection: 'PRIVATE', sleepTags: { complete: false, tasks: ['PRIVATE'] } });
    expect(body).toEqual({ ok: false, error: true, dailyPlan: {}, failure: { stage: 'unknown', retryable: false }, laundry: { outlook: { error: true } }, hairWash: { outlook: { error: true } }, sleepTags: { complete: false } });
    expect(JSON.stringify(body)).not.toContain('PRIVATE');
  });
});
