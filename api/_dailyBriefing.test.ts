import { describe, expect, it } from 'vitest';
import { DEFAULT_CYCLE } from '../src/utils/bonLife';
import { buildTodayBriefing, buildTrainingBriefing, renderDailyBriefing, type DailyBriefing } from './_dailyBriefing';
import type { DailyPlanState } from './_ticktickDailyPlan';
import type { TickTickTask } from './_ticktickTrips';
const today = '2026-10-05';
const task = (id: string, fields: Partial<TickTickTask> = {}): TickTickTask => ({ id, projectId: 'p', title: id,
  status: 0, dueDate: `${today}T00:00:00+0800`, ...fields });

describe('每日邮件简报', () => {
  it('游泳与主训练同日并存，合计用时，重复轮换说明是预排而非已完成', () => {
    const tasks = ['上半身', '全身力训', '臀腿', '游泳'].map(name => ({ id: name, name, title: name, dates: [],
      schedule: name === '游泳' ? '每 2 天' : '', scheduledDate: name === '游泳' ? today : undefined,
      repeatFlag: name === '游泳' ? 'RRULE:FREQ=DAILY;INTERVAL=2' : undefined, notes: '30 分钟', links: [] }));
    const days = buildTrainingBriefing(today, { year: 2026, tasks, connected: true, syncedAt: null, hairWash: { scheduledDate: today, repeatFlag: 'FREQ=DAILY;INTERVAL=2' } }, DEFAULT_CYCLE, []);
    expect(days.filter(day => day.plan.includes('休息')).map(day => day.date)).toEqual(['2026-10-08', '2026-10-11']);
    expect(days.filter(day => day.plan === '休息').every(day => day.minutes === 0)).toBe(true);
    expect(days[0].minutes).toBe(60); expect(days[1].minutes).toBe(30);
    expect(days[0].reasons.join('')).toContain('游泳跟随洗头日并避开经期');
    expect(days[3].reasons.join('')).toContain('主训练将连续进行 3 天');
    expect(days[3].reasons.join('')).not.toContain('你已选择休息');
    expect(days[6].reasons.join('')).toContain('每 7 天至少休息 2 天');
    expect(days[6].reasons.join('')).toContain('不受主训练休息影响');
    expect(days[6].plan).toBe('主训练休息\n游泳');
    expect(days[6].minutes).toBe(30);
    expect(days[4].reasons.join('')).toContain('本次预排已在 2026-10-05 安排');
  });
  it('严格对应今日事范围，并使用同一任务的真实排期原因', () => {
    const plan: DailyPlanState = { connectionId: '', history: [], deadlines: {}, briefing: {
      date: today, generatedAt: `${today}T00:00:00Z`, selected: [{ id: 'a', projectId: 'p', title: 'a', minutes: 15, reasons: ['周期已到', '上次完成 2026-09-27'] }],
    } };
    const items = buildTodayBriefing([task('a'), task('routine', { tags: ['routine'] }), task('irrelevant', { tags: ['不关我事'] }),
      task('important', { priority: 5 }), task('done', { status: 2 }), task('future', { dueDate: '2026-10-06T00:00:00+0800' }),
      task('a', { projectId: 'other' }), task('无日期', { dueDate: undefined })], plan, today);
    expect(items).toHaveLength(2);
    expect(items[0].reasons).toEqual(['周期已到', '上次完成 2026-09-27']);
    expect(items[1].reasons[0]).toContain('暂无匹配');
    plan.briefing!.date = '2026-10-04';
    expect(buildTodayBriefing([task('a')], plan, today)[0].reasons[0]).toContain('暂无匹配');
  });
  it('未来七天覆盖跨月跨年，沿用手动内容、完成顺序和经期游泳限制', () => {
    const source = { year: 2026, connected: true, syncedAt: null, tasks: ['爬坡', '游泳'].map((name) => ({ id: name, name, title: name,
      schedule: '', dates: [], notes: '30 分钟', links: [] })), completions: [{ project: '爬坡', date: '2026-12-28' }],
      entries: { 'training:2026-12-31': { text: '', revision: '', training: { plan: '散步 20 分钟', effort: 'normal' as const, completed: false, mode: 'manual' as const } } } };
    const days = buildTrainingBriefing('2026-12-29', source, { ...DEFAULT_CYCLE, lastPeriodStart: '2026-12-29', automatic: false }, []);
    expect(days.map(({ date }) => date)).toEqual(['2026-12-29','2026-12-30','2026-12-31','2027-01-01','2027-01-02','2027-01-03','2027-01-04']);
    expect(days[2]).toMatchObject({ plan: '散步 20 分钟', minutes: 20, reasons: expect.arrayContaining(['保留你手动安排的内容']) });
    expect(days.slice(0, 5).every(({ plan }) => !plan.includes('游泳'))).toBe(true);
    expect(days[0].reasons.join('')).toContain('经期内游泳顺延');
  });
  it('保留事项原始文字为纯文本，邮件预览不会执行任务标题中的 HTML', () => {
    const report: DailyBriefing = { date: today, generatedAt: `${today}T00:00:00Z`, ready: false, warnings: ['请刷新'], training: [],
      today: [{ title: '<script>alert(1)</script>', minutes: 15, reasons: ['<img src=x>'] }] };
    const html = renderDailyBriefing(report);
    expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;img src=x&gt;'); expect(html).toContain('data-briefing-ready="false"');
    expect(html).toContain('1 项 · 约 15 分钟');
  });
});
