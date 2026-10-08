import { describe, it, expect, vi, beforeEach } from 'vitest';
import { syncPeriodPredictionTask, PERIOD_PREDICTION_TITLE } from './_ticktickPeriodPrediction';
import { DEFAULT_CYCLE } from '../src/utils/bonLife';

vi.mock('./_lifeSwimming.js', () => ({
  readSwimmingCycle: vi.fn(),
}));

describe('syncPeriodPredictionTask', () => {
  const api = {
    createTask: vi.fn(),
    updateTask: vi.fn(),
    getTask: vi.fn(),
  };
  const connection = { projectId: 'p1' } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('如果没有预测日期，则不执行操作', async () => {
    vi.mocked(await import('./_lifeSwimming.js')).readSwimmingCycle.mockResolvedValue({
      cycle: DEFAULT_CYCLE,
      periods: [],
    });
    const result = await syncPeriodPredictionTask(api as any, { connection, tasks: [], today: '2026-10-08' });
    expect(result).toEqual({ updated: 0, created: 0 });
    expect(api.createTask).not.toHaveBeenCalled();
  });

  it('如果预测日期存在且没有任务，则在预测日前两天创建任务', async () => {
    // lastPeriodStart: 10-01, cycle: 28 days -> next: 10-29. target: 10-27
    vi.mocked(await import('./_lifeSwimming.js')).readSwimmingCycle.mockResolvedValue({
      cycle: { ...DEFAULT_CYCLE, lastPeriodStart: '2026-10-01', cycleLength: 28, periodLength: 5, automatic: false },
      periods: ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'],
    });
    const result = await syncPeriodPredictionTask(api as any, { connection, tasks: [], today: '2026-10-08' });
    expect(result).toEqual({ updated: 0, created: 1 });
    expect(api.createTask).toHaveBeenCalledWith(expect.objectContaining({
      title: PERIOD_PREDICTION_TITLE,
      startDate: '2026-10-27T00:00:00+0800',
      priority: 5,
      tags: ['当天', '活'],
    }));
  });

  it('如果已存在任务且日期一致，则不更新', async () => {
    vi.mocked(await import('./_lifeSwimming.js')).readSwimmingCycle.mockResolvedValue({
      cycle: { ...DEFAULT_CYCLE, lastPeriodStart: '2026-10-01', cycleLength: 28, periodLength: 5, automatic: false },
      periods: ['2026-10-01'],
    });
    const existingTask = {
      id: 't1',
      title: PERIOD_PREDICTION_TITLE,
      status: 0,
      startDate: '2026-10-27T00:00:00+0800',
      dueDate: '2026-10-27T00:00:00+0800',
      isAllDay: true,
      priority: 5,
      tags: ['当天', '活'],
    };
    const result = await syncPeriodPredictionTask(api as any, { connection, tasks: [existingTask as any], today: '2026-10-08' });
    expect(result).toEqual({ updated: 0, created: 0 });
    expect(api.updateTask).not.toHaveBeenCalled();
  });

  it('如果预测日期变化，则更新现有任务', async () => {
    vi.mocked(await import('./_lifeSwimming.js')).readSwimmingCycle.mockResolvedValue({
      cycle: { ...DEFAULT_CYCLE, lastPeriodStart: '2026-10-01', cycleLength: 30, periodLength: 5, automatic: false }, // Changed from 28
      periods: ['2026-10-01'],
    });
    const existingTask = {
      id: 't1',
      title: PERIOD_PREDICTION_TITLE,
      projectId: 'p1',
      status: 0,
      startDate: '2026-10-27T00:00:00+0800', // Old target
      priority: 5,
      tags: ['当天', '活'],
    };
    // new next: 10-31, new target: 10-29
    const result = await syncPeriodPredictionTask(api as any, { connection, tasks: [existingTask as any], today: '2026-10-08' });
    expect(result).toEqual({ updated: 1, created: 0 });
    expect(api.updateTask).toHaveBeenCalledWith('t1', expect.objectContaining({
      startDate: '2026-10-29T00:00:00+0800',
    }));
  });
});
