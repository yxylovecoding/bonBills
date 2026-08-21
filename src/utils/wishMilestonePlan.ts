import type { IncomeItem, TagKind, WishItem } from '../models/types';
import type { HolidayDataByYear } from './holidays';
import { calculateWishInternPlan, type WishInternPlan } from './wishInternPlan';

export interface WishRepaymentDue {
  date: string;
  yearMonth: string;
  amount: number;
}

export interface WishMilestoneSegment {
  deadline: string;
  intervalStartDate: string;
  wishIds: string[];
  wishNames: string[];
  availableInternDateKeys: string[];
  minimumInternDateKeys: string[];
  assignedInternDateKeys: string[];
  cumulativePlan: WishInternPlan;
}

export interface WishMilestoneAssignment {
  deadline: string;
  wishIds: string[];
  wishNames: string[];
  dateKeys: string[];
}

export interface WishMilestonePlan {
  segments: WishMilestoneSegment[];
  recommendedDates: string[];
  assignments: WishMilestoneAssignment[];
  segmentByWishId: Record<string, WishMilestoneSegment>;
}

export interface WishMilestonePlanOptions {
  today: Date;
  wishes: WishItem[];
  incomeItems: IncomeItem[];
  tagMap: Record<string, TagKind>;
  stateDailyAvg: Record<TagKind, number>;
  repaymentDues: WishRepaymentDue[];
  holidayDataByYear: HolidayDataByYear;
  tripDatesByStart?: Record<string, string[]>;
}

function formatDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function repaymentsThroughDeadline(
  repaymentDues: WishRepaymentDue[],
  startDate: string,
  deadline: string,
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const due of repaymentDues) {
    if (due.date < startDate || due.date > deadline || !Number.isFinite(due.amount)) continue;
    result[due.yearMonth] = (result[due.yearMonth] ?? 0) + Math.max(due.amount, 0);
  }
  return result;
}

export function calculateWishMilestonePlan(options: WishMilestonePlanOptions): WishMilestonePlan {
  const todayKey = formatDateKey(options.today);
  const wishesByDeadline = new Map<string, WishItem[]>();

  for (const wish of options.wishes) {
    const target = Number.isFinite(wish.targetAmount) ? Math.max(wish.targetAmount, 0) : 0;
    const saved = Number.isFinite(wish.savedAmount) ? Math.max(wish.savedAmount, 0) : 0;
    if (!wish.isActive || !wish.deadline || wish.deadline < todayKey || target <= saved) continue;
    const group = wishesByDeadline.get(wish.deadline) ?? [];
    group.push(wish);
    wishesByDeadline.set(wish.deadline, group);
  }

  const deadlines = [...wishesByDeadline.keys()].sort();
  const cumulativePlans = deadlines.map((deadline) => calculateWishInternPlan({
    today: options.today,
    deadline,
    wishes: options.wishes,
    incomeItems: options.incomeItems,
    tagMap: options.tagMap,
    stateDailyAvg: options.stateDailyAvg,
    repaymentsByMonth: repaymentsThroughDeadline(options.repaymentDues, todayKey, deadline),
    holidayDataByYear: options.holidayDataByYear,
    tripDatesByStart: options.tripDatesByStart,
  }));

  const segments: WishMilestoneSegment[] = [];
  const assignments: WishMilestoneAssignment[] = [];
  const assignedDateSet = new Set<string>();
  for (let index = 0; index < deadlines.length; index += 1) {
    const deadline = deadlines[index];
    const cumulativePlan = cumulativePlans[index];
    const wishes = wishesByDeadline.get(deadline) ?? [];
    const requiredCumulativeDays = cumulativePlan.recommendedDates.length;
    const additionalRequiredDays = Math.max(requiredCumulativeDays - assignedDateSet.size, 0);
    const assignedInternDateKeys: string[] = [];
    const candidates = [
      ...cumulativePlan.recommendedDates,
      ...cumulativePlan.availableInternDateKeys,
    ];
    for (const date of candidates) {
      if (assignedInternDateKeys.length >= additionalRequiredDays) break;
      if (assignedDateSet.has(date)) continue;
      assignedDateSet.add(date);
      assignedInternDateKeys.push(date);
    }
    assignedInternDateKeys.sort();
    const cumulativeRecommendedDates = [...assignedDateSet].sort();
    const wishIds = wishes.map((wish) => wish.id);
    const wishNames = wishes.map((wish) => wish.name.trim()).filter(Boolean);
    const segment: WishMilestoneSegment = {
      deadline,
      intervalStartDate: todayKey,
      wishIds,
      wishNames,
      availableInternDateKeys: cumulativePlan.availableInternDateKeys,
      minimumInternDateKeys: cumulativeRecommendedDates,
      assignedInternDateKeys,
      cumulativePlan,
    };
    segments.push(segment);
    assignments.push({ deadline, wishIds, wishNames, dateKeys: assignedInternDateKeys });
  }

  const recommendedDates = [...assignedDateSet].sort();

  const segmentByWishId: Record<string, WishMilestoneSegment> = {};
  for (const segment of segments) {
    for (const wishId of segment.wishIds) segmentByWishId[wishId] = segment;
  }

  return { segments, recommendedDates, assignments, segmentByWishId };
}
