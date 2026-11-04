import { describe, expect, it, vi } from 'vitest';
import { abandonedTodayTaskIds, readAbandonedTodayTaskIds } from './_ticktickAbandoned';
import type { TickTickApi, TickTickTask } from './_ticktickTrips';

const today = '2026-11-04', now = new Date(`${today}T16:00:00+08:00`);
const task = (id: string, fields: Partial<TickTickTask> = {}): TickTickTask => ({
  id, projectId: 'life', title: '吃坚果', status: 0, repeatFlag: 'RRULE:FREQ=DAILY', ...fields,
});
const abandoned = (fields: Partial<TickTickTask> = {}) => task('old', { status: -1,
  completedTime: `${today}T08:00:00+08:00`, ...fields });

describe('当天放弃保护', () => {
  it('重复任务换 ID 后仍保护唯一同系列；放弃记录不要求携带重复规则', () => {
    expect(abandonedTodayTaskIds([task('next')], [abandoned({ repeatFlag: undefined })], today, now)).toEqual(new Set(['next']));
  });
  it('准确 ID 不依赖标题；不同清单、父任务、同名歧义和非重复任务不猜配', () => {
    const open = [task('exact', { title: '改名' }), task('duplicate-a'), task('duplicate-b'),
      task('other-list', { projectId: 'other' }), task('child', { parentId: 'parent' }), task('once', { repeatFlag: undefined })];
    expect(abandonedTodayTaskIds(open, [abandoned(), abandoned({ id: 'exact' })], today, now)).toEqual(new Set(['exact']));
  });
  it('按北京时间判断当天，次日恢复；忽略未来记录和正常完成', () => {
    const records = [abandoned({ completedTime: '2026-11-03T16:00:00Z' })];
    expect(abandonedTodayTaskIds([task('next')], records, today, now)).toEqual(new Set(['next']));
    expect(abandonedTodayTaskIds([task('next')], records, '2026-11-05', new Date('2026-11-05T08:00:00+08:00'))).toEqual(new Set());
    expect(abandonedTodayTaskIds([task('next')], [abandoned({ completedTime: '2026-11-03T15:59:59Z' }),
      abandoned({ completedTime: `${today}T18:00:00+08:00` }), abandoned({ status: 2 })], today, now)).toEqual(new Set());
  });
  it.each([undefined, 'bad', `${today}T08:00:00`])('时间无效时停止，不能当成没有放弃记录：%s', completedTime => {
    expect(() => abandonedTodayTaskIds([task('next')], [abandoned({ completedTime })], today, now)).toThrow('放弃记录无效');
  });
  it('按清单只读查询放弃记录，不调用完成接口', async () => {
    const filterTasks = vi.fn(async () => [abandoned()]);
    const api = { filterTasks } as unknown as TickTickApi;
    expect(await readAbandonedTodayTaskIds(api, [task('next')], today, now)).toEqual(new Set(['next']));
    expect(filterTasks).toHaveBeenCalledExactlyOnceWith(['life'], [-1]);
  });
  it('达到返回上限、意外状态、跨清单或读取失败均停止重排', async () => {
    for (const records of [Array.from({ length: 200 }, () => abandoned()), [abandoned({ status: 0 })], [abandoned({ projectId: 'other' })]]) {
      await expect(readAbandonedTodayTaskIds({ filterTasks: async () => records } as unknown as TickTickApi, [task('next')], today, now)).rejects.toThrow('未完整读取');
    }
    await expect(readAbandonedTodayTaskIds({ filterTasks: async () => { throw new Error('offline'); } } as unknown as TickTickApi, [task('next')], today, now)).rejects.toThrow('offline');
  });
});
