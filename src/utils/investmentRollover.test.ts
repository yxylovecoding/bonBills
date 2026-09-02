import { beforeEach, describe, expect, it } from 'vitest';
import type { InvestPositionItem, InvestmentTransactionRecord, MonthlyRecord } from '../models/types';
import { useMonthlyStore } from '../stores/monthlyStore';
import { DEFAULT_SNAPSHOT, useSnapshotStore } from '../stores/snapshotStore';
import { syncAccountBalancesFromBill } from './accountBalanceImport';
import type { BillAccountTransaction } from './importBill';
import { importInvestmentFileIntoStores, transactionIsAfterEdit } from './importInvestments';
import {
  createInvestmentRolloverRecord,
  emptyMonthlyRecord,
  propagateInvestmentInheritance,
  replayInvestmentRecord,
} from './investmentRollover';

function position(shares: number): InvestPositionItem {
  return {
    id: 'spy',
    name: '标普',
    symbol: 'SPY',
    quoteSource: 'yahoo',
    quoteCurrency: 'CNY',
    status: 'active',
    shares,
    costPrice: 8,
    historicalProfitCny: 0,
    historicalProfitCurrency: 'CNY',
    profitInputMode: 'historical',
    lastPrice: 10,
    lastCurrency: 'CNY',
    lastFxRateToCny: 1,
  };
}

function investmentRecord(yearMonth: string, shares: number): MonthlyRecord {
  return {
    ...emptyMonthlyRecord(yearMonth),
    investPositionItems: { us: [position(shares)] },
    investBreakdown: { us: shares * 10 },
    investBreakdownProfit: { us: shares * 2 },
    investTotal: shares * 10,
    accumulatedProfit: shares * 2,
    manualAccumulatedProfit: shares * 2,
    investmentEditedAt: `${yearMonth}-28T20:00:00.000Z`,
  };
}

function buy(id: string, date: string, shares: number): InvestmentTransactionRecord {
  return {
    id,
    date,
    occurredAt: `${date}T10:00:00`,
    side: 'buy',
    name: '标普',
    symbol: 'SPY',
    groupKey: 'us',
    shares,
    price: 10,
    fee: 0,
    currency: 'CNY',
    quoteSource: 'yahoo',
  };
}

function shares(record: MonthlyRecord) {
  return record.investPositionItems?.us?.[0]?.shares;
}

describe('理财月际继承', () => {
  it('新月未手动修改时随父月 ending 更新', () => {
    const august = investmentRecord('2026-08', 10);
    const september = createInvestmentRolloverRecord(august, '2026-09');
    const changedAugust = investmentRecord('2026-08', 12);

    const records = propagateInvestmentInheritance([september, changedAugust], ['2026-08']);
    const changedSeptember = records.find((record) => record.yearMonth === '2026-09')!;

    expect(september.investmentRolledOverFrom).toBe('2026-08');
    expect(shares(changedSeptember)).toBe(12);
    expect(changedSeptember.investTotal).toBe(120);
    expect(shares(august)).toBe(10);
  });

  it('父月变化后重放本月导入交易，并按月份过滤和按 ID 防重', () => {
    const august = investmentRecord('2026-08', 10);
    const septemberBase = createInvestmentRolloverRecord(august, '2026-09');
    const ownTrade = buy('sep-buy', '2026-09-01', 2);
    const september = replayInvestmentRecord(august, {
      ...septemberBase,
      investmentTransactions: [ownTrade, ownTrade, buy('oct-buy', '2026-10-01', 50)],
      importedInvestmentTransactionIds: [ownTrade.id],
    });
    const changedAugust = investmentRecord('2026-08', 11);

    const records = propagateInvestmentInheritance([september, changedAugust], ['2026-08']);
    const changedSeptember = records.find((record) => record.yearMonth === '2026-09')!;

    expect(shares(september)).toBe(12);
    expect(shares(changedSeptember)).toBe(13);
  });

  it('本月手动修改并断开继承后不再受父月影响', () => {
    const august = investmentRecord('2026-08', 10);
    const inherited = createInvestmentRolloverRecord(august, '2026-09');
    const manualSeptember = {
      ...investmentRecord('2026-09', 15),
      investmentRolledOverFrom: undefined,
      investmentInheritanceRevision: inherited.investmentInheritanceRevision,
    };
    const changedAugust = investmentRecord('2026-08', 20);

    const records = propagateInvestmentInheritance([manualSeptember, changedAugust], ['2026-08']);
    const september = records.find((record) => record.yearMonth === '2026-09')!;

    expect(shares(september)).toBe(15);
  });

  it('多月继承链递归更新，并保留中间月份的交易', () => {
    const august = investmentRecord('2026-08', 10);
    const septemberBase = createInvestmentRolloverRecord(august, '2026-09');
    const september = replayInvestmentRecord(august, {
      ...septemberBase,
      investmentTransactions: [buy('sep-buy', '2026-09-02', 2)],
    });
    const october = createInvestmentRolloverRecord(september, '2026-10');
    const changedAugust = investmentRecord('2026-08', 11);

    const records = propagateInvestmentInheritance([october, september, changedAugust], ['2026-08']);

    expect(shares(records.find((record) => record.yearMonth === '2026-09')!)).toBe(13);
    expect(shares(records.find((record) => record.yearMonth === '2026-10')!)).toBe(13);
  });

  it('兼容只有理财总额的旧记录', () => {
    const august = { ...emptyMonthlyRecord('2026-08'), investTotal: 1234 };
    const september = createInvestmentRolloverRecord(august, '2026-09');

    expect(september.investTotal).toBe(1234);
    expect(september.investPositionItems?.aggregate?.[0]?.marketValueCny).toBe(1234);
  });

  it('支持跨年和缺月继承', () => {
    const december = investmentRecord('2026-12', 10);
    const january = createInvestmentRolloverRecord(december, '2027-01');
    const march = createInvestmentRolloverRecord(january, '2027-03');

    expect(january.investmentRolledOverFrom).toBe('2026-12');
    expect(march.investmentRolledOverFrom).toBe('2027-01');
    expect(shares(march)).toBe(10);
  });
});

