import { describe, expect, it } from 'vitest';
import {
  buildTripSourcesFromSyncState,
  decryptTickTickToken,
  discoverTickTickTemplate,
  encryptTickTickToken,
  readConnectedTickTickTemplate,
  reconcileTickTickTrips,
  shiftTickTickDate,
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

  async filterTasks(projectId: string, statuses: number[]) {
    return [...this.tasks.values()].filter(
      (task) => task.projectId === projectId && statuses.includes(task.status ?? 0),
    );
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

const futureTrip = {
  key: '2027-01-10',
  startDate: '2027-01-10',
  endDate: '2027-01-12',
  dates: ['2027-01-10', '2027-01-11', '2027-01-12'],
  name: '东京',
  note: '带护照',
};

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
    expect(before).toMatchObject({ dueDate: '2027-01-09T00:00:00+0800', parentId: root?.id });
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
