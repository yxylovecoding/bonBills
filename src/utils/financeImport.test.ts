import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { useBillDetailStore } from '../stores/billDetailStore';
import { useMonthlyStore } from '../stores/monthlyStore';
import { usePossessionStore } from '../stores/possessionStore';
import { DEFAULT_SNAPSHOT, useSnapshotStore } from '../stores/snapshotStore';
import { captureFinanceImportState } from './importPreview';
import { importFinanceFile, runFinanceImport } from './financeImport';
import { applyFinanceScreenshotDraftToSnapshot, type ScreenshotParseResult } from './financeScreenshotOcr';
import { triggerUpload } from './syncEngine';

vi.mock('./syncEngine', () => ({
  runWithSyncPaused: vi.fn(async (run: () => Promise<unknown>) => run()),
  triggerUpload: vi.fn(async () => {}),
}));

function workbookFile(name: string, rows: unknown[][]) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), '记录');
  return new File([XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })], name);
}

describe('财务直接导入', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMonthlyStore.setState({ records: [] });
    useBillDetailStore.setState({ tagStats: {}, aggregates: {}, expenseItems: {}, incomeItems: {}, hasOverride: false });
    usePossessionStore.setState({ items: [], ignoredBillItemIds: [], tagCategory: {} });
    const current = structuredClone(DEFAULT_SNAPSHOT);
    current.accounts.livingBank = 100;
    current.accountBalanceSync = { livingBank: {
      editedAt: '2026-09-01T00:00:00+08:00', throughDate: '2026-09-01',
      transactionIdsOnDate: [], syncedAt: '2026-09-01T00:00:00+08:00',
    } };
    useSnapshotStore.setState({ current, history: [] });
  });

  it('选择账单后同时保存明细、月度汇总和账户余额，重复导入不重复扣款', async () => {
    const file = workbookFile('账单.xlsx', [
      ['日期', '收支类型', '金额', '分类', '子分类', '账户', '标签', '备注'],
      ['2026-09-02 09:00:00', '支出', 20, '日用', '洗漱', '建设银行', '周期生活', ''],
    ]);
    expect(await importFinanceFile(file)).toContain('已导入 · 账单 1 个月');
    expect(useBillDetailStore.getState().expenseItems['2026-09']).toHaveLength(1);
    expect(useMonthlyStore.getState().records[0]).toMatchObject({ yearMonth: '2026-09', totalExpense: 20 });
    expect(useSnapshotStore.getState().current.accounts.livingBank).toBe(80);
    expect(triggerUpload).toHaveBeenCalledTimes(1);
    await importFinanceFile(file);
    expect(useSnapshotStore.getState().current.accounts.livingBank).toBe(80);
    expect(useBillDetailStore.getState().expenseItems['2026-09']).toHaveLength(1);
  });

  it('理财文件直接保存交易及持仓，重复导入不重复累计', async () => {
    const file = workbookFile('理财.xlsx', [
      ['操作日期', '类型', '理财账户', '理财代码', '单位净值', '份额', '手续费', '总金额'],
      ['2026-09-02 09:00', '买入', '南方标普红利低波50ETF联接A', 'OF008163', 1, 30, 0, 30],
    ]);
    expect(await importFinanceFile(file)).toContain('已导入 · 理财');
    const record = useMonthlyStore.getState().records.find((row) => row.yearMonth === '2026-09')!;
    expect(record.investmentTransactions).toHaveLength(1);
    expect(record.investPositionItems?.us?.[0].shares).toBe(30);
    await importFinanceFile(file);
    const repeated = useMonthlyStore.getState().records.find((row) => row.yearMonth === '2026-09')!;
    expect(repeated.investmentTransactions).toHaveLength(1);
    expect(repeated.investPositionItems?.us?.[0].shares).toBe(30);
  });

  it('中途失败恢复所有财务数据，且不上传半份导入', async () => {
    const before = captureFinanceImportState();
    await expect(runFinanceImport(async () => {
      useSnapshotStore.getState().updateAccounts({ livingBank: 0 });
      useBillDetailStore.setState({ hasOverride: true });
      usePossessionStore.setState({ ignoredBillItemIds: ['partial-import'] });
      throw new Error('解析失败');
    })).rejects.toThrow('解析失败');
    expect(captureFinanceImportState()).toEqual(before);
    expect(triggerUpload).not.toHaveBeenCalled();
  });

  it('连续导入按顺序执行，前一次失败不撤销后一次结果', async () => {
    let release!: () => void;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const first = runFinanceImport(async () => {
      useSnapshotStore.getState().updateAccounts({ livingBank: 1 });
      await wait;
      throw new Error('失败');
    });
    const rejected = expect(first).rejects.toThrow('失败');
    const second = runFinanceImport(async () => {
      expect(useSnapshotStore.getState().current.accounts.livingBank).toBe(100);
      useSnapshotStore.getState().updateAccounts({ livingBank: 80 });
    });
    release();
    await rejected;
    await second;
    expect(useSnapshotStore.getState().current.accounts.livingBank).toBe(80);
    expect(triggerUpload).toHaveBeenCalledTimes(1);
  });

  it('对账页图片继续更新独立的对账持仓，保留未识别的大类', () => {
    const draft: ScreenshotParseResult = {
      mode: 'investments',
      totals: { netAssetsCny: null, totalAssetsCny: null, liabilitiesCny: null, investTotalCny: null, investProfitCny: null },
      accounts: Object.fromEntries(Object.keys(DEFAULT_SNAPSHOT.accounts).map((key) => [key, null])) as ScreenshotParseResult['accounts'],
      investHoldings: { us: null, eu: null, asia: null, a: null, longBond: null, usBond: null, gold: null },
      usStockHoldings: [], recognizedRows: [], notes: [],
    };
    draft.investHoldings.us = 300;
    const holdings = { ...DEFAULT_SNAPSHOT.investHoldings, gold: 200 };
    applyFinanceScreenshotDraftToSnapshot(draft, { reconcileHoldings: holdings });
    expect(useSnapshotStore.getState().current.reconcileInvestHoldings).toEqual({ ...holdings, us: 300 });
    expect(useSnapshotStore.getState().current.investHoldings).toEqual(DEFAULT_SNAPSHOT.investHoldings);
  });

  it('不支持的文件不改账本', async () => {
    const before = captureFinanceImportState();
    await expect(importFinanceFile(new File(['invalid'], '账单.txt'))).rejects.toThrow('请选择 Excel、CSV 或图片文件');
    expect(captureFinanceImportState()).toEqual(before);
    expect(triggerUpload).not.toHaveBeenCalled();
  });
});
