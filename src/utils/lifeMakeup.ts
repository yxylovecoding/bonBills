import type { LifeEntries } from './bonLife.js';

export interface MakeupRecord { face: boolean | null; eyes: boolean | null; revision: string }
export const EMPTY_MAKEUP: MakeupRecord = { face: null, eyes: null, revision: '' };
export const MAKEUP_FIELDS = { face: '化妆', eyes: '眼妆' } as const;

export function parseMakeupRecord(value: unknown): MakeupRecord {
  const item = value as MakeupRecord | null;
  if (!item || typeof item !== 'object' || Array.isArray(item)
    || ![true, false, null].includes(item.face) || ![true, false, null].includes(item.eyes)
    || typeof item.revision !== 'string' || item.revision.length > 80
    || Object.keys(item).some((key) => !['face', 'eyes', 'revision'].includes(key))) throw new Error('化妆记录无效');
  return { face: item.face, eyes: item.eyes, revision: item.revision };
}

export function makeupSummary(value?: MakeupRecord): string[] {
  return (Object.keys(MAKEUP_FIELDS) as (keyof typeof MAKEUP_FIELDS)[]).flatMap((field) =>
    value?.[field] === true ? [`有${MAKEUP_FIELDS[field]}`] : value?.[field] === false ? [`无${MAKEUP_FIELDS[field]}`] : []);
}

export function syncMakeupEntries(entries: LifeEntries, date: string, makeup?: MakeupRecord): LifeEntries {
  if (!makeup) return entries;
  const next = { ...entries };
  for (const kind of ['skin', 'eyes']) {
    const key = `${kind}:${date}`;
    next[key] = { ...(entries[key] ?? { text: '', revision: '' }), makeup };
  }
  return next;
}

export function hydrateMakeupEntries(stored: LifeEntries): LifeEntries {
  let entries = Object.fromEntries(Object.entries(stored).filter(([key]) => !key.startsWith('makeup:')));
  for (const [key, entry] of Object.entries(stored)) {
    if (key.startsWith('makeup:')) entries = syncMakeupEntries(entries, key.slice(7), entry.makeup);
  }
  return entries;
}
