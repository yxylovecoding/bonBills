import type { LifeEntries } from './bonLife';
import { isCalendarDate } from './outlookCalendar';
import { SKIN_STATES, type SkinPlan, type SkinRecord, type SkinSettings, type SkinState } from './lifeSkin';

const MEDICATION_FIELDS = ['medication', 'morningMedication', 'eveningMedication'] as const;
function medications(record: Partial<Record<typeof MEDICATION_FIELDS[number], string>>): string[] {
  return MEDICATION_FIELDS.flatMap((key) => (record[key] ?? '').split(/[、,，;；+＋\n]/))
    .map((name) => name.replace(/\s+/g, '').trim()).filter((name) => name && !/未用|没用|停用|暂停|不用|没有用/.test(name));
}
function matchedDay(skin: SkinRecord, plan: SkinPlan): number | undefined {
  const actual = medications(skin);
  const scores = plan.days.map((day) => medications(day).filter((name) => actual.some((used) => used === name || (name.length >= 2 && used.includes(name)))).length);
  const best = Math.max(0, ...scores);
  const matches = scores.flatMap((score, index) => best && score === best ? [index + 1] : []);
  return matches.length === 1 ? matches[0] : matches.includes(skin.planDay ?? 0) ? skin.planDay : undefined;
}
function recordedState(skin: SkinRecord, settings: SkinSettings): SkinState | undefined {
  if (skin.status) return skin.status;
  const matches = (Object.keys(SKIN_STATES) as SkinState[]).filter((state) => matchedDay(skin, settings.plans[state]) !== undefined);
  return matches.length === 1 ? matches[0] : undefined;
}

export interface SkinProgress { status?: SkinState; planDay?: number; completed?: boolean }

// Only saved medication records advance the personal routine. Missing days and
// skincare-only entries keep the next step; a recorded state change starts anew.
export function nextSkinPlan(date: string, settings: SkinSettings, entries: LifeEntries, requestedState?: SkinState): SkinProgress {
  let status: SkinState | undefined;
  let usedDay: number | undefined;
  const history = Object.entries(entries).filter(([key]) => key.startsWith('skin:') && isCalendarDate(key.slice(5)) && key.slice(5) < date)
    .sort(([left], [right]) => left.localeCompare(right));
  for (const [, entry] of history) {
    const skin = entry.skin;
    if (!skin) continue;
    const state = recordedState(skin, settings);
    if (state && state !== status) { status = state; usedDay = undefined; }
    if (!status || !medications(skin).length) continue;
    const plan = settings.plans[status];
    const manualDay = skin.planDay && skin.planDay <= plan.days.length ? skin.planDay : undefined;
    usedDay = matchedDay(skin, plan) ?? manualDay ?? usedDay;
  }
  if (requestedState && requestedState !== status) return { status: requestedState, planDay: 1 };
  status = requestedState ?? status;
  if (!status) return {};
  const plan = settings.plans[status];
  if (usedDay === undefined || plan.days.length === 1) return { status, planDay: 1 };
  if (usedDay < plan.days.length) return { status, planDay: usedDay + 1 };
  return plan.repeat ? { status, planDay: 1 } : { status, completed: true };
}

export function resolveSkinRecord(date: string, settings: SkinSettings, entries: LifeEntries, skin: SkinRecord = {}): SkinRecord {
  const status = recordedState(skin, settings) ?? nextSkinPlan(date, settings, entries).status;
  if (!status) return skin;
  const day = skin.planDay ?? matchedDay(skin, settings.plans[status]) ?? nextSkinPlan(date, settings, entries, status).planDay;
  return { ...skin, status, ...(day !== undefined ? { planDay: day } : {}) };
}