describe('理财增量跨月导入', () => {
  beforeEach(() => {
    const august = investmentRecord('2026-08', 10);
    useMonthlyStore.setState({
      records: [createInvestmentRolloverRecord(august, '2026-09'), august],
    });
  });

  it('同一文件按交易日期拆月，并从更新后的父月重放本月交易', async () => {
    const file = new File([
      [
        '交易日期,交易类型,证券名称,证券代码,份额,成交价,币种,品类',
        '2026-08-31 21:00:00,买入,标普,SPY,1,10,CNY,美股',
        '2026-09-01 10:00:00,买入,标普,SPY,2,10,CNY,美股',
      ].join('\n'),
    ], '理财跨月.csv', { type: 'text/csv' });

    const first = await importInvestmentFileIntoStores(file);
    const firstRecords = useMonthlyStore.getState().records;

    expect(first.updatedMonths).toBe(2);
    expect(first.importedTransactions).toBe(2);
    expect(shares(firstRecords.find((record) => record.yearMonth === '2026-08')!)).toBe(11);
    expect(shares(firstRecords.find((record) => record.yearMonth === '2026-09')!)).toBe(13);

    const second = await importInvestmentFileIntoStores(file);
    const secondRecords = useMonthlyStore.getState().records;

    expect(second.importedTransactions).toBe(0);
    expect(shares(secondRecords.find((record) => record.yearMonth === '2026-08')!)).toBe(11);
    expect(shares(secondRecords.find((record) => record.yearMonth === '2026-09')!)).toBe(13);
  });

  it('已有账单但尚无理财状态的月份先继承再应用交易', async () => {
    const july = investmentRecord('2026-07', 10);
    useMonthlyStore.setState({
      records: [{ ...emptyMonthlyRecord('2026-08'), income: 2000 }, july],
    });
    const file = new File([
      [
        '交易日期,交易类型,证券名称,证券代码,份额,成交价,币种,品类',
        '2026-08-31 21:00:00,买入,标普,SPY,1,10,CNY,美股',
      ].join('\n'),
    ], '理财补录.csv', { type: 'text/csv' });

    await importInvestmentFileIntoStores(file);
    const august = useMonthlyStore.getState().getByYearMonth('2026-08')!;

    expect(august.income).toBe(2000);
    expect(august.investmentRolledOverFrom).toBe('2026-07');
    expect(shares(august)).toBe(11);
  });
});

