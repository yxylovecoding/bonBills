import { createCipheriv, createDecipheriv, createHash, createSecretKey, randomBytes, type KeyObject } from 'node:crypto';

export const TICKTICK_CONNECTION_KEY = 'ticktick:connection:v1';
export const TICKTICK_SYNC_STATE_KEY = 'ticktick:trip-sync:v1';
export const TICKTICK_SYNC_LOCK_KEY = 'ticktick:trip-sync:lock';
export const TICKTICK_PROJECT_NAME = '玩';
export const TICKTICK_TEMPLATE_TITLE = '出门todo';
export const TICKTICK_ANCHOR_TITLE = '出门当天';
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
  status?: number;
  completedTime?: string;
  isAllDay?: boolean;
  sortOrder?: number;
  startDate?: string;
  timeZone?: string;
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

export interface TickTickTripInstance {
  tripKey: string;
  startDate: string;
  endDate: string;
  dates: string[];
  name: string;
  rootTaskId?: string;
  taskIdsByTemplateId: Record<string, string>;
  itemIdsByTemplateTaskId: Record<string, Record<string, string>>;
}

export interface TickTickTripSyncState {
  instances: Record<string, TickTickTripInstance>;
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
}

export interface TickTickApi {
  listProjects(): Promise<TickTickProject[]>;
  getPreference(): Promise<{ timeZone?: string }>;
  getProjectData(projectId: string): Promise<TickTickProjectData>;
  filterTasks(projectIds: string | string[], statuses: number[]): Promise<TickTickTask[]>;
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

  filterTasks(projectIds: string | string[], statuses: number[]) {
    return this.request<TickTickTask[]>('/task/filter', {
      method: 'POST',
      body: JSON.stringify({ projectIds: Array.isArray(projectIds) ? projectIds : [projectIds], status: statuses }),
    });
  }

  getTask(projectId: string, taskId: string) {
    return this.request<TickTickTask>(`/project/${encodeURIComponent(projectId)}/task/${encodeURIComponent(taskId)}`);
  }

  createTask(payload: Record<string, unknown>) {
    return this.request<TickTickTask>('/task', { method: 'POST', body: JSON.stringify(payload) });
  }

