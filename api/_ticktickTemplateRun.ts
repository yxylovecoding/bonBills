import { createHash } from 'node:crypto';
import { kv } from './_accountKv.js';
import { acquireTickTickLock, releaseTickTickLock } from './_ticktickLock.js';
import { DAILY_PLAN_KEY, refreshDailyHistory, type DailyPlanState } from './_ticktickDailyPlan.js';
import { RuleTaskDraft } from './_ruleTaskDraft.js';
import { readSchedulingRules } from './_schedulingRules.js';
import { withRulePolicy } from './_rulePolicy.js';
import { syncTickTickTemplates } from './_ticktickTemplateSync.js';
import { TickTickOpenApiClient, decryptTickTickToken, readAllTickTickTasks, type TickTickConnection } from './_ticktickTrips.js';

/** Only moving-instance metadata; no task notes, checklist contents, or credentials. */
export async function inspectTickTickTemplateSync() {
  const connection = await kv.get<TickTickConnection>('ticktick:connection:v1');
  if (!connection) throw new Error('TickTick 未连接');
  const token = decryptTickTickToken(connection.encryptedToken, (process.env.SYNC_SECRET || '').trim());
  const connectionId = createHash('sha256').update(token).digest('hex');
  const api = new TickTickOpenApiClient(token, (process.env.TICKTICK_API_BASE_URL || '').trim() || undefined);
  const [tasks, state] = await Promise.all([readAllTickTickTasks(api, [0, 2]), kv.get<{
    movingTrees?: Record<string, { name: string; taskIds: Record<string, string> }>;
  }>(`ticktick:template-pairs:v1:${connectionId}:${connection.templateRootId}`)]);
  const trees = Object.entries(state?.movingTrees ?? {});
  const metadata = (task: unknown) => task && typeof task === 'object' ? Object.fromEntries(Object.entries(task)
    .filter(([key]) => ['id', 'projectId', 'parentId', 'title', 'status', 'completedTime'].includes(key) || /delet|trash/i.test(key))) : task;
  const instances = [];
  for (const [rootId, tree] of trees) {
    const root = tasks.find(task => task.id === rootId);
    if (!root) continue;
    const ids = [...new Set(Object.values(tree.taskIds))];
    if (ids.length > 200) throw new Error('搬家关联过多，暂停核验');
    const records = [];
    for (const id of ids) {
      let task: unknown;
      try { task = await api.getTask(root.projectId, id); }
      catch (error) { if (!(error instanceof Error) || !/\b404\b/.test(error.message)) throw error; }
      records.push({ id, active: tasks.some(task => task.id === id), record: metadata(task) ?? null });
    }
    instances.push({ title: root.title, records });
  }
  return { instances };
}

/** Authenticated template maintenance, using the same lock and draft as replanning. */
export async function runTickTickTemplateSync() {
  const lock = await acquireTickTickLock();
  if (!lock) return { busy: true };
  try {
    const connection = await kv.get<TickTickConnection>('ticktick:connection:v1');
    if (!connection) throw new Error('TickTick 未连接');
    const config = await readSchedulingRules();
    if (config.removed?.includes('template-content')) return { busy: false, skipped: 'disabled' };
    return await withRulePolicy(config, async () => {
      const token = decryptTickTickToken(connection.encryptedToken, (process.env.SYNC_SECRET || '').trim());
      const connectionId = createHash('sha256').update(token).digest('hex');
      const api = new TickTickOpenApiClient(token, (process.env.TICKTICK_API_BASE_URL || '').trim() || undefined);
      const [tasks, saved] = await Promise.all([readAllTickTickTasks(api, [0, 2]), kv.get<DailyPlanState>(DAILY_PLAN_KEY)]);
      const state: DailyPlanState = saved?.connectionId === connectionId ? structuredClone(saved) : { connectionId, history: [], deadlines: {} };
      // Failure must abort before any template content or copy can be written.
      await refreshDailyHistory(api, tasks, state);
      const draft = new RuleTaskDraft(api, tasks);
      let content: Awaited<ReturnType<typeof syncTickTickTemplates>> | undefined;
      for (const [id, mode] of [['template-content', 'content'], ['moving-date', 'dates']] as const) {
        if (config.removed?.includes(id)) continue;
        const branch = draft.branch(id);
        const result = await syncTickTickTemplates(branch.api, connection.templateRootId, connectionId, {
          mode, completedTasks: state.history, requireCompletionHistory: true,
          deferState: save => draft.saveAfterCommit(id, save), resolveIds: value => draft.resolveIds(value, true),
        });
        branch.accept();
        if (mode === 'content') content = result;
      }
      const updated = await draft.commit();
      await kv.set(DAILY_PLAN_KEY, state);
      return { busy: false, updated, instances: content?.instanceSync ?? [] };
    });
  } finally { await releaseTickTickLock(lock); }
}
