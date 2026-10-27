// UTC cron times; Shanghai is UTC+8 throughout the year.
export const CRONS = ['1 0-16,21-23 * * *', '0 4,9,12,14,16 * * *'];
export const day = time => new Date(time + 8 * 3600_000).toISOString().slice(0, 10);
export function scheduledJobs(time) {
  const date = new Date(time), minute = date.getUTCMinutes(), hour = date.getUTCHours();
  const slot = Math.floor(time / 60_000), jobs = [];
  const add = (kind, steps) => jobs.push({ id: `${kind}-${slot}`, kind, scheduledAt: time, steps });
  if (minute === 1 && hour === 21) add('full', ['routine-visibility', 'life-periods', 'full', 'daily-email']);
  else if (minute === 1 && (hour <= 16 || hour >= 22)) add('hourly', [...(hour === 23 ? ['reading-visibility'] : []), 'hourly-replan']);
  if (minute !== 0) return jobs;
  if (hour === 14) add('night', ['night-routine']);
  if (hour === 16) add('midnight', ['daily-routine']);
  if ([4, 9, 12].includes(hour)) add('full', [
    ...(hour === 12 ? ['hair-wash'] : []), 'life-periods', 'full',
  ]);
  return jobs;
}
export function manualJob(kind, id, time) {
  const steps = kind === 'full' ? ['life-periods', 'full']
    : kind === 'hourly' ? ['hourly-replan'] : null;
  if (!steps) throw new Error('Invalid job kind');
  return { id: `manual-${id}`, kind, scheduledAt: time, steps };
}
