import { beforeEach, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import type { InvestPositionItem, MonthlyRecord } from '../models/types';
import { normalizeMonthlyRecords, useMonthlyStore } from '../stores/monthlyStore';
import { confirmFinanceImport, diffInvestmentOperations, prepareFinanceImport } from './importPreview';
import { importInvestmentFileIntoStores, parseInvestmentFile } from './importInvestments';

function moneyWizInvestmentFile() {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['操作日期', '确认日期', '类型', '理财账户', '理财代码', '单位净值', '份额', '手续费', '总金额', '交易账户', '状态', '备注'],
    ['2026-09-02 21:38', '2026-09-02 21:38', '买入', '债券20+美公债指数ETF-iShares Barcla', 'tlt', 81.975, 0.4925, 0, 40.37, '嘉信', '交易成功', ''],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, '转账');
  const data = XLSX.write(workbook, { bookType: 'biff8', type: 'array' });
  return new File([data], '理财_0902213952.xls', { type: 'application/vnd.ms-excel' });
}

function fundInvestmentFile() {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['操作日期', '类型', '理财账户', '理财代码', '单位净值', '份额', '手续费', '总金额'],
    ['2026-08-01 09:00', '买入', '南方标普红利低波50ETF联接A', 'OF008163', 1, 300, 0, 300],
    ['2026-09-02 21:38', '买入', '南方标普红利低波50ETF联接A', '0F008163', 1.0542, 48.37, 0, 50.99],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, '转账');
  const data = XLSX.write(workbook, { bookType: 'biff8', type: 'array' });
  return new File([data], '理财_基金.xls', { type: 'application/vnd.ms-excel' });
}

function pendingFundFile({
  rows,
  name = '理财_待确认.xls',
}: {
  rows: unknown[][];
  name?: string;
}) {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['流水号', '操作日期', '确认日期', '类型', '理财账户', '理财代码', '单位净值', '份额', '总金额', '交易账户', '状态'],
    ...rows,
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, '理财');
  const data = XLSX.write(workbook, { bookType: 'biff8', type: 'array' });
  return new File([data], name, { type: 'application/vnd.ms-excel' });
}

function augustFundRecord(): MonthlyRecord {
  return {
    ...septemberRecord(),
    yearMonth: '2026-08',
    accumulatedProfit: 0,
    investTotal: 10,
    investmentEditedAt: '2026-08-01T00:00:00+08:00',
    investPositionItems: {
      a: [{
        id: 'fund-008163',
        name: '红利低波A',
        symbol: '008163',
        quoteSource: 'eastmoney-fund',
        quoteCurrency: 'CNY',
        status: 'active',
        shares: 10,
        costPrice: 1,
        marketValueCny: 10,
        historicalProfitCny: 0,
        historicalProfitCurrency: 'CNY',
        profitInputMode: 'historical',
      }],
    },
  };
}

function tltPosition(): InvestPositionItem {
  return {
    id: 'tlt',
    name: '债券20+美公债指数ETF-iShares Barcla',
    symbol: 'TLT',
    quoteSource: 'yahoo',
    quoteCurrency: 'USD',
    status: 'active',
    shares: 1,
    costPrice: 99.51,
    historicalProfitCny: -17.55,
    historicalProfitCurrency: 'USD',
    profitInputMode: 'historical',
    lastPrice: 81.97,
    lastCurrency: 'USD',
    lastFxRateToCny: 7,
  };
}

function septemberRecord(): MonthlyRecord {
  return {
    yearMonth: '2026-09',
    income: 0,
    totalExpense: 0,
    accumulatedProfit: -17.55,
    investTotal: 573.79,
    investPositionItems: { usBond: [tltPosition()] },
    investmentEditedAt: '2026-09-02T20:00:00+08:00',
    volatileLife: 0,
    periodicLife: 0,
    consumption: 0,
    school: 0,
    homeDays: 0,
    travelDays: 0,
    majorExpenses: [],
  };
}

