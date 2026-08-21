import { useMemo } from 'react';
import { tagMeta } from '../data/mockData';
import type { TagKind } from '../models/types';
import type { HolidayDataByYear } from '../utils/holidays';
import { isWorkingDate } from '../utils/payroll';
import type { WishMilestoneAssignment } from '../utils/wishMilestonePlan';

interface HomeWishInternCalendarProps {
  visibleMonth: string;
  minimumMonth: string;
  maximumMonth: string;
  today: string;
  tagMap: Record<string, TagKind>;
  assignments: WishMilestoneAssignment[];
  availableInternDates: readonly string[];
  wishSummaryLabelsById: Record<string, string>;
  travelLabelsByDate: Record<string, string>;
  holidayDataByYear: HolidayDataByYear;
  onToggleWorkingDate: (date: string) => void;
  onPreviousMonth: () => void;
  onNextMonth: () => void;
}

const WEEK_HEADERS = ['一', '二', '三', '四', '五', '六', '日'];
const WISH_COLORS = ['#7c3aed', '#db2777', '#ea580c', '#2563eb', '#0891b2', '#65a30d'];

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function stripMonthPrefix(value: string): string {
  return value.replace(/^\d{2}\.\d{1,2}(?:\.\d{1,2})?\s*/, '').trim() || value;
}

function assignmentLabel(assignment: WishMilestoneAssignment, index: number): string {
  return assignment.wishNames.map(stripMonthPrefix).join('、') || `心愿 ${index + 1}`;
}

function assignmentSummaryLabel(
  assignment: WishMilestoneAssignment,
  index: number,
  wishSummaryLabelsById: Record<string, string>,
): string {
  const labels = assignment.wishIds
    .map((wishId) => wishSummaryLabelsById[wishId])
    .filter(Boolean);
  return labels.join('、') || assignmentLabel(assignment, index);
}

