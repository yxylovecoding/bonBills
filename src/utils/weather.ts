export function weatherSymbol(code: number | null | undefined): { icon: string; label: string } | null {
  if (code === 0) return { icon: '☀️', label: '晴' };
  if (code === 1) return { icon: '🌤️', label: '晴间多云' };
  if (code === 2) return { icon: '⛅', label: '多云' };
  if (code === 3) return { icon: '☁️', label: '阴' };
  if (code === 45 || code === 48) return { icon: '🌫️', label: '雾' };
  if ([51, 53, 55].includes(code!)) return { icon: '🌦️', label: '毛毛雨' };
  if ([56, 57, 66, 67].includes(code!)) return { icon: '🌧️', label: '冻雨' };
  if ([61, 63, 65, 80, 81, 82].includes(code!)) return { icon: '🌧️', label: '雨' };
  if ([71, 73, 75, 77, 85, 86].includes(code!)) return { icon: '🌨️', label: '雪' };
  if ([95, 96, 99].includes(code!)) return { icon: '⛈️', label: '雷雨' };
  return null;
}

export function dailyWeatherLabel(weather: { code?: number; min: number; max: number; precipitation: number }) {
  const condition = weatherSymbol(weather.code)?.label ?? (weather.precipitation > 0 ? '有降水' : '无降水');
  return `${condition} · ${Math.round(weather.min)}–${Math.round(weather.max)}℃`;
}
