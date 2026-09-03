import { describe, expect, it } from 'vitest';
import { DEFAULT_SNAPSHOT } from '../stores/snapshotStore';
import { accountBalanceUpdatedAt } from './importCutoffs';

describe('账户余额更新时间', () => {
  it('优先展示明确记录的最近更新时间', () => {
    expect(accountBalanceUpdatedAt({
      ...DEFAULT_SNAPSHOT,
      accountBalanceUpdatedAt: '2026-09-03T01:40:00.000Z',
      accountBalanceSync: {
        livingBank: {
          editedAt: '2026-09-03T02:00:00.000Z',
          throughDate: '2026-09-03',
          transactionIdsOnDate: [],
        },
      },
    })).toBe('2026-09-03T01:40:00.000Z');
  });

  it('兼容旧数据并取最近一次编辑或导入时间', () => {
    expect(accountBalanceUpdatedAt({
      ...DEFAULT_SNAPSHOT,
      accountBalanceSync: {
        livingBank: {
          editedAt: '2026-09-03T01:20:00.000Z',
          throughDate: '2026-09-03',
          transactionIdsOnDate: [],
        },
        incomeBank: {
          editedAt: '2026-09-03T01:10:00.000Z',
          throughDate: '2026-09-03',
          transactionIdsOnDate: [],
          syncedAt: '2026-09-03T01:40:00.000Z',
        },
      },
    })).toBe('2026-09-03T01:40:00.000Z');
  });
});
