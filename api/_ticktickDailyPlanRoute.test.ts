import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import handler from './ticktick-trips';
import type { TickTickTask } from './_ticktickTrips';
import { DAILY_PLAN_KEY, DAILY_PLAN_SETTINGS_KEY } from './_ticktickDailyPlan';
import * as laundryModule from './_ticktickLaundry';
import * as chargingModule from './_outlookCharging';
import * as hairWashModule from './_outlookHairWash';
import { schedulingStage } from './_schedulingFailure';
const { replan, planDetails } = vi.hoisted(() => ({ replan: vi.fn(), planDetails: vi.fn() }));
const { sourceTasks, taskWrite } = vi.hoisted(() => ({ sourceTasks: { value: [] as TickTickTask[] }, taskWrite: vi.fn() }));
const { completedTasks, periodPrediction } = vi.hoisted(() => ({ completedTasks: { value: [] as TickTickTask[] }, periodPrediction: vi.fn() }));
const { archiveDone, outlookSync } = vi.hoisted(() => ({ archiveDone: vi.fn(), outlookSync: vi.fn() }));
vi.mock('./_lifeDone.js', async original => ({
  ...await original<typeof import('./_lifeDone')>(), syncRecentLifeDone: archiveDone,
}));
vi.mock('./_ticktickReplan.js', () => ({ replanRemainingToday: replan }));
vi.mock('./_ticktickPlanDetails.js', () => ({ readTickTickPlanDetails: planDetails }));
const { data, auth, failHistory, failWrite, sleepTags, briefing, syncTraining, sendEmail, routineOptions } = vi.hoisted(() => ({ data: new Map<string, any>(), auth: { ok: true }, failHistory: { value: false }, failWrite: { value: false }, sleepTags: vi.fn(), briefing: vi.fn(), syncTraining: vi.fn(), sendEmail: vi.fn(), routineOptions: { value: null as any } }));
vi.mock('./_dailyEmail.js', () => ({ sendDailyEmail: sendEmail }));
vi.mock('./_dailyBriefing.js', () => ({ readDailyBriefing: briefing, renderDailyBriefing: () => '<html>每日简报</html>' }));
vi.mock('./_lifeTraining.js', () => ({ syncTrainingSource: syncTraining }));
vi.mock('./_auth.js', () => ({ authOk: async () => auth.ok }));
vi.mock('./_outlookSync.js', () => ({ syncOutlookCalendar: outlookSync }));
vi.mock('./_ticktickSleepTags.js', () => ({ syncSleepRoutineTags: sleepTags }));
vi.mock('./_lifeSwimming.js', () => ({ syncSwimmingSchedule: async () => undefined }));
vi.mock('./_ticktickPeriodPrediction.js', () => ({ syncPeriodPredictionTask: periodPrediction }));
vi.mock('./_ticktickLock.js', () => ({ acquireTickTickLock: async () => 'lock', releaseTickTickLock: async () => undefined }));
vi.mock('@vercel/kv', () => ({ kv: { get: async (key: string) => structuredClone(data.get(key) ?? null),
  set: async (key: string, value: unknown) => { data.set(key, structuredClone(value)); return 'OK'; } } }));
