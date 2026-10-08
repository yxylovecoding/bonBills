const DEFAULT_OWNER = 'yxylovecoding';
const DEFAULT_REPO = 'monthlyBills';
const DEFAULT_WORKFLOW = 'ticktick-daily-plan.yml';
const DEFAULT_REF = 'main';

export async function dispatchFullReplan() {
  const token = (process.env.GITHUB_ACTIONS_TOKEN || '').trim();
  if (!token) throw new Error('GitHub Actions Token 未配置');

  const owner = (process.env.GITHUB_ACTIONS_OWNER || '').trim() || DEFAULT_OWNER;
  const repo = (process.env.GITHUB_ACTIONS_REPO || '').trim() || DEFAULT_REPO;
  const workflow = (process.env.GITHUB_ACTIONS_WORKFLOW || '').trim() || DEFAULT_WORKFLOW;
  const ref = (process.env.GITHUB_ACTIONS_REF || '').trim() || DEFAULT_REF;
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ ref, inputs: { periods_only: false, send_email: false } }),
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status !== 204) {
    throw new Error(response.status === 401 || response.status === 403
      ? 'GitHub Actions Token 无效或缺少 Actions 写权限'
      : response.status === 404
        ? 'GitHub Actions 工作流不存在或 Token 无仓库访问权限'
        : `GitHub Actions 触发失败（HTTP ${response.status}）`);
  }
  return { workflow, ref };
}
