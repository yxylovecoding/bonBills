import type { AccountSnapshot, InvestKey } from '../models/types';
import { useSnapshotStore } from '../stores/snapshotStore';

export const FINANCE_SCREENSHOT_DRAFT_EVENT = 'monthlyBills:finance-screenshot-draft';

export type ScreenshotImportMode = 'accounts' | 'investments';
export type ScreenshotCurrency = 'CNY' | 'USD' | 'UNKNOWN';
export type ScreenshotRow = {
  section: string;
  name: string;
  amount: number;
  currency: ScreenshotCurrency;
  mappedTo: string | null;
  confidence: number;
};
export type ScreenshotUsStockHolding = {
  name: string;
  symbol: string | null;
  amount: number;
  currency: ScreenshotCurrency;
  confidence: number;
};
export type ScreenshotParseResult = {
  mode: 'accounts' | 'investments' | 'mixed' | 'unknown';
  totals: {
    netAssetsCny: number | null;
    totalAssetsCny: number | null;
    liabilitiesCny: number | null;
    investTotalCny: number | null;
    investProfitCny: number | null;
  };
  accounts: Record<keyof AccountSnapshot['accounts'], number | null>;
  investHoldings: Record<InvestKey, number | null>;
  usStockHoldings: ScreenshotUsStockHolding[];
  recognizedRows: ScreenshotRow[];
  notes: string[];
};
export type FinanceScreenshotDraftEventDetail = {
  draft: ScreenshotParseResult;
  fileName: string;
  file?: File;
  handled?: () => void;
};
export type FinanceScreenshotApplyResult = {
  updatedAccounts: number;
  updatedHoldings: number;
  updatedUsStockHoldings: number;
  skippedUsdUsStockHoldings: number;
};

type TesseractRecognizeResult = { data: { text: string } };
type OcrAmountToken = {
  value: number;
  currency: ScreenshotCurrency;
};

declare global {
  interface Window {
    Tesseract?: {
      recognize: (
        image: File,
        langs: string,
        options?: Record<string, unknown>,
      ) => Promise<TesseractRecognizeResult>;
    };
  }
}

const IMAGE_NAME_RE = /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i;
const OCR_AMOUNT_RE = /(?:^|[^\w])([+-]?\s*[¥$]?\s*\d[\d,]*(?:\.\d+)?|[¥$]\s*[+-]?\s*\d[\d,]*(?:\.\d+)?)/g;
const INVEST_KEYS: InvestKey[] = ['us', 'eu', 'asia', 'a', 'longBond', 'usBond', 'gold'];

const roundMoney = (value: number) => Math.round(value * 100) / 100;

export function isFinanceScreenshotFile(file: File): boolean {
  return file.type.startsWith('image/') || IMAGE_NAME_RE.test(file.name);
}

function emptyScreenshotParseResult(mode: ScreenshotImportMode): ScreenshotParseResult {
  return {
    mode,
    totals: {
      netAssetsCny: null,
      totalAssetsCny: null,
      liabilitiesCny: null,
      investTotalCny: null,
      investProfitCny: null,
    },
    accounts: {
      credit: null,
      creditMonthly: null,
      savingsCard: null,
      incomeBank: null,
      livingBank: null,
      campusCard: null,
      consumptionBank: null,
      wishJar: null,
      investCnyBank: null,
      usdLivingBank: null,
      usdConsumptionBank: null,
      usdWishJar: null,
      investUsdBank: null,
    },
    investHoldings: {
      us: null,
      eu: null,
      asia: null,
      a: null,
      longBond: null,
      usBond: null,
      gold: null,
    },
    usStockHoldings: [],
    recognizedRows: [],
    notes: [],
  };
}

function loadTesseract(): Promise<NonNullable<Window['Tesseract']>> {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-ocr="tesseract"]');
    if (existing) {
      existing.addEventListener('load', () => window.Tesseract ? resolve(window.Tesseract) : reject(new Error('OCR 加载失败')));
      existing.addEventListener('error', () => reject(new Error('OCR 加载失败')));
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    script.async = true;
    script.dataset.ocr = 'tesseract';
    script.onload = () => window.Tesseract ? resolve(window.Tesseract) : reject(new Error('OCR 加载失败'));
    script.onerror = () => reject(new Error('OCR 加载失败'));
    document.head.appendChild(script);
  });
}

function parseOcrAmounts(raw: string): OcrAmountToken[] {
  const tokens: OcrAmountToken[] = [];
  for (const match of raw.matchAll(OCR_AMOUNT_RE)) {
    const token = (match[1] ?? '').trim();
    const value = Number(token.replace(/[¥$,\s]/g, ''));
    if (!Number.isFinite(value)) continue;
    tokens.push({
      value,
      currency: token.includes('$') ? 'USD' : token.includes('¥') ? 'CNY' : 'UNKNOWN',
    });
  }
  return tokens;
}

