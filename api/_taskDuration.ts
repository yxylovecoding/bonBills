import type { TickTickTask } from './_ticktickTrips.js';

// NFKC also accepts Chinese parentheses and full-width digits/letters. Match
// the entire annotation, so '(1h1m)' cannot accidentally become one minute.
export function annotatedMinutes(text: string | undefined): number | null {
  if (!text) return null;
  const pattern = /\(\s*(?:(\d{1,4}(?:\.\d+)?)\s*h\s*)?(?:(\d{1,4}(?:\.\d+)?)\s*m\s*)?\)/gi;
  for (const match of text.normalize('NFKC').matchAll(pattern)) {
    if (match[1] === undefined && match[2] === undefined) continue;
    const minutes = Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0);
    if (minutes > 0) return Math.ceil(minutes);
  }
  return null;
}

export function describedMinutes(task: TickTickTask): number | null {
  return annotatedMinutes(task.content) ?? annotatedMinutes(task.desc);
}

export function withoutDurationAnnotations(text: string): string {
  return text.normalize('NFKC').replace(/\(\s*(?:\d{1,4}(?:\.\d+)?\s*h\s*)?(?:\d{1,4}(?:\.\d+)?\s*m\s*)?\)/gi, '').trim();
}
