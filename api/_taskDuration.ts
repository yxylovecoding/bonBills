import type { TickTickTask } from './_ticktickTrips.js';
import { annotatedMinutes } from '../src/utils/taskDuration.js';
export { annotatedMinutes, withoutDurationAnnotations } from '../src/utils/taskDuration.js';

export function describedMinutes(task: TickTickTask): number | null {
  return annotatedMinutes(task.content) ?? annotatedMinutes(task.desc);
}
