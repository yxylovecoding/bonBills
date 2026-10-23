import { createHash } from 'node:crypto';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { authorizeAccountScope, runAccountRequest } from './_accountScope';
import { readR2Photo, r2Enabled, r2Photo, storeR2Photo } from './_clothesR2';

const source = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=';
const bytes = Buffer.from(source.split(',')[1], 'base64');
const send = vi.spyOn(S3Client.prototype, 'send');
beforeEach(() => {
  vi.stubEnv('CLOTHES_R2_ENDPOINT', `https://${'a'.repeat(32)}.r2.cloudflarestorage.com`);
  vi.stubEnv('CLOTHES_R2_BUCKET', 'fixture-photos');
  vi.stubEnv('CLOTHES_R2_ACCESS_KEY_ID', 'offline-fixture');
  vi.stubEnv('CLOTHES_R2_SECRET_ACCESS_KEY', 'offline-fixture');
  send.mockReset();
  send.mockImplementation(async (command: any) => command instanceof PutObjectCommand ? {} : {
    ContentType: 'image/png', ContentLength: bytes.length,
    Body: { transformToByteArray: async () => bytes },
  });
});
afterEach(() => vi.unstubAllEnvs());

it('stores standard, private objects and verifies the downloaded bytes before returning a reference', async () => {
  const photo = await storeR2Photo(source);
  expect(send.mock.calls.map(([command]) => command.constructor)).toEqual([PutObjectCommand, GetObjectCommand]);
  expect(send.mock.calls[0][0].input).toMatchObject({ Bucket: 'fixture-photos', Key: photo.key,
    Body: bytes, ContentType: 'image/png', StorageClass: 'STANDARD', CacheControl: 'private, max-age=2592000, immutable' });
  expect(photo).toMatchObject({ storage: 'r2', mime: 'image/png', bytes: bytes.length,
    validator: `photo-v2-${createHash('sha1').update(source).digest('hex')}` });
  expect(r2Photo(photo)).toEqual(photo);
  expect(r2Photo(JSON.stringify(photo))).toEqual(photo);
  expect(r2Photo(source)).toBeNull();
  expect(await readR2Photo(photo)).toEqual(bytes);
});

it('never publishes a reference when upload, metadata validation, or byte verification fails', async () => {
  send.mockRejectedValueOnce(new Error('write failed'));
  await expect(storeR2Photo(source)).rejects.toThrow('write failed');
  expect(send).toHaveBeenCalledTimes(1);
  send.mockResolvedValueOnce({}).mockResolvedValueOnce({ ContentLength: bytes.length, ContentType: 'image/jpeg' });
  await expect(storeR2Photo(source)).rejects.toThrow('metadata mismatch');
  const damaged = Buffer.from(bytes); damaged[damaged.length - 1] ^= 1;
  send.mockResolvedValueOnce({}).mockResolvedValueOnce({ ContentLength: bytes.length, ContentType: 'image/png',
    Body: { transformToByteArray: async () => damaged } });
  await expect(storeR2Photo(source)).rejects.toThrow('checksum mismatch');
});

it('isolates object paths per authenticated account and rejects a foreign reference before fetching', async () => {
  const photo = await runAccountRequest(async () => {
    authorizeAccountScope('1'.repeat(32));
    return storeR2Photo(source);
  });
  send.mockClear();
  await runAccountRequest(async () => {
    authorizeAccountScope('2'.repeat(32));
    await expect(readR2Photo(photo)).rejects.toThrow('Invalid R2 photo reference');
  });
  expect(send).not.toHaveBeenCalled();
  await runAccountRequest(async () => {
    authorizeAccountScope('1'.repeat(32));
    expect(await readR2Photo(photo)).toEqual(bytes);
  });
});

it('rejects incomplete configuration, foreign endpoints, and invalid uploads without network calls', async () => {
  expect(r2Enabled()).toBe(true);
  await expect(storeR2Photo('data:image/png;base64,bm90LWEtcGhvdG8=')).rejects.toThrow();
  vi.stubEnv('CLOTHES_R2_ENDPOINT', 'https://example.com');
  expect(() => r2Enabled()).toThrow('Invalid R2 endpoint');
  vi.stubEnv('CLOTHES_R2_ENDPOINT', '');
  expect(() => r2Enabled()).toThrow('configuration incomplete');
  for (const key of ['CLOTHES_R2_BUCKET', 'CLOTHES_R2_ACCESS_KEY_ID', 'CLOTHES_R2_SECRET_ACCESS_KEY']) vi.stubEnv(key, '');
  expect(r2Enabled()).toBe(false);
  expect(send).not.toHaveBeenCalled();
});
