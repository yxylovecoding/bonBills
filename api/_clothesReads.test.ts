import { Redis } from '@upstash/redis';
import { afterEach, expect, it, vi } from 'vitest';
import { READ_PHOTO, READ_WEAR_PAGE } from './_clothesReads';

afterEach(() => vi.unstubAllGlobals());

it('installed Redis SDK preserves photo validator tokens and decodes nested history JSON', async () => {
  const redis = new Redis({ url: 'https://offline.invalid', token: 'offline-fixture', enableAutoPipelining: false, retry: false });
  const photo = 'data:image/jpeg;base64,fixture';
  const token = 'photo-v2-0123456789abcdef';
  const record = { date: '2026-10-01', confirmedAt: '2026-10-01T12:00:00Z', items: [] };
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ result: [token, photo] })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ result: [token, ''] })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ result: [JSON.stringify(record)] })));
  vi.stubGlobal('fetch', fetch);
  expect(await redis.eval(READ_PHOTO, ['fixture-photo'], ['[]'])).toEqual([token, photo]);
  expect(await redis.eval(READ_PHOTO, ['fixture-photo'], [JSON.stringify([`"${token}"`])])).toEqual([token, '']);
  expect(await redis.eval(READ_WEAR_PAGE, ['fixture-wear'], ['2026-10-01', 'history'])).toEqual([record]);
  expect(fetch).toHaveBeenCalledTimes(3);
});
