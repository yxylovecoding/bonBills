import ICAL from 'ical.js';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { buildOutlookSnapshot, isCalendarDate, type OutlookCalendarKind, type OutlookConflictPolicy, type OutlookDayEvent, type OutlookRules } from '../src/utils/outlookCalendar.js';

export interface OutlookConnectionInput {
  playUrl: string;
  classUrl: string;
  policy: OutlookConflictPolicy;
  rules: OutlookRules;
}

export function validateOutlookUrl(value: string): string {
  try {
    const url = new URL(value.trim().replace(/^webcal:/i, 'https:'));
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash
      || !['outlook.live.com', 'outlook.office.com', 'outlook.office365.com'].includes(url.hostname)
      || !/^\/(?:owa\/calendar|calendar\/published)\/.+\.ics$/i.test(url.pathname)) throw new Error();
    return url.href;
  } catch {
    throw new Error('请输入 Outlook 发布的 ICS 订阅链接');
  }
}

export function parseOutlookInput(body: unknown): OutlookConnectionInput {
  const input = body as Partial<OutlookConnectionInput> | null;
  if (!input || typeof input !== 'object') throw new Error('连接信息无效');
  const readUrl = (value: unknown) => {
    if (typeof value !== 'string' || value.length > 4096) throw new Error('订阅链接无效');
    return value.trim() ? validateOutlookUrl(value) : '';
  };
  const playUrl = readUrl(input.playUrl);
  const classUrl = readUrl(input.classUrl);
  if (!playUrl && !classUrl) throw new Error('请至少填写一个日历链接');
  if (playUrl && playUrl === classUrl) throw new Error('「玩」和「课」需要各自的订阅链接');
  if (input.policy !== 'manual' && input.policy !== 'outlook') throw new Error('同步优先级无效');
  const titles = (value: unknown): string[] => {
    if (!Array.isArray(value) || value.length > 100 || value.some((item) => typeof item !== 'string' || item.length > 200)) {
      throw new Error('日程标题无效');
    }
    return [...new Set(value.map((item: string) => item.trim()).filter(Boolean))];
  };
  return { playUrl, classUrl, policy: input.policy, rules: {
    homeTitles: titles(input.rules?.homeTitles), ignoredPlayTitles: titles(input.rules?.ignoredPlayTitles),
  } };
}

export function parseOutlookRange(start: unknown, end: unknown) {
  if (typeof start !== 'string' || typeof end !== 'string' || !isCalendarDate(start) || !isCalendarDate(end)
    || start >= end || Date.parse(end) - Date.parse(start) > 740 * 86_400_000) throw new Error('日历同步日期无效');
  return { startDate: start, endDate: end };
}

// A subscription URL grants access to its calendar; keep it encrypted and out of browser persistence.
export function encryptOutlookConnection(input: OutlookConnectionInput, secret: string): string {
  if (!secret) throw new Error('服务端连接配置缺失');
  const key = new Uint8Array(createHash('sha256').update(`outlook-calendar:v1:${secret}`).digest());
  const iv = new Uint8Array(randomBytes(12));
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = new Uint8Array([...cipher.update(JSON.stringify(input), 'utf8'), ...cipher.final()]);
  return [iv, Uint8Array.from(cipher.getAuthTag()), data].map((part) => Buffer.from(part).toString('base64')).join('.');
}

export function decryptOutlookConnection(value: string, secret: string): OutlookConnectionInput {
  if (!secret) throw new Error('服务端连接配置缺失');
  const [iv, tag, data] = value.split('.').map((part) => new Uint8Array(Buffer.from(part, 'base64')));
  const key = new Uint8Array(createHash('sha256').update(`outlook-calendar:v1:${secret}`).digest());
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return parseOutlookInput(JSON.parse(Buffer.from(new Uint8Array([...decipher.update(data), ...decipher.final()])).toString('utf8')));
}

async function fetchCalendar(url: string): Promise<string> {
  const response = await fetch(validateOutlookUrl(url), {
    redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { Accept: 'text/calendar' },
  });
  if (!response.ok || !response.body) throw new Error('订阅链接暂不可用');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let length = 0;
  let text = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 4_000_000) throw new Error('日历内容过大');
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

