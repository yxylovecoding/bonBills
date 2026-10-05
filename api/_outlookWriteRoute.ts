import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authOk, sameOrigin } from './_auth.js';
import { connectOutlookMake, disconnectOutlookWrite, outlookWriteStatus, OutlookWriteError, pollOutlookWrite, selectOutlookWriteCalendar, startOutlookWrite, withOutlookWriteLock } from './_outlookWrite.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('Vary', 'Cookie');
  if (!sameOrigin(req)) return res.status(403).json({ error: '请求来源无效' });
  if (!await authOk(req)) return res.status(401).json({ error: '请先登录' });
  if (!['GET', 'POST', 'DELETE'].includes(req.method ?? '')) return res.status(405).json({ error: '请求方式无效' });
  try {
    const result = await withOutlookWriteLock(async () => {
      if (req.method === 'GET') return outlookWriteStatus(req.query.calendars === 'true');
      if (req.method === 'DELETE') { await disconnectOutlookWrite(); return { connected: false, enabled: false }; }
      let body: Record<string, unknown>;
      try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch { throw new OutlookWriteError('请求内容无效', 400); }
      if (body?.action === 'start') return startOutlookWrite(body.clientId);
      if (body?.action === 'make') return connectOutlookMake(body.webhookUrl);
      if (body?.action === 'poll') return pollOutlookWrite(body.flowId);
      if (body?.action === 'select') { await selectOutlookWriteCalendar(body.calendarId); return outlookWriteStatus(); }
      throw new OutlookWriteError('请求内容无效', 400);
    });
    return res.status(200).json(result);
  } catch (error) {
    // A Microsoft token failure must not be confused with a BonBills login expiry.
    return res.status(error instanceof OutlookWriteError ? error.status === 401 ? 424 : error.status : 502)
      .json({ error: error instanceof OutlookWriteError ? error.message : 'Outlook 连接暂不可用，请重试' });
  }
}
