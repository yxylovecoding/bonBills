import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BillIncomeItem } from '../utils/importBill';
import { getAccountStorage } from '../utils/accountCache';
import { mergeSyncValue } from '../utils/syncMerge';
import { DEFAULT_CONFIG, useConfigStore } from '../stores/configStore';
import { DEFAULT_SNAPSHOT, useSnapshotStore } from '../stores/snapshotStore';
import { calculateRaiseSavings, calculateTransferAllocation, resolveRaiseSavingsSettings, resolveRecurringIncomeBaseline } from './reconcileTransfers';

const today = '2026-10-21';
const month = '2026-10';
const income = (amount: number, tags: string, patch: Partial<BillIncomeItem> = {}): BillIncomeItem => ({
  date: '2026-10-15', category: '收入', subcategory: '', account: '收入', note: '', amount, tags, ...patch,
});
const monthlyIncome = [income(6060, '周期收入'), income(1000, '波动收入')];
const savings = (items = monthlyIncome) => calculateRaiseSavings({
  incomeItems: items, today, saved: useSnapshotStore.getState().current.raiseSavingsByMonth?.[month],
});

describe('涨薪优先储蓄计算', () => {
  it('先存涨薪与波动收入的一半，再按原规则分配余额', () => {
    const result = calculateRaiseSavings({ incomeItems: monthlyIncome, today });
    expect(result).toEqual({ recurringIncome: 6060, volatileIncome: 1000, baseline: 4060, target: 1500, saved: 0, remaining: 1500 });
    expect(calculateTransferAllocation(8000, 2000, result.remaining)).toEqual({
      needsRedemption: 0, afterEssentials: 4500, invest: 2250, wishJar: 1800, consumption: 450,
    });
  });

  it.each([
    [3060, 1500, 250],
    [3060, 0, 0],
    [4060, 0, 0],
    [4060.01, 0, 0.01],
    [4060.03, 0, 0.02],
    [6060.24, 1000.06, 1500.15],
  ])('周期收入 %s、波动收入 %s 应存 %s，合并后截零并精确到分', (recurring, volatile, target) => {
    expect(calculateRaiseSavings({ incomeItems: [income(recurring, '周期收入'), income(volatile, '波动收入')], today }).target).toBe(target);
  });

  it('只取当月截至今天、明确带收入标签的实际账单，双标签只计一次', () => {
    const result = calculateRaiseSavings({ incomeItems: [
      income(4060, ' 周期收入 '),
      income(500, ' 周期收入, 波动收入,波动收入 '),
      income(100, '波动收入', { date: today }),
      income(90000, '周期收入', { date: '2026-09-30' }),
      income(90000, '周期收入', { date: '2026-10-22' }),
      income(90000, '波动收入', { date: '2026-11-01' }),
      income(90000, '其他周期收入'),
      income(90000, ''),
      income(NaN, '周期收入'),
    ], today });
    expect(result).toMatchObject({ recurringIncome: 4060, volatileIncome: 600, target: 300 });
  });

  it.each([
    { category: '出物' },
    { subcategory: ' 出物 ' },
  ])('优先排除出物＋消费，即使同时带两类收入标签：%j', (patch) => {
    const items = [income(4060, '周期收入'), income(1000, '周期收入, 波动收入, 消费 ', patch)];
    const before = structuredClone(items);
    expect(calculateRaiseSavings({ incomeItems: items, today })).toMatchObject({ recurringIncome: 4060, volatileIncome: 0, target: 0 });
    expect(items).toEqual(before);
  });

  it('单独出物、单独消费及名称包含出物时，仍按收入标签正常计算', () => {
    expect(calculateRaiseSavings({ incomeItems: [
      income(4060, '周期收入'),
      income(100, '波动收入', { category: '出物' }),
      income(200, '波动收入,消费'),
      income(300, '波动收入,消费', { category: '其他出物' }),
      income(400, '波动收入,非消费', { category: '出物' }),
      income(500, '波动收入,消费', { note: '出物' }),
    ], today })).toMatchObject({ volatileIncome: 1500, target: 750 });
  });

  it('兼容旧配置，尊重零基线，并对已存超额和空账单截零', () => {
    expect(resolveRecurringIncomeBaseline()).toBe(4060);
    expect(resolveRecurringIncomeBaseline(0)).toBe(0);
    expect(calculateRaiseSavings({ incomeItems: [income(1000, '周期收入')], today, baseline: 0 }).target).toBe(500);
    expect(calculateRaiseSavings({ incomeItems: [], today, saved: 500 }).remaining).toBe(0);
    expect(calculateRaiseSavings({ incomeItems: monthlyIncome, today, saved: 2000 }).remaining).toBe(0);
  });

  it('优先存入不按余额封顶，必要缺口继续提示赎回', () => {
    expect(calculateTransferAllocation(100, 1000, 1500)).toEqual({
      needsRedemption: 2400, afterEssentials: 0, invest: 0, wishJar: 0, consumption: 0,
    });
  });

  it('保留原有余款分配舍入', () => {
    expect(calculateTransferAllocation(1001.5, 0, 0)).toEqual({
      needsRedemption: 0, afterEssentials: 1001.5, invest: 501, wishJar: 400, consumption: 100.5,
    });
  });
});

