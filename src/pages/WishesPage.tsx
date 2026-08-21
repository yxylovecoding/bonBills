import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AmountInput from '../components/AmountInput';
import Card from '../components/Card';
import { formatCurrency } from '../components/CurrencyDisplay';
import WishTimeline from '../components/WishTimeline';
import WishCompactCalendar from '../components/WishCompactCalendar';
import { calcHistoryStats } from '../calculations/history';
import { useBillDetailStore } from '../stores/billDetailStore';
import { useCalendarStore } from '../stores/calendarStore';
import { useConfigStore } from '../stores/configStore';
import { useExpenseScopeOverrideStore } from '../stores/expenseScopeOverrideStore';
import { useMonthlyStore } from '../stores/monthlyStore';
import { useSnapshotStore } from '../stores/snapshotStore';
import { useTripStore } from '../stores/tripStore';
import { usePrefsStore } from '../stores/prefsStore';
import type { TagKind, WishExtraExpenseItem, WishItem } from '../models/types';
import { useHolidayYears } from '../utils/holidays';
import { detectAllTrips, type TripSegment } from '../utils/trips';
import { calculateWishInternPlan } from '../utils/wishInternPlan';
import {
  calculateTravelWishEstimate,
  calculateWishPlan,
  resolveWishExtraExpenseItems,
  totalWishExtraExpenseAmount,
} from '../utils/wishes';
import { calculateCreditRepaymentPlan } from '../utils/creditRepayment';
import { roundToSitePrecision } from '../utils/numberInput';
import { buildWishTimelineEntries } from '../utils/wishTimeline';
import { daysUntilDate } from '../utils/payroll';
import {
  calculateWishMilestonePlan,
  repaymentsThroughDeadline,
  type WishRepaymentDue,
} from '../utils/wishMilestonePlan';

const C = { blue: '#1a73e8', red: '#ea4335', green: '#0d9488', purple: '#7c3aed', sub: '#5f6368', orange: '#e8710a' };
const LIFE_EXPENSE_TOOLTIP_ORDER: Array<{ kind: TagKind; label: string }> = [
  { kind: 'home', label: '家' },
  { kind: 'travel', label: '游' },
  { kind: 'intern', label: '班' },
  { kind: 'school', label: '学' },
];

function sanitizeAmount(raw: string): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(parsed, 0) : 0;
}

function sanitizeSignedAmount(raw: string): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatSignedWishCurrency(value: number): string {
  return `${value < 0 ? '-' : ''}¥${formatCurrency(value)}`;
}

