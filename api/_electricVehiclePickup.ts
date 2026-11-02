import { routineTaskDate, type TickTickApi, type TickTickTask } from './_ticktickTrips.js';
import { syncRecurringTaskOutlook, type RecurringTaskEventOptions } from './_outlookRecurringTaskEvents.js';
import { localEventTime } from './_outlookTaskEvents.js';

const pending = (task: TickTickTask) => (task.status ?? 0) === 0 && !task.completedTime;
const title = '接电动车';
const prefix = 'BonBills charging pickup: ';
const dayAfter = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

export async function syncElectricVehiclePickup(api: TickTickApi, options: RecurringTaskEventOptions) {
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
  const recentCompleted = options.history.filter(t => !pending(t) && t.title.normalize('NFKC').trim() === '电动车充电'
    && !excluded(t) && !t.tags?.includes('不关我事') && routineTaskDate(t)
    && dayAfter(routineTaskDate(t)!) >= options.today);
  const allSources = [...recentCompleted, ...sources];
  const tasks = [...options.tasks];
  let created = 0, updated = 0;
  for (const source of allSources) {
    const historical = !pending(source);
    const fresh = historical ? source : await api.getTask(source.projectId, source.id);
    const day = routineTaskDate(fresh);
    if ((!historical && !pending(fresh)) || !day || dayAfter(day) < options.today) continue;
    const target = dayAfter(day);
    const completion = options.history.filter(t => t.projectId === source.projectId
      && (t.id === source.id || (t.title === source.title && sources.filter(c => c.projectId === source.projectId && c.title === source.title).length === 1))
      && t.completedTime && Date.parse(t.completedTime) <= Date.now()
      && (!historical || t.completedTime !== source.completedTime))
      .map(t => t.completedTime!).sort().at(-1) ?? 'initial';
    const marker = `${prefix}${source.projectId}/${source.id}/${completion}`;
    const linked = (task: TickTickTask) => task.content?.split('\n').includes(marker);
    const matches = tasks.filter(t => pending(t) && t.projectId === source.projectId && t.title === title && !excluded(t)
      && (((linked(t) && (routineTaskDate(t) ?? '') >= options.today)
        || (t.content?.includes(`${prefix}${source.projectId}/${source.id}/`) && routineTaskDate(t) === target)) || (!t.content?.includes(prefix) && routineTaskDate(t) === target)));
    if (matches.length > 1) throw new Error('接电动车存在多个待办，请核对');
    if (options.history.some(t => t.projectId === source.projectId && t.title === title && !pending(t)
      && routineTaskDate(t) === target)) continue;
    const startDate = `${target}T07:20:00+0800`, dueDate = `${target}T07:40:00+0800`;
    const existing = matches[0] ? await api.getTask(matches[0].projectId, matches[0].id) : undefined;
    if (existing && (!pending(existing) || existing.title !== title)) continue;
    const content = existing && linked(existing) ? existing.content : `${existing?.content ?? '(20m)'}\n${marker}`;
    let saved: TickTickTask;
    if (existing) {
      if (Date.parse(existing.startDate ?? '') === Date.parse(startDate) && Date.parse(existing.dueDate ?? '') === Date.parse(dueDate)
        && existing.isAllDay === false && existing.content === content) continue;
      saved = await api.updateTask(existing.id, { ...existing, startDate, dueDate, isAllDay: false, timeZone: 'Asia/Shanghai', content });
      updated++;
    } else {
      saved = await api.createTask({ projectId: source.projectId, title, content, startDate, dueDate,
        isAllDay: false, timeZone: 'Asia/Shanghai', priority: 5, tags: [], reminders: [] });
      created++;
    }
    const verified = await api.getTask(saved.projectId, saved.id);
    if (verified.title !== title || Date.parse(verified.startDate ?? '') !== Date.parse(startDate)
      || Date.parse(verified.dueDate ?? '') !== Date.parse(dueDate)) throw new Error('接电动车待办保存未通过核对');
    const index = tasks.findIndex(t => t.id === verified.id && t.projectId === verified.projectId);
    if (index >= 0) tasks[index] = verified; else tasks.push(verified);
  }
  const outlook = await syncRecurringTaskOutlook(api, { ...options, tasks: tasks.filter(t => t.title === title && t.content?.includes(prefix)) }, {
    subject: title, propertyId: 'String {d9d1e730-7742-4a9c-91af-bab2a9a45f69} Name BonBillsPickup',
    statePrefix: 'outlook:pickup-events:v1', cyclesKey: 'ticktick:pickup-cycles:v1',
    plan: task => {
      const date = routineTaskDate(task);
      if (!pending(task) || task.tags?.includes('不关我事') || !date || date < options.today || excluded(task)) return null;
      const start = Date.parse(`${date}T07:20:00+08:00`);
      return { subject: title, start: localEventTime(start), end: localEventTime(start + 20 * 60000) };
    },
  });
  return { created, updated, outlook };
}
