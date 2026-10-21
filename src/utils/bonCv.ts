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
  const response = await apiFetch('/api/boncv-profile', { headers });
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

export interface BonCvInternship {
  id: string;
  company: string;
  startDate: string;
  endDate: string;
}

export async function fetchBonCvInternships(signal?: AbortSignal): Promise<BonCvInternship[]> {
  const response = await apiFetch('/api/boncv-profile?view=internships', { signal, cache: 'no-store' });
  if (response.status === 503) throw new Error('BonCV 连接未配置');
  if (!response.ok) throw new Error('BonCV 暂时无法连接，请重试');
  const data = await response.json();
  if (data?.schemaVersion !== 1 || !Array.isArray(data.internships)) throw new Error('BonCV 实习接口尚未就绪');
  const seen = new Set<string>();
  return data.internships.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object') throw new Error('BonCV 实习数据无效');
    const item = entry as Partial<BonCvInternship>;
    if (typeof item.id !== 'string' || !item.id.trim() || seen.has(item.id)
      || typeof item.company !== 'string' || typeof item.startDate !== 'string' || typeof item.endDate !== 'string') {
      throw new Error('BonCV 实习数据无效');
    }
    seen.add(item.id);
    return { id: item.id, company: item.company.trim(), startDate: item.startDate.trim(), endDate: item.endDate.trim() };
  });
}
