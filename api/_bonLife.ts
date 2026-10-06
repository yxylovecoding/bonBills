import ICAL from 'ical.js';
import { kv } from './_accountKv.js';
import { fetchCalendar, parseOutlookCalendar, decryptOutlookConnection } from './_outlookCalendar.js';
import { periodDays, reconcilePeriodEvents, type PeriodEvent } from '../src/utils/bonLife.js';

export const LIFE_CONNECTION_KEY = 'bonlife:outlook-connection:v1';
export interface LifeConnection { id: string; encrypted: string }
export interface PeriodSnapshot { connectionId: string; requestedAt: number; syncedAt: string; events: PeriodEvent[] }
export const entriesKey = (year: number) => `bonlife:entries:v1:${year}`;
export const periodsKey = (year: number) => `bonlife:periods:v1:${year}`;
export const LIFE_SETTINGS_KEY = 'bonlife:settings:v1';
export const LIFE_TRAINING_ENTRIES_KEY = 'bonlife:training-entries:v1';
export const LIFE_SYMPTOM_ENTRIES_KEY = 'bonlife:symptom-entries:v1';

export async function readPeriodDays(year: number) {
  const currentYear = Number(new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date()).slice(0, 4));
  const years = [...new Set([year - 1, year, year + 1, currentYear - 1, currentYear, currentYear + 1])]
    .filter((value) => value >= 1900 && value <= 2200);
  const snapshots = await Promise.all(years.map((value) => kv.get<PeriodSnapshot>(periodsKey(value))));
  const events = snapshots.flatMap((snapshot) => snapshot?.events ?? []);
  return [...new Set(years.flatMap((value) => periodDays(events, value)))].sort();
}

export function parsePeriodCalendar(text: string, year: number) {
  const events = parseOutlookCalendar(text, 'play', `${year - 1}-11-01`, `${year + 1}-01-01`, true);
  const root = new ICAL.Component(ICAL.parse(text));
  const seenUids = root.getAllSubcomponents('vevent').map((event) => String(event.getFirstPropertyValue('uid') || '')).filter(Boolean);
  return { seenUids, events: events.filter((event) => /月经|经期|例假|大姨妈|🩸/u.test(event.title) && !/预计|预测|预估/u.test(event.title)).map((event) => {
    if (!event.uid) throw new Error('日程标识缺失');
    return { uid: event.uid, startDate: event.startDate, endDate: event.endDate };
  }) };
}

async function readPeriodCalendarText(connection: LifeConnection) {
  try {
    const input = decryptOutlookConnection(connection.encrypted, (process.env.SYNC_SECRET || '').trim());
    return await fetchCalendar(input.playUrl);
  } catch {
    throw new Error('Outlook 日历读取失败，请检查订阅链接与共享范围');
  }
}

export async function readPeriodCalendar(connection: LifeConnection, year: number) {
  try { return parsePeriodCalendar(await readPeriodCalendarText(connection), year); }
  catch { throw new Error('Outlook 日历读取失败，请检查订阅链接与共享范围'); }
}

export async function syncLifePeriods(connection: LifeConnection, year: number) {
  const requestedAt = Date.now();
  const [parsed, previous] = await Promise.all([
    readPeriodCalendar(connection, year), kv.get<PeriodSnapshot>(periodsKey(year)),
  ]);
  return saveLifePeriods(connection, year, parsed, previous, requestedAt);
}

async function saveLifePeriods(connection: LifeConnection, year: number, parsed: ReturnType<typeof parsePeriodCalendar>,
  previous: PeriodSnapshot | null, requestedAt: number) {
  if (previous && previous.requestedAt > requestedAt) throw new Error('日历连接或内容已更新，请重新同步');
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

// Calendar archiving must work without a browser, TickTick connection, or task write lock.
export async function syncRecentLifePeriods(now = new Date()) {
  try {
    const connection = await kv.get<LifeConnection>(LIFE_CONNECTION_KEY);
    if (!connection) return { connected: false as const };
    const year = Number(new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(now).slice(0, 4));
    const years = [year - 1, year, year + 1].filter((value) => value >= 1900 && value <= 2200);
    const requestedAt = Date.now();
    const [text, previous] = await Promise.all([
      readPeriodCalendarText(connection), Promise.all(years.map((value) => kv.get<PeriodSnapshot>(periodsKey(value)))),
    ]);
    // Fetch once and validate every window before writing any snapshots. Previous-year
    // storage preserves late edits in January; next-year storage covers December crossings.
    const parsed = years.map((value) => parsePeriodCalendar(text, value));
    const settled = await Promise.allSettled(years.map((value, index) => saveLifePeriods(connection, value, parsed[index], previous[index], requestedAt)));
    const results = settled.map((result) => {
      if (result.status === 'rejected') throw result.reason;
      return result.value;
    });
    return { connected: true as const, syncedAt: results[years.indexOf(year)].syncedAt };
  } catch {
    throw new Error('Outlook 经期同步失败，已保留历史，请重试');
  }
}

export const SAVE_LIFE_ENTRY = `
  local raw = redis.call('hget', KEYS[1], ARGV[1])
  local current = raw and cjson.decode(raw) or {revision = '', text = ''}
  local makeupKey = ARGV[6]
  local makeup = nil
  if makeupKey and makeupKey ~= '' then
    local shared = redis.call('hget', KEYS[1], makeupKey)
    if shared then makeup = cjson.decode(shared).makeup end
  end
  local function decorated(value)
    if not makeup then return value end
    local entry = value and value ~= '' and cjson.decode(value) or {revision = '', text = ''}
    entry.makeup = makeup
    return cjson.encode(entry)
  end
  if current.revision == ARGV[3] then return {1, decorated(raw)} end
  if current.revision ~= ARGV[2] then return {0, decorated(raw or '')} end
  local encoded = ARGV[4]
  if ARGV[5] ~= 'cycle' and ARGV[5] ~= 'skin-settings' then
    local next = cjson.decode(ARGV[4])
    if next.makeup and makeupKey and makeupKey ~= '' then
      if next.makeup.revision ~= (makeup and makeup.revision or '') then return {0, decorated(raw or '')} end
      if not makeup or next.makeup.face ~= makeup.face or next.makeup.eyes ~= makeup.eyes then
        makeup = next.makeup
        makeup.revision = ARGV[3]
        redis.call('hset', KEYS[1], makeupKey, cjson.encode({text = '', revision = ARGV[3], makeup = makeup}))
      end
    end
    next.makeup = nil
    for _, field in ipairs({'skin', 'eyes', 'discomfort', 'body', 'training'}) do
      if next[field] == nil then next[field] = current[field] end
    end
    encoded = cjson.encode(next)
  end
  redis.call('hset', KEYS[1], ARGV[1], encoded)
  if KEYS[2] then redis.call('hset', KEYS[2], ARGV[1], encoded) end
  return {1, decorated(encoded)}
`;
