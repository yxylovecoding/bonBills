import { kv } from './_accountKv.js';
import { createHash } from 'node:crypto';
import { decryptTickTickToken, TICKTICK_CONNECTION_KEY, TickTickOpenApiClient, type TickTickApi, type TickTickConnection, type TickTickTask } from './_ticktickTrips.js';
import { lifeYear, type DoneItem, type DoneMonth } from '../src/utils/bonLife.js';
import { classifyDoneCategory, mergeDoneItems } from '../src/utils/lifeDone.js';
import { markedTaskMinutes } from '../src/utils/taskDuration.js';
import { readOutlookDoneMonth, syncOutlookDoneMonth } from './_lifeDoneOutlook.js';

export const doneKey = (month: string) => `bonlife:done:v1:${month}`;
export const doneSyncKey = (month: string) => `bonlife:done-sync:v1:${month}`;
export const DONE_PROJECT_NAMES_KEY = 'bonlife:done-project-names:v1';
export function doneMonth(year: unknown, month: unknown) {
  const y = lifeYear(year);
  if (!/^\d{1,2}$/.test(String(month)) || Number(month) < 1 || Number(month) > 12) throw new Error('月份无效');
  return `${y}-${String(Number(month)).padStart(2, '0')}`;
}
export const shanghaiDay = (date = new Date()) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(date);

export function completedItems(tasks: TickTickTask[], from: string, until: string, projectNames: Record<string, string> = {}, previous: Record<string, DoneItem> = {}): DoneItem[] {
  const result = new Map<string, DoneItem>();
  for (const task of tasks) {
    if ((task.status ?? 2) !== 2) continue;
    if (!task.id || !task.projectId || typeof task.title !== 'string' || !task.completedTime
      || !/(?:Z|[+-]\d{2}:?\d{2})$/.test(task.completedTime)) throw new Error('TickTick 完成记录缺少有效字段');
    const timestamp = new Date(task.completedTime);
    if (!Number.isFinite(timestamp.getTime())) throw new Error('TickTick 完成日期无效');
    const completedAt = timestamp.toISOString();
    const date = shanghaiDay(timestamp);
    if (date < from || date > until) continue;
    const id = createHash('sha256').update(JSON.stringify([task.projectId, task.id, completedAt])).digest('hex');
    const projectName = projectNames[task.projectId];
    const category = classifyDoneCategory(task.tags, projectName);
    // Completed-task responses can omit description fields. Keep an already
    // archived annotation in that case; an explicitly cleared description wins.
    const old = previous[id];
    const marked = markedTaskMinutes(task) ?? (task.content === undefined && task.desc === undefined
      && old?.title === task.title && old.durationBasis === 'task' ? old.durationMinutes ?? null : null);
    result.set(id, { id, taskId: task.id, projectId: task.projectId, title: task.title, completedAt, date, category, tags: task.tags ?? [],
      source: 'ticktick', durationMinutes: marked ?? 15, durationBasis: marked === null ? 'default' : 'task',
      ...(projectName ? { projectName } : {}) });
  }
  return [...result.values()];
}

// Split dense ranges so provider result limits cannot silently drop old completions.
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

export async function readDoneMonth(month: string): Promise<DoneMonth> {
  const [items, syncedAt, connection, projectNames, outlook] = await Promise.all([
    kv.hgetall<Record<string, DoneItem>>(doneKey(month)), kv.get<string>(doneSyncKey(month)),
    kv.get<TickTickConnection>(TICKTICK_CONNECTION_KEY),
    kv.hgetall<Record<string, string>>(DONE_PROJECT_NAMES_KEY),
    readOutlookDoneMonth(month),
  ]);
  const tasks = Object.values(items ?? {}).map((item) => {
    // Older snapshots predate category metadata. Recover their original list when known.
    const projectName = item.projectName || projectNames?.[item.projectId];
    return { ...item, ...(projectName ? { projectName } : {}),
      category: item.category ?? classifyDoneCategory(item.tags, projectName) };
  });
  return { month, ...outlook, items: mergeDoneItems(tasks, outlook.items), syncedAt, connected: Boolean(connection),
    needsTagSync: tasks.some((item) => !Array.isArray(item.tags)), needsDurationSync: tasks.some((item) => !item.durationBasis) };
}

