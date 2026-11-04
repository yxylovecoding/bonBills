import { createHash } from 'node:crypto';
import { kv } from './_accountKv.js';
import { acquireTickTickLock, releaseTickTickLock } from './_ticktickLock.js';
import { DAILY_PLAN_KEY, refreshDailyHistory, type DailyPlanState } from './_ticktickDailyPlan.js';
import { RuleTaskDraft } from './_ruleTaskDraft.js';
import { readSchedulingRules } from './_schedulingRules.js';
import { withRulePolicy } from './_rulePolicy.js';
import { syncTickTickTemplates } from './_ticktickTemplateSync.js';
import { TickTickOpenApiClient, decryptTickTickToken, readAllTickTickTasks, type TickTickConnection } from './_ticktickTrips.js';

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
