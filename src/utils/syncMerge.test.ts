import { describe, expect, it } from 'vitest';
import { mergeSyncValue, sameSyncValue } from './syncMerge';

describe('mergeSyncValue', () => {
  it('refreshes untouched values and preserves edits to other fields', () => {
    expect(mergeSyncValue(
      { config: { amount: 10, name: 'old', removed: true } },
      { config: { amount: 20, name: 'old' } },
      { config: { amount: 10, name: 'cloud', removed: true, added: 5 } },
    )).toEqual({ config: { amount: 20, name: 'cloud', added: 5 } });
  });

  it('keeps the new local value when the same field changed on both sides', () => {
    expect(mergeSyncValue({ amount: 10 }, { amount: 20 }, { amount: 30 })).toEqual({ amount: 20 });
  });

  it('merges different months and fields in the same month without dropping new cloud months', () => {
    const base = [{ yearMonth: '2026-09', income: 10, savingsNote: '' }];
    const local = [{ yearMonth: '2026-09', income: 10, savingsNote: 'saved locally' }];
    const remote = [{ yearMonth: '2026-09', income: 20, savingsNote: '' }, { yearMonth: '2026-08', income: 30 }];
    expect(mergeSyncValue(base, local, remote)).toEqual([
      { yearMonth: '2026-09', income: 20, savingsNote: 'saved locally' },
      { yearMonth: '2026-08', income: 30 },
    ]);
  });

  it('preserves independent additions and local deletions of items', () => {
    expect(mergeSyncValue(
      [{ id: 'a', amount: 10 }, { id: 'b', amount: 20 }],
      [{ id: 'b', amount: 21 }, { id: 'local', amount: 5 }],
      [{ id: 'a', amount: 11 }, { id: 'b', amount: 20 }, { id: 'cloud', amount: 6 }],
    )).toEqual([{ id: 'b', amount: 21 }, { id: 'cloud', amount: 6 }, { id: 'local', amount: 5 }]);
  });

  it('accepts remote deletions of untouched items and keeps locally edited deleted items', () => {
    expect(mergeSyncValue(
      [{ id: 'a', value: 1 }, { id: 'b', value: 2 }],
      [{ id: 'a', value: 3 }, { id: 'b', value: 2 }],
      [],
    )).toEqual([{ id: 'a', value: 3 }]);
  });

  it('keeps user ordering while retaining remotely added items', () => {
    expect(mergeSyncValue([{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'a' }],
      [{ id: 'a', name: 'updated' }, { id: 'b' }, { id: 'c' }]))
      .toEqual([{ id: 'b' }, { id: 'a', name: 'updated' }, { id: 'c' }]);
  });

  it('preserves empty, null, false and unkeyed-list edits', () => {
    expect(mergeSyncValue({ a: true, b: 5, c: ['a'], d: 'old' },
      { a: false, b: null, c: [], d: '' }, { a: true, b: 6, c: ['a', 'b'], d: 'remote' }))
      .toEqual({ a: false, b: null, c: [], d: '' });
  });

  it('treats object property order and omitted undefined fields as equal', () => {
    expect(sameSyncValue({ a: 1, b: 2, c: undefined }, { b: 2, a: 1 })).toBe(true);
    expect(sameSyncValue([1, 2], [2, 1])).toBe(false);
  });
});
