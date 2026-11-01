import { kv } from './_accountKv.js';
import { randomBytes } from 'node:crypto';
import { readAllTickTickTasks, type TickTickTask, type TickTickOpenApiClient } from './_ticktickTrips.js';

type Shared = { title: string; content: string; desc: string; kind: string; items: string[] };
type Pair = { ids: [string, string]; baseline?: Shared };
type State = { pairs: Record<string, Pair>; movingInstances?: Record<string, Record<string, string>> };
const keys = ['🪥漱', '🧴护', '💄妆', '🛀浴', '📷相机', '🧥', '随身背包', '⚪小袋子', '⚫小袋子', '白色行李袋'];
const normalize = (s: string) => s.normalize('NFKC').replace(/[\uFE0E\uFE0F\s]/g, '');
const prefix = (s: string) => s.match(/^[🎒🧳📦]+/u)?.[0] ?? '';
const shared = (t: TickTickTask, special: boolean): Shared => ({
  title: special ? '' : t.title.slice(prefix(t.title).length), content: t.content ?? '', desc: t.desc ?? '',
  kind: t.kind ?? 'TEXT', items: (t.items ?? []).map(i => i.title),
});
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const version = (t: TickTickTask) => JSON.stringify(t);
const modified = (t: TickTickTask) => Date.parse((t as TickTickTask & { modifiedTime?: string }).modifiedTime ?? '');

export function templatePairs(tasks: TickTickTask[], rootId: string, saved: State): Record<string, Pair> {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const moving = tasks.filter(t => /^搬家模[板版]$/.test(t.title.trim()));
  if (!byId.has(rootId) || moving.length !== 1) throw new Error('模板同步：出门或搬家模板缺失／重名');
  const roots = [rootId, moving[0].id];
  const children = roots.map(root => tasks.filter(t => t.parentId && byId.get(t.parentId)?.parentId === root));
  return Object.fromEntries(keys.map(key => {
    const old = saved.pairs[key];
    const ids = children.map((list, side) => {
      if (old && list.some(t => t.id === old.ids[side])) return old.ids[side];
      const matches = list.filter(t => key === '白色行李袋'
        ? side === 0 ? /^🧳【[⚪🤍]】$/.test(normalize(t.title)) : normalize(t.title) === '📦'
        : normalize(t.title).includes(key));
      if (matches.length !== 1) throw new Error(`模板同步：${key} 缺失或有多个匹配`);
      return matches[0].id;
    }) as [string, string];
    return [key, { ids, ...(old && equal(old.ids, ids) ? { baseline: old.baseline } : {}) }];
  }));
}

async function writeShared(api: TickTickOpenApiClient, task: TickTickTask, value: Shared, key: string) {
  const current = await api.getTask(task.projectId, task.id);
  if (!current || version(current) !== version(task)) throw new Error('待办在同步期间发生修改，请重试');
  const remaining = [...(task.items ?? [])];
  const items = value.items.map((title, index) => {
    const found = remaining.findIndex(i => i.title === title);
    const item = found >= 0 ? remaining.splice(found, 1)[0] : { id: randomBytes(12).toString('hex'), status: 0 };
    return { ...item, title, sortOrder: index };
  });
  const payload: Record<string, unknown> = { id: task.id, projectId: task.projectId };
  for (const field of ['title', 'content', 'desc', 'kind', 'items', 'parentId', 'isAllDay', 'startDate', 'dueDate', 'timeZone', 'reminders', 'tags', 'repeatFlag', 'repeatFrom', 'priority', 'sortOrder'] as const)
    if (task[field] !== undefined) payload[field] = task[field];
  Object.assign(payload, { content: value.content, desc: value.desc, kind: value.kind, items,
    title: key === '白色行李袋' ? task.title : prefix(task.title) + value.title });
  await api.updateTask(task.id, payload);
  const verified = await api.getTask(task.projectId, task.id);
  if (!verified || !equal(shared(verified, key === '白色行李袋'), value) || prefix(verified.title) !== prefix(task.title)
    || verified.parentId !== task.parentId) throw new Error('模板同步回读校验失败');

}

