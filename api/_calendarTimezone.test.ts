import { describe, expect, it } from 'vitest';
import { wallTimeInstant } from './_calendarTimezone';
import { dateTimeFormatter } from './_dateTimeFormat';
import { calendarDateInTimeZone } from './_ticktickTrips';

describe('reused timezone formatters', () => {
  it('recalculates offsets for every date across DST and historical rule changes', () => {
    const cases = [
      ['2026-03-08T01:30:00', 'America/Los_Angeles', '2026-03-08T09:30:00.000Z'],
      ['2026-03-08T03:30:00', 'America/Los_Angeles', '2026-03-08T10:30:00.000Z'],
      ['2026-11-01T02:30:00', 'America/Los_Angeles', '2026-11-01T10:30:00.000Z'],
      ['2026-07-01T12:00:00', 'America/Los_Angeles', '2026-07-01T19:00:00.000Z'],
      ['1991-06-01T12:00:00', 'Asia/Shanghai', '1991-06-01T03:00:00.000Z'],
      ['2026-06-01T12:00:00', 'Asia/Shanghai', '2026-06-01T04:00:00.000Z'],
      ['2026-11-04T00:00:00', 'Asia/Kathmandu', '2026-11-03T18:15:00.000Z'],
    ];
    for (const rows of [cases, [...cases].reverse()]) for (const [wall, zone, expected] of rows) {
      expect(wallTimeInstant(wall, zone)).toBe(expected);
    }
  });
  it('keeps invalid zones, nonexistent wall times and floating dates unchanged', () => {
    expect(() => wallTimeInstant('2026-03-08T02:30:00', 'America/Los_Angeles')).toThrow('日程时区无效');
    expect(() => wallTimeInstant('2026-11-04T09:00:00', 'Unknown/Zone')).toThrow();
    expect(calendarDateInTimeZone('2026-11-04T00:00:00', 'America/Los_Angeles')).toBe('2026-11-04');
    expect(calendarDateInTimeZone('2026-11-03T16:00:00Z', 'Asia/Shanghai')).toBe('2026-11-04');
    expect(calendarDateInTimeZone('2026-11-03T16:00:00Z', 'America/Los_Angeles')).toBe('2026-11-03');
    expect(calendarDateInTimeZone('2026-11-03T16:00:00Z', 'Unknown/Zone')).toBe('2026-11-03');
  });
  it('does not share format options or timezone results between callers', () => {
    const instant = new Date('2026-01-01T23:00:00Z');
    const date = { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' } as const;
    expect(dateTimeFormatter('sv-SE', date).format(instant)).toBe('2026-01-02');
    expect(dateTimeFormatter('en', { timeZone: 'Asia/Shanghai', year: 'numeric' }).format(instant)).toBe('2026');
    expect(dateTimeFormatter('sv-SE', { ...date, timeZone: 'America/Los_Angeles' }).format(instant)).toBe('2026-01-01');
    expect(dateTimeFormatter('sv-SE', date).format(instant)).toBe('2026-01-02');
  });
});
