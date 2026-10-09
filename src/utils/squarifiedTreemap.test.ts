import { describe, it, expect } from 'vitest';
import { squarifiedTreemap } from './squarifiedTreemap';

describe('squarifiedTreemap', () => {
  it('面积严格按 value 比例分配，无缝隙无重叠', () => {
    const rects = squarifiedTreemap(
      [
        { id: 'a', value: 50 },
        { id: 'b', value: 30 },
        { id: 'c', value: 20 },
        { id: 'd', value: 10 },
      ],
      400,
      128,
    );
    expect(rects).toHaveLength(4);
    const total = 50 + 30 + 20 + 10;
    const area = 400 * 128;
    for (const r of rects) {
      expect(r.width).toBeGreaterThan(0);
      expect(r.height).toBeGreaterThan(0);
    }
    const sumArea = rects.reduce((s, r) => s + r.width * r.height, 0);
    expect(Math.round(sumArea)).toBe(area);
    // 各块面积与 value 占比一致
    for (const r of rects) {
      const input = [50, 30, 20, 10][['a', 'b', 'c', 'd'].indexOf(r.id)];
      expect(Math.abs(r.width * r.height - (input / total) * area)).toBeLessThan(1e-6);
    }
  });

  it('空输入或零总和返回空数组', () => {
    expect(squarifiedTreemap([], 100, 100)).toEqual([]);
    expect(squarifiedTreemap([{ id: 'a', value: 0 }], 100, 100)).toEqual([]);
    expect(squarifiedTreemap([{ id: 'a', value: 10 }], 0, 100)).toEqual([]);
  });

  it('单元素铺满整个矩形', () => {
    const rects = squarifiedTreemap([{ id: 'solo', value: 42 }], 200, 128);
    expect(rects).toEqual([{ id: 'solo', x: 0, y: 0, width: 200, height: 128 }]);
  });
});
