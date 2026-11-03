export const SCHEDULING_RULES = [
  ['calendar-travel', 'Outlook 出游', '有效全天出游日程标记为旅；月经和节假日提醒不作为行程。', 'calendar'],
  ['calendar-manual', '手动日历标记', '与 Outlook 同日标记冲突时保留手动选择。', 'calendar'],
  ['calendar-home', 'Outlook 回家', '按已设置的回家标题标记为寄。', 'calendar'],
  ['calendar-intern', 'Outlook 实习', '课日历的实习日程结合实习段、法定工休和出勤覆盖解析。', 'calendar'],
  ['visibility-location', '地点标签显隐', '城市标签匹配当天所在地时显示，多个城市满足任一即可；否则隐藏。', 'visibility'],
  ['visibility-sleep', '凌晨临时隐藏', '00:00–05:01 隐藏今日事、明日事和今日重要之事；按记录恢复。', 'visibility'],
  ['visibility-reading', '阅读显隐', '阅读及“而阅读📖是另一个🪝”在 20:00–次日 07:01 显示。', 'visibility'],
  ['visibility-hair', '洗头显隐', '洗头在北京时间 20:00 后显示，次日凌晨重新隐藏。', 'visibility'],
  ['visibility-night', '夜间 routine', '按自身开始时刻显隐，并维持高优先级；保留用户 routine 标签。', 'visibility'],
  ['visibility-timed', '具体时刻显隐', '有具体时刻的待办开始前隐藏，到点显示。', 'visibility'],
  ['eye-drops', '眼药水过期项', '重要定时重复眼药水仅保留最近到期项，其余按原规则推进；不记完成。', 'date'],
  ['template-content', '出门与搬家模板内容', '对齐十组模板内容，再同步已有搬家实例；保留标签、父子关系和完成进度。', 'generation'],
  ['moving-date', '搬家阶段日期', '按搬家标题日期安排各阶段和后代，保留原时刻与重复规则。', 'date'],
  ['scene-eligibility', '可执行场景', '寄／居／旅决定可执行日期；多个场景满足任一即可，子任务使用自身标签。', 'date'],
  ['always-today', '固定今日', 'always-today 固定到今天；当天已完成的重复系列保留下一次日期。', 'date'],
  ['swimming', '游泳与经期', '游泳避开经期；需要跟随洗头的游泳安排在可用洗头日。', 'date'],
  ['exercise', '训练轮换', '依据实际完成记录安排滚动训练，避开不适用场景与恢复期。', 'date'],
  ['exercise-rollover', '夜间训练顺延', '已错过的训练按原重复规则顺延，游泳仍使用非经期洗头日。', 'date'],
  ['laundry-appointment', '洗衣手动时段', '已有唯一关联的 Outlook 洗衣预约被手动改到同日其他时刻时保留当前日期。', 'date'],
  ['laundry-travel', '出行前洗衣', '洗衣周期目标位于行程内时移到出行前一天；错过时保留等待补做。', 'date'],
  ['laundry', '洗衣天气排期', '依据实际完成周期，在目标日前一天至后两天结合地点、天气和空档选日，缺少可用数据时保留日期。', 'date'],
  ['sprays', '喷雾错开', '香香喷雾与除螨喷雾不同日，已完成记录占用当天，较久未完成者优先。', 'date'],
  ['hair-follow', '洗头日期跟随', '带洗头标签的准备项跟随唯一洗头待办的最终日期。', 'date'],
  ['important', '重要事项预留', '今日未完成的重要事项优先预留时间；与实际日程重叠的时间不重复扣除。', 'selection'],
  ['minimum-interval', '最短重复间隔', 'at-least 任务不到周期目标日不提前补入。', 'selection'],
  ['oldest', '最久未做优先', '无完成记录优先，其余按上次实际完成时间排序；不以最近完成的短任务挤占轮换。', 'selection'],
  ['urgency', '周期与截止紧迫度', '周期到期、截止临近或下一可执行日晚于截止日的任务优先。', 'selection'],
  ['daily-plan', '普通今日事轮换', '仅轮换优先级 0／1／3 的普通任务，按连续空档挑选；今日未选中项延期，未来未选中项保留。', 'date'],
  ['repeat-date', '长周期日期保留', '处于居／旅场景时保留 TickTick 的长周期下一次日期。', 'date'],
  ['scene-date', '最近场景日', '场景不适用时移到最近适用日；没有可确认的场景日时保留原日期。', 'date'],
  ['trips', '出行模板', '按行程日期生成准备阶段与后代；保留已生成阶段的手动日期。', 'generation'],
  ['wishes', '心愿准备', '独立心愿按截止日前七个自然月生成准备阶段及后代。', 'generation'],
  ['period-reminder', '月经提醒', '预计开始前两天提醒，同一周期已完成后不重复补建。', 'generation'],
  ['vehicle-pickup', '充电次日接车', '根据充电最终日期生成或调整次日 07:20–07:40 接电动车待办。', 'generation'],
  ['outlook-laundry', 'Outlook 洗衣', '跟随最终洗衣日期，预约 50 分钟；同日手动改时保留，缺失时查重恢复。', 'outlook'],
  ['outlook-charging', 'Outlook 充电', '跟随电动车充电待办日期，预约 60 分钟；全天任务默认 20:00。', 'outlook'],
  ['outlook-hair', 'Outlook 洗头', '跟随洗头待办日期，默认 22:00–22:30；同日手动改时保留。', 'outlook'],
  ['outlook-pickup', 'Outlook 接车', '跟随已确认的接电动车待办，预约 07:20–07:40。', 'outlook'],
] as const;

