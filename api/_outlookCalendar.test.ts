import { afterEach, describe, expect, it, vi } from 'vitest';
import { decryptOutlookConnection, encryptOutlookConnection, parseOutlookCalendar, parseOutlookInput, readOutlookSnapshot, validateOutlookUrl } from './_outlookCalendar';
import { DEFAULT_OUTLOOK_RULES } from '../src/utils/outlookCalendar';

const calendar = (events: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//test//EN\r\n${events}\r\nEND:VCALENDAR\r\n`;
const event = (properties: string) => `BEGIN:VEVENT\r\n${properties.replace(/\n/g, '\r\n')}\r\nEND:VEVENT`;
const parse = (ics: string) => parseOutlookCalendar(ics, 'class', '2026-09-01', '2026-10-01');
const playUrl = 'https://outlook.live.com/owa/calendar/private-play/published/calendar.ics';
const classUrl = 'https://outlook.office365.com/owa/calendar/private-class/published/calendar.ics';
const input = { playUrl, classUrl, policy: 'manual' as const, rules: DEFAULT_OUTLOOK_RULES };
afterEach(() => vi.unstubAllGlobals());

describe('Outlook ICS 解析', () => {
  it('展开重复实习，排除 EXDATE、已取消单次日程，并应用改期与标题变更', () => {
    const ics = calendar([
      event('UID:intern\nDTSTART;VALUE=DATE:20260901\nDTEND;VALUE=DATE:20260902\nSUMMARY:实习\nRRULE:FREQ=DAILY;COUNT=5\nEXDATE;VALUE=DATE:20260902'),
      event('UID:intern\nRECURRENCE-ID;VALUE=DATE:20260903\nSTATUS:CANCELLED'),
      event('UID:intern\nRECURRENCE-ID;VALUE=DATE:20260904\nDTSTART;VALUE=DATE:20260910\nDTEND;VALUE=DATE:20260911\nSUMMARY:实习'),
      event('UID:intern\nRECURRENCE-ID;VALUE=DATE:20260905\nDTSTART;VALUE=DATE:20260905\nDTEND;VALUE=DATE:20260906\nSUMMARY:请假'),
    ].join('\r\n'));
    expect(parse(ics).map(({ title, startDate }) => [title, startDate])).toEqual([
      ['实习', '2026-09-01'], ['实习', '2026-09-10'], ['请假', '2026-09-05'],
    ]);
  });
  it('保留全天的本地日期，支持 Windows 时区标记和无 DTEND 的单日', () => {
    const ics = calendar([
      event('UID:home\nDTSTART;TZID=China Standard Time:20260920T000000\nDTEND;TZID=China Standard Time:20260922T000000\nX-MICROSOFT-CDO-ALLDAYEVENT:TRUE\nSUMMARY:🏠'),
      event('UID:one\nDTSTART;VALUE=DATE:20260925\nSUMMARY:实习'),
      event('UID:timed\nDTSTART:20260925T090000Z\nDTEND:20260925T100000Z\nSUMMARY:实习'),
    ].join('\r\n'));
    expect(parse(ics).map(({ startDate, endDate }) => [startDate, endDate])).toEqual([
      ['2026-09-20', '2026-09-22'], ['2026-09-25', '2026-09-26'],
    ]);
  });
  it('取出从窗口外移入的例外，忽略移出和整组取消', () => {
    const ics = calendar([
      event('UID:moved\nDTSTART;VALUE=DATE:20260801\nDTEND;VALUE=DATE:20260802\nRRULE:FREQ=DAILY;COUNT=2\nSUMMARY:实习'),
      event('UID:moved\nRECURRENCE-ID;VALUE=DATE:20260802\nDTSTART;VALUE=DATE:20260910\nDTEND;VALUE=DATE:20260911\nSUMMARY:实习'),
      event('UID:cancel\nDTSTART;VALUE=DATE:20260901\nDTEND;VALUE=DATE:20260902\nRRULE:FREQ=DAILY;COUNT=3\nSTATUS:CANCELLED\nSUMMARY:实习'),
    ].join('\r\n'));
    expect(parse(ics).map(({ startDate }) => startDate)).toEqual(['2026-09-10']);
  });
  it('拒绝截断或 HTML 响应，不当作空日历', () => {
    expect(() => parse('<html>Sign in</html>')).toThrow();
    expect(() => parse('BEGIN:VCALENDAR\r\n')).toThrow();
    expect(parse(calendar(''))).toEqual([]);
  });
});

describe('Outlook 订阅地址和加密', () => {
  it.each([
    'https://127.0.0.1/owa/calendar/a/calendar.ics',
    'https://outlook.live.com.evil.test/owa/calendar/a/calendar.ics',
    'https://outlook.live.com@evil.test/owa/calendar/a/calendar.ics',
    'http://outlook.live.com/owa/calendar/a/calendar.ics',
    'https://outlook.live.com:8080/owa/calendar/a/calendar.ics',
    'https://outlook.live.com/mail/',
  ])('拒绝非 Outlook 订阅地址 %s', (url) => expect(() => validateOutlookUrl(url)).toThrow());
  it('接受 webcal 并验证两个链接不重复', () => {
    expect(validateOutlookUrl(playUrl.replace('https:', 'webcal:'))).toBe(playUrl);
    expect(() => parseOutlookInput({ ...input, classUrl: playUrl })).toThrow();
  });
  it('加密内容不能直接读取链接，错误密钥或篡改后无法解密', () => {
    const encrypted = encryptOutlookConnection(input, 'secret');
    expect(encrypted).not.toContain('private-play');
    expect(decryptOutlookConnection(encrypted, 'secret')).toEqual(input);
    expect(() => decryptOutlookConnection(encrypted, 'wrong')).toThrow();
    expect(() => decryptOutlookConnection(encrypted.slice(0, -5) + 'AAAAA', 'secret')).toThrow();
  });
  it('任一订阅读取失败则整次失败，不返回可误删日期的部分结果或泄露地址', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === classUrl) throw new Error(`failed: ${url}`);
      return new Response(calendar(event('UID:trip\nDTSTART;VALUE=DATE:20260922\nDTEND;VALUE=DATE:20260923\nSUMMARY:出游')));
    }));
    await expect(readOutlookSnapshot(input, '2026-09-01', '2026-10-01')).rejects.toThrow('「课」日历读取失败');
    expect(fetch).toHaveBeenCalledWith(playUrl, expect.objectContaining({ redirect: 'error' }));
  });
});
