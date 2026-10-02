import ICAL from 'ical.js';
import { kv } from '@vercel/kv';
import { fetchCalendar, parseOutlookCalendar, decryptOutlookConnection } from './_outlookCalendar.js';
import { periodDays, reconcilePeriodEvents, type PeriodEvent } from '../src/utils/bonLife.js';

export const LIFE_CONNECTION_KEY = 'bonlife:outlook-connection:v1';
export interface LifeConnection { id: string; encrypted: string }
export interface PeriodSnapshot { connectionId: string; requestedAt: number; syncedAt: string; events: PeriodEvent[] }
export const entriesKey = (year: number) => `bonlife:entries:v1:${year}`;
export const periodsKey = (year: number) => `bonlife:periods:v1:${year}`;

export function parsePeriodCalendar(text: string, year: number) {
  const events = parseOutlookCalendar(text, 'play', `${year}-01-01`, `${year + 1}-01-01`, true);
  const root = new ICAL.Component(ICAL.parse(text));
  const seenUids = root.getAllSubcomponents('vevent').map((event) => String(event.getFirstPropertyValue('uid') || '')).filter(Boolean);
  return { seenUids, events: events.filter((event) => /月经|🩸/u.test(event.title)).map((event) => {
    if (!event.uid) throw new Error('日程标识缺失');
    return { uid: event.uid, startDate: event.startDate, endDate: event.endDate };
  }) };
}

export async function readPeriodCalendar(connection: LifeConnection, year: number) {
  try {
    const input = decryptOutlookConnection(connection.encrypted, (process.env.SYNC_SECRET || '').trim());
    return parsePeriodCalendar(await fetchCalendar(input.playUrl), year);
  } catch {
    throw new Error('Outlook 日历读取失败，请检查订阅链接与共享范围');
  }
}

export async function syncLifePeriods(connection: LifeConnection, year: number) {
  const requestedAt = Date.now();
  const [parsed, previous] = await Promise.all([
    readPeriodCalendar(connection, year), kv.get<PeriodSnapshot>(periodsKey(year)),
  ]);
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
  const snapshot: PeriodSnapshot = { connectionId: connection.id, requestedAt, syncedAt: new Date().toISOString(),
    events: reconcilePeriodEvents(previous?.events ?? [], parsed.events, parsed.seenUids, today) };
  const result = await kv.eval<(string | number)[], number>(`
    local connection = redis.call('get', KEYS[1])
    if not connection or cjson.decode(connection).id ~= ARGV[1] then return 0 end
    local previous = redis.call('get', KEYS[2])
    if previous and cjson.decode(previous).requestedAt ~= tonumber(ARGV[4]) then return -1 end
    if not previous and tonumber(ARGV[4]) ~= 0 then return -1 end
    redis.call('set', KEYS[2], ARGV[3])
    return 1
  `, [LIFE_CONNECTION_KEY, periodsKey(year)], [connection.id, requestedAt, JSON.stringify(snapshot), previous?.requestedAt ?? 0]);
  if (result !== 1) throw new Error('日历连接或内容已更新，请重新同步');
  return { periodDays: periodDays(snapshot.events, year), syncedAt: snapshot.syncedAt };
}

export const SAVE_LIFE_ENTRY = `
  local raw = redis.call('hget', KEYS[1], ARGV[1])
  local current = raw and cjson.decode(raw) or {revision = '', text = ''}
  if current.revision == ARGV[3] then return {1, raw} end
  if current.revision ~= ARGV[2] then return {0, raw or ''} end
  redis.call('hset', KEYS[1], ARGV[1], ARGV[4])
  return {1, ARGV[4]}
`;
