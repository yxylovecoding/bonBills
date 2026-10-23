import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import AlipayActualPanel from './AlipayActualPanel';
import type { AlipayActualSnapshot } from '../models/types';

const state = vi.hoisted(() => ({ config: { alipayActualSnapshots: {} as Record<string, AlipayActualSnapshot> } }));
vi.mock('../stores/configStore', () => ({ useConfigStore: (selector: (value: typeof state) => unknown) => selector(state) }));
vi.mock('../hooks/useAlipayActualNavs', () => ({ useAlipayActualNavs: () => ({ results: {}, loading: false, failed: false, retry: () => {} }) }));
vi.mock('./AlipayScreenshotImport', () => ({ default: () => <button>导入截图</button> }));
vi.mock('./AlipayCorrectionButton', () => ({ default: () => <button>更新持仓</button> }));

describe('支付宝实时持仓与导入记录', () => {
  it('存在旧实录时仍展示共享账本，实录仅放在折叠记录中', () => {
    state.config.alipayActualSnapshots = { '2026-09-15': { date: '2026-09-15', funds: [{
      code: '017641', name: '旧截图基金', totalAmount: 200, holdingProfit: 50, shares: 100, costPrice: 1.5, amountKind: 'confirmed',
    }], orders: [] } };
    const before = JSON.stringify(state.config);
    const html = renderToStaticMarkup(<AlipayActualPanel yearMonth="2026-09" items={{}} fallback={<div>共享账本份额125</div>} />);
    expect(html).toContain('共享账本份额125');
    expect(html.indexOf('共享账本份额125')).toBeLessThan(html.indexOf('<summary>导入记录</summary>'));
    expect(html.indexOf('旧截图基金')).toBeGreaterThan(html.indexOf('<summary>导入记录</summary>'));
    expect(html).not.toContain('<details open');
    expect(JSON.stringify(state.config)).toBe(before);
  });
  it('没有实录也使用同一账本视图', () => {
    state.config.alipayActualSnapshots = {};
    const html = renderToStaticMarkup(<AlipayActualPanel yearMonth="2026-09" items={{}} fallback={<div>共享账本份额125</div>} />);
    expect(html).toContain('共享账本份额125');
    expect(html).not.toContain('<summary>导入记录</summary>');
  });
});