export type SchedulingRuleId = typeof SCHEDULING_RULES[number][0];
export interface SchedulingRuleConfig {
  version: number;
  order: SchedulingRuleId[];
  predecessors: Partial<Record<SchedulingRuleId, SchedulingRuleId[]>>;
}
export interface SchedulingRuleResult {
  id: SchedulingRuleId;
  status: 'success' | 'failed' | 'skipped';
  matched: number;
  updated: number;
  reason?: string;
  conflicts?: { taskId: string; winner: SchedulingRuleId; field: string }[];
}
export interface SchedulingRun {
  version: number;
  generatedAt: string;
  scope: 'full' | 'hourly' | 'visibility';
  order: SchedulingRuleId[];
  results: SchedulingRuleResult[];
}
export const ruleIds = SCHEDULING_RULES.map(rule => rule[0]);
export const ruleTitle = (id: SchedulingRuleId) => SCHEDULING_RULES.find(rule => rule[0] === id)?.[1] ?? id;
const defaultPredecessors: SchedulingRuleConfig['predecessors'] = { 'moving-date': ['template-content'], 'outlook-pickup': ['vehicle-pickup'] };
export const defaultRuleConfig = (): SchedulingRuleConfig => ({ version: 0, order: [...ruleIds], predecessors: structuredClone(defaultPredecessors) });

/** Missing IDs are new catalogue entries; unknown IDs are never silently executed. */
export function readRuleConfig(value: unknown): SchedulingRuleConfig {
  if (value === null || value === undefined) return defaultRuleConfig();
  if (!value || typeof value !== 'object') throw new Error('规则配置无效');
  const raw = value as SchedulingRuleConfig;
  if (!Number.isSafeInteger(raw.version) || raw.version < 0 || !Array.isArray(raw.order)
    || raw.order.some(id => !ruleIds.includes(id)) || new Set(raw.order).size !== raw.order.length
    || !raw.predecessors || typeof raw.predecessors !== 'object' || Array.isArray(raw.predecessors)) throw new Error('规则配置无效');
  const order = [...raw.order];
  for (const id of ruleIds) {
    if (order.includes(id)) continue;
    const next = ruleIds.slice(ruleIds.indexOf(id) + 1).find(candidate => order.includes(candidate));
    order.splice(next ? order.indexOf(next) : order.length, 0, id);
  }
  const predecessors: SchedulingRuleConfig['predecessors'] = {};
  for (const [key, values] of Object.entries(raw.predecessors)) {
    const id = key as SchedulingRuleId;
    if (!ruleIds.includes(id) || !Array.isArray(values) || values.some(p => !ruleIds.includes(p))
      || new Set(values).size !== values.length) throw new Error('前序规则无效');
    if (values.includes(id)) throw new Error(`${ruleTitle(id)}不能将自己设为前序`);
    predecessors[id] = [...values];
  }
  for (const id of ruleIds) if (!raw.order.includes(id) && defaultPredecessors[id]) predecessors[id] = [...defaultPredecessors[id]!];
  const config = { version: raw.version, order, predecessors };
  config.order = topologicalRules(config);
  return config;
}

export function topologicalRules(config: SchedulingRuleConfig): SchedulingRuleId[] {
  const visited = new Set<SchedulingRuleId>(), visiting: SchedulingRuleId[] = [];
  const visit = (id: SchedulingRuleId) => {
    if (visited.has(id)) return;
    const cycle = visiting.indexOf(id);
    if (cycle >= 0) throw new Error(`循环依赖：${[...visiting.slice(cycle), id].map(ruleTitle).join(' → ')}`);
    visiting.push(id);
    for (const parent of config.predecessors[id] ?? []) visit(parent);
    visiting.pop(); visited.add(id);
  };
  config.order.forEach(visit);
  const result: SchedulingRuleId[] = [];
  while (result.length < config.order.length) {
    const next = config.order.find(id => !result.includes(id) && (config.predecessors[id] ?? []).every(p => result.includes(p)));
    if (!next) throw new Error('规则依赖无法排序');
    result.push(next);
  }
  return result;
}

export function moveSchedulingRule(config: SchedulingRuleConfig, from: number, to: number): SchedulingRuleConfig {
  const order = [...config.order];
  const [id] = order.splice(from, 1); order.splice(to, 0, id);
  const valid = Object.entries(config.predecessors).every(([child, parents]) => parents!.every(p => order.indexOf(p) < order.indexOf(child as SchedulingRuleId)));
  if (!valid) throw new Error('不能越过绑定的前序或后序规则');
  return { ...config, order };
}

export function ruleBefore(config: SchedulingRuleConfig, first: SchedulingRuleId, second: SchedulingRuleId) {
  return config.order.indexOf(first) < config.order.indexOf(second);
}
