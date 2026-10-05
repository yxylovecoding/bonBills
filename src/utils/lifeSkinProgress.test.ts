import { describe, expect, it } from 'vitest';
import type { LifeEntries } from './bonLife';
import { DEFAULT_SKIN_SETTINGS, parseSkinRecord, parseSkinSettings, skinLocalPlanValues, skinPlanValues, type SkinRecord } from './lifeSkin';
import { entrySummary, parseLifeEdit } from './bonLife';
import { nextSkinPlan, resolveSkinRecord } from './lifeSkinProgress';

const settings = DEFAULT_SKIN_SETTINGS;
const history = (records: Record<string, SkinRecord>): LifeEntries => Object.fromEntries(
  Object.entries(records).map(([date, skin]) => [`skin:${date}`, { text: '', revision: date, skin }]),
);

describe('个人皮肤方案接续', () => {
  it('昨天用炉甘石，今天接第 2 天的早间过氧和晚间阿达帕林', () => {
    const entries = history({ '2026-10-04': { status: 'acne', medication: '炉甘石' } });
    const current = resolveSkinRecord('2026-10-05', settings, entries);
    expect(current).toEqual({ status: 'acne', planDay: 2 });
    expect(skinPlanValues(settings, current.status!, current.planDay!, 'autumn')).toMatchObject({
      morningMedication: '过氧', eveningMedication: '阿达帕林', morningProducts: '珂润霜',
    });
    expect(current).not.toHaveProperty('eveningMedication');
  });

  it('跨月、跨年和漏记不跳过实际尚未完成的步骤', () => {
    const entries = history({ '2025-12-31': { eveningMedication: '炉甘石洗剂' } });
    expect(nextSkinPlan('2026-01-03', settings, entries)).toEqual({ status: 'acne', planDay: 2 });
  });

  it('按日期排序，只看目标日期之前的记录，实际用药优先于旧天数', () => {
    const entries = history({
      '2026-10-05': { status: 'acne', medication: '酸', planDay: 3 },
      '2026-10-04': { status: 'acne', eveningMedication: '阿达帕林凝胶', planDay: 1 },
      '2026-10-02': { status: 'acne', medication: '炉甘石', planDay: 1 },
      '2026-10-06': { status: 'healthy' },
    });
    entries['mood:2026-10-04'] = { text: '炉甘石', revision: 'other' };
    expect(nextSkinPlan('2026-10-05', settings, entries)).toEqual({ status: 'acne', planDay: 3 });
  });

  it('仅选择状态、涂护肤品或记录停药不推进天数', () => {
    const entries = history({
      '2026-10-01': { status: 'acne', medication: '炉甘石' },
      '2026-10-02': { status: 'acne', planDay: 2, morningProducts: '珂润霜' },
      '2026-10-03': { status: 'acne', planDay: 2, eveningMedication: '未用阿达帕林' },
    });
    expect(nextSkinPlan('2026-10-05', settings, entries)).toEqual({ status: 'acne', planDay: 2 });
  });

  it('状态切换后重新开始，健康期间的旧痤疮步骤不延续', () => {
    const entries = history({
      '2026-10-01': { status: 'acne', medication: '炉甘石' },
      '2026-10-02': { status: 'healthy' },
      '2026-10-03': { status: 'acne' },
    });
    expect(nextSkinPlan('2026-10-05', settings, entries)).toEqual({ status: 'acne', planDay: 1 });
    expect(nextSkinPlan('2026-10-05', settings, entries, 'damaged')).toEqual({ status: 'damaged', planDay: 1 });
  });

  it('没有历史时等待选择状态，手动选择后从第 1 天开始', () => {
    expect(resolveSkinRecord('2026-10-05', settings, {})).toEqual({});
    expect(resolveSkinRecord('2026-10-05', settings, {}, { status: 'acne' })).toEqual({ status: 'acne', planDay: 1 });
  });

  it('保留正在编辑的实际记录与手动天数，旧记录按当天用药补齐', () => {
    const entries = history({ '2026-10-01': { status: 'acne', medication: '炉甘石' } });
    const manual: SkinRecord = { status: 'acne', planDay: 1, season: 'summer', medication: '个人用药', morningProducts: '个人用品' };
    expect(resolveSkinRecord('2026-10-05', settings, entries, manual)).toEqual(manual);
    expect(resolveSkinRecord('2026-10-05', settings, entries, { eveningMedication: '阿达帕林' }))
      .toEqual({ status: 'acne', planDay: 2, eveningMedication: '阿达帕林' });
  });

  it('自定义药名沿用明确保存的步骤，无关含酸词不冒充第 3 天', () => {
    expect(nextSkinPlan('2026-10-05', settings, history({ '2026-10-04': { status: 'acne', planDay: 2, medication: '个人药物' } })))
      .toEqual({ status: 'acne', planDay: 3 });
    expect(nextSkinPlan('2026-10-05', settings, history({ '2026-10-04': { medication: '玻尿酸' } }))).toEqual({});
  });

  it('多天方案结束后等待选择，只有打开循环才回第 1 天', () => {
    const entries = history({ '2026-10-04': { status: 'acne', medication: '酸' } });
    expect(nextSkinPlan('2026-10-05', settings, entries)).toEqual({ status: 'acne', completed: true });
    const repeated = structuredClone(settings);
    repeated.plans.acne.repeat = true;
    expect(nextSkinPlan('2026-10-05', parseSkinSettings(repeated), entries)).toEqual({ status: 'acne', planDay: 1 });
    expect(resolveSkinRecord('2026-10-05', settings, entries)).toEqual({ status: 'acne' });
  });

  it('单天护理始终沿用第 1 天，秋冬用霜、春夏用乳', () => {
    expect(nextSkinPlan('2026-10-05', settings, history({ '2026-10-04': { status: 'damaged', medication: '生长因子' } })))
      .toEqual({ status: 'damaged', planDay: 1 });
    for (const season of ['autumn', 'winter'] as const) expect(skinPlanValues(settings, 'acne', 1, season).morningProducts).toBe('珂润霜');
    for (const season of ['spring', 'summer'] as const) expect(skinPlanValues(settings, 'damaged', 1, season).eveningProducts).toBe('珂润乳');
  });

  it('痘印和局部用药可与任一整体肤况共存，基础方案不变', () => {
    for (const status of ['healthy', 'damaged', 'acne', 'allergic'] as const) {
      const base = skinPlanValues(settings, status, 1, 'autumn');
      const skin = { status, acneMarks: true, ...base, ...skinLocalPlanValues(settings, { acneMarks: true }) };
      const saved = parseLifeEdit({ kind: 'skin', date: '2026-10-05', text: '', revision: '', mutationId: 'skin-marks-123456789', skin });
      expect(saved.skin).toEqual({ status, acneMarks: true, ...base, localMedication: '积雪苷' });
      expect(base).not.toHaveProperty('localMedication');
      expect(entrySummary('skin', { text: '', revision: '', skin })).toContain('局部用药 · 积雪苷');
      expect(entrySummary('skin', { text: '', revision: '', skin })).toContain('痘印');
    }
    expect(skinPlanValues(settings, 'healthy', 1, 'autumn').morningProducts).toBe('');
    expect(skinPlanValues(settings, 'damaged', 1, 'autumn').morningProducts).toBe('珂润霜');
  });

  it('局部用药不推断整体肤况，也不推进痤疮用药天数', () => {
    expect(resolveSkinRecord('2026-10-05', settings, {}, { acneMarks: true, localMedication: '炉甘石' }))
      .toEqual({ acneMarks: true, localMedication: '炉甘石' });
    const entries = history({
      '2026-10-01': { status: 'acne', medication: '炉甘石' },
      '2026-10-02': { status: 'acne', planDay: 2, acneMarks: true, localMedication: '阿达帕林' },
    });
    expect(nextSkinPlan('2026-10-05', settings, entries)).toEqual({ status: 'acne', planDay: 2 });
  });

  it('痘印跨肤况接续，取消后不再自动出现，历史和未来记录互不覆盖', () => {
    const entries = history({
      '2026-10-07': { status: 'healthy', acneMarks: true },
      '2026-10-03': { status: 'healthy' },
      '2026-10-01': { status: 'acne', acneMarks: true, localMedication: '积雪苷' },
      '2026-10-05': { status: 'damaged', acneMarks: false },
    });
    expect(resolveSkinRecord('2026-10-04', settings, entries)).toEqual({ status: 'healthy', planDay: 1, acneMarks: true });
    expect(resolveSkinRecord('2026-10-06', settings, entries)).toEqual({ status: 'damaged', planDay: 1, acneMarks: false });
    expect(resolveSkinRecord('2026-10-04', settings, entries, { status: 'allergic', acneMarks: false }))
      .toEqual({ status: 'allergic', planDay: 1, acneMarks: false });
    expect(resolveSkinRecord('2026-09-30', settings, entries)).toEqual({});
  });

  it('已有个人方案也能使用默认局部方案，修改或清空只影响局部', () => {
    const legacy = structuredClone(settings);
    delete legacy.acneMarksMedication;
    expect(skinLocalPlanValues(parseSkinSettings(legacy), { acneMarks: true })).toEqual({ localMedication: '积雪苷' });
    for (const medication of ['个人局部用药', '']) {
      const updated = parseSkinSettings({ ...legacy, acneMarksMedication: medication });
      expect(skinLocalPlanValues(updated, { acneMarks: true })).toEqual({ localMedication: medication });
      expect(updated.plans).toEqual(legacy.plans);
      expect(updated.products).toEqual(legacy.products);
      expect(skinLocalPlanValues(updated, { acneMarks: false })).toEqual({});
    }
    expect(() => parseSkinSettings({ ...legacy, acneMarksMedication: 'a'.repeat(501) })).toThrow();
    expect(() => parseSkinSettings({ ...legacy, acneMarksMedication: null })).toThrow();
  });

  it('拒绝非法副状态和局部用药，兼容旧记录及显式取消', () => {
    expect(parseSkinRecord({ status: 'healthy' })).toEqual({ status: 'healthy' });
    expect(parseSkinRecord({ acneMarks: false, localMedication: '' })).toEqual({ acneMarks: false, localMedication: '' });
    for (const acneMarks of ['true', 1, null, {}]) expect(() => parseSkinRecord({ acneMarks })).toThrow();
    expect(() => parseSkinRecord({ localMedication: 'a'.repeat(501) })).toThrow();
  });
});
