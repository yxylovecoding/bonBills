import { afterEach, describe, expect, it, vi } from 'vitest';
import { parsePeriodCalendar } from './_bonLife';
import { readOutlookSnapshot } from './_outlookCalendar';
import { DEFAULT_OUTLOOK_RULES } from '../src/utils/outlookCalendar';

afterEach(() => vi.unstubAllGlobals());

describe('经期订阅与出行分类', () => {
  it.each([
    'DTSTART;VALUE=DATE:20261010\nDTEND;VALUE=DATE:20261013',
    'DTSTART;TZID=China Standard Time:20261010T000000\nDTEND;TZID=China Standard Time:20261013T000000\nX-MICROSOFT-CDO-ALLDAYEVENT:TRUE',
  ])('经期仍覆盖三天，出行仅覆盖真实行程且保留独立忙闲：%s', async (dates) => {
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//test//EN',
      'BEGIN:VEVENT', 'UID:period', dates, 'SUMMARY:预计月经🩸', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:trip', 'DTSTART;VALUE=DATE:20261011', 'DTEND;VALUE=DATE:20261012', 'SUMMARY:杭州', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:meeting', 'DTSTART:20261011T010000Z', 'DTEND:20261011T020000Z', 'SUMMARY:会议', 'END:VEVENT',
      'END:VCALENDAR', ''].join('\n').replaceAll('\n', '\r\n');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(ics)));
    const result = await readOutlookSnapshot({
      playUrl: 'https://outlook.live.com/owa/calendar/test/calendar.ics', classUrl: '', sources: [],
      policy: 'manual', rules: DEFAULT_OUTLOOK_RULES,
    }, '2026-10-01', '2026-11-01', { startDate: '2026-10-10', endDate: '2026-10-14' }, 'Asia/Shanghai');
    expect(result.tags).toEqual({ '2026-10-11': 'travel' });
    expect(result.travelTitles).toEqual({ '2026-10-11': '杭州' });
    expect(result.wishEvents?.map(({ uid }) => uid)).toEqual(['trip']);
    expect(result.availability?.events).toEqual([{ title: '会议', start: '2026-10-11T01:00:00.000Z', end: '2026-10-11T02:00:00.000Z' }]);
    expect(parsePeriodCalendar(ics, 2026).events).toEqual([{ uid: 'period', startDate: '2026-10-10', endDate: '2026-10-13' }]);
  });
});
