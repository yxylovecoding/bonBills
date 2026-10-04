import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readTrainingSource, selectTrainingTasks, syncTrainingSource, trainingTask, TRAINING_SOURCE_KEY } from './_lifeTraining';
import { encryptTickTickToken, TICKTICK_CONNECTION_KEY, type TickTickTask } from './_ticktickTrips';
import { LIFE_SETTINGS_KEY } from './_bonLife';
import { DEFAULT_CYCLE } from '../src/utils/bonLife';
import { afterMenstrualPeriod } from '../src/utils/lifeCycle';

const { data, evalMock } = vi.hoisted(() => ({ data: new Map<string, any>(), evalMock: vi.fn() }));
vi.mock('@vercel/kv', () => ({ kv: {
  get: async (key: string) => data.get(key) ?? null, hgetall: async (key: string) => data.get(key) ?? null, eval: evalMock,
  set: async (key: string, value: unknown, options?: { nx?: boolean }) => {
    if (options?.nx && data.has(key)) return null;
    data.set(key, value); return 'OK';
  },
} }));
const title = '上半身-运动💪🏻是生活的第一个锚点🪝';
const task = (fields: Partial<TickTickTask> = {}): TickTickTask => ({ id: 'upper', projectId: 'play', title, status: 0,
  startDate: '2026-10-08T01:00:00.000+0000', timeZone: 'Asia/Shanghai', repeatFlag: 'RRULE:FREQ=WEEKLY;BYDAY=TH', ...fields });

