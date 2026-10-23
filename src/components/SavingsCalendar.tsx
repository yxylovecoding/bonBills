import { wishTripStarts } from '../utils/wishAssociations';
import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import HomeWishInternCalendar from './HomeWishInternCalendar';
import { useSnapshotStore } from '../stores/snapshotStore';
import { useConfigStore } from '../stores/configStore';
import { useMonthlyStore } from '../stores/monthlyStore';
import { useCalendarStore } from '../stores/calendarStore';
import { useBillDetailStore } from '../stores/billDetailStore';
import { useExpenseScopeOverrideStore } from '../stores/expenseScopeOverrideStore';
import { useTripStore } from '../stores/tripStore';
import { useLifeCalendar } from '../hooks/useLifeCalendar';
import { calcHistoryStats } from '../calculations/history';
import { useHolidayYears } from '../utils/holidays';
import { resolveDailyContext } from '../utils/internship';
import { calculateCreditRepaymentPlan, getPlanningLongBondTotal } from '../utils/creditRepayment';
import { detectAllTrips } from '../utils/trips';
import { getTripDisplayTitle } from '../utils/outlookCalendar';
import { calculateWishMilestonePlan, type WishRepaymentDue } from '../utils/wishMilestonePlan';
import { calculateWishFunding, resolveWishRepayments, resolveWishBillSpending, wishTravelLifeAmount } from '../utils/wishes';
const EMPTY_DATE_KEYS: string[] = [];

function offsetYearMonth(date: Date, offset: number): string {
  const target = new Date(date.getFullYear(), date.getMonth() + offset, 1);
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}`;
}

function offsetMonthKey(value: string, offset: number): string {
  const [year, month] = value.split('-').map(Number);
  const target = new Date(year, month - 1 + offset, 1);
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}`;
}

function dateInMonth(value: string, requestedDay: number): string {
  const [year, month] = value.split('-').map(Number);
  const day = Math.min(requestedDay, new Date(year, month, 0).getDate());
  return `${value}-${String(day).padStart(2, '0')}`;
}

