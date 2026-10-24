import type { CalendarLocationDay } from '../utils/calendarWeather.js';
import type { ClothesDayContext } from './types.js';
import { deviceDate } from './rules.js';

export function linkedClothesContext(context: ClothesDayContext, day?: CalendarLocationDay): ClothesDayContext {
  if (!day) return context;
  const chosen = context.location?.source === 'manual' || (context.location?.source === 'geo' && context.date <= deviceDate(new Date(), context.timezone)) ? context.location : null;
  const location = chosen ?? (day.locations.length === 1 && !day.unresolved?.length ? day.locations[0] : null);
  return { ...context, location, timezone: location?.timezone ?? context.timezone,
    scene: context.scene ?? day.scene ?? null, active: context.active ?? day.active ?? null };
}
