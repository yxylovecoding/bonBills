import { randomUUID } from 'node:crypto';
import { kv } from '@vercel/kv';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authOk, sameOrigin } from './_auth.js';
import { decryptOutlookConnection, encryptOutlookConnection, parseOutlookInput, parseOutlookRange, readOutlookSnapshot } from './_outlookCalendar.js';
import { disconnectOutlookCalendar, OUTLOOK_CONNECTION_KEY as CONNECTION_KEY, outlookSyncError, saveOutlookSnapshot, type OutlookConnection as Connection } from './_outlookSync.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!sameOrigin(req)) return res.status(403).json({ error: '请求来源无效' });
  if (!await authOk(req)) return res.status(401).json({ error: 'unauthorized' });
  if (!['GET', 'POST', 'PUT', 'DELETE'].includes(req.method || '')) return res.status(405).json({ error: 'method not allowed' });
  const secret = (process.env.SYNC_SECRET || '').trim();
  try {
    if (req.method === 'DELETE') {
      await disconnectOutlookCalendar();
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
    const requestedAt = Date.now();
    if (req.method === 'PUT' || body.action === 'preview') {
      let input;
      try { input = parseOutlookInput(body); }
      catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : '连接信息无效' }); }
      const snapshot = await readOutlookSnapshot(input, startDate, endDate);
      if (body.action === 'preview' && req.method === 'POST') return res.status(200).json({ snapshot, policy: input.policy });
      const connection: Connection = { id: randomUUID(), encrypted: encryptOutlookConnection(input, secret) };
      await saveOutlookSnapshot(connection, snapshot, input.policy, requestedAt, true);
      return res.status(200).json({ connected: true, connectionId: connection.id, snapshot, policy: input.policy });
    }
    const connection = await kv.get<Connection>(CONNECTION_KEY);
    if (!connection) return res.status(200).json({ connected: false });
    const input = decryptOutlookConnection(connection.encrypted, secret);
    const snapshot = await readOutlookSnapshot(input, startDate, endDate);
    await saveOutlookSnapshot(connection, snapshot, input.policy, requestedAt);
    return res.status(200).json({ connected: true, connectionId: connection.id, snapshot, policy: input.policy });
  } catch (error) {
    const message = outlookSyncError(error);
    return res.status(/^(连接已变更|日历已更新|日历正在同步)/.test(message) ? 409 : 502).json({ error: message });
  }
}
