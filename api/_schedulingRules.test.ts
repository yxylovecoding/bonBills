import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultRuleConfig, readRuleConfig } from '../src/utils/schedulingRules';
import { executeRuleGraph, saveSchedulingRules, RULE_CONFIG_KEY } from './_schedulingRules';
import { RuleTaskDraft } from './_ruleTaskDraft';
import { locationTaskHidden, visibilityDecision } from './_taskVisibilityRules';
import type { TickTickApi, TickTickTask } from './_ticktickTrips';

const { data } = vi.hoisted(() => ({ data: new Map<string, unknown>() }));
vi.mock('./_accountKv.js', () => ({ kv: {
  get: async (key: string) => structuredClone(data.get(key) ?? null),
  set: async (key: string, value: unknown, options?: { nx?: boolean }) => { if (options?.nx && data.has(key)) return null; data.set(key, structuredClone(value)); return 'OK'; },
  eval: async (_script: string, [key]: string[]) => { data.delete(key); return 1; },
} }));
beforeEach(() => data.clear());

it('保存配置检查版本，拒绝覆盖其他页面的新配置', async () => {
  const initial = defaultRuleConfig();
  const saved = await saveSchedulingRules(initial);
  expect(saved.version).toBe(1); expect(data.get(RULE_CONFIG_KEY)).toEqual(saved);
  await expect(saveSchedulingRules(initial)).rejects.toThrow('其他页面');
});
it('前序失败跳过传递依赖链，独立分支继续；不执行范围外的依赖', async () => {
  const config = readRuleConfig({ ...defaultRuleConfig(), predecessors: { laundry: ['exercise'], 'daily-plan': ['laundry'] } });
  const ran: string[] = [];
  const run = await executeRuleGraph(config, 'full', {
    exercise: async () => { throw new Error('private upstream body'); },
    laundry: async () => { ran.push('laundry'); }, 'daily-plan': async () => { ran.push('daily'); },
    'visibility-reading': async () => { ran.push('reading'); },
  }, { save: false });
  expect(ran).toEqual(['reading']);
  expect(run.results.find(r => r.id === 'daily-plan')?.status).toBe('skipped');
  expect(JSON.stringify(run)).not.toContain('private upstream');
  const hourly = await executeRuleGraph(config, 'hourly', { 'daily-plan': async () => { ran.push('wrong'); } }, { save: false });
  expect(hourly.results.find(r => r.id === 'daily-plan')?.reason).toContain('前序');
});

const task = (fields: Partial<TickTickTask> = {}): TickTickTask => ({ id: 'one', projectId: 'p', title: '洗衣服', status: 0, dueDate: '2026-11-05T00:00:00+0800',
  tags: ['活', 'routine', '广州'], repeatFlag: 'RRULE:FREQ=DAILY;INTERVAL=5', reminders: ['TRIGGER:PT0S'], ...fields });
