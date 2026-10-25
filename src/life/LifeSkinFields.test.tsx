import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import LifeSkinFields from './LifeSkinFields';
import { DEFAULT_SKIN_SETTINGS, emptySkinDay, parseSkinRecord, skinMedicationAvailable, type SkinSettings } from '../utils/lifeSkin';

function picker(html: string, label: string, kind = '药品') {
  return html.match(new RegExp(`<select[^>]*aria-label="${label} · 选择${kind}"[^>]*>([\\s\\S]*?)</select>`))?.[1] ?? '';
}
function render(settings = DEFAULT_SKIN_SETTINGS, value = {}) {
  const onChange = vi.fn();
  const html = renderToStaticMarkup(<LifeSkinFields date="2026-10-23" entries={{}} value={value} settings={settings} busy={false} onChange={onChange} />);
  expect(onChange).not.toHaveBeenCalled();
  return html;
}

describe('日常记录用药时段', () => {
  it('只显示当前症状的药品，痘印副状态不引入其他肤况的药品', () => {
    const acne = render(DEFAULT_SKIN_SETTINGS, { status: 'acne', acneMarks: true, planDay: 1 });
    const damaged = render(DEFAULT_SKIN_SETTINGS, { status: 'damaged', planDay: 1 });
    const healthy = render(DEFAULT_SKIN_SETTINGS, { status: 'healthy' });
    for (const label of ['早间用药', '晚间用药']) {
      expect(picker(acne, label)).toContain('炉甘石');
      expect(picker(acne, label)).not.toContain('生长因子');
      expect(picker(damaged, label)).toContain('生长因子');
      expect(picker(damaged, label)).not.toMatch(/炉甘石|过氧|阿达帕林|酸/);
      expect(picker(healthy, label)).not.toContain('value="product:');
      expect(picker(healthy, label)).toContain('手动填写');
    }
  });

  it('早晚下拉完全隐藏不匹配药品，未设置时段的药早晚可选', () => {
    const html = render();
    expect(picker(html, '早间用药')).not.toContain('阿达帕林');
    expect(picker(html, '早间用药')).toContain('过氧');
    expect(picker(html, '晚间用药')).not.toContain('过氧');
    expect(picker(html, '晚间用药')).toContain('阿达帕林');
    for (const label of ['早间用药', '晚间用药']) expect(picker(html, label)).toContain('炉甘石');
  });

  it('以当前方案明确时段为准，支持多药名与早晚均可，不按药名推断', () => {
    const day = { ...emptySkinDay(), morningMedication: '阿达帕林、炉甘石', eveningMedication: '过氧，炉甘石' };
    const settings: SkinSettings = { ...DEFAULT_SKIN_SETTINGS, plans: { ...DEFAULT_SKIN_SETTINGS.plans, acne: { days: [day] } } };
    const html = render(settings, { status: 'acne', planDay: 1 });
    expect(picker(html, '早间用药')).toContain('阿达帕林');
    expect(picker(html, '早间用药')).not.toContain('过氧');
    expect(picker(html, '晚间用药')).toContain('过氧');
    expect(picker(html, '晚间用药')).not.toContain('阿达帕林');
    for (const label of ['早间用药', '晚间用药']) expect(picker(html, label)).toContain('炉甘石');
    expect(skinMedicationAvailable(settings, '炉甘石', 'morning', day)).toBe(true);
    expect(skinMedicationAvailable(settings, '炉甘石', 'evening', day)).toBe(true);
  });

  it('保留症状或时段不匹配、已停用和已删除的历史用药及旧字段，渲染不改写记录', () => {
    const value = { status: 'acne' as const, planDay: 2, morningMedication: '阿达帕林、旧药、生长因子', eveningMedication: '过氧', medication: '旧未分时段用药' };
    const original = structuredClone(value);
    const settings = { ...DEFAULT_SKIN_SETTINGS, products: DEFAULT_SKIN_SETTINGS.products.map((item) => ({ ...item, active: false })) };
    const html = render(settings, value);
    expect(html).toContain('早间用药 · 移除阿达帕林');
    expect(html).toContain('早间用药 · 移除旧药');
    expect(html).toContain('早间用药 · 移除生长因子');
    expect(html).toContain('晚间用药 · 移除过氧');
    expect(parseSkinRecord(value)).toEqual(original);
    expect(value).toEqual(original);
    // The same predicate also filters remembered choices after removal or a plan change.
    expect(skinMedicationAvailable(settings, '阿达帕林', 'morning')).toBe(false);
    expect(skinMedicationAvailable(settings, '过氧', 'evening')).toBe(false);
    expect(skinMedicationAvailable(settings, '旧药', 'morning')).toBe(true);
    expect(skinMedicationAvailable(DEFAULT_SKIN_SETTINGS, '生长因子', 'morning', undefined, 'acne')).toBe(false);
    expect(skinMedicationAvailable(DEFAULT_SKIN_SETTINGS, '炉甘石', 'evening', undefined, 'damaged')).toBe(false);
    expect(skinMedicationAvailable(settings, '炉甘石', 'morning', undefined, 'acne')).toBe(false);
    const day = { ...emptySkinDay(), morningMedication: '生长因子' };
    expect(skinMedicationAvailable(DEFAULT_SKIN_SETTINGS, '生长因子', 'morning', day, 'acne')).toBe(false);
  });

  it('时段标签早晚均可和不设时段保留原语义，方案天数失效也可记录', () => {
    const settings = { ...DEFAULT_SKIN_SETTINGS, products: DEFAULT_SKIN_SETTINGS.products.map((item) => ({ ...item, times: ['morning', 'evening'] as const })) };
    const compatible: SkinSettings = { ...settings, products: settings.products.map((item) => ({ ...item, times: [...item.times] })) };
    const html = render(compatible, { status: 'acne', planDay: 14 });
    for (const label of ['早间用药', '晚间用药']) {
      expect(picker(html, label)).toContain('阿达帕林');
      expect(picker(html, label)).toContain('过氧');
    }
  });
});

