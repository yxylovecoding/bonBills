export interface DailyBriefing {
  date: string;
  generatedAt: string;
  planGeneratedAt?: string;
  ready: boolean;
  warnings: string[];
  summary?: { availableMinutes: number; importantCount: number };
  today: { title: string; minutes: number; reasons: string[] }[];
  training: { date: string; phase: string; plan: string; minutes: number; reasons: string[] }[];
}
