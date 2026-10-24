import type { ClothesLocation, Scene, WeatherSnapshot } from '../clothes/types.js';

export interface CalendarLocationDay {
  locations: ClothesLocation[];
  unresolved?: string[];
  travel: boolean;
  scene?: Scene | null;
  active?: boolean | null;
}
export interface CalendarWeatherEntry {
  location: ClothesLocation;
  weather: WeatherSnapshot | null;
  stale: boolean;
}
export interface CalendarWeather {
  days: Record<string, CalendarWeatherEntry[]>;
  error?: string;
}
