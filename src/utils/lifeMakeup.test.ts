import { describe, expect, it } from 'vitest';
import { entrySummary, parseLifeEdit } from './bonLife';
import { EMPTY_MAKEUP, hydrateMakeupEntries, makeupSummary, parseMakeupRecord, syncMakeupEntries } from './lifeMakeup';

describe('每日化妆共享记录', () => {
  it('区分未记录、有、无，两项可独立选择，旧记录不默认无', () => {
    expect(makeupSummary()).toEqual([]);
    for (const face of [true, false, null]) for (const eyes of [true, false, null]) {
      expect(parseMakeupRecord({ face, eyes, revision: '' })).toEqual({ face, eyes, revision: '' });
    }
    expect(makeupSummary({ face: false, eyes: true, revision: '' })).toEqual(['无化妆', '有眼妆']);
    expect(makeupSummary(EMPTY_MAKEUP)).toEqual([]);
    for (const value of [{ face: 'false', eyes: null, revision: '' }, { face: false, revision: '' }, [], null]) {
      expect(() => parseMakeupRecord(value)).toThrow();
    }
  });
  it('仅皮肤和眼睛允许写入，摘要保留症状和备注', () => {
    const edit = { date: '2026-10-06', text: '备注', revision: '', mutationId: 'makeup-mutation-123', makeup: { face: true, eyes: false, revision: '' } };
    for (const kind of ['skin', 'eyes']) expect(parseLifeEdit({ ...edit, kind }).makeup).toEqual(edit.makeup);
    expect(() => parseLifeEdit({ ...edit, kind: 'mood' })).toThrow();
    expect(entrySummary('skin', { ...edit, skin: { status: 'healthy' } })).toBe('健康\n有化妆\n无眼妆\n备注');
  });
  it('两个页面共用同一天的状态，保留各自内容、版本和其他日期', () => {
    const entries = { 'skin:2026-10-06': { text: '皮肤备注', revision: 's', skin: { status: 'healthy' as const } },
      'eyes:2026-10-06': { text: '眼睛备注', revision: 'e' }, 'eyes:2026-10-07': { text: '另一天', revision: 'e7' } };
    const makeup = { face: true, eyes: false, revision: 'shared' };
    const result = hydrateMakeupEntries({ ...entries, 'makeup:2026-10-06': { text: '', revision: 'shared', makeup } });
    expect(result['skin:2026-10-06']).toEqual({ ...entries['skin:2026-10-06'], makeup });
    expect(result['eyes:2026-10-06']).toEqual({ ...entries['eyes:2026-10-06'], makeup });
    expect(result['eyes:2026-10-07']).toEqual(entries['eyes:2026-10-07']);
    expect(result).not.toHaveProperty('makeup:2026-10-06');
    expect(syncMakeupEntries(result, '2026-10-06', { ...EMPTY_MAKEUP, revision: 'cleared' })['skin:2026-10-06'].makeup)
      .toEqual({ ...EMPTY_MAKEUP, revision: 'cleared' });
    expect(entries['skin:2026-10-06']).not.toHaveProperty('makeup');
  });
  it('另一页没有症状记录时也可显示化妆状态，不制造症状或版本', () => {
    const makeup = { face: false, eyes: false, revision: 'shared' };
    expect(syncMakeupEntries({}, '2026-10-06', makeup)).toEqual({
      'skin:2026-10-06': { text: '', revision: '', makeup }, 'eyes:2026-10-06': { text: '', revision: '', makeup },
    });
    expect(hydrateMakeupEntries({})).toEqual({});
  });
});
