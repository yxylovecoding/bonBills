import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import InvestPositionMoveMenu from './InvestPositionMoveMenu';

describe('基金股票右箭头移动菜单', () => {
  it.each([
    ['active', '移到 past'],
    ['paused', '移到 now'],
  ] as const)('%s 状态只提供反向状态切换和二级分类入口', (status, toggleLabel) => {
    const onToggleStatus = vi.fn();
    const onMoveCategory = vi.fn();
    const html = renderToStaticMarkup(<InvestPositionMoveMenu name="测试基金" status={status} currentGroup="us"
      onToggleStatus={onToggleStatus} onMoveCategory={onMoveCategory} />);
    expect(html).toContain(toggleLabel);
    expect(html).toContain('移动到其他分类');
    expect(html).not.toContain('美股 ·');
    expect(html).not.toContain('美股</button>');
    expect(html).toContain('欧股');
    expect(onToggleStatus).not.toHaveBeenCalled();
    expect(onMoveCategory).not.toHaveBeenCalled();
  });
});
