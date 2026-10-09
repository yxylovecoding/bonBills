import ICAL from 'ical.js';
import { kv } from './_accountKv.js';
import { createHash } from 'node:crypto';
import { decryptTickTickToken, readAllTickTickTasks, routineRecurrence, TICKTICK_CONNECTION_KEY, TickTickOpenApiClient,
  type TickTickConnection, type TickTickTask } from './_ticktickTrips.js';
import { isCalendarDate } from '../src/utils/outlookCalendar.js';
import { DEFAULT_TRAINING_SETTINGS, isTrainingTitle, swimmingTrainingDates, trainingName, trainingProjectKey, type TrainingCompletion, type TrainingSettings, type TrainingSource, type TrainingTask } from '../src/utils/lifeTraining.js';
import type { LifeEntries } from '../src/utils/bonLife.js';
import { readHairWashSchedule, readSwimmingCycle, syncSwimmingSchedule } from './_lifeSwimming.js';
import { isHairWashTitle, type HairWashSchedule } from '../src/utils/lifeSwimming.js';
import { entriesKey, LIFE_SETTINGS_KEY, LIFE_TRAINING_ENTRIES_KEY } from './_bonLife.js';
import { collectCompleted, shanghaiDay } from './_lifeDone.js';
import { DAILY_PLAN_KEY, type DailyPlanState } from './_ticktickDailyPlan.js';
import { decryptOutlookConnection, fetchCalendar, parseOutlookCalendar } from './_outlookCalendar.js';
import { OUTLOOK_CONNECTION_KEY, type OutlookConnection } from './_outlookSync.js';

// Outlook「干」日历的运动日程，按标题关键词同步成额外的训练完成记录。
// 游泳单独记为 `游泳` 项目：rollingTrainingPlan 把它判定为 swimming，
// 不会触发 mainDone，因此燃脂操等有氧轮换推荐照常。其他关键词统一记为
// `有氧` 分类：走 categoryHistory 分支成为非轮换的历史任务，触发 mainDone，
// 从而抑制七天计划里的有氧推荐。
const OUTLOOK_SWIM_KEYWORDS = ['游泳'] as const;
const OUTLOOK_AEROBIC_KEYWORDS = ['爬坡', '跑步', '骑行', 'HIIT'] as const;
const OUTLOOK_AEROBIC_BACKFILL_DAYS = 60;
const OUTLOOK_AEROBIC_MAX_SPAN_DAYS = 400;

export const TRAINING_SOURCE_KEY = 'bonlife:training-source:v1';
const WEEKDAYS: Record<string, string> = { MO: '一', TU: '二', WE: '三', TH: '四', FR: '五', SA: '六', SU: '日' };
interface TrainingSnapshot { tasks: TickTickTask[]; syncedAt: string; requestedAt: number; connectionId: string; completions?: TrainingCompletion[]; hairWash?: HairWashSchedule | null }
const connectionId = (connection: TickTickConnection) => createHash('sha256').update(connection.encryptedToken.data).digest('hex');

export function selectTrainingTasks(tasks: TickTickTask[]): TickTickTask[] {
  return tasks.filter((task) => typeof task.title === 'string' && isTrainingTitle(task.title) && (task.status ?? 0) === 0 && !task.completedTime)
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

export function trainingTask(task: TickTickTask, year: number, adjustDate: (date: string) => string = (date) => date): TrainingTask {
  const date = taskDate(task);
  const name = trainingName(task.title);
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
      const adjusted = adjustDate(occurrence);
      if (adjusted.startsWith(`${year}-`)) dates.add(adjusted);
    }
  } else if (date) {
    const adjusted = adjustDate(date);
    if (adjusted.startsWith(`${year}-`)) dates.add(adjusted);
  }
  return { id: `${task.projectId}:${task.id}`, title: task.title, name, schedule, dates: [...dates].sort(), notes, links,
    scheduledDate: date ?? undefined, repeatFlag: task.repeatFlag };
}

