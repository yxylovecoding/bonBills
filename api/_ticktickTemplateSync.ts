import { kv } from './_accountKv.js';
import { randomBytes } from 'node:crypto';
import { readAllTickTickTasks, relativeStageDate, updateRoutineTaskDate, calendarDateInTimeZone, type TickTickTask, type TickTickApi } from './_ticktickTrips.js';

type Shared = { title: string; content: string; desc: string; kind: string; items: string[] };
type Pair = { ids: [string, string]; baseline?: Shared };
type State = { departureDates?: Record<string, { suffix: string; date: string }>; pairs: Record<string, Pair>; movingInstances?: Record<string, Record<string, string>> };
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

export function movingDepartureDate(title: string, today: string): string | null {
  const match = /搬家-.+-(?:(\d{4})[.-])?(\d{1,2})[.](\d{1,2})$/.exec(title.trim());
  if (!match || !match[3]) return null;
  const date = `${match[1] || today.slice(0, 4)}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  if (!Number.isFinite(Date.parse(date)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)
    throw new Error(`搬家标题日期无效：${title}`);
  return date;
}

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

async function writeShared(api: TickTickApi, task: TickTickTask, value: Shared, key: string) {
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
export async function syncTickTickTemplates(api: TickTickApi, rootId: string, connectionId: string,
  options: { mode?: 'content' | 'dates'; deferState?: (save: () => Promise<unknown>) => void } = {}) {
  const save = async (key: string, value: unknown) => {
    const snapshot = structuredClone(value);
    if (options.deferState) options.deferState(async () => {
      if (key === storageKey) {
        const latest = await kv.get<State>(key), next = snapshot as State;
        return kv.set(key, options.mode === 'dates' ? { ...latest, pairs: latest?.pairs ?? {}, departureDates: next.departureDates }
          : { ...next, departureDates: latest?.departureDates ?? next.departureDates });
      }
      const latest = await kv.get<Record<string, unknown>>(key), next = snapshot as Record<string, unknown>;
      return kv.set(key, options.mode === 'dates' ? { ...latest, rootId, syncedAt: next.syncedAt, dateUpdated: next.dateUpdated, managedTaskIds: next.managedTaskIds, schedules: next.schedules }
        : { ...latest, ...next, dateUpdated: latest?.dateUpdated ?? 0, managedTaskIds: latest?.managedTaskIds ?? [], schedules: latest?.schedules ?? [] });
    });
    else await kv.set(key, snapshot);
  };
  const storageKey = `ticktick:template-pairs:v1:${connectionId}:${rootId}`;
  const saved = await kv.get<State>(storageKey) ?? { pairs: {} };
  const tasks = await readAllTickTickTasks(api, [0, 2]);
  const pairs = options.mode === 'dates' ? {} : templatePairs(tasks, rootId, saved);
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
    await save(storageKey, saved);
  }
  if (conflicts.length) throw new Error(`模板内容有冲突且没有可比较的修改时间：${conflicts.join('、')}；需指定首次来源`);
  // Moving instances follow the resolved templates one way. They never feed
  // trip-specific text back into the reusable templates.
  let instanceUpdated = 0, instanceMatched = 0, dateUpdated = 0;
  const managedTaskIds: string[] = [];
  const schedules: { title: string; departureDate: string; stages: { title: string; date: string; tasks: number }[] }[] = [];
  saved.departureDates ??= {};
  saved.movingInstances ??= {};
  const movingRoots = tasks.filter(task => task.title.includes('搬家-'));
  for (const root of options.mode === 'dates' ? [] : movingRoots) {
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
      await save(storageKey, saved);
    }
  }
  // Apply dates after text synchronization, using fresh tasks to retain new content.
  for (const root of options.mode === 'content' ? [] : movingRoots) {
    const today = calendarDateInTimeZone(new Date().toISOString())!;
    const parsed = movingDepartureDate(root.title, today);
    if (!parsed) continue;
    const suffix = root.title.trim().split('-').at(-1)!;
    const previous = saved.departureDates[root.id];
    const departureDate = previous?.suffix === suffix ? previous.date : parsed;
    const stages = tasks.filter(t => t.parentId === root.id);
    const planned = stages.map(stage => {
      const date = relativeStageDate(stage.title, departureDate);
      const descendants = [stage];
      const visited = new Set([stage.id]);
      for (let i = 0; i < descendants.length; i++) {
        for (const child of tasks.filter(t => t.parentId === descendants[i].id)) {
          if (visited.has(child.id)) throw new Error('搬家子任务存在循环关联');
          visited.add(child.id); descendants.push(child);
        }
      }
      return { stage, date, descendants };
    });
    const freshRoot = await api.getTask(root.projectId, root.id);
    if (!freshRoot || freshRoot.title !== root.title) throw new Error('搬家标题日期已变化，请重试');
    saved.departureDates[root.id] = { suffix, date: departureDate };
    await save(storageKey, saved);
    managedTaskIds.push(root.id);
    for (const { date, descendants } of planned) for (const task of descendants) {
      const fresh = await api.getTask(task.projectId, task.id);
      if (!fresh || fresh.parentId !== task.parentId) throw new Error('搬家子任务层级已变化，请重试');
      if (await updateRoutineTaskDate(api, fresh, date, true, true)) dateUpdated++;
      managedTaskIds.push(task.id);
    }
    schedules.push({ title: root.title, departureDate, stages: planned.map(p => ({ title: p.stage.title, date: p.date, tasks: p.descendants.length })) });
  }
  const result = { matched: Object.keys(pairs).length, updated, movingInstances: movingRoots.length, instanceMatched, instanceUpdated, dateUpdated, managedTaskIds, schedules };
  await save('ticktick:template-sync-status:v1', { ...result, rootId, syncedAt: new Date().toISOString(),
    instanceTitles: movingRoots.map(root => root.title) });
  return result;
}
