export interface TickTickPlanTask {
  id: string;
  projectId: string;
  title: string;
  minutes: number;
  durationBasis?: string;
  reasons: string[];
}

export interface TickTickPlanDetails {
  date: string;
  generatedAt: string;
  selected: TickTickPlanTask[];
  // Older saved plans contain the selected tasks but no capacity snapshot.
  breakdown?: {
    clockRemainingMinutes: number;
    remainingWindows: { start: string; end: string }[];
    windowMinutes: number;
    occupiedMinutes: number;
    freeMinutes: number;
    important: { id: string; projectId: string; title: string; minutes: number; additionalMinutes: number; durationBasis: string }[];
    importantAdditionalMinutes: number;
    fixedAdditionalMinutes: number;
    afterReservationsMinutes: number;
    bufferMinutes: number;
    allocationRatio: number;
    afterBufferMinutes: number;
    dailyLimitMinutes: number | null;
    completedTodayMinutes: number;
    dailyLimitReductionMinutes: number;
    newTaskCapacityMinutes: number;
    cycleTargetMinutes: number;
  };
}
