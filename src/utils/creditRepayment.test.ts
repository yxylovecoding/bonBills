import { describe, expect, it } from 'vitest';
import type { InvestHoldings, InvestPositionItem, MonthlyRecord } from '../models/types';
import { calculateCreditRepaymentPlan, getPlanningLongBondTotal } from './creditRepayment';
import { calculateWishInternPlan } from './wishInternPlan';

const holdings = (longBond: number): InvestHoldings => ({
  us: 0, eu: 0, asia: 0, a: 0, longBond, usBond: 0, gold: 0,
});
const position = (patch: Partial<InvestPositionItem> = {}): InvestPositionItem => ({
  id: 'long-bond', name: '长债', symbol: '', status: 'active',
  historicalProfitCny: 0, marketValueCny: 15105.1, ...patch,
});
const record = (patch: Partial<MonthlyRecord> = {}): MonthlyRecord => ({
  yearMonth: '2026-10', income: 0, totalExpense: 0,
  periodicLife: 0, volatileLife: 0, consumption: 0, school: 0,
  accumulatedProfit: 0, investTotal: 0,
  homeDays: 0, travelDays: 0, schoolDays: 0, internDays: 0,
  ...patch,
});

describe('心愿规划的长债还款', () => {
  it('使用月度持仓替代旧快照的零余额，并将抵扣传入现金规划', () => {
    const records = [record({ investPositionItems: { longBond: [position()] } })];
    const repayment = calculateCreditRepaymentPlan({
      creditMonthly: 0, creditTotal: 12000, savingsCard: 0,
      longBond: getPlanningLongBondTotal(records, '2026-10', 0),
    });
    expect(repayment).toMatchObject({
      longBondTotalForRepay: 15105.1,
      longBondRepay: 0,
      longBondRepayNext: 5105.1,
      effectiveCreditMonthly: 0,
      effectiveCreditNext: 6894.9,
    });
    const plan = calculateWishInternPlan({
      today: new Date(2026, 9, 5), deadline: '2027-07-01',
      wishes: [], incomeItems: [], tagMap: {},
      stateDailyAvg: { intern: 0, school: 0, home: 0, travel: 0 },
      repaymentsByMonth: { '2026-10': repayment.effectiveCreditMonthly, '2026-11': repayment.effectiveCreditNext },
      holidayDataByYear: {},
    });
    expect(plan.repayment).toBe(6894.9);
  });

  it('持仓明细优先于过时的分类汇总和账户快照', () => {
    expect(getPlanningLongBondTotal([record({
      investPositionItems: { longBond: [position()] },
      investBreakdown: holdings(0),
    })], '2026-10', 30000)).toBe(15105.1);
  });

  it('按持仓份额和已保存行情计价，包含暂停定投的持仓，排除已清仓', () => {
    const records = [record({ investPositionItems: { longBond: [
      position({ id: 'active', symbol: '000001', shares: 10000, lastPrice: 1.2, lastCurrency: 'CNY', marketValueCny: 1 }),
      position({ id: 'paused', status: 'paused', marketValueCny: 3105.1 }),
      position({ id: 'closed', status: 'closed', marketValueCny: 90000, historicalProfitCny: 8000 }),
    ] } })];
    expect(getPlanningLongBondTotal(records, '2026-10', 0)).toBe(15105.1);
  });

  it('尚未结转时采用最近一期持仓，忽略未来月份和仅有账单的记录', () => {
    const records = [
      record({ yearMonth: '2026-08', investBreakdown: holdings(40000) }),
      record({ yearMonth: '2026-11', investBreakdown: holdings(50000) }),
      record(),
      record({ yearMonth: '2026-09', investBreakdown: holdings(15105.1) }),
    ];
    expect(getPlanningLongBondTotal(records, '2026-10', 70000)).toBe(15105.1);
  });

  it.each([
    { investPositionItems: {} },
    { investPositionItems: { longBond: [] }, investBreakdown: holdings(30000) },
    { investBreakdown: holdings(0) },
  ])('最新持仓已清空时不恢复旧余额：%j', (patch) => {
    expect(getPlanningLongBondTotal([
      record(patch),
      record({ yearMonth: '2026-09', investBreakdown: holdings(30000) }),
    ], '2026-10', 50000)).toBe(0);
  });

  it('没有可用月度持仓时兼容原账户快照', () => {
    expect(getPlanningLongBondTotal([], '2026-10', 15105.1)).toBe(15105.1);
    expect(getPlanningLongBondTotal([record()], '2026-10', 15105.1)).toBe(15105.1);
    expect(getPlanningLongBondTotal([], '2026-10')).toBe(0);
  });

  it('储蓄卡先抵本期，长债余额在本期和下期间只使用一次', () => {
    expect(calculateCreditRepaymentPlan({
      creditMonthly: 4000, creditTotal: 12000, savingsCard: 1000, longBond: 15105.1,
    })).toMatchObject({
      longBondRepay: 3000, longBondRepayNext: 2105.1,
      longBondRepayTotal: 5105.1, effectiveCreditMonthly: 0, effectiveCreditNext: 5894.9,
    });
  });

  it('长债保留一万元，赎回金额不超过待还金额', () => {
    expect(calculateCreditRepaymentPlan({ creditTotal: 12000, longBond: 10000 }))
      .toMatchObject({ longBondRepayTotal: 0, effectiveCreditNext: 12000 });
    expect(calculateCreditRepaymentPlan({ creditTotal: 12000, longBond: 30000 }))
      .toMatchObject({ longBondRepayTotal: 12000, effectiveCreditNext: 0 });
  });
});
