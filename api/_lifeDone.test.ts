import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectCompleted, completedItems, DONE_PROJECT_NAMES_KEY, doneKey, doneMonth, doneSyncKey, readDoneMonth, syncDoneMonth, syncRecentLifeDone } from './_lifeDone';
import { encryptTickTickToken, TICKTICK_CONNECTION_KEY } from './_ticktickTrips';
import { encryptOutlookConnection } from './_outlookCalendar';
import { OUTLOOK_CONNECTION_KEY } from './_outlookSync';
import { outlookDoneKey } from './_lifeDoneOutlook';
import { DEFAULT_OUTLOOK_RULES } from '../src/utils/outlookCalendar';

const { data, evalMock } = vi.hoisted(() => ({ data: new Map<string, any>(), evalMock: vi.fn() }));
vi.mock('@vercel/kv', () => ({ kv: {
  get: async (key: string) => data.get(key) ?? null,
  hgetall: async (key: string) => data.get(key) ?? null,
  eval: evalMock,
} }));
const now = new Date('2026-10-04T10:00:00Z');
const task = (id = 'task', completedTime = '2026-10-04T09:00:00Z') => ({ id, projectId: 'inbox-real', title: '完成任务', status: 2, completedTime });
beforeEach(() => {
  data.clear(); vi.clearAllMocks(); vi.stubEnv('SYNC_SECRET', 'secret');
  data.set(TICKTICK_CONNECTION_KEY, { encryptedToken: encryptTickTickToken('private-token', 'secret') });
  evalMock.mockImplementation(async (_script, keys, args) => {
    if (keys[0] === OUTLOOK_CONNECTION_KEY) { data.set(keys[1], JSON.parse(args[2])); return 1; }
    data.set(keys[1], { ...data.get(keys[1]), ...Object.fromEntries(JSON.parse(args[1]).map((item: any) => [item.id, item])) });
    data.set(keys[2], args[2]);
    data.set(keys[3], { ...data.get(keys[3]), ...JSON.parse(args[3]) }); return 1;
  });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/project')) return new Response(JSON.stringify([{ id: 'work', name: '工作' }]));
    if (url.endsWith('/data')) return new Response(JSON.stringify({ project: { id: 'inbox-real' }, tasks: [] }));
    return new Response(JSON.stringify([task()]));
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('TickTick DoneList', () => {
  it('归档任务描述、标题与标签的标注时长，不从勾选间隔或计划区间推算', () => {
    const items = completedItems([
      { ...task('a'), content: '(30m)', title: '阅读(2h)' },
      { ...task('b'), title: '学习(1.5h)' },
      { ...task('c'), tags: ['(5m)'] },
      { ...task('unknown'), isAllDay: false, startDate: '2026-10-04T00:00:00Z', dueDate: '2026-10-04T10:00:00Z' },
    ], '2026-10-01', '2026-10-04');
    expect(items.map(item => [item.durationMinutes, item.durationBasis])).toEqual([[30, 'task'], [90, 'task'], [5, 'task'], [15, 'default']]);
    expect(items.every(item => item.source === 'ticktick')).toBe(true);
  });
  it('旧记录触发时长补同步，描述省略保留已归档标注，明确清空则改为默认', async () => {
    const original = completedItems([task()], '2026-10-01', '2026-10-04')[0];
    const { durationMinutes: _minutes, durationBasis: _basis, ...legacy } = original;
    data.set(doneKey('2026-10'), { [original.id]: legacy });
    expect((await readDoneMonth('2026-10')).needsDurationSync).toBe(true);
    const originalFetch = fetch;
    const setContent = (content: string | undefined) => vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => String(url).endsWith('/task/completed')
      ? new Response(JSON.stringify([{ ...task(), ...(content !== undefined ? { content } : {}) }])) : originalFetch(url, options)));
    setContent('(1.5h)');
    expect(await syncDoneMonth('2026-10', now)).toMatchObject({ needsDurationSync: false, items: [expect.objectContaining({ durationMinutes: 90 })] });
    setContent(undefined);
    expect((await syncDoneMonth('2026-10', now)).items[0].durationMinutes).toBe(90);
    setContent('');
    expect((await syncDoneMonth('2026-10', now)).items[0]).toMatchObject({ durationMinutes: 15, durationBasis: 'default' });
  });
  it('合并 Outlook 后同一天的重复项仅保留 TickTick 标注时长，同步支持仅连接 Outlook', async () => {
    const url = 'https://outlook.live.com/owa/calendar/private/published/calendar.ics';
    data.set(OUTLOOK_CONNECTION_KEY, { id: 'outlook', encrypted: encryptOutlookConnection({ playUrl: url, classUrl: '',
      sources: [], policy: 'manual', rules: DEFAULT_OUTLOOK_RULES }, 'secret') });
    const originalFetch = fetch;
    vi.stubGlobal('fetch', vi.fn(async (request: string, options?: RequestInit) => request === url
      ? new Response('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:done\r\nDTSTART:20261004T080000Z\r\nDTEND:20261004T090000Z\r\nSUMMARY:完成任务\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n')
      : String(request).endsWith('/task/completed') ? new Response(JSON.stringify([{ ...task(), content: '(30m)' }])) : originalFetch(request, options)));
    const result = await syncDoneMonth('2026-10', now);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ source: 'ticktick', durationMinutes: 30 });
    expect(result).toMatchObject({ outlookConnected: true, outlookSyncedAt: now.toISOString() });
    expect(data.get(outlookDoneKey('2026-10')).items).toHaveLength(1);
    data.delete(TICKTICK_CONNECTION_KEY); data.delete(doneKey('2026-10'));
    const outlookOnly = await syncDoneMonth('2026-10', now);
    expect(outlookOnly.items[0]).toMatchObject({ source: 'outlook', durationMinutes: 60 });
    expect(outlookOnly.connected).toBe(false);
  });
  it('Outlook 失败不阻止 TickTick 更新，单独返回可重试的来源错误', async () => {
    data.set(OUTLOOK_CONNECTION_KEY, { id: 'invalid', encrypted: 'invalid' });
    const result = await syncDoneMonth('2026-10', now);
    expect(result.items).toHaveLength(1);
    expect(result.syncedAt).toBe(now.toISOString());
    expect(result.outlookError).toBe('Outlook 日程同步失败，已保留历史，请重试');
  });
  it('保存标签优先的分类和清单名称，不根据标题猜测', () => {
    const items = completedItems([
      { ...task('tagged'), projectId: 'play', tags: ['活'], title: '运动' },
      { ...task('project'), projectId: 'study', tags: ['当天'] },
      { ...task('unknown'), title: '上课学习' },
    ], '2026-10-01', '2026-10-04', { play: '玩', study: '课' });
    expect(items.map((item) => item.category)).toEqual(['活', '课', '未分类']);
    expect(items[0].projectName).toBe('玩');
  });
  it('历史快照缺少分类时用已知清单补齐，已有标签分类保持不变', async () => {
    const old = { ...task(), id: 'old', taskId: 'old', projectId: 'play', date: '2026-10-03', completedAt: '2026-10-03T09:00:00Z' };
    data.set(doneKey('2026-10'), { old, tagged: { ...old, id: 'tagged', category: '活' } });
    data.set(DONE_PROJECT_NAMES_KEY, { play: '玩' });
    const result = await readDoneMonth('2026-10');
    expect(result.items.map((item) => item.category)).toEqual(['玩', '活']);
    expect(result.items.every((item) => item.projectName === '玩')).toBe(true);
  });
  it('按上海完成日期归档，同一实例去重，保留重复任务的多次完成', () => {
    const items = completedItems([task(), task(), task('task', '2026-10-03T15:59:59Z'), task('task', '2026-10-03T16:00:00Z')], '2026-10-03', '2026-10-04');
    expect(items).toHaveLength(3);
    expect(items.map((item) => item.date)).toEqual(['2026-10-04', '2026-10-03', '2026-10-04']);
    expect(completedItems([task()], '2026-10-01', '2026-10-03')).toEqual([]);
    expect(() => completedItems([task('task', 'invalid')], '2026-10-01', '2026-10-04')).toThrow();
  });
  it('密集结果拆分时间范围，防止完成接口截断；错误不伪装为空', async () => {
    const api = { listCompletedTasks: vi.fn().mockResolvedValueOnce(Array.from({ length: 50 }, (_, i) => task(String(i))))
      .mockResolvedValueOnce([task('left')]).mockResolvedValueOnce([task('right')]) };
    expect(await collectCompleted(api, ['inbox'], 0, 10000, Date.now() + 1000)).toEqual([task('left'), task('right')]);
    expect(api.listCompletedTasks.mock.calls[1].slice(1)).toEqual([new Date(0).toISOString(), new Date(5000).toISOString()]);
    expect(api.listCompletedTasks.mock.calls[2][1]).toBe(new Date(5001).toISOString());
    api.listCompletedTasks.mockResolvedValueOnce({ error: 'bad payload' });
    await expect(collectCompleted(api, [], 0, 10000, Date.now() + 1000)).rejects.toThrow();
  });
  it('同步包含全部清单与空收集箱，重复拉取不重复，历史保留', async () => {
    const old = completedItems([task('old', '2026-10-01T09:00:00Z')], '2026-10-01', '2026-10-04')[0];
    data.set(doneKey('2026-10'), { [old.id]: old });
    const result = await syncDoneMonth('2026-10', now);
    expect(result.items).toHaveLength(2); expect(result.syncedAt).toBe(now.toISOString());
    expect((await syncDoneMonth('2026-10', now)).items).toHaveLength(2);
    const calls = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/task/completed'));
    expect(JSON.parse(calls[0][1]?.body as string).projectIds).toEqual(['work', 'inbox-real']);
    expect(calls.every(([, init]) => init?.method === 'POST')).toBe(true);
  });
  it('旧历史要求补同步标签，原地补齐 routine 标签且保留归档；移除标签可恢复显示', async () => {
    const original = completedItems([task()], '2026-10-01', '2026-10-04')[0];
    const { tags: _tags, ...legacy } = original;
    data.set(doneKey('2026-10'), { [original.id]: legacy });
    data.set(doneSyncKey('2026-10'), now.toISOString());
    expect((await readDoneMonth('2026-10')).needsTagSync).toBe(true);
    const originalFetch = fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => String(url).endsWith('/task/completed')
      ? new Response(JSON.stringify([{ ...task(), tags: ['routine', '活'] }])) : originalFetch(url, options)));
    const result = await syncDoneMonth('2026-10', now);
    expect(result.needsTagSync).toBe(false);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ id: original.id, tags: ['routine', '活'], category: '活' });
    expect(data.get(doneKey('2026-10'))[original.id].tags).toEqual(['routine', '活']);
    vi.stubGlobal('fetch', originalFetch);
    expect((await syncDoneMonth('2026-10', now)).items[0].tags).toEqual([]);
  });
  it('接口失败保留旧记录与同步时间，不暴露令牌；断开后历史可读', async () => {
    const old = completedItems([task()], '2026-10-01', '2026-10-04')[0];
    data.set(doneKey('2026-10'), { [old.id]: old }); data.set(doneSyncKey('2026-10'), 'old-sync');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('private-token'); }));
    await expect(syncDoneMonth('2026-10', now)).rejects.toThrow('已保留历史');
    expect(evalMock).not.toHaveBeenCalled(); expect((await readDoneMonth('2026-10')).syncedAt).toBe('old-sync');
    data.delete(TICKTICK_CONNECTION_KEY);
    expect(await readDoneMonth('2026-10')).toMatchObject({ connected: false, items: [old] });
  });
  it('校验月份、不查询未来，跨年定时补存前一天', async () => {
    expect(doneMonth('2026', '2')).toBe('2026-02');
    for (const month of [0, 13, '2x']) expect(() => doneMonth(2026, month)).toThrow();
    await syncDoneMonth('2026-11', now); expect(fetch).not.toHaveBeenCalled();
    await syncRecentLifeDone(new Date('2027-01-01T01:20:00Z'));
    expect(evalMock.mock.calls.map((call) => call[1][1])).toEqual([doneKey('2026-12'), doneKey('2027-01')]);
  });
});
