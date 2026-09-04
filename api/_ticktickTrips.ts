import { createCipheriv, createDecipheriv, createHash, createSecretKey, randomBytes, type KeyObject } from 'node:crypto';
import { Lunar } from 'lunar-typescript';

export const TICKTICK_CONNECTION_KEY = 'ticktick:connection:v1';
export const TICKTICK_SYNC_STATE_KEY = 'ticktick:trip-sync:v1';
export const TICKTICK_SYNC_LOCK_KEY = 'ticktick:trip-sync:lock';
export const TICKTICK_PROJECT_NAME = '玩';
export const TICKTICK_TEMPLATE_TITLE = '出门todo';
export const TICKTICK_ANCHOR_TITLE = '出门当天';
export const TICKTICK_WISH_PREPARATION_TITLE = '出门前七个月';
export const TICKTICK_HOME_ROUTINE_TITLE = '在家routine';
export const TICKTICK_SCHOOL_ROUTINE_TITLE = '在校routine';
export const TICKTICK_API_BASE_URL = 'https://api.ticktick.com/open/v1';

const TRIP_TAG_PREFIX = /^\d{2}\.\d{1,2}(?:\.\d{1,2})?\s*/;

export interface TickTickTripSource {
  key: string;
  startDate: string;
  endDate: string;
  dates: string[];
  name: string;
  note: string;
}

export interface EncryptedSecret {
  iv: string;
  tag: string;
  data: string;
}

export interface TickTickConnection {
  encryptedToken: EncryptedSecret;
  projectId: string;
  templateRootId: string;
  timeZone: string;
  connectedAt: string;
}

export interface TickTickChecklistItem {
  id?: string;
  title: string;
  status?: number | string | null;
  completedTime?: string;
  isAllDay?: boolean;
  sortOrder?: number;
  startDate?: string;
  timeZone?: string;
}

function checklistItemStatus(item: TickTickChecklistItem): 0 | 1 {
  if (item.status == null) return item.completedTime ? 1 : 0;
  const status = typeof item.status === 'string' && /^[012]$/.test(item.status.trim())
    ? Number(item.status.trim())
    : item.status;
  if (status === 0) return 0;
  // Task-style completion is 2; the checklist write contract only accepts 1.
  if (status === 1 || status === 2) return 1;
  throw new Error(`无法安全同步清单项“${item.title}”：未知状态 ${JSON.stringify(item.status)}`);
}

function taskWritePayload(payload: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(payload.items)) return payload;
  return {
    ...payload,
    items: payload.items.map((item: TickTickChecklistItem) => ({
      ...item,
      status: checklistItemStatus(item),
    })),
  };
}

export interface TickTickTask {
  id: string;
  projectId: string;
  title: string;
  content?: string;
  desc?: string;
  isAllDay?: boolean;
  startDate?: string;
  dueDate?: string;
  timeZone?: string;
  reminders?: string[];
  tags?: string[];
  repeatFlag?: string;
  priority?: number;
  sortOrder?: number;
  status?: number;
  completedTime?: string;
  kind?: string;
  parentId?: string;
  items?: TickTickChecklistItem[];
}

export interface TickTickProject {
  id: string;
  name: string;
}

export interface TickTickProjectData {
  project?: TickTickProject;
  tasks: TickTickTask[];
}

export interface TickTickTemplate {
  projectId: string;
  rootTask: TickTickTask;
  tasks: TickTickTask[];
  anchorTask: TickTickTask;
  anchorDate: string;
}

interface TickTickDateSnapshot {
  startDate: string | null;
  dueDate: string | null;
  isAllDay: boolean;
  timeZone: string;
}

interface TickTickDateSyncState {
  lastSynced: TickTickDateSnapshot;
  manual: boolean;
}

export interface TickTickTripInstance {
  tripKey: string;
  startDate: string;
  endDate: string;
  dates: string[];
  name: string;
  rootTaskId?: string;
  taskIdsByTemplateId: Record<string, string>;
  itemIdsByTemplateTaskId: Record<string, Record<string, string>>;
  taskDateStates?: Record<string, TickTickDateSyncState>;
  checklistDateStates?: Record<string, Record<string, TickTickDateSyncState>>;
}

export interface TickTickTripSyncState {
  instances: Record<string, TickTickTripInstance>;
  wishInstances?: Record<string, TickTickTripInstance>;
  lastSyncAt?: string;
  lastError?: string;
}

export interface TickTickSyncResult {
  createdTrips: number;
  updatedTrips: number;
  deletedTrips: number;
  activeTrips: number;
}

export interface TickTickRoutineTargets {
  home: string;
  school: string;
}

export interface TickTickRoutineSyncResult {
  updatedRoutineTasks: number;
  routineTargets: TickTickRoutineTargets;
  routineTaskCounts: { home: number; school: number };
}

export interface TickTickApi {
  listProjects(): Promise<TickTickProject[]>;
  getPreference(): Promise<{ timeZone?: string }>;
  getProjectData(projectId: string): Promise<TickTickProjectData>;
  filterTasks(projectIds: string | string[] | undefined, statuses: number[]): Promise<TickTickTask[]>;
  listCompletedTasks(projectIds: string[], startDate: string, endDate: string): Promise<TickTickTask[]>;
  getTask(projectId: string, taskId: string): Promise<TickTickTask>;
  createTask(payload: Record<string, unknown>): Promise<TickTickTask>;
  updateTask(taskId: string, payload: Record<string, unknown>): Promise<TickTickTask>;
  deleteTask(projectId: string, taskId: string): Promise<void>;
}

function encryptionKey(secret: string): KeyObject {
  return createSecretKey(Uint8Array.from(createHash('sha256').update(secret).digest()));
}

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, 'base64'));
}

function encodeBase64(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return Buffer.from(binary, 'binary').toString('base64');
}

export function encryptTickTickToken(token: string, secret: string): EncryptedSecret {
  const iv = Uint8Array.from(randomBytes(12));
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(secret), iv);
  const data = Uint8Array.from([...cipher.update(token, 'utf8'), ...cipher.final()]);
  return {
    iv: encodeBase64(iv),
    tag: encodeBase64(Uint8Array.from(cipher.getAuthTag())),
    data: encodeBase64(data),
  };
}

