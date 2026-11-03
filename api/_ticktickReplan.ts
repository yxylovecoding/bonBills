import { runRuleReplan } from './_ruleReplan.js';

export async function replanRemainingToday(options: { scheduled?: boolean } = {}) {
  return runRuleReplan({ scope: 'hourly', ...options });
}
