import { describe, expect, it } from 'vitest';
import { mergeManualBackupIndex, type MonthlyBackupIndexEntry } from './_monthlyBackup';

const entry = (createdAt: string): MonthlyBackupIndexEntry => ({
  date: createdAt.slice(0, 10),
  createdAt,
  key: `sync-history:manual:${createdAt}`,
});

describe('手动备份索引', () => {
  it('按创建时间倒序保留独立快照', () => {
    const first = entry('2026-09-03T01:00:00.000Z');
    const second = entry('2026-09-03T02:00:00.000Z');
    const result = mergeManualBackupIndex([first], second);

    expect(result.retained).toEqual([second, first]);
    expect(result.removed).toEqual([]);
  });

  it('超过上限时移除最旧快照', () => {
    const oldest = entry('2026-09-03T01:00:00.000Z');
    const middle = entry('2026-09-03T02:00:00.000Z');
    const latest = entry('2026-09-03T03:00:00.000Z');
    const result = mergeManualBackupIndex([oldest, middle], latest, 2);

    expect(result.retained).toEqual([latest, middle]);
    expect(result.removed).toEqual([oldest]);
  });
});
