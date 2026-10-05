import type { SceneCity } from '../models/types.js';

export function readSceneCity(value: unknown): SceneCity | null {
  if (!value || typeof value !== 'object') return null;
  const city = value as Partial<SceneCity>;
  if (typeof city.name !== 'string' || !city.name.trim() || city.name.length > 180
    || typeof city.latitude !== 'number' || !Number.isFinite(city.latitude) || Math.abs(city.latitude) > 90
    || typeof city.longitude !== 'number' || !Number.isFinite(city.longitude) || Math.abs(city.longitude) > 180) return null;
  return { name: city.name.trim(), latitude: city.latitude, longitude: city.longitude,
    ...(typeof city.timezone === 'string' ? { timezone: city.timezone } : {}) };
}
