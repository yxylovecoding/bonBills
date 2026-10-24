// A scheduler only needs completion flags. Do not transfer plans, calendar URLs or errors.
export function schedulerResponse(body: Record<string, any>) {
  const safe: Record<string, unknown> = {};
  for (const key of ['ok', 'busy', 'deferred', 'connected', 'sent', 'duplicate'])
    if (typeof body?.[key] === 'boolean') safe[key] = body[key];
  if (body?.error) safe.error = true;
  if (['rest-window', 'sleep-window', 'restore-pending', 'disconnected'].includes(body?.skipped)) safe.skipped = body.skipped;
  if (typeof body?.syncedAt === 'string') safe.syncedAt = body.syncedAt;
  for (const key of ['dailyPlan', 'nightRoutine', 'exercise', 'hairWash', 'reading'])
    if (body?.[key]) safe[key] = {};
  if (body?.sleepTags) safe.sleepTags = { complete: body.sleepTags.complete === true };
  for (const key of ['laundry', 'charging']) if (body?.[key]?.outlook?.error) safe[key] = { outlook: { error: true } };
  const stages = ['completion-archive', 'outlook-refresh', 'tasks-read', 'completion-history', 'template-read', 'timed-visibility', 'planning', 'finalize'];
  if (body?.failure) safe.failure = { stage: stages.includes(body.failure.stage) ? body.failure.stage : 'unknown', retryable: body.failure.retryable === true };
  return safe;
}
