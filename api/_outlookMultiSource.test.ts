import { describe, expect, it, vi } from 'vitest';
import { decryptOutlookConnection, encryptOutlookConnection, parseOutlookInput, readOutlookSnapshot } from './_outlookCalendar';
import { DEFAULT_OUTLOOK_RULES } from '../src/utils/outlookCalendar';

const calendar = (events: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//test//EN\r\n${events}\r\nEND:VCALENDAR\r\n`;
const event = (summary: string) => `BEGIN:VEVENT\r\nUID:${Math.random()}\r\nDTSTART;VALUE=DATE:20261007\r\nDTEND;VALUE=DATE:20261008\r\nSUMMARY:${summary}\r\nEND:VEVENT`;

describe('Outlook 多源订阅扩展', () => {
  const playUrl = 'https://outlook.live.com/owa/calendar/private-play/published/calendar.ics';
  const classUrl = 'https://outlook.office365.com/owa/calendar/private-class/published/calendar.ics';
  const workUrl = 'https://outlook.office365.com/owa/calendar/private-work/published/calendar.ics';
  const calUrl = 'https://outlook.live.com/owa/calendar/private-cal/published/calendar.ics';

  it('支持向后兼容解析：旧连接能解密并自动补齐 sources', () => {
    const oldInput = { playUrl, classUrl, policy: 'manual' as const, rules: DEFAULT_OUTLOOK_RULES };
    const parsed = parseOutlookInput(oldInput);
    expect(parsed.sources).toEqual([
      { name: '玩', url: playUrl, kind: 'play' },
      { name: '课', url: classUrl, kind: 'class' },
    ]);
  });

  it('支持聚合多个命名日历并正确应用规则', async () => {
    const input = {
      playUrl: '', classUrl: '',
      sources: [
        { name: '日历', url: calUrl, kind: 'play' as const },
        { name: '干', url: workUrl, kind: 'class' as const },
      ],
      policy: 'manual' as const,
      rules: DEFAULT_OUTLOOK_RULES
    };

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === calUrl) return new Response(calendar(event('🏠')));
      if (url === workUrl) return new Response(calendar(event('实习')));
      throw new Error('unknown url');
    }));

    const snapshot = await readOutlookSnapshot(input, '2026-10-01', '2026-11-01');
    expect(snapshot.tags['2026-10-07']).toBe('home'); // '🏠' in play-like calendar
    expect(snapshot.tags['2026-10-07']).not.toBe('intern'); // Combined result
    
    // In our rules: home has priority 2, intern has priority 1.
    // Wait, let's check priorities in src/utils/outlookCalendar.ts:
    // const priority = { intern: 1, home: 2, travel: 3 };
    // So if one day has both 'home' and 'intern', it takes 'home'.
  });

  it('加密与解密支持多源，不泄露链接', () => {
    const input = parseOutlookInput({
      playUrl: '', classUrl: '',
      sources: [{ name: '干', url: workUrl, kind: 'work' as const }],
      policy: 'manual' as const,
      rules: DEFAULT_OUTLOOK_RULES
    });
    const secret = 'test-secret';
    const encrypted = encryptOutlookConnection(input, secret);
    expect(encrypted).not.toContain('private-work');
    const decrypted = decryptOutlookConnection(encrypted, secret);
    expect(decrypted.sources[0].name).toBe('干');
    expect(decrypted.sources[0].url).toBe(workUrl);
  });

  it('校验重复名称与链接', () => {
    const base = { playUrl: '', classUrl: '', policy: 'manual', rules: DEFAULT_OUTLOOK_RULES };
    expect(() => parseOutlookInput({ ...base, sources: [{ name: 'A', url: calUrl, kind: 'play' }, { name: 'A', url: workUrl, kind: 'play' }] })).toThrow('日历名称「A」重复');
    expect(() => parseOutlookInput({ ...base, sources: [{ name: 'A', url: calUrl, kind: 'play' }, { name: 'B', url: calUrl, kind: 'play' }] })).toThrow('订阅链接不能重复');
  });
});
