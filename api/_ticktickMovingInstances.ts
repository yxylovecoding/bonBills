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
export const movingTaskCompleted = (task: TickTickTask) => (task.status ?? 0) !== 0 || Boolean(task.completedTime);

export function movingTaskClosed(task: TickTickTask, tasks: TickTickTask[]) {
  const byId = new Map(tasks.map(task => [task.id, task])), seen = new Set<string>();
  for (let current: TickTickTask | undefined = task; current; current = current.parentId ? byId.get(current.parentId) : undefined) {
    if (seen.has(current.id)) throw new Error('搬家子任务存在循环关联');
    seen.add(current.id);
    if (movingTaskCompleted(current)) return true;
  }
  return false;
}

async function readLinked(api: TickTickApi, projectId: string, id: string) {
  try { return await api.getTask(projectId, id); }
  catch (error) {
    if (error instanceof Error && /\b404\b/.test(error.message)) return undefined;
    throw error;
  }
}

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
  completedTasks?: TickTickTask[];
  persist: () => Promise<void>;
}) {
  const { api, tasks, templateRoot, root, state, persist } = options;
  const currentRoot = await api.getTask(root.projectId, root.id);
  if (!currentRoot || currentRoot.title !== root.title || currentRoot.projectId !== root.projectId) throw new Error('搬家实例标题或清单已变化');
  if (movingTaskCompleted(currentRoot)) return { title: root.title, matched: 0, created: 0, updated: 0, completed: 1, removed: 0, retainedDuplicates: [] as string[] };
  const sourceTasks = descendants(tasks, templateRoot), targets = descendants(tasks, root);
  const byId = new Map(targets.map(task => [task.id, task]));
  const matches = new Map<string, TickTickTask>(), used = new Set<string>();
  const stageById = new Map<string, TickTickTask>();
  const blocked = new Set<string>(), blockedTargets = new Set<string>();
  const originalTaskIds = { ...options.legacyTaskIds, ...state.taskIds };
  const duplicateRoots: TickTickTask[] = [];
  const history = options.completedTasks ?? [];
  let completed = 0, removed = 0;
  const retainedDuplicates: string[] = [];
  state.taskIds[templateRoot.id] = root.id;
  // Resolve every existing match before writing, including stages whose container suffix differs.
  for (const source of sourceTasks) {
    if (blocked.has(source.parentId!)) { blocked.add(source.id); continue; }
    const isStage = source.parentId === templateRoot.id;
    const stage = isStage ? source : stageById.get(source.parentId!);
    if (!stage) throw new Error('搬家模板层级无法确认');
    stageById.set(source.id, stage);
    if (options.departureDate) relativeStageDate(stage.title, options.departureDate);
    const knownId = state.taskIds[source.id] ?? options.legacyTaskIds?.[source.id];
    const known = knownId ? byId.get(knownId) ?? await readLinked(api, root.projectId, knownId) : undefined;
    const key = (task: TickTickTask) => {
      const title = movingTaskTitle(task.title);
      return isStage ? canonicalStageTitle(title) : normalized(title.slice(container(title).length) || title);
    };
    const parentId = source.parentId === templateRoot.id ? root.id : matches.get(source.parentId!)?.id;
    // History retains the original completion even if an older synchronizer has
    // already replaced the mapping with a newly generated pending copy.
    const previous = history.filter(task => task.projectId === root.projectId
      && (task.parentId === parentId || !task.parentId && task.title.startsWith(`${root.title} · `))
      && movingTaskCompleted(task) && key(task) === key(source) && task.id !== known?.id)
      .sort((a, b) => (a.completedTime ?? '').localeCompare(b.completedTime ?? ''));
    let finished = known && movingTaskCompleted(known) ? known : undefined;
    if (!finished) for (const record of previous) {
      const fresh = await readLinked(api, record.projectId, record.id);
      if (fresh ? !movingTaskCompleted(fresh) || fresh.parentId !== parentId : record.parentId !== parentId) continue;
      finished = fresh ?? record; break;
    }
    if (finished) {
      state.taskIds[source.id] = finished.id;
      matches.set(source.id, finished); used.add(finished.id); blocked.add(source.id); completed++;
      blockedTargets.add(finished.id);
      for (const child of descendants(tasks, finished)) blockedTargets.add(child.id);
      if (known && known.id !== finished.id && !movingTaskCompleted(known)) {
        if (known.parentId === parentId) duplicateRoots.push(known);
        else retainedDuplicates.push(known.title);
      }
      continue;
    }
    // A remembered ID disappearing from an active list is never evidence that
    // the user wants another occurrence. Keep its association, including on 404.
    if (knownId && !known) { blocked.add(source.id); continue; }
    if (known && !byId.has(known.id)) throw new Error('搬家关联任务未在快照中，暂不修改或补建');
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
  // Retire only mapped, untouched copies of an already completed occurrence.
  // Manual additions or edits keep the whole branch for review.
  const sourceByTarget = new Map(Object.entries(originalTaskIds).map(([sourceId, targetId]) => [targetId, sourceTasks.find(task => task.id === sourceId)]));
  const removable = (task: TickTickTask) => {
    const source = sourceByTarget.get(task.id);
    const tags = (values: string[] = []) => values.filter(tag => !['hidden', 'bon-hidden'].includes(tag)).sort();
    return source && !movingTaskCompleted(task) && !task.repeatFlag
      && task.title === `${root.title} · ${container(movingTaskTitle(task.title))}${source.title.slice(container(source.title).length)}`
      && (task.content ?? '') === (source.content ?? '') && (task.desc ?? '') === (source.desc ?? '')
      && same(tags(task.tags), tags(source.tags))
      && same((task.items ?? []).map(item => item.title), (source.items ?? []).map(item => item.title))
      && (task.items ?? []).every(item => (item.status ?? 0) === 0 && !item.completedTime);
  };
  for (const duplicate of duplicateRoots) {
    const branch = [duplicate, ...descendants(tasks, duplicate)];
    branch.forEach(task => { used.add(task.id); blockedTargets.add(task.id); });
    const fresh = await Promise.all(branch.map(task => api.getTask(task.projectId, task.id)));
    if (fresh.some((task, index) => !task || task.parentId !== branch[index].parentId || !removable(task))) {
      retainedDuplicates.push(duplicate.title); continue;
    }
    for (const task of [...fresh].reverse()) {
      await api.deleteTask(task.projectId, task.id);
      if (await readLinked(api, task.projectId, task.id)) throw new Error('搬家重复项删除回读未确认');
      const index = tasks.findIndex(candidate => candidate.id === task.id);
      if (index >= 0) tasks.splice(index, 1);
      removed++;
    }
  }
  for (const snapshot of sourceTasks) {
    if (blocked.has(snapshot.id) || blocked.has(snapshot.parentId!)) { blocked.add(snapshot.id); continue; }
    const source = await api.getTask(snapshot.projectId, snapshot.id);
    if (!source || source.parentId !== snapshot.parentId) throw new Error('搬家模板在同步期间发生变化');
    const match = matches.get(source.id);
    const target = match ? await api.getTask(match.projectId, match.id) : undefined;
    if (match && (!target || target.parentId !== match.parentId)) throw new Error('搬家实例在同步期间发生变化');
    if (target && movingTaskCompleted(target)) { blocked.add(source.id); state.taskIds[source.id] = target.id; completed++; continue; }
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
    if (blockedTargets.has(snapshot.id) || movingTaskClosed(snapshot, tasks)) continue;
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
  return { title: root.title, matched: sourceTasks.length, created, updated, completed, removed, retainedDuplicates };
}