beforeEach(() => {
  data.clear(); vi.clearAllMocks(); vi.stubEnv('SYNC_SECRET', 'secret');
  data.set(TICKTICK_CONNECTION_KEY, { encryptedToken: encryptTickTickToken('private-token', 'secret') });
  evalMock.mockImplementation(async (_script, keys, args) => {
    if (keys.length === 1) { if (data.get(keys[0]) === args[0]) data.delete(keys[0]); return 1; }
    data.set(keys[1], JSON.parse(args[1])); return 1;
  });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/project')) return new Response(JSON.stringify([{ id: 'play', name: '玩' }]));
    if (url.endsWith('/filter')) return new Response(JSON.stringify([task(), task({ id: 'completed', status: 2 })]));
    if (url.endsWith('/inbox/data')) return new Response(JSON.stringify({ project: { id: 'inbox-real' }, tasks: [] }));
    if (url.endsWith('/play/data')) return new Response(JSON.stringify({ tasks: [task({ content: '轻量哑铃' })] }));
    throw new Error('unexpected request');
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('TickTick 训练来源', () => {
  it('按锚点标题识别，兼容肤色与空格，排除父标题和完成项', () => {
    const result = selectTrainingTasks([task(), task({ id: 'emoji', title: '有氧 - 运动💪是生活的第一个锚点 🪝' }),
      task({ title: '运动💪🏻是生活的第一个锚点🪝' }), task({ title: '健身用品' }), task({ status: 2 }), task({ completedTime: '2026-10-01T00:00:00Z' })]);
    expect(result.map((item) => item.id)).toEqual(['upper', 'emoji']);
  });
  it('保留具体分化、备注和跟练链接；链接去重且不接受脚本协议', () => {
    const result = trainingTask(task({ content: '[视频](https://example.com/workout)\njavascript:alert(1)',
      items: [{ title: 'https://example.com/workout' }, { title: 'https://example.com/second' }] }), 2026);
    expect(result.name).toBe('上半身'); expect(result.schedule).toBe('每周四');
    expect(result.links.map((link) => link.url)).toEqual(['https://example.com/workout', 'https://example.com/second']);
    expect(result.notes).toContain('[视频]');
  });
  it('依据任务时区、每周规则展开，不倒推起始日前的历史', () => {
    const result = trainingTask(task({ startDate: '2026-10-07T16:00:00.000+0000' }), 2026);
    expect(result.dates.slice(0, 3)).toEqual(['2026-10-08', '2026-10-15', '2026-10-22']);
    expect(result.dates.at(-1)).toBe('2026-12-31');
    expect(trainingTask(task(), 2025).dates).toEqual([]);
    expect(trainingTask(task(), 2027).dates[0]).toBe('2027-01-07');
  });
  it('尊重间隔、多个星期、次数和结束日期，不把它们简化为每周', () => {
    expect(trainingTask(task({ repeatFlag: 'FREQ=WEEKLY;INTERVAL=2;COUNT=3;BYDAY=TH' }), 2026).dates)
      .toEqual(['2026-10-08', '2026-10-22', '2026-11-05']);
    expect(trainingTask(task({ repeatFlag: 'FREQ=WEEKLY;BYDAY=TH,SA;UNTIL=20261017' }), 2026).dates)
      .toEqual(['2026-10-08', '2026-10-10', '2026-10-15', '2026-10-17']);
    expect(trainingTask(task({ repeatFlag: undefined }), 2026).dates).toEqual(['2026-10-08']);
    expect(trainingTask(task({ startDate: undefined, dueDate: undefined }), 2026)).toMatchObject({ dates: [], schedule: '未设日期' });
  });
  it('拒绝未知重复规则和非法时区，避免静默排错训练日期', () => {
    for (const repeatFlag of ['FREQ=DAILY;INTERVAL=0', 'FREQ=HOURLY', 'FREQ=WEEKLY;X-CUSTOM=1']) {
      expect(() => trainingTask(task({ repeatFlag }), 2026)).toThrow();
    }
    expect(() => trainingTask(task({ timeZone: 'invalid' }), 2026)).toThrow();
  });
  it('没有经期游泳冲突时只读 TickTick，合并清单详情，保存最小快照', async () => {
    const result = await syncTrainingSource(2026);
    expect(result.tasks).toHaveLength(1); expect(result.tasks[0].notes).toBe('轻量哑铃');
    expect(result.connected).toBe(true); expect(result.syncedAt).toBeTruthy();
    const calls = vi.mocked(fetch).mock.calls;
    expect(calls.every(([url, options]) => !options?.method || (options.method === 'POST' && String(url).endsWith('/task/filter')))).toBe(true);
    expect(calls.some(([url]) => String(url).endsWith('/inbox/data'))).toBe(true);
    expect(JSON.stringify(result)).not.toContain('private-token');
    expect(data.get(TRAINING_SOURCE_KEY).tasks[0].status).toBeUndefined();
  });
  it('同步失败和连接切换时保留原计划，错误中不泄露令牌', async () => {
    await syncTrainingSource(2026);
    const saved = data.get(TRAINING_SOURCE_KEY);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('private-token'); }));
    await expect(syncTrainingSource(2026)).rejects.toThrow('游泳待办顺延失败');
    expect(data.get(TRAINING_SOURCE_KEY)).toEqual(saved);
    data.set(TICKTICK_CONNECTION_KEY, { encryptedToken: encryptTickTickToken('other-token', 'secret') });
    expect((await readTrainingSource(2026)).tasks).toEqual([]);
    data.delete(TICKTICK_CONNECTION_KEY);
    expect(await readTrainingSource(2026)).toMatchObject({ connected: false, tasks: [expect.objectContaining({ name: '上半身' })] });
  });
  it('较新同步或断开连接导致的提交冲突不会报告成功', async () => {
    evalMock.mockResolvedValue(0);
    await expect(syncTrainingSource(2026)).rejects.toThrow('已保留原计划');
  });
  it('未来游泳顺延，重复日期去重且跨年不遗漏；其他训练不受影响', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-01T00:00:00Z'));
    try {
      await syncTrainingSource(2026);
      const snapshot = data.get(TRAINING_SOURCE_KEY);
      const swim = task({ title: '游泳-运动💪🏻是生活的第一个锚点🪝', startDate: '2026-12-29', repeatFlag: 'FREQ=DAILY;INTERVAL=2;COUNT=5' });
      const cycle = { ...DEFAULT_CYCLE, lastPeriodStart: '2026-12-29' };
      data.set(TRAINING_SOURCE_KEY, { ...snapshot, tasks: [swim, task()] });
      data.set(LIFE_SETTINGS_KEY, { cycle });
      const result = await readTrainingSource(2027);
      expect(result.tasks[0].dates).toEqual(['2027-01-05', '2027-01-06']);
      expect((await readTrainingSource(2026)).tasks[0].dates).toEqual([]);
      expect(trainingTask(swim, 2027, (date) => afterMenstrualPeriod(date, cycle, [])).dates).toEqual(result.tasks[0].dates);
      expect((await readTrainingSource(2026)).tasks[1].dates).toContain('2026-12-31');
    } finally { vi.useRealTimers(); }
  });
});