function pickOcrAmount(raw: string, options?: { currency?: ScreenshotCurrency; pick?: 'first' | 'last' }): OcrAmountToken | null {
  const amounts = parseOcrAmounts(raw);
  if (amounts.length === 0) return null;
  const preferred = options?.currency ? amounts.filter((item) => item.currency === options.currency) : [];
  const pool = preferred.length > 0 ? preferred : amounts;
  return options?.pick === 'first' ? pool[0] : pool[pool.length - 1];
}

function findLabeledAmount(
  lines: string[],
  pattern: RegExp,
  options?: { currency?: ScreenshotCurrency; pick?: 'first' | 'last'; lookahead?: number },
): OcrAmountToken | null {
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(pattern);
    if (!match) continue;
    const tail = typeof match.index === 'number' ? lines[i].slice(match.index + match[0].length) : lines[i];
    const sameLine = pickOcrAmount(tail, options);
    if (sameLine) return sameLine;
    const lookahead = options?.lookahead ?? 1;
    for (let offset = 1; offset <= lookahead && i + offset < lines.length; offset += 1) {
      const nextLine = pickOcrAmount(lines[i + offset], options);
      if (nextLine) return nextLine;
    }
  }
  return null;
}

function pushOcrRow(result: ScreenshotParseResult, section: string, name: string, amount: number | null, currency: ScreenshotCurrency, mappedTo: string | null) {
  if (amount === null) return;
  result.recognizedRows.push({ section, name, amount, currency, mappedTo, confidence: 0.7 });
}

function parseAccountsOcr(text: string): ScreenshotParseResult {
  const result = emptyScreenshotParseResult('accounts');
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const livingParts = [
    ['建设银行', findLabeledAmount(lines, /建设银行|建行/, { currency: 'CNY', pick: 'last', lookahead: 2 })],
    ['微信钱包', findLabeledAmount(lines, /微信钱包|微信/, { currency: 'CNY', pick: 'last', lookahead: 2 })],
  ] as const;
  const living = livingParts.some(([, amount]) => amount !== null)
    ? roundMoney(livingParts.reduce((sum, [, amount]) => sum + (amount?.value ?? 0), 0))
    : null;
  const consumption = findLabeledAmount(lines, /^消费/, { pick: 'last', lookahead: 1 })?.value ?? null;
  const income = findLabeledAmount(lines, /^收入/, { pick: 'last', lookahead: 1 })?.value ?? null;
  const campus = findLabeledAmount(lines, /校园卡/, { currency: 'CNY', pick: 'last', lookahead: 1 })?.value ?? null;
  const credit = findLabeledAmount(lines, /应付|债务/, { currency: 'CNY', pick: 'first', lookahead: 1 })?.value ?? null;
  const creditMonthly = findLabeledAmount(lines, /本期.*还|待还/, { currency: 'CNY', pick: 'first', lookahead: 1 })?.value ?? null;
  const investCny = findLabeledAmount(lines, /中国银行|中行/, { currency: 'CNY', pick: 'last', lookahead: 2 })?.value ?? null;
  const investUsd = findLabeledAmount(lines, /嘉信|Schwab|Charles/i, { currency: 'USD', pick: 'last', lookahead: 2 })?.value ?? null;
  result.accounts.livingBank = living;
  result.accounts.consumptionBank = consumption;
  result.accounts.incomeBank = income;
  result.accounts.campusCard = campus;
  result.accounts.credit = credit !== null ? Math.abs(credit) : null;
  result.accounts.creditMonthly = creditMonthly !== null ? Math.abs(creditMonthly) : null;
  result.accounts.investCnyBank = investCny;
  result.accounts.investUsdBank = investUsd;
  pushOcrRow(result, '账户', '生活=建行+微信', living, 'CNY', 'livingBank');
  for (const [label, amount] of livingParts) {
    pushOcrRow(result, '账户明细', label, amount?.value ?? null, amount?.currency ?? 'CNY', 'livingBank');
  }
  pushOcrRow(result, '账户', '消费', consumption, 'CNY', 'consumptionBank');
  pushOcrRow(result, '账户', '收入', income, 'CNY', 'incomeBank');
  pushOcrRow(result, '账户', '校园卡', campus, 'CNY', 'campusCard');
  pushOcrRow(result, '账户', '待还/债务', credit, 'CNY', 'credit');
  pushOcrRow(result, '理财现金', '中国银行=境内', investCny, 'CNY', 'investCnyBank');
  pushOcrRow(result, '理财现金', '嘉信=境外', investUsd, 'USD', 'investUsdBank');
  if (result.recognizedRows.length === 0) result.notes.push('没有识别到可映射的账户金额，可以换一张更清晰或完整的截图。');
  result.notes.push('账户规则：生活=建设银行+微信，收入取收入栏，理财现金中国银行=境内、嘉信=境外。');
  return result;
}

