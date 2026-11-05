import { dateTimeFormatter } from './_dateTimeFormat.js';
import ICAL from 'ical.js';
import { hasHiddenTag } from './_ticktickHiddenTag.js';
import { wallTimeInstant } from './_calendarTimezone.js';
import type { TickTickApi, TickTickTask } from './_ticktickTrips.js';

export const isEyeDrops = (task: TickTickTask) => task.title.normalize('NFKC').trim() === '眼药水'
  && Boolean(task.repeatFlag);
export function canAdvanceEyeDrop(task: TickTickTask): boolean {
  const rule = task.repeatFlag?.replace(/^RRULE:/i, '') ?? '';
  return /^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(;|$)/.test(rule)
    && !/(?:^|;)(COUNT|UNTIL)=/.test(rule) && !task.items?.length;
}
const pending = (task: TickTickTask) => (task.status ?? 0) === 0 && !task.completedTime;
const fields = ['title', 'content', 'desc', 'isAllDay', 'timeZone', 'reminders', 'tags', 'repeatFlag', 'repeatFrom',
  'priority', 'sortOrder', 'kind', 'parentId', 'items', 'startDate', 'dueDate'] as const;
const stamp = (task: TickTickTask) => JSON.stringify([task.id, task.projectId, task.status ?? 0,
  task.completedTime ?? null, ...fields.map(key => task[key] ?? null)]);
function wall(value: string, zone: string) {
  const parts = Object.fromEntries(dateTimeFormatter('sv-SE', { timeZone: zone, year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(value)).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}
function instant(task: TickTickTask, zone: string) {
  const value = task.dueDate || task.startDate;
  if (!value) return NaN;
  return Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : wallTimeInstant(value, zone));
}

export function eyeDropShanghaiDay(task: TickTickTask): string | null {
  if (task.isAllDay !== false) return null;
  const due = instant(task, task.timeZone || 'Asia/Shanghai');
  return Number.isFinite(due) ? wall(new Date(due).toISOString(), 'Asia/Shanghai').slice(0, 10) : null;
}

export async function syncEyeDrops(api: Pick<TickTickApi, 'getTask' | 'updateTask'>,
  tasks: TickTickTask[], now = new Date(), fallbackZone = 'Asia/Shanghai') {
  const today = wall(now.toISOString(), 'Asia/Shanghai').slice(0, 10);
  const midnight = Date.parse(`${today}T00:00:00+08:00`);
  const candidates = tasks.filter(task => {
    if (!isEyeDrops(task) || !pending(task) || task.priority !== 5 || task.isAllDay !== false) return false;
    if (hasHiddenTag(task) || (task.tags ?? []).some(tag => tag.normalize('NFKC').trim().toLowerCase() === 'routine')) return false;
    const due = instant(task, task.timeZone || fallbackZone);
    return midnight <= due && due <= now.getTime();
  }).sort((a, b) => instant(b, b.timeZone || fallbackZone) - instant(a, a.timeZone || fallbackZone)
    || `${a.projectId}/${a.id}`.localeCompare(`${b.projectId}/${b.id}`));
  const keep = candidates[0];
  if (!keep || candidates.length === 1) return { skipped: 0 };
  // Calculate every next occurrence before writing. Unsupported or finite rules fail closed.
  const changes = candidates.slice(1).map(task => {
    const zone = task.timeZone || fallbackZone;
    const ruleText = task.repeatFlag!.replace(/^RRULE:/i, '');
    if (!canAdvanceEyeDrop(task)) {
      throw new Error('眼药水重复规则不支持安全跳过，保留原任务');
    }
    // Skipping an occurrence advances its current due date, not a fabricated
    // completion. Keep repeatFrom intact so TickTick still schedules subsequent
    // occurrences from the user's real completion when that mode is selected.
    const original = instant(task, zone);
    const originalWall = wall(new Date(original).toISOString(), zone);
    const iterator = ICAL.Recur.fromString(ruleText).iterator(ICAL.Time.fromDateTimeString(originalWall));
    let target: number | undefined;
    for (let i = 0; i < 10000; i++) {
      const next = iterator.next();
      if (!next) break;
      const value = Date.parse(wallTimeInstant(next.toString(), zone));
      if (value > now.getTime()) { target = value; break; }
    }
    if (!target) throw new Error('眼药水下一次日期无法确认，保留原任务');
    const payload: Record<string, unknown> = { id: task.id, projectId: task.projectId };
    for (const key of fields) if (task[key] !== undefined) payload[key] = task[key];
    // Retain duration; the recurrence's wall-clock time is resolved with IANA DST rules.
    for (const key of ['startDate', 'dueDate'] as const) if (task[key]) {
      const value = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(task[key]!) ? task[key]! : wallTimeInstant(task[key]!, zone);
      payload[key] = new Date(Date.parse(value) + target - original).toISOString();
    }
    return { task, payload };
  });
  let skipped = 0;
  for (const { task, payload } of changes) {
    const retained = await api.getTask(keep.projectId, keep.id);
    const fresh = await api.getTask(task.projectId, task.id);
    if (!retained || stamp(retained) !== stamp(keep) || !fresh || stamp(fresh) !== stamp(task)) {
      throw new Error('眼药水待办已变化，停止跳过');
    }
    await api.updateTask(task.id, payload);
    const updated = await api.getTask(task.projectId, task.id);
    if (!updated || !pending(updated) || fields.some(key => ['startDate', 'dueDate'].includes(key)
      ? Date.parse(String(updated[key] ?? '')) !== Date.parse(String(payload[key] ?? '')) && updated[key] !== payload[key]
      : JSON.stringify(updated[key] ?? null) !== JSON.stringify(task[key] ?? null))) {
      throw new Error('眼药水跳过结果未确认');
    }
    Object.assign(task, updated);
    skipped++;
  }
  return { skipped };
}
