import { importBillFileIntoStores } from './billImportActions';
import { formatInvestmentImportSummary, importInvestmentFileIntoStores } from './importInvestments';
import {
  financeScreenshotImportMessage,
  importFinanceScreenshotFileIntoSnapshot,
  isFinanceScreenshotFile,
} from './financeScreenshotOcr';
import { applyFinanceImportState, captureFinanceImportState } from './importPreview';
import { runWithSyncPaused, triggerUpload } from './syncEngine';

let importQueue: Promise<void> = Promise.resolve();

// Serialize file imports so a failed import cannot roll back another import's changes.
export function runFinanceImport<T>(run: () => Promise<T>): Promise<T> {
  const result = importQueue.then(() => runWithSyncPaused(async () => {
    const before = captureFinanceImportState();
    let imported: T;
    try {
      imported = await run();
    } catch (error) {
      applyFinanceImportState(before);
      throw error;
    }
    await triggerUpload();
    return imported;
  }));
  importQueue = result.then(() => {}, () => {});
  return result;
}

export function importFinanceFile(file: File): Promise<string> {
  return runFinanceImport(async () => {
    if (isFinanceScreenshotFile(file)) {
      const { result } = await importFinanceScreenshotFileIntoSnapshot(file);
      return financeScreenshotImportMessage(result, file.name);
    }
    if (!/\.(xlsx?|csv)$/i.test(file.name)) throw new Error('请选择 Excel、CSV 或图片文件');
    if (/^理财/i.test(file.name)) {
      const result = await importInvestmentFileIntoStores(file, { deferUpload: true });
      return `已导入 · 理财 ${formatInvestmentImportSummary(result)}`;
    }
    const result = await importBillFileIntoStores(file, { deferUpload: true });
    const balanceStatus = result.accountBalances.updatedKeys.length > 0
      ? ` · 余额 ${result.accountBalances.updatedKeys.length} 项`
      : result.accountBalances.initializedKeys.length > 0 ? ' · 余额已接续' : '';
    return `已导入 · 账单 ${result.updatedMonths} 个月${balanceStatus}${result.importedPossessions > 0 ? ` · ${result.importedPossessions} 个物品动作` : ''}`;
  });
}
