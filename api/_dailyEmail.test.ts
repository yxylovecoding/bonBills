import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dailyEmailKey, sendDailyEmail } from './_dailyEmail';

const { data, send, verify, report, lock, refresh } = vi.hoisted(() => ({ data: new Map<string, any>(),
  send: vi.fn(), verify: vi.fn(), report: vi.fn(), lock: vi.fn(), refresh: vi.fn() }));
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: send, verify, close() {} }) } }));
vi.mock('./_dailyBriefing.js', async original => ({ ...await original<typeof import('./_dailyBriefing')>(), readDailyBriefing: report }));
vi.mock('./_lifeTraining.js', () => ({ syncTrainingSource: refresh }));
vi.mock('./_ticktickLock.js', () => ({ acquireTickTickLock: lock, releaseTickTickLock: async () => {} }));
vi.mock('@vercel/kv', () => ({ kv: {
  get: async (key: string) => data.get(key) ?? null,
  set: async (key: string, value: unknown, options?: { nx?: boolean }) => {
    if (options?.nx && data.has(key)) return null;
    data.set(key, value); return 'OK';
  },
  eval: async (_script: string, keys: string[], args: string[]) => {
    if (data.get(keys[0])?.attempt === args[0]) data.delete(keys[0]);
  },
} }));
const now = new Date('2026-10-04T21:00:00Z');
const key = dailyEmailKey('2026-10-05');
beforeEach(() => {
  data.clear(); vi.clearAllMocks();
  vi.stubEnv('BILL_MAIL_USER', 'sender@163.com'); vi.stubEnv('BILL_MAIL_PASS', 'secret');
  lock.mockResolvedValue('lock'); refresh.mockResolvedValue({}); verify.mockResolvedValue(true);
  send.mockResolvedValue({ accepted: ['yangxy1229@outlook.com'] });
  report.mockResolvedValue({ date: '2026-10-05', generatedAt: now.toISOString(), ready: true, warnings: [],
    training: [{ date: '2026-10-05', phase: '黄体中晚期', plan: '全身力训', minutes: 45, reasons: ['最久未练优先'] }],
    today: [{ title: '阅读 <内容>', minutes: 15, reasons: ['周期已到'] }] });
});
afterEach(() => vi.unstubAllEnvs());
describe('后台每日邮件', () => {
  it('上海日期去重，发送训练、今日事、原因和用时，收件人固定', async () => {
    expect(await sendDailyEmail(now)).toMatchObject({ sent: true, duplicate: false, date: '2026-10-05' });
    expect(await sendDailyEmail(now)).toMatchObject({ sent: true, duplicate: true });
    expect(send).toHaveBeenCalledOnce();
    const mail = send.mock.calls[0][0];
    expect(mail.to).toBe('yangxy1229@outlook.com');
    expect(mail.html).toContain('阅读 &lt;内容&gt;'); expect(mail.html).not.toContain('<form');
    expect(mail.text).toContain('全身力训 · 约 45 分钟'); expect(mail.text).toContain('周期已到');
    expect(mail.html).not.toContain('secret'); expect(data.get(key).status).toBe('sent');
    expect(refresh).toHaveBeenCalledWith(2026, { lockHeld: true });
  });
  it('记录或今日事未更新、写锁繁忙时不发送', async () => {
    lock.mockResolvedValueOnce(null);
    expect(await sendDailyEmail(now)).toMatchObject({ busy: true });
    report.mockResolvedValueOnce({ date: '2026-10-05', ready: false });
    await expect(sendDailyEmail(now)).rejects.toThrow('尚未更新');
    expect(send).not.toHaveBeenCalled(); expect(data.has(key)).toBe(false);
  });
  it('明确拒绝可以重试；连接断开结果不明不能重复发信', async () => {
    send.mockRejectedValueOnce({ responseCode: 550 });
    await expect(sendDailyEmail(now)).rejects.toThrow('拒绝');
    expect(data.has(key)).toBe(false);
    send.mockRejectedValueOnce(new Error('connection lost'));
    await expect(sendDailyEmail(now)).rejects.toThrow('待核对');
    await expect(sendDailyEmail(now)).rejects.toThrow('待核对');
    expect(data.get(key).status).toBe('uncertain'); expect(send).toHaveBeenCalledTimes(2);
  });
  it('认证失败没有投递副作用，也不泄漏底层错误中的凭证', async () => {
    verify.mockRejectedValueOnce(new Error('secret smtp credentials'));
    await expect(sendDailyEmail(now)).rejects.toThrow('后台发信连接或认证失败');
    expect(send).not.toHaveBeenCalled(); expect(data.has(key)).toBe(false);
  });
});
