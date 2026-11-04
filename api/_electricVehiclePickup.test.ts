import { beforeEach, expect, it, vi } from 'vitest';
import { syncElectricVehiclePickup } from './_electricVehiclePickup';
import type { TickTickApi, TickTickTask } from './_ticktickTrips';
const outlook = vi.hoisted(() => vi.fn().mockResolvedValue({ enabled: true, created: 0, updated: 0 }));
vi.mock('./_outlookRecurringTaskEvents.js', () => ({ syncRecurringTaskOutlook: outlook }));
let tasks: TickTickTask[], api: TickTickApi;
const charge = (): TickTickTask => ({ id: 'charge', projectId: 'life', title: '电动车充电', status: 0, isAllDay: true, dueDate: '2026-11-02T00:00:00+0800' });
beforeEach(() => {
 tasks = [charge()]; outlook.mockClear();
 api = { getTask: vi.fn(async (_p, id) => structuredClone(tasks.find(t => t.id === id)!)),
 createTask: vi.fn(async payload => { const t = { ...payload, id: `pickup-${tasks.length}` } as TickTickTask; tasks.push(t); return structuredClone(t); }),
 updateTask: vi.fn(async (id, payload) => { const t = tasks.find(t => t.id === id)!; Object.assign(t, payload); return structuredClone(t); }),
 deleteTask: vi.fn(async (_project, id) => { tasks = tasks.filter(t => t.id !== id); }),
 } as unknown as TickTickApi;
});
const sync = (history: TickTickTask[] = [], excludedTaskIds = new Set<string>()) => syncElectricVehiclePickup(api, {
 tasks: structuredClone(tasks), history, excludedTaskIds, today: '2026-11-02', ticktickConnectionId: 'connection',
});
it('创建次日接车并重复运行不复制，Outlook 使用同一待办', async () => {
 expect(await sync()).toMatchObject({ created: 1 });
 expect(tasks[1]).toMatchObject({ title: '接电动车', startDate: '2026-11-03T07:20:00+0800', dueDate: '2026-11-03T07:40:00+0800' });
 expect(await sync()).toMatchObject({ created: 0, updated: 0 });
 expect(api.createTask).toHaveBeenCalledTimes(1);
 const args = outlook.mock.calls.at(-1)!;
 expect(args[1].tasks[0].id).toBe(tasks[1].id);
 expect(args[2].plan(tasks[1])).toMatchObject({ start: { dateTime: '2026-11-03T07:20:00' }, end: { dateTime: '2026-11-03T07:40:00' } });
});
it('同周期改期更新原待办并保留标签', async () => {
 await sync(); tasks[1].tags = ['routine']; tasks[0].dueDate = '2026-11-04T00:00:00+0800';
 expect(await sync()).toMatchObject({ created: 0, updated: 1 });
 expect(tasks[1]).toMatchObject({ tags: ['routine'], startDate: '2026-11-05T07:20:00+0800' });
});
it('接车已完成不补建', async () => {
 const done = { id: 'done', projectId: 'life', title: '接电动车', status: 2, dueDate: '2026-11-03T07:40:00+0800' };
 expect(await sync([done])).toMatchObject({ created: 0 });
});
it('模板后代不创建接车', async () => {
 tasks[0].parentId = 'template'; await sync([], new Set(['template'])); expect(api.createTask).not.toHaveBeenCalled();
});
it('充电完成后新周期不覆盖上一周期待接车辆', async () => {
 await sync(); const old = structuredClone(tasks[1]);
 const history = [{ ...tasks[0], status: 2, completedTime: '2026-11-02T12:00:00Z' }];
 tasks[0].dueDate = '2026-11-07T00:00:00+0800';
 await sync(history); expect(tasks.find(t => t.id === old.id)?.startDate).toBe(old.startDate);
 expect(tasks.some(t => t.startDate === '2026-11-08T07:20:00+0800')).toBe(true);
});
it('已完成充电仍补齐次日接车', async () => {
 tasks = [];
 expect(await sync([{ ...charge(), status: 2, completedTime: '2026-11-01T12:00:00Z' }])).toMatchObject({ created: 1 });
});
it('充电完成记录更换 ID 后沿用同周期接车，按实际完成日安排', async () => {
 const previous = { ...charge(), id: 'previous', status: 2, completedTime: '2026-10-26T14:27:13.000+0000' };
 tasks[0].dueDate = '2026-11-01T20:00:00+0800';
 await sync([previous]);
 const pickupId = tasks[1].id;
 tasks[1].content = tasks[1].content!.replace(/\\n/g, '\n');
 tasks[1].tags = ['居', '北京'];
 const completed = { ...tasks[0], id: 'completed-charge', status: 2, completedTime: '2026-11-02T05:27:36.000+0000' };
 tasks[0].dueDate = '2026-11-08T20:00:00+0800';
 await sync([previous, completed]);
 expect(tasks.find(t => t.id === pickupId)).toMatchObject({ startDate: '2026-11-03T07:20:00+0800', tags: ['居', '北京'] });
 expect(tasks.filter(t => t.title === '接电动车')).toHaveLength(2);
 expect(tasks.some(t => t.startDate === '2026-11-09T07:20:00+0800')).toBe(true);
});
it('跨日延期仍更新同周期原接车而不遗留逾期待办', async () => {
 await sync(); const id = tasks[1].id;
 tasks[0].dueDate = '2026-11-05T20:00:00+0800';
 const result = await syncElectricVehiclePickup(api, { tasks: structuredClone(tasks), history: [], excludedTaskIds: new Set(), today: '2026-11-05', ticktickConnectionId: 'connection', mode: 'tasks' });
 expect(result).toMatchObject({ created: 0, updated: 1 });
 expect(tasks.find(t => t.id === id)?.startDate).toBe('2026-11-06T07:20:00+0800');
});
it('同次完成产生的两个自动接车合并，保留用户标签和备注', async () => {
 const previous = { ...charge(), id: 'previous', status: 2, completedTime: '2026-10-26T14:27:13.000+0000' };
 const completed = { ...charge(), id: 'completed-charge', status: 2, completedTime: '2026-11-02T05:27:36.000+0000' };
 tasks[0].dueDate = '2026-11-08T20:00:00+0800';
 tasks.push({ id: 'original', projectId: 'life', title: '接电动车', status: 0, tags: ['居', '北京'], content: '(20m)\n带钥匙\nBonBills charging pickup: life/charge/2026-10-26T14:27:13.000+0000', startDate: '2026-11-02T07:20:00+0800', dueDate: '2026-11-02T07:40:00+0800' });
 tasks.push({ id: 'duplicate', projectId: 'life', title: '接电动车', status: 0, priority: 5, isAllDay: false, tags: [], content: '(20m)\nBonBills charging pickup: life/completed-charge/2026-10-26T14:27:13.000+0000', startDate: '2026-11-03T07:20:00+0800', dueDate: '2026-11-03T07:40:00+0800' });
 await sync([previous, completed]);
 expect(tasks.find(t => t.id === 'original')).toMatchObject({ startDate: '2026-11-03T07:20:00+0800', tags: ['居', '北京'], content: expect.stringContaining('带钥匙') });
 expect(tasks.some(t => t.id === 'duplicate')).toBe(false);
 expect(tasks.filter(t => t.title === '接电动车')).toHaveLength(2);
 expect(await sync([previous, completed])).toMatchObject({ created: 0, updated: 0, deleted: 0 });
});
it('北京时间凌晨完成的延期充电按完成日次日接车', async () => {
 tasks = [];
 await sync([{ ...charge(), dueDate: '2026-11-01T20:00:00+0800', status: 2, completedTime: '2026-11-01T16:10:00Z' }]);
 expect(tasks[0].startDate).toBe('2026-11-03T07:20:00+0800');
});
it('用户编辑过的两个接车不会自动删除', async () => {
 await sync();
 tasks[1].tags = ['居'];
 tasks.push({ ...tasks[1], id: 'edited-copy', content: tasks[1].content + '\n自定义备注' });
 await expect(sync()).rejects.toThrow('接电动车存在多个待办');
 expect(api.deleteTask).not.toHaveBeenCalled();
});
