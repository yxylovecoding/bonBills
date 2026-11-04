import { beforeEach, expect, it, vi } from 'vitest';
import { syncTickTickTemplates, templatePairs, movingDepartureDate } from './_ticktickTemplateSync';
import { RuleTaskDraft } from './_ruleTaskDraft';
import type { TickTickTask, TickTickOpenApiClient } from './_ticktickTrips';
const m = vi.hoisted(() => ({ tasks: [] as TickTickTask[], saved: new Map<string, unknown>() }));
vi.mock('./_accountKv.js', () => ({ kv: { get: async (k: string) => structuredClone(m.saved.get(k)), set: async (k: string, v: unknown) => { m.saved.set(k, structuredClone(v)); } } }));
vi.mock('./_ticktickTrips.js', async original => ({ ...await original<typeof import('./_ticktickTrips')>(), readAllTickTickTasks: async () => structuredClone(m.tasks) }));
const titles = ['🪥漱', '🧴护', '💄妆', '🛀浴', '📷相机', '🧥', '随身背包', '⚪️小袋子', '⚫️小袋子', '【⚪️】'];
const make = (id: string, title: string, parentId?: string): TickTickTask => ({ id, title, projectId: 'p', parentId, content: 'same', tags: ['routine'], dueDate: '2026-11-04', items: [{ id: `${id}-item`, title: '牙刷', status: 1 }] });
const getTask = vi.fn(async (_p: string, id: string) => structuredClone(m.tasks.find(t => t.id === id)!));
const updateTask = vi.fn(async (id: string, payload: any) => { Object.assign(m.tasks.find(t => t.id === id)!, payload); return payload; });
const createTask = vi.fn(async (payload: any) => { const task = { ...payload, id: `created-${m.tasks.length}`, status: 0 }; m.tasks.push(task); return task; });
const api = { getTask, updateTask, createTask } as unknown as TickTickOpenApiClient;
beforeEach(() => { m.saved.clear(); vi.clearAllMocks(); m.tasks = [make('travel', '出门todo模板'), make('move', '搬家模板'), make('a', '出门前一天', 'travel'), make('b', '出门前三天', 'move'), ...titles.flatMap((title, i) => [make(`a${i}`, `🧳${title}`, 'a'), make(`b${i}`, i === 9 ? '📦' : `📦${title}`, 'b')])]; });
it('matches ten second-level pairs including the special container pair and ignores copies', () => {
  m.tasks.push(make('copy', '🧳🪥漱', 'other'));
  const pairs = templatePairs(m.tasks, 'travel', { pairs: {} });
  expect(Object.keys(pairs)).toHaveLength(10); expect(pairs['白色行李袋'].ids).toEqual(['a9', 'b9']);
});
it('propagates later edits in either direction and stays idempotent, preserving container, dates, tags and progress', async () => {
  await syncTickTickTemplates(api, 'travel', 'conn');
  Object.assign(m.tasks.find(t => t.id === 'b0')!, { title: '📦🪥漱新版', content: 'new', items: [{ title: '牙刷', status: 0 }, { title: '牙线', status: 0 }] });
  await syncTickTickTemplates(api, 'travel', 'conn');
  expect(m.tasks.find(t => t.id === 'a0')).toMatchObject({ title: '🧳🪥漱新版', content: 'new', parentId: 'a', dueDate: '2026-11-04', tags: ['routine'], items: [{ id: 'a0-item', title: '牙刷', status: 1 }, { title: '牙线', status: 0 }] });
  m.tasks.find(t => t.id === 'a0')!.content = 'travel edit';
  await syncTickTickTemplates(api, 'travel', 'conn');
  expect(m.tasks.find(t => t.id === 'b0')!.content).toBe('travel edit');
  updateTask.mockClear(); await syncTickTickTemplates(api, 'travel', 'conn'); expect(updateTask).not.toHaveBeenCalled();
});
it('uses real modification times for initial differences and preserves the special titles', async () => {
  Object.assign(m.tasks.find(t => t.id === 'a9')!, { content: 'latest', modifiedTime: '2026-11-01T12:00:00Z' });
  Object.assign(m.tasks.find(t => t.id === 'b9')!, { modifiedTime: '2026-10-31T12:00:00Z' });
  await syncTickTickTemplates(api, 'travel', 'conn');
  expect(m.tasks.find(t => t.id === 'b9')).toMatchObject({ title: '📦', content: 'latest' });
});
it('does not guess when both sides change without modification timestamps', async () => {
  await syncTickTickTemplates(api, 'travel', 'conn');
  m.tasks.find(t => t.id === 'a0')!.content = 'A'; m.tasks.find(t => t.id === 'b0')!.content = 'B';
  await expect(syncTickTickTemplates(api, 'travel', 'conn')).rejects.toThrow('冲突'); expect(updateTask).not.toHaveBeenCalled();
});
it('rejects ambiguous and missing matches before writes', async () => {
  m.tasks.push(make('duplicate', '📦🪥漱', 'b'));
  await expect(syncTickTickTemplates(api, 'travel', 'conn')).rejects.toThrow('多个匹配'); expect(updateTask).not.toHaveBeenCalled();
});

