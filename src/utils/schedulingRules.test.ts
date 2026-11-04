import { describe, expect, it } from 'vitest';
import { defaultRuleConfig, readRuleConfig, moveSchedulingRule, topologicalRules, updateRuleGroups, assignRuleGroup,
  removeSchedulingRule, restoreSchedulingRule, activeRuleOrder, ruleBefore, ruleTitle, type SchedulingRuleId } from './schedulingRules';
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

describe('分组、命名与删除', () => {
  const grouped = () => {
    const config = defaultRuleConfig(); config.predecessors = {};
    return updateRuleGroups(config, [
      { id: 'a', name: '固定日期', rules: ['always-today', 'sprays'] },
      { id: 'b', name: '洗衣安排', rules: ['laundry'] },
      { id: 'rest', name: '其他', rules: config.order.filter(id => !['always-today', 'sprays', 'laundry'].includes(id)) },
    ]);
  };
  it('旧排序原样迁移为连续分组，新增规则加入已有组', () => {
    const old = defaultRuleConfig(); old.order.reverse(); old.predecessors = {};
    const migrated = readRuleConfig(old);
    expect(migrated.order).toEqual(old.order);
    expect(migrated.groups!.flatMap(group => group.rules)).toEqual(old.order);
    const next = readRuleConfig({ ...migrated, order: migrated.order.filter(id => id !== 'outlook-pickup'),
      groups: migrated.groups!.map(group => ({ ...group, rules: group.rules.filter(id => id !== 'outlook-pickup') })) });
    expect(next.groups!.map(group => group.id)).toEqual(migrated.groups!.map(group => group.id));
    expect(next.groups!.flatMap(group => group.rules).filter(id => id === 'outlook-pickup')).toHaveLength(1);
  });
  it('组间和组内连续执行，组内独立前序保持稳定', () => {
    const config = grouped(), [a, b, rest] = config.groups!;
    const moved = updateRuleGroups(config, [b, a, rest], true);
    expect(moved.order.slice(0, 3)).toEqual(['laundry', 'always-today', 'sprays']);
    expect(readRuleConfig({ ...moved, predecessors: { sprays: ['always-today'] } }).order).toEqual(moved.order);
  });
  it('跨组绑定自动调整整组，拖动不可越过依赖', () => {
    const config = readRuleConfig({ ...grouped(), predecessors: { 'always-today': ['laundry'] } });
    expect(config.groups!.map(group => group.id)).toEqual(['b', 'a', 'rest']);
    expect(() => updateRuleGroups(config, [config.groups![1], config.groups![0], config.groups![2]], true)).toThrow('不能越过');
  });
  it('规则没有环但组之间来回依赖时拒绝保存，显示组链', () => {
    expect(() => readRuleConfig({ ...grouped(), predecessors: { laundry: ['always-today'], sprays: ['laundry'] } }))
      .toThrow(/分组循环依赖.*固定日期.*洗衣安排.*固定日期/);
  });
  it('跨组移动保留规则唯一归属，可删除空组', () => {
    const config = assignRuleGroup(grouped(), 'laundry', 'a');
    expect(config.groups![0].rules).toEqual(['always-today', 'sprays', 'laundry']);
    expect(config.groups![1].rules).toEqual([]);
    expect(updateRuleGroups(config, config.groups!.filter(group => group.id !== 'b')).order).toEqual(config.order);
  });
  it('拒绝重复、遗漏、未知归属，以及非法组名', () => {
    const config = grouped(), groups = config.groups!;
    expect(() => readRuleConfig({ ...config, groups: [...groups, { id: 'copy', name: '重复规则', rules: ['laundry'] }] })).toThrow('重复');
    expect(() => readRuleConfig({ ...config, groups: groups.filter(group => group.id !== 'a') })).toThrow('每条规则');
    expect(() => updateRuleGroups(config, [{ ...groups[0], rules: ['unknown' as SchedulingRuleId] }, ...groups.slice(1)])).toThrow('无效');
    expect(() => updateRuleGroups(config, [{ ...groups[0], name: ' ' }, ...groups.slice(1)])).toThrow('分组名称');
  });
  it('改名保存显示名称，不改变规则身份、顺序和条件', () => {
    const config = grouped(), named = readRuleConfig({ ...config, names: { laundry: ' 晴天洗衣 ' } });
    expect(ruleTitle('laundry', named)).toBe('晴天洗衣'); expect(named.order).toEqual(config.order);
    expect(() => readRuleConfig({ ...named, names: { laundry: '' } })).toThrow('规则名称');
    expect(() => readRuleConfig({ ...named, names: { unknown: '错误' } })).toThrow('规则名称');
  });
  it('删除持久生效、不会作为更高优先级参与比较；恢复到指定分组', () => {
    const config = removeSchedulingRule(grouped(), 'laundry'), restoredRead = readRuleConfig(config);
    expect(activeRuleOrder(restoredRead)).not.toContain('laundry');
    expect(restoredRead.groups!.flatMap(group => group.rules)).not.toContain('laundry');
    expect(ruleBefore(restoredRead, 'laundry', 'always-today')).toBe(false);
    expect(ruleBefore(restoredRead, 'always-today', 'laundry')).toBe(false);
    const restored = restoreSchedulingRule(restoredRead, 'laundry', 'a');
    expect(restored.groups![0].rules).toContain('laundry'); expect(restored.removed).not.toContain('laundry');
  });
  it('绑定中的规则不能直接删除，伪造配置也被拒绝', () => {
    const config = readRuleConfig({ ...grouped(), predecessors: { laundry: ['always-today'] } });
    expect(() => removeSchedulingRule(config, 'always-today')).toThrow('请先解除前序');
    expect(() => readRuleConfig({ ...config, removed: ['always-today'] })).toThrow('已删除');
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