function firstHeaderAmount(lines: string[], pattern: RegExp): number | null {
  const line = lines.find((row) => pattern.test(row) && /\d/.test(row));
  return line ? pickOcrAmount(line, { pick: 'last' })?.value ?? null : null;
}

function sectionLines(lines: string[], start: RegExp, stop: RegExp): string[] {
  const startIndex = lines.findIndex((line) => start.test(line));
  if (startIndex < 0) return [];
  const endOffset = lines.slice(startIndex + 1).findIndex((line) => stop.test(line));
  const endIndex = endOffset < 0 ? lines.length : startIndex + 1 + endOffset;
  return lines.slice(startIndex + 1, endIndex);
}

function parseInvestmentsOcr(text: string): ScreenshotParseResult {
  const result = emptyScreenshotParseResult('investments');
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const headers: Array<[InvestKey, RegExp, string]> = [
    ['usBond', /^美债/, '美债'],
    ['us', /^美(?!债)|美国|美股/, '美股'],
    ['eu', /^欧|欧洲/, '欧洲'],
    ['asia', /^亚|亚洲/, '亚洲'],
    ['a', /^A\b|^A股|^A\s/, 'A股'],
    ['longBond', /^债(?!券20)|长债|国开债/, '长债'],
    ['gold', /^黄金|黄金/, '黄金'],
  ];
  for (const [key, pattern, label] of headers) {
    const amount = firstHeaderAmount(lines, pattern);
    result.investHoldings[key] = amount;
    pushOcrRow(result, '理财', label, amount, 'CNY', key);
  }

  const usLines = sectionLines(lines, /^美(?!债)|美国|美股/, /^(欧|欧洲|亚|亚洲|A\b|A股|债|美债|黄金)/);
  for (const line of usLines) {
    if (/最新价|今日收益|昨日收益|累计|盈亏/.test(line)) continue;
    const amountMatches = line.match(/([$¥]?)\s*[-+]?\d[\d,.]*/g);
    const amountMatch = amountMatches ? amountMatches[amountMatches.length - 1] : undefined;
    if (!amountMatch) continue;
    const amountToken = pickOcrAmount(amountMatch, { pick: 'last' });
    const amount = amountToken?.value ?? null;
    if (amount === null) continue;
    const currency: ScreenshotCurrency = amountMatch.includes('$') ? 'USD' : 'CNY';
    const name = line.slice(0, Math.max(line.lastIndexOf(amountMatch), 0)).trim() || '美股项目';
    const symbol = line.match(/\b([a-z]{2,8}|of\d{6}|sh\d{6}|sz\d{6})\b/i)?.[1]?.toUpperCase() ?? null;
    result.usStockHoldings.push({ name, symbol, amount, currency, confidence: 0.65 });
  }
  if (result.recognizedRows.length === 0 && result.usStockHoldings.length === 0) {
    result.notes.push('没有识别到可映射的理财金额，可以换一张更清晰或完整的截图。');
  }
  result.notes.push('理财截图金额按 now/当前市值写入，应用前请核对金额。');
  return result;
}

function resultCount(result: ScreenshotParseResult) {
  return Object.values(result.accounts).filter((value) => value !== null).length
    + Object.values(result.investHoldings).filter((value) => value !== null).length
    + result.usStockHoldings.length;
}

function inferScreenshotMode(text: string): ScreenshotImportMode | null {
  const accountScore = [
    /净资产|负资产|总资产.*负债/,
    /生活|消费|收入|报销|债务/,
    /建设银行|建行|微信钱包|校园卡|工商银行|交通银行|招商银行/,
    /中国银行|嘉信|Schwab|Charles/i,
  ].reduce((sum, pattern) => sum + (pattern.test(text) ? 1 : 0), 0);
  const investmentScore = [
    /累计收益|最新价|今日收益|昨日收益|累计盈亏/,
    /SPDR|iShares|ETF|QDII|标普|纳指|摩根|华安|易方达/,
    /\b(of|sh|sz)\d{6}\b/i,
    /(^|\n)(美债|美|欧|亚|A|债|黄金)/,
  ].reduce((sum, pattern) => sum + (pattern.test(text) ? 1 : 0), 0);

  if (investmentScore >= accountScore + 1) return 'investments';
  if (accountScore > 0) return 'accounts';
  if (investmentScore > 0) return 'investments';
  return null;
}