export function decryptTickTickToken(value: EncryptedSecret, secret: string): string {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(secret),
    decodeBase64(value.iv),
  );
  decipher.setAuthTag(decodeBase64(value.tag));
  const decrypted = Uint8Array.from([
    ...decipher.update(decodeBase64(value.data)),
    ...decipher.final(),
  ]);
  return new TextDecoder().decode(decrypted);
}

export class TickTickOpenApiClient implements TickTickApi {
  constructor(
    private readonly token: string,
    private readonly baseUrl = TICKTICK_API_BASE_URL,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
      signal: init.signal ?? AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      throw new Error(`TickTick ${response.status}${detail ? `: ${detail}` : ''}`);
    }
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  listProjects() {
    return this.request<TickTickProject[]>('/project');
  }

  getPreference() {
    return this.request<{ timeZone?: string }>('/preference', { method: 'POST' });
  }

  getProjectData(projectId: string) {
    return this.request<TickTickProjectData>(`/project/${encodeURIComponent(projectId)}/data`);
  }

  filterTasks(projectIds: string | string[] | undefined, statuses: number[]) {
    return this.request<TickTickTask[]>('/task/filter', {
      method: 'POST',
      body: JSON.stringify({
        ...(projectIds === undefined ? {} : { projectIds: Array.isArray(projectIds) ? projectIds : [projectIds] }),
        status: statuses,
      }),
    });
  }

  listCompletedTasks(projectIds: string[], startDate: string, endDate: string) {
    return this.request<TickTickTask[]>('/task/completed', {
      method: 'POST',
      body: JSON.stringify({ projectIds, startDate, endDate }),
    });
  }

  getTask(projectId: string, taskId: string) {
    return this.request<TickTickTask>(`/project/${encodeURIComponent(projectId)}/task/${encodeURIComponent(taskId)}`);
  }

  private async writeTask(path: string, payload: Record<string, unknown>) {
    const normalized = taskWritePayload(payload);
    try {
      return await this.request<TickTickTask>(path, { method: 'POST', body: JSON.stringify(normalized) });
    } catch (error) {
      console.error('[ticktick-task-write]', JSON.stringify({
        path,
        checklistStatuses: Array.isArray(normalized.items) ? normalized.items.map((item) => item.status) : [],
      }));
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`同步任务“${String(payload.title ?? payload.id ?? '')}”失败：${detail}`);
    }
  }

  createTask(payload: Record<string, unknown>) {
    return this.writeTask('/task', payload);
  }

  updateTask(taskId: string, payload: Record<string, unknown>) {
    return this.writeTask(`/task/${encodeURIComponent(taskId)}`, payload);
  }

  async deleteTask(projectId: string, taskId: string) {
    await this.request<void>(`/project/${encodeURIComponent(projectId)}/task/${encodeURIComponent(taskId)}`, {
      method: 'DELETE',
    });
  }
}

function taskDate(task: TickTickTask): string | null {
  const value = task.dueDate || task.startDate;
  const date = value?.slice(0, 10);
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function addCalendarDays(date: string, delta: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + delta);
  return value.toISOString().slice(0, 10);
}

function addCalendarMonths(date: string, delta: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  const day = value.getUTCDate();
  value.setUTCDate(1);
  value.setUTCMonth(value.getUTCMonth() + delta);
  const monthEnd = new Date(value);
  monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1, 0);
  value.setUTCDate(Math.min(day, monthEnd.getUTCDate()));
  return value.toISOString().slice(0, 10);
}

function isValidCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function nextChineseNewYear(afterDate: string): string {
  const year = Number(afterDate.slice(0, 4));
  // ICU's Chinese calendar differs by a day for some years (including 2027).
  // Regression dates are checked against https://www.hko.gov.hk/en/gts/time/conversion.htm
  const thisYear = Lunar.fromYmd(year, 1, 1).getSolar().toYmd();
  return thisYear > afterDate ? thisYear : Lunar.fromYmd(year + 1, 1, 1).getSolar().toYmd();
}

