export async function upstream(url: URL) {
  const result = await fetch(url, { signal: AbortSignal.timeout(12000), redirect: 'error' });
  if (!result.ok) throw new Error('天气服务暂不可用');
  return result.json();
}
