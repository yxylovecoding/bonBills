// Persist only a cache generation, never response data. Other tabs on the same
// origin pick up invalidations on their next request, including after a reload.
const versions = new Map<string, string>();
const unpersisted = new Set<string>();
const storageKey = (account: string) => `bonbills-http-cache:v1:${account}`;

export function requestCacheVersion(account: string) {
  if (unpersisted.has(account)) return versions.get(account)!;
  try { return localStorage.getItem(storageKey(account)) ?? versions.get(account) ?? '0'; }
  catch { return versions.get(account) ?? '0'; }
}

export function invalidateRequestCache(account: string) {
  const version = crypto.randomUUID();
  versions.set(account, version);
  try { localStorage.setItem(storageKey(account), version); unpersisted.delete(account); }
  catch { unpersisted.add(account); }
}