  updateTask(taskId: string, payload: Record<string, unknown>) {
    return this.request<TickTickTask>(`/task/${encodeURIComponent(taskId)}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
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

const CHINESE_CALENDAR_FORMATTER = new Intl.DateTimeFormat('en-u-ca-chinese', {
  timeZone: 'Asia/Shanghai',
  month: 'numeric',
  day: 'numeric',
});

export function nextChineseNewYear(afterDate: string): string {
  let date = addCalendarDays(afterDate, 1);
  for (let days = 0; days < 450; days += 1) {
    const parts = CHINESE_CALENDAR_FORMATTER.formatToParts(new Date(`${date}T12:00:00+08:00`));
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    if (values.month === '1' && values.day === '1') return date;
    date = addCalendarDays(date, 1);
  }
  throw new Error('无法计算下一个春节');
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

function mergeProjectTasks(projectData: TickTickProjectData, filteredTasks: TickTickTask[]) {
  return [...new Map(
    [...projectData.tasks, ...filteredTasks].map((task) => [task.id, task]),
  ).values()];
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
): string {
  if (matches(tagMap[today])) return today;

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

function routineTaskPayload(task: TickTickTask, targetDate: string): Record<string, unknown> {
  const scheduledDate = taskDate(task)!;
  const shiftedStartDate = shiftTickTickDate(task.startDate, scheduledDate, targetDate);
  const shiftedDueDate = shiftTickTickDate(task.dueDate, scheduledDate, targetDate);
  return {
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
    ...(task.items !== undefined ? { items: task.items } : {}),
  };
}

export async function syncTickTickRoutines(options: {
  api: TickTickApi;
  calendarState: unknown;
  today: string;
}): Promise<TickTickRoutineSyncResult> {
  const { api, calendarState, today } = options;
  const routineTargets = getTickTickRoutineTargetDates(calendarState, today);
  const projects = await api.listProjects();
  const [projectData, filteredTasks] = projects.length > 0
    ? await Promise.all([
      Promise.all(projects.map((project) => api.getProjectData(project.id))),
      api.filterTasks(projects.map((project) => project.id), [0]),
    ])
    : [[], []] as [TickTickProjectData[], TickTickTask[]];
  const activeTasks = [...new Map(
    [...projectData.flatMap((data) => data.tasks), ...filteredTasks]
      .filter((task) => (task.status ?? 0) === 0)
      .map((task) => [task.id, task]),
  ).values()];
  const specs = [
    { title: TICKTICK_HOME_ROUTINE_TITLE, targetDate: routineTargets.home },
    { title: TICKTICK_SCHOOL_ROUTINE_TITLE, targetDate: routineTargets.school },
  ];
  let updatedRoutineTasks = 0;

  for (const spec of specs) {
    const normalizedTitle = spec.title.toLocaleLowerCase();
    const roots = activeTasks.filter((task) => task.title.trim().toLocaleLowerCase() === normalizedTitle);
    if (roots.length > 1) throw new Error(`TickTick 中存在多个“${spec.title}”父任务`);
    const root = roots[0];
    const sameNamedProjects = projects.filter(
      (project) => project.name.trim().toLocaleLowerCase() === normalizedTitle,
    );
    if (!root && sameNamedProjects.length > 1) throw new Error(`TickTick 中存在多个“${spec.title}”清单`);

    const scopedTasks = root
      ? descendantsOf(activeTasks.filter((task) => task.projectId === root.projectId), root.id)
      : sameNamedProjects[0]
        ? activeTasks.filter((task) => task.projectId === sameNamedProjects[0].id)
        : [];
    const tasks = scopedTasks.filter((task) => taskDate(task));

    for (const task of tasks) {
      if (taskDate(task) === spec.targetDate) continue;
      await api.updateTask(task.id, routineTaskPayload(task, spec.targetDate));
      updatedRoutineTasks += 1;
    }
  }

  return { updatedRoutineTasks, routineTargets };
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
    title: `${trip.name} · ${isRoot ? TICKTICK_TEMPLATE_TITLE : templateTask.title}`,
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
      status: existing?.status ?? 0,
      ...(existing?.completedTime ? { completedTime: existing.completedTime } : {}),
      isAllDay: item.isAllDay ?? true,
      sortOrder: item.sortOrder ?? 0,
      ...(item.startDate ? { startDate: shiftTickTickDate(item.startDate, template.anchorDate, trip.startDate) } : {}),
      timeZone: item.timeZone || templateTask.timeZone || 'Asia/Shanghai',
    };
  });
  const manualItems = (generatedTask.items ?? []).filter((item) => !item.id || !mappedGeneratedIds.has(item.id));
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
      const created = await api.createTask(baseTaskPayload(
        templateTask,
        trip,
        template,
        parentId,
        initialChecklistItems(templateTask, template, trip),
      ));
      if (!created?.id) throw new Error('TickTick 创建任务后未返回任务 ID');
      instance.taskIdsByTemplateId[templateTask.id] = created.id;
      if (templateTask.id === template.rootTask.id) instance.rootTaskId = created.id;
      refreshChecklistIdMap(templateTask, created, instance);
      projectTasks.set(created.id, created);
      await persist();
      continue;
    }

    const items = updatedChecklistItems(templateTask, generatedTask, instance, template, trip);
    const updated = await api.updateTask(generatedTask.id, {
      id: generatedTask.id,
      ...baseTaskPayload(templateTask, trip, template, parentId, items),
    });
    const resolved = updated?.id ? updated : { ...generatedTask, ...baseTaskPayload(templateTask, trip, template, parentId, items) } as TickTickTask;
    refreshChecklistIdMap(templateTask, resolved, instance);
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
  saveState: (state: TickTickTripSyncState) => Promise<void>;
}): Promise<TickTickSyncResult> {
  const { api, template, state, today, saveState } = options;
  const activeTrips = options.trips.filter((trip) => trip.endDate >= today);
  const projectData = await api.getProjectData(template.projectId);
  const projectTasks = new Map(projectData.tasks.map((task) => [task.id, task]));
  const activeInstances = Object.entries(state.instances).filter(([, instance]) => instance.endDate >= today);
  const unmatchedInstances = new Map(activeInstances);
  const matches = new Map<string, { oldKey: string; instance: TickTickTripInstance }>();

  for (const trip of activeTrips) {
    const exact = unmatchedInstances.get(trip.key);
    if (!exact) continue;
    matches.set(trip.key, { oldKey: trip.key, instance: exact });
    unmatchedInstances.delete(trip.key);
  }
  for (const trip of activeTrips) {
    if (matches.has(trip.key)) continue;
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
