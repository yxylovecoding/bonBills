import { describe, expect, it } from 'vitest';
import {
  buildTripSourcesFromSyncState,
  buildWishPreparationSourcesFromSyncState,
  decryptTickTickToken,
  discoverTickTickTemplate,
  encryptTickTickToken,
  getTickTickRoutineTargetDates,
  nextChineseNewYear,
  readConnectedTickTickTemplate,
  reconcileTickTickTrips,
  reconcileTickTickWishPreparations,
  shiftTickTickDate,
  syncTickTickRoutines,
  type TickTickApi,
  type TickTickProjectData,
  type TickTickTask,
  type TickTickTripSyncState,
} from './_ticktickTrips';

class FakeTickTickApi implements TickTickApi {
  readonly tasks = new Map<string, TickTickTask>();
  createCalls = 0;
  updateCalls = 0;
  deleteCalls = 0;
  readonly updatePayloads = new Map<string, Record<string, unknown>>();
  private sequence = 0;

  constructor() {
    this.tasks.set('template-root', {
      id: 'template-root', projectId: 'play', title: '出门todo', content: '模板说明', tags: ['玩'], status: 0,
    });
    this.tasks.set('template-month', {
      id: 'template-month', projectId: 'play', parentId: 'template-root', title: '出门前一个月',
      startDate: '2026-10-20T00:00:00+0800', dueDate: '2026-10-20T00:00:00+0800', isAllDay: true, status: 2,
    });
    this.tasks.set('template-before', {
      id: 'template-before', projectId: 'play', parentId: 'template-root', title: '出门前一天',
      startDate: '2026-11-19T00:00:00+0800', dueDate: '2026-11-19T00:00:00+0800', isAllDay: true,
      items: [{ id: 'template-pack', title: '随身包', status: 1, sortOrder: 10 }],
    });
    this.tasks.set('template-day', {
      id: 'template-day', projectId: 'play', parentId: 'template-root', title: '出门当天',
      startDate: '2026-11-20T00:00:00+0800', dueDate: '2026-11-20T00:00:00+0800', isAllDay: true,
    });
  }

  async listProjects() {
    return [{ id: 'play', name: '玩' }];
  }

  async getPreference() {
    return { timeZone: 'Asia/Shanghai' };
  }

  async getProjectData(projectId: string): Promise<TickTickProjectData> {
    return { project: { id: projectId, name: '玩' }, tasks: [...this.tasks.values()] };
  }

  async filterTasks(projectIds: string | string[] | undefined, statuses: number[]) {
    const includedProjects = new Set(Array.isArray(projectIds) ? projectIds : [projectIds]);
    return [...this.tasks.values()].filter(
      (task) => (projectIds === undefined || includedProjects.has(task.projectId)) && statuses.includes(task.status ?? 0),
    );
  }

  async listCompletedTasks(projectIds: string[], startDate: string, endDate: string) {
    return [...this.tasks.values()].filter((task) => projectIds.includes(task.projectId)
      && task.status === 2 && task.completedTime
      && Date.parse(task.completedTime) >= Date.parse(startDate)
      && Date.parse(task.completedTime) <= Date.parse(endDate));
  }

  async getTask(_projectId: string, taskId: string) {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error('TickTick 404');
    return task;
  }

  async createTask(payload: Record<string, unknown>) {
    this.createCalls += 1;
    const id = `generated-${++this.sequence}`;
    const items = ((payload.items ?? []) as TickTickTask['items'])?.map((item, index) => ({
      ...item,
      id: `${id}-item-${index + 1}`,
    }));
    const task = { ...payload, id, items, status: 0 } as unknown as TickTickTask;
    this.tasks.set(id, task);
    return task;
  }

  async updateTask(taskId: string, payload: Record<string, unknown>) {
    this.updateCalls += 1;
    this.updatePayloads.set(taskId, payload);
    const current = this.tasks.get(taskId);
    if (!current) throw new Error('TickTick 404');
    const items = ((payload.items ?? current.items ?? []) as TickTickTask['items'])?.map((item, index) => ({
      ...item,
      id: item.id || `${taskId}-new-item-${index + 1}`,
    }));
    const updated = { ...current, ...payload, id: taskId, items } as TickTickTask;
    this.tasks.set(taskId, updated);
    return updated;
  }

  async deleteTask(_projectId: string, taskId: string) {
    this.deleteCalls += 1;
    if (!this.tasks.delete(taskId)) throw new Error('TickTick 404');
  }
}