function client(original = task()) {
  const tasks = new Map([[original.id, original]]);
  const api = { getTask: vi.fn(async (_project: string, id: string) => structuredClone(tasks.get(id)!)),
    updateTask: vi.fn(async (id: string, payload: Record<string, unknown>) => { tasks.set(id, { ...tasks.get(id)!, ...payload } as TickTickTask); return tasks.get(id)!; }) };
  return { api: api as unknown as TickTickApi, tasks, write: api.updateTask };
}
describe('最终任务改动裁决', () => {
  it.each([['always-today', 'laundry'], ['laundry', 'always-today']] as const)('较高的 %s 决定日期，只写一次并保留其他字段', async (first, second) => {
    const c = client(), draft = new RuleTaskDraft(c.api, [task()]);
    const high = draft.branch(first), low = () => draft.branch(second);
    await high.api.updateTask('one', { dueDate: '2026-11-03T00:00:00+0800' }); high.accept();
    const branch = low(); await branch.api.updateTask('one', { dueDate: '2026-11-08T00:00:00+0800' });
    expect(branch.accept().conflicts[0].winner).toBe(first);
    expect(c.write).not.toHaveBeenCalled(); await draft.commit();
    expect(c.write).toHaveBeenCalledOnce();
    expect(c.tasks.get('one')).toEqual({ ...task(), dueDate: '2026-11-03T00:00:00+0800' });
  });
  it('不改期也能保留高优先级日期，失败分支不接受候选', async () => {
    const c = client(), draft = new RuleTaskDraft(c.api, [task()]);
    const high = draft.branch('laundry'); high.claimDates(['one']); high.accept();
    const low = draft.branch('daily-plan'); await low.api.updateTask('one', { dueDate: '2026-11-03T00:00:00+0800' }); low.accept();
    const failed = draft.branch('exercise'); await failed.api.updateTask('one', { title: '错误改动' });
    await draft.commit(); expect(c.write).not.toHaveBeenCalled();
  });
  it('写前发现并发完成，不重新打开任务', async () => {
    const c = client(), draft = new RuleTaskDraft(c.api, [task()]);
    const branch = draft.branch('laundry'); await branch.api.updateTask('one', { dueDate: '2026-11-08T00:00:00+0800' }); branch.accept();
    c.tasks.get('one')!.status = 2;
    await expect(draft.commit()).rejects.toThrow('已变化'); expect(c.write).not.toHaveBeenCalled();
  });
  it('服务端回读改用 UTC 格式时，确认同一最终日期并允许后序使用', async () => {
    const c = client(), draft = new RuleTaskDraft(c.api, [task()]);
    c.write.mockImplementation(async (id, payload) => {
      c.tasks.set(id, { ...c.tasks.get(id)!, ...payload, dueDate: new Date(payload.dueDate as string).toISOString() });
      return c.tasks.get(id)!;
    });
    const branch = draft.branch('laundry'); await branch.api.updateTask('one', { dueDate: '2026-11-08T00:00:00+0800' }); branch.accept();
    await draft.commit(); expect(draft.datesConfirmed('one')).toBe(true);
  });
  it('生成任务清理前再次检查完成状态，并验证删除结果', async () => {
    const c = client(), draft = new RuleTaskDraft(c.api, [task()]);
    c.api.deleteTask = vi.fn(async (_project, id) => { c.tasks.delete(id); });
    const branch = draft.branch('trips'); await branch.api.deleteTask('p', 'one'); branch.accept();
    await draft.commit(); expect(c.api.deleteTask).toHaveBeenCalledOnce(); expect(draft.committedValues()).toEqual([]);
    const raced = client(), protectedDraft = new RuleTaskDraft(raced.api, [task()]);
    raced.api.deleteTask = vi.fn();
    vi.mocked(raced.api.getTask).mockResolvedValueOnce(task()).mockResolvedValueOnce(task({status:2}));
    const removal = protectedDraft.branch('trips'); await removal.api.deleteTask('p','one'); removal.accept();
    await expect(protectedDraft.commit()).rejects.toThrow('已变化'); expect(raced.api.deleteTask).not.toHaveBeenCalled();
  });
});
describe('地点显隐', () => {
  const locations = { names: ['北京', '广州', '清迈'], today: ['北京'], unknown: false };
  it('城市标签按任一匹配；无城市标签不处理；未知当天地点不误显示', () => {
    expect(locationTaskHidden(task(), locations)).toBe(true);
    expect(locationTaskHidden(task({ tags: ['北京市', '广州'] }), locations)).toBe(false);
    expect(locationTaskHidden(task({ tags: ['活'] }), locations)).toBeNull();
    expect(locationTaskHidden(task({ tags: ['北京'] }), { ...locations, today: [], unknown: true })).toBe(true);
  });
  it('地点与阅读规则分别产生候选，由优先级统一裁决', () => {
    const input = { now: new Date('2026-11-03T20:00:00+0800'), timeZone: 'Asia/Shanghai', locations, journal: {} };
    const reading = task({ title: '阅读' });
    expect(visibilityDecision('visibility-location', reading, input)).toBe(true);
    expect(visibilityDecision('visibility-reading', reading, input)).toBe(false);
  });
});

it('验证前序的写入后才执行后序效果，失败阻断后序但不阻断其他分支', async () => {
  const c = client(), draft = new RuleTaskDraft(c.api, [task()]);
  const branch = draft.branch('always-today'); await branch.api.updateTask('one', { dueDate: '2026-11-03T00:00:00+0800' }); branch.accept();
  const effects: string[] = [], failed = new Set<string>();
  c.write.mockRejectedValueOnce(new Error('unconfirmed'));
  await draft.commit({ order: ['always-today', 'outlook-hair', 'outlook-charging'], allowed: id => !failed.has(id),
    failed: ids => { ids.forEach(id => failed.add(id)); failed.add('outlook-hair'); },
    afterRule: async id => { if (!failed.has(id)) effects.push(id); } });
  expect(effects).toEqual(['outlook-charging']); expect(draft.committedValues()).toEqual([task()]);
});
