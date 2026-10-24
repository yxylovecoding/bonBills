import { randomUUID } from 'node:crypto';
export async function dispatchFullReplan() {
  const endpoint = process.env.CLOUD_SCHEDULER_URL?.trim();
  const secret = process.env.CLOUD_SCHEDULER_SECRET?.trim();
  if (!endpoint || !secret) throw new Error('云端调度尚未配置');
  const url = new URL('/dispatch', endpoint);
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.endsWith('.workers.dev'))
    throw new Error('云端调度地址无效');
  const response = await fetch(url, {
    method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'full', id: randomUUID() }),
    redirect: 'error', signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json().catch(() => null);
  if (response.status !== 202 || result?.ok !== true || !result.jobs?.[0]?.id)
    throw new Error(`云端调度触发失败（HTTP ${response.status}）`);
  return { jobId: result.jobs[0].id };
}