describe('日常记录护肤品选择', () => {
  it('同一下拉框按水乳霜、精华分组，早晚均只显示当前及沿用肤况的用品', () => {
    const acne = render(DEFAULT_SKIN_SETTINGS, { status: 'acne' });
    const damaged = render(DEFAULT_SKIN_SETTINGS, { status: 'damaged' });
    const healthy = render(DEFAULT_SKIN_SETTINGS, { status: 'healthy' });
    for (const label of ['早间护肤品', '晚间护肤品']) {
      const choices = picker(acne, label, '护肤品');
      expect(choices).toMatch(/<optgroup label="水乳霜">[^]*珂润霜[^]*珂润乳[^]*<\/optgroup><optgroup label="精华">[^]*安修泽油橄榄精华[^]*<\/optgroup>/);
      expect(choices).not.toContain('label="其他"');
      expect(picker(damaged, label, '护肤品')).toContain('珂润霜');
      expect(picker(damaged, label, '护肤品')).not.toContain('精华');
      expect(picker(healthy, label, '护肤品')).not.toContain('<optgroup');
      expect(picker(healthy, label, '护肤品')).not.toContain('value="product:');
      expect(picker(healthy, label, '护肤品')).toContain('手动填写');
    }
  });

  it('按标签归类自定义名称，其他用品仍可选择，组合名称拆分后分别归组', () => {
    const template = DEFAULT_SKIN_SETTINGS.products.find((item) => item.kind === 'skincare')!;
    const settings = { ...DEFAULT_SKIN_SETTINGS, products: [
      { ...template, id: 'tagged', name: '小棕瓶', tags: ['精华'] },
      { ...template, id: 'other', name: '面膜', tags: [] },
      { ...template, id: 'combined', name: '保湿精华水、补水精华', tags: [] },
    ] };
    const choices = picker(render(settings, { status: 'damaged' }), '早间护肤品', '护肤品');
    expect(choices.match(/<optgroup label="水乳霜">([^]*?)<\/optgroup>/)?.[1]).toContain('保湿精华水');
    const essence = choices.match(/<optgroup label="精华">([^]*?)<\/optgroup>/)?.[1];
    expect(essence).toContain('小棕瓶');
    expect(essence).toContain('补水精华');
    expect(essence).not.toContain('保湿精华水');
    expect(choices.match(/<optgroup label="其他">([^]*?)<\/optgroup>/)?.[1]).toContain('面膜');
  });

  it('已选用品继续显示且不会重复出现在选项中，历史记录不因筛选和分组改写', () => {
    const value = { status: 'damaged' as const, morningProducts: '珂润霜、安修泽油橄榄精华、旧护肤品' };
    const original = structuredClone(value);
    const html = render(DEFAULT_SKIN_SETTINGS, value);
    for (const name of ['珂润霜', '安修泽油橄榄精华', '旧护肤品']) {
      expect(html).toContain(`早间护肤品 · 移除${name}`);
      expect(picker(html, '早间护肤品', '护肤品')).not.toContain(name);
    }
    expect(value).toEqual(original);
  });
});