describe('月度 Store 的继承断开规则', () => {
  beforeEach(() => {
    const august = investmentRecord('2026-08', 10);
    useMonthlyStore.setState({ records: [createInvestmentRolloverRecord(august, '2026-09'), august] });
  });

  it('只修改账单字段不影响继承关系', () => {
    const store = useMonthlyStore.getState();
    const september = store.getByYearMonth('2026-09')!;
    store.upsert({ ...september, income: 5000 });
    store.upsert(investmentRecord('2026-08', 12), { investmentSource: 'manual' });

    const changedSeptember = useMonthlyStore.getState().getByYearMonth('2026-09')!;
    expect(changedSeptember.income).toBe(5000);
    expect(changedSeptember.investmentRolledOverFrom).toBe('2026-08');
    expect(shares(changedSeptember)).toBe(12);
  });

  it('手动修改理财后清除继承关系', () => {
    const store = useMonthlyStore.getState();
    const september = store.getByYearMonth('2026-09')!;
    store.upsert({
      ...september,
      investPositionItems: { us: [position(15)] },
      investTotal: 150,
    }, { investmentSource: 'manual' });
    useMonthlyStore.getState().upsert(investmentRecord('2026-08', 20), { investmentSource: 'manual' });

    const changedSeptember = useMonthlyStore.getState().getByYearMonth('2026-09')!;
    expect(changedSeptember.investmentRolledOverFrom).toBeUndefined();
    expect(shares(changedSeptember)).toBe(15);
  });

  it('月初自动建立记录，并保留已经存在的账单字段', () => {
    const august = investmentRecord('2026-08', 10);
    useMonthlyStore.setState({
      records: [{ ...emptyMonthlyRecord('2026-09'), income: 3000 }, august],
    });

    const changed = useMonthlyStore.getState().ensureInvestmentMonth('2026-09');
    const september = useMonthlyStore.getState().getByYearMonth('2026-09')!;

    expect(changed).toBe(true);
    expect(september.income).toBe(3000);
    expect(september.investmentRolledOverFrom).toBe('2026-08');
    expect(shares(september)).toBe(10);
  });
});

describe('理财增量编辑时间过滤', () => {
  const editTime = '2026-08-31T20:00:00+08:00';

  it('只接收编辑时间之后的精确时间流水', () => {
    expect(transactionIsAfterEdit(buy('before', '2026-08-31', 1), editTime)).toBe(false);
    expect(transactionIsAfterEdit({
      ...buy('after', '2026-08-31', 1),
      occurredAt: '2026-08-31T21:00:00',
    }, editTime)).toBe(true);
    expect(transactionIsAfterEdit(buy('next-month', '2026-09-01', 1), editTime)).toBe(true);
  });

  it('只有日期时保留编辑同日流水，交由交易 ID 防重', () => {
    expect(transactionIsAfterEdit({
      ...buy('date-only', '2026-08-31', 1),
      occurredAt: '2026-08-31',
    }, editTime)).toBe(true);
  });
});

describe('增量账单账户余额连续计算', () => {
  const billTransaction = (
    id: string,
    occurredAt: string,
    transactionType: BillAccountTransaction['transactionType'],
    amount: number,
  ): BillAccountTransaction => ({
    id,
    date: occurredAt.slice(0, 10),
    occurredAt,
    transactionType,
    amount,
    account: '建设银行',
    category: '',
    subcategory: '',
    tags: '',
    note: '',
  });

  beforeEach(() => {
    useSnapshotStore.setState({
      current: {
        ...DEFAULT_SNAPSHOT,
        accounts: { ...DEFAULT_SNAPSHOT.accounts, livingBank: 100 },
        accountBalanceSync: {
          livingBank: {
            editedAt: '2026-08-31T12:00:00.000Z',
            throughDate: '2026-08-31',
            transactionIdsOnDate: [],
          },
        },
      },
      history: [],
    });
  });

  it('月底前后有效流水共同更新同一个当前余额', () => {
    const result = syncAccountBalancesFromBill([
      billTransaction('before-edit', '2026-08-31T19:00:00', '收入', 50),
      billTransaction('after-edit', '2026-08-31T21:00:00', '收入', 20),
      billTransaction('next-month', '2026-09-01T09:00:00', '支出', 10),
    ]);

    expect(result.appliedTransactions).toBe(2);
    expect(useSnapshotStore.getState().current.accounts.livingBank).toBe(110);
    expect(useSnapshotStore.getState().current.accountBalanceSync?.livingBank?.throughDate).toBe('2026-09-01');
  });
});