export default function SavingsCalendar({ onBack }: { onBack: () => void }) {
  const navigate = useNavigate();
  const { current } = useSnapshotStore();
  const { config } = useConfigStore();
  const { records } = useMonthlyStore();
  const { confirmedExpenses, setTag, outlookTravelTitles } = useCalendarStore();
  const { tagMap, internship } = useLifeCalendar();
  const { expenseItems } = useBillDetailStore();
  const { overrides: expenseScopeOverrides } = useExpenseScopeOverrideStore();
  const { tripTags, tripNotes, tripSplits } = useTripStore();

  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth();
  const todayKey = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const currentYearMonth = todayKey.slice(0, 7);
  const allTripSegments = useMemo(() => detectAllTrips(tagMap, tripSplits), [tagMap, tripSplits]);
  const wishes = useMemo(
    () => resolveWishRepayments(
      resolveWishBillSpending(
        config.wishes ?? [],
        allTripSegments, tripTags, expenseItems, todayKey,
      ),
      config.wishDebtTotal,
    ),
    [config.wishes, config.wishDebtTotal, allTripSegments, tripTags, expenseItems, todayKey],
  );
  const wishInternSavingRecords = config.wishInternSavingRecords ?? [];
  const twoYearsAgo = `${today.getFullYear() - 1}-01`;
  const filteredRecords = useMemo(
    () => records.filter((r) => r.yearMonth >= twoYearsAgo),
    [records, twoYearsAgo],
  );
  const stats = useMemo(
    () => calcHistoryStats(filteredRecords, tagMap, confirmedExpenses, expenseItems, expenseScopeOverrides, tripTags, internship),
    [filteredRecords, tagMap, confirmedExpenses, expenseItems, expenseScopeOverrides, tripTags, internship],
  );
  const tripDatesByStart = useMemo(
    () => Object.fromEntries(allTripSegments.map((trip) => [trip.startDate, trip.dates])),
    [allTripSegments],
  );
  const latestWishDeadline = wishes
    .filter((wish) => wish.isActive && wish.deadline && wish.deadline >= todayKey && calculateWishFunding(wish, wishTravelLifeAmount(wish, stats.stateDailyAvg.travel, tripDatesByStart)).remainingAmount > 0)
    .reduce((latest, wish) => wish.deadline && wish.deadline > latest ? wish.deadline : latest, todayKey);
  const wishPlanningEndYear = Math.max(Number(latestWishDeadline.slice(0, 4)) || currentYear, currentYear);
  const holidayYears = useMemo(
    () => Array.from(
      { length: Math.min(wishPlanningEndYear - currentYear + 2, 21) },
      (_, index) => currentYear - 1 + index,
    ),
    [currentYear, wishPlanningEndYear],
  );
  const { holidayDataByYear, holidayWarning } = useHolidayYears(holidayYears);
  const [wishCalendarMonth, setWishCalendarMonth] = useState(currentYearMonth);

  const wishSummaryLabelsById = useMemo(() => Object.fromEntries(wishes.map((wish) => {
    const date = wish.linkedTripStartDate || wish.deadline || '';
    const compactName = wish.name.replace(/^\d{2}\.\d{1,2}(?:\.\d{1,2})?\s*/, '').trim() || wish.name;
    const monthPrefix = date
      ? `${date.slice(2, 4)}.${Number(date.slice(5, 7))}`
      : '';
    return [wish.id, `${monthPrefix}${compactName}`];
  })), [wishes]);
  const travelLabelsByDate = useMemo(() => {
    const labels: Record<string, string> = {};
    const wishesByTripStart = new Map<string, string[]>();
    for (const wish of wishes) {
      if (!wish.name.trim()) continue;
      for (const start of wishTripStarts(wish)) {
        const names = wishesByTripStart.get(start) ?? [];
        names.push(wish.name.trim());
        wishesByTripStart.set(start, names);
      }
    }
    for (const trip of allTripSegments) {
      const wishLabel = wishesByTripStart.get(trip.startDate)?.join('、') ?? '';
      const rawTripLabel = getTripDisplayTitle(tripTags[trip.startDate], trip.dates, outlookTravelTitles);
      const rawLabel = rawTripLabel || wishLabel || tripNotes[trip.startDate]?.trim() || '出游';
      const compactLabel = rawLabel.replace(/^\d{2}\.\d{1,2}(?:\.\d{1,2})?\s*/, '').trim() || rawLabel;
      for (const date of trip.dates) labels[date] = compactLabel;
    }
    return labels;
  }, [allTripSegments, tripNotes, tripTags, wishes, outlookTravelTitles]);
  const {
    effectiveCreditMonthly: currentCreditDue,
    effectiveCreditNext: nextCreditDue,
  } = calculateCreditRepaymentPlan({
    creditMonthly: current.accounts.creditMonthly,
    creditTotal: current.accounts.credit,
    savingsCard: current.accounts.savingsCard,
    longBond: getPlanningLongBondTotal(records, currentYearMonth, current.investHoldings.longBond),
  });
  const configuredBillDay = Math.min(Math.max(Math.round(config.creditBillDate || config.creditPayDate || 1), 1), 31);
  const daysThisMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const currentDueOffset = today.getDate() <= Math.min(configuredBillDay, daysThisMonth) ? 0 : 1;
  const currentDueMonth = offsetYearMonth(today, currentDueOffset);
  const nextDueMonth = offsetYearMonth(today, currentDueOffset + 1);
  const repaymentDues = useMemo<WishRepaymentDue[]>(() => [
    {
      date: dateInMonth(currentDueMonth, configuredBillDay),
      yearMonth: currentDueMonth,
      amount: currentCreditDue,
    },
    {
      date: dateInMonth(nextDueMonth, configuredBillDay),
      yearMonth: nextDueMonth,
      amount: nextCreditDue,
    },
  ], [configuredBillDay, currentCreditDue, currentDueMonth, nextCreditDue, nextDueMonth]);
  const wishMilestonePlan = useMemo(
    () => calculateWishMilestonePlan({
      today,
      wishes,
      incomeItems: config.incomeItems, recurringIncomeBaseline: config.recurringIncomeBaseline, raiseSavings: config.raiseSavings,
      internship, cityLivingStats: stats.cityLivingStats,
      tagMap,
      stateDailyAvg: stats.stateDailyAvg,
      repaymentDues,
      holidayDataByYear,
      tripDatesByStart,
    }),
    // todayKey 每日变化一次，避免 Date 实例导致无意义的重复计算。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [internship, stats.cityLivingStats, config.incomeItems, config.recurringIncomeBaseline, config.raiseSavings, holidayDataByYear, wishes, repaymentDues, stats.stateDailyAvg, tagMap, todayKey, tripDatesByStart],
  );
  const maximumWishCalendarMonth = latestWishDeadline.slice(0, 7);
  const visibleWishCalendarMonth = wishCalendarMonth < currentYearMonth
    ? currentYearMonth
    : wishCalendarMonth > maximumWishCalendarMonth
      ? maximumWishCalendarMonth
      : wishCalendarMonth;
  const toggleWishCalendarWorkingDate = useCallback((date: string) => {
    const currentTag = tagMap[date];
    if (currentTag === 'home' || currentTag === 'travel') return;
    setTag(date, resolveDailyContext(date, currentTag, internship).working ? 'school' : 'intern');
  }, [setTag, tagMap, internship]);

  return <div style={{ maxWidth: 720, margin: '0 auto' }}>
    <button type="button" onClick={onBack} style={{ border: 0, background: 'transparent', color: '#7c3aed', padding: '8px 0', cursor: 'pointer' }}>← 返回心愿</button>
    {holidayWarning && <p role="status" style={{ color: '#b45309', fontSize: 12 }}>{holidayWarning}</p>}
      <HomeWishInternCalendar
        visibleMonth={visibleWishCalendarMonth}
        minimumMonth={currentYearMonth}
        maximumMonth={maximumWishCalendarMonth}
        today={todayKey}
        tagMap={tagMap}
        assignments={wishMilestonePlan.assignments}
        internSavingRecords={wishInternSavingRecords}
        availableInternDates={wishMilestonePlan.segments[wishMilestonePlan.segments.length - 1]?.availableInternDateKeys ?? EMPTY_DATE_KEYS}
        wishSummaryLabelsById={wishSummaryLabelsById}
        wishNamesById={Object.fromEntries(wishes.filter((wish) => wish.isActive).flatMap((wish) => [wish.id, ...(wish.mergedWishIds ?? [])].map((id) => [id, wish.name])))}
        travelLabelsByDate={travelLabelsByDate}
        holidayDataByYear={holidayDataByYear}
        internship={internship}
        onToggleWorkingDate={toggleWishCalendarWorkingDate}
        onOpenMonth={(yearMonth) => navigate(`/calendar?tab=month&month=${yearMonth}&focus=calendar`)}
        onPreviousMonth={() => {
          if (visibleWishCalendarMonth > currentYearMonth) {
            setWishCalendarMonth(offsetMonthKey(visibleWishCalendarMonth, -1));
          }
        }}
        onNextMonth={() => {
          if (visibleWishCalendarMonth < maximumWishCalendarMonth) {
            setWishCalendarMonth(offsetMonthKey(visibleWishCalendarMonth, 1));
          }
        }}
      />

  </div>;
}
