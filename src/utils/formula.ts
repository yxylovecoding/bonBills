const WHITELIST = /^[0-9+\-*/().\s]+$/;

export function tryEvalFormula(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s.startsWith('=')) return null;
  const expr = s.slice(1).trim();
  if (!expr) return null;
  if (!WHITELIST.test(expr)) return null;
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(`"use strict"; return (${expr});`);
    const result = fn();
    if (typeof result !== 'number' || !isFinite(result)) return null;
    return String(Math.round(result * 100) / 100);
  } catch {
    return null;
  }
}
