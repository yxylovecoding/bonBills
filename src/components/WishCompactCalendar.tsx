import { useMemo } from 'react';
import { tagMeta } from '../data/mockData';
import type { TagKind } from '../models/types';
import type { ConfirmedExpenseSelection } from '../stores/calendarStore';
import type { HolidayDataByYear } from '../utils/holidays';
import { getPayrollScheduleForMonth } from '../utils/payroll';

interface WishCompactCalendarProps {
  visibleMonth: string;
  minimumMonth: string;
  maximumMonth: string;
  intervalStartDate: string;
  intervalEndDate: string;
  highlightedStartDate: string;
  highlightedEndDate: string;
  today: string;
  tagMap: Record<string, TagKind>;
  scheduledInternDates: string[];
  confirmedExpenses: Record<string, ConfirmedExpenseSelection>;
  holidayDataByYear: HolidayDataByYear;
  showPayrollCutoffMarkers: boolean;
  onPreviousMonth: () => void;
  onNextMonth: () => void;
}

const WEEK_HEADERS = ['一', '二', '三', '四', '五', '六', '日'];

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function compactDate(value: string): string {
  return `${Number(value.slice(5, 7))}/${Number(value.slice(8, 10))}`;
}

export default function WishCompactCalendar({
  visibleMonth,
  minimumMonth,
  maximumMonth,
  intervalStartDate,
  intervalEndDate,
  highlightedStartDate,
  highlightedEndDate,
  today,
  tagMap,
  scheduledInternDates,
  confirmedExpenses,
  holidayDataByYear,
  showPayrollCutoffMarkers,
  onPreviousMonth,
  onNextMonth,
}: WishCompactCalendarProps) {
  const [year, month] = visibleMonth.split('-').map(Number);
  const month0 = month - 1;
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstWeekdayIndex = (new Date(year, month0, 1).getDay() + 6) % 7;
  const scheduledInternSet = useMemo(() => new Set(scheduledInternDates), [scheduledInternDates]);
  const payrollCutoffDate = useMemo(
    () => getPayrollScheduleForMonth(year, month0, holidayDataByYear).cutoffDate,
    [holidayDataByYear, month0, year],
  );
  const cells = useMemo(() => {
    const result: Array<{ key: string; day: number | null }> = [];
    for (let index = 0; index < firstWeekdayIndex; index += 1) {
      result.push({ key: `empty-${index}`, day: null });
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      result.push({ key: `${visibleMonth}-${pad(day)}`, day });
    }
    while (result.length < 42) result.push({ key: `tail-${result.length}`, day: null });
    return result;
  }, [daysInMonth, firstWeekdayIndex, visibleMonth]);

  const canGoPrevious = visibleMonth > minimumMonth;
  const canGoNext = visibleMonth < maximumMonth;

  return (
    <section className="wish-compact-calendar" aria-label={`${year}年${month}月心愿规划月历`}>
      <div className="wish-compact-calendar-header">
        <div>
          <div className="wish-compact-calendar-title">{year}年{month}月</div>
          <div className="wish-compact-calendar-range">
            当前区间 {compactDate(intervalStartDate)}–{compactDate(intervalEndDate)}
          </div>
        </div>
        <div className="wish-compact-calendar-actions">
          <button
            type="button"
            aria-label="上一个涉及月份"
            disabled={!canGoPrevious}
            onClick={onPreviousMonth}
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="下一个涉及月份"
            disabled={!canGoNext}
            onClick={onNextMonth}
          >
            ›
          </button>
        </div>
      </div>

      <div className="wish-compact-calendar-legend">
        <span><b className="wish-holiday-off">休</b>法定节假日</span>
        <span><b className="wish-holiday-work">班</b>调休上班</span>
      </div>

      <div className="wish-compact-calendar-weekdays" aria-hidden="true">
        {WEEK_HEADERS.map((label, index) => (
          <span key={label} className={index >= 5 ? 'wish-calendar-weekend' : ''}>{label}</span>
        ))}
      </div>

      <div className="wish-compact-calendar-grid">
        {cells.map((cell, index) => {
          if (cell.day === null) return <span key={cell.key} className="wish-compact-calendar-empty" />;
          const weekend = index % 7 >= 5;
          const holiday = holidayDataByYear[year]?.[cell.key];
          const isStatutoryHoliday = holiday?.isOffDay === true;
          const isAdjustedWorkday = holiday?.isOffDay === false && weekend;
          const holidayMarker = isStatutoryHoliday ? '休' : isAdjustedWorkday ? '班' : null;
          const displayTag: TagKind = scheduledInternSet.has(cell.key)
            ? 'intern'
            : tagMap[cell.key] ?? 'school';
          const meta = tagMeta[displayTag];
          const inInterval = cell.key >= intervalStartDate && cell.key <= intervalEndDate;
          const inHighlightedRange = cell.key >= highlightedStartDate && cell.key <= highlightedEndDate;
          const confirmed = confirmedExpenses[cell.key];
          const hasConfirmed = Boolean(confirmed?.reviewed);
          const isZeroConfirmed = hasConfirmed
            && confirmed.localIds.length === 0
            && (confirmed.sharedIds?.length ?? 0) === 0;
          const isToday = cell.key === today;
          const isPayrollCutoff = showPayrollCutoffMarkers && cell.key === payrollCutoffDate;
          const backgroundColor = `${meta.color}20`;
          const markerLabel = holidayMarker
            ? `，${holiday?.name ?? '法定节假日'}，${holidayMarker === '休' ? '休假' : '调休上班'}`
            : '';
          return (
            <span
              key={cell.key}
              className="wish-compact-calendar-day"
              aria-label={`${cell.key}，${meta.label}${markerLabel}`}
              title={`${cell.key} · ${meta.label}${holidayMarker ? ` · ${holiday?.name ?? holidayMarker}` : ''}`}
              style={{
                color: meta.color,
                backgroundColor,
                opacity: inInterval ? 1 : 0.32,
                boxShadow: inHighlightedRange
                  ? 'inset 0 0 0 1.5px #7c3aed'
                  : isToday
                    ? 'inset 0 0 0 1.5px #1a73e8'
                    : 'none',
              }}
            >
              {hasConfirmed ? (
                <i className={`wish-compact-calendar-confirmed${isZeroConfirmed ? ' wish-compact-calendar-confirmed--zero' : ''}`} />
              ) : null}
              <span>{cell.day}</span>
              <small>{meta.icon}</small>
              {(isPayrollCutoff || holidayMarker) ? (
                <em>
                  {isPayrollCutoff ? <b className="wish-payroll-cutoff">截</b> : null}
                  {holidayMarker ? (
                    <b className={holidayMarker === '休' ? 'wish-holiday-off' : 'wish-holiday-work'}>{holidayMarker}</b>
                  ) : null}
                </em>
              ) : null}
            </span>
          );
        })}
      </div>
    </section>
  );
}
