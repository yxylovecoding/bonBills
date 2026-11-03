import { AsyncLocalStorage } from 'node:async_hooks';
import { defaultRuleConfig, ruleBefore, type SchedulingRuleConfig, type SchedulingRuleId } from '../src/utils/schedulingRules.js';

interface Policy { config: SchedulingRuleConfig; active?: SchedulingRuleId; unavailable?: Set<SchedulingRuleId> }
const policy = new AsyncLocalStorage<Policy>();
export const currentRulePolicy = () => policy.getStore()?.config ?? defaultRuleConfig();
export const currentRule = () => policy.getStore()?.active;
export const hasRulePolicy = () => Boolean(policy.getStore());
export const ruleAvailable = (id: SchedulingRuleId) => !policy.getStore()?.unavailable?.has(id);
export const precedes = (a: SchedulingRuleId, b: SchedulingRuleId) => ruleBefore(currentRulePolicy(), a, b);
export const withRulePolicy = <T>(config: SchedulingRuleConfig, run: () => T, unavailable = new Set<SchedulingRuleId>()) =>
  policy.run({ config, unavailable }, run);
export const withActiveRule = <T>(active: SchedulingRuleId, run: () => T) => policy.run({ ...policy.getStore()!, active }, run);
