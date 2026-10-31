import { describe, expect, it } from 'vitest';
import { compileTagLogic } from './tagLogic';

describe('行程标签逻辑筛选', () => {
  it('只选主标签时命中子行程，AND/NOT 继续作用于整笔账单', () => {
    const compiled = compileTagLogic('[26.10山西大同&临汾] AND [消费] NOT [红]');
    expect(compiled.error).not.toBeNull();
    const filter = compileTagLogic('[26.10山西大同&临汾] AND [消费] AND NOT [红]');
    expect(filter.error).toBeNull();
    expect(filter.referencedTags).toEqual(['26.10山西大同&临汾', '消费', '红']);
    expect(filter.test?.(new Set(['26.10山西临汾', '消费']))).toBe(true);
    expect(filter.test?.(new Set(['26.10山西大同', '消费', '红']))).toBe(false);
    expect(filter.test?.(new Set(['26.9山西临汾', '消费']))).toBe(false);
  });

  it('排除全程标签时也排除子行程，普通标签保持精确匹配', () => {
    const filter = compileTagLogic('[生活] AND NOT [26.10山西大同&临汾]');
    expect(filter.test?.(new Set(['波动生活', '26.10山西大同']))).toBe(false);
    expect(filter.test?.(new Set(['周期生活', '26.10太原']))).toBe(true);
    expect(compileTagLogic('[购物]').test?.(new Set(['购物中心']))).toBe(false);
  });
});