it('initializes differences from travel when timestamps are unavailable, as explicitly authorized', async () => {
  m.tasks.find(t => t.id === 'a0')!.content = 'travel';
  m.tasks.find(t => t.id === 'b0')!.content = 'moving';
  await syncTickTickTemplates(api, 'travel', 'conn');
  expect(m.tasks.find(t => t.id === 'b0')!.content).toBe('travel');
});

it('updates 搬家-京广 from the templates and preserves its prefixes, dates, completed state and checklist progress', async () => {
  m.tasks.push(make('jg', '搬家-京广'), make('jg-stage', '出门前三天', 'jg'),
    { ...make('jg-brush', '🎒🪥漱', 'jg-stage'), content: 'old', status: 2, completedTime: '2026-10-30T10:00:00Z', dueDate: '2026-12-01' },
    { ...make('jg-box', '📦', 'jg-stage'), content: 'old box' },
    { ...make('unrelated', '📦爱好', 'jg-stage'), content: 'keep' });
  const result = await syncTickTickTemplates(api, 'travel', 'conn');
  expect(result).toMatchObject({ movingInstances: 1, instanceMatched: 11, instanceUpdated: 4, instanceCreated: 8 });
  expect(m.tasks.find(t => t.id === 'jg-brush')).toMatchObject({ title: '搬家-京广 · 🎒🪥漱', content: 'same', status: 2,
    completedTime: '2026-10-30T10:00:00Z', dueDate: '2026-12-01', parentId: 'jg-stage', items: [{ id: 'jg-brush-item', status: 1 }] });
  expect(m.tasks.find(t => t.id === 'jg-box')).toMatchObject({ title: '搬家-京广 · 📦', content: 'same' });
  expect(m.tasks.find(t => t.id === 'unrelated')!.content).toBe('keep');
  updateTask.mockClear(); await syncTickTickTemplates(api, 'travel', 'conn'); expect(updateTask).not.toHaveBeenCalled();
});
it('keeps instance associations after rename and never propagates instance text into templates', async () => {
  m.tasks.push(make('jg', '计划 搬家-京广'), make('stage', '出门前三天', 'jg'), make('brush', '📦🪥漱', 'stage'));
  await syncTickTickTemplates(api, 'travel', 'conn');
  Object.assign(m.tasks.find(t => t.id === 'brush')!, { title: '📦自定义', content: 'instance edit' });
  m.tasks.find(t => t.id === 'a0')!.content = 'new template';
  await syncTickTickTemplates(api, 'travel', 'conn');
  expect(m.tasks.find(t => t.id === 'brush')).toMatchObject({ title: '计划 搬家-京广 · 📦🪥漱', content: 'new template' });
  expect(m.tasks.find(t => t.id === 'b0')!.content).toBe('new template');
});
it('ignores unrelated roots and rejects ambiguous instance categories', async () => {
  m.tasks.push(make('other', '旅行-京广'), make('s', 'stage', 'other'), { ...make('x', '📦🪥漱', 's'), content: 'untouched' });
  await syncTickTickTemplates(api, 'travel', 'conn'); expect(m.tasks.find(t => t.id === 'x')!.content).toBe('untouched');
  m.tasks.push(make('jg', '搬家-京广'), make('js', 'stage', 'jg'), make('j1', '📦🪥漱', 'js'), make('j2', '🧳🪥漱', 'js'));
  await expect(syncTickTickTemplates(api, 'travel', 'conn')).rejects.toThrow('多个匹配');
});

it('parses title dates and rejects impossible calendar days', () => {
  expect(movingDepartureDate('搬家-京广-11.5', '2026-11-03')).toBe('2026-11-05');
  expect(movingDepartureDate('搬家-京广-2027.1.5', '2026-11-03')).toBe('2027-01-05');
  expect(movingDepartureDate('搬家-京广', '2026-11-03')).toBeNull();
  expect(() => movingDepartureDate('搬家-京广-2.30', '2026-11-03')).toThrow('无效');
});
it('anchors stages and all descendants on the title date, keeps progress, and follows title edits', async () => {
  m.tasks.push(make('jg', '搬家-京广-2026.11.5'), make('js', '出门前三天', 'jg'),
    make('brush', '📦🪥漱', 'js'), { ...make('deep', '牙刷准备', 'brush'), status: 2 },
    make('day', '出门当天', 'jg'));
  const result = await syncTickTickTemplates(api, 'travel', 'conn');
  for (const id of ['js', 'brush', 'deep']) expect(m.tasks.find(t => t.id === id)!.dueDate).toContain('2026-11-02');
  expect(m.tasks.find(t => t.id === 'deep')!.status).toBe(2);
  expect(m.tasks.find(t => t.id === 'day')!.dueDate).toContain('2026-11-05');
  expect(result.managedTaskIds).toEqual(expect.arrayContaining(['jg', 'js', 'brush', 'deep', 'day']));
  expect((await syncTickTickTemplates(api, 'travel', 'conn')).dateUpdated).toBe(0);
  m.tasks.find(t => t.id === 'jg')!.title = '搬家-京广-2026.11.8';
  await syncTickTickTemplates(api, 'travel', 'conn');
  expect(m.tasks.find(t => t.id === 'deep')!.dueDate).toContain('2026-11-05');
});

