import { randomUUID } from 'node:crypto';
import { kv } from '@vercel/kv';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authOk, sameOrigin } from './_auth.js';
import { decryptOutlookConnection, encryptOutlookConnection, parseOutlookInput, parseOutlookRange, readOutlookSnapshot } from './_outlookCalendar.js';

const CONNECTION_KEY = 'outlook:calendar-connection:v1';
interface Connection { id: string; encrypted: string }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!sameOrigin(req)) return res.status(403).json({ error: '请求来源无效' });
  if (!await authOk(req)) return res.status(401).json({ error: 'unauthorized' });
  if (!['GET', 'POST', 'PUT', 'DELETE'].includes(req.method || '')) return res.status(405).json({ error: 'method not allowed' });
  const secret = (process.env.SYNC_SECRET || '').trim();
  try {
    if (req.method === 'DELETE') {
      await kv.del(CONNECTION_KEY);
      return res.status(200).json({ connected: false });
    }
    if (req.method === 'GET') {
      const connection = await kv.get<Connection>(CONNECTION_KEY);
      if (!connection) return res.status(200).json({ connected: false });
      const input = decryptOutlookConnection(connection.encrypted, secret);
      return res.status(200).json({ connected: true, connectionId: connection.id, policy: input.policy, rules: input.rules,
        calendars: { play: Boolean(input.playUrl), class: Boolean(input.classUrl) } });
    }
    let body;
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      parseOutlookRange(body?.startDate, body?.endDate);
    } catch {
      return res.status(400).json({ error: '日历同步日期无效' });
    }
    const { startDate, endDate } = parseOutlookRange(body.startDate, body.endDate);
    if (req.method === 'PUT' || body.action === 'preview') {
      let input;
      try { input = parseOutlookInput(body); }
      catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : '连接信息无效' }); }
      const snapshot = await readOutlookSnapshot(input, startDate, endDate);
      if (body.action === 'preview' && req.method === 'POST') return res.status(200).json({ snapshot, policy: input.policy });
      const connection: Connection = { id: randomUUID(), encrypted: encryptOutlookConnection(input, secret) };
      await kv.set(CONNECTION_KEY, connection);
      return res.status(200).json({ connected: true, connectionId: connection.id, snapshot, policy: input.policy });
    }
    const connection = await kv.get<Connection>(CONNECTION_KEY);
    if (!connection) return res.status(200).json({ connected: false });
    const input = decryptOutlookConnection(connection.encrypted, secret);
    const snapshot = await readOutlookSnapshot(input, startDate, endDate);
    const latest = await kv.get<Connection>(CONNECTION_KEY);
    if (latest?.id !== connection.id) return res.status(409).json({ error: '连接已变更，请重新同步' });
    return res.status(200).json({ connected: true, connectionId: connection.id, snapshot, policy: input.policy });
  } catch (error) {
    const message = error instanceof Error && /^「[玩课]」日历读取失败/.test(error.message)
      ? error.message : 'Outlook 暂不可用，请稍后重试';
    return res.status(502).json({ error: message });
  }
}
