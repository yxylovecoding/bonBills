import { beforeEach, expect, it, vi } from 'vitest';
import { authorizeAccountScope, runAccountRequest } from './_accountScope';
import { migrateOwnerSchoolPeriods, OWNER_SCHOOL_PERIODS } from './_schoolPeriodsMigration';

const { get, evalCommand } = vi.hoisted(() => ({ get: vi.fn(), evalCommand: vi.fn() }));
vi.mock('@vercel/kv', () => ({ kv: { get, eval: evalCommand } }));
beforeEach(() => { vi.clearAllMocks(); evalCommand.mockResolvedValue(1); });
const scope = <T>(id: string, run: () => T) => runAccountRequest(() => { authorizeAccountScope(id); return run(); });

it('原账号只补入给定上学经历，其他账本字段和空数组不变', async () => {
  const state = { config: { schoolCity: { name: '原城市' }, incomeItems: [], wishes: [{ id: 'wish' }] }, other: [] };
  const result = await scope('legacy', () => migrateOwnerSchoolPeriods(state));
  expect(result).toEqual({ ...state, config: { ...state.config, schoolPeriods: OWNER_SCHOOL_PERIODS } });
  expect(OWNER_SCHOOL_PERIODS.map(p => [p.city?.name, p.startMonth, p.endMonth])).toEqual([
    ['南京', '2021-09', '2025-06'], ['北京', '2025-09', '2028-06'],
  ]);
  const [, keys, args] = evalCommand.mock.calls[0];
  expect(keys).toEqual(['app-config']); expect(args[0]).toBe(JSON.stringify(state));
  expect(JSON.parse(args[1])).toEqual(result);
  expect(state.config).not.toHaveProperty('schoolPeriods');
});
it('注册账号、已有阶段、手动清空和空账本不自动补入', async () => {
  const state = { config: { incomeItems: [] } };
  expect(await scope('a'.repeat(32), () => migrateOwnerSchoolPeriods(state))).toBe(state);
  for (const value of [null, {}, { config: { schoolPeriods: [] } }, { config: { schoolPeriods: OWNER_SCHOOL_PERIODS } }]) {
    expect(await scope('legacy', () => migrateOwnerSchoolPeriods(value))).toBe(value);
  }
  expect(evalCommand).not.toHaveBeenCalled();
});
it('并发修改时重新读取后再补入，不覆盖新的设置；并发保存阶段时停止', async () => {
  const before = { config: { retireAge: 55 } }, latest = { config: { retireAge: 60 } };
  evalCommand.mockResolvedValueOnce(0).mockResolvedValueOnce(1); get.mockResolvedValueOnce(latest);
  expect(await scope('legacy', () => migrateOwnerSchoolPeriods(before))).toEqual({ config: { ...latest.config, schoolPeriods: OWNER_SCHOOL_PERIODS } });
  const explicit = { config: { schoolPeriods: [] } };
  evalCommand.mockResolvedValueOnce(0); get.mockResolvedValueOnce(explicit);
  expect(await scope('legacy', () => migrateOwnerSchoolPeriods(before))).toEqual(explicit);
});