vi.mock('./_ticktickTrips.js', async (original) => ({
  ...await original<typeof import('./_ticktickTrips')>(),
  decryptTickTickToken: () => 'test-token',
  TickTickOpenApiClient: class {
    async listCompletedTasks() { if (failHistory.value) throw new Error('history unavailable'); return completedTasks.value; }
    async getTask(_project: string, id: string) { return structuredClone(sourceTasks.value.find(task => task.id === id)); }
    updateTask = taskWrite;
  },
  readAllTickTickTasks: async () => structuredClone(sourceTasks.value),
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
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-24T05:01:00+08:00'));
  archiveDone.mockReset().mockResolvedValue(undefined);
  outlookSync.mockReset().mockResolvedValue({ connected: true,
    availability: { startDate: '2020-01-01', endDate: '2030-01-01', events: [] } });
  completedTasks.value = []; periodPrediction.mockReset().mockResolvedValue({ updated: 0, created: 0 });
  sourceTasks.value = []; taskWrite.mockReset().mockImplementation(async (id, payload) => {
    const task = sourceTasks.value.find(task => task.id === id)!;
    Object.assign(task, payload); return structuredClone(task);
  });
  briefing.mockReset().mockResolvedValue({}); syncTraining.mockReset().mockResolvedValue({});
  sendEmail.mockReset().mockResolvedValue({ sent: true, duplicate: false });
  sleepTags.mockResolvedValue({ mode: 'restore', updated: 0, remaining: 0, complete: true });
  data.set('ticktick:connection:v1', { encryptedToken: {} }); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
describe('每日安排接口', () => {
  it('完整同步在场景排期后把最终待办与完成历史交给洗头日程同步', async () => {
    sourceTasks.value = [{ id: 'hair', projectId: 'life', title: '洗头', status: 0,
      isAllDay: true, dueDate: '2026-10-25T00:00:00+0800', tags: ['routine', 'bon-hidden'] }];
    completedTasks.value = [{ ...sourceTasks.value[0], id: 'previous', status: 2, completedTime: '2026-10-23T13:00:00Z' }];
    const sync = vi.spyOn(hairWashModule, 'syncHairWashOutlook').mockImplementation(async (_api, options) => {
      expect(routineOptions.value).toBeTruthy();
      expect(options.tasks).toEqual(sourceTasks.value);
      expect(options.history).toEqual([expect.objectContaining({ id: 'previous', completedTime: '2026-10-23T13:00:00Z' })]);
      expect(options.excludedTaskIds).toBeInstanceOf(Set);
      return { enabled: true, created: 1, updated: 0 };
    });
    expect(await request('POST')).toMatchObject({ status: 200, body: { hairWash: { outlook: { created: 1 } } } });
    expect(sync).toHaveBeenCalledTimes(1);
  });
  it('完整同步在普通排期后把当前待办和完成记录交给充电日程同步', async () => {
    const charging = vi.spyOn(chargingModule, 'syncChargingOutlook').mockResolvedValue({ enabled: true, created: 1, updated: 0 });
    sourceTasks.value = [{ id: 'charge', projectId: 'life', title: '电动车充电', status: 0, priority: 5,
      isAllDay: true, dueDate: '2026-10-21T00:00:00+0800' }];
    expect(await request('POST')).toMatchObject({ status: 200, body: { charging: { outlook: { created: 1 } } } });
    expect(charging).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      tasks: [expect.objectContaining({ id: 'charge', dueDate: '2026-10-21T00:00:00+0800' })],
      excludedTaskIds: expect.any(Set), history: [],
    }));
    expect(routineOptions.value).toBeTruthy();
  });
  it('后台历史读取失败可重试，保留旧计划并只记录脱敏阶段', async () => {
    vi.stubEnv('CRON_SECRET', 'cron-secret');
    await request('POST');
    const previous = structuredClone(data.get(DAILY_PLAN_KEY));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    failHistory.value = true;
    expect(await request('GET', undefined, undefined, undefined, 'Bearer cron-secret')).toMatchObject({
      status: 502, body: { failure: { stage: 'completion-history', retryable: true } },
    });
    expect(data.get(DAILY_PLAN_KEY)).toEqual(previous);
    expect(log.mock.calls).toEqual([['[ticktick-sync-failure]', '{"stage":"completion-history","retryable":true}']]);
    failHistory.value = false;
    expect((await request('GET', undefined, undefined, undefined, 'Bearer cron-secret')).status).toBe(200);
  });
  it('Outlook 读取失败返回可重试阶段，日志不泄露订阅信息', async () => {
    vi.stubEnv('CRON_SECRET', 'cron-secret');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    outlookSync.mockRejectedValueOnce(new Error('private subscription URL'));
    expect(await request('GET', undefined, undefined, undefined, 'Bearer cron-secret')).toMatchObject({
      status: 502, body: { failure: { stage: 'outlook-refresh', retryable: true } },
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain('private subscription');
    expect(data.has(DAILY_PLAN_KEY)).toBe(false);
  });
  it('完成归档失败即使排程已成功仍报失败，并可安全重试归档', async () => {
    vi.stubEnv('CRON_SECRET', 'cron-secret');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    archiveDone.mockRejectedValueOnce(new Error('private archive failure'));
    expect(await request('GET', undefined, undefined, undefined, 'Bearer cron-secret')).toMatchObject({
      status: 502, body: { dailyPlan: expect.any(Object), failure: { stage: 'completion-archive', retryable: true } },
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });
  it('写入与收尾失败不允许自动重放，收尾失败优先阻止读取失败重试', async () => {
    vi.stubEnv('CRON_SECRET', 'cron-secret');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    failWrite.value = true;
    expect(await request('GET', undefined, undefined, undefined, 'Bearer cron-secret')).toMatchObject({
      status: 502, body: { failure: { stage: 'planning', retryable: false } },
    });
    failWrite.value = false; failHistory.value = true;
    syncTraining.mockRejectedValueOnce(new Error('write result unknown'));
    expect(await request('GET', undefined, undefined, undefined, 'Bearer cron-secret')).toMatchObject({
      status: 502, body: { failure: { stage: 'finalize', retryable: false } },
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });
  it('完整同步把本轮读取的完成历史传入月经提醒去重', async () => {
    completedTasks.value = [{ id: 'done', projectId: 'life', title: '月经提醒', status: 2,
      completedTime: new Date(Date.now() - 60_000).toISOString(), dueDate: '2026-10-11T00:00:00+0800' }];
    expect((await request('POST')).status).toBe(200);
    expect(periodPrediction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      completedTasks: [expect.objectContaining({ id: 'done', status: 2 })],
    }));
    failHistory.value = true;
    periodPrediction.mockClear();
    expect((await request('POST')).status).toBe(502);
    expect(periodPrediction).not.toHaveBeenCalled();
  });
  it('完整同步保留用户的 routine 标签选择，不再补回晨间与午饭任务的标签', async () => {
    sourceTasks.value = ['晨间routine', '🏫吃午饭了', '🏠吃午饭了'].flatMap((title, index) => [
      { id: `without-${index}`, projectId: 'life', title, status: 0, isAllDay: true, tags: ['活'] },
      { id: `with-${index}`, projectId: 'life', title, status: 0, isAllDay: true, tags: ['活', 'routine'] },
    ]);
    const original = structuredClone(sourceTasks.value);
    expect((await request('POST')).status).toBe(200);
    expect(taskWrite).not.toHaveBeenCalled();
    expect(sourceTasks.value).toEqual(original);
  });
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
  it('每小时重排仅接受定时密钥 GET，复用限定重排且不触发邮件或综合同步', async () => {
    vi.stubEnv('CRON_SECRET', 'cron-secret');
    replan.mockReset().mockResolvedValue({ busy: false, dailyPlan: { date: '2026-10-05', todayCount: 2 } });
    auth.ok = false;
    expect((await request('GET', undefined, 'hourly-replan', undefined, 'Bearer wrong')).status).toBe(401);
    auth.ok = true;
    expect((await request('GET', undefined, 'hourly-replan')).status).toBe(403);
    expect((await request('POST', undefined, 'hourly-replan', undefined, 'Bearer cron-secret')).status).toBe(403);
    expect(replan).not.toHaveBeenCalled();
    auth.ok = false;
    expect(await request('GET', undefined, 'hourly-replan', undefined, 'Bearer cron-secret')).toMatchObject({
      status: 200, body: { ok: true, dailyPlan: { todayCount: 2 } },
    });
    expect(replan).toHaveBeenCalledWith({ scheduled: true });
    replan.mockResolvedValueOnce({ busy: true });
    expect(await request('GET', undefined, 'hourly-replan', undefined, 'Bearer cron-secret')).toMatchObject({
      status: 200, body: { ok: true, busy: false, deferred: true, dailyPlan: { deferred: true } },
    });
    replan.mockResolvedValueOnce({ busy: false, skipped: 'sleep-window' });
    expect(await request('GET', undefined, 'hourly-replan', undefined, 'Bearer cron-secret')).toMatchObject({
      status: 200, body: { ok: true, skipped: 'sleep-window' },
    });
    expect(sleepTags).not.toHaveBeenCalled(); expect(syncTraining).not.toHaveBeenCalled(); expect(sendEmail).not.toHaveBeenCalled();
  });
  it.each([['outlook-refresh', true], ['timed-visibility', false], ['planning', false]] as const)(
    '小时重排透传 %s 失败阶段，公共日志不输出原始错误', async (stage, retryable) => {
      vi.stubEnv('CRON_SECRET', 'cron-secret');
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      replan.mockReset().mockImplementation(() => schedulingStage(stage, retryable, async () => {
        throw new Error('private provider response');
      }));
      expect(await request('GET', undefined, 'hourly-replan', undefined, 'Bearer cron-secret')).toMatchObject({
        status: 502, body: { failure: { stage, retryable } },
      });
      expect(log.mock.calls).toEqual([['[ticktick-sync-failure]', JSON.stringify({ stage, retryable })]]);
      expect(sendEmail).not.toHaveBeenCalled();
    },
  );
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
    for (const [hour, minutes] of [[5, 480], [12, 360], [17, 180], [20, 120], [23, 0]]) {
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

vi.mock('./_accountRoute.js', () => ({ withAccountScope: (handler: unknown) => handler }));
