import { estimateCycle } from '../src/utils/lifeCycle.js';
import { readSwimmingCycle } from './_lifeSwimming.js';
import { type TickTickApi, type TickTickTask, type TickTickConnection } from './_ticktickTrips.js';

const DAY = 86_400_000;
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

export const PERIOD_PREDICTION_TITLE = '月经提醒';

export async function syncPeriodPredictionTask(api: TickTickApi, options: {
  connection: TickTickConnection,
  tasks: TickTickTask[],
  today: string,
}) {
  const { connection, tasks, today } = options;
  const year = Number(today.slice(0, 4));
  // Read current and next year to handle end-of-year predictions
  const { cycle, periods } = await readSwimmingCycle([year, year + 1]);

  const prediction = estimateCycle(cycle, periods, today);
  if (!prediction.nextPeriodStart) return { updated: 0, created: 0 };

  const targetDate = addDays(prediction.nextPeriodStart, -2);
  // Find pending task with the stable title
  const existing = tasks.find(t => t.title === PERIOD_PREDICTION_TITLE && (t.status ?? 0) === 0);

  const priority = 5;
  const tags = [...new Set([...(existing?.tags ?? []), '当天', '活'])];
  const startDate = `${targetDate}T00:00:00+0800`;
  const dueDate = `${targetDate}T00:00:00+0800`;
  const isAllDay = true;

  if (existing) {
    const currentStartDate = existing.startDate?.slice(0, 10);
    const currentDueDate = existing.dueDate?.slice(0, 10);

    const needsUpdate = currentStartDate !== targetDate
      || currentDueDate !== targetDate
      || existing.priority !== priority
      || existing.isAllDay !== isAllDay
      || JSON.stringify([...(existing.tags ?? [])].sort()) !== JSON.stringify([...tags].sort());

    if (needsUpdate) {
      await api.updateTask(existing.id, {
        id: existing.id,
        projectId: existing.projectId,
        title: PERIOD_PREDICTION_TITLE,
        startDate,
        dueDate,
        isAllDay,
        priority,
        tags,
      });
      return { updated: 1, created: 0 };
    }
    return { updated: 0, created: 0 };
  } else {
    // Only create if the prediction is in the future.
    // If overdue (nextPeriodStart <= today), we don't create a new reminder.
    if (prediction.nextPeriodStart > today) {
       await api.createTask({
         projectId: connection.projectId,
         title: PERIOD_PREDICTION_TITLE,
         startDate,
         dueDate,
         isAllDay,
         priority,
         tags,
       });
       return { updated: 0, created: 1 };
    }
  }
  return { updated: 0, created: 0 };
}
