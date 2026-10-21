import type { SceneCity } from '../models/types.js';

// Older city searches saved "city · province · country" as the name.
// Shorten display labels without changing saved locations or their coordinates.
export function cityLabel(city: Pick<SceneCity, 'name'> | null | undefined): string {
  return city?.name.split('·')[0].trim() ?? '';
}

export function readSceneCity(value: unknown): SceneCity | null {
  if (!value || typeof value !== 'object') return null;
  const city = value as Partial<SceneCity>;
  if (typeof city.name !== 'string' || !city.name.trim() || city.name.length > 180
    || typeof city.latitude !== 'number' || !Number.isFinite(city.latitude) || Math.abs(city.latitude) > 90
    || typeof city.longitude !== 'number' || !Number.isFinite(city.longitude) || Math.abs(city.longitude) > 180) return null;
  return { name: city.name.trim(), latitude: city.latitude, longitude: city.longitude,
    ...(typeof city.timezone === 'string' ? { timezone: city.timezone } : {}) };
}