export async function readTrainingSource(year: number): Promise<TrainingSource> {
  const today = shanghaiDay();
  const currentYear = Number(today.slice(0, 4));
  const years = [...new Set([currentYear - 1, currentYear, year])].filter((value) => value >= 1900);
  const [snapshot, connection, { cycle, periods }, indexed, oldEntries, settings] = await Promise.all([
    kv.get<TrainingSnapshot>(TRAINING_SOURCE_KEY), kv.get<TickTickConnection>(TICKTICK_CONNECTION_KEY), readSwimmingCycle([year, currentYear]),
    kv.hgetall<LifeEntries>(LIFE_TRAINING_ENTRIES_KEY), Promise.all(years.map((value) => kv.hgetall<LifeEntries>(entriesKey(value)))),
    kv.hgetall<{ trainingProjects?: TrainingSettings }>(LIFE_SETTINGS_KEY),
  ]);
  const current = snapshot && (!connection || snapshot.connectionId === connectionId(connection)) ? snapshot : null;
  const entries = Object.fromEntries(Object.entries(Object.assign({}, ...oldEntries, indexed)).filter(([key]) => key.startsWith('training:'))) as LifeEntries;
  return { year, tasks: (current?.tasks ?? []).map((task) => {
    const result = trainingTask(task, year);
    if (task.title.includes('游泳')) result.dates = [...swimmingTrainingDates(result, today, `${year}-12-31`, cycle, periods, current?.hairWash)]
      .filter(date => date.startsWith(`${year}-`));
    return result;
  }), hairWash: current?.hairWash ?? null,
    completions: current?.completions, entries, periodDays: periods, settings: settings?.trainingProjects ?? DEFAULT_TRAINING_SETTINGS,
    connected: Boolean(connection), syncedAt: current?.syncedAt ?? null };
}

export function trainingCompletions(tasks: TickTickTask[], today: string): TrainingCompletion[] {
  const result = new Map<string, TrainingCompletion>();
  for (const task of tasks) {
    if (typeof task.title !== 'string' || !isTrainingTitle(task.title) || (task.status ?? 2) !== 2) continue;
    if (!task.completedTime || !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(task.completedTime)
      || !Number.isFinite(Date.parse(task.completedTime))) throw new Error('训练完成日期无效');
    const date = shanghaiDay(new Date(task.completedTime));
    if (date > today) continue;
    const project = trainingProjectKey(trainingName(task.title));
    result.set(`${project}:${date}`, { project, date });
  }
  return [...result.values()];
}

function matchOutlookAerobicProjects(title: string): string[] {
  const projects: string[] = [];
  if (OUTLOOK_SWIM_KEYWORDS.some((keyword) => title.includes(keyword))) projects.push('游泳');
  const upper = title.toUpperCase();
  if (OUTLOOK_AEROBIC_KEYWORDS.some((keyword) => keyword === 'HIIT' ? upper.includes('HIIT') : title.includes(keyword))) {
    projects.push('有氧');
  }
  return projects;
}

function outlookEventDays(event: { startDate: string; endDate: string; allDay: boolean }, startDate: string, endDate: string): string[] {
  const days: string[] = [];
  if (event.allDay) {
    // Outlook/ICS 全天事件 endDate 为不含端的下一天。按天展开，覆盖多日活动。
    let day = event.startDate < startDate ? startDate : event.startDate;
    const stop = event.endDate < endDate ? event.endDate : endDate;
    while (day < stop && days.length < OUTLOOK_AEROBIC_MAX_SPAN_DAYS) {
      days.push(day);
      day = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    }
    return days;
  }
  const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date(event.startDate));
  if (day >= startDate && day < endDate) days.push(day);
  return days;
}