describe('理财导出表导入', () => {
  beforeEach(() => {
    useMonthlyStore.setState({ records: [septemberRecord()] });
  });

  it('识别 MoneyWiz 理财列名和 TLT 买入记录', async () => {
    const transactions = await parseInvestmentFile(moneyWizInvestmentFile());

    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({
      date: '2026-09-02',
      occurredAt: '2026-09-02T21:38:00',
      side: 'buy',
      symbol: 'TLT',
      groupKey: 'usBond',
      shares: 0.4925,
      price: 81.975,
      currency: 'USD',
    });
  });

  it('把新买入份额累加到现有 TLT 持仓', async () => {
    const result = await importInvestmentFileIntoStores(moneyWizInvestmentFile());
    const tlt = useMonthlyStore.getState().records[0].investPositionItems?.usBond?.[0];

    expect(result.importedTransactions).toBe(1);
    expect(tlt?.shares).toBe(1.4925);
    expect(tlt?.costPrice).toBeCloseTo(93.7237, 4);
  });

  it('把 OF/0F 基金代码识别为同一个人民币基金', async () => {
    const transactions = await parseInvestmentFile(fundInvestmentFile());

    expect(transactions).toHaveLength(2);
    expect(transactions[0]).toMatchObject({ symbol: '008163', groupKey: 'us', currency: 'CNY', quoteSource: 'eastmoney-fund' });
    expect(transactions[1]).toMatchObject({ symbol: '008163', groupKey: 'us', currency: 'CNY', quoteSource: 'eastmoney-fund' });
  });

  it('过滤编辑时间以前的历史，只把新份额并入已有基金', async () => {
    const base = septemberRecord();
    base.investPositionItems = {
      a: [{
        id: 'manual-008163',
        name: '红利低波A',
        symbol: '008163',
        quoteSource: 'eastmoney-fund',
        quoteCurrency: 'CNY',
        status: 'active',
        shares: 494.59,
        costPrice: 1.0068,
        historicalProfitCny: 21.52,
      }],
    };
    useMonthlyStore.setState({ records: [base] });

    const result = await importInvestmentFileIntoStores(fundInvestmentFile());
    const record = useMonthlyStore.getState().records[0];

    expect(result.parsedTransactions).toBe(2);
    expect(result.eligibleTransactions).toBe(1);
    expect(result.importedTransactions).toBe(1);
    expect(record.investPositionItems?.a).toHaveLength(1);
    expect(record.investPositionItems?.a?.[0]).toMatchObject({ name: '红利低波A', symbol: '008163', shares: 542.96 });
    expect(record.investPositionItems?.us ?? []).toHaveLength(0);
  });

  it('归一化旧数据中已经生成的重复基金条目', () => {
    const base = septemberRecord();
    base.investPositionItems = {
      a: [{ ...tltPosition(), id: 'manual', name: '红利低波A', symbol: '008163', shares: 494.59, costPrice: 1.0068, historicalProfitCny: 21.52, quoteSource: 'eastmoney-fund', quoteCurrency: 'CNY' }],
      us: [{ ...tltPosition(), id: 'bad-import', name: '南方标普红利低波50ETF联接A', symbol: 'OF008163', shares: 48.37, costPrice: 1.0542, historicalProfitCny: 0 }],
    };

    const normalized = normalizeMonthlyRecords([base])[0];

    expect(normalized.investPositionItems?.a).toHaveLength(1);
    expect(normalized.investPositionItems?.a?.[0]).toMatchObject({ name: '红利低波A', symbol: '008163', shares: 542.96, quoteSource: 'eastmoney-fund', quoteCurrency: 'CNY' });
    expect(normalized.investPositionItems?.us ?? []).toHaveLength(0);
  });

  it('报价源为国内基金时保留原有资产品类', () => {
    const base = septemberRecord();
    const fund = (id: string, name: string, symbol: string): InvestPositionItem => ({
      ...tltPosition(),
      id,
      name,
      symbol,
      quoteSource: 'eastmoney-fund',
      quoteCurrency: 'CNY',
    });
    base.investPositionItems = {
      eu: [fund('eu-fund', '欧A', '012345')],
      asia: [fund('asia-fund', '日经A', '012346')],
      longBond: [fund('bond-fund', '10年国债', '012347')],
      gold: [fund('gold-fund', '黄金', '012348')],
    };

    const normalized = normalizeMonthlyRecords([base])[0];

    expect(normalized.investPositionItems?.eu?.[0]).toMatchObject({ id: 'eu-fund', symbol: '012345' });
    expect(normalized.investPositionItems?.asia?.[0]).toMatchObject({ id: 'asia-fund', symbol: '012346' });
    expect(normalized.investPositionItems?.longBond?.[0]).toMatchObject({ id: 'bond-fund', symbol: '012347' });
    expect(normalized.investPositionItems?.gold?.[0]).toMatchObject({ id: 'gold-fund', symbol: '012348' });
    expect(normalized.investPositionItems?.a ?? []).toHaveLength(0);
  });

  it('恢复被旧版本误归到A股的基金品类', () => {
    const base = septemberRecord();
    const fund = (id: string, name: string, symbol: string): InvestPositionItem => ({
      ...tltPosition(),
      id,
      name,
      symbol,
      quoteSource: 'eastmoney-fund',
      quoteCurrency: 'CNY',
    });
    base.investPositionItems = {
      a: [
        fund('us-fund', '红利低波A', '008163'),
        fund('eu-fund', '欧A', '012345'),
        fund('asia-fund', '日经A', '012346'),
        fund('bond-fund', '10年国债', '012347'),
        fund('gold-fund', '黄金', '012348'),
        fund('cn-fund', '沪深300', '012349'),
      ],
    };
    base.investmentTransactions = [{
      id: 'us-fund-buy',
      date: '2026-09-02',
      side: 'buy',
      name: '南方标普红利低波50ETF联接A',
      symbol: '008163',
      groupKey: 'a',
      shares: 1,
      price: 1,
      fee: 0,
      currency: 'CNY',
      quoteSource: 'eastmoney-fund',
    }];

    const normalized = normalizeMonthlyRecords([base])[0];

    expect(normalized.investPositionItems?.us ?? []).toHaveLength(0);
    expect(normalized.investPositionItems?.eu?.[0].id).toBe('eu-fund');
    expect(normalized.investPositionItems?.asia?.[0].id).toBe('asia-fund');
    expect(normalized.investPositionItems?.longBond?.[0].id).toBe('bond-fund');
    expect(normalized.investPositionItems?.gold?.[0].id).toBe('gold-fund');
    expect(normalized.investPositionItems?.a?.map((item) => item.id)).toEqual(['us-fund', 'cn-fund']);
    expect(normalized.investmentTransactions?.[0].groupKey).toBe('a');
  });

  it('把已被迁到美股的008163恢复到A股并保留原名', () => {
    const base = septemberRecord();
    base.investmentCategoryRepairVersion = 1;
    base.investPositionItems = {
      us: [{
        ...tltPosition(),
        id: 'red-low-vol',
        name: '红利低波A',
        symbol: '008163',
        quoteSource: 'eastmoney-fund',
        quoteCurrency: 'CNY',
      }],
    };

    const normalized = normalizeMonthlyRecords([base])[0];

    expect(normalized.investPositionItems?.a?.[0]).toMatchObject({ id: 'red-low-vol', name: '红利低波A', symbol: '008163' });
    expect(normalized.investPositionItems?.us ?? []).toHaveLength(0);
    expect(normalized.investmentCategoryRepairVersion).toBe(2);
  });

  it('品类修复完成后不再按名称移动已有持仓', () => {
    const base = septemberRecord();
    base.investmentCategoryRepairVersion = 2;
    base.investPositionItems = {
      a: [{
        ...tltPosition(),
        id: 'manual-sp500-fund',
        name: '标普基金',
        symbol: '012345',
        quoteSource: 'eastmoney-fund',
        quoteCurrency: 'CNY',
      }],
    };

    const normalized = normalizeMonthlyRecords([base])[0];

    expect(normalized.investPositionItems?.a?.[0].id).toBe('manual-sp500-fund');
    expect(normalized.investPositionItems?.us ?? []).toHaveLength(0);
  });

  it('已修复记录保持原始条目，不再跨品类合并同一代码', () => {
    const base = septemberRecord();
    base.investmentCategoryRepairVersion = 2;
    base.investPositionItems = {
      a: [{ ...tltPosition(), id: 'a-item', symbol: '008163', shares: 10 }],
      us: [{ ...tltPosition(), id: 'us-item', symbol: '008163', shares: 20 }],
    };

    const normalized = normalizeMonthlyRecords([base])[0];

    expect(normalized.investPositionItems?.a?.[0]).toMatchObject({ id: 'a-item', shares: 10 });
    expect(normalized.investPositionItems?.us?.[0]).toMatchObject({ id: 'us-item', shares: 20 });
  });

  it('预览阶段不写入，确认后才应用导入结果', async () => {
    const draft = await prepareFinanceImport(async () => {
      const result = await importInvestmentFileIntoStores(moneyWizInvestmentFile(), { deferUpload: true });
      return {
        title: '测试预览',
        lines: ['理财 1 笔'],
        investmentMonths: result.months,
        billMonths: [],
        successMessage: '已导入',
      };
    });

    expect(useMonthlyStore.getState().records[0].investPositionItems?.usBond?.[0].shares).toBe(1);
    expect(draft.after.records[0].investPositionItems?.usBond?.[0].shares).toBe(1.4925);
    expect(diffInvestmentOperations(draft.before.records, draft.after.records)).toEqual([
      expect.objectContaining({
        kind: 'transaction',
        change: 'added',
        item: expect.objectContaining({ symbol: 'TLT', side: 'buy', amount: 40.37 }),
      }),
    ]);

    await confirmFinanceImport(draft);
    expect(useMonthlyStore.getState().records[0].investPositionItems?.usBond?.[0].shares).toBe(1.4925);
  });

  it('待确认买入挂到基金下且重复导入不增加正式份额', async () => {
    useMonthlyStore.setState({ records: [augustFundRecord()] });
    const file = pendingFundFile({
      rows: [['ORDER-1', '2026-08-31 10:20', '', '买入', '南方标普红利低波50ETF联接A', 'OF008163', '', '', 100, '招商', '确认中']],
    });
    const before = structuredClone(useMonthlyStore.getState().records);

    const first = await importInvestmentFileIntoStores(file);
    const afterFirst = structuredClone(useMonthlyStore.getState().records);
    const second = await importInvestmentFileIntoStores(file);
    const fund = useMonthlyStore.getState().records[0].investPositionItems?.a?.[0];

    expect(first.newPendingBuys).toBe(1);
    expect(second.newPendingBuys).toBe(0);
    expect(fund?.shares).toBe(10);
    expect(fund?.pendingBuys).toHaveLength(1);
    expect(fund?.pendingBuys?.[0]).toMatchObject({ orderId: 'ORDER-1', amount: 100, account: '招商' });
    expect(diffInvestmentOperations(before, afterFirst)).toEqual([
      expect.objectContaining({
        kind: 'pending',
        change: 'added',
        item: expect.objectContaining({ orderId: 'ORDER-1', amount: 100 }),
      }),
    ]);
  });

  it('跨月确认越过编辑时间过滤转正，并保持历史月份待确认快照', async () => {
    useMonthlyStore.setState({ records: [augustFundRecord()] });
    await importInvestmentFileIntoStores(pendingFundFile({
      rows: [['ORDER-2', '2026-08-31 10:20', '', '买入', '南方标普红利低波50ETF联接A', '008163', '', '', 100, '招商', '待确认']],
    }));
    const august = useMonthlyStore.getState().records.find((record) => record.yearMonth === '2026-08')!;
    useMonthlyStore.setState({ records: [{ ...august, investmentEditedAt: '2026-09-05T00:00:00+08:00' }] });
    const confirmed = pendingFundFile({
      name: '理财_已确认.xls',
      rows: [['ORDER-2', '2026-08-31 10:20', '2026-09-03 09:10', '买入', '南方标普红利低波50ETF联接A', '008163', 1, 100, 100, '招商', '交易成功']],
    });

    const result = await importInvestmentFileIntoStores(confirmed);
    const records = useMonthlyStore.getState().records;
    const augustAfter = records.find((record) => record.yearMonth === '2026-08')!;
    const september = records.find((record) => record.yearMonth === '2026-09')!;

    expect(result.eligibleTransactions).toBe(0);
    expect(result.resolvedPendingBuys).toBe(1);
    expect(september.investPositionItems?.a?.[0]).toMatchObject({ shares: 110, costPrice: 1 });
    expect(september.investPositionItems?.a?.[0].pendingBuys).toBeUndefined();
    expect(augustAfter.investPositionItems?.a?.[0].pendingBuys).toHaveLength(1);

    const updatedAugustItems = structuredClone(augustAfter.investPositionItems!);
    updatedAugustItems.a![0].shares = 20;
    useMonthlyStore.getState().upsert({ ...augustAfter, investPositionItems: updatedAugustItems }, { investmentSource: 'import' });
    const propagatedSeptember = useMonthlyStore.getState().records.find((record) => record.yearMonth === '2026-09');
    expect(propagatedSeptember?.investPositionItems?.a?.[0].shares).toBe(120);
    expect(propagatedSeptember?.investPositionItems?.a?.[0].pendingBuys).toBeUndefined();

    await importInvestmentFileIntoStores(confirmed);
    expect(useMonthlyStore.getState().records.find((record) => record.yearMonth === '2026-09')?.investPositionItems?.a?.[0].shares).toBe(120);
  });

  it('无流水号的完全相同待确认操作不自动猜测转正', async () => {
    useMonthlyStore.setState({ records: [augustFundRecord()] });
    await importInvestmentFileIntoStores(pendingFundFile({
      rows: [
        ['', '2026-08-31 10:20', '', '买入', '红利低波A', '008163', '', '', 100, '招商', '确认中'],
        ['', '2026-08-31 10:20', '', '买入', '红利低波A', '008163', '', '', 100, '招商', '确认中'],
      ],
    }));

    const result = await importInvestmentFileIntoStores(pendingFundFile({
      rows: [['', '2026-08-31 10:20', '2026-09-03 09:10', '买入', '红利低波A', '008163', 1, 100, 100, '招商', '交易成功']],
    }));
    const september = useMonthlyStore.getState().records.find((record) => record.yearMonth === '2026-09');

    expect(result.resolvedPendingBuys).toBe(0);
    expect(september).toBeUndefined();
    expect(useMonthlyStore.getState().records[0].investPositionItems?.a?.[0].pendingBuys).toHaveLength(2);
  });

  it('同一文件跨月包含待确认和确认行时按月份顺序转正', async () => {
    const august = { ...augustFundRecord(), investmentEditedAt: '2026-09-05T00:00:00+08:00' };
    useMonthlyStore.setState({ records: [august] });
    useMonthlyStore.getState().ensureInvestmentMonth('2026-09');

    const result = await importInvestmentFileIntoStores(pendingFundFile({
      rows: [
        ['ORDER-3', '2026-08-31 10:20', '', '买入', '红利低波A', '008163', '', '', 100, '招商', '确认中'],
        ['ORDER-3', '2026-08-31 10:20', '2026-09-03 09:10', '买入', '红利低波A', '008163', 1, 100, 100, '招商', '交易成功'],
      ],
    }));
    const september = useMonthlyStore.getState().records.find((record) => record.yearMonth === '2026-09');

    expect(result.eligibleTransactions).toBe(0);
    expect(result.resolvedPendingBuys).toBe(1);
    expect(result.formalImportedTransactions).toBe(1);
    expect(september?.investPositionItems?.a?.[0].shares).toBe(110);
    expect(september?.investPositionItems?.a?.[0].pendingBuys).toBeUndefined();
  });

  it('新流水号身份不会重复累加旧版本已导入的同一交易', async () => {
    const record = augustFundRecord();
    record.yearMonth = '2026-09';
    record.investmentEditedAt = '2026-08-01T00:00:00+08:00';
    record.investPositionItems!.a![0].shares = 110;
    record.investmentTransactions = [{
      id: 'legacy-id',
      date: '2026-09-03',
      occurredAt: '2026-08-31T10:20:00',
      side: 'buy',
      name: '红利低波A',
      symbol: '008163',
      groupKey: 'a',
      shares: 100,
      price: 1,
      fee: 0,
      currency: 'CNY',
    }];
    record.importedInvestmentTransactionIds = ['legacy-id'];
    useMonthlyStore.setState({ records: [record] });

    const result = await importInvestmentFileIntoStores(pendingFundFile({
      rows: [['ORDER-LEGACY', '2026-08-31 10:20', '2026-09-03 09:10', '买入', '红利低波A', '008163', 1, 100, 100, '招商', '交易成功']],
    }));

    expect(result.formalImportedTransactions).toBe(0);
    expect(useMonthlyStore.getState().records[0].investPositionItems?.a?.[0].shares).toBe(110);
  });
});
