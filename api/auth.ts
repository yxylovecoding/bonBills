import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  allowLoginAttempt, clearSessionCookie, createSession, credentialsMatch,
  deleteSession, keyMatches, loginConfig, readSession, sameOrigin,
} from './_auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Cookie');
  if (!['GET', 'POST', 'DELETE'].includes(req.method || '')) {
    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: '请求方式不支持' });
  }
  if (!sameOrigin(req)) return res.status(403).json({ error: '请求来源无效' });

  try {
    if (req.method === 'DELETE') {
      await deleteSession(req);
      clearSessionCookie(req, res);
      return res.status(200).json({ authenticated: false });
    }
    const config = loginConfig();
    if (!config.secret) return res.status(503).json({ error: '登录暂不可用' });
    if (req.method === 'GET') {
      const session = await readSession(req);
      return res.status(200).json(session
        ? { authenticated: true, username: session.username }
        : { authenticated: false });
    }
    if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) {
      return res.status(415).json({ error: '请求格式无效' });
    }
    let body: unknown;
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    } catch {
      return res.status(400).json({ error: '请求格式无效' });
    }
    const { username, password, key } = (body || {}) as Record<string, unknown>;
    const usesKey = key !== undefined;
    if (usesKey ? (typeof key !== 'string' || !key.trim() || key.length > 1024)
      : (typeof username !== 'string' || typeof password !== 'string'
        || !username.trim() || username.length > 100 || !password || password.length > 1024)) {
      return res.status(400).json({ error: '请输入账号和密码' });
    }
    if (!await allowLoginAttempt(req)) {
      res.setHeader('Retry-After', '900');
      return res.status(429).json({ error: '尝试次数过多，请稍后再试' });
    }
    const valid = usesKey ? keyMatches((key as string).trim())
      : credentialsMatch((username as string).trim(), password as string);
    if (!valid) {
      return res.status(401).json({ error: usesKey ? 'Key 错误' : '账号或密码错误' });
    }
    const session = await createSession(req, res);
    return res.status(200).json({ authenticated: true, username: session.username });
  } catch {
    return res.status(503).json({ error: '登录服务暂不可用，请稍后重试' });
  }
}