describe('涨薪储蓄执行与持久化', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 21, 12));
    useSnapshotStore.setState({ current: {
      ...structuredClone(DEFAULT_SNAPSHOT), accounts: { ...DEFAULT_SNAPSHOT.accounts, incomeBank: 8000 },
    }, history: [] });
  });
  afterEach(() => vi.useRealTimers());

  it('新旧理财步骤同时执行时正确累加，只累计新增步骤且只发布一次状态', () => {
    const updates = vi.fn();
    const unsubscribe = useSnapshotStore.subscribe(updates);
    useSnapshotStore.getState().executeTransfers({ raiseSavings: 1500, living: 2000, invest: 2250, wishJar: 1800, consumption: 450, campusCard: 100 }, month);
    unsubscribe();
    expect(updates).toHaveBeenCalledTimes(1);
    const current = useSnapshotStore.getState().current;
    expect(current.accounts).toMatchObject({
      incomeBank: 0, investCnyBank: 3750, livingBank: 2000, consumptionBank: 450,
      campusCard: 100, credit: 100, wishJar: 0,
    });
    expect(current.raiseSavingsByMonth).toEqual({ [month]: 1500 });
    expect(Object.values(current.transfersDone).every((value) => value === 0)).toBe(true);
    expect(current.accountBalanceSync?.incomeBank?.throughDate).toBe(today);
    expect(current.accountBalanceSync?.investCnyBank?.throughDate).toBe(today);
    expect(savings().remaining).toBe(0);
  });

  it('部分转入、重新加载、再次对账和收入增加时只补尚未存入金额', async () => {
    const store = useSnapshotStore.getState();
    store.executeTransfers({ raiseSavings: 500 }, month);
    expect(savings().remaining).toBe(1000);
    expect(calculateTransferAllocation(useSnapshotStore.getState().current.accounts.incomeBank, 2000, savings().remaining).afterEssentials).toBe(4500);
    const persisted = getAccountStorage().getItem('account-snapshot');
    store.resetToDefault();
    getAccountStorage().setItem('account-snapshot', persisted!);
    await useSnapshotStore.persist.rehydrate();
    expect(savings().remaining).toBe(1000);
    store.executeTransfers({ raiseSavings: savings().remaining }, month);
    const completed = structuredClone(useSnapshotStore.getState().current);
    store.executeTransfers({}, month);
    store.executeTransfers({ raiseSavings: savings().remaining }, month);
    expect(useSnapshotStore.getState().current).toEqual(completed);
    expect(savings([...monthlyIncome, income(400, '波动收入')]).remaining).toBe(200);
    expect(savings([income(4060, '周期收入')]).remaining).toBe(0);
  });

  it('逐笔存入保留分位，普通理财不增加已存', () => {
    useSnapshotStore.getState().executeTransfers({ raiseSavings: 0.1 }, month);
    useSnapshotStore.getState().executeTransfers({ raiseSavings: 0.2, invest: 100 }, month);
    expect(useSnapshotStore.getState().current.raiseSavingsByMonth?.[month]).toBe(0.3);
    expect(useSnapshotStore.getState().current.accounts).toMatchObject({ incomeBank: 7899.7, investCnyBank: 100.3 });
  });

  it('跨月独立计算，历史快照和撤回同时恢复余额与已存记录', () => {
    const store = useSnapshotStore.getState();
    const original = structuredClone(store.current);
    store.saveSnapshot();
    store.executeTransfers({ raiseSavings: 1500 }, month);
    store.executeTransfers({ raiseSavings: 300 }, '2026-11');
    expect(useSnapshotStore.getState().current.raiseSavingsByMonth).toEqual({ '2026-10': 1500, '2026-11': 300 });
    expect(calculateRaiseSavings({
      incomeItems: [income(6060, '周期收入', { date: '2026-11-01' })], today: '2026-11-02',
      saved: useSnapshotStore.getState().current.raiseSavingsByMonth?.['2026-11'],
    }).remaining).toBe(700);
    expect(useSnapshotStore.getState().history[0]).toEqual(original);
    store.restoreCurrent(original);
    expect(useSnapshotStore.getState().current.accounts.incomeBank).toBe(8000);
    expect(savings().remaining).toBe(1500);
  });

  it('旧快照与云端新月份记录兼容，新增记录和余额可一起序列化', () => {
    const base = structuredClone(useSnapshotStore.getState().current);
    useSnapshotStore.getState().executeTransfers({ raiseSavings: 1500 }, month);
    const local = JSON.parse(JSON.stringify(useSnapshotStore.getState().current));
    const remote = { ...base, raiseSavingsByMonth: { '2026-09': 1000 } };
    const merged = mergeSyncValue(base, local, remote);
    expect(merged).toMatchObject({ accounts: { incomeBank: 6500, investCnyBank: 1500 }, raiseSavingsByMonth: { '2026-09': 1000, '2026-10': 1500 } });
  });
});


