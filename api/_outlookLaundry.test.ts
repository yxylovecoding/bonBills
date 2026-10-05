import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { laundryEventPlan, LAUNDRY_EVENT_PROPERTY, syncLaundryOutlook } from './_outlookLaundry';
import { OUTLOOK_WRITE_KEY, sealOutlookWrite } from './_outlookWrite';
import { LAUNDRY_STATE_KEY } from './_ticktickLaundry';
import type { TickTickApi, TickTickTask } from './_ticktickTrips';
const { data } = vi.hoisted(() => ({ data: new Map<string, any>() }));
vi.mock('@vercel/kv', () => ({ kv: {
  get: async (key: string) => structuredClone(data.get(key) ?? null),
  set: async (key: string, value: any, options?: { nx?: boolean }) => { if (options?.nx && data.has(key)) return null; data.set(key, structuredClone(value)); return 'OK'; },
  eval: async (script: string, keys: string[], args: string[]) => { if (data.get(keys[0]) !== args[0]) return 0; if (script.includes("'del'")) data.delete(keys[0]); return 1; },
} }));
let task: TickTickTask;
let events: Map<string, any>;
let writes: { method: string; body: any; headers: any }[];
let loseCreateResponse: boolean;
let rejectPatch: boolean;
const api = { getTask: vi.fn(async () => structuredClone(task)) } as unknown as TickTickApi;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const options = () => ({ tasks: [task], managedTaskIds: new Set(['wash']), ticktickConnectionId: 'tick', today: '2026-10-05',
  configState: { config: { schoolCity: { name: '北京', latitude: 39.9, longitude: 116.4 } } }, plannedDates: { wash: task.startDate!.slice(0, 10) } });
