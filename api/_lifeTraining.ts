import ICAL from 'ical.js';
import { kv } from '@vercel/kv';
import { createHash } from 'node:crypto';
import { decryptTickTickToken, readAllTickTickTasks, routineRecurrence, TICKTICK_CONNECTION_KEY, TickTickOpenApiClient,
  type TickTickConnection, type TickTickTask } from './_ticktickTrips.js';
import { isCalendarDate } from '../src/utils/outlookCalendar.js';
import type { TrainingSource, TrainingTask } from '../src/utils/lifeTraining.js';

export const TRAINING_SOURCE_KEY = 'bonlife:training-source:v1';
const MARKER = '运动是生活的第一个锚点';
const normalizeTitle = (title: string) => title.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '');
const WEEKDAYS: Record<string, string> = { MO: '一', TU: '二', WE: '三', TH: '四', FR: '五', SA: '六', SU: '日' };
interface TrainingSnapshot { tasks: TickTickTask[]; syncedAt: string; requestedAt: number; connectionId: string }
const connectionId = (connection: TickTickConnection) => createHash('sha256').update(connection.encryptedToken.data).digest('hex');

export function selectTrainingTasks(tasks: TickTickTask[]): TickTickTask[] {
  return tasks.filter((task) => typeof task.title === 'string' && normalizeTitle(task.title).includes(MARKER)
    && normalizeTitle(task.title) !== MARKER && (task.status ?? 0) === 0 && !task.completedTime)
    .map(({ id, projectId, title, startDate, dueDate, timeZone, repeatFlag, content, desc, items }) =>
      ({ id, projectId, title, startDate, dueDate, timeZone, repeatFlag, content, desc, items }));
}

function taskDate(task: TickTickTask): string | null {
  const value = task.startDate || task.dueDate;
  if (!value) return null;
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) return isCalendarDate(value.slice(0, 10)) ? value.slice(0, 10) : null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('训练日期无效');
  return new Intl.DateTimeFormat('sv-SE', { timeZone: task.timeZone || 'Asia/Shanghai' }).format(date);
}

export function trainingTask(task: TickTickTask, year: number): TrainingTask {
  const date = taskDate(task);
  const name = task.title.slice(0, task.title.indexOf('运动')).replace(/[\s·—\-:：]+$/u, '').trim() || task.title;
  const notes = [...new Set([task.content, task.desc, ...(task.items ?? []).map((item) => item.title)].filter((value): value is string => Boolean(value)))].join('\n');
  const links: TrainingTask['links'] = [];
  for (const match of notes.matchAll(/https:\/\/[^\s<>\[\]()（）]+/g)) {
    try {
      const url = new URL(match[0]);
      if (!url.username && !url.password && !links.some((link) => link.url === url.href)) links.push({ title: `跟练 ${links.length + 1}`, url: url.href });
    } catch { /* Keep invalid links as plain notes. */ }
  }
  const dates = new Set<string>();
  let schedule = date || '未设日期';
  if (routineRecurrence(task.repeatFlag) === 'unknown') throw new Error('训练重复规则暂不支持');
  if (task.repeatFlag && date) {
    const rule = ICAL.Recur.fromString(task.repeatFlag.toUpperCase().replace(/^RRULE:/, ''));
    const byDay = rule.getComponent('BYDAY');
    const weekdays = byDay.length ? byDay.map((day) => WEEKDAYS[day]).filter(Boolean) : ['日', '一', '二', '三', '四', '五', '六'][new Date(`${date}T00:00:00Z`).getUTCDay()].split('');
    schedule = rule.freq === 'WEEKLY' ? `${rule.interval > 1 ? `每 ${rule.interval} 周` : '每周'}${weekdays.join('、')}`
      : rule.freq === 'DAILY' ? `每${rule.interval > 1 ? ` ${rule.interval} ` : ''}天`
      : rule.freq === 'MONTHLY' ? `每${rule.interval > 1 ? ` ${rule.interval} ` : ''}月` : `每${rule.interval > 1 ? ` ${rule.interval} ` : ''}年`;
    const iterator = rule.iterator(ICAL.Time.fromDateString(date));
    const deadline = Date.now() + 1000;
    let iterations = 0;
    for (let next = iterator.next(); next; next = iterator.next()) {
      if (++iterations > 150_000 || Date.now() > deadline) throw new Error('训练重复日期过多');
      const occurrence = next.toString().slice(0, 10);
      if (occurrence >= `${year + 1}-01-01`) break;
      if (occurrence >= `${year}-01-01`) dates.add(occurrence);
    }
  } else if (date?.startsWith(`${year}-`)) dates.add(date);
  return { id: `${task.projectId}:${task.id}`, title: task.title, name, schedule, dates: [...dates].sort(), notes, links };
}

export async function readTrainingSource(year: number): Promise<TrainingSource> {
  const [snapshot, connection] = await Promise.all([kv.get<TrainingSnapshot>(TRAINING_SOURCE_KEY), kv.get<TickTickConnection>(TICKTICK_CONNECTION_KEY)]);
  const current = snapshot && (!connection || snapshot.connectionId === connectionId(connection)) ? snapshot : null;
  return { year, tasks: (current?.tasks ?? []).map((task) => trainingTask(task, year)), connected: Boolean(connection), syncedAt: current?.syncedAt ?? null };
}

export async function syncTrainingSource(year: number): Promise<TrainingSource> {
  const requestedAt = Date.now();
  const connection = await kv.get<TickTickConnection>(TICKTICK_CONNECTION_KEY);
  if (!connection) return readTrainingSource(year);
  try {
    const api = new TickTickOpenApiClient(decryptTickTickToken(connection.encryptedToken, (process.env.SYNC_SECRET || '').trim()), (process.env.TICKTICK_API_BASE_URL || '').trim() || undefined);
    const tasks = selectTrainingTasks(await readAllTickTickTasks(api, [0]));
    // Validate all dates/rules before replacing a working snapshot.
    tasks.forEach((task) => trainingTask(task, year));
    const snapshot: TrainingSnapshot = { tasks, requestedAt, syncedAt: new Date().toISOString(), connectionId: connectionId(connection) };
    const stored = await kv.eval<string[], number>(`
      local connection = redis.call('get', KEYS[1])
      if not connection or cjson.decode(connection).encryptedToken.data ~= ARGV[1] then return 0 end
      local previous = redis.call('get', KEYS[2])
      if previous and cjson.decode(previous).requestedAt > tonumber(ARGV[3]) then return 0 end
      redis.call('set', KEYS[2], ARGV[2])
      return 1
    `, [TICKTICK_CONNECTION_KEY, TRAINING_SOURCE_KEY], [connection.encryptedToken.data, JSON.stringify(snapshot), String(requestedAt)]);
    if (stored !== 1) throw new Error('连接或计划已更新');
    return readTrainingSource(year);
  } catch { throw new Error('TickTick 训练计划同步失败，已保留原计划，请重试'); }
}
