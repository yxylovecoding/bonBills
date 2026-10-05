import type { TickTickPlanDetails } from '../utils/tickTickPlanDetails';

const minuteText = (value: number) => `${Number(value.toFixed(1))} 分钟`;
const when = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const time = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false });

export default function LifePlanDetails({ plan }: { plan: TickTickPlanDetails }) {
  const b = plan.breakdown;
  const plannedMinutes = plan.selected.reduce((sum, task) => sum + task.minutes, 0);
  return <div className="life-plan-details" id="life-plan-details" role="region" aria-label="排期详情">
    <p className="life-plan-meta">{when.format(new Date(plan.generatedAt))} 排期快照 · 北京时间</p>
    {b ? <>
      <section aria-label="今天剩余时间"><h3>今天剩余时间</h3>
        <dl className="life-plan-ledger">
          <div><dt>距离今天 24:00</dt><dd>{minuteText(b.clockRemainingMinutes)}</dd></div>
          <div><dt>可排期时段内剩余</dt><dd>{minuteText(b.windowMinutes)}</dd></div>
          <div><dt>日程、定时事项及出行占用</dt><dd>− {minuteText(b.occupiedMinutes)}</dd></div>
          <div className="life-plan-subtotal"><dt>扣除后空闲</dt><dd>{minuteText(b.freeMinutes)}</dd></div>
        </dl>
        <p className="life-plan-meta">本次可排期时段：{b.remainingWindows.length ? b.remainingWindows.map(window => `${time.format(new Date(window.start))}—${time.format(new Date(window.end))}`).join('、') : '今天已无剩余时段'}</p>
      </section>
      <section aria-label="今日重要之事占用"><h3>今日重要之事 · {b.important.length} 项 · 约 {minuteText(b.important.reduce((sum, task) => sum + task.minutes, 0))}</h3>
        {b.important.length ? <ul className="life-plan-tasks">{b.important.map(task => <li key={`${task.projectId}:${task.id}`}>
          <div><span>{task.title}</span><span>{minuteText(task.minutes)}</span></div>
          <p>{task.durationBasis}；{b.importantReservationEnabled === false ? '不额外预留时间' : task.additionalMinutes ? `另需预留 ${minuteText(task.additionalMinutes)}` : '已有日程或定时安排，不重复预留'}</p>
        </li>)}</ul> : <p className="life-plan-meta">本次没有未完成的重要事项。</p>}
      </section>
      <section aria-label="剩余时间的分配"><h3>留给今日事的时间</h3>
        <dl className="life-plan-ledger">
          <div><dt>扣除日程后的空闲</dt><dd>{minuteText(b.freeMinutes)}</dd></div>
          {b.importantReservationEnabled !== false && <div><dt>重要之事另需预留</dt><dd>− {minuteText(b.importantAdditionalMinutes)}</dd></div>}
          <div><dt>原定今日事另需预留</dt><dd>− {minuteText(b.fixedAdditionalMinutes)}</dd></div>
          <div><dt>预留后剩余</dt><dd>{minuteText(b.afterReservationsMinutes)}</dd></div>
          {b.bufferMinutes > 0 && <div><dt>休息与缓冲</dt><dd>− {minuteText(b.bufferMinutes)}</dd></div>}
          <div><dt>本日额度及已完成用时扣减</dt><dd>− {minuteText(b.dailyLimitReductionMinutes)}</dd></div>
          <div className="life-plan-subtotal"><dt>本轮可新增安排</dt><dd>{minuteText(b.newTaskCapacityMinutes)}</dd></div>
        </dl>
        <p className="life-plan-meta">日用时上限：{b.dailyLimitMinutes === null ? '自动' : minuteText(b.dailyLimitMinutes)}；今日已完成普通任务约 {minuteText(b.completedTodayMinutes)}。{b.allocationRatio < 1 ? `空闲预留后，取 ${b.allocationRatio * 100}% 用于待办，其余留作休息与缓冲。` : ''}</p>
        {b.importantReservationEnabled === false && <p className="life-plan-meta">11:00–14:00、18:00–20:00 为吃饭与休息时段；其余空档不再额外预留休息或重要待办用时。</p>}
        {b.importantAdditionalMinutes + b.fixedAdditionalMinutes > b.freeMinutes && <p className="life-plan-meta">重要及原定事项超出空闲 {minuteText(b.importantAdditionalMinutes + b.fixedAdditionalMinutes - b.freeMinutes)}，新增额度按 0 计算。</p>}
        <p className="life-plan-meta">{b.selectionMode === 'remaining-time'
          ? '按周期紧迫程度及最久未完成优先挑选，可从明日事补入；任务须满足场景、连续空档及喷雾错开规则。'
          : `按周期分摊，本轮新增挑选目标 ${minuteText(b.cycleTargetMinutes)}；任务还须满足场景、连续空档及喷雾错开规则。`}</p>
        {(b.unallocatedMinutes ?? 0) > 0 && <p className="life-plan-meta">尚余 {minuteText(b.unallocatedMinutes!)} 未排入任务，当前没有更多符合条件且能放入空档的待办。</p>}
      </section>
    </> : <p className="life-plan-meta">这次排期未记录时间明细；再次点击“重排今日事”后可查看。</p>}
    <section aria-label="排入今日事的任务"><h3>排入今日事 · {plan.selected.length} 项 · 约 {minuteText(plannedMinutes)}</h3>
      {plan.selected.length ? <ul className="life-plan-tasks">{plan.selected.map(task => <li key={`${task.projectId}:${task.id}`}>
        <div><span>{task.title}</span><span>{minuteText(task.minutes)}</span></div>
        {task.durationBasis && <p>{task.durationBasis}</p>}
        <p>{task.reasons.join('；')}</p>
      </li>)}</ul> : <p className="life-plan-meta">本次没有安排普通今日事。</p>}
    </section>
  </div>;
}
