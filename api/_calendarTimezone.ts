// Convert a floating wall time using IANA rules, including historical DST offsets.
export function wallTimeInstant(wall: string, timezone: string): string {
  const naive = Date.parse(`${wall}Z`);
  const format = new Intl.DateTimeFormat('sv-SE', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  let instant = naive;
  for (let i = 0; i < 4; i++) {
    const parts = Object.fromEntries(format.formatToParts(new Date(instant)).map((p) => [p.type, p.value]));
    const viewed = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
    const correction = naive - viewed;
    if (!correction) return new Date(instant).toISOString();
    instant += correction;
  }
  throw new Error('日程时区无效');
}