function calendarDayDifference(date: string, anchor: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${anchor}T00:00:00Z`)) / 86_400_000);
}

export function shiftTickTickDate(value: string | undefined, anchorDate: string, tripStartDate: string): string | undefined {
  if (!value) return undefined;
  const sourceDate = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sourceDate)) return value;
  const shiftedDate = addCalendarDays(tripStartDate, calendarDayDifference(sourceDate, anchorDate));
  return `${shiftedDate}${value.slice(10)}`;
}

function descendantsOf(tasks: TickTickTask[], rootId: string): TickTickTask[] {
  const byParent = new Map<string, TickTickTask[]>();
  for (const task of tasks) {
    if (!task.parentId) continue;
    const children = byParent.get(task.parentId) ?? [];
    children.push(task);
    byParent.set(task.parentId, children);
  }
  const result: TickTickTask[] = [];
  const visit = (id: string) => {
    const children = (byParent.get(id) ?? []).sort((a, b) => (b.sortOrder ?? 0) - (a.sortOrder ?? 0));
    for (const child of children) {
      result.push(child);
      visit(child.id);
    }
  };
  visit(rootId);
  return result;
}

function mergeTaskLists(primaryTasks: TickTickTask[], fallbackTasks: TickTickTask[]) {
  const tasksById = new Map<string, TickTickTask>();
  for (const task of [...primaryTasks, ...fallbackTasks]) {
    const existing = tasksById.get(task.id);
    tasksById.set(task.id, existing ? { ...task, ...existing } : task);
  }
  return [...tasksById.values()];
}

function mergeProjectTasks(projectData: TickTickProjectData, filteredTasks: TickTickTask[]) {
  // Project data carries hierarchy/checklist fields that /task/filter may omit.
  // Keep it authoritative while using the filter response only to fill missing tasks/fields.
  return mergeTaskLists(projectData.tasks, filteredTasks);
}

export async function discoverTickTickTemplate(api: TickTickApi): Promise<TickTickTemplate> {
  const projects = await api.listProjects();
  const projectsNamedPlay = projects.filter((project) => project.name.trim() === TICKTICK_PROJECT_NAME);
  if (projectsNamedPlay.length !== 1) throw new Error('找不到唯一的“玩”清单');
  const project = projectsNamedPlay[0];
  const [data, filteredTasks] = await Promise.all([
    api.getProjectData(project.id),
    api.filterTasks(project.id, [0, 2]),
  ]);
  const allTasks = mergeProjectTasks(data, filteredTasks);
  const roots = allTasks.filter((task) => task.title.trim() === TICKTICK_TEMPLATE_TITLE);
  if (roots.length !== 1) throw new Error('找不到唯一的“出门todo”模板');
  const rootTask = roots[0];
  const tasks = [rootTask, ...descendantsOf(allTasks, rootTask.id)];
  const anchors = tasks.filter((task) => task.title.trim() === TICKTICK_ANCHOR_TITLE && taskDate(task));
  if (anchors.length !== 1) throw new Error('模板需要唯一且带日期的“出门当天”任务');
  return {
    projectId: project.id,
    rootTask,
    tasks,
    anchorTask: anchors[0],
    anchorDate: taskDate(anchors[0])!,
  };
}

export async function readConnectedTickTickTemplate(
  api: TickTickApi,
  connection: Pick<TickTickConnection, 'projectId' | 'templateRootId'>,
): Promise<TickTickTemplate> {
  const [data, filteredTasks] = await Promise.all([
    api.getProjectData(connection.projectId),
    api.filterTasks(connection.projectId, [0, 2]),
  ]);
  const allTasks = mergeProjectTasks(data, filteredTasks);
  const rootTask = allTasks.find((task) => task.id === connection.templateRootId);
  if (!rootTask) throw new Error('TickTick 中的“出门todo”模板已不存在');
  const tasks = [rootTask, ...descendantsOf(allTasks, rootTask.id)];
  const anchors = tasks.filter((task) => task.title.trim() === TICKTICK_ANCHOR_TITLE && taskDate(task));
  if (anchors.length !== 1) throw new Error('模板需要唯一且带日期的“出门当天”任务');
  return {
    projectId: connection.projectId,
    rootTask,
    tasks,
    anchorTask: anchors[0],
    anchorDate: taskDate(anchors[0])!,
  };
}

export function buildTripSourcesFromSyncState(calendarState: unknown, tripState: unknown): TickTickTripSource[] {
  const calendar = calendarState && typeof calendarState === 'object' ? calendarState as Record<string, unknown> : {};
  const trip = tripState && typeof tripState === 'object' ? tripState as Record<string, unknown> : {};
  const tagMap = calendar.tagMap && typeof calendar.tagMap === 'object'
    ? calendar.tagMap as Record<string, unknown>
    : {};
  const tripTags = trip.tripTags && typeof trip.tripTags === 'object' ? trip.tripTags as Record<string, string> : {};
  const tripNotes = trip.tripNotes && typeof trip.tripNotes === 'object' ? trip.tripNotes as Record<string, string> : {};
  const tripSplits = trip.tripSplits && typeof trip.tripSplits === 'object' ? trip.tripSplits as Record<string, true> : {};
  const travelDates = Object.entries(tagMap)
    .filter(([, tag]) => tag === 'travel')
    .map(([date]) => date)
    .sort();
  const splitDates = new Set(Object.keys(tripSplits));
  const segments: string[][] = [];
  let current: string[] = [];
  for (const date of travelDates) {
    const previous = current.at(-1);
    const previousDay = previous ? new Date(`${previous}T00:00:00Z`) : null;
    if (previousDay) previousDay.setUTCDate(previousDay.getUTCDate() + 1);
    const contiguous = previousDay?.toISOString().slice(0, 10) === date;
    if (!previous || (contiguous && !splitDates.has(date))) {
      current.push(date);
      continue;
    }
    segments.push(current);
    current = [date];
  }
  if (current.length > 0) segments.push(current);

  const formatShortDate = (date: string) => {
    const [, month, day] = date.split('-');
    return `${Number(month)}月${Number(day)}日`;
  };
  return segments.map((dates) => {
    const startDate = dates[0];
    const endDate = dates.at(-1)!;
    const normalizedName = tripTags[startDate]?.trim().replace(TRIP_TAG_PREFIX, '').trim();
    return {
      key: startDate,
      startDate,
      endDate,
      dates,
      name: normalizedName || (startDate === endDate
        ? formatShortDate(startDate)
        : `${formatShortDate(startDate)}–${formatShortDate(endDate)}`),
      note: tripNotes[startDate]?.trim() ?? '',
    };
  });
}

export function buildWishPreparationSourcesFromSyncState(configState: unknown): TickTickTripSource[] {
  const stored = configState && typeof configState === 'object' ? configState as Record<string, unknown> : {};
  const config = stored.config && typeof stored.config === 'object' ? stored.config as Record<string, unknown> : {};
  const wishes = Array.isArray(config.wishes) ? config.wishes : [];
  const sources = new Map<string, TickTickTripSource>();
  for (const value of wishes) {
    if (!value || typeof value !== 'object') continue;
    const wish = value as Record<string, unknown>;
    if (wish.isActive !== true || wish.linkedTripStartDate) continue;
    if (typeof wish.id !== 'string' || !wish.id.trim() || typeof wish.name !== 'string' || !wish.name.trim()) continue;
    if (!isValidCalendarDate(wish.deadline)) continue;
    const preparationDate = addCalendarMonths(wish.deadline, -7);
    sources.set(wish.id, {
      key: wish.id,
      startDate: preparationDate,
      // 生命周期截止日仍是预计出发日；七个月前的准备日期已过也不能跳过未到期心愿。
      endDate: wish.deadline,
      dates: [preparationDate],
      name: wish.name.trim(),
      note: '',
    });
  }
  return [...sources.values()];
}

function wishPreparationTemplate(template: TickTickTemplate): TickTickTemplate {
  const roots = template.tasks.filter((task) =>
    /^出门前(?:七|7)个月$/.test(task.title.normalize('NFKC').replace(/\s/g, '')),
  );
  if (roots.length !== 1) throw new Error(`出门todo 模板需要唯一的“${TICKTICK_WISH_PREPARATION_TITLE}”任务`);
  const rootTask = roots[0];
  return {
    projectId: template.projectId,
    rootTask,
    tasks: [rootTask, ...descendantsOf(template.tasks, rootTask.id)],
    anchorTask: rootTask,
    anchorDate: taskDate(rootTask) ?? addCalendarMonths(template.anchorDate, -7),
  };
}

function calendarTagMapFromSyncState(calendarState: unknown): Record<string, unknown> {
  const calendar = calendarState && typeof calendarState === 'object' ? calendarState as Record<string, unknown> : {};
  return calendar.tagMap && typeof calendar.tagMap === 'object'
    ? calendar.tagMap as Record<string, unknown>
    : {};
}

function findRoutineTargetDate(
  tagMap: Record<string, unknown>,
  today: string,
  matches: (tag: unknown) => boolean,
  includeToday = true,
): string {
  if (includeToday && matches(tagMap[today])) return today;

  const nextDate = Object.keys(tagMap)
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && date > today && matches(tagMap[date]))
    .sort()[0];
  return nextDate ?? nextChineseNewYear(today);
}

export function getTickTickRoutineTargetDates(calendarState: unknown, today: string): TickTickRoutineTargets {
  const tagMap = calendarTagMapFromSyncState(calendarState);
  return {
    home: findRoutineTargetDate(tagMap, today, (tag) => tag === 'home'),
    school: findRoutineTargetDate(tagMap, today, (tag) => tag === 'school' || tag === 'intern'),
  };
}

function normalizedRoutineTitle(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase();
}

function calendarDateInTimeZone(value: string | undefined, timeZone = 'Asia/Shanghai'): string | null {
  if (!value) return null;
  const rawDate = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) return null;
  // Floating TickTick dates already contain their calendar date. Zoned values,
  // especially all-day midnight returned as the previous UTC day at 16:00,
  // must be interpreted in the task's timezone.
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)) return rawDate;
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return rawDate;
  try {
    const parts = new Intl.DateTimeFormat('en', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(instant);
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
    const year = part('year');
    const month = part('month');
    const day = part('day');
    return year && month && day ? `${year}-${month}-${day}` : rawDate;
  } catch {
    return rawDate;
  }
}

function routineTaskDate(task: TickTickTask): string | null {
  return calendarDateInTimeZone(task.dueDate || task.startDate, task.timeZone);
}

function routineOccurrenceKey(task: TickTickTask): string {
  // Completing a repeating task creates a history record with a new ID.
  // Keep the parent boundary so unrelated same-named tasks cannot postpone it.
  return JSON.stringify([task.projectId, task.parentId ?? '', task.title]);
}

function checklistItemDate(item: TickTickChecklistItem, fallbackTimeZone?: string): string | null {
  const date = calendarDateInTimeZone(item.startDate, item.timeZone || fallbackTimeZone);
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function shiftedRoutineItems(task: TickTickTask, targetDate: string): TickTickChecklistItem[] | undefined {
  return task.items?.map((item) => {
    const date = checklistItemDate(item, task.timeZone);
    const status = checklistItemStatus(item);
    if (!date || status !== 0) return { ...item, status };
    return {
      ...item,
      status,
      startDate: shiftTickTickDate(item.startDate, date, targetDate),
    };
  });
}

function routineTaskHasDate(task: TickTickTask): boolean {
  return Boolean(routineTaskDate(task)) || Boolean(task.items?.some(
    (item) => checklistItemStatus(item) === 0 && checklistItemDate(item, task.timeZone),
  ));
}

function routineTaskIsAligned(task: TickTickTask, targetDate: string): boolean {
  const date = routineTaskDate(task);
  if (date && date !== targetDate) return false;
  return !(task.items ?? []).some(
    (item) => checklistItemStatus(item) === 0
      && checklistItemDate(item, task.timeZone)
      && checklistItemDate(item, task.timeZone) !== targetDate,
  );
}

function routineTaskPayload(task: TickTickTask, targetDate: string): Record<string, unknown> {
  const scheduledDate = routineTaskDate(task);
  const shiftedStartDate = scheduledDate
    ? shiftTickTickDate(task.startDate, scheduledDate, targetDate)
    : task.startDate;
  const shiftedDueDate = scheduledDate
    ? shiftTickTickDate(task.dueDate, scheduledDate, targetDate)
    : task.dueDate;
  return {
    id: task.id,
    projectId: task.projectId,
    title: task.title,
    ...(task.content !== undefined ? { content: task.content } : {}),
    ...(task.desc !== undefined ? { desc: task.desc } : {}),
    ...(task.isAllDay !== undefined ? { isAllDay: task.isAllDay } : {}),
    ...(shiftedStartDate ? { startDate: shiftedStartDate } : {}),
    ...(shiftedDueDate ? { dueDate: shiftedDueDate } : {}),
    ...(task.timeZone ? { timeZone: task.timeZone } : {}),
    ...(task.reminders !== undefined ? { reminders: task.reminders } : {}),
    ...(task.tags !== undefined ? { tags: task.tags } : {}),
    ...(task.repeatFlag ? { repeatFlag: task.repeatFlag } : {}),
    ...(task.priority !== undefined ? { priority: task.priority } : {}),
    ...(task.sortOrder !== undefined ? { sortOrder: task.sortOrder } : {}),
    ...(task.kind ? { kind: task.kind } : {}),
    ...(task.parentId ? { parentId: task.parentId } : {}),
    ...(task.items !== undefined ? { items: shiftedRoutineItems(task, targetDate) } : {}),
  };
}

export async function syncTickTickRoutines(options: {
  api: TickTickApi;
  calendarState: unknown;
  today: string;
}): Promise<TickTickRoutineSyncResult> {
  const { api, calendarState, today } = options;
  const routineTargets = getTickTickRoutineTargetDates(calendarState, today);
  // /project omits the built-in Inbox. Discover tasks without a project filter,
  // then read complete data for every returned project, including the Inbox.
  const [projects, filteredTasks] = await Promise.all([
    api.listProjects(),
    api.filterTasks(undefined, [0]),
  ]);
  const projectIds = [...new Set([
    ...projects.map((project) => project.id),
    ...filteredTasks.map((task) => task.projectId),
  ])];
  const projectData = await Promise.all(projectIds.map((projectId) => api.getProjectData(projectId)));
  const activeTasks = mergeTaskLists(
    projectData.flatMap((data) => data.tasks),
    filteredTasks,
  ).filter((task) => (task.status ?? 0) === 0);
  const specs = [
    {
      key: 'home', title: TICKTICK_HOME_ROUTINE_TITLE, targetDate: routineTargets.home,
      matches: (tag: unknown) => tag === 'home',
    },
    {
      key: 'school', title: TICKTICK_SCHOOL_ROUTINE_TITLE, targetDate: routineTargets.school,
      matches: (tag: unknown) => tag === 'school' || tag === 'intern',
    },
  ] as const;
  let updatedRoutineTasks = 0;
  const routineTaskCounts = { home: 0, school: 0 };
  const scopes = specs.map((spec) => {
    const normalizedTitle = normalizedRoutineTitle(spec.title);
    const roots = activeTasks.filter((task) => normalizedRoutineTitle(task.title) === normalizedTitle);
    if (roots.length > 1) throw new Error(`TickTick 中存在多个“${spec.title}”父任务`);
    const root = roots[0];
    const sameNamedProjects = projects.filter(
      (project) => normalizedRoutineTitle(project.name) === normalizedTitle,
    );
    if (!root && sameNamedProjects.length > 1) throw new Error(`TickTick 中存在多个“${spec.title}”清单`);
    if (!root && !sameNamedProjects[0]) throw new Error(`TickTick 中找不到“${spec.title}”父任务或清单`);

    const scopedTasks = root
      ? descendantsOf(activeTasks.filter((task) => task.projectId === root.projectId), root.id)
      : sameNamedProjects[0]
        ? activeTasks.filter((task) => task.projectId === sameNamedProjects[0].id)
        : [];
    const tasks = scopedTasks.filter((task) => routineTaskHasDate(task));
    routineTaskCounts[spec.key] = tasks.length;
    return { ...spec, root, tasks };
  });

  const routineProjectIds = [...new Set(scopes.flatMap((scope) =>
    scope.root ? [scope.root.projectId] : scope.tasks.map((task) => task.projectId)))];
  const completedToday = await api.listCompletedTasks(
    routineProjectIds,
    `${today}T00:00:00+0800`,
    `${today}T23:59:59.999+0800`,
  );
  const completedKeys = new Set(completedToday
    .filter((task) => (task.status ?? 2) === 2
      && calendarDateInTimeZone(task.completedTime, 'Asia/Shanghai') === today)
    .map(routineOccurrenceKey));
  const tagMap = calendarTagMapFromSyncState(calendarState);

  for (const spec of scopes) {
    for (const task of spec.tasks) {
      const completedThisOccurrence = Boolean(task.repeatFlag)
        && spec.targetDate === today
        && completedKeys.has(routineOccurrenceKey(task));
      const taskTargetDate = completedThisOccurrence
        ? findRoutineTargetDate(tagMap, today, spec.matches, false)
        : spec.targetDate;
      if (routineTaskIsAligned(task, taskTargetDate)) continue;
      const payload = routineTaskPayload(task, taskTargetDate);
      await api.updateTask(task.id, payload);
      const updated = await api.getTask(task.projectId, task.id);
      const datesPersisted = (['startDate', 'dueDate'] as const).every((key) => {
        const expected = payload[key];
        if (typeof expected !== 'string') return true;
        return updated[key] === expected || Date.parse(updated[key] ?? '') === Date.parse(expected);
      });
      const itemsPersisted = !(task.items ?? []).some((item) => {
        if (checklistItemStatus(item) !== 0 || !checklistItemDate(item, task.timeZone)) return false;
        const saved = updated.items?.find((candidate) => candidate.id === item.id);
        return !saved || checklistItemDate(saved, updated.timeZone) !== taskTargetDate;
      });
      if (!updated?.id || !datesPersisted || !itemsPersisted
        || !routineTaskIsAligned(updated, taskTargetDate)) {
        throw new Error(`TickTick 未正确更新“${task.title}”的日期`);
      }
      updatedRoutineTasks += 1;
    }
  }

  return { updatedRoutineTasks, routineTargets, routineTaskCounts };
}

function templateDepth(task: TickTickTask, byId: Map<string, TickTickTask>): number {
  let depth = 0;
  let parentId = task.parentId;
  const seen = new Set<string>();
  while (parentId && byId.has(parentId) && !seen.has(parentId)) {
    seen.add(parentId);
    depth += 1;
    parentId = byId.get(parentId)?.parentId;
  }
  return depth;
}

function checklistItemKey(item: TickTickChecklistItem, index: number): string {
  return item.id || `index:${index}:${item.title}`;
}

function overlapCount(left: string[], right: string[]): number {
  const rightSet = new Set(right);
  return left.reduce((count, date) => count + (rightSet.has(date) ? 1 : 0), 0);
}

function baseTaskPayload(
  templateTask: TickTickTask,
  trip: TickTickTripSource,
  template: TickTickTemplate,
  parentId: string | undefined,
  items: TickTickChecklistItem[],
): Record<string, unknown> {
  const isRoot = templateTask.id === template.rootTask.id;
  const startDate = isRoot
    ? `${trip.startDate}T00:00:00+0800`
    : shiftTickTickDate(templateTask.startDate, template.anchorDate, trip.startDate);
  const dueDate = isRoot
    ? `${trip.startDate}T00:00:00+0800`
    : shiftTickTickDate(templateTask.dueDate, template.anchorDate, trip.startDate);
  const rootContent = [templateTask.content?.trim(), trip.note].filter(Boolean).join('\n\n');
  return {
    projectId: template.projectId,
    title: `${trip.name} · ${templateTask.title}`,
    content: isRoot ? rootContent : (templateTask.content ?? ''),
    desc: templateTask.desc ?? '',
    isAllDay: isRoot ? true : (templateTask.isAllDay ?? true),
    ...(startDate ? { startDate } : {}),
    ...(dueDate ? { dueDate } : {}),
    timeZone: templateTask.timeZone || 'Asia/Shanghai',
    reminders: templateTask.reminders ?? [],
    tags: templateTask.tags ?? [],
    ...(templateTask.repeatFlag ? { repeatFlag: templateTask.repeatFlag } : {}),
    priority: templateTask.priority ?? 0,
    sortOrder: templateTask.sortOrder ?? 0,
    kind: templateTask.kind ?? (items.length > 0 ? 'CHECKLIST' : 'TEXT'),
    ...(parentId ? { parentId } : {}),
    items,
  };
}

function initialChecklistItems(templateTask: TickTickTask, template: TickTickTemplate, trip: TickTickTripSource) {
  return (templateTask.items ?? []).map((item) => ({
    title: item.title,
    status: 0,
    isAllDay: item.isAllDay ?? true,
    sortOrder: item.sortOrder ?? 0,
    ...(item.startDate ? { startDate: shiftTickTickDate(item.startDate, template.anchorDate, trip.startDate) } : {}),
    timeZone: item.timeZone || templateTask.timeZone || 'Asia/Shanghai',
  }));
}

type DateFields = Pick<TickTickTask, 'startDate' | 'dueDate' | 'isAllDay' | 'timeZone'>;
const DATE_FIELDS = ['startDate', 'dueDate', 'isAllDay', 'timeZone'] as const;

function dateSnapshot(value: DateFields, fallback?: DateFields): TickTickDateSnapshot {
  return {
    startDate: value.startDate || null,
    dueDate: value.dueDate || null,
    isAllDay: value.isAllDay ?? fallback?.isAllDay ?? true,
    timeZone: value.timeZone || fallback?.timeZone || 'Asia/Shanghai',
  };
}

function sameDateSnapshot(left: TickTickDateSnapshot, right: TickTickDateSnapshot): boolean {
  const datesMatch = (['startDate', 'dueDate'] as const).every((key) => {
    if (left[key] === right[key]) return true;
    if (!left[key] || !right[key]) return false;
    // API responses can canonicalize +0800 to +0000 without a user edit.
    const leftTime = Date.parse(left[key]);
    const rightTime = Date.parse(right[key]);
    return Number.isFinite(leftTime) && leftTime === rightTime;
  });
  if (!datesMatch) return false;
  if (!left.startDate && !left.dueDate) return true;
  return left.isAllDay === right.isAllDay && left.timeZone === right.timeZone;
}

function hasManualDates(
  current: TickTickDateSnapshot,
  previousAuto: TickTickDateSnapshot,
  state: TickTickDateSyncState | undefined,
): boolean {
  return state?.manual === true || !sameDateSnapshot(current, state?.lastSynced ?? previousAuto);
}

function withoutDateFields<T extends DateFields>(value: T): Omit<T, typeof DATE_FIELDS[number]> {
  const result = { ...value };
  for (const key of DATE_FIELDS) delete result[key];
  return result;
}

function preserveChecklistDates(
  items: TickTickChecklistItem[],
  previousAutoItems: TickTickChecklistItem[],
  generatedTask: TickTickTask,
  instance: TickTickTripInstance,
) {
  const existingById = new Map((generatedTask.items ?? []).map((item) => [item.id, item]));
  const previousAutoById = new Map(previousAutoItems.map((item) => [item.id, item]));
  const manualIds = new Set<string>();
  const protectedItems = items.map((item) => {
    const existing = item.id ? existingById.get(item.id) : undefined;
    const previousAuto = item.id ? previousAutoById.get(item.id) : undefined;
    if (!item.id || !existing || !previousAuto) return item;
    const state = instance.checklistDateStates?.[generatedTask.id]?.[item.id];
    if (!hasManualDates(dateSnapshot(existing, generatedTask), dateSnapshot(previousAuto, generatedTask), state)) return item;
    manualIds.add(item.id);
    // Checklist arrays are sent in full: copy the existing date fields, including
    // their absence after a user clears a date, without replacing other metadata.
    const preserved = { ...withoutDateFields(item) } as TickTickChecklistItem;
    for (const key of ['startDate', 'isAllDay', 'timeZone'] as const) {
      if (Object.prototype.hasOwnProperty.call(existing, key)) Object.assign(preserved, { [key]: existing[key] });
    }
    return preserved;
  });
  return { items: protectedItems, manualIds };
}

function rememberDateStates(
  instance: TickTickTripInstance,
  task: TickTickTask,
  manualTask: boolean,
  manualItems = new Set<string>(),
) {
  (instance.taskDateStates ??= {})[task.id] = { lastSynced: dateSnapshot(task), manual: manualTask };
  const itemStates: Record<string, TickTickDateSyncState> = {};
  for (const item of task.items ?? []) {
    if (item.id) itemStates[item.id] = { lastSynced: dateSnapshot(item, task), manual: manualItems.has(item.id) };
  }
  (instance.checklistDateStates ??= {})[task.id] = itemStates;
}

function forgetDateStates(instance: TickTickTripInstance, taskId: string) {
  delete instance.taskDateStates?.[taskId];
  delete instance.checklistDateStates?.[taskId];
}

function updatedChecklistItems(
  templateTask: TickTickTask,
  generatedTask: TickTickTask,
  instance: TickTickTripInstance,
  template: TickTickTemplate,
  trip: TickTickTripSource,
) {
  const idMap = instance.itemIdsByTemplateTaskId[templateTask.id] ?? {};
  const existingById = new Map((generatedTask.items ?? []).filter((item) => item.id).map((item) => [item.id!, item]));
  const mappedGeneratedIds = new Set(Object.values(idMap));
  const templateItems = (templateTask.items ?? []).map((item, index) => {
    const key = checklistItemKey(item, index);
    const existing = existingById.get(idMap[key]);
    return {
      ...(existing?.id ? { id: existing.id } : {}),
      title: item.title,
      status: existing ? checklistItemStatus(existing) : 0,
      ...(existing?.completedTime ? { completedTime: existing.completedTime } : {}),
      isAllDay: item.isAllDay ?? true,
      sortOrder: item.sortOrder ?? 0,
      ...(item.startDate ? { startDate: shiftTickTickDate(item.startDate, template.anchorDate, trip.startDate) } : {}),
      timeZone: item.timeZone || templateTask.timeZone || 'Asia/Shanghai',
    };
  });
  const manualItems = (generatedTask.items ?? [])
    .filter((item) => !item.id || !mappedGeneratedIds.has(item.id))
    .map((item) => ({ ...item, status: checklistItemStatus(item) }));
  return [...templateItems, ...manualItems];
}

function refreshChecklistIdMap(
  templateTask: TickTickTask,
  generatedTask: TickTickTask,
  instance: TickTickTripInstance,
) {
  const previousMap = instance.itemIdsByTemplateTaskId[templateTask.id] ?? {};
  const available = [...(generatedTask.items ?? [])];
  const nextMap: Record<string, string> = {};
  (templateTask.items ?? []).forEach((item, index) => {
    const key = checklistItemKey(item, index);
    const previousId = previousMap[key];
    const matchIndex = available.findIndex((candidate) => candidate.id && (
      candidate.id === previousId || candidate.title === item.title
    ));
    if (matchIndex < 0) return;
    const [matched] = available.splice(matchIndex, 1);
    if (matched.id) nextMap[key] = matched.id;
  });
  instance.itemIdsByTemplateTaskId[templateTask.id] = nextMap;
}

async function getGeneratedTask(
  api: TickTickApi,
  projectId: string,
  taskId: string,
  knownTasks: Map<string, TickTickTask>,
): Promise<TickTickTask | null> {
  const known = knownTasks.get(taskId);
  if (known) return known;
  try {
    const task = await api.getTask(projectId, taskId);
    knownTasks.set(task.id, task);
    return task;
  } catch (error) {
    if (error instanceof Error && /TickTick 404/.test(error.message)) return null;
    throw error;
  }
}

async function deleteGeneratedTree(
  api: TickTickApi,
  instance: TickTickTripInstance,
  projectId: string,
  templateTasks: TickTickTask[],
  persist: () => Promise<void>,
) {
  const byId = new Map(templateTasks.map((task) => [task.id, task]));
  const ids = Object.entries(instance.taskIdsByTemplateId)
    .sort(([left], [right]) => templateDepth(byId.get(right) ?? { id: right } as TickTickTask, byId) - templateDepth(byId.get(left) ?? { id: left } as TickTickTask, byId));
  for (const [templateTaskId, generatedTaskId] of ids) {
    try {
      await api.deleteTask(projectId, generatedTaskId);
    } catch (error) {
      if (!(error instanceof Error) || !/TickTick 404/.test(error.message)) throw error;
    }
    delete instance.taskIdsByTemplateId[templateTaskId];
    delete instance.itemIdsByTemplateTaskId[templateTaskId];
    forgetDateStates(instance, generatedTaskId);
    await persist();
  }
}

async function syncTripInstance(
  api: TickTickApi,
  template: TickTickTemplate,
  projectTasks: Map<string, TickTickTask>,
  trip: TickTickTripSource,
  instance: TickTickTripInstance,
  persist: () => Promise<void>,
) {
  // Existing installations do not have per-task snapshots yet. Reconstruct the
  // last automatic schedule using the *previous* trip, not its newly edited dates.
  const previousTrip: TickTickTripSource = {
    key: instance.tripKey, startDate: instance.startDate, endDate: instance.endDate,
    dates: instance.dates, name: instance.name, note: '',
  };
  const templateById = new Map(template.tasks.map((task) => [task.id, task]));
  const orderedTemplateTasks = [...template.tasks].sort(
    (left, right) => templateDepth(left, templateById) - templateDepth(right, templateById),
  );

  for (const templateTask of orderedTemplateTasks) {
    const parentId = templateTask.parentId ? instance.taskIdsByTemplateId[templateTask.parentId] : undefined;
    const generatedTaskId = instance.taskIdsByTemplateId[templateTask.id];
    const generatedTask = generatedTaskId
      ? await getGeneratedTask(api, template.projectId, generatedTaskId, projectTasks)
      : null;
    if (!generatedTask) {
      if (generatedTaskId) forgetDateStates(instance, generatedTaskId);
      const payload = baseTaskPayload(
        templateTask,
        trip,
        template,
        parentId,
        initialChecklistItems(templateTask, template, trip),
      );
      const created = await api.createTask(payload);
      if (!created?.id) throw new Error('TickTick 创建任务后未返回任务 ID');
      // Keep fields from the request when an API reply contains only an ID.
      let resolved = { ...payload, ...created } as unknown as TickTickTask;
      instance.taskIdsByTemplateId[templateTask.id] = created.id;
      if (templateTask.id === template.rootTask.id) instance.rootTaskId = created.id;
      const requestedItems = payload.items as TickTickChecklistItem[];
      if (requestedItems.length && (created.items?.length !== requestedItems.length || !created.items.every((item) => item.id))) {
        // Save the new identity before a follow-up request can fail. A retry must
        // resume this task, not create another copy of the same template task.
        rememberDateStates(instance, resolved, false);
        await persist();
        resolved = { ...resolved, ...await api.getTask(template.projectId, created.id) };
      }
      refreshChecklistIdMap(templateTask, resolved, instance);
      rememberDateStates(instance, resolved, false);
      projectTasks.set(created.id, resolved);
      await persist();
      continue;
    }

    // Recover missing item mappings after a compact create response / interrupted
    // follow-up read, before constructing a full checklist replacement.
    const previousItemMap = instance.itemIdsByTemplateTaskId[templateTask.id] ?? {};
    refreshChecklistIdMap(templateTask, generatedTask, instance);
    instance.itemIdsByTemplateTaskId[templateTask.id] = {
      ...previousItemMap, ...instance.itemIdsByTemplateTaskId[templateTask.id],
    };
    const previousItems = updatedChecklistItems(templateTask, generatedTask, instance, template, previousTrip);
    const protectedChecklist = preserveChecklistDates(
      updatedChecklistItems(templateTask, generatedTask, instance, template, trip),
      previousItems, generatedTask, instance,
    );
    const previousAuto = baseTaskPayload(templateTask, previousTrip, template, parentId, previousItems);
    const manualTask = hasManualDates(
      dateSnapshot(generatedTask), dateSnapshot(previousAuto), instance.taskDateStates?.[generatedTask.id],
    );
    const automaticPayload = baseTaskPayload(templateTask, trip, template, parentId, protectedChecklist.items);
    const payload = {
      id: generatedTask.id,
      // Omit task dates entirely for manual overrides; a metadata-only update
      // cannot reintroduce a date that the user cleared or moved again meanwhile.
      ...(manualTask ? withoutDateFields(automaticPayload) : automaticPayload),
    };
    const updated = await api.updateTask(generatedTask.id, payload);
    let resolved = { ...generatedTask, ...payload, ...updated } as TickTickTask;
    if (protectedChecklist.items.some((item) => !item.id)) {
      resolved = { ...resolved, ...await api.getTask(template.projectId, generatedTask.id) };
    }
    refreshChecklistIdMap(templateTask, resolved, instance);
    rememberDateStates(instance, resolved, manualTask, protectedChecklist.manualIds);
    projectTasks.set(generatedTask.id, resolved);
    await persist();
  }

  const templateTaskIds = new Set(template.tasks.map((task) => task.id));
  const obsolete = Object.entries(instance.taskIdsByTemplateId)
    .filter(([templateTaskId]) => !templateTaskIds.has(templateTaskId));
  const generatedIds = new Set(Object.values(instance.taskIdsByTemplateId));
  for (const [obsoleteTemplateId, generatedTaskId] of obsolete) {
    const manualChildren = [...projectTasks.values()].filter(
      (task) => task.parentId === generatedTaskId && !generatedIds.has(task.id),
    );
    for (const manualChild of manualChildren) {
      if (!instance.rootTaskId || manualChild.id === instance.rootTaskId) continue;
      const moved = await api.updateTask(manualChild.id, {
        id: manualChild.id,
        projectId: template.projectId,
        parentId: instance.rootTaskId,
      });
      projectTasks.set(manualChild.id, moved?.id ? moved : { ...manualChild, parentId: instance.rootTaskId });
    }
    try {
      await api.deleteTask(template.projectId, generatedTaskId);
    } catch (error) {
      if (!(error instanceof Error) || !/TickTick 404/.test(error.message)) throw error;
    }
    delete instance.taskIdsByTemplateId[obsoleteTemplateId];
    delete instance.itemIdsByTemplateTaskId[obsoleteTemplateId];
    forgetDateStates(instance, generatedTaskId);
    await persist();
  }

  instance.tripKey = trip.key;
  instance.startDate = trip.startDate;
  instance.endDate = trip.endDate;
  instance.dates = [...trip.dates];
  instance.name = trip.name;
  await persist();
}

export async function reconcileTickTickTrips(options: {
  api: TickTickApi;
  template: TickTickTemplate;
  trips: TickTickTripSource[];
  state: TickTickTripSyncState;
  today: string;
  matchByDateOverlap?: boolean;
  saveState: (state: TickTickTripSyncState) => Promise<void>;
}): Promise<TickTickSyncResult> {
  const { api, template, state, today, saveState } = options;
  const activeTrips = options.trips.filter((trip) => trip.endDate >= today);
  const activeKeys = new Set(activeTrips.map((trip) => trip.key));
  const projectData = await api.getProjectData(template.projectId);
  const projectTasks = new Map(projectData.tasks.map((task) => [task.id, task]));
  const activeInstances = Object.entries(state.instances).filter(([key, instance]) => instance.endDate >= today || activeKeys.has(key));
  const unmatchedInstances = new Map(activeInstances);
  const matches = new Map<string, { oldKey: string; instance: TickTickTripInstance }>();

  for (const trip of activeTrips) {
    const exact = unmatchedInstances.get(trip.key);
    if (!exact) continue;
    matches.set(trip.key, { oldKey: trip.key, instance: exact });
    unmatchedInstances.delete(trip.key);
  }
  for (const trip of activeTrips) {
    if (options.matchByDateOverlap === false || matches.has(trip.key)) continue;
    const candidates = [...unmatchedInstances.entries()]
      .map(([key, instance]) => ({ key, instance, overlap: overlapCount(trip.dates, instance.dates) }))
      .filter((candidate) => candidate.overlap > 0)
      .sort((left, right) => right.overlap - left.overlap);
    if (candidates.length === 0) continue;
    const best = candidates[0];
    matches.set(trip.key, { oldKey: best.key, instance: best.instance });
    unmatchedInstances.delete(best.key);
  }

  let createdTrips = 0;
  let updatedTrips = 0;
  let deletedTrips = 0;
  const persist = async () => {
    state.lastError = undefined;
    await saveState(state);
  };

  for (const trip of activeTrips) {
    const matched = matches.get(trip.key);
    const instance = matched?.instance ?? {
      tripKey: trip.key,
      startDate: trip.startDate,
      endDate: trip.endDate,
      dates: [...trip.dates],
      name: trip.name,
      taskIdsByTemplateId: {},
      itemIdsByTemplateTaskId: {},
    };
    if (matched && matched.oldKey !== trip.key) delete state.instances[matched.oldKey];
    state.instances[trip.key] = instance;
    await persist();
    await syncTripInstance(api, template, projectTasks, trip, instance, persist);
    if (matched) updatedTrips += 1;
    else createdTrips += 1;
  }

  for (const [key, instance] of unmatchedInstances) {
    await deleteGeneratedTree(api, instance, template.projectId, template.tasks, persist);
    delete state.instances[key];
    deletedTrips += 1;
    await persist();
  }

  state.lastSyncAt = new Date().toISOString();
  state.lastError = undefined;
  await saveState(state);
  return { createdTrips, updatedTrips, deletedTrips, activeTrips: activeTrips.length };
}

export async function reconcileTickTickWishPreparations(options: {
  api: TickTickApi;
  template: TickTickTemplate;
  configState: unknown;
  state: TickTickTripSyncState;
  today: string;
  saveState: (state: TickTickTripSyncState) => Promise<void>;
}) {
  const { state, template, today, saveState } = options;
  const wishes = buildWishPreparationSourcesFromSyncState(options.configState);
  const hasActiveWishes = wishes.some((wish) => wish.endDate >= today);
  if (!hasActiveWishes && !Object.values(state.wishInstances ?? {}).some((instance) => instance.endDate >= today)) {
    return { createdWishPreparations: 0, updatedWishPreparations: 0, deletedWishPreparations: 0, activeWishPreparations: 0 };
  }
  // 没有待生成心愿时无需七个月模板，仍可清理后来已关联/停用/删除的心愿副本。
  const selectedTemplate = hasActiveWishes ? wishPreparationTemplate(template) : template;
  const result = await reconcileTickTickTrips({
    api: options.api,
    template: selectedTemplate,
    trips: wishes,
    state: { instances: state.wishInstances ?? {} },
    today,
    // 同一天的不同心愿不能像日历行程那样凭日期重叠合并。
    matchByDateOverlap: false,
    saveState: async (next) => {
      state.wishInstances = next.instances;
      if (next.lastSyncAt) state.lastSyncAt = next.lastSyncAt;
      await saveState(state);
    },
  });
  return {
    createdWishPreparations: result.createdTrips,
    updatedWishPreparations: result.updatedTrips,
    deletedWishPreparations: result.deletedTrips,
    activeWishPreparations: result.activeTrips,
  };
}