export async function parseFinanceScreenshot(file: File, preferredMode?: ScreenshotImportMode): Promise<ScreenshotParseResult> {
  const tesseract = await loadTesseract();
  const { data } = await tesseract.recognize(file, 'chi_sim+eng');
  const text = data.text;
  const mode = preferredMode ?? inferScreenshotMode(text);
  if (mode === 'accounts') return parseAccountsOcr(text);
  if (mode === 'investments') return parseInvestmentsOcr(text);

  const accounts = parseAccountsOcr(text);
  const investments = parseInvestmentsOcr(text);
  const chosen = resultCount(investments) > resultCount(accounts) ? investments : accounts;
  return { ...chosen, mode: resultCount(chosen) > 0 ? chosen.mode : 'unknown' };
}

export function screenshotDraftItemCount(draft: ScreenshotParseResult): number {
  return resultCount(draft);
}

export function financeScreenshotNeedsUsdRate(draft: ScreenshotParseResult): boolean {
  return draft.usStockHoldings.some((item) => item.currency === 'USD');
}

export async function fetchFinanceScreenshotUsdRate(): Promise<number | null> {
  try {
    const response = await fetch('/api/usd-rate');
    if (!response.ok) return null;
    const data = (await response.json()) as { rate?: number };
    const rate = Number(data.rate);
    return Number.isFinite(rate) && rate > 0 ? rate : null;
  } catch {
    return null;
  }
}

export function applyFinanceScreenshotDraftToSnapshot(draft: ScreenshotParseResult, options?: { usdRate?: number | null }): FinanceScreenshotApplyResult {
  const store = useSnapshotStore.getState();
  const accountPatch: Partial<AccountSnapshot['accounts']> = {};
  for (const [key, value] of Object.entries(draft.accounts) as [keyof AccountSnapshot['accounts'], number | null][]) {
    if (value !== null && Number.isFinite(value)) accountPatch[key] = roundMoney(value);
  }
  if (Object.keys(accountPatch).length > 0) store.updateAccounts(accountPatch);

  const holdingPatch: Partial<AccountSnapshot['investHoldings']> = {};
  for (const [key, value] of Object.entries(draft.investHoldings) as [InvestKey, number | null][]) {
    if (value !== null && Number.isFinite(value)) holdingPatch[key] = roundMoney(value);
  }
  if (Object.keys(holdingPatch).length > 0) store.updateHoldings(holdingPatch);

  let skippedUsdUsStockHoldings = 0;
  const usdRate = options?.usdRate ?? null;
  const usStockItems = draft.usStockHoldings.flatMap((item, index) => {
    if (item.currency === 'USD' && usdRate === null) {
      skippedUsdUsStockHoldings += 1;
      return [];
    }
    const amountCny = item.currency === 'USD' ? roundMoney(item.amount * usdRate!) : roundMoney(item.amount);
    return [{
      id: `shot-us-${Date.now()}-${index}`,
      name: item.name.trim() || `项目${index + 1}`,
      symbol: (item.symbol || '').trim().toUpperCase(),
      amountCny,
    }];
  });
  if (usStockItems.length > 0) {
    store.updateUsStockHoldings(usStockItems);
    const usTotal = usStockItems.reduce((sum, item) => sum + item.amountCny, 0);
    if (usTotal > 0 && (draft.investHoldings.us === null || draft.investHoldings.us === undefined)) {
      store.updateHoldings({ us: roundMoney(usTotal) });
    }
  }

  return {
    updatedAccounts: Object.keys(accountPatch).length,
    updatedHoldings: INVEST_KEYS.filter((key) => holdingPatch[key] !== undefined).length,
    updatedUsStockHoldings: usStockItems.length,
    skippedUsdUsStockHoldings,
  };
}

export async function importFinanceScreenshotFileIntoSnapshot(file: File): Promise<{
  draft: ScreenshotParseResult;
  result: FinanceScreenshotApplyResult;
  usdRate: number | null;
}> {
  const draft = await parseFinanceScreenshot(file);
  const usdRate = financeScreenshotNeedsUsdRate(draft) ? await fetchFinanceScreenshotUsdRate() : null;
  const result = applyFinanceScreenshotDraftToSnapshot(draft, { usdRate });
  return { draft, result, usdRate };
}

export function financeScreenshotImportMessage(result: FinanceScreenshotApplyResult, fileName: string): string {
  const count = result.updatedAccounts + result.updatedHoldings + result.updatedUsStockHoldings;
  const skipped = result.skippedUsdUsStockHoldings > 0 ? ` · ${result.skippedUsdUsStockHoldings} 个美元明细缺汇率` : '';
  return count > 0 ? `图片已OCR ${count} 项 · ${fileName}${skipped}` : `图片OCR未识别可写入项 · ${fileName}${skipped}`;
}
