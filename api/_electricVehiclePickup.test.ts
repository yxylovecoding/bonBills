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
 const history = [{ ...tasks[0], status: 2, completedTime: '2026-11-01T12:00:00Z' }];
 tasks[0].dueDate = '2026-11-07T00:00:00+0800';
 await sync(history); expect(tasks.find(t => t.id === old.id)?.startDate).toBe(old.startDate);
 expect(tasks.some(t => t.startDate === '2026-11-08T07:20:00+0800')).toBe(true);
});
it('已完成充电仍补齐次日接车', async () => {
 tasks = [];
 expect(await sync([{ ...charge(), status: 2, completedTime: '2026-11-01T12:00:00Z' }])).toMatchObject({ created: 1 });
});
