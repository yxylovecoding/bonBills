import { beforeEach, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import type { InvestPositionItem, MonthlyRecord } from '../models/types';
import { useMonthlyStore } from '../stores/monthlyStore';
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
});
