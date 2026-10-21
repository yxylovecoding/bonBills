import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchBonCvInternships, type BonCvInternship } from './bonCv';
import { bonCvExactDate, importedBonCvPeriod, prepareBonCvInternship } from './bonCvInternships';
import { BEIJING, GUANGZHOU, DEFAULT_INTERNSHIP_RULES, internshipStart, periodOverlap, periodReady } from './internship';
import { apiFetch } from './authClient';

vi.mock('./authClient', () => ({ apiFetch: vi.fn() }));
afterEach(() => vi.resetAllMocks());
const entry: BonCvInternship = { id: 'cv-1', company: '字节跳动', startDate: '2026-10-01', endDate: '2026-10-31' };
const profile = { id: 'byte', name: '字节模式', revision: 3, rules: { ...DEFAULT_INTERNSHIP_RULES, salary: 250 } };

describe('BonCV 实习导入', () => {
  it.each(['2026-1-2', '2026/01/02', '2026.01.02', '2026年1月2日'])('接受精确日期 %s', raw => {
    expect(bonCvExactDate(raw)).toBe('2026-01-02');
  });
  it.each(['2026-10', '2026.10', '至今', 'present', '', '2026-02-29', '2026-13-01'])('不推测缺失或非法日期 %s', raw => {
    expect(bonCvExactDate(raw)).toBe('');
  });
  it.each(['字节跳动', 'ByteDance', '字节'])('匹配 %s 到字节规则，城市仍待确认', company => {
    const result = prepareBonCvInternship({ ...entry, company }, { internshipProfiles: [profile], schoolCity: BEIJING });
    expect(result.newProfile).toBeUndefined();
    expect(result.period).toMatchObject({ profileId: 'byte', revision: 3, rules: { salary: 250 }, startDate: entry.startDate, endDate: entry.endDate, city: null, schoolCity: BEIJING });
    expect(result.period.rules).not.toBe(profile.rules);
    expect(periodReady(result.period)).toBe(false);
    expect(internshipStart({ internshipPeriods: [result.period] })).toBeUndefined();
    expect(periodReady({ ...result.period, city: GUANGZHOU })).toBe(true);
  });
  it('新公司保留日期原文，工资不沿用字节，不填实习结束日期', () => {
    const result = prepareBonCvInternship({ ...entry, company: '示例公司', startDate: '2026.10', endDate: '至今' }, { internshipProfiles: [profile] });
    expect(result.newProfile).toMatchObject({ name: '示例公司', rules: { salary: null, housingKind: 'none', workweek: 'statutory' } });
    expect(result.period).toMatchObject({ startDate: '', endDate: '', city: null, bonCvSource: { entryId: 'cv-1', company: '示例公司', startDate: '2026.10', endDate: '至今' } });
  });
  it('同名模式有歧义时不自动绑定，也不把子串当公司匹配', () => {
    const config = { internshipProfiles: [profile, { ...profile, id: 'byte2', rules: { ...profile.rules, salary: 500 } }] };
    expect(prepareBonCvInternship(entry, config).newProfile?.rules.salary).toBeNull();
    expect(prepareBonCvInternship({ ...entry, company: '字节合作公司' }, config).newProfile?.name).toBe('字节合作公司');
  });
  it('按 ID 识别已导入经历，源数据变化和切换公司后仍保留历史', () => {
    const { period } = prepareBonCvInternship(entry, { internshipProfiles: [profile] });
    const saved = { ...period, city: BEIJING, endDate: '2026-10-15' };
    const config = JSON.parse(JSON.stringify({ internshipPeriods: [saved, { ...saved, id: 'split', startDate: '2026-10-16', endDate: '2026-10-31' }] }));
    const changed = { ...entry, company: '其他公司', startDate: '2026-09-01' };
    expect(importedBonCvPeriod(changed, config)).toEqual(saved);
    expect(prepareBonCvInternship(changed, config)).toEqual({ period: saved });
  });
  it('草稿只要日期完整也占用区间；首尾包含且空日期不误判', () => {
    const { period } = prepareBonCvInternship(entry, {});
    expect(periodOverlap({ ...period, id: 'next', startDate: '2026-10-31', endDate: '2026-11-30' }, [period])).toBe(true);
    expect(periodOverlap({ ...period, id: 'next', startDate: '2026-11-01', endDate: '2026-11-30' }, [period])).toBe(false);
    expect(periodOverlap({ ...period, id: 'next', startDate: '' }, [period])).toBe(false);
    expect(periodOverlap(period, [period])).toBe(false);
  });
});

describe('BonCV 实习读取', () => {
  it('独立读取实习视图，支持取消且保持日期精度', async () => {
    vi.mocked(apiFetch).mockResolvedValue(new Response(JSON.stringify({ schemaVersion: 1, internships: [{ ...entry, startDate: '2026.10', endDate: '至今' }] })));
    const controller = new AbortController();
    expect(await fetchBonCvInternships(controller.signal)).toEqual([{ ...entry, startDate: '2026.10', endDate: '至今' }]);
    expect(apiFetch).toHaveBeenCalledWith('/api/boncv-profile?view=internships', { signal: controller.signal, cache: 'no-store' });
  });
  it.each([
    { schemaVersion: 1, birthDate: '2000-01-01' },
    { schemaVersion: 2, internships: [] },
    { schemaVersion: 1, internships: [null] },
    { schemaVersion: 1, internships: [{ ...entry, startDate: null }] },
    { schemaVersion: 1, internships: [entry, entry] },
  ])('拒绝旧接口和非法结果 %#', async body => {
    vi.mocked(apiFetch).mockResolvedValue(new Response(JSON.stringify(body)));
    await expect(fetchBonCvInternships()).rejects.toThrow();
  });
  it.each([503, 502, 403])('连接失败保留配置，不当作空数据 %s', async status => {
    vi.mocked(apiFetch).mockResolvedValue(new Response('{}', { status }));
    await expect(fetchBonCvInternships()).rejects.toThrow();
  });
});
