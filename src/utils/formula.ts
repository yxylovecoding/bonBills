const WHITELIST = /^[0-9+\-*/().\s]+$/;
const HAS_OPERATOR = /[+\-*/()]/;

export function tryEvalFormula(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  if (!s) return null;
  if (s.startsWith('=')) s = s.slice(1).trim();
  if (!s) return null;
  if (!WHITELIST.test(s)) return null;
  if (!HAS_OPERATOR.test(s)) return null;
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(`"use strict"; return (${s});`);
    const result = fn();
    if (typeof result !== 'number' || !isFinite(result)) return null;
    return String(Math.round(result * 100) / 100);
  } catch {
    return null;
  }
}