describe('涨薪存半开关与手动方式', () => {
  it('旧配置默认开启自动方式，手动零值与明确关闭保留', () => {
    expect(resolveRaiseSavingsSettings()).toEqual({ enabled: true, mode: 'automatic', manualRaiseAmount: 0 });
    expect(resolveRaiseSavingsSettings({ enabled: false, mode: 'manual', manualRaiseAmount: 0 }))
      .toEqual({ enabled: false, mode: 'manual', manualRaiseAmount: 0 });
  });

  it.each([[2000, 1000], [0, 0], [0.01, 0.01], [2000.03, 1000.02], [-10, 0], [NaN, 0]])(
    '手动涨薪 %s 时应存 %s，不受周期收入和基本线影响', (manualRaiseAmount, target) => {
      for (const incomeItems of [[], [income(6060, '周期收入')], [income(50000, '周期收入')]]) {
        expect(calculateRaiseSavings({ incomeItems, today, baseline: 0, settings: { mode: 'manual', manualRaiseAmount } }).target).toBe(target);
      }
    },
  );

  it('关闭后不预留，重开或切换方式共用原有已存金额', () => {
    const input = { incomeItems: monthlyIncome, today, saved: 500 };
    expect(calculateRaiseSavings({ ...input, settings: { enabled: false } })).toMatchObject({ target: 0, saved: 500, remaining: 0 });
    expect(calculateRaiseSavings({ ...input, settings: { mode: 'manual', manualRaiseAmount: 2000 } })).toMatchObject({ target: 1500, remaining: 1000 });
    expect(calculateRaiseSavings({ ...input, settings: { mode: 'manual', manualRaiseAmount: 600 } }).remaining).toBe(300);
    expect(calculateRaiseSavings({ ...input, saved: 1000, settings: { mode: 'manual', manualRaiseAmount: 600 } }).remaining).toBe(0);
    expect(calculateRaiseSavings({ ...input, settings: { enabled: true, mode: 'automatic' } }).remaining).toBe(1000);
  });

  it('手动模式部分执行、刷新和跨月不重复计入，普通理财独立', async () => {
    useSnapshotStore.setState({ current: structuredClone(DEFAULT_SNAPSHOT), history: [] });
    const settings = { mode: 'manual' as const, manualRaiseAmount: 2000 };
    const result = (date = today) => calculateRaiseSavings({ incomeItems: [], today: date, settings,
      saved: useSnapshotStore.getState().current.raiseSavingsByMonth?.[date.slice(0, 7)] });
    useSnapshotStore.getState().executeTransfers({ raiseSavings: 300, invest: 700 }, month);
    await useSnapshotStore.persist.rehydrate();
    expect(result().remaining).toBe(700);
    useSnapshotStore.getState().executeTransfers({ raiseSavings: result().remaining }, month);
    expect(result().remaining).toBe(0);
    expect(result('2026-11-01').remaining).toBe(1000);
    expect(useSnapshotStore.getState().current.raiseSavingsByMonth).toEqual({ [month]: 1000 });
  });

  it.each(['automatic', 'manual'] as const)('%s 方式均存波动收入的一半，关闭后不计入', (mode) => {
    const settings = { mode, manualRaiseAmount: 2000 };
    const input = { incomeItems: monthlyIncome, today, settings };
    expect(calculateRaiseSavings(input)).toMatchObject({ target: 1500, remaining: 1500 });
    expect(calculateRaiseSavings({ ...input, saved: 1000 }).remaining).toBe(500);
    expect(calculateRaiseSavings({ ...input, settings: { ...settings, enabled: false }, saved: 1000 }))
      .toMatchObject({ target: 0, saved: 1000, remaining: 0 });
  });

  it('手动涨薪为零时仍存波动收入的一半，合并金额后精确到分', () => {
    expect(calculateRaiseSavings({ incomeItems: monthlyIncome, today, settings: { mode: 'manual', manualRaiseAmount: 0 } }).target).toBe(500);
    expect(calculateRaiseSavings({ incomeItems: [income(0.01, '波动收入')], today,
      settings: { mode: 'manual', manualRaiseAmount: 0.01 } }).target).toBe(0.01);
  });

  it.each(['automatic', 'manual'] as const)('%s 方式都优先排除出物＋消费，独立标签及完整分类匹配', (mode) => {
    const incomeItems = [
      income(6060, '周期收入'),
      income(1000, '波动收入'),
      income(90000, '周期收入,波动收入, 消费 ', { category: ' 出物 ' }),
      income(90000, '波动收入,消费', { subcategory: '出物' }),
      income(100, '波动收入', { category: '出物' }),
      income(200, '波动收入,消费'),
      income(300, '波动收入,消费', { category: '其他出物' }),
      income(400, '波动收入,非消费', { category: '出物' }),
      income(500, '周期收入,波动收入'),
      income(90000, '波动收入', { date: '2026-10-22' }),
      income(90000, '波动收入', { date: '2026-09-30' }),
    ];
    const before = structuredClone(incomeItems);
    expect(calculateRaiseSavings({ incomeItems, today, settings: { mode, manualRaiseAmount: 2000 } }))
      .toMatchObject({ recurringIncome: 6060, volatileIncome: 2500, target: 2250 });
    expect(incomeItems).toEqual(before);
  });

  it('手动存完后新增波动收入只补差额，排除收入不增加目标', async () => {
    useSnapshotStore.setState({ current: { ...structuredClone(DEFAULT_SNAPSHOT), accounts: { ...DEFAULT_SNAPSHOT.accounts, incomeBank: 8000 } }, history: [] });
    const settings = { mode: 'manual' as const, manualRaiseAmount: 2000 };
    const result = (incomeItems = monthlyIncome) => calculateRaiseSavings({ incomeItems, today, settings,
      saved: useSnapshotStore.getState().current.raiseSavingsByMonth?.[month] });
    useSnapshotStore.getState().executeTransfers({ raiseSavings: result().remaining }, month);
    expect(result().remaining).toBe(0);
    await useSnapshotStore.persist.rehydrate();
    const updatedIncome = [...monthlyIncome, income(400, '波动收入'), income(90000, '波动收入,消费', { category: '出物' })];
    expect(result(updatedIncome).remaining).toBe(200);
    useSnapshotStore.getState().executeTransfers({ raiseSavings: result(updatedIncome).remaining }, month);
    expect(result(updatedIncome).remaining).toBe(0);
    expect(useSnapshotStore.getState().current).toMatchObject({ raiseSavingsByMonth: { [month]: 1700 }, accounts: { incomeBank: 6300, investCnyBank: 1700 } });
  });

  it('配置支持持久化及云端合并，开关不会丢失已填的手动金额', async () => {
    const original = useConfigStore.getState().config;
    try {
      useConfigStore.getState().setConfig({ raiseSavings: { enabled: false, mode: 'manual', manualRaiseAmount: 2000 } });
      await useConfigStore.persist.rehydrate();
      expect(useConfigStore.getState().config.raiseSavings).toEqual({ enabled: false, mode: 'manual', manualRaiseAmount: 2000 });
      const base = { raiseSavings: DEFAULT_CONFIG.raiseSavings };
      const local = { raiseSavings: { ...DEFAULT_CONFIG.raiseSavings, enabled: false } };
      const remote = { raiseSavings: { ...DEFAULT_CONFIG.raiseSavings, mode: 'manual', manualRaiseAmount: 2000 } };
      expect(mergeSyncValue(base, local, remote)).toEqual({ raiseSavings: { enabled: false, mode: 'manual', manualRaiseAmount: 2000 } });
    } finally {
      useConfigStore.setState({ config: original });
    }
  });
});
