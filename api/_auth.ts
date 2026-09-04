import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { kv } from '@vercel/kv';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const COOKIE_NAME = 'bonbills-session';
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const LOGIN_WINDOW_SECONDS = 15 * 60;

interface Session {
  username: string;
  version: string;
  expiresAt: number;
}

export function loginConfig() {
  const secret = (process.env.SYNC_SECRET || '').trim();
  return {
    secret,
    username: (process.env.LOGIN_USERNAME || '').trim() || 'bon',
    password: process.env.LOGIN_PASSWORD ?? secret,
  };
}

function digest(value: string) {
  return createHash('sha256').update(value).digest();
}

function equal(left: string, right: string) {
  return timingSafeEqual(new Uint8Array(digest(left)), new Uint8Array(digest(right)));
}

export function credentialsMatch(username: string, password: string) {
  const config = loginConfig();
  const usernameMatches = equal(username, config.username);
  const passwordMatches = equal(password, config.password);
  return Boolean(config.secret && config.password && usernameMatches && passwordMatches);
}

export function keyMatches(key: string) {
  const secret = loginConfig().secret;
  return Boolean(secret && equal(key, secret));
}

function credentialVersion() {
  const { secret, username, password } = loginConfig();
  return createHmac('sha256', secret).update(JSON.stringify([username, password])).digest('hex');
}

export function sameOrigin(req: VercelRequest) {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const url = new URL(origin);
    const protocol = process.env.VERCEL === '1' ? 'https'
      : String(req.headers['x-forwarded-proto'] || 'http');
    return url.host === req.headers.host && url.protocol === `${protocol}:`;
  } catch {
    return false;
  }
}

function sessionKey(req: VercelRequest) {
  const token = (req.headers.cookie || '').split(';')
    .map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE_NAME}=`))
    ?.slice(COOKIE_NAME.length + 1);
  return token && /^[a-f0-9]{64}$/.test(token)
    ? `auth:session:${digest(token).toString('hex')}`
    : null;
}

export async function readSession(req: VercelRequest): Promise<Session | null> {
  const config = loginConfig();
  if (!config.secret || !sameOrigin(req)) return null;
  const key = sessionKey(req);
  if (!key) return null;
  const session = await kv.get<Session>(key);
  if (!session || session.expiresAt <= Date.now() || session.username !== config.username
    || !equal(session.version, credentialVersion())) return null;
  return session;
}

export async function authOk(req: VercelRequest) {
  // 保留服务端脚本使用的 Bearer 鉴权；浏览器只使用 HttpOnly 会话。
  const secret = loginConfig().secret;
  const bearer = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1].trim();
  if (secret && bearer && equal(bearer, secret)) return true;
  return Boolean(await readSession(req));
}

function cookie(req: VercelRequest, value: string, maxAge: number) {
  const secure = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production'
    || req.headers['x-forwarded-proto'] === 'https';
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

export async function deleteSession(req: VercelRequest) {
  const key = sessionKey(req);
  if (key) await kv.del(key);
}

export async function createSession(req: VercelRequest, res: VercelResponse) {
  await deleteSession(req);
  const token = randomBytes(32).toString('hex');
  const session: Session = {
    username: loginConfig().username,
    version: credentialVersion(),
    expiresAt: Date.now() + SESSION_SECONDS * 1000,
  };
  await kv.set(`auth:session:${digest(token).toString('hex')}`, session, { ex: SESSION_SECONDS });
  res.setHeader('Set-Cookie', cookie(req, token, SESSION_SECONDS));
  return session;
}

export function clearSessionCookie(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Set-Cookie', cookie(req, '', 0));
}

export async function allowLoginAttempt(req: VercelRequest) {
  // Vercel 覆盖该头，避免用客户端可伪造的普通 forwarded-for 绕过限流。
  const ip = process.env.VERCEL === '1'
    ? String(req.headers['x-vercel-forwarded-for'] || 'unknown').split(',')[0].trim()
    : req.socket?.remoteAddress || 'local';
  const window = Math.floor(Date.now() / (LOGIN_WINDOW_SECONDS * 1000));
  const key = `auth:attempts:${digest(ip).toString('hex')}:${window}`;
  await kv.set(key, 0, { nx: true, ex: LOGIN_WINDOW_SECONDS });
  return await kv.incr(key) <= 10;
}
