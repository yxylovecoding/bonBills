// The user pauses all automatic work from 00:30 through 05:00 Shanghai time.
export function automaticRestWindow(now: Date = new Date()): boolean {
  const local = new Date(now.getTime() + 8 * 3600_000);
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  return minutes >= 30 && minutes < 5 * 60 + 1;
}
