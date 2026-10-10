import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authOk } from './_auth.js';

interface NotionBody {
  title?: string;
  type?: string;
  finishDate?: string;
  rating?: number | string;
  comment?: string;
  databaseId?: string;
}

const NOTION_VERSION = '2022-06-28';
const DB_NAME_PATTERNS = ['reading list', '阅读清单', '阅读列表', '书影音'];

async function notionFetch(path: string, token: string, init?: RequestInit) {
  const res = await fetch(`https://api.notion.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* keep text */ }
  return { ok: res.ok, status: res.status, json, text };
}

async function findReadingListDb(token: string): Promise<any | null> {
  // 1) search databases
  const r = await notionFetch('/v1/search', token, {
    method: 'POST',
    body: JSON.stringify({ filter: { property: 'object', value: 'database' }, page_size: 100 }),
  });
  if (!r.ok) return null;
  const results: any[] = r.json?.results || [];
  const match = results.find((db) => {
    const title = (db.title || []).map((t: any) => (t.plain_text || '').toLowerCase()).join(' ').trim();
    return DB_NAME_PATTERNS.some((p) => title.includes(p));
  });
  return match || results[0] || null;
}

function pickProp(props: Record<string, any>, type: string, hints: string[]): string | null {
  const entries = Object.entries(props);
  // exact hint match first
  for (const h of hints) {
    const found = entries.find(([name, def]) => def.type === type && name.toLowerCase() === h.toLowerCase());
    if (found) return found[0];
  }
  for (const h of hints) {
    const found = entries.find(([name, def]) => def.type === type && name.toLowerCase().includes(h.toLowerCase()));
    if (found) return found[0];
  }
  // fallback: first prop of that type
  const first = entries.find(([_, def]) => def.type === type);
  return first ? first[0] : null;
}

function findTitleProp(props: Record<string, any>): string | null {
  const entry = Object.entries(props).find(([_, def]) => def.type === 'title');
  return entry ? entry[0] : null;
}

function toRatingValue(propDef: any, rating: number | string | undefined): any {
  if (rating === undefined || rating === null || rating === '') return null;
  const asString = typeof rating === 'string' ? rating : String(rating);
  const num = typeof rating === 'number' ? rating : parseInt(asString.replace(/[^0-9]/g, ''), 10);
  if (propDef.type === 'select') {
    const options: any[] = propDef.select?.options || [];
    // 1) exact option name
    const exact = options.find((o) => o.name === asString);
    if (exact) return { select: { name: exact.name } };
    // 2) match by star count (⭐ / ⭐️ / ★)
    if (Number.isFinite(num) && num > 0) {
      const stars = options.filter((o) => /^[⭐★️]+/.test(o.name));
      const byStars = stars.find((o) => {
        const count = (o.name.match(/⭐️|⭐|★/g) || []).length;
        return count === num;
      });
      if (byStars) return { select: { name: byStars.name } };
      // fallback: contains the digit
      const byDigit = options.find((o) => o.name.includes(String(num)));
      if (byDigit) return { select: { name: byDigit.name } };
    }
    return { select: { name: asString } };
  }
  if (propDef.type === 'number') {
    if (!Number.isFinite(num)) return null;
    return { number: num };
  }
  if (propDef.type === 'multi_select') return { multi_select: [{ name: asString }] };
  if (propDef.type === 'rich_text') return { rich_text: [{ text: { content: asString } }] };
  return null;
}

function toTypeValue(propDef: any, type: string | undefined): any {
  if (!type) return null;
  if (propDef.type === 'select') {
    const options: any[] = propDef.select?.options || [];
    const parts = type.split(/[\/、,，]/).map((p) => p.trim()).filter(Boolean);
    for (const part of [type, ...parts]) {
      const exact = options.find((o) => o.name === part);
      if (exact) return { select: { name: exact.name } };
    }
    for (const part of parts) {
      const fuzzy = options.find((o) => o.name.includes(part) || part.includes(o.name));
      if (fuzzy) return { select: { name: fuzzy.name } };
    }
    // common english → emoji mappings
    const alias: Record<string, string[]> = {
      'tv show': ['📺剧', '📺动画', '📺综艺'],
      'tv': ['📺剧'],
      'drama': ['📺剧', '🎬戏剧'],
      'series': ['📺剧'],
      'show': ['📺剧'],
      'anime': ['📺动画'],
      'movie': ['🎬电影'],
      'film': ['🎬电影'],
      'book': ['📖书'],
      'manga': ['📖漫画'],
      'game': ['🎮游戏'],
    };
    const lower = type.toLowerCase();
    for (const key of Object.keys(alias)) {
      if (lower.includes(key)) {
        for (const candidate of alias[key]) {
          const hit = options.find((o) => o.name === candidate);
          if (hit) return { select: { name: hit.name } };
        }
      }
    }
    return { select: { name: type } };
  }
  if (propDef.type === 'multi_select') {
    const parts = type.split(/[\/、,，]/).map((p) => p.trim()).filter(Boolean);
    return { multi_select: parts.map((name) => ({ name })) };
  }
  if (propDef.type === 'rich_text') return { rich_text: [{ text: { content: type } }] };
  if (propDef.type === 'status') return { status: { name: type } };
  return null;
}

function toDateValue(propDef: any, date: string | undefined): any {
  if (!date) return null;
  if (propDef.type === 'date') return { date: { start: date } };
  if (propDef.type === 'rich_text') return { rich_text: [{ text: { content: date } }] };
  return null;
}

function toCommentValue(propDef: any, comment: string | undefined): any {
  if (!comment) return null;
  if (propDef.type === 'rich_text') return { rich_text: [{ text: { content: comment } }] };
  if (propDef.type === 'title') return { title: [{ text: { content: comment } }] };
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!(await authOk(req))) return res.status(401).json({ error: 'unauthorized' });

  const token = (process.env.NOTION_TOKEN || '').trim();
  if (!token) return res.status(503).json({ error: 'NOTION_TOKEN not configured' });

  if (req.method === 'GET') {
    // Debug: return database schema
    const db = (req.query.databaseId as string) || (await findReadingListDb(token));
    if (!db) return res.status(404).json({ error: 'Reading List database not found. Share it with the integration.' });
    const dbObj = typeof db === 'string' ? (await notionFetch(`/v1/databases/${db}`, token)).json : db;
    return res.status(200).json({
      id: dbObj.id,
      title: (dbObj.title || []).map((t: any) => t.plain_text).join(''),
      url: dbObj.url,
      properties: Object.fromEntries(
        Object.entries(dbObj.properties || {}).map(([k, v]: any) => [k, { type: v.type, options: v.select?.options || v.multi_select?.options || v.status?.options }]),
      ),
    });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as NotionBody;
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'invalid body' });
  const { title, type, finishDate, rating, comment, databaseId } = body;
  if (!title) return res.status(400).json({ error: 'title is required' });

  let dbObj: any;
  if (databaseId) {
    const r = await notionFetch(`/v1/databases/${databaseId}`, token);
    if (!r.ok) return res.status(r.status).json({ error: 'failed to fetch database', detail: r.json || r.text });
    dbObj = r.json;
  } else {
    dbObj = await findReadingListDb(token);
    if (!dbObj) return res.status(404).json({ error: 'Reading List database not found. Please share it with the Notion integration (bonlife).' });
  }

  const props: Record<string, any> = dbObj.properties || {};
  const titlePropName = findTitleProp(props);
  if (!titlePropName) return res.status(500).json({ error: 'database has no title property' });

  const typePropName = pickProp(props, 'select', ['type', '类型', 'category', '分类']) ||
    pickProp(props, 'multi_select', ['type', '类型', 'category', '分类']) ||
    pickProp(props, 'status', ['type', '类型']);
  const datePropName = pickProp(props, 'date', ['finish', 'completed', 'done', 'date', '完成', '日期', 'finished']);
  const ratingPropName = pickProp(props, 'select', ['rating', '评分', 'score', 'stars', '星级']) ||
    pickProp(props, 'number', ['rating', '评分', 'score']) ||
    pickProp(props, 'multi_select', ['rating', '评分']);
  const commentPropName = pickProp(props, 'rich_text', ['comment', '评论', 'review', '感想', 'notes', 'note', '备注']);

  const payloadProps: Record<string, any> = {
    [titlePropName]: { title: [{ text: { content: title } }] },
  };
  if (typePropName && type) {
    const v = toTypeValue(props[typePropName], type);
    if (v) payloadProps[typePropName] = v;
  }
  if (datePropName && finishDate) {
    const v = toDateValue(props[datePropName], finishDate);
    if (v) payloadProps[datePropName] = v;
  }
  if (ratingPropName && rating !== undefined) {
    const v = toRatingValue(props[ratingPropName], rating);
    if (v) payloadProps[ratingPropName] = v;
  }
  if (commentPropName && comment) {
    const v = toCommentValue(props[commentPropName], comment);
    if (v) payloadProps[commentPropName] = v;
  }

  const create = await notionFetch('/v1/pages', token, {
    method: 'POST',
    body: JSON.stringify({
      parent: { database_id: dbObj.id },
      properties: payloadProps,
    }),
  });
  if (!create.ok) {
    return res.status(create.status).json({
      error: 'notion create failed',
      detail: create.json || create.text,
      mapped: {
        title: titlePropName,
        type: typePropName,
        finishDate: datePropName,
        rating: ratingPropName,
        comment: commentPropName,
      },
    });
  }
  return res.status(200).json({
    ok: true,
    page: { id: create.json.id, url: create.json.url },
    databaseId: dbObj.id,
    mapped: {
      title: titlePropName,
      type: typePropName,
      finishDate: datePropName,
      rating: ratingPropName,
      comment: commentPropName,
    },
  });
}
