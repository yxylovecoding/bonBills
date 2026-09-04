import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { kv } from '@vercel/kv';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const COOKIE_NAME = 'bonbills-session';
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const LOGIN_WINDOW_SECONDS = 15 * 60;

interface Session {
  kind: 'key' | 'account';
  username: string;
  version: string;
  expiresAt: number;
}

export interface BoundAccount {
  username: string;
  passwordHash: string;
  passwordSalt: string;
  passwordAlgorithm: 'scrypt-v1';
  createdAt: string;
}

export function loginConfig() {
  const secret = (process.env.SYNC_SECRET || '').trim();
  return { secret };
}

function digest(value: string) {
  return createHash('sha256').update(value).digest();
}

function equal(left: string, right: string) {
  return timingSafeEqual(new Uint8Array(digest(left)), new Uint8Array(digest(right)));
}

function accountKey() {
  // 一个现有 Key 对应一条账号绑定；账本仍使用原来的存储键。
  const fingerprint = createHmac('sha256', loginConfig().secret).update('account-binding:v1').digest('hex');
  return `auth:account:v1:${fingerprint}`;
}

export async function readAccount() {
  if (!loginConfig().secret) return null;
  return kv.get<BoundAccount>(accountKey());
}

function hashPassword(password: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key.toString('hex'));
    });
  });
}

export async function registerAccount(username: string, password: string): Promise<BoundAccount | null> {
  const passwordSalt = randomBytes(16).toString('hex');
  const account: BoundAccount = {
    username,
    passwordSalt,
    passwordHash: await hashPassword(password, passwordSalt),
    passwordAlgorithm: 'scrypt-v1',
    createdAt: new Date().toISOString(),
  };
  // NX 保证重复或并发注册无法覆盖已经绑定的账号。
  const saved = await kv.set(accountKey(), account, { nx: true });
  return saved ? account : null;
}

export async function authenticateAccount(username: string, password: string): Promise<BoundAccount | null> {
  const account = await readAccount();
  if (!account || account.passwordAlgorithm !== 'scrypt-v1') return null;
  const usernameMatches = equal(username, account.username);
  const passwordMatches = equal(await hashPassword(password, account.passwordSalt), account.passwordHash);
  return usernameMatches && passwordMatches ? account : null;
}

export function keyMatches(key: string) {
  const secret = loginConfig().secret;
  return Boolean(secret && equal(key, secret));
}

function credentialVersion(account?: BoundAccount) {
  const identity = account
    ? ['account:v2', account.username, account.passwordSalt, account.passwordHash]
    : ['key:v2'];
  return createHmac('sha256', loginConfig().secret).update(JSON.stringify(identity)).digest('hex');
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
  if (!session || session.expiresAt <= Date.now()) return null;
  if (session.kind === 'key') {
    return equal(session.version, credentialVersion()) ? session : null;
  }
  if (session.kind !== 'account') return null;
  const account = await readAccount();
  if (!account || session.username !== account.username
    || !equal(session.version, credentialVersion(account))) return null;
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

export async function createSession(req: VercelRequest, res: VercelResponse, account?: BoundAccount) {
  await deleteSession(req);
  const token = randomBytes(32).toString('hex');
  const session: Session = {
    kind: account ? 'account' : 'key',
    username: account?.username ?? 'Key',
    version: credentialVersion(account),
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