async function syncTickTickDoneMonth(month: string, now: Date) {
  const connection = await kv.get<TickTickConnection>(TICKTICK_CONNECTION_KEY);
  if (!connection) return;
  const today = shanghaiDay(now);
  if (month > today.slice(0, 7)) return;
  try {
    const secret = (process.env.SYNC_SECRET || '').trim();
    const api = new TickTickOpenApiClient(decryptTickTickToken(connection.encryptedToken, secret), (process.env.TICKTICK_API_BASE_URL || '').trim() || undefined);
    const [projects, inbox] = await Promise.all([api.listProjects(), api.getProjectData('inbox')]);
    const projectIds = [...new Set([...projects.map((project) => project.id), inbox.project?.id || 'inbox', ...inbox.tasks.map((task) => task.projectId)])];
    const projectNames = Object.fromEntries([...projects, ...(inbox.project ? [inbox.project] : [])]
      .filter((project) => typeof project.name === 'string').map((project) => [project.id, project.name]));
    const [year, number] = month.split('-').map(Number);
    const lastDay = new Date(Date.UTC(year, number, 0)).getUTCDate();
    const from = `${month}-01`;
    const until = month === today.slice(0, 7) ? today : `${month}-${lastDay}`;
    const tasks = await collectCompleted(api, projectIds, Date.parse(`${from}T00:00:00+08:00`),
      Math.min(now.getTime(), Date.parse(`${until}T23:59:59.999+08:00`)), Date.now() + 35_000);
    const previous = await kv.hgetall<Record<string, DoneItem>>(doneKey(month));
    const items = completedItems(tasks, from, until, projectNames, previous ?? {});
    const syncedAt = now.toISOString();
    const stored = await kv.eval<string[], number>(`
      local connection = redis.call('get', KEYS[1])
      if not connection or cjson.decode(connection).encryptedToken.data ~= ARGV[1] then return 0 end
      local items = cjson.decode(ARGV[2])
      for _, item in ipairs(items) do redis.call('hset', KEYS[2], item.id, cjson.encode(item)) end
      for id, name in pairs(cjson.decode(ARGV[4])) do redis.call('hset', KEYS[4], id, name) end
      local previous = redis.call('get', KEYS[3])
      if not previous or cjson.decode(previous) < ARGV[3] then redis.call('set', KEYS[3], cjson.encode(ARGV[3])) end
      return 1
    `, [TICKTICK_CONNECTION_KEY, doneKey(month), doneSyncKey(month), DONE_PROJECT_NAMES_KEY], [connection.encryptedToken.data, JSON.stringify(items), syncedAt, JSON.stringify(projectNames)]);
    if (stored !== 1) throw new Error('连接已变更');
  } catch {
    throw new Error('TickTick 完成记录同步失败，已保留历史，请重试');
  }
}

export async function syncDoneMonth(month: string, now = new Date()): Promise<DoneMonth> {
  const [ticktick, outlook] = await Promise.allSettled([syncTickTickDoneMonth(month, now), syncOutlookDoneMonth(month, now)]);
  if (ticktick.status === 'rejected') throw ticktick.reason;
  return { ...await readDoneMonth(month), ...(outlook.status === 'rejected'
    ? { outlookError: 'Outlook 日程同步失败，已保留历史，请重试' } : {}) };
}

export async function syncRecentLifeDone(now = new Date()) {
  // Include yesterday across month/year boundaries to archive late completions.
  const months = [...new Set([shanghaiDay(new Date(now.getTime() - 86_400_000)).slice(0, 7), shanghaiDay(now).slice(0, 7)])];
  for (const month of months) {
    const result = await syncDoneMonth(month, now);
    if (result.outlookError) throw new Error(result.outlookError);
  }
}
