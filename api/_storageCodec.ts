// Preserve the Redis SDK's wire format, including raw strings and JSON null.
export function encodeStorage(value: unknown): string {
  const encoded = typeof value === 'string' ? value : JSON.stringify(value);
  if (encoded === undefined) throw new Error('Cannot store undefined');
  return encoded;
}

export function decodeStorage<T = unknown>(value: unknown): T {
  if (Array.isArray(value)) return value.map(item => decodeStorage(item)) as T;
  if (typeof value !== 'string') return value as T;
  try {
    const parsed = JSON.parse(value);
    // Do not round large integer identifiers, matching @upstash/redis.
    return (typeof parsed === 'number' && String(parsed) !== value ? value : parsed) as T;
  } catch { return value as T; }
}
