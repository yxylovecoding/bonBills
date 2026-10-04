import type { ClothesCalendar, ClothesDayContext, ClothesItem, ClothesLocation, Outfit, Scene, WearRecord, WeatherSnapshot } from './types';
import type { Category } from './types';

export function deviceDate(now = new Date(), timezone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function emptyContext(date: string, timezone: string): ClothesDayContext {
  return { date, timezone, revision: '', location: null, scene: null, active: null, manualWeather: null };
}
export function inferActivities(events: ClothesCalendar['events']): { scene: Scene | null; active: boolean | null } {
  let scene: Scene | null = null;
  let active: boolean | null = null;
  for (const event of events) {
    const title = event.title.replace(/(?:不|没有|无需|无)(?:运动|健身|多走路|走很多路)/g, '');
    const long = /徒步|登山|爬山|露营|滑雪|马拉松|骑行|hiking|camping|skiing/i.test(title);
    const outdoor = /散步|公园|户外|室外|动物园|游园|海滩|outdoor|walking/i.test(title);
    const sport = /运动|健身|跑步|打球|篮球|足球|羽毛球|乒乓球|网球|排球|高尔夫|瑜伽|普拉提|游泳|舞蹈|跳舞|攀岩|滑雪|滑冰|骑行|马拉松|gym|workout|running|cycling|swimming|yoga/i.test(title);
    const walking = /徒步|登山|爬山|暴走|健走|走很多路|多走路|长距离步行|万步|hiking|trekking|long walk/i.test(title);
    const indoor = /上课|课程|课$|讲座|会议|办公室|居家|电影|展览|博物馆|图书馆|室内|实习|健身房|gym|lecture|meeting/i.test(title);
    if (long) scene = '长时间室外';
    else if ((outdoor || /跑步|running/i.test(title)) && scene !== '长时间室外') scene = '有室外';
    else if (indoor && !scene) scene = '基本室内';
    if (walking || sport) active = true;
    else if ((indoor || outdoor || long) && active === null) active = false;
  }
  return { scene, active };
}
export function calendarDestinations(events: ClothesCalendar['events']) {
  return [...new Set(events.flatMap((event) => {
    if (event.location?.trim()) return [event.location.trim()];
    const title = event.title.trim();
    const match = title.match(/(?:前往|去往|到达|目的地[：:]|[→➜])\s*([^，,。；;（(\n]{2,40})$/)
      ?? title.match(/^([^，,。；;（(\n]{2,20}?)(?:出差|旅行|旅游)$/);
    return match ? [match[1].trim()] : [];
  }))];
}
export function effectiveContext(context: ClothesDayContext, calendar: ClothesCalendar | null): ClothesDayContext {
  const inferred = inferActivities(calendar?.events ?? []);
  return { ...context, scene: context.scene ?? inferred.scene, active: context.active ?? inferred.active };
}
export function chooseLocation(context: ClothesLocation | null, located: ClothesLocation | null, lastManual: ClothesLocation | null) {
  return context && context.source !== 'geo' ? context : located ?? context ?? lastManual;
}
export function weatherFor(context: ClothesDayContext, weather: WeatherSnapshot | null): WeatherSnapshot | null {
  if (!context.manualWeather) return weather;
  const { temperature, rain } = context.manualWeather;
  return { date: context.date, timezone: context.timezone, latitude: context.location?.latitude ?? 0,
    longitude: context.location?.longitude ?? 0, fetchedAt: '', temperature, apparent: temperature,
    min: temperature, max: temperature, apparentMin: temperature, precipitation: rain ? 1 : 0, wind: 0 };
}
export function recentCounts(records: WearRecord[], date: string) {
  const start = new Date(Date.parse(`${date}T00:00:00Z`) - 7 * 86400000).toISOString().slice(0, 10);
  const counts: Record<string, number> = {};
  for (const record of records) if (record.date >= start && record.date < date) {
    for (const item of record.items) counts[item.id] = (counts[item.id] ?? 0) + 1;
  }
  return counts;
}
function needs(context: ClothesDayContext, weather: WeatherSnapshot) {
  const outdoor = context.scene !== '基本室内';
  const cold = Math.min(weather.apparent, weather.apparentMin) - (context.scene === '长时间室外' ? 2 : 0);
  const rain = outdoor && weather.precipitation > 0;
  const wind = outdoor && weather.wind >= 25;
  return { cold, rain, wind, coat: cold < 18 || (weather.max - weather.min >= 10 && weather.min < 24) || rain || wind,
    accessory: cold < 5 && outdoor };
}
export function eligibleItems(items: ClothesItem[], category: Category, context: ClothesDayContext, weather: WeatherSnapshot) {
  const n = needs(context, weather);
  return items.filter((item) => !item.deleted && item.status === '可穿' && item.category === category
    && (!context.active || item.active)
    && (!(n.cold < 8 && ['上装', '下装', '连衣裙', '鞋', '配饰'].includes(category)) || item.thickness >= 2)
    && (!(weather.apparent >= 28 && ['上装', '下装', '连衣裙'].includes(category)) || item.thickness === 1)
    && (category !== '外套' || (item.thickness >= (n.cold < 8 ? 3 : n.cold < 18 ? 2 : 1)
      && (!n.rain || item.waterproof) && (!n.wind || item.windproof)))
    && (category !== '鞋' || !n.rain || item.waterproof));
}
function outfitKey(items: ClothesItem[]) { return items.map((item) => item.id).sort().join(':'); }
export function recommend(items: ClothesItem[], context: ClothesDayContext, inputWeather: WeatherSnapshot | null,
  records: WearRecord[] = []): Outfit[] {
  const weather = weatherFor(context, inputWeather);
  if (!weather || !context.scene || context.active === null) return [];
  const n = needs(context, weather), counts = recentCounts(records, context.date);
  const ideal = n.cold < 8 ? 3 : n.cold < 20 ? 2 : 1;
  const score = (list: ClothesItem[]) => {
    const thermal = list.reduce((sum, item) => sum + Math.abs(item.thickness - ideal) * (item.category === '外套' ? 2 : 1), 0);
    const colors = new Set(list.filter((item) => !['黑', '白', '灰', '米', '棕'].includes(item.color)).map((item) => item.color));
    return thermal * 100 + Math.max(0, colors.size - 1) * 12 + list.reduce((sum, item) => sum + (counts[item.id] ?? 0) * 3, 0);
  };
  const compare = (a: Outfit, b: Outfit) => a.missing.length - b.missing.length || (a.missing.length ? b.items.length - a.items.length : 0) || score(a.items) - score(b.items) || a.key.localeCompare(b.key);
  const layouts: Category[][] = [['上装', '下装', '鞋'], ['连衣裙', '鞋']];
  const results: Outfit[] = [];
  for (const layout of layouts) {
    if (n.coat) layout.push('外套');
    if (n.accessory) layout.push('配饰');
    let candidates: Outfit[] = [{ items: [], missing: [], key: '' }];
    for (const category of layout) {
      const pool = eligibleItems(items, category, context, weather).sort((a, b) => score([a]) - score([b]) || a.id.localeCompare(b.id)).slice(0, 24);
      const label = category === '外套' && n.rain ? '防雨外套' : category === '外套' && n.wind ? '防风外套' : category;
      if (!pool.length) candidates = candidates.map((outfit) => ({ ...outfit, missing: [...outfit.missing, label] }));
      else candidates = candidates.flatMap((outfit) => pool.map((item) => {
        const next = [...outfit.items, item];
        return { ...outfit, items: next, key: outfitKey(next) };
      })).sort(compare).slice(0, 96);
    }
    results.push(...candidates);
  }
  const unique = new Map(results.sort(compare).map((outfit) => [outfit.key + outfit.missing.join(), outfit]));
  const ranked = [...unique.values()].sort(compare);
  const best = ranked[0];
  return ranked.filter((outfit) => outfit.missing.length === best.missing.length
    && (!best.missing.length || outfit.items.length === best.items.length));
}
export function replacements(item: ClothesItem, outfit: Outfit, items: ClothesItem[], context: ClothesDayContext, inputWeather: WeatherSnapshot | null) {
  const weather = weatherFor(context, inputWeather);
  if (!weather || !context.scene || context.active === null) return [];
  return eligibleItems(items, item.category, context, weather).filter((next) => next.id !== item.id && !outfit.items.some((worn) => worn.id === next.id));
}
export function replacePiece(outfit: Outfit, previous: string, next: ClothesItem): Outfit {
  const items = outfit.items.map((item) => item.id === previous ? next : item);
  return { ...outfit, items, key: outfitKey(items) };
}
