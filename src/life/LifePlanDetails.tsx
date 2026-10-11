import type { TickTickPlanDetails } from '../utils/tickTickPlanDetails';

const minuteText = (value: number) => `${Number(value.toFixed(1))} 分钟`;
const when = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const time = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false });
const MINUTE = 60_000;
// Union of Outlook event intervals clipped to the remaining排期 windows.
// Derived at display time so legacy cached briefings — whose stored
// `occupiedMinutes` wrongly also includes TickTick task intervals — stay
// consistent with the per-event list shown below.
function outlookOccupancyMinutes(
  events: { start: string; end: string }[] | undefined,
  windows: { start: string; end: string }[] | undefined,
): number {
  if (!events?.length || !windows?.length) return 0;
  const win = windows.map(w => [Date.parse(w.start), Date.parse(w.end)] as [number, number]);
  let busy = events.map(e => [Date.parse(e.start), Date.parse(e.end)] as [number, number]);
  // Merge overlapping/adjacent busy intervals so the union is counted once.
  busy = busy.filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s).sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [s, e] of busy) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  let total = 0;
  for (const [ws, we] of win) for (const [bs, be] of merged) {
    const overlap = Math.min(we, be) - Math.max(ws, bs);
    if (overlap > 0) total += overlap;
  }
  return Math.floor(total / MINUTE);
}

export default function LifePlanDetails({ plan }: { plan: TickTickPlanDetails }) {
  const b = plan.breakdown;
  const plannedMinutes = plan.selected.reduce((sum, task) => sum + task.minutes, 0);
  const outlookOccupied = b ? outlookOccupancyMinutes(b.calendarEvents, b.remainingWindows) : 0;
  const occupiedMinutes = b ? Math.min(b.occupiedMinutes, outlookOccupied) : 0;
  const freeMinutes = b ? Math.max(0, b.windowMinutes - occupiedMinutes) : 0;
  // Legacy cached briefings may have inflated `occupiedMinutes` by also deducting unmatched
  // TickTick task intervals. Propagate the delta into the final capacity so it stays
  // consistent with the recomputed `freeMinutes` above.
  const delta = b ? Math.max(0, b.occupiedMinutes - occupiedMinutes) : 0;
  const importantTotalMinutes = b ? b.important.reduce((sum, task) => sum + task.minutes, 0) : 0;
  const freeAfterImportantMinutes = b ? Math.max(0, freeMinutes - importantTotalMinutes) : 0;
  const newTaskCapacityMinutes = b ? Math.max(0, b.newTaskCapacityMinutes + delta - importantTotalMinutes) : 0;
  return <div className="life-plan-details" id="life-plan-details" role="region" aria-label="排期详情">
    <p className="life-plan-meta">{when.format(new Date(plan.generatedAt))} 排期快照 · 北京时间</p>
    {b ? <section aria-label="剩余可排期时间">
        <dl className="life-plan-ledger">
          <div><dt>可排期时间</dt><dd>{minuteText(b.windowMinutes)}</dd></div>
        </dl>
        <details className="life-plan-collapsible">
          <summary><span>Outlook 日程 · 共 {b.calendarEvents?.length ?? 0} 项 · 约 {minuteText(occupiedMinutes)}</span></summary>
          {b.calendarEvents?.length ? <ul className="life-plan-tasks">{b.calendarEvents.map((event, index) => <li key={`${event.start}:${event.title}:${index}`}>
            <div><span>{event.title || '未命名日程'}</span><span>{minuteText(event.overlapMinutes)}</span></div>
            <p>{time.format(new Date(event.start))}—{time.format(new Date(event.end))}</p>
          </li>)}</ul> : <p className="life-plan-meta">暂无 Outlook 日程。</p>}
        </details>
        <dl className="life-plan-ledger">
          <div className="life-plan-subtotal"><dt>扣除日程后剩余</dt><dd>{minuteText(freeMinutes)}</dd></div>
        </dl>
        <details className="life-plan-collapsible">
          <summary><span>今日重要之事 · 共 {b.important.length} 项 · 约 {minuteText(importantTotalMinutes)}</span></summary>
          {b.important.length ? <ul className="life-plan-tasks">{b.important.map(task => <li key={`${task.projectId}:${task.id}`}>
            <div><span>{task.title}</span><span>{minuteText(task.minutes)}</span></div>
          </li>)}</ul> : <p className="life-plan-meta">本次没有未完成的重要事项。</p>}
        </details>
        <dl className="life-plan-ledger">
          <div className="life-plan-subtotal"><dt>扣除今日重要之事后剩余</dt><dd>{minuteText(freeAfterImportantMinutes)}</dd></div>
          <div className="life-plan-subtotal"><dt>本轮可新增安排</dt><dd>{minuteText(newTaskCapacityMinutes)}</dd></div>
        </dl>
      </section> : <p className="life-plan-meta">这次排期未记录时间明细；任务完成重排后可查看。</p>}
    <section aria-label="排入今日事的任务"><h3>排入今日事 · {plan.selected.length} 项 · 约 {minuteText(plannedMinutes)}</h3>
      {plan.selected.length ? <ul className="life-plan-tasks">{plan.selected.map(task => <li key={`${task.projectId}:${task.id}`}>
        <div><span>{task.title}</span><span>{minuteText(task.minutes)}</span></div>
      </li>)}</ul> : <p className="life-plan-meta">本次没有安排普通今日事。</p>}
    </section>
  </div>;
}