it('keeps pinned checklist entries local while syncing ordinary entries in both directions', async () => {
  const travel = m.tasks.find(t => t.id === 'a0')!, moving = m.tasks.find(t => t.id === 'b0')!;
  travel.items!.push({ id: 'travel-private', title: '旅行专用📌  ', status: 1 });
  moving.items!.push({ id: 'moving-private', title: '搬家专用📌', status: 0 });
  await syncTickTickTemplates(api, 'travel', 'conn');
  expect(updateTask).not.toHaveBeenCalled();
  moving.items!.push({ id: 'new', title: '牙线', status: 0 });
  await syncTickTickTemplates(api, 'travel', 'conn');
  expect(travel.items!.map(i => i.title)).toEqual(['牙刷', '旅行专用📌  ', '牙线']);
  expect(travel.items!.find(i => i.id === 'travel-private')!.status).toBe(1);
  travel.content = 'new content';
  await syncTickTickTemplates(api, 'travel', 'conn');
  expect(moving.items!.map(i => i.title)).toEqual(['牙刷', '搬家专用📌', '牙线']);
  updateTask.mockClear(); await syncTickTickTemplates(api, 'travel', 'conn'); expect(updateTask).not.toHaveBeenCalled();
});
it('skips pinned tasks including special containers and allows absent counterparts', async () => {
  m.tasks.find(t => t.id === 'b0')!.title += '📌';
  m.tasks.find(t => t.id === 'b9')!.title += '📌';
  m.tasks = m.tasks.filter(t => t.id !== 'a0');
  const result = await syncTickTickTemplates(api, 'travel', 'conn');
  expect(result.matched).toBe(8); expect(updateTask).not.toHaveBeenCalled();
});
it('honors a pinned task after its matching keyword was renamed', async () => {
  await syncTickTickTemplates(api, 'travel', 'conn');
  Object.assign(m.tasks.find(t => t.id === 'b0')!, { title: '📦自己用📌', content: 'private' });
  await syncTickTickTemplates(api, 'travel', 'conn');
  expect(m.tasks.find(t => t.id === 'a0')!.content).toBe('same');
  expect(updateTask).not.toHaveBeenCalled();
});
it('copies moving-specific checklist entries to moving instances, never to the travel template', async () => {
  m.tasks.find(t => t.id === 'b0')!.items!.push({ id: 'private', title: '仅搬家用📌', status: 1 });
  m.tasks.push(make('jg', '搬家-京广'), make('js', '出门前三天', 'jg'), make('jb', '📦🪥漱', 'js'));
  await syncTickTickTemplates(api, 'travel', 'conn');
  expect(m.tasks.find(t => t.id === 'a0')!.items!.some(i => i.title.endsWith('📌'))).toBe(false);
  expect(m.tasks.find(t => t.id === 'jb')!.items!.some(i => i.title === '仅搬家用📌')).toBe(true);
});

