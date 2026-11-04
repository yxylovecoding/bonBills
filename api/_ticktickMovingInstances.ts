import { randomBytes } from 'node:crypto';
import { canonicalStageTitle, relativeStageDate, type TickTickApi, type TickTickTask } from './_ticktickTrips.js';

export interface MovingTreeState {
  name: string;
  taskIds: Record<string, string>;
  itemIds: Record<string, Record<string, string>>;
}
const container = (title: string) => title.match(/^[🎒🧳📦]+/u)?.[0] ?? '';
export const movingTaskTitle = (title: string) => title.replace(/^.*?搬家-.*? · /u, '');
const normalized = (title: string) => title.normalize('NFKC').replace(/[\s\uFE0E\uFE0F]/g, '');
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function movingInstanceRoots(tasks: TickTickTask[]) {
  const byId = new Map(tasks.map(task => [task.id, task]));
  return tasks.filter(task => task.title.includes('搬家-') && !task.title.includes(' · ')).filter(task => {
    const seen = new Set([task.id]);
    for (let parent = task.parentId; parent; parent = byId.get(parent)?.parentId) {
      if (seen.has(parent)) throw new Error('搬家子任务存在循环关联');
      seen.add(parent);
      if (byId.get(parent)?.title.includes('搬家-')) return false;
    }
    return true;
  });
}

function descendants(tasks: TickTickTask[], root: TickTickTask) {
  const ordered = [root], seen = new Set([root.id]);
  for (let i = 0; i < ordered.length; i++) for (const task of tasks.filter(task => task.parentId === ordered[i].id)) {
    if (seen.has(task.id)) throw new Error('搬家子任务存在循环关联');
    seen.add(task.id); ordered.push(task);
  }
  return ordered.slice(1);
}

