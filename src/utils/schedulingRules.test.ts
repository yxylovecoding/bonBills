import { describe, expect, it } from 'vitest';
import { defaultRuleConfig, readRuleConfig, moveSchedulingRule, topologicalRules } from './schedulingRules';
import { monthCityLabels, calendarVisualTag } from './calendarPresentation';
import { BEIJING, GUANGZHOU, DEFAULT_INTERNSHIP_RULES, resolveDailyContext } from './internship';

describe('规则优先级与前序', () => {
  it('多前序按拖动顺序稳定排序，绑定拥有更高优先级', () => {
    const config = defaultRuleConfig();
    config.order = ['daily-plan', ...config.order.filter(id => id !== 'daily-plan')];
    config.predecessors['daily-plan'] = ['laundry', 'exercise'];
    const order = topologicalRules(config);
    expect(order.indexOf('exercise')).toBeLessThan(order.indexOf('daily-plan'));
    expect(order.indexOf('laundry')).toBeLessThan(order.indexOf('daily-plan'));
    expect(topologicalRules({ ...config, order })).toEqual(order);
  });
  it('拒绝自依赖、循环和未知规则，指出循环路径', () => {
    const config = defaultRuleConfig();
    expect(() => readRuleConfig({ ...config, predecessors: { laundry: ['laundry'] } })).toThrow('自己');
    expect(() => readRuleConfig({ ...config, predecessors: { laundry: ['exercise'], exercise: ['daily-plan'], 'daily-plan': ['laundry'] } })).toThrow(/循环依赖：.*训练.*普通今日事.*洗衣.*训练/);
    expect(() => readRuleConfig({ ...config, order: ['unknown'] })).toThrow('无效');
  });
  it('拖动不能越过前序，新增目录规则补入而不丢失用户顺序', () => {
    const config = readRuleConfig({ ...defaultRuleConfig(), predecessors: { laundry: ['exercise'] } });
    expect(() => moveSchedulingRule(config, config.order.indexOf('laundry'), config.order.indexOf('exercise'))).toThrow('不能越过');
    const old = { version: 8, order: ['daily-plan', 'laundry'], predecessors: { laundry: ['daily-plan'] } };
    const next = readRuleConfig(old);
    expect(next.order.indexOf('daily-plan')).toBeLessThan(next.order.indexOf('laundry'));
    expect(next.version).toBe(8);
  });
});

describe('月历工休与地点段', () => {
  it('异地周末为蓝色但保留实习财务分类，手动工休及出行优先', () => {
    const config = { schoolCity: BEIJING, internshipEnabledFrom: '2026-11-01', internshipPeriods: [{ id: 'intern', profileId: 'company', profileName: '公司',
      revision: 1, startDate: '2026-11-01', endDate: '2026-11-30', city: GUANGZHOU, schoolCity: BEIJING, rules: { ...DEFAULT_INTERNSHIP_RULES, salary: 100 } }] };
    const rest = resolveDailyContext('2026-11-07', 'school', { config });
    expect(rest.tag).toBe('intern'); expect(calendarVisualTag(rest)).toBe('school');
    expect(calendarVisualTag(resolveDailyContext('2026-11-07', 'school', { config, dayOverrides: { '2026-11-07': { attendance: 'work' } } }))).toBe('intern');
    expect(calendarVisualTag(resolveDailyContext('2026-11-07', 'travel', { config }))).toBe('travel');
  });
  it('只在每月每段首日显示，返回同城重新显示，不依赖天气', () => {
    const city = (name: string) => ({ locations: [{ name, latitude: 0, longitude: 0, source: 'calendar' as const }], travel: false });
    const locations = { '2026-11-01': city('北京'), '2026-11-02': city('北京市'), '2026-11-06': city('广州'),
      '2026-11-20': city('清迈'), '2026-11-25': city('北京'), '2026-12-01': city('北京') };
    expect(monthCityLabels(Object.keys(locations), locations)).toEqual({ '2026-11-01': '北京', '2026-11-06': '广州', '2026-11-20': '清迈', '2026-11-25': '北京', '2026-12-01': '北京' });
  });
});
