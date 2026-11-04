import { calendarDateInTimeZone, routineOccurrenceKey, routineTaskDate, type TickTickApi, type TickTickTask } from './_ticktickTrips.js';
import { syncRecurringTaskOutlook, type RecurringTaskEventOptions } from './_outlookRecurringTaskEvents.js';
import { localEventTime } from './_outlookTaskEvents.js';

const pending = (task: TickTickTask) => (task.status ?? 0) === 0 && !task.completedTime;
const title = '接电动车';
const prefix = 'BonBills charging pickup: ';
const mergedPrefix = 'BonBills pickup merged: ';
const lines = (content?: string) => (content ?? '').split(/\r?\n|\\n/);
export const isElectricVehiclePickup = (task: TickTickTask) => task.title === title && lines(task.content).some(line => line.startsWith(prefix));
const notes = (task: TickTickTask) => lines(task.content).filter(line => !line.startsWith(prefix) && !line.startsWith(mergedPrefix)).join('\n');
const plainDuplicate = (task: TickTickTask) => pending(task) && isElectricVehiclePickup(task) && notes(task).trim() === '(20m)'
  && !(task.tags ?? []).some(tag => !['hidden', 'bon-hidden'].includes(tag)) && !task.reminders?.length
  && task.priority === 5 && task.isAllDay === false
  && !task.repeatFlag && !task.parentId && !task.items?.length && !task.desc;
const dayAfter = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