class FakeRoutineTickTickApi extends FakeTickTickApi {
  constructor() {
    super();
    this.tasks.set('home-root', {
      id: 'home-root', projectId: 'life', title: '在家 routine', status: 0,
    });
    this.tasks.set('home-dated', {
      id: 'home-dated', projectId: 'life', parentId: 'home-root', title: '整理房间', status: 0,
      startDate: '2026-08-31T09:00:00+0800', dueDate: '2026-09-01T18:00:00+0800',
      timeZone: 'Asia/Shanghai', reminders: ['TRIGGER:P0DT9H0M0S'],
    });
    this.tasks.set('home-no-date', {
      id: 'home-no-date', projectId: 'life', parentId: 'home-root', title: '想起来再做', status: 0,
    });
    this.tasks.set('home-completed', {
      id: 'home-completed', projectId: 'life', parentId: 'home-root', title: '已完成', status: 2,
      dueDate: '2026-09-01T00:00:00+0800',
    });
    this.tasks.set('school-root', {
      id: 'school-root', projectId: 'life', title: '在校 ROUTINE', status: 0,
    });
    this.tasks.set('school-dated', {
      id: 'school-dated', projectId: 'life', parentId: 'school-root', title: '校园卡充值', status: 0,
      startDate: '2026-09-15T00:00:00+0800', dueDate: '2026-09-15T00:00:00+0800',
      items: [
        { id: 'school-item', title: '查余额', status: 0, startDate: '2026-09-15T07:30:00+0800' },
        { id: 'school-item-done', title: '已处理', status: 1, startDate: '2026-09-15T08:00:00+0800' },
      ],
    });
    this.tasks.set('school-start-only', {
      id: 'school-start-only', projectId: 'life', parentId: 'school-root', title: '只有开始日期', status: 0,
      startDate: '2026-09-15T08:30:00+0800',
    });
    this.tasks.set('unrelated-dated', {
      id: 'unrelated-dated', projectId: 'life', title: '清单内其他任务', status: 0,
      startDate: '2026-09-15T00:00:00+0800', dueDate: '2026-09-15T00:00:00+0800',
    });
  }

  async listProjects() {
    // The built-in Inbox ("life" here) is absent from /project.
    return [{ id: 'play', name: '玩' }];
  }

  async getProjectData(projectId: string): Promise<TickTickProjectData> {
    const project = (await this.listProjects()).find((candidate) => candidate.id === projectId);
    return {
      project,
      tasks: [...this.tasks.values()].filter((task) => task.projectId === projectId),
    };
  }

  async filterTasks(projectIds: string | string[] | undefined, statuses: number[]) {
    return (await super.filterTasks(projectIds, statuses)).map((task) => task.projectId === 'life'
      ? {
        id: task.id,
        projectId: task.projectId,
        title: task.title,
        status: task.status,
      }
      : task);
  }

  async updateTask(taskId: string, payload: Record<string, unknown>) {
    const updated = await super.updateTask(taskId, payload);
    return {
      id: updated.id,
      projectId: updated.projectId,
      title: updated.title,
      status: updated.status,
    };
  }
}

const futureTrip = {
  key: '2027-01-10',
  startDate: '2027-01-10',
  endDate: '2027-01-12',
  dates: ['2027-01-10', '2027-01-11', '2027-01-12'],
  name: '东京',
  note: '带护照',
};

function addWishPreparationTemplate(api: FakeTickTickApi) {
  api.tasks.set('template-seven-months', {
    id: 'template-seven-months', projectId: 'play', parentId: 'template-root', title: '出门前七个月',
    startDate: '2026-04-20T00:00:00+0800', dueDate: '2026-04-20T00:00:00+0800',
    items: [{ id: 'template-visa-check', title: '查签证', status: 1, startDate: '2026-04-21T09:00:00+0800' }],
    status: 2,
  });
  api.tasks.set('template-visa', {
    id: 'template-visa', projectId: 'play', parentId: 'template-seven-months', title: '办签证',
    startDate: '2026-04-21T08:00:00+0800', dueDate: '2026-04-22T18:00:00+0800', isAllDay: false,
  });
  api.tasks.set('template-photo', {
    id: 'template-photo', projectId: 'play', parentId: 'template-visa', title: '准备证件照',
  });
}

const futureWish = { id: 'wish-tokyo', name: '东京', isActive: true, deadline: '2027-09-30', linkedTripStartDate: null };

