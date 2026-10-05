import { randomUUID } from 'node:crypto';
import { kv } from './_accountKv.js';
import nodemailer from 'nodemailer';
import { readDailyBriefing, renderDailyBriefing, type DailyBriefing } from './_dailyBriefing.js';
import { syncTrainingSource } from './_lifeTraining.js';
import { shanghaiDay } from './_lifeDone.js';
import { acquireTickTickLock, releaseTickTickLock } from './_ticktickLock.js';

export const DAILY_EMAIL_RECIPIENT = 'yangxy1229@outlook.com';
export const dailyEmailKey = (date: string) => `bonlife:daily-email:v1:${date}`;
interface Delivery { attempt: string; status: 'sending' | 'sent' | 'uncertain'; startedAt: string; sentAt?: string }

export function emailText(report: DailyBriefing) {
  return [`${report.date} · 训练与今日事`, '未来 7 天训练',
    ...report.training.map(day => `${day.date} ${day.phase}\n${day.plan} · 约 ${day.minutes} 分钟\n${day.reasons.join('；')}`),
    `今日事 · ${report.today.length} 项 · 约 ${report.today.reduce((sum, item) => sum + item.minutes, 0)} 分钟`,
    ...report.today.map(item => `${item.title} · 约 ${item.minutes} 分钟\n${item.reasons.join('；')}`),
    '时长均为预估；训练若已列入今日事，不重复相加。后续训练随实际完成和经期更新。',
    '查看最新计划：https://www.bonbills.cn/life?view=briefing'].join('\n\n');
}

function mailTransport() {
  const user = (process.env.DAILY_MAIL_USER || process.env.BILL_MAIL_USER || '').trim();
  const pass = (process.env.DAILY_MAIL_PASS || process.env.BILL_MAIL_PASS || '').trim();
  if (!user || !pass) throw new Error('后台发信邮箱尚未配置');
  const host = (process.env.DAILY_MAIL_HOST || 'smtp.163.com').trim();
  const port = Number(process.env.DAILY_MAIL_PORT || 465);
  if (![465, 587].includes(port)) throw new Error('后台发信端口须为 465 或 587');
  return { user, transport: nodemailer.createTransport({ host, port, secure: port === 465, requireTLS: true,
    auth: { user, pass }, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 40_000,
    logger: false, debug: false }) };
}

// A shared write lock keeps the report consistent with the just-written plan.
// A permanent per-date claim survives retries and deployments. Ambiguous SMTP
// acceptance must be checked manually, never retried blindly with duplicate mail.
export async function sendDailyEmail(now = new Date()) {
  const date = shanghaiDay(now);
  const key = dailyEmailKey(date);
  const prior = await kv.get<Delivery>(key);
  if (prior?.status === 'sent') return { sent: true, duplicate: true, date };
  if (prior) throw new Error('今日邮件发送结果待核对，已停止自动重发');
  const lock = await acquireTickTickLock();
  if (!lock) return { busy: true, date };
  try {
    await syncTrainingSource(Number(date.slice(0, 4)), { lockHeld: true });
    const report = await readDailyBriefing(now);
    if (!report.ready || report.date !== date) throw new Error('今日计划尚未更新，邮件未发送');
    const { user, transport } = mailTransport();
    try { await transport.verify(); }
    catch { transport.close(); throw new Error('后台发信连接或认证失败，请检查 SMTP 授权配置'); }
    const delivery: Delivery = { attempt: randomUUID(), status: 'sending', startedAt: new Date().toISOString() };
    if (!await kv.set(key, delivery, { nx: true })) {
      if ((await kv.get<Delivery>(key))?.status === 'sent') return { sent: true, duplicate: true, date };
      throw new Error('今日邮件正在发送或结果待核对');
    }
    let accepted = false;
    try {
      const result = await transport.sendMail({ from: { name: 'bon · 每日计划', address: user },
        to: DAILY_EMAIL_RECIPIENT, subject: `${date} · 七天训练与今日事`,
        messageId: `<bon-daily-${date}@${user.split('@')[1] || 'bonbills.cn'}>`,
        text: emailText(report), html: renderDailyBriefing(report, true),
        disableFileAccess: true, disableUrlAccess: true });
      accepted = result.accepted.some(address => String(address).toLowerCase() === DAILY_EMAIL_RECIPIENT);
      if (!accepted) throw Object.assign(new Error('recipient rejected'), { responseCode: 550 });
      await kv.set(key, { ...delivery, status: 'sent', sentAt: new Date().toISOString() } satisfies Delivery);
      return { sent: true, duplicate: false, date };
    } catch (error) {
      const code = (error as { responseCode?: number }).responseCode;
      if (!accepted && code && code >= 400 && code < 600) {
        // A definitive SMTP rejection is safe to retry. Compare attempt identity
        // so a delayed failure can never remove another attempt's delivery state.
        await kv.eval("local v=redis.call('get',KEYS[1]); if v and cjson.decode(v).attempt==ARGV[1] then return redis.call('del',KEYS[1]) end return 0", [key], [delivery.attempt]);
        throw new Error('发信服务拒绝了邮件，请检查邮箱配置后重试');
      }
      await kv.set(key, { ...delivery, status: 'uncertain' } satisfies Delivery);
      throw new Error('邮件发送结果待核对，已停止自动重发');
    } finally { transport.close(); }
  } finally { await releaseTickTickLock(lock); }
}
