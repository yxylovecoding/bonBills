import { randomUUID } from 'node:crypto';
import { kv } from '@vercel/kv';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authOk, sameOrigin } from './_auth.js';
import { encryptOutlookConnection, validateOutlookUrl } from './_outlookCalendar.js';
import { DEFAULT_OUTLOOK_RULES } from '../src/utils/outlookCalendar.js';
import { lifeYear, parseLifeEdit, periodDays, type LifeEntries, type LifeEntry } from '../src/utils/bonLife.js';
import { LIFE_CONNECTION_KEY, SAVE_LIFE_ENTRY, entriesKey, periodsKey, readPeriodCalendar, syncLifePeriods,
  type LifeConnection, type PeriodSnapshot } from './_bonLife.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Cookie');
  if (!sameOrigin(req)) return res.status(403).json({ error: '请求来源无效' });
  try {
    if (!await authOk(req)) return res.status(401).json({ error: '请先登录' });
    if (!['GET', 'POST', 'PUT', 'DELETE'].includes(req.method || '')) return res.status(405).json({ error: '请求方式无效' });
    if (req.method === 'DELETE') {
      await kv.del(LIFE_CONNECTION_KEY);
      return res.status(200).json({ connected: false });
    }
    let body: Record<string, unknown> = {};
    let year: number;
    try {
      if (req.method !== 'GET') body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      year = lifeYear(req.method === 'GET' ? req.query.year : body?.year ?? String(body?.date).slice(0, 4));
    } catch { return res.status(400).json({ error: '请求内容或年份无效' }); }
    if (req.method === 'GET') {
      const [entries, periods, connection] = await Promise.all([
        kv.hgetall<LifeEntries>(entriesKey(year)), kv.get<PeriodSnapshot>(periodsKey(year)), kv.get<LifeConnection>(LIFE_CONNECTION_KEY),
      ]);
      return res.status(200).json({ year, entries: entries ?? {}, periodDays: periodDays(periods?.events ?? [], year),
        syncedAt: periods?.syncedAt ?? null, connected: Boolean(connection) });
    }
    if (req.method === 'PUT') {
      let url: string;
      try {
        if (typeof body.url !== 'string' || body.url.length > 4096) throw new Error();
        url = validateOutlookUrl(body.url);
      } catch { return res.status(400).json({ error: '请输入 Outlook 发布的 ICS 订阅链接' }); }
      const connection: LifeConnection = { id: randomUUID(), encrypted: encryptOutlookConnection({ playUrl: url, classUrl: '',
        policy: 'manual', rules: DEFAULT_OUTLOOK_RULES }, (process.env.SYNC_SECRET || '').trim()) };
      // Verify the subscription before replacing a working connection.
      await readPeriodCalendar(connection, year);
      await kv.set(LIFE_CONNECTION_KEY, connection);
      return res.status(200).json({ connected: true });
    }
    if (body.action === 'sync-periods') {
      const connection = await kv.get<LifeConnection>(LIFE_CONNECTION_KEY);
      if (!connection) return res.status(200).json({ connected: false });
      return res.status(200).json({ connected: true, ...await syncLifePeriods(connection, year) });
    }
    if (body.action !== 'save') return res.status(400).json({ error: '操作无效' });
    let edit;
    try { edit = parseLifeEdit(body); }
    catch { return res.status(400).json({ error: '记录内容无效' }); }
    const entry = { text: edit.text, revision: edit.mutationId };
    const [ok, raw] = await kv.eval<string[], [number, string | LifeEntry]>(SAVE_LIFE_ENTRY, [entriesKey(edit.year)],
      [`${edit.kind}:${edit.date}`, edit.revision, edit.mutationId, JSON.stringify(entry)]);
    const stored = typeof raw === 'string' ? (raw ? JSON.parse(raw) : { text: '', revision: '' }) : raw;
    if (!ok) return res.status(409).json({ error: '这一天的记录已在其他页面更新', current: stored });
    return res.status(200).json({ entry: stored });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === '日历连接或内容已更新，请重新同步') return res.status(409).json({ error: message });
    if (message.startsWith('Outlook 日历读取失败')) return res.status(502).json({ error: message });
    return res.status(503).json({ error: '暂时无法保存或读取，请重试' });
  }
}
