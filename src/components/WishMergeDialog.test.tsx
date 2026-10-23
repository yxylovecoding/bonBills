import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { WishItem } from '../models/types';
import WishMergeDialog from './WishMergeDialog';

const makeWish = (id: string, deadline: string | null): WishItem => ({ id, name: id, deadline, targetAmount: 100, savedAmount: 0, isActive: true });

describe('合并心愿候选列表', () => {
  it('不渲染过期候选，且不改动原始心愿或合并记录', () => {
    const wishes = [makeWish('过期心愿', '2026-10-22'), makeWish('今天心愿', '2026-10-23'), makeWish('未来心愿', '2026-10-24'), makeWish('未定日期', null)];
    const original = structuredClone(wishes);
    const onMerge = vi.fn(), onUndo = vi.fn();
    const html = renderToStaticMarkup(<WishMergeDialog wishes={wishes} resolved={wishes} today="2026-10-23" trips={[]} events={[]} tripTags={{}} history={[]} onMerge={onMerge} onUndo={onUndo} onClose={() => {}} />);
    expect(html).not.toContain('选择过期心愿');
    for (const name of ['今天心愿', '未来心愿', '未定日期']) expect(html).toContain(`选择${name}`);
    expect(wishes).toEqual(original);
    expect(onMerge).not.toHaveBeenCalled();
    expect(onUndo).not.toHaveBeenCalled();
  });
  it('全部过期时提供空状态，保留历史记录的查看与撤销入口', () => {
    const wishes = [makeWish('过期结果', '2026-10-22')];
    const html = renderToStaticMarkup(<WishMergeDialog wishes={wishes} resolved={wishes} today="2026-10-23" trips={[]} events={[]} tripTags={{}}
      history={[{ id: 'merge', createdAt: '2026-10-01', sources: [makeWish('原心愿甲', '2026-10-22'), makeWish('原心愿乙', '2026-10-22')], result: wishes[0] }]}
      onMerge={() => {}} onUndo={() => {}} onClose={() => {}} />);
    expect(html).toContain('暂无可合并的心愿');
    expect(html).not.toContain('选择过期结果');
    expect(html).toContain('原心愿甲');
    expect(html).toContain('撤销合并');
  });
});
