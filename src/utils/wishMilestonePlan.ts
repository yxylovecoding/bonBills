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

interface InternMonthBucket {
  yearMonth: string;
  capacity: number;
  preferredDates: string[];
  fallbackDates: string[];
}

function monthIndex(yearMonth: string): number {
  const [year, month] = yearMonth.split('-').map(Number);
  return year * 12 + month - 1;
}

function assignBalancedInternDates(
  cumulativePlan: WishInternPlan,
  assignedDateSet: Set<string>,
  requestedDays: number,
): string[] {
  if (requestedDays <= 0) return [];
  const preferredDateSet = new Set(cumulativePlan.recommendedDates);
  const bucketByMonth = new Map<string, InternMonthBucket>();
  for (const date of cumulativePlan.availableInternDateKeys) {
    const yearMonth = date.slice(0, 7);
    const bucket = bucketByMonth.get(yearMonth) ?? {
      yearMonth,
      capacity: 0,
      preferredDates: [],
      fallbackDates: [],
    };
    bucket.capacity += 1;
    if (!assignedDateSet.has(date)) {
      if (preferredDateSet.has(date)) bucket.preferredDates.push(date);
      else bucket.fallbackDates.push(date);
    }
    bucketByMonth.set(yearMonth, bucket);
  }

  const buckets = [...bucketByMonth.values()].sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
  const assignedCountByMonth = new Map<string, number>();
  for (const date of assignedDateSet) {
    const yearMonth = date.slice(0, 7);
    if (!bucketByMonth.has(yearMonth)) continue;
    assignedCountByMonth.set(yearMonth, (assignedCountByMonth.get(yearMonth) ?? 0) + 1);
  }

  const result: string[] = [];
  while (result.length < requestedDays) {
    const occupiedMonthIndexes = buckets
      .filter((bucket) => (assignedCountByMonth.get(bucket.yearMonth) ?? 0) > 0)
      .map((bucket) => monthIndex(bucket.yearMonth));
    let bestBucket: InternMonthBucket | null = null;
    let bestProjectedPressure = Number.POSITIVE_INFINITY;
    let bestDistance = Number.NEGATIVE_INFINITY;
    for (const bucket of buckets) {
      if (bucket.preferredDates.length === 0 && bucket.fallbackDates.length === 0) continue;
      const assignedCount = assignedCountByMonth.get(bucket.yearMonth) ?? 0;
      const projectedPressure = (assignedCount + 1) / bucket.capacity;
      const index = monthIndex(bucket.yearMonth);
      const distance = occupiedMonthIndexes.length === 0
        ? Number.POSITIVE_INFINITY
        : Math.min(...occupiedMonthIndexes.map((occupiedIndex) => Math.abs(index - occupiedIndex)));
      const hasLowerPressure = projectedPressure < bestProjectedPressure - 1e-9;
      const hasEqualPressure = Math.abs(projectedPressure - bestProjectedPressure) <= 1e-9;
      const isMoreSpreadOut = distance > bestDistance;
      const isLaterTie = distance === bestDistance
        && bestBucket !== null
        && bucket.yearMonth > bestBucket.yearMonth;
      if (hasLowerPressure || (hasEqualPressure && (isMoreSpreadOut || isLaterTie))) {
        bestBucket = bucket;
        bestProjectedPressure = projectedPressure;
        bestDistance = distance;
      }
    }
    if (!bestBucket) break;
    const date = bestBucket.preferredDates.shift() ?? bestBucket.fallbackDates.shift();
    if (!date) break;
    assignedDateSet.add(date);
    result.push(date);
    assignedCountByMonth.set(
      bestBucket.yearMonth,
      (assignedCountByMonth.get(bestBucket.yearMonth) ?? 0) + 1,
    );
  }
  return result.sort();
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
    const assignedInternDateKeys = assignBalancedInternDates(
      cumulativePlan,
      assignedDateSet,
      additionalRequiredDays,
    );
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
