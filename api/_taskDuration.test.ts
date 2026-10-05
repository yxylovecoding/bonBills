import { describe, expect, it, vi } from 'vitest';
import { annotatedMinutes } from './_taskDuration';
import { estimateTaskMinutes, planTickTickDay, refreshDailyHistory, type DailyPlanState } from './_ticktickDailyPlan';
import type { TickTickApi, TickTickTask } from './_ticktickTrips';
const task = (fields: Partial<TickTickTask> = {}): TickTickTask => ({ id: 'a', projectId: 'life', title: '任务', status: 0,
  isAllDay: true, dueDate: '2026-10-05T00:00:00+0800', ...fields });

describe('描述中的耗时', () => {
  it.each([['(1m)', 1], ['（1h）', 60], ['(1h1m)', 61], ['（1h1m）', 61], ['说明\n（ 1 H 15 M ）\n备注', 75],
    ['（１ｈ１ｍ）', 61], ['(0h30m)', 30], ['(2h0m)', 120], ['(90m)', 90], ['先写说明(参考资料)再标(2m)', 2], ['(10h)', 600]])('%s → %i 分钟', (content, expected) => {
    expect(annotatedMinutes(content)).toBe(expected);
    expect(estimateTaskMinutes(task({ content }))).toBe(expected);
    expect(estimateTaskMinutes(task({ desc: content }))).toBe(expected);
  });
  it.each(['(0m)', '(0h0m)', '(-1m)', '(1.5h)', '(1h1m左右)', '(1h1m2m)', '(1d)', '(1h', '1h1m', '(版本1m)', '()'])('不把 %s 误当完整耗时标注', content => {
    expect(annotatedMinutes(content)).toBeNull();
    expect(estimateTaskMinutes(task({ content }))).toBe(15);
  });
  it('描述优先于标题标签与时间区间；从前往后取首个有效总时长，不把分项重复相加', () => {
    expect(estimateTaskMinutes(task({ content: '(1h1m)', title: '任务 15m', tags: ['30m'], isAllDay: false,
      startDate: '2026-10-05T09:00:00+0800', dueDate: '2026-10-05T11:00:00+0800' }))).toBe(61);
    expect(estimateTaskMinutes(task({ content: '说明', desc: '(2h)', title: '任务(1h1m)' }))).toBe(120);
    expect(estimateTaskMinutes(task({ title: '任务(1h1m)' }))).toBe(61);
    expect(estimateTaskMinutes(task({ content: '总计(1h)\n步骤A(10m)\n步骤B(50m)' }))).toBe(60);
    expect(estimateTaskMinutes(task({ title: '学习 25分钟', content: '无估时' }))).toBe(25);
  });
  it('61分钟事项不能误计为1分钟，重要事项的描述估时不额外扣额度', () => {
    const s = (): DailyPlanState => ({ connectionId: 'same', history: [], deadlines: {} });
    const run = (tasks: TickTickTask[]) => planTickTickDay({ tasks, state: s(), today: '2026-10-05', calendarState: {}, budgetMinutes: 30,
      now: new Date('2026-10-05T09:00:00+08:00') });
    expect(run([task({ content: '(1h1m)' })]).summary.todayCount).toBe(0);
    expect(run([task({ title: '香香喷雾', content: '(1m)' })]).summary.plannedMinutes).toBe(1);
    expect(run([task(), task({ id: 'important', content: '(1h)', priority: 5 })]).summary.todayCount).toBe(1);
  });
  it('保留完成记录的描述，后续返回省略描述时不丢失，已做事项按标注计入当日用量', async () => {
    const completed = task({ id: 'done', status: 2, content: '(1h1m)', completedTime: '2026-10-05T03:00:00Z' });
    const s: DailyPlanState = { connectionId: 'same', history: [completed], deadlines: {} };
    const api = { listCompletedTasks: vi.fn(async () => [{ ...completed, content: undefined }]) } as unknown as TickTickApi;
    await refreshDailyHistory(api, [task()], s, new Date('2026-10-05T12:00:00+08:00'));
    expect(s.history[0].content).toBe('(1h1m)');
    expect(planTickTickDay({ tasks: [task()], state: s, today: '2026-10-05', calendarState: {}, budgetMinutes: 60,
      now: new Date('2026-10-05T12:00:00+08:00') }).summary.todayCount).toBe(0);
  });
});
