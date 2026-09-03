import { useEffect, useRef, useState } from 'react';
import { importBillFileIntoStores } from '../utils/billImportActions';
import { formatInvestmentImportSummary, importInvestmentFileIntoStores } from '../utils/importInvestments';
import FinanceImportPreviewDialog from './FinanceImportPreviewDialog';
import {
  confirmFinanceImport,
  prepareFinanceImport,
  type FinanceImportPreviewDraft,
} from '../utils/importPreview';
import {
  FINANCE_SCREENSHOT_DRAFT_EVENT,
  applyFinanceScreenshotDraftToSnapshot,
  fetchFinanceScreenshotUsdRate,
  financeScreenshotImportMessage,
  financeScreenshotNeedsUsdRate,
  isFinanceScreenshotFile,
  parseFinanceScreenshot,
  screenshotDraftItemCount,
  type FinanceScreenshotDraftEventDetail,
  type ScreenshotParseResult,
} from '../utils/financeScreenshotOcr';

const C = { blue: '#1a73e8', red: '#ea4335', sub: '#5f6368' };

function isFileDrag(e: DragEvent) {
  return !!e.dataTransfer?.types.includes('Files');
}

function dispatchFinanceScreenshotDraft(draft: ScreenshotParseResult, file: File) {
  let handled = false;
  window.dispatchEvent(new CustomEvent<FinanceScreenshotDraftEventDetail>(FINANCE_SCREENSHOT_DRAFT_EVENT, {
    detail: {
      draft,
      fileName: file.name,
      file,
      handled: () => {
        handled = true;
      },
    },
  }));
  return handled;
}

export default function BillDropImporter() {
  const dragCounter = useRef(0);
  const clearTimer = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const [importDraft, setImportDraft] = useState<FinanceImportPreviewDraft | null>(null);
  const [confirming, setConfirming] = useState(false);

  const showMessage = (text: string, isFailed = false) => {
    setMessage(text);
    setFailed(isFailed);
    if (clearTimer.current) window.clearTimeout(clearTimer.current);
    clearTimer.current = window.setTimeout(() => setMessage(''), 4200);
  };

  useEffect(() => {
    const onEnter = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      dragCounter.current += 1;
      if (dragCounter.current === 1) setDragOver(true);
    };
    const onLeave = () => {
      dragCounter.current = Math.max(0, dragCounter.current - 1);
      if (dragCounter.current === 0) setDragOver(false);
    };
    const onOver = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onDrop = async (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      dragCounter.current = 0;
      setDragOver(false);
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      try {
        if (isFinanceScreenshotFile(file)) {
          showMessage('图片OCR中');
          const draft = await parseFinanceScreenshot(file);
          const handled = dispatchFinanceScreenshotDraft(draft, file);
          if (handled) {
            showMessage(`已识别 ${screenshotDraftItemCount(draft)} 项 · 请确认草稿`);
            return;
          }
          const prepared = await prepareFinanceImport(async () => {
            const usdRate = financeScreenshotNeedsUsdRate(draft) ? await fetchFinanceScreenshotUsdRate() : null;
            const result = applyFinanceScreenshotDraftToSnapshot(draft, { usdRate });
            const line = financeScreenshotImportMessage(result, file.name);
            return { title: `导入预览 · ${file.name}`, lines: [line], investmentMonths: [], billMonths: [], successMessage: `已导入 · ${line}` };
          });
          setImportDraft(prepared);
          showMessage('预览已生成 · 等待确认');
          return;
        }
        const isInvestment = /^理财/i.test(file.name) && /\.(xlsx?|csv)$/i.test(file.name);
        const prepared = await prepareFinanceImport(async () => {
          if (isInvestment) {
            const result = await importInvestmentFileIntoStores(file, { deferUpload: true });
            const line = `理财 ${formatInvestmentImportSummary(result)}`;
            return { title: `导入预览 · ${file.name}`, lines: [line], investmentMonths: result.months, billMonths: [], successMessage: `已导入 · ${line}`, changesOnly: true };
          }
          const result = await importBillFileIntoStores(file, { deferUpload: true });
          const balanceStatus = result.accountBalances.updatedKeys.length > 0
            ? ` · 余额 ${result.accountBalances.updatedKeys.length} 项`
            : result.accountBalances.initializedKeys.length > 0
              ? ' · 余额已接续'
              : '';
          const line = `账单 ${result.updatedMonths} 个月${balanceStatus}${result.importedPossessions > 0 ? ` · ${result.importedPossessions} 个物品动作` : ''}`;
          return { title: `导入预览 · ${file.name}`, lines: [line], investmentMonths: [], billMonths: result.months, successMessage: `已导入 · ${line}`, changesOnly: true };
        });
        setImportDraft(prepared);
        showMessage('预览已生成 · 等待确认');
      } catch (err) {
        showMessage(`导入失败：${err instanceof Error ? err.message : String(err)}`, true);
      }
    };

    document.addEventListener('dragenter', onEnter);
    document.addEventListener('dragleave', onLeave);
    document.addEventListener('dragover', onOver);
    document.addEventListener('drop', onDrop);
    return () => {
      document.removeEventListener('dragenter', onEnter);
      document.removeEventListener('dragleave', onLeave);
      document.removeEventListener('dragover', onOver);
      document.removeEventListener('drop', onDrop);
      if (clearTimer.current) window.clearTimeout(clearTimer.current);
    };
  }, []);

  const confirmDraft = async () => {
    if (!importDraft) return;
    setConfirming(true);
    try {
      await confirmFinanceImport(importDraft);
      showMessage(importDraft.meta.successMessage);
      setImportDraft(null);
    } catch (error) {
      showMessage(`导入失败：${error instanceof Error ? error.message : String(error)}`, true);
    } finally {
      setConfirming(false);
    }
  };

  return (
    <>
      {dragOver && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 999, backgroundColor: 'rgba(26,115,232,0.12)', border: '3px dashed #1a73e8', borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{ backgroundColor: '#fff', borderRadius: 12, padding: '20px 32px', fontSize: 16, fontWeight: 600, color: C.blue, boxShadow: '0 4px 20px rgba(0,0,0,0.12)' }}>
            松手导入文件
          </div>
        </div>
      )}
      {message && (
        <div style={{ position: 'fixed', left: '50%', bottom: 84, transform: 'translateX(-50%)', zIndex: 1000, maxWidth: 'calc(100vw - 32px)', width: 360, borderRadius: 10, padding: '10px 12px', backgroundColor: '#fff', color: failed ? C.red : C.sub, boxShadow: '0 6px 24px rgba(0,0,0,0.16)', fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center' }}>
          {message}
        </div>
      )}
      {importDraft && (
        <FinanceImportPreviewDialog
          draft={importDraft}
          confirming={confirming}
          onCancel={() => {
            setImportDraft(null);
            showMessage(importDraft.meta.billMonths.length > 0 ? '账单已导入 · 账户和理财未变' : '已取消导入');
          }}
          onConfirm={() => { void confirmDraft(); }}
        />
      )}
    </>
  );
}