/** Reconcile the complete moving template into an existing copy, keeping local progress. */
export async function syncMovingInstance(options: {
  api: TickTickApi; tasks: TickTickTask[]; templateRoot: TickTickTask; root: TickTickTask;
  state: MovingTreeState; legacyTaskIds?: Record<string, string>; departureDate?: string | null;
  persist: () => Promise<void>;
}) {
  const { api, tasks, templateRoot, root, state, persist } = options;
  const currentRoot = await api.getTask(root.projectId, root.id);
  if (!currentRoot || currentRoot.title !== root.title || currentRoot.projectId !== root.projectId) throw new Error('搬家实例标题或清单已变化');
  const sourceTasks = descendants(tasks, templateRoot), targets = descendants(tasks, root);
  const byId = new Map(targets.map(task => [task.id, task]));
  const matches = new Map<string, TickTickTask>(), used = new Set<string>();
  const stageById = new Map<string, TickTickTask>();
  state.taskIds[templateRoot.id] = root.id;
  // Resolve every existing match before writing, including stages whose container suffix differs.
  for (const source of sourceTasks) {
    const isStage = source.parentId === templateRoot.id;
    const stage = isStage ? source : stageById.get(source.parentId!);
    if (!stage) throw new Error('搬家模板层级无法确认');
    stageById.set(source.id, stage);
    if (options.departureDate) relativeStageDate(stage.title, options.departureDate);
    const knownId = state.taskIds[source.id] ?? options.legacyTaskIds?.[source.id];
    const known = knownId ? byId.get(knownId) : undefined;
    const key = (task: TickTickTask) => {
      const title = movingTaskTitle(task.title);
      return isStage ? canonicalStageTitle(title) : normalized(title.slice(container(title).length) || title);
    };
    let candidates = known ? [known] : targets.filter(task => !used.has(task.id) && key(task) === key(source));
    if (candidates.length > 1) {
      const parentId = source.parentId === templateRoot.id ? root.id : matches.get(source.parentId!)?.id;
      const siblings = candidates.filter(task => task.parentId === parentId);
      if (siblings.length === 1) candidates = siblings;
    }
    if (candidates.length > 1 || candidates[0] && used.has(candidates[0].id)) throw new Error(`搬家实例 ${root.title}：${source.title} 有多个匹配`);
    if (candidates[0]) { matches.set(source.id, candidates[0]); used.add(candidates[0].id); }
  }

  let created = 0, updated = 0;
  for (const snapshot of sourceTasks) {
    const source = await api.getTask(snapshot.projectId, snapshot.id);
    if (!source || source.parentId !== snapshot.parentId) throw new Error('搬家模板在同步期间发生变化');
    const match = matches.get(source.id);
    const target = match ? await api.getTask(match.projectId, match.id) : undefined;
    if (match && (!target || target.parentId !== match.parentId)) throw new Error('搬家实例在同步期间发生变化');
    const parentId = state.taskIds[source.parentId!];
    if (!parentId) throw new Error('搬家母任务尚未同步');
    const oldItems = state.itemIds[source.id] ?? {}, itemIds: Record<string, string> = {};
    const remaining = [...target?.items ?? []], previouslyMapped = new Set(Object.values(oldItems));
    const items = (source.items ?? []).map((item, index) => {
      const key = item.id ?? `title:${item.title}:${index}`;
      let found = remaining.findIndex(candidate => candidate.id && candidate.id === oldItems[key]);
      if (found < 0) found = remaining.findIndex(candidate => candidate.title === item.title);
      const existing = found < 0 ? undefined : remaining.splice(found, 1)[0];
      const id = existing?.id ?? randomBytes(12).toString('hex'); itemIds[key] = id;
      return { ...existing, id, title: item.title, status: existing?.status ?? 0, sortOrder: index };
    });
    // User-added checklist entries remain local; removed template entries do not reappear.
    for (const item of remaining) if (!item.id || !previouslyMapped.has(item.id)) items.push({ ...item, id: item.id ?? randomBytes(12).toString('hex'), status: item.status ?? 0, sortOrder: items.length });
    const sourcePrefix = container(source.title);
    const targetPrefix = target ? container(movingTaskTitle(target.title)) : sourcePrefix;
    const title = `${root.title} · ${targetPrefix}${source.title.slice(sourcePrefix.length)}`;
    const payload: Record<string, unknown> = { title, parentId, content: source.content ?? '', desc: source.desc ?? '',
      kind: source.kind ?? (items.length ? 'CHECKLIST' : 'TEXT'), items };
    let resolved: TickTickTask;
    if (target) {
      if (['title', 'parentId', 'content', 'desc', 'kind', 'items'].some(key => !same(target[key as keyof TickTickTask] ?? (key === 'items' ? [] : ''), payload[key]))) {
        const local = Object.fromEntries(['startDate', 'dueDate', 'isAllDay', 'timeZone', 'tags', 'reminders', 'repeatFlag', 'repeatFrom', 'priority', 'sortOrder']
          .filter(key => target[key as keyof TickTickTask] !== undefined).map(key => [key, target[key as keyof TickTickTask]]));
        await api.updateTask(target.id, { ...local, ...payload, id: target.id, projectId: target.projectId });
        resolved = await api.getTask(target.projectId, target.id); updated++;
      } else resolved = target;
    } else {
      const stage = stageById.get(source.id)!;
      const date = options.departureDate && relativeStageDate(stage.title, options.departureDate);
      const result = await api.createTask({ ...payload, projectId: root.projectId,
        // New tasks receive their own list position from TickTick; a template's
        // ordering number belongs to a different sibling list.
        tags: source.tags ?? [], priority: source.priority ?? 0,
        timeZone: 'Asia/Shanghai', isAllDay: true,
        ...(date ? { startDate: `${date}T00:00:00+0800`, dueDate: `${date}T00:00:00+0800` } : {}) });
      if (!result?.id) throw new Error('搬家子任务创建后未返回 ID');
      state.taskIds[source.id] = result.id;
      state.itemIds[source.id] = itemIds;
      await persist(); // Remember a successful create before a fallible read.
      resolved = await api.getTask(root.projectId, result.id); created++;
    }
    if (!resolved || resolved.title !== title || resolved.parentId !== parentId
      || (resolved.content ?? '') !== payload.content || (resolved.desc ?? '') !== payload.desc
      || !same((resolved.items ?? []).map(item => item.title), items.map(item => item.title))) throw new Error('搬家实例同步回读未确认');
    state.taskIds[source.id] = resolved.id; state.itemIds[source.id] = itemIds;
    const index = tasks.findIndex(task => task.id === resolved.id);
    if (index < 0) tasks.push(resolved); else tasks[index] = resolved;
    await persist();
  }
  // Local additions keep their contents and parent, but belong to the same named event.
  for (const snapshot of targets.filter(task => !used.has(task.id))) {
    const title = `${root.title} · ${movingTaskTitle(snapshot.title)}`;
    if (title === snapshot.title) continue;
    const task = await api.getTask(snapshot.projectId, snapshot.id);
    if (!task || task.title !== snapshot.title || task.parentId !== snapshot.parentId) throw new Error('搬家实例在同步期间发生变化');
    await api.updateTask(task.id, { id: task.id, projectId: task.projectId, title });
    const verified = await api.getTask(task.projectId, task.id);
    if (verified.title !== title) throw new Error('搬家实例标题回读未确认');
    tasks[tasks.findIndex(candidate => candidate.id === task.id)] = verified; updated++;
  }
  state.name = root.title;
  await persist();
  return { title: root.title, matched: sourceTasks.length, created, updated };
}
