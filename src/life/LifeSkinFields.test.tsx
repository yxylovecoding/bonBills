import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import LifeSkinFields from './LifeSkinFields';
import { DEFAULT_SKIN_SETTINGS, emptySkinDay, parseSkinRecord, skinMedicationAvailable, type SkinSettings } from '../utils/lifeSkin';

function picker(html: string, label: string) {
  return html.match(new RegExp(`<select[^>]*aria-label="${label} · 选择药品"[^>]*>([\\s\\S]*?)</select>`))?.[1] ?? '';
}
function render(settings = DEFAULT_SKIN_SETTINGS, value = {}) {
  const onChange = vi.fn();
  const html = renderToStaticMarkup(<LifeSkinFields date="2026-10-23" entries={{}} value={value} settings={settings} busy={false} onChange={onChange} />);
  expect(onChange).not.toHaveBeenCalled();
  return html;
}

describe('日常记录用药时段', () => {
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

  it('保留时段不匹配、已停用和已删除的历史用药及旧字段，渲染不改写记录', () => {
    const value = { status: 'acne' as const, planDay: 2, morningMedication: '阿达帕林、旧药', eveningMedication: '过氧', medication: '旧未分时段用药' };
    const original = structuredClone(value);
    const settings = { ...DEFAULT_SKIN_SETTINGS, products: DEFAULT_SKIN_SETTINGS.products.map((item) => ({ ...item, active: false })) };
    const html = render(settings, value);
    expect(html).toContain('早间用药 · 移除阿达帕林');
    expect(html).toContain('早间用药 · 移除旧药');
    expect(html).toContain('晚间用药 · 移除过氧');
    expect(parseSkinRecord(value)).toEqual(original);
    expect(value).toEqual(original);
    // The same predicate also filters remembered choices after removal or a plan change.
    expect(skinMedicationAvailable(settings, '阿达帕林', 'morning')).toBe(false);
    expect(skinMedicationAvailable(settings, '过氧', 'evening')).toBe(false);
    expect(skinMedicationAvailable(settings, '旧药', 'morning')).toBe(true);
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
