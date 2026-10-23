import { createHash } from 'node:crypto';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { accountStorageKey } from './_accountScope.js';
import { photoData, photoInput } from './_clothesValidation.js';

export interface R2Photo {
  storage: 'r2';
  key: string;
  mime: string;
  bytes: number;
  validator: string;
}

function config() {
  const endpoint = process.env.CLOTHES_R2_ENDPOINT?.trim() ?? '';
  const bucket = process.env.CLOTHES_R2_BUCKET?.trim() ?? '';
  const accessKeyId = process.env.CLOTHES_R2_ACCESS_KEY_ID?.trim() ?? '';
  const secretAccessKey = process.env.CLOTHES_R2_SECRET_ACCESS_KEY?.trim() ?? '';
  if (![endpoint, bucket, accessKeyId, secretAccessKey].some(Boolean)) return null;
  if (![endpoint, bucket, accessKeyId, secretAccessKey].every(Boolean)) throw new Error('R2 configuration incomplete');
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || !/^[a-f0-9]{32}(?:\.(?:eu|us|fedramp))?\.r2\.cloudflarestorage\.com$/.test(url.hostname)
    || url.username || url.password || url.port || url.search || url.hash || url.pathname !== '/') throw new Error('Invalid R2 endpoint');
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error('Invalid R2 bucket');
  return { endpoint: url.origin, bucket, accessKeyId, secretAccessKey };
}

export function r2Enabled() { return config() !== null; }

// Hash the authorized storage namespace; never accept an account or object URL
// from the client. Legacy and newly registered accounts have different prefixes.
function prefix() {
  return `clothes/${createHash('sha256').update(accountStorageKey('bonclothes:photos:r2')).digest('hex')}/`;
}
function client() {
  const settings = config();
  if (!settings) throw new Error('R2 not configured');
  return { bucket: settings.bucket, s3: new S3Client({ endpoint: settings.endpoint, region: 'auto', forcePathStyle: true,
    credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey }, maxAttempts: 2,
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED' }) };
}

export function r2Photo(value: unknown): R2Photo | null {
  // Upstash's automatic deserialization can decode JSON nested in Lua results.
  if (typeof value === 'string' && !value.startsWith('{')) return null;
  const photo = (typeof value === 'string' ? JSON.parse(value) : value) as R2Photo;
  const scope = prefix();
  if (!photo || photo.storage !== 'r2' || typeof photo.key !== 'string' || !photo.key.startsWith(scope)
    || !/^[a-f0-9]{64}$/.test(photo.key.slice(scope.length)) || !['image/jpeg', 'image/png', 'image/webp'].includes(photo.mime)
    || !Number.isInteger(photo.bytes) || photo.bytes <= 0 || photo.bytes > 200 * 1024
    || !/^photo-v2-[a-f0-9]{40}$/.test(photo.validator)) throw new Error('Invalid R2 photo reference');
  return photo;
}

export async function readR2Photo(photo: R2Photo): Promise<Buffer> {
  r2Photo(JSON.stringify(photo));
  const { s3, bucket } = client();
  try {
    const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: photo.key }), { abortSignal: AbortSignal.timeout(12000) });
    if (!result.Body || result.ContentLength !== photo.bytes || result.ContentType !== photo.mime) throw new Error('R2 photo metadata mismatch');
    const data = Buffer.from(await result.Body.transformToByteArray());
    if (data.length !== photo.bytes || createHash('sha256').update(data).digest('hex') !== photo.key.split('/').at(-1)) throw new Error('R2 photo checksum mismatch');
    return data;
  } finally { s3.destroy(); }
}

export async function storeR2Photo(value: string): Promise<R2Photo> {
  const { mime, data } = photoData(photoInput(value));
  const photo: R2Photo = { storage: 'r2', key: prefix() + createHash('sha256').update(data).digest('hex'), mime, bytes: data.length,
    validator: `photo-v2-${createHash('sha1').update(value).digest('hex')}` };
  const { s3, bucket } = client();
  try {
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: photo.key, Body: data, ContentType: mime,
      StorageClass: 'STANDARD', CacheControl: 'private, max-age=2592000, immutable' }), { abortSignal: AbortSignal.timeout(12000) });
  } finally { s3.destroy(); }
  // Verify before publishing the reference or removing Redis image data.
  // Content-addressed keys make concurrent uploads and retries harmless.
  await readR2Photo(photo);
  return photo;
}
