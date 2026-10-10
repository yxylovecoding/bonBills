import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import handler from './ticktick-trips';

const { get, set, replan, periods } = vi.hoisted(() => ({
  get: vi.fn(), set: vi.fn(), replan: vi.fn(), periods: vi.fn(),
}));
vi.mock('./_accountRoute.js', () => ({ withAccountScope: (handler: unknown) => handler }));
vi.mock('./_auth.js', () => ({ authOk: async () => true }));
vi.mock('@vercel/kv', () => ({ kv: { get, set } }));
vi.mock('./_ticktickReplan.js', () => ({ replanRemainingToday: replan }));
vi.mock('./_bonLife.js', () => ({ syncRecentLifePeriods: periods }));

async function request(action: string, cron = true) {
  const result = { status: 200, body: {} as Record<string, unknown> };
  const res = { setHeader: vi.fn(), status: (status: number) => { result.status = status; return res; },
    json: (body: Record<string, unknown>) => { result.body = body; return res; } };
  await handler({ method: 'GET', headers: cron ? { authorization: 'Bearer test-cron' } : {}, query: { action } } as VercelRequest,
    res as unknown as VercelResponse);
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('CRON_SECRET', 'test-cron');
  get.mockResolvedValue(null);
  replan.mockResolvedValue({ busy: false, dailyPlan: { selected: [] } });
  periods.mockResolvedValue({ connected: true, syncedAt: '2026-10-10T07:00:00Z' });
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected provider request')));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('定时同步与已结束的一次性安排', () => {
  it('连续小时重排仅执行当前规划，不读取或重放旧电动车安排', async () => {
    for (let i = 0; i < 2; i++) {
      expect(await request('hourly-replan')).toEqual({ status: 200,
        body: { ok: true, busy: false, dailyPlan: { selected: [] } } });
    }
    expect(replan).toHaveBeenCalledTimes(2);
    expect(replan).toHaveBeenCalledWith({ scheduled: true });
    expect(get).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('规划锁忙时仍正常延期，不触发旧安排', async () => {
    replan.mockResolvedValue({ busy: true });
    expect(await request('hourly-replan')).toEqual({ status: 200,
      body: { ok: true, busy: false, deferred: true, dailyPlan: { deferred: true } } });
    expect(get).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('经期归档不依赖 TickTick 或执行额外的日历写入', async () => {
    expect(await request('life-periods')).toEqual({ status: 200,
      body: { ok: true, connected: true, syncedAt: '2026-10-10T07:00:00Z' } });
    expect(periods).toHaveBeenCalledOnce();
    expect(get).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('旧电动车入口明确返回已停用且不触碰任务、完成记录或日历', async () => {
    expect((await request('electric-vehicle-charge')).status).toBe(410);
    expect(get).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('非定时鉴权不能调用小时重排或旧电动车入口', async () => {
    for (const action of ['hourly-replan', 'electric-vehicle-charge']) {
      expect((await request(action, false)).status).toBe(403);
    }
    expect(replan).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });
});
