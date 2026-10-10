// Shared with scheduling so full-width annotations and mixed hours/minutes agree.
export function annotatedMinutes(text: string | undefined, roundUp = true): number | null {
  if (!text) return null;
  const pattern = /\(\s*(?:(\d{1,4}(?:\.\d+)?)\s*h\s*)?(?:(\d{1,4}(?:\.\d+)?)\s*m\s*)?\)/gi;
  for (const match of text.normalize('NFKC').matchAll(pattern)) {
    if (match[1] === undefined && match[2] === undefined) continue;
    const minutes = Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0);
    if (minutes > 0) return roundUp ? Math.ceil(minutes) : minutes;
  }
  return null;
}

export function withoutDurationAnnotations(text: string): string {
  return text.normalize('NFKC').replace(/\(\s*(?:\d{1,4}(?:\.\d+)?\s*h\s*)?(?:\d{1,4}(?:\.\d+)?\s*m\s*)?\)/gi, '').trim();
}

export function markedTaskMinutes(task: { title: string; content?: string; desc?: string; tags?: string[] }): number | null {
  const text = `${task.title} ${(task.tags ?? []).join(' ')}`.normalize('NFKC');
  return annotatedMinutes(task.content, false) ?? annotatedMinutes(task.desc, false) ?? annotatedMinutes(text, false)
    ?? (() => {
      const match = text.replace(/\([^)]*\)/g, '').match(/(?:^|[^\d.+-])([1-9]\d{0,3}(?:\.\d+)?)\s*(小时|hours?|hrs?|h|分钟|minutes?|mins?|m)(?![a-z0-9])/i);
      return match ? Number(match[1]) * (/^(?:小时|h)/i.test(match[2]) ? 60 : 1) : null;
    })();
}