// 读取 Outlook「干」日历的运动日程，产出额外的训练完成记录。
// 任何环节失败都降级为空数组，不阻塞 TickTick 训练同步。
export async function collectOutlookAerobicCompletions(today: string): Promise<TrainingCompletion[]> {
  if (!isCalendarDate(today)) return [];
  const connection = await kv.get<OutlookConnection>(OUTLOOK_CONNECTION_KEY);
  if (!connection) return [];
  const secret = (process.env.SYNC_SECRET || '').trim();
  if (!secret) return [];
  let input;
  try { input = decryptOutlookConnection(connection.encrypted, secret); } catch { return []; }
  const sources = input.sources.filter((source) => source.kind === 'work' || source.name === '干');
  if (!sources.length) return [];
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const shift = (offset: number) => new Date(todayMs + offset * 86_400_000).toISOString().slice(0, 10);
  const startDate = shift(-OUTLOOK_AEROBIC_BACKFILL_DAYS);
  const endDate = shift(1);
  const result = new Map<string, TrainingCompletion>();
  await Promise.all(sources.map(async (source) => {
    let text: string;
    try { text = await fetchCalendar(source.url); } catch { return; }
    let events;
    try {
      events = parseOutlookCalendar(text, source.kind, startDate, endDate, false, true,
        { timezone: 'Asia/Shanghai', includeFree: true });
    } catch { return; }
    for (const event of events) {
      const projects = matchOutlookAerobicProjects(String(event.title || ''));
      if (!projects.length) continue;
      for (const date of outlookEventDays(event, startDate, endDate)) {
        if (date > today) continue;
        for (const project of projects) {
          const key = `${project}:${date}`;
          if (!result.has(key)) result.set(key, { project, date });
        }
      }
    }
  }));
  return [...result.values()];
}

export async function syncTrainingSource(year: number, options: { lockHeld?: boolean } = {}): Promise<TrainingSource> {
  const requestedAt = Date.now();
  const connection = await kv.get<TickTickConnection>(TICKTICK_CONNECTION_KEY);
  if (!connection) return readTrainingSource(year);
  if (!options.lockHeld) await syncSwimmingSchedule();
  try {
    const token = decryptTickTickToken(connection.encryptedToken, (process.env.SYNC_SECRET || '').trim());
    const api = new TickTickOpenApiClient(token, (process.env.TICKTICK_API_BASE_URL || '').trim() || undefined);
    const pending = await readAllTickTickTasks(api, [0]);
    const tasks = selectTrainingTasks(pending);
    const hairWash = readHairWashSchedule(pending);
    // Validate all dates/rules before replacing a working snapshot.
    tasks.forEach((task) => trainingTask(task, year));
    const [saved, daily] = await Promise.all([kv.get<TrainingSnapshot>(TRAINING_SOURCE_KEY), kv.get<DailyPlanState>(DAILY_PLAN_KEY)]);
    const previous = saved?.connectionId === connectionId(connection) ? saved : null;
    const history = daily?.connectionId === createHash('sha256').update(token).digest('hex') ? daily : null;
    const now = new Date();
    const through = Math.max(previous?.completions ? Date.parse(previous.syncedAt) || 0 : 0, history?.historyThrough ? Date.parse(history.historyThrough) || 0 : 0);
    const from = Math.max(now.getTime() - 60 * 86_400_000, through - 86_400_000);
    const historyProjects = [...new Set([...tasks, ...pending.filter(task => isHairWashTitle(task.title))].map(task => task.projectId))];
    const rows = historyProjects.length ? await collectCompleted(api, historyProjects, from, now.getTime(), Date.now() + 25_000) : [];
    const outlookCompletions = await collectOutlookAerobicCompletions(shanghaiDay(now));
    const completions = [...new Map([...(previous?.completions ?? []), ...trainingCompletions([...(history?.history ?? []), ...rows], shanghaiDay(now)), ...outlookCompletions]
      .map((completion) => [`${completion.project}:${completion.date}`, completion])).values()];
    const completedDates = [...new Set([...(previous?.hairWash?.completedDates ?? []), ...[...(history?.history ?? []), ...rows]
      .filter(task => isHairWashTitle(task.title) && (task.status ?? 2) === 2 && task.completedTime
        && Number.isFinite(Date.parse(task.completedTime)) && shanghaiDay(new Date(task.completedTime)) <= shanghaiDay(now))
      .map(task => shanghaiDay(new Date(task.completedTime!)))])].sort();
    const snapshot: TrainingSnapshot = { tasks, completions, hairWash: hairWash ? { ...hairWash, completedDates } : completedDates.length ? { completedDates } : null,
      requestedAt, syncedAt: now.toISOString(), connectionId: connectionId(connection) };
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
