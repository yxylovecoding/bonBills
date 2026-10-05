import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import handler from './ticktick-trips';
import { DAILY_PLAN_KEY, DAILY_PLAN_SETTINGS_KEY } from './_ticktickDailyPlan';
import * as laundryModule from './_ticktickLaundry';
const { replan, planDetails } = vi.hoisted(() => ({ replan: vi.fn(), planDetails: vi.fn() }));
vi.mock('./_ticktickReplan.js', () => ({ replanRemainingToday: replan }));
vi.mock('./_ticktickPlanDetails.js', () => ({ readTickTickPlanDetails: planDetails }));
const { data, auth, failHistory, failWrite, sleepTags, briefing, syncTraining, sendEmail, routineOptions } = vi.hoisted(() => ({ data: new Map<string, any>(), auth: { ok: true }, failHistory: { value: false }, failWrite: { value: false }, sleepTags: vi.fn(), briefing: vi.fn(), syncTraining: vi.fn(), sendEmail: vi.fn(), routineOptions: { value: null as any } }));
vi.mock('./_dailyEmail.js', () => ({ sendDailyEmail: sendEmail }));
vi.mock('./_dailyBriefing.js', () => ({ readDailyBriefing: briefing, renderDailyBriefing: () => '<html>每日简报</html>' }));
vi.mock('./_lifeTraining.js', () => ({ syncTrainingSource: syncTraining }));
vi.mock('./_auth.js', () => ({ authOk: async () => auth.ok }));
vi.mock('./_outlookSync.js', () => ({ syncOutlookCalendar: async () => ({ connected: true,
  availability: { startDate: '2020-01-01', endDate: '2030-01-01', events: [] } }) }));
vi.mock('./_ticktickSleepTags.js', () => ({ syncSleepRoutineTags: sleepTags }));
vi.mock('./_lifeSwimming.js', () => ({ syncSwimmingSchedule: async () => undefined }));
vi.mock('./_ticktickLock.js', () => ({ acquireTickTickLock: async () => 'lock', releaseTickTickLock: async () => undefined }));
vi.mock('@vercel/kv', () => ({ kv: { get: async (key: string) => structuredClone(data.get(key) ?? null),
  set: async (key: string, value: unknown) => { data.set(key, structuredClone(value)); return 'OK'; } } }));