// Caller holds the shared TickTick write lock. Only template text is shared;
// stage dates, parent links, tags, progress and each container prefix stay local.
export async function syncTickTickTemplates(api: TickTickOpenApiClient, rootId: string, connectionId: string) {
  const storageKey = `ticktick:template-pairs:v1:${connectionId}:${rootId}`;
  const saved = await kv.get<State>(storageKey) ?? { pairs: {} };
  const tasks = await readAllTickTickTasks(api, [0, 2]);
  const pairs = templatePairs(tasks, rootId, saved);
  const byId = new Map(tasks.map(t => [t.id, t]));
  let updated = 0;
  const conflicts: string[] = [];
  for (const [key, pair] of Object.entries(pairs)) {
    const pairTasks = await Promise.all(pair.ids.map(id => api.getTask(byId.get(id)!.projectId, id)));
    if (pairTasks.some(t => !t)) throw new Error('模板任务已变化，请重试');
    const values = pairTasks.map(t => shared(t, key === '白色行李袋'));
    let source = 0;
    if (!equal(values[0], values[1])) {
      const changed = values.map(v => !pair.baseline || !equal(v, pair.baseline));
      if (changed[0] !== changed[1]) source = changed[0] ? 0 : 1;
      else {
        const times = pairTasks.map(modified);
        if (!times.every(Number.isFinite) || times[0] === times[1]) {
          if (pair.baseline) { conflicts.push(key); continue; }
          source = 0; // bon approved travel as the initial fallback on 2026-11-01.
        } else source = times[0] > times[1] ? 0 : 1;
      }
      const target = 1 - source, task = pairTasks[target], value = values[source];
      const fresh = await api.getTask(task.projectId, task.id);
      const sourceFresh = await api.getTask(pairTasks[source].projectId, pairTasks[source].id);
      if (version(fresh) !== version(task) || version(sourceFresh) !== version(pairTasks[source])) throw new Error('模板在同步期间发生修改，请重试');
      await writeShared(api, task, value, key);
      updated++;
    }
    pair.baseline = values[source];
    saved.pairs[key] = pair;
    await kv.set(storageKey, saved);
  }
  if (conflicts.length) throw new Error(`模板内容有冲突且没有可比较的修改时间：${conflicts.join('、')}；需指定首次来源`);
  // Moving instances follow the resolved templates one way. They never feed
  // trip-specific text back into the reusable templates.
  let instanceUpdated = 0, instanceMatched = 0;
  saved.movingInstances ??= {};
  const movingRoots = tasks.filter(task => task.title.includes('搬家-'));
  for (const root of movingRoots) {
    const children = tasks.filter(t => t.parentId && byId.get(t.parentId)?.parentId === root.id);
    const links = saved.movingInstances[root.id] ?? {};
    const matches = Object.entries(pairs).map(([key, pair]) => {
      const remembered = children.find(t => t.id === links[key]);
      const candidates = remembered ? [remembered] : children.filter(t => key === '白色行李袋'
        ? normalize(t.title) === '📦' : normalize(t.title).includes(key));
      if (candidates.length > 1) throw new Error(`搬家实例 ${root.title}：${key} 有多个匹配`);
      return { key, pair, candidate: candidates[0] };
    });
    for (const { key, pair, candidate } of matches) {
      if (!candidate) continue; // A deliberately omitted category is not recreated.
      const sourceTask = byId.get(pair.ids[1])!;
      const [source, target] = await Promise.all([
        api.getTask(sourceTask.projectId, sourceTask.id), api.getTask(candidate.projectId, candidate.id),
      ]);
      if (!source || !target || target.parentId !== candidate.parentId) throw new Error('搬家实例在同步期间发生变化');
      const value = shared(source, key === '白色行李袋');
      if (!equal(value, pair.baseline)) throw new Error('搬家模板在同步期间发生变化，请重试');
      if (!equal(shared(target, key === '白色行李袋'), value)) {
        await writeShared(api, target, value, key);
        instanceUpdated++;
      }
      instanceMatched++;
      links[key] = target.id;
      saved.movingInstances[root.id] = links;
      await kv.set(storageKey, saved);
    }
  }
  const result = { matched: Object.keys(pairs).length, updated, movingInstances: movingRoots.length, instanceMatched, instanceUpdated };
  await kv.set('ticktick:template-sync-status:v1', { ...result, rootId, syncedAt: new Date().toISOString(),
    instanceTitles: movingRoots.map(root => root.title) });
  return result;
}
