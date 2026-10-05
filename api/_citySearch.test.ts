import { afterEach, expect, it, vi } from 'vitest';
import { searchCities } from './_bonClothes';

afterEach(() => vi.unstubAllGlobals());

it('常州等中文简称无结果时查询完整市名并保留实际坐标', async () => {
  const queries: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
    const query = url.searchParams.get('name')!; queries.push(query);
    return new Response(JSON.stringify({ results: query === '常州市' ? [
      { name: '常州市', admin1: '江苏', country: '中国', latitude: 31.77359, longitude: 119.95401, timezone: 'Asia/Shanghai' },
    ] : [] }));
  }));
  expect(await searchCities('常州')).toEqual([{ name: '常州市 · 江苏 · 中国', latitude: 31.77359,
    longitude: 119.95401, timezone: 'Asia/Shanghai', source: 'manual' }]);
  expect(queries).toEqual(['常州', '常州市']);
});

it('已有城市结果直接使用，非中文和完整市名无结果不重复查询', async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ results: [] })));
  vi.stubGlobal('fetch', fetch);
  await searchCities('常州市'); await searchCities('Unknown');
  expect(fetch).toHaveBeenCalledTimes(2);
  fetch.mockResolvedValueOnce(new Response(JSON.stringify({ results: [{ name: '北京', latitude: 39.9, longitude: 116.4 }] })));
  expect(await searchCities('北京')).toHaveLength(1);
  expect(fetch).toHaveBeenCalledTimes(3);
});