type IcalEvent = InstanceType<typeof ICAL.Event>;
type IcalTime = InstanceType<typeof ICAL.Time>;
function dayOf(time: IcalTime): string {
  return `${String(time.year).padStart(4, '0')}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}`;
}
function isCancelled(event: IcalEvent) {
  return String(event.component.getFirstPropertyValue('status')).toUpperCase() === 'CANCELLED';
}
function isAllDay(event: IcalEvent) {
  return event.startDate?.isDate || String(event.component.getFirstPropertyValue('x-microsoft-cdo-alldayevent')).toUpperCase() === 'TRUE';
}

export function parseOutlookCalendar(text: string, calendar: OutlookCalendarKind, startDate: string, endDate: string): OutlookDayEvent[] {
  if (!/^\s*BEGIN:VCALENDAR\r?\n/i.test(text) || !/END:VCALENDAR\s*$/i.test(text)) throw new Error('订阅内容不是完整日历');
  const root = new ICAL.Component(ICAL.parse(text));
  const components = root.getAllSubcomponents('vevent');
  if (components.length > 10_000) throw new Error('日历日程过多');
  const events = components.map((component) => new ICAL.Event(component, { exceptions: [] }));
  const exceptions = new Map<string, Map<string, IcalEvent>>();
  for (const event of events) {
    if (!event.isRecurrenceException()) continue;
    if (event.modifiesFuture()) throw new Error('日历含暂不支持的后续日程变更');
    const map = exceptions.get(event.uid) ?? new Map<string, IcalEvent>();
    map.set(event.recurrenceId.toString(), event);
    exceptions.set(event.uid, map);
  }
  const cancelledSeries = new Set(events.filter((event) => !event.isRecurrenceException() && isCancelled(event)).map((event) => event.uid));
  const result: OutlookDayEvent[] = [];
  const append = (event: IcalEvent, start: IcalTime, end: IcalTime) => {
    if (!isAllDay(event) || isCancelled(event)) return;
    const from = dayOf(start);
    const to = dayOf(end);
    if (from < endDate && to > startDate) result.push({ calendar, title: event.summary || '', startDate: from, endDate: to, allDay: true });
  };
  let iterations = 0;
  const deadline = Date.now() + 2500;
  for (const event of events) {
    if (cancelledSeries.has(event.uid) || isCancelled(event) || !isAllDay(event)) continue;
    if (!event.startDate || !event.endDate) throw new Error('日程日期缺失');
    if (!event.isRecurring() || event.isRecurrenceException()) {
      append(event, event.startDate, event.endDate);
      continue;
    }
    if (Object.keys(event.getRecurrenceTypes()).some((key) => ['SECONDLY', 'MINUTELY', 'HOURLY'].includes(key))) {
      throw new Error('全天日程的重复频率无效');
    }
    const iterator = event.iterator();
    const duration = event.duration;
    for (let occurrence = iterator.next(); occurrence; occurrence = iterator.next()) {
      if (++iterations > 30_000 || Date.now() > deadline) throw new Error('日历重复日程过多，请缩小订阅范围');
      if (dayOf(occurrence) >= endDate) break;
      // Detached exceptions are included separately, including ones moved into this window.
      if (exceptions.get(event.uid)?.has(occurrence.toString())) continue;
      const end = occurrence.clone();
      end.addDuration(duration);
      append(event, occurrence, end);
    }
  }
  return result;
}

export async function readOutlookSnapshot(input: OutlookConnectionInput, startDate: string, endDate: string) {
  const sources = [{ calendar: 'play' as const, url: input.playUrl }, { calendar: 'class' as const, url: input.classUrl }].filter((item) => item.url);
  const events = await Promise.all(sources.map(async ({ calendar, url }) => {
    try {
      return parseOutlookCalendar(await fetchCalendar(url), calendar, startDate, endDate);
    } catch {
      // Never forward upstream errors: they can contain the private subscription URL.
      throw new Error(`「${calendar === 'play' ? '玩' : '课'}」日历读取失败，请检查订阅链接与共享范围`);
    }
  }));
  return buildOutlookSnapshot(events.flat(), startDate, endDate, input.rules);
}
