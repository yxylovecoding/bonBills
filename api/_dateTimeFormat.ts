// ICU formatter construction is expensive inside calendar/history loops. Reuse
// only format configuration, never account data or a date-specific UTC offset.
const formatters = new Map<string, Intl.DateTimeFormat>();
const maxFormatters = 32;

export function dateTimeFormatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify([locale, options]);
  const cached = formatters.get(key);
  if (cached) return cached;
  // Invalid zones still throw and are never cached.
  const formatter = new Intl.DateTimeFormat(locale, options);
  if (formatters.size >= maxFormatters) formatters.delete(formatters.keys().next().value!);
  formatters.set(key, formatter);
  return formatter;
}