vi.mock('./_ticktickTrips.js', async (original) => ({
  ...await original<typeof import('./_ticktickTrips')>(),
  decryptTickTickToken: () => 'test-token',
  TickTickOpenApiClient: class { async listCompletedTasks() { if (failHistory.value) throw new Error('history unavailable'); return []; } },
  readAllTickTickTasks: async () => [],
  readConnectedTickTickTemplate: async () => ({ rootTask: { id: 'root' }, tasks: [] }),
  reconcileTickTickTrips: async () => ({}), reconcileTickTickWishPreparations: async () => ({}),
  syncTickTickRoutines: async (options: any) => {
    routineOptions.value = options;
    await options.planDay([]);
    if (failWrite.value) throw new Error('write unavailable');
    return { updatedRoutineTasks: 0 };
  },
}));
async function request(method: string, body?: unknown, action?: string, format?: string, authorization?: string) {
  const result = { status: 200, body: {} as Record<string, any>, html: '', location: '' };
  const res = { setHeader: vi.fn(), status: (code: number) => { result.status = code; return res; }, json: (value: Record<string, unknown>) => { result.body = value; return res; },
    send: (html: string) => { result.html = html; return res; }, redirect: (code: number, url: string) => { result.status = code; result.location = url; return res; } };
  await handler({ method, headers: { authorization }, body, query: action ? { action, format } : {} } as VercelRequest, res as unknown as VercelResponse);
  return result;
}
beforeEach(() => { data.clear(); auth.ok = true; failHistory.value = false; failWrite.value = false;
  briefing.mockReset().mockResolvedValue({}); syncTraining.mockReset().mockResolvedValue({});
  sendEmail.mockReset().mockResolvedValue({ sent: true, duplicate: false });
  sleepTags.mockResolvedValue({ mode: 'restore', updated: 0, remaining: 0, complete: true });
  data.set('ticktick:connection:v1', { encryptedToken: {} }); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
describe('每日安排接口', () => {
  it('排期详情仅限已登录 GET，读取不重排、不触发其他同步', async () => {
    planDetails.mockReset().mockResolvedValue({ date: '2026-10-05', selected: [] });
    replan.mockClear(); sleepTags.mockClear(); syncTraining.mockClear();
    auth.ok = false;
    expect((await request('GET', undefined, 'plan-details')).status).toBe(401);
    auth.ok = true;
    expect((await request('POST', undefined, 'plan-details')).status).toBe(405);
    expect(planDetails).not.toHaveBeenCalled();
    expect(await request('GET', undefined, 'plan-details')).toMatchObject({ status: 200,
      body: { details: { date: '2026-10-05', selected: [] } } });
    expect(replan).not.toHaveBeenCalled(); expect(sleepTags).not.toHaveBeenCalled(); expect(syncTraining).not.toHaveBeenCalled();
    expect(data.has(DAILY_PLAN_KEY)).toBe(false);
  });
  it('DoneList 专用重排须登录且仅允许 POST，不调用综合同步', async () => {
    replan.mockReset().mockResolvedValue({ busy: false, dailyPlan: { date: '2026-10-05', todayCount: 2 } });
    auth.ok = false;
    expect((await request('POST', undefined, 'replan-today')).status).toBe(401);
    auth.ok = true;
    expect((await request('GET', undefined, 'replan-today')).status).toBe(405);
    vi.stubEnv('CRON_SECRET', 'cron-secret');
    expect((await request('GET', undefined, 'replan-today', undefined, 'Bearer cron-secret')).status).toBe(405);
    expect(replan).not.toHaveBeenCalled();
    expect(await request('POST', undefined, 'replan-today')).toMatchObject({ status: 200, body: { ok: true, dailyPlan: { todayCount: 2 } } });
    replan.mockResolvedValueOnce({ busy: true });
    expect(await request('POST', undefined, 'replan-today')).toMatchObject({ status: 202, body: { ok: false, busy: true } });
    expect(sleepTags).not.toHaveBeenCalled(); expect(syncTraining).not.toHaveBeenCalled();
  });
  it('发信入口仅接受后台密钥；普通访问不发邮件，繁忙可以稍后重试', async () => {
    vi.stubEnv('CRON_SECRET', 'cron-secret');
    expect((await request('GET', undefined, 'daily-email')).status).toBe(403);
    expect((await request('POST', undefined, 'daily-email')).status).toBe(403);
    expect(sendEmail).not.toHaveBeenCalled();
    auth.ok = false;
    expect((await request('GET', undefined, 'daily-email', undefined, 'Bearer wrong')).status).toBe(401);
    expect((await request('GET', undefined, 'daily-email', undefined, 'Bearer cron-secret')).body.sent).toBe(true);
    sendEmail.mockResolvedValueOnce({ busy: true });
    expect((await request('GET', undefined, 'daily-email', undefined, 'Bearer cron-secret')).status).toBe(202);
  });
  it('洗衣天气先排期，其管理任务同时排除普通场景与每日轮换，天气不可用也不被拉回今天', async () => {
    const laundry = vi.spyOn(laundryModule, 'syncLaundrySchedule').mockResolvedValue({ updated: 0,
      managedTaskIds: new Set(['wash']), decisions: [{ id: 'wash', reason: '天气不可用，保留原排期' }] });
    const result = await request('POST');
    expect(result.status).toBe(200);
    expect(result.body.laundry.decisions[0].id).toBe('wash');
    expect(laundry).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ history: [], availability: expect.anything() }));
    expect(routineOptions.value.excludedTaskIds.has('wash')).toBe(true);
    // Ordinary background recalculation also publishes the final training dates;
    // it must not depend on opening or refreshing the email preview.
    expect(syncTraining).toHaveBeenCalledWith(expect.any(Number), { lockHeld: true });
    const dates = await routineOptions.value.planDay([{ id: 'wash', projectId: 'life', title: '洗衣服', priority: 1, tags: ['居'],
      isAllDay: true, dueDate: '2026-10-05T00:00:00+0800', repeatFlag: 'RRULE:FREQ=DAILY;INTERVAL=5' }]);
    expect(dates.has('wash')).toBe(false);
  });
  it('网页通过 JSON 读取简报，繁忙状态不能当作已更新的报告', async () => {
    briefing.mockResolvedValue({ date: '2026-10-05', ready: true });
    expect((await request('GET', undefined, 'briefing', 'json')).body).toEqual({ date: '2026-10-05', ready: true });
    sleepTags.mockResolvedValueOnce({ mode: 'restore', updated: 20, remaining: 5, complete: false });
    expect(await request('POST', undefined, 'briefing', 'json')).toMatchObject({ status: 202, body: { busy: true } });
    expect(syncTraining).not.toHaveBeenCalled();
    expect(await request('POST', undefined, 'briefing', 'json')).toMatchObject({ status: 200, body: { ready: true } });
    expect(syncTraining).toHaveBeenCalledTimes(1);
  });
  it('简报沿用登录保护，读取不改排期，主动刷新才同步训练', async () => {
    auth.ok = false;
    expect((await request('GET', undefined, 'briefing')).status).toBe(401);
    expect(briefing).not.toHaveBeenCalled();
    auth.ok = true;
    expect((await request('GET', undefined, 'briefing')).html).toContain('每日简报');
    expect(syncTraining).not.toHaveBeenCalled(); expect(data.has(DAILY_PLAN_KEY)).toBe(false);
    expect(await request('POST', undefined, 'briefing')).toMatchObject({ status: 303, location: '/api/ticktick-trips?action=briefing' });
    expect(syncTraining).toHaveBeenCalledTimes(1);
    expect((await request('DELETE', undefined, 'briefing')).status).toBe(405);
  });
  it('凌晨临时标签未恢复完时不发布计划，恢复完成后再计算', async () => {
    sleepTags.mockResolvedValueOnce({ mode: 'restore', updated: 20, remaining: 5, complete: false });
    expect(await request('POST')).toMatchObject({ status: 202, body: { busy: true, sleepTags: { remaining: 5 } } });
    expect(data.has(DAILY_PLAN_KEY)).toBe(false);
    expect((await request('POST')).status).toBe(200);
    expect(data.has(DAILY_PLAN_KEY)).toBe(true);
    expect(sleepTags).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ restoreOnly: true }));
  });
  it('手动和后台共用的同步入口按执行时刻返回剩余额度', async () => {
    vi.useFakeTimers();
    for (const [hour, minutes] of [[5, 330], [12, 240], [17, 120], [20, 60], [23, 0]]) {
      vi.setSystemTime(new Date(`2026-10-04T${String(hour).padStart(2, '0')}:00:00+08:00`));
      const result = await request('POST');
      expect(result.status).toBe(200);
      expect(result.body.dailyPlan.availableMinutes).toBe(minutes);
    }
  });
  it('读取默认用时并校验修改范围，未认证不能更改', async () => {
    expect((await request('GET')).body.budgetMinutes).toBeNull();
    for (const value of [0, 9, 241, 30.5, '30']) expect((await request('PATCH', { budgetMinutes: value })).status).toBe(400);
    expect((await request('PATCH', { budgetMinutes: 60 })).body.budgetMinutes).toBe(60);
    expect(data.get(DAILY_PLAN_SETTINGS_KEY)).toEqual({ budgetMinutes: 60 });
    expect((await request('PATCH', { budgetMinutes: null, availabilityProfile: 'evening' })).status).toBe(200);
    expect(data.get(DAILY_PLAN_SETTINGS_KEY)).toEqual({ budgetMinutes: null, availabilityProfile: 'evening' });
    expect((await request('PATCH', { budgetMinutes: null, availabilityProfile: 'bad' })).status).toBe(400);
    auth.ok = false;
    expect((await request('PATCH', { budgetMinutes: 90 })).status).toBe(401);
    expect(data.get(DAILY_PLAN_SETTINGS_KEY)).toEqual({ budgetMinutes: null, availabilityProfile: 'evening' });
  });
  it('只有写入成功才发布新的每日安排，失败保留旧摘要', async () => {
    expect((await request('POST')).status).toBe(200);
    const old = data.get(DAILY_PLAN_KEY).summary;
    const oldBriefing = data.get(DAILY_PLAN_KEY).briefing;
    data.get(DAILY_PLAN_KEY).summary = { ...old, todayCount: 7 };
    failWrite.value = true;
    expect((await request('POST')).status).toBe(502);
    expect(data.get(DAILY_PLAN_KEY).summary.todayCount).toBe(7);
    expect(data.get(DAILY_PLAN_KEY).briefing).toEqual(oldBriefing);
  });
  it('历史读取失败时不发布空计划、不推进历史时间', async () => {
    await request('POST');
    const before = structuredClone(data.get(DAILY_PLAN_KEY));
    failHistory.value = true;
    expect((await request('POST')).status).toBe(502);
    expect(data.get(DAILY_PLAN_KEY)).toEqual(before);
  });
});