describe('TickTick 心愿七个月准备', () => {
  it('只接收有日期、名称且启用的未关联心愿，按七个自然月回退并钳制月末', () => {
    const sources = buildWishPreparationSourcesFromSyncState({ config: { wishes: [
      futureWish,
      { ...futureWish, id: 'leap', deadline: '2028-09-30' },
      { ...futureWish, id: 'year-boundary', deadline: '2027-01-31' },
      { ...futureWish, id: 'inactive', isActive: false },
      { ...futureWish, id: 'linked', linkedTripStartDate: '2027-09-30' },
      { ...futureWish, id: 'undated', deadline: null },
      { ...futureWish, id: 'invalid', deadline: '2027-02-30' },
      { ...futureWish, id: 'unnamed', name: ' ' },
      { ...futureWish, id: '' },
      null,
    ] } });
    expect(sources.map(({ key, startDate, endDate }) => ({ key, startDate, endDate }))).toEqual([
      { key: 'wish-tokyo', startDate: '2027-02-28', endDate: '2027-09-30' },
      { key: 'leap', startDate: '2028-02-29', endDate: '2028-09-30' },
      { key: 'year-boundary', startDate: '2026-06-30', endDate: '2027-01-31' },
    ]);
    expect(buildWishPreparationSourcesFromSyncState(null)).toEqual([]);
  });

  it('只复制七个月阶段及所有后代，日期平移且每个任务带心愿名', async () => {
    const api = new FakeTickTickApi();
    addWishPreparationTemplate(api);
    const template = await discoverTickTickTemplate(api);
    const state: TickTickTripSyncState = { instances: {} };
    const result = await reconcileTickTickWishPreparations({
      api, template, state, configState: { config: { wishes: [futureWish] } }, today: '2026-09-04', saveState: async () => undefined,
    });
    expect(result).toMatchObject({ createdWishPreparations: 1, activeWishPreparations: 1 });
    expect(api.createCalls).toBe(3);
    expect(state.instances).toEqual({});
    const instance = state.wishInstances![futureWish.id];
    const root = api.tasks.get(instance.rootTaskId!)!;
    const visa = api.tasks.get(instance.taskIdsByTemplateId['template-visa'])!;
    const photo = api.tasks.get(instance.taskIdsByTemplateId['template-photo'])!;
    expect(root).toMatchObject({ title: '东京 · 出门前七个月', dueDate: '2027-02-28T00:00:00+0800', status: 0 });
    expect(root.parentId).toBeUndefined();
    expect(root.items?.[0]).toMatchObject({ title: '查签证', status: 0, startDate: '2027-03-01T09:00:00+0800' });
    expect(visa).toMatchObject({
      title: '东京 · 办签证', parentId: root.id, isAllDay: false,
      startDate: '2027-03-01T08:00:00+0800', dueDate: '2027-03-02T18:00:00+0800',
    });
    expect(photo).toMatchObject({ title: '东京 · 准备证件照', parentId: visa.id });
    expect(photo.dueDate).toBeUndefined();
    expect(instance.taskIdsByTemplateId['template-root']).toBeUndefined();
    expect(instance.taskIdsByTemplateId['template-month']).toBeUndefined();
    expect(api.tasks.get('template-seven-months')?.status).toBe(2);
  });

  it('重启后按心愿 ID 更新改名、改期，保留完成状态和手工清单项，不误合并同日心愿', async () => {
    const api = new FakeTickTickApi();
    addWishPreparationTemplate(api);
    const template = await discoverTickTickTemplate(api);
    let state: TickTickTripSyncState = { instances: {} };
    const saveState = async () => undefined;
    const sync = (wishes: unknown[]) => reconcileTickTickWishPreparations({
      api, template, state, configState: { config: { wishes } }, today: '2026-09-04', saveState,
    });
    await sync([futureWish]);
    state = JSON.parse(JSON.stringify(state));
    const rootId = state.wishInstances![futureWish.id].rootTaskId!;
    const root = api.tasks.get(rootId)!;
    root.status = 2;
    root.items![0].status = 1;
    root.items!.push({ id: 'manual-check', title: '临时补充', status: 1 });
    const changed = { ...futureWish, name: '京都', deadline: '2027-10-31' };
    await sync([changed, { ...changed, id: 'another-wish' }]);
    await sync([changed, { ...changed, id: 'another-wish' }]);
    expect(api.createCalls).toBe(6);
    expect(state.wishInstances![futureWish.id].rootTaskId).toBe(rootId);
    expect(state.wishInstances!['another-wish'].rootTaskId).not.toBe(rootId);
    expect(api.tasks.get(rootId)).toMatchObject({ title: '京都 · 出门前七个月', status: 2, dueDate: '2027-03-31T00:00:00+0800' });
    expect(api.tasks.get(rootId)?.items?.map((item) => [item.title, item.status])).toEqual([['查签证', 1], ['临时补充', 1]]);
  });

  it('不同心愿不能按相同准备日期接管旧副本', async () => {
    const api = new FakeTickTickApi();
    addWishPreparationTemplate(api);
    const template = await discoverTickTickTemplate(api);
    const state: TickTickTripSyncState = { instances: {} };
    const sync = (id: string) => reconcileTickTickWishPreparations({
      api, template, state, configState: { config: { wishes: [{ ...futureWish, id }] } }, today: '2026-09-04', saveState: async () => undefined,
    });
    await sync('first');
    const firstRoot = state.wishInstances!.first.rootTaskId!;
    await sync('second');
    expect(state.wishInstances!.first).toBeUndefined();
    expect(state.wishInstances!.second.rootTaskId).not.toBe(firstRoot);
    expect(api.tasks.has(firstRoot)).toBe(false);
  });

  it('准备日已过仍生成未到期心愿；到期后改期仍复用原副本', async () => {
    const api = new FakeTickTickApi();
    addWishPreparationTemplate(api);
    const template = await discoverTickTickTemplate(api);
    const state: TickTickTripSyncState = { instances: {} };
    const sync = (deadline: string, today: string) => reconcileTickTickWishPreparations({
      api, template, state, configState: { config: { wishes: [{ ...futureWish, deadline }] } }, today, saveState: async () => undefined,
    });
    await sync('2027-01-10', '2026-09-04');
    const rootId = state.wishInstances![futureWish.id].rootTaskId!;
    expect(api.tasks.get(rootId)?.dueDate).toBe('2026-06-10T00:00:00+0800');
    await sync('2027-10-10', '2027-02-10');
    expect(state.wishInstances![futureWish.id].rootTaskId).toBe(rootId);
    expect(api.createCalls).toBe(3);
  });

  it('关联出游后清理心愿副本，完整日历任务保持独立', async () => {
    const api = new FakeTickTickApi();
    addWishPreparationTemplate(api);
    const template = await discoverTickTickTemplate(api);
    const state: TickTickTripSyncState = { instances: {} };
    const saveState = async () => undefined;
    const options = { api, template, state, today: '2026-09-04', saveState };
    await reconcileTickTickWishPreparations({ ...options, configState: { config: { wishes: [futureWish] } } });
    const wishTaskIds = Object.values(state.wishInstances![futureWish.id].taskIdsByTemplateId);
    await reconcileTickTickTrips({ ...options, trips: [futureTrip] });
    const fullRootId = state.instances[futureTrip.key].rootTaskId!;
    await reconcileTickTickWishPreparations({ ...options, configState: { config: { wishes: [{ ...futureWish, linkedTripStartDate: futureTrip.startDate }] } } });
    expect(state.wishInstances).toEqual({});
    expect(wishTaskIds.some((id) => api.tasks.has(id))).toBe(false);
    expect(api.tasks.has(fullRootId)).toBe(true);
    expect(Object.keys(state.instances[futureTrip.key].taskIdsByTemplateId)).toHaveLength(7);
  });

  it('七个月模板缺失或不唯一时明确报错，不退回六个月或复制整套任务', async () => {
    const api = new FakeTickTickApi();
    api.tasks.set('template-six', { id: 'template-six', projectId: 'play', parentId: 'template-root', title: '出门前六个月' });
    const state: TickTickTripSyncState = { instances: {} };
    const options = { api, state, today: '2026-09-04', configState: { config: { wishes: [futureWish] } }, saveState: async () => undefined };
    await expect(reconcileTickTickWishPreparations({ ...options, template: await discoverTickTickTemplate(api) })).rejects.toThrow('出门前七个月');
    addWishPreparationTemplate(api);
    api.tasks.set('duplicate-seven', { id: 'duplicate-seven', projectId: 'play', parentId: 'template-root', title: '出门前7个月' });
    await expect(reconcileTickTickWishPreparations({ ...options, template: await discoverTickTickTemplate(api) })).rejects.toThrow('唯一');
    expect(api.createCalls).toBe(0);
  });

  it.each(['deleted', 'inactive', 'undated'])('心愿 %s 后只清理独立副本，不再要求七个月模板', async (change) => {
    const api = new FakeTickTickApi();
    addWishPreparationTemplate(api);
    const state: TickTickTripSyncState = { instances: {} };
    const options = { api, state, today: '2026-09-04', saveState: async () => undefined };
    await reconcileTickTickWishPreparations({
      ...options, template: await discoverTickTickTemplate(api), configState: { config: { wishes: [futureWish] } },
    });
    const wishIds = Object.values(state.wishInstances![futureWish.id].taskIdsByTemplateId);
    api.tasks.delete('template-seven-months');
    const wishes = change === 'deleted' ? [] : [{ ...futureWish, ...(change === 'inactive' ? { isActive: false } : { deadline: null }) }];
    const result = await reconcileTickTickWishPreparations({
      ...options, template: await discoverTickTickTemplate(api), configState: { config: { wishes } },
    });
    expect(result.deletedWishPreparations).toBe(1);
    expect(state.wishInstances).toEqual({});
    expect(wishIds.some((id) => api.tasks.has(id))).toBe(false);
    expect(api.tasks.has('template-root')).toBe(true);
  });

  it('无心愿或截止日已过时不生成，也不要求七个月模板', async () => {
    const api = new FakeTickTickApi();
    const template = await discoverTickTickTemplate(api);
    const state: TickTickTripSyncState = { instances: {} };
    const options = { api, template, state, today: '2026-09-04', saveState: async () => undefined };
    await reconcileTickTickWishPreparations({ ...options, configState: null });
    const result = await reconcileTickTickWishPreparations({ ...options, configState: { config: { wishes: [{ ...futureWish, deadline: '2026-09-03' }] } } });
    expect(result.activeWishPreparations).toBe(0);
    expect(api.createCalls).toBe(0);
    expect(api.updateCalls).toBe(0);
    expect(api.deleteCalls).toBe(0);
  });

  it('兼容数字七个月标题及无日期的阶段根任务', async () => {
    const api = new FakeTickTickApi();
    addWishPreparationTemplate(api);
    const root = api.tasks.get('template-seven-months')!;
    root.title = '出门前 7 个月';
    delete root.startDate;
    delete root.dueDate;
    const template = await discoverTickTickTemplate(api);
    const state: TickTickTripSyncState = { instances: {} };
    await reconcileTickTickWishPreparations({ api, template, state, today: '2026-09-04', configState: { config: { wishes: [futureWish] } }, saveState: async () => undefined });
    const instance = state.wishInstances![futureWish.id];
    expect(api.tasks.get(instance.rootTaskId!)?.dueDate).toBe('2027-02-28T00:00:00+0800');
    expect(api.tasks.get(instance.taskIdsByTemplateId['template-visa'])?.startDate).toBe('2027-03-01T08:00:00+0800');
  });
});

