import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { outlookDoneItems, outlookDoneKey, readOutlookDoneMonth, syncOutlookDoneMonth } from './_lifeDoneOutlook';
import { encryptOutlookConnection } from './_outlookCalendar';
import { OUTLOOK_CONNECTION_KEY } from './_outlookSync';
import { DEFAULT_OUTLOOK_RULES, type OutlookDayEvent } from '../src/utils/outlookCalendar';

const { data, save } = vi.hoisted(() => ({ data: new Map<string, any>(), save: vi.fn() }));
vi.mock('@vercel/kv', () => ({ kv: { get: async (key: string) => data.get(key) ?? null, eval: save } }));
const now = new Date('2026-10-04T10:00:00Z');
const url = 'https://outlook.live.com/owa/calendar/private/published/calendar.ics';
const event = (fields: Partial<OutlookDayEvent> = {}): OutlookDayEvent => ({ uid: 'event', title: '阅读', calendar: 'class',
  startDate: '2026-10-04T01:00:00Z', endDate: '2026-10-04T02:30:00Z', allDay: false, ...fields });
const ics = (properties = '') => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//test//EN\r\nBEGIN:VEVENT\r\nUID:event\r\nDTSTART:20261004T010000Z\r\nDTEND:20261004T023000Z\r\nSUMMARY:阅读\r\n${properties}END:VEVENT\r\nEND:VCALENDAR\r\n`;
beforeEach(() => {
  data.clear(); vi.clearAllMocks(); vi.stubEnv('SYNC_SECRET', 'secret');
  data.set(OUTLOOK_CONNECTION_KEY, { id: 'connection', encrypted: encryptOutlookConnection({ playUrl: '', classUrl: url,
    sources: [], policy: 'manual', rules: DEFAULT_OUTLOOK_RULES }, 'secret') });
  save.mockImplementation(async (_script, keys, args) => { data.set(keys[1], JSON.parse(args[2])); return 1; });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(ics())));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('Outlook 完成记录', () => {
  it('使用具体起止时间计算分钟，并保留来源分类与任务关联', () => {
    const items = outlookDoneItems([event({ taskLink: { taskId: 'task', projectId: 'life' } })], '2026-10', '课', 'connection', now);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ source: 'outlook', durationMinutes: 90, durationBasis: 'outlook', category: '课',
      date: '2026-10-04', startedAt: '2026-10-04T01:00:00.000Z', linkedTaskId: 'task', linkedProjectId: 'life' });
    expect(outlookDoneItems([event({ calendar: 'work' })], '2026-10', '干', 'connection', now)[0].category).toBe('活');
  });
  it('按上海午夜拆分跨月时段，各月面积只计自己的分钟数', () => {
    const night = event({ startDate: '2026-09-30T15:30:00Z', endDate: '2026-09-30T16:30:00Z' });
    const september = outlookDoneItems([night], '2026-09', '玩', 'connection', now);
    const october = outlookDoneItems([night], '2026-10', '玩', 'connection', now);
    expect(september.map(item => [item.date, item.durationMinutes])).toEqual([['2026-09-30', 30]]);
    expect(october.map(item => [item.date, item.durationMinutes])).toEqual([['2026-10-01', 30]]);
    expect(september[0].id).not.toBe(october[0].id);
  });
  it('排除全天、取消、未来、进行中、无效时间，保留恰好结束的日程和循环实例', () => {
    const events = [event({ allDay: true }), event({ cancelled: true }), event({ endDate: 'invalid' }),
      event({ endDate: '2026-10-05T02:30:00Z' }), event({ endDate: now.toISOString() }),
      event({ startDate: '2026-10-03T01:00:00Z', endDate: '2026-10-03T02:30:00Z' })];
    expect(outlookDoneItems(events, '2026-10', '课', 'connection', now).map(item => item.date)).toEqual(['2026-10-04', '2026-10-03']);
  });
  it('完整刷新按月替换快照，后续取消记录不残留，订阅链接不进入快照', async () => {
    await syncOutlookDoneMonth('2026-10', now);
    expect((await readOutlookDoneMonth('2026-10')).items[0].durationMinutes).toBe(90);
    expect(JSON.stringify(data.get(outlookDoneKey('2026-10')))).not.toContain(url);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(ics('STATUS:CANCELLED\r\n'))));
    await syncOutlookDoneMonth('2026-10', now);
    expect(await readOutlookDoneMonth('2026-10')).toMatchObject({ items: [], outlookConnected: true, outlookSyncedAt: now.toISOString() });
  });
  it('订阅读取失败不覆盖历史，错误不泄漏私人订阅地址', async () => {
    await syncOutlookDoneMonth('2026-10', now);
    const previous = data.get(outlookDoneKey('2026-10'));
    save.mockClear();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error(url); }));
    await expect(syncOutlookDoneMonth('2026-10', now)).rejects.toThrow('Outlook 日程同步失败，已保留历史，请重试');
    expect(save).not.toHaveBeenCalled();
    expect(data.get(outlookDoneKey('2026-10'))).toEqual(previous);
  });
  it('连接替换后不混入旧账号，提交时检测连接变更；断开连接仍可读归档', async () => {
    await syncOutlookDoneMonth('2026-10', now);
    const connection = data.get(OUTLOOK_CONNECTION_KEY);
    data.set(OUTLOOK_CONNECTION_KEY, { ...connection, id: 'replacement' });
    expect((await readOutlookDoneMonth('2026-10')).items).toEqual([]);
    save.mockResolvedValueOnce(0);
    await expect(syncOutlookDoneMonth('2026-10', now)).rejects.toThrow('已保留历史');
    data.delete(OUTLOOK_CONNECTION_KEY);
    expect(await readOutlookDoneMonth('2026-10')).toMatchObject({ outlookConnected: false, items: [expect.objectContaining({ title: '阅读' })] });
  });
  it('未来月份和未连接时不发送订阅读取请求', async () => {
    await syncOutlookDoneMonth('2026-11', now);
    data.delete(OUTLOOK_CONNECTION_KEY);
    await syncOutlookDoneMonth('2026-10', now);
    expect(fetch).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});
