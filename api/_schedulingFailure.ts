export type SchedulingStage = 'completion-archive' | 'outlook-refresh' | 'tasks-read'
  | 'completion-history' | 'template-read' | 'planning' | 'finalize';

class SchedulingError extends Error {
  constructor(message: string, readonly stage: SchedulingStage, readonly retryable: boolean) {
    super(message);
  }
}

// Only reads or replay-safe archive updates may opt into a full-sync retry.
// A failed task creation can have succeeded upstream without returning its ID.
export async function schedulingStage<T>(stage: SchedulingStage, retryable: boolean, work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error) {
    if (error instanceof SchedulingError) throw error;
    throw new SchedulingError(error instanceof Error ? error.message : String(error), stage, retryable);
  }
}

export function schedulingFailure(error: unknown) {
  return error instanceof SchedulingError
    ? { stage: error.stage, retryable: error.retryable }
    : { stage: 'unknown', retryable: false };
}
