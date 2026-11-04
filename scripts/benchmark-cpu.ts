import { createHash } from 'node:crypto';
import { calendarDateInTimeZone, type TickTickTask } from '../api/_ticktickTrips.js';
import { planTickTickDay } from '../api/_ticktickDailyPlan.js';
import { readOutlookSnapshot, type OutlookConnectionInput } from '../api/_outlookCalendar.js';
import { DEFAULT_OUTLOOK_RULES } from '../src/utils/outlookCalendar.js';
import { dayAvailability } from '../api/_dailyAvailability.js';

// Synthetic, fixed inputs only. Never reads credentials or calls a real provider.
const today = '2026-11-04';
const day = (offset: number) => new Date(Date.parse(today) + offset * 86400_000).toISOString().slice(0, 10);
const tasks: TickTickTask[] = Array.from({ length: 160 }, (_, i) => ({
  id: `task-${i}`, projectId: 'benchmark', title: `任务 ${i} (15m)`, status: 0,
  timeZone: 'Asia/Shanghai', isAllDay: true, dueDate: `${day(0)}T00:00:00+0800`,
  repeatFlag: 'RRULE:FREQ=WEEKLY', priority: i % 20 === 0 ? 5 : 0,
}));
const history = Array.from({ length: 2400 }, (_, i) => ({ ...tasks[i % tasks.length],
  status: 2, completedTime: `${day(-1 - i % 90)}T09:00:00+0800`,
}));
const sceneTasks = tasks.map((task, i) => ({ ...task, tags: [['寄'], ['居'], ['旅'], ['寄', '寓']][i % 4] }));
const largeCalendar = { tagMap: Object.fromEntries(Array.from({ length: 3347 }, (_, i) =>
  [day(i - 2000), ['home', 'school', 'intern', 'travel'][i % 4]])) };
const event = (properties: string) => `BEGIN:VEVENT\r\n${properties}\r\nEND:VEVENT`;
const events = Array.from({ length: 640 }, (_, i) => event([
  `UID:event-${i}`, `DTSTART;TZID=China Standard Time:${day(i % 45 - 14).replaceAll('-', '')}T090000`,
  `DTEND;TZID=China Standard Time:${day(i % 45 - 14).replaceAll('-', '')}T100000`, 'SUMMARY:日程',
].join('\r\n')));
for (let i = 0; i < 20; i++) events.push(event(`UID:weekly-${i}\r\nDTSTART;VALUE=DATE:20260101\r\nDTEND;VALUE=DATE:20260102\r\nRRULE:FREQ=WEEKLY\r\nSUMMARY:出游`));
const ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//bonbills//cpu-benchmark//EN\r\n${events.join('\r\n')}\r\nEND:VCALENDAR\r\n`;
const input: OutlookConnectionInput = { playUrl: 'https://outlook.live.com/owa/calendar/benchmark/calendar.ics', classUrl: '',
  sources: [], policy: 'manual', rules: DEFAULT_OUTLOOK_RULES };
const availability = { startDate: day(-14), endDate: day(31), events: Array.from({ length: 320 }, (_, i) => ({
  title: `日程 ${i}`, start: `${day(i % 45 - 14)}T09:00:00+08:00`, end: `${day(i % 45 - 14)}T10:00:00+08:00`,
})) };
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => new Response(ics);
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value, (_key, item) => item instanceof Map ? [...item] : item)).digest('hex');
const cases: [string, () => unknown | Promise<unknown>][] = [
  ['task-dates-5000', () => Array.from({ length: 5000 }, (_, i) => calendarDateInTimeZone(history[i % history.length].completedTime))],
  ['daily-plan-160-tasks-2400-history', () => {
    const state = { connectionId: 'benchmark', deadlines: {}, history };
    const result = planTickTickDay({ tasks, state, today, timezone: 'Asia/Shanghai',
      now: new Date(`${today}T05:00:00+0800`), calendarState: {}, budgetMinutes: 240 });
    return { result, state };
  }],
  ['daily-plan-160-tasks-3347-calendar-days', () => {
    const state = { connectionId: 'benchmark', deadlines: {}, history };
    const result = planTickTickDay({ tasks: sceneTasks, state, today, timezone: 'Asia/Shanghai',
      now: new Date(`${today}T05:00:00+0800`), calendarState: largeCalendar, budgetMinutes: 240 });
    return { result, state };
  }],
  ['outlook-660-events-two-windows', () => readOutlookSnapshot(input, day(-30), day(700),
    { startDate: day(-14), endDate: day(31) }, 'Asia/Shanghai')],
  ['availability-7-days-320-events', () => Array.from({ length: 7 }, (_, i) => dayAvailability({
    calendar: availability, day: day(i), today, timezone: 'Asia/Shanghai', now: new Date(`${today}T05:00:00+0800`),
    tasks, fixed: [], completed: [], estimate: () => 15,
  }))],
];
try {
  const results = [];
  for (const [name, run] of cases) {
    const expected = fingerprint(await run());
    const samples = [];
    for (let i = 0; i < 5; i++) {
      const cpu = process.cpuUsage(), start = performance.now();
      const output = await run();
      const elapsedMs = performance.now() - start, used = process.cpuUsage(cpu);
      if (fingerprint(output) !== expected) throw new Error(`Non-deterministic benchmark: ${name}`);
      samples.push({ cpuMs: (used.user + used.system) / 1000, elapsedMs });
    }
    const median = (key: 'cpuMs' | 'elapsedMs') => Number(samples.map(s => s[key]).sort((a, b) => a - b)[2].toFixed(2));
    results.push({ name, cpuMs: median('cpuMs'), elapsedMs: median('elapsedMs'), fingerprint: expected });
  }
  console.log(JSON.stringify({ node: process.version, samples: 5, results }, null, 2));
} finally { globalThis.fetch = originalFetch; }