export async function syncElectricVehiclePickup(api: TickTickApi, options: RecurringTaskEventOptions & { mode?: 'tasks' | 'outlook' }) {
  const excluded = (task: TickTickTask) => {
    const seen = new Set<string>();
    let current: TickTickTask | undefined = task;
    while (current && !seen.has(current.id)) {
      if (options.excludedTaskIds.has(current.id) || (current.parentId && options.excludedTaskIds.has(current.parentId))) return true;
      seen.add(current.id); current = options.tasks.find(t => t.id === current!.parentId);
    }
    return false;
  };
  const sources = options.tasks.filter(t => pending(t) && t.title.normalize('NFKC').trim() === '电动车充电'
    && !excluded(t) && !t.tags?.includes('不关我事'));
  const now = options.now?.getTime() ?? Date.now();
  const completed = options.history.filter(t => !pending(t) && t.title.normalize('NFKC').trim() === '电动车充电'
    && !excluded(t) && !t.tags?.includes('不关我事') && t.completedTime && Date.parse(t.completedTime) <= now);
  const completedDay = (task: TickTickTask) => calendarDateInTimeZone(task.completedTime, 'Asia/Shanghai');
  const recentCompleted = completed.filter(t => completedDay(t) && dayAfter(completedDay(t)!) >= options.today);
  const tasks = [...options.tasks];
  let created = 0, updated = 0, deleted = 0;
  for (const source of options.mode === 'outlook' ? [] : [...recentCompleted, ...sources]) {
    const historical = !pending(source);
    const fresh = historical ? source : await api.getTask(source.projectId, source.id);
    const day = historical ? completedDay(fresh) : routineTaskDate(fresh);
    if ((!historical && !pending(fresh)) || !day || dayAfter(day) < options.today) continue;
    const target = dayAfter(day);
    const family = routineOccurrenceKey(source);
    const activeFamily = sources.filter(t => routineOccurrenceKey(t) === family);
    const unique = activeFamily.length === 1;
    const familyHistory = completed.filter(t => t.projectId === source.projectId
      && (t.id === source.id || unique && routineOccurrenceKey(t) === family));
    const sourceIds = new Set([source.id, ...unique ? [activeFamily[0].id, ...familyHistory.map(t => t.id)] : []]);
    const completion = familyHistory.filter(t => !historical || Date.parse(t.completedTime!) < Date.parse(source.completedTime!))
      .map(t => t.completedTime!).sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1) ?? 'initial';
    const marker = `${prefix}${source.projectId}/${unique ? activeFamily[0].id : source.id}/${completion}`;
    const linked = (task: TickTickTask) => lines(task.content).some(line => {
      if (!line.startsWith(prefix)) return false;
      const [project, id, cycle] = line.slice(prefix.length).split('/');
      return project === source.projectId && sourceIds.has(id)
        && (cycle === completion || Number.isFinite(Date.parse(cycle)) && Date.parse(cycle) === Date.parse(completion));
    });
    const matches = tasks.filter(t => pending(t) && t.projectId === source.projectId && t.title === title && !excluded(t)
      && (linked(t) || (!t.content?.includes(prefix) && routineTaskDate(t) === target)));
    const customized = matches.filter(t => !plainDuplicate(t));
    if (matches.length > 1 && (customized.length > 1 || matches.some(t => !linked(t)))) throw new Error('接电动车存在多个待办，请核对');
    if (options.history.some(t => t.projectId === source.projectId && t.title === title && !pending(t)
      && routineTaskDate(t) === target)) continue;
    const startDate = `${target}T07:20:00+0800`, dueDate = `${target}T07:40:00+0800`;
    const keeper = customized[0] ?? matches[0];
    const duplicates = matches.filter(t => t.id !== keeper?.id);
    const existing = keeper ? await api.getTask(keeper.projectId, keeper.id) : undefined;
    if (existing && (!pending(existing) || existing.title !== title)) continue;
    if (existing && keeper && linked(keeper) && !linked(existing)) throw new Error('接电动车关联已变化');
    const aliases = [...new Set([...lines(existing?.content).filter(line => line.startsWith(mergedPrefix)),
      ...duplicates.flatMap(t => [`${mergedPrefix}${t.projectId}/${t.id}`, ...lines(t.content).filter(line => line.startsWith(mergedPrefix))])])];
    const content = [existing ? notes(existing) : '(20m)', marker, ...aliases].join('\n');
    let saved: TickTickTask;
    if (existing) {
      if (Date.parse(existing.startDate ?? '') === Date.parse(startDate) && Date.parse(existing.dueDate ?? '') === Date.parse(dueDate)
        && existing.isAllDay === false && existing.content === content) saved = existing;
      else {
        saved = await api.updateTask(existing.id, { ...existing, startDate, dueDate, isAllDay: false, timeZone: 'Asia/Shanghai', content });
        updated++;
      }
    } else {
      saved = await api.createTask({ projectId: source.projectId, title, content, startDate, dueDate,
        isAllDay: false, timeZone: 'Asia/Shanghai', priority: 5, tags: [], reminders: [] });
      created++;
    }
    const verified = await api.getTask(saved.projectId, saved.id);
    if (verified.title !== title || !pending(verified) || Date.parse(verified.startDate ?? '') !== Date.parse(startDate)
      || Date.parse(verified.dueDate ?? '') !== Date.parse(dueDate) || verified.content !== content) throw new Error('接电动车待办保存未通过核对');
    const index = tasks.findIndex(t => t.id === verified.id && t.projectId === verified.projectId);
    if (index >= 0) tasks[index] = verified; else tasks.push(verified);
    for (const duplicate of duplicates) {
      const current = await api.getTask(duplicate.projectId, duplicate.id);
      if (!current || current.id !== duplicate.id || current.projectId !== duplicate.projectId || !plainDuplicate(current) || !linked(current))
        throw new Error('重复接车待办已变化，未清理');
      await api.deleteTask(current.projectId, current.id);
      tasks.splice(tasks.findIndex(t => t.id === current.id), 1); deleted++;
    }
  }
  const outlook = options.mode === 'tasks' ? undefined : await syncRecurringTaskOutlook(api, { ...options, tasks: tasks.filter(isElectricVehiclePickup) }, {
    subject: title, propertyId: 'String {d9d1e730-7742-4a9c-91af-bab2a9a45f69} Name BonBillsPickup',
    statePrefix: 'outlook:pickup-events:v1', cyclesKey: 'ticktick:pickup-cycles:v1',
    mergedTasks: task => lines(task.content).filter(line => line.startsWith(mergedPrefix)).map(line => {
      const [projectId, id] = line.slice(mergedPrefix.length).split('/');
      return { projectId, id };
    }).filter(t => t.projectId === task.projectId && Boolean(t.id)),
    plan: task => {
      const date = routineTaskDate(task);
      if (!pending(task) || task.tags?.includes('不关我事') || !date || date < options.today || excluded(task)) return null;
      const start = Date.parse(`${date}T07:20:00+08:00`);
      return { subject: title, start: localEventTime(start), end: localEventTime(start + 20 * 60000) };
    },
  });
  return { created, updated, deleted, outlook };
}
