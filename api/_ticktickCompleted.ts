import type { TickTickApi, TickTickTask } from './_ticktickTrips.js';
// Split dense ranges so provider result limits cannot silently drop completions.
export async function collectCompleted(api: Pick<TickTickApi, 'listCompletedTasks'>, projects: string[], start: number, end: number, deadline: number): Promise<TickTickTask[]> {
  if (Date.now() > deadline) throw new Error('TickTick 同步超时，请重试');
  const tasks = await api.listCompletedTasks(projects, new Date(start).toISOString(), new Date(end).toISOString());
  if (!Array.isArray(tasks)) throw new Error('TickTick 完成记录无效');
  if (tasks.length < 50) return tasks;
  if (end - start < 1000) throw new Error('TickTick 完成记录过多，无法完整读取');
  const middle = Math.floor((start + end) / 2);
  const left = await collectCompleted(api, projects, start, middle, deadline);
  const right = await collectCompleted(api, projects, middle + 1, end, deadline);
  return [...left, ...right];
}