describe('TickTick 出游同步', () => {
  it('在服务端独立生成连续、切分及命名后的行程', () => {
    expect(buildTripSourcesFromSyncState(
      { tagMap: {
        '2026-09-10': 'travel',
        '2026-09-11': 'travel',
        '2026-09-12': 'travel',
        '2026-09-13': 'home',
      } },
      {
        tripTags: { '2026-09-10': '26.9.10 东京', '2026-09-12': '' },
        tripNotes: { '2026-09-10': ' 带护照 ' },
        tripSplits: { '2026-09-12': true },
      },
    )).toEqual([
      {
        key: '2026-09-10', startDate: '2026-09-10', endDate: '2026-09-11',
        dates: ['2026-09-10', '2026-09-11'], name: '东京', note: '带护照',
      },
      {
        key: '2026-09-12', startDate: '2026-09-12', endDate: '2026-09-12',
        dates: ['2026-09-12'], name: '9月12日', note: '',
      },
    ]);
  });

  it('当前场景对齐今天，非当前场景对齐下一段开始日', () => {
    const calendarState = { tagMap: {
      '2026-09-01': 'home',
      '2026-09-02': 'home',
      '2026-09-03': 'home',
      '2026-09-04': 'home',
      '2026-09-05': 'home',
      '2026-09-06': 'home',
      '2026-09-07': 'school',
      '2026-09-08': 'intern',
      '2026-09-15': 'intern',
      '2026-09-20': 'home',
    } };

    expect(getTickTickRoutineTargetDates(calendarState, '2026-09-05')).toEqual({
      home: '2026-09-05',
      school: '2026-09-07',
    });
    expect(getTickTickRoutineTargetDates(calendarState, '2026-09-07')).toEqual({
      home: '2026-09-20',
      school: '2026-09-07',
    });
    expect(getTickTickRoutineTargetDates(calendarState, '2026-09-08')).toEqual({
      home: '2026-09-20',
      school: '2026-09-08',
    });
    expect(getTickTickRoutineTargetDates(calendarState, '2026-09-09')).toEqual({
      home: '2026-09-20',
      school: '2026-09-15',
    });
  });

  it('日历没有下一场景时使用下一个春节', () => {
    expect(nextChineseNewYear('2026-09-21')).toBe('2027-02-06');
    expect(nextChineseNewYear('2027-02-05')).toBe('2027-02-06');
    expect(nextChineseNewYear('2027-02-06')).toBe('2028-01-26');
    expect(getTickTickRoutineTargetDates({ tagMap: {} }, '2026-09-21')).toEqual({
      home: '2027-02-06',
      school: '2027-02-06',
    });
  });

  it('同步普通清单列表之外的收集箱 routine，并保留完整任务字段', async () => {
    const api = new FakeRoutineTickTickApi();
    const calendarState = { tagMap: {
      '2026-09-01': 'home',
      '2026-09-02': 'home',
      '2026-09-03': 'home',
      '2026-09-04': 'home',
      '2026-09-05': 'home',
      '2026-09-06': 'home',
      '2026-09-07': 'school',
      '2026-09-08': 'intern',
      '2026-09-20': 'home',
    } };

    await expect(syncTickTickRoutines({ api, calendarState, today: '2026-09-07' })).resolves.toEqual({
      updatedRoutineTasks: 3,
      routineTargets: { home: '2026-09-20', school: '2026-09-07' },
      routineTaskCounts: { home: 1, school: 2 },
    });
    expect(api.tasks.get('home-dated')).toMatchObject({
      startDate: '2026-09-19T09:00:00+0800',
      dueDate: '2026-09-20T18:00:00+0800',
      reminders: ['TRIGGER:P0DT9H0M0S'],
    });
    expect(api.tasks.get('school-dated')).toMatchObject({
      startDate: '2026-09-07T00:00:00+0800',
      dueDate: '2026-09-07T00:00:00+0800',
      items: [
        { id: 'school-item', title: '查余额', status: 0, startDate: '2026-09-07T07:30:00+0800' },
        { id: 'school-item-done', title: '已处理', status: 1, startDate: '2026-09-15T08:00:00+0800' },
      ],
    });
    expect([...api.updatePayloads.entries()].every(([taskId, payload]) => payload.id === taskId)).toBe(true);
    expect(api.tasks.get('school-start-only')?.startDate).toBe('2026-09-07T08:30:00+0800');
    expect(api.tasks.get('school-start-only')?.dueDate).toBeUndefined();
    expect(api.tasks.get('home-no-date')?.dueDate).toBeUndefined();
    expect(api.tasks.get('home-completed')?.dueDate).toBe('2026-09-01T00:00:00+0800');
    expect(api.tasks.get('unrelated-dated')?.dueDate).toBe('2026-09-15T00:00:00+0800');

    await expect(syncTickTickRoutines({ api, calendarState, today: '2026-09-07' }))
      .resolves.toMatchObject({ updatedRoutineTasks: 0 });
  });

  it('按上海日期判断全天任务，今天未完成留在今天，今天完成后才排到明天', async () => {
    const calendarState = { tagMap: {
      '2026-09-04': 'home',
      '2026-09-05': 'home',
      '2026-09-10': 'school',
    } };
    const pendingApi = new FakeRoutineTickTickApi();
    const pending = pendingApi.tasks.get('home-dated')!;
    pending.repeatFlag = 'RRULE:FREQ=DAILY;INTERVAL=1';
    pending.isAllDay = true;
    // TickTick 用 UTC 表示上海全天任务：这里实际是 9 月 5 日零点。
    pending.startDate = '2026-09-04T16:00:00.000+0000';
    pending.dueDate = '2026-09-04T16:00:00.000+0000';

    await syncTickTickRoutines({ api: pendingApi, calendarState, today: '2026-09-04' });
    expect(pendingApi.tasks.get('home-dated')).toMatchObject({
      startDate: '2026-09-03T16:00:00.000+0000',
      dueDate: '2026-09-03T16:00:00.000+0000',
    });

    const completedApi = new FakeRoutineTickTickApi();
    const next = completedApi.tasks.get('home-dated')!;
    next.repeatFlag = 'RRULE:FREQ=DAILY;INTERVAL=1';
    next.isAllDay = true;
    next.startDate = '2026-09-04T16:00:00.000+0000';
    next.dueDate = '2026-09-04T16:00:00.000+0000';
    completedApi.tasks.set('home-dated-completed-today', {
      ...next,
      id: 'home-dated-completed-today',
      status: 2,
      completedTime: '2026-09-04T08:30:00.000+0000',
      startDate: '2026-09-03T16:00:00.000+0000',
      dueDate: '2026-09-03T16:00:00.000+0000',
    });

    const result = await syncTickTickRoutines({ api: completedApi, calendarState, today: '2026-09-04' });
    expect(completedApi.tasks.get('home-dated')).toMatchObject({
      startDate: '2026-09-04T16:00:00.000+0000',
      dueDate: '2026-09-04T16:00:00.000+0000',
    });
    expect(completedApi.updatePayloads.has('home-dated')).toBe(false);
    expect(result.routineTargets.home).toBe('2026-09-04');
  });

  it('凌晨的完成算今天，明天离家则等下次回家，不重排已完成记录', async () => {
    const api = new FakeRoutineTickTickApi();
    const task = api.tasks.get('home-dated')!;
    Object.assign(task, {
      repeatFlag: 'RRULE:FREQ=DAILY;INTERVAL=1', isAllDay: true,
      startDate: '2026-09-03T16:00:00.000+0000', dueDate: '2026-09-03T16:00:00.000+0000',
    });
    const completed = { ...task, id: 'home-history', status: 2, completedTime: '2026-09-03T16:05:00.000+0000' };
    api.tasks.set(completed.id, completed);
    const calendarState = { tagMap: { '2026-09-04': 'home', '2026-09-05': 'intern', '2026-10-01': 'home' } };
    const options = { api, calendarState, today: '2026-09-04' };
    await syncTickTickRoutines(options);
    expect(api.tasks.get(task.id)?.dueDate).toBe('2026-09-30T16:00:00.000+0000');
    expect(api.tasks.get(completed.id)).toEqual(completed);
    expect(api.updatePayloads.has(completed.id)).toBe(false);
    await expect(syncTickTickRoutines(options)).resolves.toMatchObject({ updatedRoutineTasks: 0 });
  });

  it('昨天完成不算今天完成，其他父任务的同名完成记录也不影响今天', async () => {
    const api = new FakeRoutineTickTickApi();
    const task = api.tasks.get('home-dated')!;
    Object.assign(task, {
      repeatFlag: 'RRULE:FREQ=DAILY;INTERVAL=1', isAllDay: true,
      startDate: '2026-09-04T16:00:00.000+0000', dueDate: '2026-09-04T16:00:00.000+0000',
    });
    api.tasks.set('yesterday-done', { ...task, id: 'yesterday-done', status: 2, completedTime: '2026-09-03T15:59:59.000+0000' });
    api.tasks.set('other-parent-done', {
      ...task, id: 'other-parent-done', parentId: 'other-parent', status: 2, completedTime: '2026-09-04T01:00:00.000+0000',
    });
    const options = { api, calendarState: { tagMap: { '2026-09-04': 'home', '2026-09-05': 'home' } }, today: '2026-09-04' };
    await syncTickTickRoutines(options);
    expect(api.tasks.get(task.id)?.dueDate).toBe('2026-09-03T16:00:00.000+0000');
    await expect(syncTickTickRoutines(options)).resolves.toMatchObject({ updatedRoutineTasks: 0 });
  });

  it('在校任务完成后次日实习也可执行，清单项按本地日期移动且保留完成状态', async () => {
    const api = new FakeRoutineTickTickApi();
    const task = api.tasks.get('school-dated')!;
    Object.assign(task, {
      repeatFlag: 'RRULE:FREQ=DAILY;INTERVAL=1', isAllDay: true, timeZone: 'Asia/Shanghai',
      startDate: '2026-09-03T16:00:00.000+0000', dueDate: '2026-09-03T16:00:00.000+0000',
      items: [
        { id: 'unchecked', title: '未完成清单项', status: 0, startDate: '2026-09-03T16:00:00.000+0000' },
        { id: 'checked', title: '已完成清单项', status: 1, startDate: '2026-09-03T16:00:00.000+0000' },
      ],
    });
    api.tasks.set('school-history', { ...task, id: 'school-history', status: 2, completedTime: '2026-09-04T01:00:00+0000' });
    const calendarState = { tagMap: { '2026-09-04': 'school', '2026-09-05': 'intern' } };
    await syncTickTickRoutines({ api, calendarState, today: '2026-09-04' });
    expect(api.tasks.get(task.id)).toMatchObject({
      dueDate: '2026-09-04T16:00:00.000+0000',
      items: [
        { id: 'unchecked', status: 0, startDate: '2026-09-04T16:00:00.000+0000' },
        { id: 'checked', status: 1, startDate: '2026-09-03T16:00:00.000+0000' },
      ],
    });
  });

  it('今天完成但没有下一场景时使用下个春节，未设日期的任务不新增日期', async () => {
    const api = new FakeRoutineTickTickApi();
    const task = api.tasks.get('home-dated')!;
    Object.assign(task, {
      repeatFlag: 'RRULE:FREQ=DAILY;INTERVAL=1', isAllDay: true,
      startDate: '2026-09-03T16:00:00.000+0000', dueDate: '2026-09-03T16:00:00.000+0000',
    });
    api.tasks.set('home-history', { ...task, id: 'home-history', status: 2, completedTime: '2026-09-04T01:00:00+0000' });
    await syncTickTickRoutines({ api, calendarState: { tagMap: { '2026-09-04': 'home' } }, today: '2026-09-04' });
    expect(api.tasks.get(task.id)?.dueDate).toBe('2027-02-05T16:00:00.000+0000');
    expect(api.tasks.get('home-no-date')?.startDate).toBeUndefined();
    expect(api.tasks.get('home-no-date')?.dueDate).toBeUndefined();
  });

  it('找不到 routine 时明确报错，不报告零项同步成功', async () => {
    const api = new FakeRoutineTickTickApi();
    api.tasks.delete('home-root');
    await expect(syncTickTickRoutines({ api, calendarState: { tagMap: {} }, today: '2026-09-04' }))
      .rejects.toThrow('找不到“在家routine”父任务或清单');
    expect(api.updateCalls).toBe(0);
  });

  it('写入后回读缺少日期不能报告同步成功', async () => {
    const api = new FakeRoutineTickTickApi();
    api.getTask = async (_projectId, taskId) => {
      const task = api.tasks.get(taskId)!;
      return { id: task.id, projectId: task.projectId, title: task.title, status: 0 };
    };
    await expect(syncTickTickRoutines({ api, calendarState: { tagMap: { '2026-09-04': 'home' } }, today: '2026-09-04' }))
      .rejects.toThrow('未正确更新');
  });

  it('除夕完成且没有下次场景时，不会跳过明天的春节', async () => {
    const api = new FakeRoutineTickTickApi();
    const task = api.tasks.get('home-dated')!;
    Object.assign(task, {
      repeatFlag: 'RRULE:FREQ=DAILY;INTERVAL=1', isAllDay: true,
      startDate: '2027-02-04T16:00:00.000+0000', dueDate: '2027-02-04T16:00:00.000+0000',
    });
    api.tasks.set('home-history', { ...task, id: 'home-history', status: 2, completedTime: '2027-02-05T01:00:00+0000' });
    await syncTickTickRoutines({ api, calendarState: { tagMap: { '2027-02-05': 'home' } }, today: '2027-02-05' });
    expect(api.tasks.get(task.id)?.dueDate).toBe('2027-02-05T16:00:00.000+0000');
  });

  it('加密保存并还原个人 API Token', () => {
    const encrypted = encryptTickTickToken('personal-token', 'sync-secret');
    expect(encrypted.data).not.toContain('personal-token');
    expect(decryptTickTickToken(encrypted, 'sync-secret')).toBe('personal-token');
  });

  it('按出门当天平移模板日期', () => {
    expect(shiftTickTickDate('2026-11-19T08:30:00+0800', '2026-11-20', '2027-01-10'))
      .toBe('2027-01-09T08:30:00+0800');
  });

  it('验证清单、模板和唯一日期锚点', async () => {
    const api = new FakeTickTickApi();
    const template = await discoverTickTickTemplate(api);
    expect(template.projectId).toBe('play');
    expect(template.tasks.map((task) => task.id)).toEqual([
      'template-root', 'template-month', 'template-before', 'template-day',
    ]);
    expect(template.anchorDate).toBe('2026-11-20');
    await expect(readConnectedTickTickTemplate(api, {
      projectId: 'play', templateRootId: 'template-root',
    })).resolves.toMatchObject({ anchorDate: '2026-11-20' });
  });

  it('复制完整树、重置完成状态，并在边界变化时保留实例与进度', async () => {
    const api = new FakeTickTickApi();
    const state: TickTickTripSyncState = { instances: {} };
    const saveState = async () => undefined;
    let template = await discoverTickTickTemplate(api);

    const first = await reconcileTickTickTrips({
      api,
      template,
      trips: [
        { ...futureTrip, key: '2026-01-01', startDate: '2026-01-01', endDate: '2026-01-02', dates: ['2026-01-01', '2026-01-02'] },
        futureTrip,
      ],
      state,
      today: '2026-09-03',
      saveState,
    });

    expect(first).toMatchObject({ createdTrips: 1, activeTrips: 1 });
    expect(api.createCalls).toBe(4);
    const instance = state.instances['2027-01-10'];
    const root = api.tasks.get(instance.rootTaskId!);
    const before = api.tasks.get(instance.taskIdsByTemplateId['template-before'])!;
    const month = api.tasks.get(instance.taskIdsByTemplateId['template-month'])!;
    expect(root).toMatchObject({ title: '东京 · 出门todo', dueDate: '2027-01-10T00:00:00+0800', content: '模板说明\n\n带护照' });
    expect(before).toMatchObject({ title: '东京 · 出门前一天', dueDate: '2027-01-09T00:00:00+0800', parentId: root?.id });
    expect(month.title).toBe('东京 · 出门前一个月');
    expect(month.status).toBe(0);
    expect(before.items?.[0].status).toBe(0);

    before.status = 2;
    before.items![0].status = 1;
    before.items!.push({ id: 'manual-item', title: '临时增加', status: 1 });
    api.tasks.set(before.id, before);
    api.tasks.get('template-before')!.items!.push({ id: 'template-camera', title: '相机', status: 0 });
    template = await readConnectedTickTickTemplate(api, { projectId: 'play', templateRootId: 'template-root' });
    const expandedTrip = {
      ...futureTrip,
      key: '2027-01-09',
      startDate: '2027-01-09',
      dates: ['2027-01-09', ...futureTrip.dates],
    };
    await reconcileTickTickTrips({ api, template, trips: [expandedTrip], state, today: '2026-09-03', saveState });

    expect(api.createCalls).toBe(4);
    expect(state.instances['2027-01-10']).toBeUndefined();
    expect(state.instances['2027-01-09'].rootTaskId).toBe(root?.id);
    const updatedBefore = api.tasks.get(before.id)!;
    expect(updatedBefore.title).toBe('东京 · 出门前一天');
    expect(updatedBefore.status).toBe(2);
    expect(updatedBefore.items?.map((item) => item.title)).toEqual(['随身包', '相机', '临时增加']);
    expect(updatedBefore.items?.find((item) => item.title === '随身包')?.status).toBe(1);
  });

  it('取消尚未结束的行程时删除映射任务，历史实例保持不动', async () => {
    const api = new FakeTickTickApi();
    const template = await discoverTickTickTemplate(api);
    const state: TickTickTripSyncState = { instances: {} };
    const saveState = async () => undefined;
    await reconcileTickTickTrips({ api, template, trips: [futureTrip], state, today: '2026-09-03', saveState });
    await reconcileTickTickTrips({ api, template, trips: [], state, today: '2026-09-03', saveState });
    expect(state.instances).toEqual({});
    expect(api.deleteCalls).toBe(4);

    state.instances.history = {
      tripKey: 'history', startDate: '2026-01-01', endDate: '2026-01-02', dates: ['2026-01-01'], name: '历史',
      rootTaskId: 'past-root', taskIdsByTemplateId: { 'template-root': 'past-root' }, itemIdsByTemplateTaskId: {},
    };
    api.tasks.set('past-root', { id: 'past-root', projectId: 'play', title: '历史 · 出门todo' });
    await reconcileTickTickTrips({ api, template, trips: [], state, today: '2026-09-03', saveState });
    expect(state.instances.history).toBeDefined();
    expect(api.tasks.has('past-root')).toBe(true);
  });

  it('模板删除任务时保留实例中手工添加的任务', async () => {
    const api = new FakeTickTickApi();
    let template = await discoverTickTickTemplate(api);
    const state: TickTickTripSyncState = { instances: {} };
    const saveState = async () => undefined;
    await reconcileTickTickTrips({ api, template, trips: [futureTrip], state, today: '2026-09-03', saveState });
    const instance = state.instances[futureTrip.key];
    const removedGeneratedId = instance.taskIdsByTemplateId['template-before'];
    api.tasks.set('manual-child', {
      id: 'manual-child', projectId: 'play', parentId: removedGeneratedId, title: '临时证件', status: 0,
    });
    api.tasks.delete('template-before');
    template = await readConnectedTickTickTemplate(api, { projectId: 'play', templateRootId: 'template-root' });

    await reconcileTickTickTrips({ api, template, trips: [futureTrip], state, today: '2026-09-03', saveState });

    expect(api.tasks.has(removedGeneratedId)).toBe(false);
    expect(api.tasks.get('manual-child')?.parentId).toBe(instance.rootTaskId);
  });
});