function offsetYearMonth(date: Date, offset: number): string {
  const target = new Date(date.getFullYear(), date.getMonth() + offset, 1);
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}`;
}

function dateInMonth(value: string, requestedDay: number): string {
  const [year, month] = value.split('-').map(Number);
  const day = Math.min(requestedDay, new Date(year, month, 0).getDate());
  return `${value}-${String(day).padStart(2, '0')}`;
}

function tripOptionLabel(trip: TripSegment, tag?: string): string {
  const start = `${Number(trip.startDate.slice(5, 7))}/${Number(trip.startDate.slice(8, 10))}`;
  const end = `${Number(trip.endDate.slice(5, 7))}/${Number(trip.endDate.slice(8, 10))}`;
  return `${start}${trip.startDate === trip.endDate ? '' : `–${end}`} · ${trip.dates.length}天${tag ? ` · ${tag}` : ''}`;
}

function offsetDateKey(value: string, days: number): string {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function offsetMonthKey(value: string, months: number): string {
  const [year, month] = value.split('-').map(Number);
  const date = new Date(year, month - 1 + months, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function planningDeadlineDistanceLabel(targetDate: string, fromDate: Date, days: number): string {
  if (days === 0) return '今天截止';
  if (days <= 365) return `距今 ${days.toLocaleString('zh-CN')} 天`;
  const [targetYear, targetMonth, targetDay] = targetDate.split('-').map(Number);
  let completeMonths = (targetYear - fromDate.getFullYear()) * 12
    + targetMonth - (fromDate.getMonth() + 1);
  if (targetDay < fromDate.getDate()) completeMonths -= 1;
  const years = Math.floor(Math.max(completeMonths, 12) / 12);
  const months = Math.max(completeMonths, 12) % 12;
  return months === 0
    ? `距今 ${years.toLocaleString('zh-CN')} 年`
    : `距今 ${years.toLocaleString('zh-CN')} 年 ${months} 个月`;
}

export default function WishesPage() {
  const { config, setConfig } = useConfigStore();
  const { current } = useSnapshotStore();
  const { records } = useMonthlyStore();
  const { tagMap, confirmedExpenses, setTags } = useCalendarStore();
  const { expenseItems } = useBillDetailStore();
  const { overrides } = useExpenseScopeOverrideStore();
  const { tripTags, tripSplits } = useTripStore();
  const showPayrollCutoffMarkers = usePrefsStore((state) => state.showPayrollCutoffMarkers);
  const [amountDrafts, setAmountDrafts] = useState<Record<string, string>>({});
  const [budgetEstimateWishId, setBudgetEstimateWishId] = useState<string | null>(null);
  const [planningDeadline, setPlanningDeadline] = useState('');
  const [activeWishId, setActiveWishId] = useState<string | null>(null);
  const [visiblePlanningMonth, setVisiblePlanningMonth] = useState('');
  const [pendingWishNameFocusId, setPendingWishNameFocusId] = useState<string | null>(null);
  const [selectedSegmentDays, setSelectedSegmentDays] = useState<Record<string, number>>({});
  const wishListScrollRef = useRef<HTMLDivElement>(null);
  const wishScrollFrameRef = useRef<number | null>(null);
  const today = new Date();
  const todayYear = today.getFullYear();
  const todayKey = `${todayYear}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const twoYearsAgo = `${todayYear - 1}-01`;
  const wishes = config.wishes ?? [];
  useEffect(() => {
    let changed = false;
    const normalizedWishes = wishes.map((wish) => {
      const linkedTripStart = wish.linkedTripStartDate ?? null;
      if (!linkedTripStart) return wish;
      const defaultDeadline = offsetDateKey(linkedTripStart, -1);
      if (wish.deadline === defaultDeadline) return wish;
      changed = true;
      return { ...wish, deadline: defaultDeadline };
    });
    if (changed) setConfig({ wishes: normalizedWishes });
  }, [setConfig, wishes]);
  const allTripSegments = useMemo(() => detectAllTrips(tagMap, tripSplits), [tagMap, tripSplits]);
  const availableTripSegments = useMemo(
    () => allTripSegments.filter((trip) => trip.endDate >= todayKey),
    [allTripSegments, todayKey],
  );
  const tripDatesByStart = useMemo(
    () => Object.fromEntries(allTripSegments.map((trip) => [trip.startDate, trip.dates])),
    [allTripSegments],
  );
  const defaultPlanningDeadline = useMemo(
    () => wishes
      .filter((wish) => wish.isActive && wish.deadline && wish.deadline >= todayKey && wish.targetAmount > wish.savedAmount)
      .reduce((latest, wish) => wish.deadline && wish.deadline > latest ? wish.deadline : latest, todayKey),
    [todayKey, wishes],
  );
  const selectedPlanningWish = useMemo(() => {
    const eligible = wishes
      .filter((wish) => wish.isActive && wish.deadline && wish.deadline >= todayKey && wish.targetAmount > wish.savedAmount)
      .sort((a, b) => (a.deadline ?? '').localeCompare(b.deadline ?? '') || a.id.localeCompare(b.id));
    return eligible.find((wish) => wish.id === activeWishId) ?? eligible[0] ?? null;
  }, [activeWishId, todayKey, wishes]);
  const selectedWishDeadline = selectedPlanningWish?.deadline && selectedPlanningWish.deadline >= todayKey
    ? selectedPlanningWish.deadline
    : null;
  const effectivePlanningDeadline = selectedWishDeadline
    ?? (planningDeadline >= todayKey ? planningDeadline : defaultPlanningDeadline);
  const daysUntilPlanningDeadline = Math.max(daysUntilDate(effectivePlanningDeadline, today), 0);
  const activeTimelineTrip = selectedPlanningWish?.linkedTripStartDate
    ? allTripSegments.find((trip) => trip.startDate === selectedPlanningWish.linkedTripStartDate)
    : undefined;
  const activeTimelineStartDate = activeTimelineTrip?.startDate ?? effectivePlanningDeadline;
  const activeTimelineEndDate = activeTimelineTrip?.endDate ?? effectivePlanningDeadline;
  const furthestPlanningDeadline = planningDeadline >= todayKey && planningDeadline > defaultPlanningDeadline
    ? planningDeadline
    : defaultPlanningDeadline;
  const planningEndYear = Math.max(Number(furthestPlanningDeadline.slice(0, 4)) || todayYear, todayYear);
  const holidayYears = useMemo(
    () => Array.from(
      { length: Math.min(planningEndYear - todayYear + 1, 20) },
      (_, index) => todayYear + index,
    ),
    [planningEndYear, todayYear],
  );
  const { holidayDataByYear } = useHolidayYears(holidayYears);

  const filteredRecords = useMemo(
    () => records.filter((record) => record.yearMonth >= twoYearsAgo),
    [records, twoYearsAgo],
  );
  const stats = useMemo(
    () => calcHistoryStats(filteredRecords, tagMap, confirmedExpenses, expenseItems, overrides, tripTags),
    [filteredRecords, tagMap, confirmedExpenses, expenseItems, overrides, tripTags],
  );
  const {
    effectiveCreditMonthly: currentCreditDue,
    effectiveCreditNext: nextCreditDue,
    longBondRepay,
    longBondRepayNext,
  } = calculateCreditRepaymentPlan({
    creditMonthly: current.accounts.creditMonthly,
    creditTotal: current.accounts.credit,
    savingsCard: current.accounts.savingsCard,
    longBond: current.investHoldings.longBond,
  });
  // 以信用卡出账日为规划节点：本次还本期待还，下一个出账日还总待还中的剩余部分。
  const configuredBillDay = Math.min(Math.max(Math.round(config.creditBillDate || config.creditPayDate || 1), 1), 31);
  const daysThisMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const currentDueOffset = today.getDate() <= Math.min(configuredBillDay, daysThisMonth) ? 0 : 1;
  const currentDueMonth = offsetYearMonth(today, currentDueOffset);
  const nextDueMonth = offsetYearMonth(today, currentDueOffset + 1);
  const currentDueDate = dateInMonth(currentDueMonth, configuredBillDay);
  const nextDueDate = dateInMonth(nextDueMonth, configuredBillDay);
  const repaymentsByMonth = useMemo(() => ({
    [currentDueMonth]: currentCreditDue,
    [nextDueMonth]: nextCreditDue,
  }), [currentCreditDue, currentDueMonth, nextCreditDue, nextDueMonth]);
  const repaymentDues = useMemo<WishRepaymentDue[]>(() => [
    { date: currentDueDate, yearMonth: currentDueMonth, amount: currentCreditDue },
    { date: nextDueDate, yearMonth: nextDueMonth, amount: nextCreditDue },
  ], [currentCreditDue, currentDueDate, currentDueMonth, nextCreditDue, nextDueDate, nextDueMonth]);
  const planningRepaymentsByMonth = useMemo(
    () => repaymentsThroughDeadline(repaymentDues, todayKey, effectivePlanningDeadline),
    [effectivePlanningDeadline, repaymentDues, todayKey],
  );
  const planningLongBondRepay = (
    currentDueDate >= todayKey && currentDueDate <= effectivePlanningDeadline ? longBondRepay : 0
  ) + (
    nextDueDate >= todayKey && nextDueDate <= effectivePlanningDeadline ? longBondRepayNext : 0
  );
  const plan = useMemo(
    () => calculateWishPlan(wishes, {
      today,
      tagMap,
      stateDailyAvg: stats.stateDailyAvg,
      repaymentsByMonth,
    }),
    // todayKey 每日变化一次，避免 Date 实例导致无意义的重复计算。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wishes, tagMap, stats.stateDailyAvg, repaymentsByMonth, todayKey],
  );
  const milestonePlan = useMemo(
    () => calculateWishMilestonePlan({
      today,
      wishes,
      incomeItems: config.incomeItems,
      tagMap,
      stateDailyAvg: stats.stateDailyAvg,
      repaymentDues,
      holidayDataByYear,
      tripDatesByStart,
    }),
    // todayKey 每日变化一次，避免 Date 实例导致无意义的重复计算。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config.incomeItems, holidayDataByYear, repaymentDues, stats.stateDailyAvg, tagMap, todayKey, tripDatesByStart, wishes],
  );
  const activeSegment = selectedPlanningWish
    ? milestonePlan.segmentByWishId[selectedPlanningWish.id]
    : milestonePlan.segments[0];
  const scheduledPlanDates = useMemo(() => {
    if (!activeSegment) return milestonePlan.recommendedDates;
    const minimum = activeSegment.minimumInternDateKeys.length;
    const requested = selectedSegmentDays[activeSegment.deadline] ?? minimum;
    if (requested === 0) return [];
    const desired = Math.min(
      Math.max(Math.round(requested), minimum),
      activeSegment.availableInternDateKeys.length,
    );
    const selectedDates = new Set(activeSegment.minimumInternDateKeys);
    for (const date of activeSegment.availableInternDateKeys) {
      if (selectedDates.size >= desired) break;
      selectedDates.add(date);
    }
    return [...selectedDates].sort();
  }, [activeSegment, milestonePlan.recommendedDates, selectedSegmentDays]);
  const selectedCumulativeInternDays = activeSegment
    ? scheduledPlanDates.length
    : null;
  const internPlan = useMemo(
    () => calculateWishInternPlan({
      today,
      deadline: effectivePlanningDeadline,
      wishes,
      incomeItems: config.incomeItems,
      tagMap,
      stateDailyAvg: stats.stateDailyAvg,
      repaymentsByMonth: planningRepaymentsByMonth,
      holidayDataByYear,
      tripDatesByStart,
      selectedInternDays: selectedCumulativeInternDays,
    }),
    // todayKey 每日变化一次，避免 Date 实例导致无意义的重复计算。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config.incomeItems, effectivePlanningDeadline, holidayDataByYear, planningRepaymentsByMonth, selectedCumulativeInternDays, stats.stateDailyAvg, tagMap, todayKey, tripDatesByStart, wishes],
  );
  const lifeExpenseTooltip = LIFE_EXPENSE_TOOLTIP_ORDER.map(({ kind, label }) => {
    const item = internPlan.lifeExpenseBreakdown[kind];
    return `${label} ${item.days}天 × ¥${formatCurrency(item.dailyAverage)}/天 = ¥${formatCurrency(item.amount)}`;
  }).join('\n');
  const incomeTooltip = [
    `收入合计 ¥${formatCurrency(internPlan.recommendedIncome)}`,
    ...(internPlan.incomeBreakdown.length > 0
      ? internPlan.incomeBreakdown.map((item) => {
        const calculation = item.dailyRate !== undefined && item.days !== undefined
          ? `${item.days}天 × ¥${formatCurrency(item.dailyRate)}/天`
          : `税前 ¥${formatCurrency(item.grossAmount)}`;
        const tax = item.taxAmount > 0.005 ? ` − 扣税 ¥${formatCurrency(item.taxAmount)}` : '';
        return `${item.name}：${calculation}${tax} = ¥${formatCurrency(item.amount)}`;
      })
      : ['暂无计入收入']),
  ].join('\n');
  const creditRepaymentTooltip = [
    `信用卡总待还 ¥${formatCurrency(Math.max(current.accounts.credit ?? 0, 0))}`,
    `本期待还 ¥${formatCurrency(Math.max(current.accounts.creditMonthly ?? 0, 0))}`,
    `下期原待还 ¥${formatCurrency(Math.max((current.accounts.credit ?? 0) - Math.max(current.accounts.creditMonthly ?? 0, current.accounts.savingsCard ?? 0), 0))}`,
    `长债偿还本期 ¥${formatCurrency(longBondRepay)}`,
    `长债偿还下期 ¥${formatCurrency(longBondRepayNext)}`,
    `下期现金还款 ¥${formatCurrency(nextCreditDue)}`,
    `规划现金还款 ¥${formatCurrency(internPlan.repayment)}`,
  ].join('\n');
  const minimumSelectableInternDays = activeSegment
    ? activeSegment.minimumInternDateKeys.length
    : internPlan.minimumInternDays ?? internPlan.availableInternDays;
  const availableSelectableInternDays = activeSegment
    ? activeSegment.availableInternDateKeys.length
    : internPlan.availableInternDays;
  const selectedIntervalDaysOverride = activeSegment
    ? selectedSegmentDays[activeSegment.deadline]
    : undefined;
  const selectedIntervalInternDays = activeSegment
    ? selectedIntervalDaysOverride === 0
      ? 0
      : Math.min(
        Math.max(selectedIntervalDaysOverride ?? minimumSelectableInternDays, minimumSelectableInternDays),
        availableSelectableInternDays,
      )
    : internPlan.selectedInternDays;
  const scheduledIntervalInternDays = activeSegment
    ? activeSegment.availableInternDateKeys.filter((date) => tagMap[date] === 'intern').length
    : internPlan.scheduledInternDays;
  const intervalAdditionalInternDays = Math.max(minimumSelectableInternDays - scheduledIntervalInternDays, 0);
  const intervalReducibleInternDays = Math.max(scheduledIntervalInternDays - minimumSelectableInternDays, 0);
  const selectedSegmentLabel = activeSegment?.wishNames.join('、') || selectedPlanningWish?.name || '当前心愿';
  const selectedIntervalStartDate = activeSegment?.intervalStartDate ?? todayKey;
  const minimumPlanningMonth = selectedIntervalStartDate.slice(0, 7);
  const maximumPlanningMonth = effectivePlanningDeadline.slice(0, 7);
  const planningCalendarMonth = !visiblePlanningMonth
    ? maximumPlanningMonth
    : visiblePlanningMonth < minimumPlanningMonth
      ? minimumPlanningMonth
      : visiblePlanningMonth > maximumPlanningMonth
        ? maximumPlanningMonth
        : visiblePlanningMonth;
  const timelineEndDate = useMemo(() => {
    let latest = furthestPlanningDeadline > offsetDateKey(todayKey, 30)
      ? furthestPlanningDeadline
      : offsetDateKey(todayKey, 30);
    for (const trip of availableTripSegments) {
      if (trip.endDate > latest) latest = trip.endDate;
    }
    return latest;
  }, [availableTripSegments, furthestPlanningDeadline, todayKey]);
  const timelineEntries = useMemo(
    () => buildWishTimelineEntries({
      startDate: todayKey,
      endDate: timelineEndDate,
      tagMap,
      stateDailyAvg: stats.stateDailyAvg,
      recommendedInternDates: scheduledPlanDates,
      wishes,
      trips: allTripSegments,
      tripTags,
    }),
    [allTripSegments, scheduledPlanDates, stats.stateDailyAvg, tagMap, timelineEndDate, todayKey, tripTags, wishes],
  );
  const orderedPlanItems = useMemo(
    () => [...plan.items].sort((a, b) => {
      const firstDeadline = a.deadline && a.deadline >= todayKey ? a.deadline : '9999-12-31';
      const secondDeadline = b.deadline && b.deadline >= todayKey ? b.deadline : '9999-12-31';
      return firstDeadline.localeCompare(secondDeadline) || a.id.localeCompare(b.id);
    }),
    [plan.items, todayKey],
  );
  const selectableWishIds = useMemo(
    () => new Set(Object.keys(milestonePlan.segmentByWishId)),
    [milestonePlan.segmentByWishId],
  );
  const registeredSavings = wishes.reduce((sum, item) => sum + Math.max(item.savedAmount, 0), 0);
  const wishJarBalance = Math.max(current.accounts.wishJar ?? 0, 0);

  const syncWishes = (items: WishItem[]) => setConfig({ wishes: items });
  const addWish = () => {
    const id = `wish_${Date.now()}`;
    setSelectedSegmentDays({});
    setPendingWishNameFocusId(id);
    syncWishes([
      ...wishes,
      {
        id,
        name: '新心愿',
        targetAmount: 0,
        savedAmount: 0,
        deadline: null,
        isActive: true,
      },
    ]);
  };
  const removeWish = (id: string) => {
    setSelectedSegmentDays({});
    setActiveWishId((currentId) => currentId === id ? null : currentId);
    setBudgetEstimateWishId((currentId) => currentId === id ? null : currentId);
    syncWishes(wishes.filter((item) => item.id !== id));
  };
  const updateWish = <K extends keyof WishItem>(id: string, field: K, value: WishItem[K]) => {
    if (field !== 'name') setSelectedSegmentDays({});
    syncWishes(wishes.map((item) => item.id === id ? { ...item, [field]: value } : item));
  };
  const updateWishFields = (id: string, patch: Partial<WishItem>) => {
    setSelectedSegmentDays({});
    syncWishes(wishes.map((item) => item.id === id ? { ...item, ...patch } : item));
  };
  type WishAmountField = 'targetAmount' | 'savedAmount' | 'travelTicketAmount' | 'travelLodgingDailyAmount' | 'travelLifeCorrectionAmount';
  const updateAmount = (id: string, field: WishAmountField, raw: string) => {
    const key = `${id}:${field}`;
    setAmountDrafts((prev) => ({ ...prev, [key]: raw }));
    updateWish(id, field, sanitizeAmount(raw));
  };
  const finishAmountEdit = (id: string, field: WishAmountField) => {
    const key = `${id}:${field}`;
    setAmountDrafts((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };
  const setWishExtraExpenses = (wishId: string, items: WishExtraExpenseItem[]) => {
    updateWishFields(wishId, {
      travelExtraExpenseItems: items,
      travelExtraExpenseAmount: 0,
    });
  };
  const addWishExtraExpense = (wishId: string, items: WishExtraExpenseItem[]) => {
    setWishExtraExpenses(wishId, [
      ...items,
      {
        id: `extra_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: '',
        amount: 0,
      },
    ]);
  };
  const updateWishExtraExpense = (
    wishId: string,
    items: WishExtraExpenseItem[],
    expenseId: string,
    patch: Partial<Pick<WishExtraExpenseItem, 'name' | 'amount'>>,
  ) => {
    setWishExtraExpenses(
      wishId,
      items.map((expense) => expense.id === expenseId ? { ...expense, ...patch } : expense),
    );
  };
  const allInternDaysApplied = availableSelectableInternDays > 0
    && scheduledIntervalInternDays >= availableSelectableInternDays;
  const noInternDaysApplied = availableSelectableInternDays > 0
    && scheduledIntervalInternDays === 0;
  const applyAllInternDays = () => {
    const dates = activeSegment?.availableInternDateKeys ?? internPlan.availableInternDateKeys;
    if (dates.length === 0) return;
    setTags(dates, 'intern');
    if (activeSegment) {
      setSelectedSegmentDays((current) => ({
        ...current,
        [activeSegment.deadline]: activeSegment.availableInternDateKeys.length,
      }));
    }
  };
  const applyNoInternDays = () => {
    const dates = activeSegment?.availableInternDateKeys ?? internPlan.availableInternDateKeys;
    if (dates.length === 0) return;
    setTags(dates, 'school');
    if (activeSegment) {
      setSelectedSegmentDays((current) => ({
        ...current,
        [activeSegment.deadline]: 0,
      }));
    }
  };
  const setSelectedInternDays = (days: number) => {
    if (!activeSegment) return;
    setSelectedSegmentDays((current) => ({ ...current, [activeSegment.deadline]: days }));
  };
  const handleWishListScroll = useCallback((container: HTMLDivElement) => {
    if (wishScrollFrameRef.current !== null) cancelAnimationFrame(wishScrollFrameRef.current);
    wishScrollFrameRef.current = requestAnimationFrame(() => {
      const containerRect = container.getBoundingClientRect();
      const anchor = containerRect.top + 24;
      const cards = container.querySelectorAll<HTMLElement>('[data-wish-id]');
      const reachedBottom = container.scrollHeight - container.scrollTop - container.clientHeight <= 8;
      if (reachedBottom) {
        for (let index = cards.length - 1; index >= 0; index -= 1) {
          const wishId = cards[index].dataset.wishId;
          if (!wishId || !selectableWishIds.has(wishId)) continue;
          setActiveWishId(wishId);
          wishScrollFrameRef.current = null;
          return;
        }
      }
      let closestWishId: string | null = null;
      let closestDistance = Number.POSITIVE_INFINITY;
      for (const card of cards) {
        const wishId = card.dataset.wishId;
        if (!wishId || !selectableWishIds.has(wishId)) continue;
        const rect = card.getBoundingClientRect();
        if (rect.bottom < containerRect.top || rect.top > containerRect.bottom) continue;
        const distance = Math.abs(rect.top - anchor);
        if (distance >= closestDistance) continue;
        closestDistance = distance;
        closestWishId = wishId;
      }
      if (closestWishId) setActiveWishId(closestWishId);
      wishScrollFrameRef.current = null;
    });
  }, [selectableWishIds]);

  useEffect(() => () => {
    if (wishScrollFrameRef.current !== null) cancelAnimationFrame(wishScrollFrameRef.current);
  }, []);

  useEffect(() => {
    if (!budgetEstimateWishId) return undefined;
    const closeBudgetEstimateOnOutsidePointer = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      const expandedCard = Array.from(
        wishListScrollRef.current?.querySelectorAll<HTMLElement>('[data-wish-id]') ?? [],
      ).find((element) => element.dataset.wishId === budgetEstimateWishId);
      if (expandedCard?.contains(event.target)) return;
      setBudgetEstimateWishId(null);
    };
    document.addEventListener('pointerdown', closeBudgetEstimateOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeBudgetEstimateOnOutsidePointer);
  }, [budgetEstimateWishId]);

  useEffect(() => {
    const deadlineMonth = effectivePlanningDeadline.slice(0, 7);
    setVisiblePlanningMonth((current) => current === deadlineMonth ? current : deadlineMonth);
  }, [effectivePlanningDeadline, selectedPlanningWish?.id]);

  useEffect(() => {
    if (!pendingWishNameFocusId) return;
    const container = wishListScrollRef.current;
    const card = Array.from(container?.querySelectorAll<HTMLElement>('[data-wish-id]') ?? [])
      .find((element) => element.dataset.wishId === pendingWishNameFocusId);
    const nameInput = card?.querySelector<HTMLInputElement>('input[aria-label="心愿名称"]');
    if (!card || !nameInput) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    nameInput.focus({ preventScroll: true });
    nameInput.select();
    setPendingWishNameFocusId(null);
  }, [orderedPlanItems, pendingWishNameFocusId]);

  const planningDeadlineControl = (
    <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
      <input
        type="date"
        aria-label="心愿规划截止日期"
        min={todayKey}
        value={effectivePlanningDeadline}
        onChange={(event) => {
          const value = event.target.value;
          if (selectedPlanningWish) updateWish(selectedPlanningWish.id, 'deadline', value || null);
          else setPlanningDeadline(value);
        }}
        style={{ minWidth: 124, border: '1px solid rgba(255,255,255,0.38)', borderRadius: 8, outline: 'none', backgroundColor: 'rgba(255,255,255,0.16)', color: '#fff', padding: '5px 7px', fontSize: 11, fontWeight: 700, colorScheme: 'dark' }}
      />
      <div style={{ paddingRight: 2, fontSize: 9, fontWeight: 600, opacity: 0.76, fontVariantNumeric: 'tabular-nums' }}>
        {planningDeadlineDistanceLabel(effectivePlanningDeadline, today, daysUntilPlanningDeadline)}
      </div>
    </div>
  );

  const planningHeadingAside = (
    <div style={{ flexShrink: 0, display: 'flex', alignItems: 'flex-start', gap: 8, marginLeft: 'auto' }}>
      <div style={{ width: 118, minWidth: 0, paddingTop: 1, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        <div
          title={`当前区间 · ${selectedSegmentLabel}`}
          style={{ overflow: 'hidden', color: 'rgba(255,255,255,0.86)', fontSize: 12, fontWeight: 650, lineHeight: 1.25, textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          当前区间 · {selectedSegmentLabel}
        </div>
        <div style={{ marginTop: 2, fontSize: 14, fontWeight: 800, lineHeight: 1.25, whiteSpace: 'nowrap' }}>
          {selectedIntervalStartDate} 至
        </div>
      </div>
      {planningDeadlineControl}
    </div>
  );

  return (
    <div className="wishes-page-shell">
      <WishTimeline
        entries={timelineEntries}
        activeStartDate={activeTimelineStartDate}
        activeEndDate={activeTimelineEndDate}
        activeRangeLabel={activeTimelineTrip ? '当前心愿关联行程' : '当前心愿截止日'}
      />
      <div className="wishes-page-content">
      <div className="wishes-page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 2px' }}>心愿</h1>
          <p style={{ fontSize: 13, color: C.sub, margin: 0 }}>把想要的，变成每个月做得到的</p>
        </div>
        <button
          type="button"
          onClick={addWish}
          style={{ border: 'none', borderRadius: 999, backgroundColor: C.purple, color: '#fff', fontSize: 12, fontWeight: 700, padding: '7px 12px', cursor: 'pointer', boxShadow: '0 2px 8px rgba(124,58,237,0.24)' }}
        >
          + 添加心愿
        </button>
      </div>

      <div className="wishes-planning-grid">
      <div className="wish-planning-column">
      <section className="wish-planning-panel" style={{ background: 'linear-gradient(145deg, #6d28d9 0%, #8b5cf6 58%, #a78bfa 100%)', color: '#fff', borderRadius: 16, padding: '16px', marginBottom: 12, boxShadow: '0 8px 24px rgba(109,40,217,0.2)' }}>
        {internPlan.wishAmountIncludingLife > 0 ? (
          <>
            {!internPlan.usesConsumptionTransfer
              && internPlan.minimumInternDays !== null
              && selectedIntervalInternDays > minimumSelectableInternDays ? (
              <div style={{ fontSize: 11, opacity: 0.82, marginBottom: 4 }}>
                本段比最低方案多实习 {selectedIntervalInternDays - minimumSelectableInternDays} 天
              </div>
            ) : null}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0, fontSize: 24, lineHeight: 1.15, fontWeight: 800, fontVariantNumeric: 'tabular-nums', letterSpacing: -0.4 }}>
                {internPlan.usesConsumptionTransfer
                  ? `全部实习，从消费补${formatCurrency(internPlan.consumptionTransferredToWish)}元${internPlan.shortfall > 0.005 ? `，仍差${formatCurrency(internPlan.shortfall)}元` : ''}`
                  : internPlan.minimumInternDays === null
                    ? `本段全部实习仍差 ¥${formatCurrency(internPlan.shortfall)}`
                    : minimumSelectableInternDays >= availableSelectableInternDays && availableSelectableInternDays > 0
                      ? '本段全部实习'
                      : intervalAdditionalInternDays > 0
                        ? `本段最少再实习 ${intervalAdditionalInternDays} 天`
                        : intervalReducibleInternDays > 0
                          ? `本段最多可少实习 ${intervalReducibleInternDays} 天`
                          : `本段安排 ${selectedIntervalInternDays} 天实习`}
              </div>
              {planningHeadingAside}
            </div>
            {internPlan.usesConsumptionTransfer || internPlan.minimumInternDays === null ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, marginTop: 10 }}>
                <button
                  type="button"
                  aria-label="把规划范围内所有非家非游的中国法定工作日设为实习"
                  disabled={allInternDaysApplied || availableSelectableInternDays === 0}
                  onClick={applyAllInternDays}
                  style={{ minWidth: 0, border: '1px solid rgba(255,255,255,0.5)', borderRadius: 9, backgroundColor: allInternDaysApplied ? 'rgba(255,255,255,0.12)' : '#fff', color: allInternDaysApplied ? 'rgba(255,255,255,0.68)' : C.purple, padding: '7px 8px', fontSize: 10, fontWeight: 800, cursor: allInternDaysApplied || availableSelectableInternDays === 0 ? 'default' : 'pointer' }}
                >
                  {availableSelectableInternDays === 0
                    ? '没有可改的工作日'
                    : allInternDaysApplied
                      ? '日历已全部实习'
                      : `一键全部实习 · ${availableSelectableInternDays} 天`}
                </button>
                <button
                  type="button"
                  aria-label="把规划范围内所有非家非游的中国法定工作日设为不实习"
                  disabled={noInternDaysApplied || availableSelectableInternDays === 0}
                  onClick={applyNoInternDays}
                  style={{ minWidth: 0, border: '1px solid rgba(255,255,255,0.5)', borderRadius: 9, backgroundColor: noInternDaysApplied ? 'rgba(255,255,255,0.12)' : '#fff', color: noInternDaysApplied ? 'rgba(255,255,255,0.68)' : C.purple, padding: '7px 8px', fontSize: 10, fontWeight: 800, cursor: noInternDaysApplied || availableSelectableInternDays === 0 ? 'default' : 'pointer' }}
                >
                  {noInternDaysApplied ? '已全部不实习' : '一键全部不实习'}
                </button>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 10, opacity: 0.82, marginTop: 4 }}>
                  本段日历已排 {scheduledIntervalInternDays} 天实习
                  {' · '}至少 {minimumSelectableInternDays} 天
                  {' · '}最多 {availableSelectableInternDays} 个非家非游法定工作日
                </div>
                <div style={{ marginTop: 8, borderRadius: 10, padding: '8px 10px', backgroundColor: 'rgba(255,255,255,0.14)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 11, fontWeight: 700 }}>实习天数</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 5 }}>
                      <button
                        type="button"
                        aria-label="把规划范围内所有非家非游的中国法定工作日设为实习"
                        disabled={allInternDaysApplied || availableSelectableInternDays === 0}
                        onClick={applyAllInternDays}
                        style={{ border: '1px solid rgba(255,255,255,0.42)', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.12)', color: '#fff', padding: '4px 7px', fontSize: 9, fontWeight: 700, cursor: allInternDaysApplied || availableSelectableInternDays === 0 ? 'default' : 'pointer', opacity: allInternDaysApplied ? 0.55 : 1 }}
                      >
                        {availableSelectableInternDays === 0 ? '无可改工作日' : allInternDaysApplied ? '已全部实习' : '本段全部实习'}
                      </button>
                      <button
                        type="button"
                        aria-label="把规划范围内所有非家非游的中国法定工作日设为不实习"
                        disabled={noInternDaysApplied || availableSelectableInternDays === 0}
                        onClick={applyNoInternDays}
                        style={{ border: '1px solid rgba(255,255,255,0.42)', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.12)', color: '#fff', padding: '4px 7px', fontSize: 9, fontWeight: 700, cursor: noInternDaysApplied || availableSelectableInternDays === 0 ? 'default' : 'pointer', opacity: noInternDaysApplied ? 0.55 : 1 }}
                      >
                        {noInternDaysApplied ? '已全部不实习' : '本段全部不实习'}
                      </button>
                      <span style={{ fontSize: 16, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{selectedIntervalInternDays} 天</span>
                    </span>
                  </div>
                  {minimumSelectableInternDays < availableSelectableInternDays ? (
                    <>
                      <input
                        type="range"
                        aria-label="规划实习天数"
                        aria-valuetext={`${selectedIntervalInternDays} 天`}
                        min={selectedIntervalInternDays === 0 ? 0 : minimumSelectableInternDays}
                        max={availableSelectableInternDays}
                        step={1}
                        value={selectedIntervalInternDays}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          setSelectedInternDays(value === 0 ? 0 : Math.max(value, minimumSelectableInternDays));
                        }}
                        style={{ width: '100%', margin: '6px 0 2px', accentColor: '#fff', cursor: 'pointer' }}
                      />
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 9, opacity: 0.72 }}>
                        <span>{selectedIntervalInternDays === 0 ? `当前不实习 · 满足心愿需 ${minimumSelectableInternDays} 天` : `满足心愿 ${minimumSelectableInternDays} 天`}</span>
                        <span>本段工作日上限 {availableSelectableInternDays} 天</span>
                      </div>
                    </>
                  ) : null}
                </div>
              </>
            )}
            <div style={{ marginTop: 8, borderRadius: 10, padding: '8px 10px', backgroundColor: 'rgba(255,255,255,0.14)' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                <span style={{ fontSize: 10, opacity: 0.8 }}>截至 {effectivePlanningDeadline} · 累计 {internPlan.selectedInternDays} 天</span>
                <span style={{ fontSize: 19, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>¥{formatCurrency(internPlan.projectedTotalSaving)}</span>
              </div>
              <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.2)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px 10px', fontSize: 10 }}>
                <div title={incomeTooltip} tabIndex={0} style={{ opacity: 0.78, cursor: 'help' }}>收入</div>
                <div title={incomeTooltip} tabIndex={0} style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', cursor: 'help', textDecoration: 'underline dotted', textUnderlineOffset: 2 }}>¥{formatCurrency(internPlan.recommendedIncome)}</div>
                <div style={{ opacity: 0.78 }}>生活开支（含信用卡）</div>
                <div style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>−¥{formatCurrency(internPlan.totalLivingExpense)}</div>
                <div style={{ gridColumn: '1 / -1', marginTop: -2, textAlign: 'right', fontSize: 8, opacity: 0.68 }}>
                  <span title={lifeExpenseTooltip} tabIndex={0} style={{ cursor: 'help', borderBottom: '1px dotted rgba(255,255,255,0.58)' }}>
                    “活” ¥{formatCurrency(internPlan.recommendedLifeExpense)}
                  </span>
                  {' · '}
                  <span title={creditRepaymentTooltip} tabIndex={0} style={{ cursor: 'help', borderBottom: '1px dotted rgba(255,255,255,0.58)' }}>
                    信用卡 ¥{formatCurrency(internPlan.repayment)}
                  </span>
                  {planningLongBondRepay > 0.005 && <> · 长债已抵 ¥{formatCurrency(planningLongBondRepay)}</>}
                </div>
                <div style={{ opacity: 0.78 }}>结余</div>
                <div style={{ textAlign: 'right', fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: internPlan.projectedSurplus >= 0 ? '#dcfce7' : '#fde68a' }}>
                  {internPlan.projectedSurplus >= 0 ? '' : '−'}¥{formatCurrency(Math.abs(internPlan.projectedSurplus))}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 4, marginTop: 7 }}>
                <div style={{ borderRadius: 7, backgroundColor: 'rgba(255,255,255,0.12)', padding: '5px 4px', textAlign: 'center' }}>
                  <div style={{ fontSize: 9, opacity: 0.72 }}>消费</div>
                  <div style={{ marginTop: 1, fontSize: 10, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>¥{formatCurrency(internPlan.projectedConsumption)}</div>
                </div>
                <div style={{ borderRadius: 7, backgroundColor: 'rgba(255,255,255,0.12)', padding: '5px 4px', textAlign: 'center' }}>
                  <div style={{ fontSize: 9, opacity: 0.72 }}>心愿</div>
                  <div style={{ marginTop: 1, fontSize: 10, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>¥{formatCurrency(internPlan.projectedWishSaving)}</div>
                </div>
                <div style={{ borderRadius: 7, backgroundColor: 'rgba(255,255,255,0.12)', padding: '5px 4px', textAlign: 'center' }}>
                  <div style={{ fontSize: 9, opacity: 0.72 }}>放进理财</div>
                  <div style={{ marginTop: 1, fontSize: 10, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>¥{formatCurrency(internPlan.projectedInvestmentSaving)}</div>
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 4 }}>
              <div style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 800 }}>给心愿一个截止日期</div>
              {planningHeadingAside}
            </div>
            <div style={{ fontSize: 11, lineHeight: 1.5, opacity: 0.82 }}>填入目标、已攒金额和 DDL，就会自动算出在能攒够的前提下最少需要实习几天。</div>
          </>
        )}
      </section>

      <WishCompactCalendar
        visibleMonth={planningCalendarMonth}
        minimumMonth={minimumPlanningMonth}
        maximumMonth={maximumPlanningMonth}
        intervalStartDate={selectedIntervalStartDate}
        intervalEndDate={effectivePlanningDeadline}
        highlightedStartDate={activeTimelineStartDate}
        highlightedEndDate={activeTimelineEndDate}
        today={todayKey}
        tagMap={tagMap}
        scheduledInternDates={scheduledPlanDates}
        confirmedExpenses={confirmedExpenses}
        holidayDataByYear={holidayDataByYear}
        showPayrollCutoffMarkers={showPayrollCutoffMarkers}
        onPreviousMonth={() => {
          if (planningCalendarMonth > minimumPlanningMonth) {
            setVisiblePlanningMonth(offsetMonthKey(planningCalendarMonth, -1));
          }
        }}
        onNextMonth={() => {
          if (planningCalendarMonth < maximumPlanningMonth) {
            setVisiblePlanningMonth(offsetMonthKey(planningCalendarMonth, 1));
          }
        }}
      />
      </div>

      <div
        ref={wishListScrollRef}
        className="wish-list-scroll"
        onScroll={(event) => handleWishListScroll(event.currentTarget)}
      >
      <Card title="心愿清单" subtitle={`${wishes.length} 个心愿`}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '0 0 12px', marginBottom: 12, borderBottom: '1px solid #f1f3f4', fontSize: 11 }}>
          <span style={{ color: C.sub }}>心愿罐 ¥{formatCurrency(wishJarBalance)}</span>
          <span style={{ color: registeredSavings > wishJarBalance ? C.orange : C.sub }}>已登记 ¥{formatCurrency(registeredSavings)}</span>
        </div>
        {registeredSavings > wishJarBalance && (
          <div style={{ color: C.orange, backgroundColor: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, fontSize: 11, lineHeight: 1.5, padding: '7px 9px', marginBottom: 10 }}>
            各心愿的“已攒”合计高于心愿罐余额，请确认是否包含了罐外资金。
          </div>
        )}
        {wishes.length === 0 && (
          <div style={{ textAlign: 'center', padding: '26px 12px 20px', color: C.sub }}>
            <div style={{ fontSize: 30, marginBottom: 8 }}>♡</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#3c4043' }}>还没有心愿</div>
            <div style={{ fontSize: 11, marginTop: 4 }}>先写下一个想实现的目标吧</div>
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {orderedPlanItems.map((item) => {
            const targetKey = `${item.id}:targetAmount`;
            const savedKey = `${item.id}:savedAmount`;
            const ticketKey = `${item.id}:travelTicketAmount`;
            const lodgingKey = `${item.id}:travelLodgingDailyAmount`;
            const lifeCorrectionKey = `${item.id}:travelLifeCorrectionAmount`;
            const linkedTrip = item.linkedTripStartDate
              ? allTripSegments.find((trip) => trip.startDate === item.linkedTripStartDate)
              : undefined;
            const linkedTripDefaultDeadline = item.linkedTripStartDate
              ? offsetDateKey(item.linkedTripStartDate, -1)
              : null;
            const itemTripOptions = linkedTrip && !availableTripSegments.some((trip) => trip.startDate === linkedTrip.startDate)
              ? [linkedTrip, ...availableTripSegments]
              : availableTripSegments;
            const travelSelection = linkedTrip
              ? linkedTrip.startDate
              : (item.plannedTravelDays ?? 0) > 0
                ? '__manual__'
                : '';
            const itemTravelDays = linkedTrip?.dates.length ?? Math.max(Math.round(item.plannedTravelDays ?? 0), 0);
            const itemLodgingDailyAmount = Number.isFinite(item.travelLodgingDailyAmount)
              ? Math.max(item.travelLodgingDailyAmount ?? 0, 0)
              : itemTravelDays > 0
                ? Math.max(item.travelLodgingAmount ?? 0, 0) / itemTravelDays
                : 0;
            const itemExtraExpenses = resolveWishExtraExpenseItems(item);
            const itemExtraExpenseAmount = totalWishExtraExpenseAmount(itemExtraExpenses);
            const travelEstimate = calculateTravelWishEstimate(
              itemTravelDays,
              stats.stateDailyAvg.travel,
              item.travelTicketAmount,
              itemLodgingDailyAmount,
              itemExtraExpenseAmount,
            );
            const itemTravelLifeAmount = travelEstimate.lifeAmount;
            const itemTravelLifeCorrectionAmount = Number.isFinite(item.travelLifeCorrectionAmount)
              ? Math.min(Math.max(item.travelLifeCorrectionAmount ?? 0, 0), itemTravelLifeAmount)
              : 0;
            const itemAdjustedTravelLifeAmount = Math.max(
              itemTravelLifeAmount - itemTravelLifeCorrectionAmount,
              0,
            );
            const itemTravelConsumptionAmount = itemTravelDays * Math.max(stats.stateConsumptionDailyAvg.travel, 0);
            const roundedTravelTargetAmount = roundToSitePrecision(
              Math.max(travelEstimate.targetAmount - itemTravelLifeCorrectionAmount, 0),
            );
            const actualWishSavingAmount = roundToSitePrecision(
              Math.max(item.targetAmount - itemAdjustedTravelLifeAmount, 0),
            );
            const remainingActualWishSavingAmount = roundToSitePrecision(
              Math.max(actualWishSavingAmount - Math.max(item.savedAmount, 0), 0),
            );
            const progress = actualWishSavingAmount > 0
              ? Math.min(Math.max(item.savedAmount, 0) / actualWishSavingAmount, 1)
              : item.targetAmount > 0 ? 1 : 0;
            const actualWishSavingCompleted = item.targetAmount > 0
              && remainingActualWishSavingAmount <= 0;
            const budgetEstimateVisible = budgetEstimateWishId === item.id;
            const isSelectedPlanningWish = selectedPlanningWish?.id === item.id;
            return (
              <div
                key={item.id}
                data-wish-id={item.id}
                aria-current={isSelectedPlanningWish ? 'true' : undefined}
                onClick={() => {
                  if (selectableWishIds.has(item.id)) setActiveWishId(item.id);
                }}
                onFocusCapture={() => {
                  if (selectableWishIds.has(item.id)) setActiveWishId(item.id);
                }}
                style={{ border: `1px solid ${isSelectedPlanningWish ? '#8b5cf6' : item.isActive ? '#e9d5ff' : '#e5e7eb'}`, backgroundColor: item.isActive ? '#fdfaff' : '#fafafa', borderRadius: 14, padding: '12px', boxShadow: isSelectedPlanningWish ? '0 0 0 2px rgba(139,92,246,0.14)' : 'none', transition: 'border-color 0.15s ease, box-shadow 0.15s ease' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    type="button"
                    aria-label={item.isActive ? '暂停心愿' : '启用心愿'}
                    onClick={() => updateWish(item.id, 'isActive', !item.isActive)}
                    style={{ flexShrink: 0, width: 18, height: 18, borderRadius: '50%', border: `2px solid ${item.isActive ? C.purple : '#d1d5db'}`, backgroundColor: item.isActive ? C.purple : '#fff', cursor: 'pointer', boxShadow: item.isActive ? 'inset 0 0 0 3px #fff' : 'none' }}
                  />
                  <input
                    aria-label="心愿名称"
                    value={item.name}
                    onChange={(event) => updateWish(item.id, 'name', event.target.value)}
                    style={{ flex: 1, minWidth: 0, border: 'none', borderBottom: '1px solid transparent', outline: 'none', background: 'transparent', fontSize: 14, fontWeight: 700, color: item.isActive ? '#202124' : '#9aa0a6' }}
                  />
                  <button type="button" aria-label="删除心愿" onClick={() => removeWish(item.id)} style={{ border: 'none', background: 'transparent', color: '#9aa0a6', fontSize: 18, padding: '0 2px', cursor: 'pointer', lineHeight: 1 }}>×</button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9, marginTop: 12 }}>
                  <label style={{ display: 'block' }}>
                    <span style={{ display: 'block', fontSize: 10, color: C.sub, marginBottom: 4 }}>目标金额</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, border: `1px solid ${budgetEstimateWishId === item.id ? '#c4b5fd' : '#e5e7eb'}`, borderRadius: 9, backgroundColor: '#fff', padding: '6px 8px', boxShadow: budgetEstimateWishId === item.id ? '0 0 0 2px #ede9fe' : 'none' }}>
                      <span style={{ fontSize: 11, color: C.sub }}>¥</span>
                      <AmountInput
                        aria-label="目标金额"
                        aria-expanded={budgetEstimateVisible}
                        aria-controls={`budget-estimate-${item.id}`}
                        value={amountDrafts[targetKey] ?? (item.targetAmount ? String(item.targetAmount) : '')}
                        onChange={(raw) => updateAmount(item.id, 'targetAmount', raw)}
                        onFocus={() => setBudgetEstimateWishId(item.id)}
                        onBlur={() => finishAmountEdit(item.id, 'targetAmount')}
                        placeholder="0"
                        style={{ width: '100%', minWidth: 0, border: 'none', outline: 'none', background: 'transparent', textAlign: 'right', fontSize: 12, fontWeight: 700, color: C.purple }}
                      />
                    </div>
                  </label>
                  <label style={{ display: 'block' }}>
                    <span style={{ display: 'block', fontSize: 10, color: C.sub, marginBottom: 4 }}>已经攒下</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, border: '1px solid #e5e7eb', borderRadius: 9, backgroundColor: '#fff', padding: '6px 8px' }}>
                      <span style={{ fontSize: 11, color: C.sub }}>¥</span>
                      <AmountInput
                        aria-label="已攒金额"
                        value={amountDrafts[savedKey] ?? (item.savedAmount ? String(item.savedAmount) : '')}
                        onChange={(raw) => updateAmount(item.id, 'savedAmount', raw)}
                        onBlur={() => finishAmountEdit(item.id, 'savedAmount')}
                        placeholder="0"
                        style={{ width: '100%', minWidth: 0, border: 'none', outline: 'none', background: 'transparent', textAlign: 'right', fontSize: 12, fontWeight: 700, color: C.green }}
                      />
                    </div>
                  </label>
                </div>

                {linkedTripDefaultDeadline ? null : (
                  <label style={{ display: 'block', marginTop: 9 }}>
                    <span style={{ display: 'block', fontSize: 10, color: C.sub, marginBottom: 4 }}>截止日期（可选）</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                        type="date"
                        aria-label="心愿截止日期"
                        value={item.deadline ?? ''}
                        onChange={(event) => updateWish(item.id, 'deadline', event.target.value || null)}
                        style={{ flex: 1, minWidth: 0, border: '1px solid #e5e7eb', borderRadius: 9, backgroundColor: '#fff', padding: '6px 8px', outline: 'none', fontSize: 12, color: item.deadline ? '#202124' : C.sub }}
                      />
                      {item.deadline && (
                        <button type="button" onClick={() => updateWish(item.id, 'deadline', null)} style={{ border: 'none', borderRadius: 8, padding: '7px 9px', backgroundColor: '#f3f4f6', color: C.sub, fontSize: 11, cursor: 'pointer' }}>清除</button>
                      )}
                    </div>
                  </label>
                )}

                <div style={{ marginTop: 9, borderRadius: 10, border: '1px solid #ede9fe', backgroundColor: '#faf7ff', padding: '8px 9px' }}>
                  <label style={{ display: 'block' }}>
                    <span style={{ display: 'block', fontSize: 10, color: C.sub, marginBottom: 4 }}>关联出游（可选）</span>
                    <select
                      aria-label={`${item.name} 关联出游`}
                      value={travelSelection}
                      onChange={(event) => {
                        const value = event.target.value;
                        if (value === '__manual__') {
                          updateWishFields(item.id, {
                            linkedTripStartDate: null,
                            plannedTravelDays: Math.max(Math.round(item.plannedTravelDays ?? 0), 1),
                          });
                        } else if (value) {
                          updateWishFields(item.id, {
                            linkedTripStartDate: value,
                            plannedTravelDays: 0,
                            deadline: offsetDateKey(value, -1),
                          });
                        } else {
                          updateWishFields(item.id, { linkedTripStartDate: null, plannedTravelDays: 0 });
                        }
                      }}
                      style={{ width: '100%', minWidth: 0, border: '1px solid #ddd6fe', borderRadius: 8, backgroundColor: '#fff', padding: '6px 8px', outline: 'none', fontSize: 11, color: '#202124' }}
                    >
                      <option value="">不关联出游</option>
                      {itemTripOptions.map((trip) => (
                        <option key={trip.startDate} value={trip.startDate}>
                          {tripOptionLabel(trip, tripTags[trip.startDate])}
                        </option>
                      ))}
                      <option value="__manual__">未排进日历，按天数计算</option>
                    </select>
                  </label>
                  {travelSelection === '__manual__' && (
                    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 7, fontSize: 11, color: C.sub }}>
                      <span>准备出去几天</span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={365}
                          aria-label={`${item.name} 出游天数`}
                          value={Math.max(Math.round(item.plannedTravelDays ?? 1), 1)}
                          onChange={(event) => updateWish(item.id, 'plannedTravelDays', Math.min(Math.max(Math.round(Number(event.target.value) || 1), 1), 365))}
                          style={{ width: 52, border: 'none', borderBottom: '1px solid #c4b5fd', outline: 'none', backgroundColor: 'transparent', textAlign: 'right', color: C.purple, fontSize: 12, fontWeight: 700 }}
                        />
                        天
                      </span>
                    </label>
                  )}
                  {budgetEstimateVisible && itemTravelDays <= 0 && (
                    <div id={`budget-estimate-${item.id}`} style={{ marginTop: 8, borderTop: '1px dashed #ddd6fe', paddingTop: 8, fontSize: 10, color: C.purple, lineHeight: 1.5 }}>
                      请先关联出游或填写出游天数
                    </div>
                  )}
                  {budgetEstimateVisible && itemTravelDays > 0 && (
                    <div id={`budget-estimate-${item.id}`} style={{ marginTop: 8, borderTop: '1px dashed #ddd6fe', paddingTop: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                        <span style={{ fontSize: 10, fontWeight: 800, color: C.purple }}>预算预估</span>
                        <button
                          type="button"
                          onClick={() => setBudgetEstimateWishId(null)}
                          style={{ border: 'none', background: 'transparent', color: C.sub, padding: 0, fontSize: 9, cursor: 'pointer' }}
                        >
                          收起
                        </button>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
                        <label>
                          <span style={{ display: 'block', marginBottom: 3, fontSize: 9, color: C.sub }}>机票</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 3, borderRadius: 7, backgroundColor: '#fff', padding: '5px 6px' }}>
                            <span style={{ fontSize: 10, color: C.sub }}>¥</span>
                            <AmountInput
                              aria-label={`${item.name} 机票价格`}
                              value={amountDrafts[ticketKey] ?? (item.travelTicketAmount ? String(item.travelTicketAmount) : '')}
                              onChange={(raw) => updateAmount(item.id, 'travelTicketAmount', raw)}
                              onBlur={() => finishAmountEdit(item.id, 'travelTicketAmount')}
                              placeholder="0"
                              style={{ width: '100%', minWidth: 0, border: 'none', outline: 'none', backgroundColor: 'transparent', textAlign: 'right', fontSize: 11, fontWeight: 700, color: C.purple }}
                            />
                          </div>
                        </label>
                        <label>
                          <span style={{ display: 'block', marginBottom: 3, fontSize: 9, color: C.sub }}>酒店/天</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 3, borderRadius: 7, backgroundColor: '#fff', padding: '5px 6px' }}>
                            <span style={{ fontSize: 10, color: C.sub }}>¥</span>
                            <AmountInput
                              aria-label={`${item.name} 酒店日均价格`}
                              value={amountDrafts[lodgingKey] ?? (itemLodgingDailyAmount ? String(itemLodgingDailyAmount) : '')}
                              onChange={(raw) => updateAmount(item.id, 'travelLodgingDailyAmount', raw)}
                              onBlur={() => finishAmountEdit(item.id, 'travelLodgingDailyAmount')}
                              placeholder="0"
                              style={{ width: '100%', minWidth: 0, border: 'none', outline: 'none', backgroundColor: 'transparent', textAlign: 'right', fontSize: 11, fontWeight: 700, color: C.purple }}
                            />
                          </div>
                        </label>
                        <div style={{ gridColumn: '1 / -1' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                            <span style={{ fontSize: 9, color: C.sub }}>额外消费（计入心愿）</span>
                            <button
                              type="button"
                              onClick={() => addWishExtraExpense(item.id, itemExtraExpenses)}
                              style={{ border: 'none', backgroundColor: 'transparent', color: C.purple, padding: 0, fontSize: 9, fontWeight: 700, cursor: 'pointer' }}
                            >
                              + 添加一笔
                            </button>
                          </div>
                          {itemExtraExpenses.length === 0 ? (
                            <button
                              type="button"
                              onClick={() => addWishExtraExpense(item.id, itemExtraExpenses)}
                              style={{ width: '100%', border: '1px dashed #ddd6fe', borderRadius: 7, backgroundColor: 'rgba(255,255,255,0.55)', color: '#8b5cf6', padding: '6px 8px', fontSize: 9, cursor: 'pointer' }}
                            >
                              添加电影票、冲浪等消费
                            </button>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                              {itemExtraExpenses.map((expense, expenseIndex) => {
                                const expenseAmountKey = `${item.id}:extraExpense:${expense.id}:amount`;
                                return (
                                  <div key={expense.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 92px 18px', alignItems: 'center', gap: 5 }}>
                                    <input
                                      aria-label={`${item.name} 第${expenseIndex + 1}笔额外消费名称`}
                                      value={expense.name}
                                      onChange={(event) => updateWishExtraExpense(item.id, itemExtraExpenses, expense.id, { name: event.target.value })}
                                      placeholder="电影票 / 冲浪"
                                      style={{ minWidth: 0, border: 'none', borderRadius: 7, outline: 'none', backgroundColor: '#fff', padding: '6px 7px', fontSize: 10, color: '#202124' }}
                                    />
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 2, borderRadius: 7, backgroundColor: '#fff', padding: '5px 6px' }}>
                                      <span style={{ fontSize: 9, color: C.sub }}>¥</span>
                                      <AmountInput
                                        aria-label={`${item.name} 第${expenseIndex + 1}笔额外消费金额`}
                                        value={amountDrafts[expenseAmountKey] ?? (expense.amount ? String(expense.amount) : '')}
                                        onChange={(raw) => {
                                          setAmountDrafts((current) => ({ ...current, [expenseAmountKey]: raw }));
                                          updateWishExtraExpense(item.id, itemExtraExpenses, expense.id, { amount: sanitizeSignedAmount(raw) });
                                        }}
                                        onBlur={() => setAmountDrafts((current) => {
                                          const next = { ...current };
                                          delete next[expenseAmountKey];
                                          return next;
                                        })}
                                        placeholder="0"
                                        style={{ width: '100%', minWidth: 0, border: 'none', outline: 'none', backgroundColor: 'transparent', textAlign: 'right', fontSize: 10, fontWeight: 700, color: C.purple }}
                                      />
                                    </div>
                                    <button
                                      type="button"
                                      aria-label={`删除${expense.name || `第${expenseIndex + 1}笔额外消费`}`}
                                      onClick={() => setWishExtraExpenses(item.id, itemExtraExpenses.filter((candidate) => candidate.id !== expense.id))}
                                      style={{ border: 'none', backgroundColor: 'transparent', color: '#9ca3af', padding: 0, fontSize: 16, lineHeight: 1, cursor: 'pointer' }}
                                    >
                                      ×
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 7 }}>
                        <span style={{ minWidth: 0, fontSize: 9, color: C.sub, lineHeight: 1.35 }}>
                          吃饭、小交通等“活”：{travelEstimate.days} 天 × ¥{formatCurrency(travelEstimate.dailyLifeAmount)}
                        </span>
                        <button
                          type="button"
                          disabled={roundedTravelTargetAmount <= 0}
                          onClick={() => updateWish(item.id, 'targetAmount', roundedTravelTargetAmount)}
                          style={{ flexShrink: 0, border: 'none', borderRadius: 7, backgroundColor: roundedTravelTargetAmount > 0 ? C.purple : '#e5e7eb', color: roundedTravelTargetAmount > 0 ? '#fff' : '#9ca3af', padding: '5px 7px', fontSize: 10, fontWeight: 700, cursor: roundedTravelTargetAmount > 0 ? 'pointer' : 'default' }}
                        >
                          采用 ¥{formatCurrency(roundedTravelTargetAmount)}
                        </button>
                      </div>
                    </div>
                  )}
                  {budgetEstimateVisible && itemTravelDays > 0 && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 5, marginTop: 7 }}>
                      <div style={{ borderRadius: 7, backgroundColor: '#fff', padding: '6px 5px', textAlign: 'center' }}>
                        <div style={{ fontSize: 9, color: C.sub }}>“活”</div>
                        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3, marginTop: 4, color: C.blue, fontSize: 9, fontWeight: 700, whiteSpace: 'nowrap' }}>
                          <span>{formatCurrency(itemTravelLifeAmount)}</span>
                          <span>−</span>
                          <AmountInput
                            aria-label={`${item.name} 活修正额`}
                            value={amountDrafts[lifeCorrectionKey] ?? (item.travelLifeCorrectionAmount ? String(item.travelLifeCorrectionAmount) : '')}
                            onChange={(raw) => updateAmount(item.id, 'travelLifeCorrectionAmount', raw)}
                            onBlur={() => finishAmountEdit(item.id, 'travelLifeCorrectionAmount')}
                            placeholder="0"
                            style={{ width: 40, minWidth: 0, border: 'none', borderBottom: '1px solid #60a5fa', outline: 'none', backgroundColor: 'transparent', textAlign: 'center', fontSize: 9, fontWeight: 700, color: C.blue, padding: 0 }}
                          />
                          <span>=</span>
                          <span>{formatCurrency(itemAdjustedTravelLifeAmount)}</span>
                        </label>
                      </div>
                      <div style={{ borderRadius: 7, backgroundColor: '#fff', padding: '6px 5px', textAlign: 'center' }}>
                        <div style={{ fontSize: 9, color: C.sub }}>日常“消费”</div>
                        <div style={{ marginTop: 2, fontSize: 11, fontWeight: 700, color: C.orange }}>¥{formatCurrency(itemTravelConsumptionAmount)}</div>
                      </div>
                      <div style={{ borderRadius: 7, backgroundColor: '#fff', padding: '6px 5px', textAlign: 'center' }}>
                        <div style={{ fontSize: 9, color: C.sub }}>额外消费 · {itemExtraExpenses.length}笔</div>
                        <div style={{ marginTop: 2, fontSize: 11, fontWeight: 700, color: C.purple }}>{formatSignedWishCurrency(travelEstimate.extraExpenseAmount)}</div>
                      </div>
                      <div style={{ borderRadius: 7, backgroundColor: '#fff', padding: '6px 5px', textAlign: 'center' }}>
                        <div style={{ fontSize: 9, color: C.sub }}>估算目标</div>
                        <div style={{ marginTop: 2, fontSize: 11, fontWeight: 700, color: C.purple }}>¥{formatCurrency(roundedTravelTargetAmount)}</div>
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ height: 6, borderRadius: 999, backgroundColor: '#ede9fe', overflow: 'hidden', marginTop: 12 }}>
                  <div style={{ width: `${progress * 100}%`, height: '100%', borderRadius: 999, backgroundColor: progress >= 1 ? C.green : C.purple, transition: 'width 0.2s' }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 6, fontSize: 10, color: C.sub }}>
                  <span>{item.targetAmount > 0 ? `完成 ${(progress * 100).toFixed(0)}%` : '等待填写目标'}</span>
                  {item.targetAmount > 0 && <span>还差 ¥{formatCurrency(remainingActualWishSavingAmount)}</span>}
                </div>

                <div style={{ marginTop: 10, borderRadius: 10, padding: '8px 9px', backgroundColor: item.deadlineState === 'overdue' && !actualWishSavingCompleted ? '#fef2f2' : actualWishSavingCompleted ? '#ecfdf5' : '#f5f3ff', color: item.deadlineState === 'overdue' && !actualWishSavingCompleted ? C.red : actualWishSavingCompleted ? C.green : C.purple, fontSize: 11, fontWeight: 700, lineHeight: 1.5 }}>
                  {!item.isActive && '已暂停，不计入最少实习规划'}
                  {item.isActive && actualWishSavingCompleted && '✓ 心愿已经攒满'}
                  {item.isActive && !actualWishSavingCompleted && item.deadlineState === 'none' && (remainingActualWishSavingAmount > 0 ? '无 DDL，按自己的节奏慢慢攒' : '填入目标金额后开始计算')}
                  {item.isActive && !actualWishSavingCompleted && item.deadlineState === 'overdue' && `已超期 · 还需补 ¥${formatCurrency(remainingActualWishSavingAmount)}`}
                  {item.isActive && !actualWishSavingCompleted && item.deadlineState === 'scheduled' && remainingActualWishSavingAmount > 0 && (
                    `还剩 ${item.monthsRemaining} 个月 · 截止前还需攒 ¥${formatCurrency(remainingActualWishSavingAmount)}`
                  )}
                  {item.isActive && item.deadlineState === 'scheduled' && item.targetAmount <= 0 && (itemTravelDays > 0 ? '填写机酒价格并采用估算后开始计算' : '填入目标金额后开始计算')}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
      </div>
      </div>
      </div>
    </div>
  );
}