it('syncs stage checklists including the two video entries, preserving stage notes, dates, pins and progress', async () => {
  const travel = m.tasks.find(t => t.id === 'a')!;
  Object.assign(travel, { content: '(2.5h)', items: [
    { id: 'wash', title: '洗衣服 (50m)', status: 0 },
    { id: 'tablet', title: '平板电影×4 电视剧×1 (5m)', status: 1 },
    { id: 'phone', title: '手机电视剧×1 (5m)', status: 0 },
    { id: 'travel-pin', title: '旅行专用📌', status: 1 },
  ] });
  const moving = { ...make('moving-day', '出门前一天🧳🎒', 'move'), content: '(1h)', dueDate: '2026-11-08', items: [
    { id: 'moving-wash', title: '洗衣服 (50m)', status: 1 },
    { id: 'extra', title: '寄件', status: 0 },
    { id: 'moving-pin', title: '搬家专用📌', status: 1 },
  ] };
  m.tasks.push(moving, make('jg', '搬家-京广'), { ...make('jg-day', '出门前一天🎒', 'jg'), content: 'instance note' });
  const result = await syncTickTickTemplates(api, 'travel', 'conn');
  expect(result.stageChecklists).toContainEqual({ stage: '出门前一天', items: [
    '洗衣服 (50m)', '平板电影×4 电视剧×1 (5m)', '手机电视剧×1 (5m)', '寄件',
  ] });
  expect(moving).toMatchObject({ title: '出门前一天🧳🎒', content: '(1h)', dueDate: '2026-11-08', parentId: 'move' });
  expect(moving.items.find(i => i.id === 'moving-wash')!.status).toBe(1);
  expect(moving.items.find(i => i.id === 'moving-pin')!.status).toBe(1);
  expect(moving.items.some(i => i.title === '旅行专用📌')).toBe(false);
  expect(moving.items.find(i => i.title === '平板电影×4 电视剧×1 (5m)')!.status).toBe(0);
  expect(travel.content).toBe('(2.5h)');
  expect(m.tasks.find(t => t.id === 'jg-day')).toMatchObject({ title: '搬家-京广 · 出门前一天🧳🎒', content: '(1h)' });
  expect(m.tasks.find(t => t.id === 'jg-day')!.items!.map(i => i.title)).toContain('手机电视剧×1 (5m)');
  updateTask.mockClear(); await syncTickTickTemplates(api, 'travel', 'conn'); expect(updateTask).not.toHaveBeenCalled();
  moving.items.push({ id: 'later', title: '新检查事项', status: 0 });
  await syncTickTickTemplates(api, 'travel', 'conn');
  expect(travel.items!.map(i => i.title)).toContain('新检查事项');
});
it('excludes pinned stages and rejects ambiguous same-name stages before any write', async () => {
  const stage = make('moving-day', '出门前一天🧳📌', 'move'); m.tasks.push(stage);
  expect((await syncTickTickTemplates(api, 'travel', 'conn')).stageChecklists).toEqual([]);
  stage.title = '出门前一天🧳'; m.tasks.push(make('duplicate-day', '出门前一天🎒', 'move'));
  await expect(syncTickTickTemplates(api, 'travel', 'conn')).rejects.toThrow('多个匹配');
  expect(updateTask).not.toHaveBeenCalled();
});
it('uses container-suffixed stage titles for relative dates without changing their titles', async () => {
  m.tasks.push(make('jg', '搬家-京广-2026.11.5'), make('stage', '出门前三天📦', 'jg'), make('deep', '准备', 'stage'));
  await syncTickTickTemplates(api, 'travel', 'conn');
  expect(m.tasks.find(t => t.id === 'stage')).toMatchObject({ title: '搬家-京广-2026.11.5 · 出门前三天' });
  expect(m.tasks.find(t => t.id === 'deep')!.dueDate).toContain('2026-11-02');
});

it('保存整棵搬家实例的实际 ID 并合并延迟基准，下一轮不会重新生成', async () => {
  m.tasks.push(make('jg', '搬家-京广-11.5'));
  const server = { ...api, createTask: async (payload: any) => {
    const id = `created-${m.tasks.length}`;
    const task = { ...payload, id, status: 0, items: payload.items.map((item: any, index: number) => ({ ...item, id: `${id}-item-${index}` })) };
    m.tasks.push(task); return task;
  } } as unknown as TickTickOpenApiClient;
  const draft = new RuleTaskDraft(server, m.tasks), branch = draft.branch('template-content');
  const saves: (() => Promise<unknown>)[] = [];
  await syncTickTickTemplates(branch.api, 'travel', 'conn', { mode: 'content',
    deferState: save => saves.push(save), resolveIds: value => draft.resolveIds(value, true) });
  branch.accept();
  expect(saves).toHaveLength(2); expect(m.saved.size).toBe(0);
  for (const save of saves) draft.saveAfterCommit('template-content', save);
  await draft.commit();
  const state = m.saved.get('ticktick:template-pairs:v1:conn:travel') as any;
  expect(Object.keys(state.movingTrees.jg.taskIds)).toHaveLength(12);
  expect(JSON.stringify(state)).not.toContain('draft-');
  const copied = m.tasks.find(task => task.id === state.movingTrees.jg.taskIds.b0)!;
  expect(state.movingTrees.jg.itemIds.b0['b0-item']).toBe(copied.items![0].id);
  copied.items![0].status = 1;
  m.tasks.find(task => task.id === 'b0')!.items![0].title = '牙刷换新';
  createTask.mockClear();
  await syncTickTickTemplates(api, 'travel', 'conn', { mode: 'content' });
  expect(createTask).not.toHaveBeenCalled();
  expect(copied.items).toHaveLength(1);
  expect(copied.items![0]).toMatchObject({ title: '牙刷换新', status: 1 });
});
