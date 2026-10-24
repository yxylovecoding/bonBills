import { describe, expect, it } from 'vitest';
import { hourlyRestWindow } from './hourlySchedule';
describe('hourly automatic rest in Shanghai', () => {
  it.each([['00:01', false], ['00:29:59', false], ['00:30', true], ['06:29:59', true], ['06:30', false], ['07:01', false], ['23:59', false]])('%s rests=%s', (time, expected) => {
    expect(hourlyRestWindow(new Date(`2026-10-24T${time}+08:00`))).toBe(expected);
  });
});