export default function HomeWishInternCalendar({
  visibleMonth,
  minimumMonth,
  maximumMonth,
  today,
  tagMap,
  assignments,
  availableInternDates,
  wishSummaryLabelsById,
  travelLabelsByDate,
  holidayDataByYear,
  onToggleWorkingDate,
  onPreviousMonth,
  onNextMonth,
}: HomeWishInternCalendarProps) {
  const [year, month] = visibleMonth.split('-').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstWeekdayIndex = (new Date(year, month - 1, 1).getDay() + 6) % 7;
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
  const assignmentByDate = useMemo(() => {
    const result = new Map<string, { label: string; color: string }>();
    assignments.forEach((assignment, index) => {
      const label = assignmentLabel(assignment, index);
      const color = WISH_COLORS[index % WISH_COLORS.length];
      for (const date of assignment.dateKeys) result.set(date, { label, color });
    });
    return result;
  }, [assignments]);
  const monthAssignments = useMemo(() => assignments.map((assignment, index) => ({
    deadline: assignment.deadline,
    label: assignmentSummaryLabel(assignment, index, wishSummaryLabelsById),
    color: WISH_COLORS[index % WISH_COLORS.length],
    count: assignment.dateKeys.filter((date) => date.startsWith(`${visibleMonth}-`)).length,
  })).filter((assignment) => assignment.count > 0), [assignments, visibleMonth, wishSummaryLabelsById]);
  const monthInternDays = monthAssignments.reduce((sum, assignment) => sum + assignment.count, 0);
  const monthAvailableInternDays = useMemo(
    () => availableInternDates.filter((date) => date.startsWith(`${visibleMonth}-`)).length,
    [availableInternDates, visibleMonth],
  );
  const isFullPowerMonth = monthAvailableInternDays > 0
    && monthInternDays >= monthAvailableInternDays;

  return (
    <section className="home-wish-calendar" aria-label={`${year}年${month}月日历`}>
      <div className="home-wish-calendar-header">
        <div>
          <h2>日历</h2>
          <span>
            {year}年{month}月
            {isFullPowerMonth ? ' · 火力全开' : monthInternDays > 0 ? ` · 本月最少${monthInternDays}天` : ''}
          </span>
        </div>
        <div className="home-wish-calendar-actions">
          <button
            type="button"
            aria-label="上一个月"
            disabled={visibleMonth <= minimumMonth}
            onClick={onPreviousMonth}
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="下一个月"
            disabled={visibleMonth >= maximumMonth}
            onClick={onNextMonth}
          >
            ›
          </button>
        </div>
      </div>

      {monthAssignments.length > 0 ? (
        <div className="home-wish-calendar-counts" aria-label={isFullPowerMonth ? '本月火力全开心愿' : '本月各心愿最少实习天数'}>
          {monthAssignments.map((assignment) => (
            <span
              key={`${assignment.deadline}-${assignment.label}`}
              title={isFullPowerMonth ? `${assignment.label} · 火力全开` : `${assignment.label} · 本月最少实习${assignment.count}天`}
            >
              <i style={{ backgroundColor: assignment.color }} />
              <b>{assignment.label}</b>
              {isFullPowerMonth ? null : `最少${assignment.count}天`}
            </span>
          ))}
        </div>
      ) : null}

      <div className="home-wish-calendar-legend">
        <span><b className="wish-holiday-off">休</b>法定节假日</span>
        <span><b className="wish-holiday-work">班</b>调休上班</span>
      </div>

      <div className="home-wish-calendar-weekdays" aria-hidden="true">
        {WEEK_HEADERS.map((label, index) => (
          <span key={label} className={index >= 5 ? 'wish-calendar-weekend' : ''}>{label}</span>
        ))}
      </div>

      <div className="home-wish-calendar-grid">
        {cells.map((cell, index) => {
          if (cell.day === null) return <span key={cell.key} className="home-wish-calendar-empty" />;
          const weekend = index % 7 >= 5;
          const holiday = holidayDataByYear[year]?.[cell.key];
          const isStatutoryHoliday = holiday?.isOffDay === true;
          const isAdjustedWorkday = holiday?.isOffDay === false && weekend;
          const holidayMarker = isStatutoryHoliday ? '休' : isAdjustedWorkday ? '班' : null;
          const assignment = assignmentByDate.get(cell.key);
          const displayTag: TagKind = tagMap[cell.key] ?? 'school';
          const meta = tagMeta[displayTag];
          const travelLabel = displayTag === 'travel' ? travelLabelsByDate[cell.key] : '';
          const dateLabel = travelLabel || assignment?.label || '';
          const dateLabelPrefix = travelLabel ? '行程' : '为了';
          const canToggleWorkingDate = displayTag !== 'home'
            && displayTag !== 'travel'
            && isWorkingDate(cell.key, holidayDataByYear);
          const markerLabel = holidayMarker
            ? `，${holiday?.name ?? '法定节假日'}，${holidayMarker === '休' ? '休假' : '调休上班'}`
            : '';
          return (
            <button
              type="button"
              key={cell.key}
              className="home-wish-calendar-day"
              aria-label={`${cell.key}，${meta.label}${dateLabel ? `，${dateLabelPrefix}${dateLabel}` : ''}${markerLabel}${canToggleWorkingDate ? `，点击切换为${displayTag === 'intern' ? '上学' : '实习'}` : ''}`}
              title={`${cell.key} · ${meta.label}${dateLabel ? ` · ${dateLabel}` : ''}${holidayMarker ? ` · ${holiday?.name ?? holidayMarker}` : ''}`}
              disabled={!canToggleWorkingDate}
              onClick={() => onToggleWorkingDate(cell.key)}
              style={{
                color: meta.color,
                backgroundColor: `${meta.color}18`,
                boxShadow: cell.key === today
                  ? 'inset 0 0 0 2px #1a73e8'
                  : assignment
                    ? `inset 0 0 0 1px ${assignment.color}66`
                    : 'none',
              }}
            >
              <strong>{cell.day}</strong>
              <small>{meta.icon}</small>
              {dateLabel ? <em style={{ color: travelLabel ? meta.color : assignment?.color }}>{dateLabel}</em> : null}
              {holidayMarker ? (
                <b className={holidayMarker === '休' ? 'wish-holiday-off' : 'wish-holiday-work'}>{holidayMarker}</b>
              ) : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}
