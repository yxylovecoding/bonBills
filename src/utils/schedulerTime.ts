// The user pauses all automatic work from 00:30 through 06:29 Shanghai time.
export function automaticRestWindow(now: Date = new Date()): boolean {
  const local = new Date(now.getTime() + 8 * 3600_000);
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  return minutes >= 30 && minutes < 390;
}
