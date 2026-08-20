import { memo, useCallback, useMemo, useState } from 'react';
import { formatCurrency } from './CurrencyDisplay';
import type { WishTimelineEntry } from '../utils/wishTimeline';

interface WishTimelineProps {
  entries: WishTimelineEntry[];
}

interface TimelineTooltip {
  entry: WishTimelineEntry;
  x: number;
  y: number;
}

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function parseDateKey(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function compactDateLabel(value: string): string {
  const date = parseDateKey(value);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function fullDateLabel(value: string): string {
  const date = parseDateKey(value);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${WEEKDAY_LABELS[date.getDay()]}`;
}

interface TimelineTeethProps {
  entries: WishTimelineEntry[];
  maximumAmount: number;
  onHide: () => void;
  onShow: (entry: WishTimelineEntry, element: HTMLElement) => void;
}

const TimelineTeeth = memo(function TimelineTeeth({ entries, maximumAmount, onHide, onShow }: TimelineTeethProps) {
  return entries.map((entry, index) => {
    const ratio = maximumAmount > 0 ? Math.sqrt(entry.amount / maximumAmount) : 0;
    const toothLength = 9 + Math.round(ratio * 48);
    const toothThickness = 1 + Math.round(ratio * 4);
    const startsMonth = index === 0 || entry.date.slice(0, 7) !== entries[index - 1].date.slice(0, 7);
    const accessibleLabel = `${fullDateLabel(entry.date)}，${entry.itinerary}，预计 ${formatCurrency(entry.amount)} 元`;
    return (
      <div
        key={entry.date}
        className={`wish-timeline-row${startsMonth ? ' wish-timeline-row--month' : ''}`}
        style={{ minHeight: Math.max(toothThickness + 1, 3) }}
      >
        {startsMonth ? <span className="wish-timeline-month">{Number(entry.date.slice(5, 7))}月</span> : null}
        <button
          type="button"
          className="wish-timeline-tooth"
          aria-label={accessibleLabel}
          onMouseEnter={(event) => onShow(entry, event.currentTarget)}
          onMouseLeave={onHide}
          onFocus={(event) => onShow(entry, event.currentTarget)}
          onBlur={onHide}
          style={{
            width: toothLength,
            height: toothThickness,
            backgroundColor: entry.color,
          }}
        />
      </div>
    );
  });
});

export default function WishTimeline({ entries }: WishTimelineProps) {
  const [tooltip, setTooltip] = useState<TimelineTooltip | null>(null);
  const maximumAmount = useMemo(() => {
    let result = 0;
    for (const entry of entries) result = Math.max(result, entry.amount);
    return result;
  }, [entries]);

  const showTooltip = useCallback((entry: WishTimelineEntry, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const y = Math.min(Math.max(rect.top + rect.height / 2, 42), window.innerHeight - 42);
    setTooltip({ entry, x: rect.right + 8, y });
  }, []);
  const hideTooltip = useCallback(() => setTooltip(null), []);

  if (entries.length === 0) return null;

  return (
    <aside className="wish-timeline" aria-label="心愿规划时间轴">
      <div className="wish-timeline-range">{compactDateLabel(entries[0].date)}</div>
      <div className="wish-timeline-scroll">
        <div className="wish-timeline-axis" aria-hidden="true" />
        <TimelineTeeth
          entries={entries}
          maximumAmount={maximumAmount}
          onHide={hideTooltip}
          onShow={showTooltip}
        />
      </div>
      <div className="wish-timeline-range">{compactDateLabel(entries[entries.length - 1].date)}</div>
      {tooltip ? (
        <div
          className="wish-timeline-tooltip"
          role="tooltip"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <div className="wish-timeline-tooltip-date">{fullDateLabel(tooltip.entry.date)}</div>
          <div className="wish-timeline-tooltip-detail">
            <span style={{ backgroundColor: tooltip.entry.color }} />
            {tooltip.entry.itinerary}
          </div>
          <div className="wish-timeline-tooltip-amount">预计 ¥{formatCurrency(tooltip.entry.amount)}</div>
        </div>
      ) : null}
    </aside>
  );
}
