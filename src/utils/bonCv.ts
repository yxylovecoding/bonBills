import type { BonCvFireSnapshot } from '../models/types';
import { apiFetch } from './authClient';

export interface BonCvFireProfile {
  schemaVersion: 1;
  revision: number;
  updatedAt: string;
  birthDate: string;
  education: BonCvFireSnapshot['education'];
}

function isProfile(value: unknown): value is BonCvFireProfile {
  if (!value || typeof value !== 'object') return false;
  const profile = value as Partial<BonCvFireProfile>;
  const education = profile.education as Partial<BonCvFireProfile['education']> | undefined;
  return profile.schemaVersion === 1
    && typeof profile.revision === 'number'
    && typeof profile.updatedAt === 'string'
    && typeof profile.birthDate === 'string'
    && Boolean(education)
    && ['none', 'bachelor', 'master', 'doctor'].includes(String(education?.level))
    && ['completed', 'in_progress'].includes(String(education?.status))
    && (education?.graduationDate === null || typeof education?.graduationDate === 'string');
}

export async function fetchBonCvFireProfile(etag?: string) {
  const headers: Record<string, string> = {};
  if (etag) headers['If-None-Match'] = etag;
  const response = await apiFetch('/api/boncv-profile', { headers, cache: 'no-store' });
  if (response.status === 304) return { status: 'not-modified' as const, etag };
  if (response.status === 503) throw new Error('BONCV_NOT_CONFIGURED');
  if (!response.ok) throw new Error(`BONCV_HTTP_${response.status}`);
  const profile: unknown = await response.json();
  if (!isProfile(profile)) throw new Error('BONCV_INVALID_RESPONSE');
  return {
    status: 'updated' as const,
    etag: response.headers.get('etag') ?? undefined,
    profile,
  };
}
