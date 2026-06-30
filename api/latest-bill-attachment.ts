import tls from 'node:tls';
import type { VercelRequest, VercelResponse } from '@vercel/node';

type Attachment = {
  fileName: string;
  contentType: string;
  data: Buffer;
};

type HeaderValue = {
  value: string;
  params: Record<string, string>;
};

type ImapStatus = {
  status: 'OK' | 'NO' | 'BAD';
  detail: string;
};

const DEFAULT_ATTACHMENT_PATTERN = '^账单_\\d{10}\\.xlsx?$';
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function authOk(req: VercelRequest): boolean {
  const secret = (process.env.SYNC_SECRET || '').trim();
  if (!secret) return false;
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/);
  return match !== null && match[1].trim() === secret;
}

function envValue(...keys: string[]): string {
  for (const key of keys) {
    const value = (process.env[key] || '').trim();
    if (value) return value;
  }
  return '';
}

function quoteImap(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function imapSinceDate(days: number): string {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return `${d.getUTCDate()}-${MONTH_NAMES[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
}

function taggedStatus(text: string, tag: string): ImapStatus | null {
  const match = text.match(new RegExp(`(?:^|\\r\\n)${tag} (OK|NO|BAD)([^\\r\\n]*)`));
  if (!match) return null;
  return {
    status: match[1] as ImapStatus['status'],
    detail: match[2].trim(),
  };
}

class ImapClient {
  private nextTag = 1;

  private constructor(private socket: tls.TLSSocket, private timeoutMs: number) {}

  static connect(host: string, port: number, timeoutMs: number): Promise<ImapClient> {
    return new Promise((resolve, reject) => {
      const socket = tls.connect({ host, port, servername: host });
      const chunks: Buffer[] = [];
      const timer = setTimeout(() => {
        cleanup();
        socket.destroy();
        reject(new Error('连接邮箱超时'));
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        socket.off('data', onData);
        socket.off('error', onError);
      };
      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };
      const onData = (chunk: Buffer) => {
        chunks.push(chunk);
        const text = Buffer.concat(chunks).toString('utf8');
        if (/^\* (OK|PREAUTH)/.test(text)) {
          cleanup();
          resolve(new ImapClient(socket, timeoutMs));
        }
      };
      socket.on('data', onData);
      socket.on('error', onError);
    });
  }

  command(command: string, label = '命令'): Promise<Buffer> {
    const tag = `A${this.nextTag++}`;
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('邮箱命令超时'));
      }, this.timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        this.socket.off('data', onData);
        this.socket.off('error', onError);
      };
      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };
      const onData = (chunk: Buffer) => {
        chunks.push(chunk);
        const buf = Buffer.concat(chunks);
        const text = buf.toString('latin1');
        const status = taggedStatus(text, tag);
        if (!status) return;
        cleanup();
        if (status.status !== 'OK') {
          const detail = status.detail ? `：${status.detail}` : '';
          reject(new Error(`邮箱${label}失败：${status.status}${detail}`));
        }
        else resolve(buf);
      };
      this.socket.on('data', onData);
      this.socket.on('error', onError);
      this.socket.write(`${tag} ${command}\r\n`);
    });
  }

  close() {
    this.socket.end();
  }
}

function parseSearchUids(response: Buffer): number[] {
  const text = response.toString('utf8');
  const match = text.match(/\* SEARCH(?: ([0-9 ]+))?\r?\n/);
  if (!match?.[1]) return [];
  return match[1]
    .trim()
    .split(/\s+/)
    .map((v) => Number(v))
    .filter((v) => Number.isInteger(v) && v > 0);
}

function extractFetchLiteral(response: Buffer): Buffer | null {
  const text = response.toString('latin1');
  const matches = Array.from(text.matchAll(/\{(\d+)\}\r\n/g));
  for (let i = matches.length - 1; i >= 0; i--) {
    const match = matches[i];
    if (match.index === undefined) continue;
    const size = Number(match[1]);
    const start = match.index + match[0].length;
    if (Number.isInteger(size) && size > 0 && start + size <= response.length) {
      return response.subarray(start, start + size);
    }
  }
  return null;
}

function splitHeaderBody(raw: string): { headers: Map<string, string>; body: string } {
  let idx = raw.indexOf('\r\n\r\n');
  let sepLen = 4;
  if (idx < 0) {
    idx = raw.indexOf('\n\n');
    sepLen = 2;
  }
  const headerText = idx >= 0 ? raw.slice(0, idx) : raw;
  const body = idx >= 0 ? raw.slice(idx + sepLen) : '';
  const unfolded: string[] = [];
  for (const line of headerText.replace(/\r\n/g, '\n').split('\n')) {
    if (/^[ \t]/.test(line) && unfolded.length) {
      unfolded[unfolded.length - 1] += ` ${line.trim()}`;
    } else {
      unfolded.push(line);
    }
  }
  const headers = new Map<string, string>();
  for (const line of unfolded) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    headers.set(key, headers.has(key) ? `${headers.get(key)}, ${value}` : value);
  }
  return { headers, body };
}

function splitParams(value: string): string[] {
  const parts: string[] = [];
  let cur = '';
  let inQuote = false;
  let escaped = false;
  for (const ch of value) {
    if (escaped) {
      cur += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\' && inQuote) {
      escaped = true;
      cur += ch;
      continue;
    }
    if (ch === '"') inQuote = !inQuote;
    if (ch === ';' && !inQuote) {
      parts.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  parts.push(cur.trim());
  return parts;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return trimmed;
}

function parseHeaderValue(raw: string): HeaderValue {
  const [value, ...paramParts] = splitParams(raw);
  const params: Record<string, string> = {};
  for (const part of paramParts) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    params[part.slice(0, idx).trim().toLowerCase()] = unquote(part.slice(idx + 1));
  }
  return { value: value.trim().toLowerCase(), params };
}

function decodeBytes(bytes: Buffer, charset: string): string {
  const normalized = charset.trim().toLowerCase().replace(/^utf8$/, 'utf-8');
  const label = /^(gb2312|gbk|gb18030)$/.test(normalized) ? 'gb18030' : normalized;
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return bytes.toString('utf8');
  }
}

function decodeQuotedPrintableBytes(value: string): Buffer {
  const input = value.replace(/=\r?\n/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < input.length; i++) {
    if (input[i] === '=' && /^[0-9a-fA-F]{2}$/.test(input.slice(i + 1, i + 3))) {
      bytes.push(parseInt(input.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(input.charCodeAt(i) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

function decodeEncodedWords(value: string): string {
  return value
    .replace(/(=\?[^?]+\?[bqBQ]\?[^?]*\?=)\s+(?==\?)/g, '$1')
    .replace(/=\?([^?]+)\?([bqBQ])\?([^?]*)\?=/g, (_all, charset: string, encoding: string, payload: string) => {
      const bytes = encoding.toUpperCase() === 'B'
        ? Buffer.from(payload, 'base64')
        : decodeQuotedPrintableBytes(payload.replace(/_/g, ' '));
      return decodeBytes(bytes, charset);
    });
}

function percentBytes(value: string): Buffer {
  const bytes: number[] = [];
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '%' && /^[0-9a-fA-F]{2}$/.test(value.slice(i + 1, i + 3))) {
      bytes.push(parseInt(value.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(value.charCodeAt(i) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

function decodeRfc2231(value: string): string {
  const match = value.match(/^([^']*)'[^']*'(.*)$/);
  if (match) return decodeBytes(percentBytes(match[2]), match[1] || 'utf-8');
  try {
    return decodeURIComponent(value);
  } catch {
    return decodeEncodedWords(value);
  }
}

function decodeParam(params: Record<string, string>, name: string): string {
  const lower = name.toLowerCase();
  if (params[`${lower}*`]) return decodeRfc2231(params[`${lower}*`]);

  const pieces = Object.entries(params)
    .map(([key, value]) => {
      const match = key.match(new RegExp(`^${lower}\\*(\\d+)(\\*)?$`));
      return match ? { index: Number(match[1]), encoded: !!match[2], value } : null;
    })
    .filter((piece): piece is { index: number; encoded: boolean; value: string } => piece !== null)
    .sort((a, b) => a.index - b.index);
  if (pieces.length) {
    const joined = pieces.map((piece) => piece.value).join('');
    return pieces.some((piece) => piece.encoded) ? decodeRfc2231(joined) : decodeEncodedWords(joined);
  }

  return params[lower] ? decodeEncodedWords(params[lower]) : '';
}

function splitMultipart(body: string, boundary: string): string[] {
  const marker = `--${boundary}`;
  const segments = body.split(marker).slice(1);
  const parts: string[] = [];
  for (const segment of segments) {
    if (segment.startsWith('--')) break;
    parts.push(segment.replace(/^\r?\n/, '').replace(/\r?\n$/, ''));
  }
  return parts;
}

function decodePartBody(body: string, transferEncoding: string): Buffer {
  const encoding = transferEncoding.trim().toLowerCase();
  if (encoding === 'base64') return Buffer.from(body.replace(/\s/g, ''), 'base64');
  if (encoding === 'quoted-printable') return decodeQuotedPrintableBytes(body);
  return Buffer.from(body, 'latin1');
}

function collectAttachments(raw: string): Attachment[] {
  const { headers, body } = splitHeaderBody(raw);
  const contentType = parseHeaderValue(headers.get('content-type') || 'text/plain');
  const boundary = contentType.params.boundary;
  if (boundary) return splitMultipart(body, boundary).flatMap((part) => collectAttachments(part));

  const disposition = parseHeaderValue(headers.get('content-disposition') || '');
  const fileName = decodeParam(disposition.params, 'filename') || decodeParam(contentType.params, 'name');
  if (!fileName) return [];

  return [{
    fileName,
    contentType: contentType.value || 'application/octet-stream',
    data: decodePartBody(body, headers.get('content-transfer-encoding') || ''),
  }];
}

function messageMeta(raw: Buffer): { subject: string; date: string } {
  const { headers } = splitHeaderBody(raw.toString('latin1'));
  return {
    subject: decodeEncodedWords(headers.get('subject') || ''),
    date: headers.get('date') || '',
  };
}

async function findLatestBillAttachment(): Promise<{
  attachment: Attachment;
  uid: number;
  subject: string;
  date: string;
}> {
  const user = envValue('BILL_MAIL_USER', 'MAIL_163_USER', 'NETEASE_MAIL_USER');
  const pass = envValue('BILL_MAIL_PASS', 'MAIL_163_PASS', 'NETEASE_MAIL_PASS');
  if (!user || !pass) throw new Error('缺少 BILL_MAIL_USER 或 BILL_MAIL_PASS');

  const host = envValue('BILL_MAIL_HOST', 'MAIL_163_HOST') || 'imap.163.com';
  const port = Number(envValue('BILL_MAIL_PORT', 'MAIL_163_PORT') || 993);
  const mailbox = envValue('BILL_MAILBOX', 'MAIL_163_MAILBOX') || 'INBOX';
  const lookbackDays = Number(envValue('BILL_MAIL_LOOKBACK_DAYS') || 90);
  const scanLimit = Number(envValue('BILL_MAIL_SCAN_LIMIT') || 80);
  const timeoutMs = Number(envValue('BILL_MAIL_TIMEOUT_MS') || 20000);
  const filePattern = new RegExp(envValue('BILL_ATTACHMENT_PATTERN') || DEFAULT_ATTACHMENT_PATTERN, 'i');

  const client = await ImapClient.connect(host, port, timeoutMs);
  try {
    await client.command(`LOGIN ${quoteImap(user)} ${quoteImap(pass)}`, '登录');
    await client.command(`SELECT ${quoteImap(mailbox)}`, '打开邮箱');
    const search = await client.command(`UID SEARCH SINCE ${imapSinceDate(Number.isFinite(lookbackDays) ? lookbackDays : 90)}`, '搜索邮件');
    const uids = parseSearchUids(search).slice(-(Number.isFinite(scanLimit) ? scanLimit : 80)).reverse();
    for (const uid of uids) {
      const fetched = await client.command(`UID FETCH ${uid} (BODY.PEEK[])`, '读取邮件');
      const raw = extractFetchLiteral(fetched);
      if (!raw) continue;
      const attachment = collectAttachments(raw.toString('latin1')).find((item) => filePattern.test(item.fileName));
      if (attachment) {
        const meta = messageMeta(raw);
        return { attachment, uid, ...meta };
      }
    }
  } finally {
    try {
      await client.command('LOGOUT', '退出');
    } catch {
      // ignore logout errors
    }
    client.close();
  }

  throw new Error('没有找到匹配的账单附件');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!authOk(req)) return res.status(401).json({ error: 'unauthorized' });
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });

  try {
    const { attachment, uid, subject, date } = await findLatestBillAttachment();
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      fileName: attachment.fileName,
      contentType: attachment.contentType,
      base64: attachment.data.toString('base64'),
      uid,
      subject,
      date,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('没有找到') ? 404 : 500;
    return res.status(status).json({ error: message });
  }
}