function cycle(completion = '2026-10-05T03:56:00Z') {
  data.set(LAUNDRY_STATE_KEY, { connectionId: 'tick', anchors: { wash: { projectId: 'life', repeatFlag: task.repeatFlag, completion, target: '2026-10-10' } } });
}
beforeEach(() => {
  vi.stubEnv('SYNC_SECRET', 'test'); data.clear(); events = new Map(); writes = []; loseCreateResponse = false; rejectPatch = false;
  task = { id: 'wash', projectId: 'life', title: '洗衣服', status: 0, startDate: '2026-10-08T00:00:00Z', dueDate: '2026-10-08T00:00:00Z',
    isAllDay: false, timeZone: 'Asia/Shanghai', repeatFlag: 'RRULE:FREQ=DAILY;INTERVAL=5', content: '（1h1m）' };
  vi.mocked(api.getTask).mockReset().mockImplementation(async () => structuredClone(task)); cycle();
  data.set(OUTLOOK_WRITE_KEY, { id: 'outlook', clientId: 'app', calendarId: 'calendar', calendarName: '日历',
    encrypted: sealOutlookWrite({ access_token: 'ACCESS', refresh_token: 'REFRESH', expiresAt: Date.now() + 3600000 }) });
  vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input), method = init.method ?? 'GET';
    expect(url.origin).toBe('https://graph.microsoft.com');
    if (method === 'POST') {
      const body = JSON.parse(init.body as string), id = `event-${events.size + 1}`;
      const event = { ...body, id, type: 'singleInstance', '@odata.etag': 'v1' }; events.set(id, event); writes.push({ method, body, headers: init.headers });
      if (loseCreateResponse) { loseCreateResponse = false; throw new TypeError('connection lost after write'); }
      return json(event, 201);
    }
    const id = url.pathname.split('/').at(-1)!;
    if (method === 'PATCH') {
      writes.push({ method, body: JSON.parse(init.body as string), headers: init.headers });
      if (rejectPatch) return json({}, 412);
      const event = { ...events.get(id), ...JSON.parse(init.body as string), '@odata.etag': 'v2' }; events.set(id, event); return json(event);
    }
    if (id === 'events') {
      const key = url.searchParams.get('$filter')?.match(/ep\/value eq '([^']+)'/)?.[1];
      return json({ value: [...events.values()].filter(event => event.singleValueExtendedProperties?.some((p: any) => p.value === key)) });
    }
    return events.has(id) ? json(events.get(id)) : json({}, 404);
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it('采用 TickTick 具体时刻和描述时长；首轮创建、重复同步无重复、改期更新同一条', async () => {
  expect(laundryEventPlan(task, '2026-10-05', '北京')).toMatchObject({ start: { dateTime: '2026-10-08T08:00:00' }, end: { dateTime: '2026-10-08T09:01:00' } });
  expect(await syncLaundryOutlook(api, options())).toMatchObject({ created: 1, updated: 0 });
  expect(writes[0].body).toMatchObject({ subject: '洗衣服', attendees: [], isReminderOn: false, location: { displayName: '北京' } });
  expect(writes[0].body).not.toHaveProperty('recurrence');
  expect(await syncLaundryOutlook(api, options())).toMatchObject({ created: 0, updated: 0 }); expect(writes).toHaveLength(1);
  task.startDate = task.dueDate = '2026-10-09T00:00:00Z';
  expect(await syncLaundryOutlook(api, options())).toMatchObject({ created: 0, updated: 1 });
  expect(events.size).toBe(1); expect(writes[1].headers['If-Match']).toBe('v1');
});
it('创建请求响应丢失后通过稳定标识找回，下一实际完成周期才创建新日程', async () => {
  loseCreateResponse = true;
  expect(await syncLaundryOutlook(api, options())).toHaveProperty('error'); expect(events.size).toBe(1);
  expect(await syncLaundryOutlook(api, options())).toMatchObject({ created: 0, updated: 0 }); expect(writes).toHaveLength(1);
  cycle('2026-10-08T03:00:00Z'); task.startDate = task.dueDate = '2026-10-13T00:00:00Z';
  expect(await syncLaundryOutlook(api, options())).toMatchObject({ created: 1 }); expect(events.size).toBe(2);
});
it('普通同名日程不被认领，已删除的自动日程本周期不再新建', async () => {
  events.set('manual', { id: 'manual', subject: '洗衣服', start: {}, end: {} });
  await syncLaundryOutlook(api, options()); expect(events.has('manual')).toBe(true); expect(events.size).toBe(2);
  events.delete('event-2');
  await syncLaundryOutlook(api, options()); await syncLaundryOutlook(api, options()); expect(writes).toHaveLength(1);
});
it('接管明确关联的已有洗衣事件，保留正文并转换为稳定归属，不重复创建', async () => {
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  const key = hash('tick:life:wash:2026-10-05T03:56:00Z'), url = 'https://ticktick.com/webapp/#p/life/tasks/wash';
  const stateKey = `outlook:laundry-events:v1:${hash('calendar')}`;
  data.set(stateKey, { entries: { [key]: { eventId: 'from-connector', transactionId: key, adoptTaskUrl: url } } });
  const body = { content: `<${url}>\n\n` };
  events.set('from-connector', { id: 'from-connector', subject: '洗衣服', type: 'singleInstance', '@odata.etag': 'v1', attendees: [], body,
    start: { dateTime: '2026-10-08T00:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-10-08T00:15:00.0000000', timeZone: 'UTC' } });
  expect(await syncLaundryOutlook(api, options())).toMatchObject({ created: 0, updated: 1 });
  expect(writes).toHaveLength(1); expect(writes[0].method).toBe('PATCH');
  expect(writes[0].body.singleValueExtendedProperties).toEqual([{ id: LAUNDRY_EVENT_PROPERTY, value: key }]);
  expect(events.get('from-connector').body).toEqual(body);
  expect(data.get(stateKey).entries[key]).not.toHaveProperty('adoptTaskUrl');
  expect(await syncLaundryOutlook(api, options())).toMatchObject({ created: 0, updated: 0 });
  expect(writes).toHaveLength(1);
});
it('参与人、错误归属及日程并发改动时不覆盖或发出邀请', async () => {
  await syncLaundryOutlook(api, options()); const event = events.get('event-1');
  event.attendees = [{ emailAddress: { address: 'someone@example.com' } }]; task.startDate = task.dueDate = '2026-10-09T00:00:00Z';
  expect((await syncLaundryOutlook(api, options())).error).toContain('参与人'); expect(writes).toHaveLength(1);
  event.attendees = []; event.singleValueExtendedProperties = [{ id: LAUNDRY_EVENT_PROPERTY, value: 'someone-else' }];
  expect((await syncLaundryOutlook(api, options())).error).toContain('修改'); expect(writes).toHaveLength(1);
});
it('乐观锁失败保留事件，不自动重放写入', async () => {
  await syncLaundryOutlook(api, options()); rejectPatch = true; task.startDate = task.dueDate = '2026-10-09T00:00:00Z';
  expect((await syncLaundryOutlook(api, options())).error).toContain('412');
  expect(writes).toHaveLength(2); expect(events.get('event-1').start.dateTime).toBe('2026-10-08T08:00:00');
});
it('写入前任务已完成或已改期则不写；未连接和无周期数据不写', async () => {
  const original = options(); task.startDate = task.dueDate = '2026-10-13T00:00:00Z';
  await syncLaundryOutlook(api, original); expect(writes).toHaveLength(0);
  vi.mocked(api.getTask).mockResolvedValueOnce(structuredClone(task)).mockResolvedValueOnce({ ...task, status: 2, completedTime: '2026-10-05T03:00:00Z' });
  await syncLaundryOutlook(api, options()); expect(writes).toHaveLength(0);
  data.delete(LAUNDRY_STATE_KEY); await syncLaundryOutlook(api, options()); expect(writes).toHaveLength(0);
  data.delete(OUTLOOK_WRITE_KEY); expect(await syncLaundryOutlook(api, options())).toMatchObject({ enabled: false });
});
it('只同步管理范围内未完成的洗衣；默认50分钟并拒绝历史日期', () => {
  expect(laundryEventPlan({ ...task, content: undefined }, '2026-10-05')?.end.dateTime).toBe('2026-10-08T08:50:00');
  expect(laundryEventPlan(task, '2026-10-09')).toBeNull();
  expect(laundryEventPlan({ ...task, title: '除螨喷雾' }, '2026-10-05')).toBeNull();
  expect(laundryEventPlan({ ...task, tags: ['不关我事'] }, '2026-10-05')).toBeNull();
});
