import type { AlipayActualFund, AlipayActualOrder, AlipayActualSnapshot, InvestPositionItems } from '../models/types';
import type { AlipayOcrImage } from './alipayScreenshotOcr';
import type { OcrWord } from './financeScreenshotOcr';
import { canonicalInvestmentSymbol } from './investmentInstrument';
import { AlipayActualValidationError, parseAlipayActual } from './alipayActual';

export interface AlipayFundChoice { code: string; name: string; aliases: string[] }
export interface AlipayFundDraft {
  id: string; source: string; name: string; code: string; selected: boolean; notes: string[];
  totalAmount?: number; holdingProfit?: number; shares?: number; costPrice?: number;
  nav?: number; navDate?: string; confirmedAmount?: number; pendingBuyAmount?: number;
  amountKind: 'total' | 'confirmed';
  amountMatch?: { code: string; totalAmount: number; amountKind: 'total' | 'confirmed'; inferred?: boolean };
  manualCode?: boolean;
}
export interface AlipayOrderDraft {
  id: string; source: string; name: string; code: string; selected: boolean; notes: string[];
  orderId?: string; operationAt: string; side: 'buy' | 'sell'; quantity?: number;
  unit: 'CNY' | 'shares'; status: AlipayActualOrder['status'];
  statusFromBlank?: boolean;
  navDate?: string; confirmationDate?: string; expectedConfirmationDate?: string;
  confirmedShares?: number; nav?: number; fee?: number;
}
export interface AlipayScreenshotDraft { funds: AlipayFundDraft[]; orders: AlipayOrderDraft[]; notes: string[] }
export class AlipayScreenshotValidationError extends Error {
  constructor(message: string, readonly rowId: string, readonly field: string) {
    super(message);
    this.name = 'AlipayScreenshotValidationError';
  }
}
interface Line { text: string; words: OcrWord[]; y: number; bottom: number; height: number }
const compact = (text: string) => text.normalize('NFKC').replace(/[\s·•|]/g, '').replace(/[−–—一](?=\d)/g, '-');
const brands = /华安|摩根|南方|天弘|易方达|博时|工银|嘉实|华夏|华泰柏瑞|富国|广发|招商|汇添富|鹏华|中欧|银华|景顺|国泰/;
const productText = (text: string) => {
  const clean = compact(text).replace(/三[鞭萎]/g, '三菱');
  const start = clean.search(brands);
  return start >= 0 ? clean.slice(start) : clean.replace(/^[“”"']*基金/, '');
};
const fundName = (text: string) => {
  const clean = compact(text).toUpperCase().replace(/三[鞭萎]/g, '三菱').replace(/[^\u4e00-\u9fffA-Z0-9()\-]/g, '')
    .replace(/沪深3[O0]{2}/g, '沪深300').replace(/日经22[5S]/g, '日经225')
    .replace(/ETF[链连]接/g, 'ETF联接').replace(/ETF联接基金/g, 'ETF联接')
    .replace(/\(?QD[A-Z0-9]*?\)?([ACE])$/, '$1').replace(/\(?QD[A-Z0-9]*\)?$/, '').replace(/[()\-]$/g, '');
  const start = clean.search(brands);
  return start >= 0 ? clean.slice(start) : clean.replace(/^基金/, '');
};
const numbers = (text: string) => [...text.normalize('NFKC').replace(/[−–—]/g, '-').matchAll(/[+\-]?\s*\d[\d,]*\.\d+/g)].map((match) => Number(match[0].replace(/[,\s]/g, '')));
const monthDayDate = (monthDay: string, anchor: string, direction: 'past' | 'future') => {
  const year = Number(anchor.slice(0, 4));
  const date = `${year}-${monthDay}`;
  return `${year + (direction === 'past' && date > anchor ? -1 : direction === 'future' && date < anchor ? 1 : 0)}-${monthDay}`;
};

export function alipayFundChoices(items: InvestPositionItems, snapshots: Record<string, AlipayActualSnapshot> = {}): AlipayFundChoice[] {
  const choices = new Map<string, AlipayFundChoice>();
  const add = (code: string, name: string) => {
    if (!/^\d{6}$/.test(code) || !name.trim()) return;
    const current = choices.get(code);
    choices.set(code, { code, name: name.length > (current?.name.length ?? 0) ? name : current!.name,
      aliases: [...new Set([...(current?.aliases ?? []), name])] });
  };
  for (const item of Object.values(items).flatMap((rows) => rows ?? [])) if (item.quoteSource !== 'yahoo') add(canonicalInvestmentSymbol(item.symbol), item.name);
  for (const snapshot of Object.values(snapshots)) for (const fund of snapshot.funds) add(fund.code, fund.name);
  return [...choices.values()];
}

export function matchAlipayFund(name: string, choices: AlipayFundChoice[], code = ''): string {
  if (/^\d{6}$/.test(code)) return code;
  const target = fundName(name);
  if (target.length < 5) return '';
  const shareClass = target.match(/([ACE])$/)?.[1];
  // A truncated Nikkei name cannot establish its share class, even with one known code.
  if (target.includes('日经') && !shareClass) return '';
  const truncated = /…|\.{2,}/.test(name);
  const matches = choices.filter((choice) => choice.aliases.some((alias) => {
    const candidate = fundName(alias);
    if (shareClass && candidate.match(/([ACE])$/)?.[1] !== shareClass) return false;
    if (candidate === target || (target.length >= 9 && candidate.startsWith(target))) return true;
    // A list can truncate the product name but keep its A/C/E class on the next line.
    return truncated && !!shareClass && target.length >= 10 && candidate.slice(0, -1).startsWith(target.slice(0, -1));
  }));
  return matches.length === 1 ? matches[0].code : '';
}

function nikkeiFundCandidates(row: AlipayFundDraft, choices: AlipayFundChoice[]) {
  const target = fundName(row.name);
  if (row.code || !target.includes('日经') || /[ACE]$/.test(target) || target.length < 9
    || row.totalAmount === undefined || !Number.isFinite(row.totalAmount) || row.totalAmount < 0) return [];
  const candidates = choices.flatMap((choice) => {
    const families = choice.aliases.map(fundName).filter((name) => /[AC]$/.test(name) && name.startsWith(target)).map((name) => name.slice(0, -1));
    return families.length ? [{ choice, families }] : [];
  });
  // A similar balance must not turn two different products into an A/C pair.
  if (new Set(candidates.flatMap(({ families }) => families)).size !== 1) return [];
  return candidates.map(({ choice }) => choice);
}

/** Historical candidates remain available for manual changes and single-row imports. */
export function suggestAlipayFundByAmount(row: AlipayFundDraft, choices: AlipayFundChoice[], snapshots: Record<string, AlipayActualSnapshot>, date: string) {
  const candidates = nikkeiFundCandidates(row, choices);
  const history = Object.values(snapshots).filter((snapshot) => snapshot.date <= date).sort((a, b) => b.date.localeCompare(a.date));
  const amount = row.totalAmount!;
  return candidates.flatMap((choice) => {
    const previous = history.find((snapshot) => snapshot.funds.some((fund) => fund.code === choice.code));
    const fund = previous?.funds.find((fund) => fund.code === choice.code);
    if (!fund || !previous) return [];
    const previousAmount = fund.amountKind === row.amountKind ? fund.totalAmount
      : row.amountKind === 'confirmed' ? fund.confirmedAmount : undefined;
    if (previousAmount === undefined || !Number.isFinite(previousAmount) || previousAmount < 0) return [];
    return [{ code: choice.code, name: choice.name, previousDate: previous.date, previousAmount,
      difference: Math.abs(Math.round(amount * 100) - Math.round(previousAmount * 100)) }];
  }).sort((a, b) => a.difference - b.difference || a.code.localeCompare(b.code));
}

/** Bon's default for an unlabeled Nikkei pair: the larger balance is A, the smaller C. */
export function inferAlipayFundClassesByAmount(draft: AlipayScreenshotDraft, choices: AlipayFundChoice[], snapshots: Record<string, AlipayActualSnapshot>, date: string): AlipayScreenshotDraft {
  const funds = draft.funds.map((row) => row.amountMatch?.inferred ? { ...row, code: '', amountMatch: undefined } : row);
  return { ...draft, funds: funds.map((row) => {
    if (row.manualCode || row.code) return row;
    const candidates = nikkeiFundCandidates(row, choices);
    const a = candidates.filter((choice) => choice.aliases.some((alias) => /A$/.test(fundName(alias))));
    const c = candidates.filter((choice) => choice.aliases.some((alias) => /C$/.test(fundName(alias))));
    if (candidates.length !== 2 || a.length !== 1 || c.length !== 1 || a[0].code === c[0].code) return row;
    const pair = candidates.map((choice) => choice.code).sort().join(':');
    const peers = funds.filter((other) => other.amountKind === row.amountKind && other.totalAmount !== undefined
      && Number.isFinite(other.totalAmount) && other.totalAmount >= 0
      && (candidates.some((choice) => choice.code === other.code)
        || nikkeiFundCandidates(other, choices).map((choice) => choice.code).sort().join(':') === pair));
    const cents = (value: AlipayFundDraft) => Math.round(value.totalAmount! * 100);
    const balances = [...new Set(peers.map(cents))].sort((x, y) => x - y);
    let code = '';
    if (balances.length === 2) {
      let highCode = a[0].code;
      // Explicit OCR/manual labels take precedence over the default ranking.
      const known = peers.filter((other) => other.code);
      if (known.length) highCode = cents(known[0]) === balances[1] ? known[0].code : candidates.find((choice) => choice.code !== known[0].code)!.code;
      const lowCode = candidates.find((choice) => choice.code !== highCode)!.code;
      if (known.some((other) => other.code !== (cents(other) === balances[1] ? highCode : lowCode))) return row;
      code = cents(row) === balances[1] ? highCode : lowCode;
    } else if (peers.length === 1) {
      const suggestions = suggestAlipayFundByAmount(row, choices, snapshots, date);
      if (suggestions.length === 2 && suggestions[0].difference < suggestions[1].difference) code = suggestions[0].code;
    }
    return code ? { ...row, code, amountMatch: { code, totalAmount: row.totalAmount!, amountKind: row.amountKind, inferred: true },
      notes: row.notes.filter((note) => note !== '基金待匹配') } : row;
  }) };
}

function visualLines(words: OcrWord[]): Line[] {
  const rows: Line[] = [];
  for (const word of [...words].filter((word) => word.text.trim()).sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0)) {
    const middle = (word.bbox.y0 + word.bbox.y1) / 2;
    const row = rows.slice(-5).reverse().find((line) => Math.abs(line.y + line.height / 2 - middle) <= Math.max(line.height, word.bbox.y1 - word.bbox.y0) * 0.48);
    if (row) { row.words.push(word); row.bottom = Math.max(row.bottom, word.bbox.y1); }
    else rows.push({ text: '', words: [word], y: word.bbox.y0, bottom: word.bbox.y1, height: word.bbox.y1 - word.bbox.y0 });
  }
  return rows.map((row) => ({ ...row, words: row.words.sort((a, b) => a.bbox.x0 - b.bbox.x0), text: row.words.map((word) => word.text).join(' ') }));
}

function field(lines: Line[], label: RegExp, width: number): number | undefined {
  const index = lines.findIndex((line) => label.test(compact(line.text)));
  if (index < 0) return undefined;
  const row = lines[index];
  const text = compact(row.text);
  const match = text.match(label)!;
  let offset = 0;
  const labelWords = row.words.filter((word) => {
    const start = offset; offset += compact(word.text).length;
    return offset > match.index! && start < match.index! + match[0].length;
  });
  const right = labelWords[labelWords.length - 1].bbox.x1;
  const center = (labelWords[0].bbox.x0 + right) / 2;
  const rightWords = row.words.filter((word) => word.bbox.x0 >= right);
  const boundary = rightWords.findIndex((word) => /[\u4e00-\u9fff]/.test(word.text.replace(/[元份]/g, '')));
  const sameRow = numbers((boundary < 0 ? rightWords : rightWords.slice(0, boundary)).map((word) => word.text).join(' '))[0];
  if (sameRow !== undefined) return sameRow;
  if (boundary >= 0 && numbers(row.text).length) return undefined;
  // Labels above a number use the same column, not the adjacent profit or rate.
  const next = lines.slice(index + 1).find((line) => line.y - row.bottom < Math.max(100, row.height * 4) && numbers(line.text).length);
  const value = next?.words.filter((word) => numbers(word.text).length && Math.abs((word.bbox.x0 + word.bbox.x1) / 2 - center) < width * 0.22)
    .sort((a, b) => Math.abs((a.bbox.x0 + a.bbox.x1) / 2 - center) - Math.abs((b.bbox.x0 + b.bbox.x1) / 2 - center))[0];
  return value ? numbers(value.text)[0] : undefined;
}

const statusOf = (text: string): AlipayActualOrder['status'] => /已撤[销消]|交易关闭|买入失败|赎回失败/.test(text) ? 'cancelled'
  : /交易进行中|份额待确认|确认中|到账中|待到账/.test(text) ? 'pending'
    : /买入成功|卖出成功|交易成功|已确认|已到账/.test(text) ? 'confirmed' : 'unknown';

/** Stop at the product's share class or ellipsis, before badges and promotions. */
function holdingName(block: Line[], leftText: (line: Line) => string, gold: boolean): string {
  let name = productText(leftText(block[0]));
  if (gold) return name;
  for (const line of block.slice(1, 3)) {
    if (/[ACE]$/.test(fundName(name)) || /…|\.{2,}/.test(name)) break;
    const text = leftText(line);
    if (!text || /持有|金额|昨日|收益|财富|反馈|定投|精选|金选|指数基金|限额/.test(text)
      || !/股票|债券|指数|ETF|QD|联接|^[ACE]$/i.test(text)) break;
    name += text;
  }
  return name;
}

export const alipayFundNeedsReview = (row: AlipayFundDraft) => !/^\d{6}$/.test(row.code)
  || row.totalAmount === undefined || !Number.isFinite(row.totalAmount) || row.totalAmount < 0
  || row.holdingProfit === undefined || !Number.isFinite(row.holdingProfit);
export const alipayOrderNeedsReview = (row: AlipayOrderDraft) => !/^\d{6}$/.test(row.code)
  || !row.operationAt || row.quantity === undefined || !Number.isFinite(row.quantity) || row.quantity <= 0 || row.status === 'unknown'
  || row.notes.some((note) => /冲突/.test(note));

/** Parse layout coordinates so yesterday's profit and percentage never become holding profit. */
export function parseAlipayScreenshot(image: AlipayOcrImage, choices: AlipayFundChoice[], date: string): AlipayScreenshotDraft {
  const lines = visualLines(image.words);
  const all = compact(image.text);
  const result: AlipayScreenshotDraft = { funds: [], orders: [], notes: [] };
  const source = image.name;
  const dateTime = /((?:19|20)\d{2}-\d{2}-\d{2})\s*([012]\d:[0-5]\d:[0-5]\d)/;
  const normalizeTime = (text: string) => { const m = compact(text).match(dateTime); return m ? `${m[1]}T${m[2]}` : ''; };
  const notesFor = (code: string, values: (number | undefined)[]) => [...(!code ? ['基金待匹配'] : []), ...(values.some((value) => value === undefined) ? ['数值待核对'] : [])];

  if (/买入时间|卖出时间/.test(all) && /买入产品|卖出产品/.test(all)) {
    const nameIndex = lines.findIndex((line) => /买入产品|卖出产品/.test(compact(line.text)));
    const name = compact(lines[nameIndex]?.text ?? '').replace(/^.*?(买入产品|卖出产品)/, '');
    const code = matchAlipayFund(name, choices);
    const quantity = field(lines, /买入金额|卖出金额|赎回金额/, image.width);
    const operationAt = normalizeTime(lines.find((line) => /买入时间|卖出时间/.test(compact(line.text)))?.text ?? '') || normalizeTime(image.text);
    const orderId = compact(image.text).match(/订单号(\d{15,40})/)?.[1];
    const navDateText = all.match(/按照(\d{1,2})月(\d{1,2})日净值/) ?? all.match(/按(\d{1,2})月(\d{1,2})日净值/);
    const confirmationDate = all.match(/确认时间((?:19|20)\d{2}-\d{2}-\d{2})/)?.[1];
    const expected = all.match(/(\d{2}-\d{2})星期[一二三四五六日天]确认份额/)?.[1];
    const informationStart = all.search(/买入信息|卖出信息/);
    const orderStatus = statusOf(informationStart >= 0 ? all.slice(0, informationStart) : all);
    result.orders.push({ id: `${source}:order`, source, name, code, quantity, operationAt, orderId, selected: true,
      side: /卖出时间/.test(all) ? 'sell' : 'buy', unit: 'CNY', status: orderStatus, notes: notesFor(code, [quantity]),
      ...(navDateText ? { navDate: monthDayDate(`${navDateText[1].padStart(2, '0')}-${navDateText[2].padStart(2, '0')}`, operationAt.slice(0, 10) || date, 'future') } : {}),
      ...(confirmationDate ? { confirmationDate } : {}), ...(expected ? { expectedConfirmationDate: monthDayDate(expected, operationAt.slice(0, 10) || date, 'future') } : {}),
      confirmedShares: field(lines, /确认份额/, image.width), nav: field(lines, /确认净值/, image.width), fee: field(lines, /手续费/, image.width),
    });
  } else if (/交易记录/.test(all) && lines.filter((line) => normalizeTime(line.text)).length > 0) {
    let top = lines.find((line) => /明细/.test(line.text))?.bottom ?? 0;
    const stamps = lines.filter((line) => normalizeTime(line.text));
    const tail = lines.filter((line) => line.y > stamps[stamps.length - 1].bottom);
    // Keep a clipped last order as an unresolved row instead of silently dropping it.
    if (tail.some((line) => /基金|定投|买入|卖出/.test(line.text))) stamps.push({ text: '', words: [], y: image.height, bottom: image.height, height: 1 });
    else if (tail.some((line) => line.bottom >= image.height - 3)) result.notes.push(`${source}：底部交易不完整，未计入`);
    for (const stamp of stamps) {
      const block = lines.filter((line) => line.y >= top && line.y <= stamp.y);
      const words = block.filter((line) => line !== stamp).flatMap((line) => line.words);
      const name = productText(words.filter((word) => word.bbox.x0 > image.width * 0.13 && word.bbox.x0 < image.width * 0.70).map((word) => word.text).join(''));
      const right = compact(words.filter((word) => word.bbox.x0 >= image.width * 0.7).map((word) => word.text).join(''));
      const text = compact(block.map((line) => line.text).join(''));
      const code = matchAlipayFund(name, choices);
      const amount = numbers(right)[0];
      const unit = /份/.test(right) ? 'shares' : 'CNY';
      const quantity = amount !== undefined && (unit === 'shares' || Math.abs(amount * 100 - Math.round(amount * 100)) < 0.00001) ? amount : undefined;
      const operationAt = normalizeTime(stamp.text);
      // Alipay omits the status label after confirmation. A clipped row or unreadable
      // label is not evidence of a blank status.
      const statusFromBlank = !!operationAt && quantity !== undefined && /^[¥￥]?[+\-]?\d[\d,]*\.\d+(?:元|份)?$/.test(right);
      result.orders.push({ id: `${source}:${stamp.y}`, source, name, code, quantity, operationAt, selected: !!operationAt,
        side: /卖出|赎回/.test(text) ? 'sell' : 'buy', unit, status: statusFromBlank ? 'confirmed' : statusOf(right), statusFromBlank,
        notes: [...notesFor(code, [quantity]), ...(!operationAt ? ['交易未截全，默认不计入'] : [])] });
      top = stamp.bottom;
    }
  } else if (/资产详情/.test(all) && /持有份额|持仓成本价/.test(all)) {
    const code = all.match(/(?:QD[I1L]{2}[)）]?[ACE]?|[ACE])[^\d]{0,8}(\d{6})(?!\d)/)?.[1]
      ?? image.words.find((word) => /^\d{6}$/.test(word.text))?.text ?? '';
    const name = lines.filter((line) => /QD[I1L]{2}|策略股票|ETF联接/.test(compact(line.text))).map((line) => compact(line.text)).join('');
    const matched = matchAlipayFund(name, choices, code);
    const totalAmount = field(lines, /^金额(?:\(元\))?/, image.width);
    const holdingProfit = field(lines, /持有收益(?!率)(?:\(元\))?/, image.width);
    const nav = field(lines, /基金净值/, image.width);
    const navMonthDay = all.match(/基金净值[\d.,]+[（(](\d{2}-\d{2})/)?.[1];
    result.funds.push({ id: `${source}:fund`, source, name: choices.find((choice) => choice.code === matched)?.name ?? name,
      code: matched, selected: true, totalAmount, holdingProfit, amountKind: 'total', notes: notesFor(matched, [totalAmount, holdingProfit]),
      shares: field(lines, /持有份额/, image.width), costPrice: field(lines, /持仓成本价/, image.width),
      confirmedAmount: field(lines, /持有金额/, image.width), pendingBuyAmount: field(lines, /待确认金额/, image.width),
      ...(nav !== undefined && navMonthDay ? { nav, navDate: monthDayDate(navMonthDay, date, 'past') } : {}),
    });
  } else {
    const gold = /黄金基金持仓|我的黄金基金/.test(all);
    const leftText = (line: Line) => compact(line.words.filter((word) => word.bbox.x0 < image.width * (gold ? 0.95 : 0.44)).map((word) => word.text).join(''));
    const anchors = lines.filter((line) => {
      const text = leftText(line);
      return brands.test(text)
        && !/基金财|财富|管理|基金销售|我的|持有|基金净值|基金持仓|买入|限额|解读|精选|基金服务/.test(text)
        && (gold ? /黄金/.test(text) : /[\u4e00-\u9fff]{4}/.test(text));
    });
    for (let i = 0; i < anchors.length; i++) {
      const block = lines.filter((line) => line.y >= anchors[i].y && line.y < (anchors[i + 1]?.y ?? image.height));
      const name = holdingName(block, leftText, gold);
      const numberLines = block.filter((line) => (gold || line.y <= anchors[i].bottom)
        && line.words.some((word) => word.bbox.x0 > image.width * 0.45 && word.bbox.x0 < image.width * 0.78 && numbers(word.text).length));
      const main = numberLines[0];
      const amountWords = main?.words.filter((word) => word.bbox.x0 >= image.width * (gold ? 0.35 : 0.45) && word.bbox.x0 < image.width * 0.78) ?? [];
      const profitWords = main?.words.filter((word) => word.bbox.x0 >= image.width * 0.78) ?? [];
      const totalAmount = numbers(amountWords.map((word) => word.text).join(' '))[0];
      const holdingProfit = numbers(profitWords.map((word) => word.text).join(' '))[0];
      const code = matchAlipayFund(name, choices);
      result.funds.push({ id: `${source}:${anchors[i].y}`, source, name, code, selected: true, totalAmount, holdingProfit,
        amountKind: gold ? 'confirmed' : 'total', notes: notesFor(code, [totalAmount, holdingProfit]),
        ...(gold && main ? { shares: numbers(main.words.filter((word) => word.bbox.x0 < image.width * 0.35).map((word) => word.text).join(''))[0] } : {}),
      });
    }
  }
  if (image.fallback) {
    const alternate = parseAlipayScreenshot({ ...image, ...image.fallback, fallback: undefined }, choices, date);
    const resolveName = <T extends { name: string; code: string; notes: string[] }>(row: T, candidates: T[]): T => {
      const codes = new Set([row.code, ...candidates.map((candidate) => candidate.code)].filter(Boolean));
      if (codes.size > 1) return { ...row, code: '', notes: [...row.notes, '基金识别不一致，请核对'] };
      const matched = !row.code && codes.size === 1 ? candidates.find((candidate) => candidate.code) : undefined;
      return matched ? { ...row, code: matched.code, name: matched.name, notes: row.notes.filter((note) => note !== '基金待匹配') } : row;
    };
    const y = (row: { id: string }) => Number(row.id.slice(row.id.lastIndexOf(':') + 1));
    // Only repair a name in the same visual row or exact transaction. Never copy balances.
    result.funds = result.funds.map((row) => resolveName(row, alternate.funds.filter((candidate) =>
      Math.abs(y(row) - y(candidate)) < image.height * 0.02 && row.totalAmount !== undefined
      && candidate.totalAmount === row.totalAmount && candidate.holdingProfit === row.holdingProfit)));
    result.orders = result.orders.map((row) => {
      const candidates = alternate.orders.filter((candidate) => row.operationAt && candidate.operationAt === row.operationAt
        && row.quantity !== undefined && candidate.quantity === row.quantity && candidate.unit === row.unit && candidate.side === row.side);
      const resolved = resolveName(row, candidates);
      // A visible pending/cancelled label in the other OCR pass takes precedence over
      // an omitted label, but only for one matching row in this same screenshot.
      const candidate = candidates.length === 1 ? candidates[0] : undefined;
      if (!candidate || !(Math.abs(y(row) - y(candidate)) < image.height * 0.02)
        || !resolved.code || (candidate.code && candidate.code !== resolved.code) || candidate.statusFromBlank || candidate.status === 'unknown') return resolved;
      if (row.statusFromBlank || row.status === 'unknown') return { ...resolved, status: candidate.status, statusFromBlank: false };
      return row.status === candidate.status ? resolved : { ...resolved, status: 'unknown', notes: [...resolved.notes, '交易状态识别冲突，请核对'] };
    });
  }
  if (!result.funds.length && !result.orders.length) result.notes.push(`${source}：未识别到基金或交易，请核对图片`);
  return result;
}

export function combineAlipayScreenshotDrafts(drafts: AlipayScreenshotDraft[]): AlipayScreenshotDraft {
  const result: AlipayScreenshotDraft = { funds: drafts.flatMap((draft) => draft.funds), orders: drafts.flatMap((draft) => draft.orders), notes: drafts.flatMap((draft) => draft.notes) };
  // A detailed order can resolve an overlapping list row using its exact time and amount.
  result.orders = result.orders.map((row) => {
    const candidates = result.orders.filter((other) => other !== row && other.code && other.operationAt && other.operationAt === row.operationAt
      && other.side === row.side && other.quantity === row.quantity && other.unit === row.unit && (!row.code || row.code === other.code));
    const codes = new Set(candidates.map((other) => other.code));
    const details = candidates.filter((other) => other.orderId && (!row.orderId || other.orderId === row.orderId));
    const detailIds = new Set(details.map((other) => other.orderId));
    const detail = detailIds.size === 1 ? details[0] : undefined;
    return { ...row, ...(!row.orderId && detailIds.size > 1 ? { selected: false, notes: [...row.notes, '重复候选：匹配多笔订单，请核对'] } : {}), ...(!row.code && codes.size === 1 ? { code: candidates[0].code, name: candidates[0].name } : {}),
      ...(!row.orderId && detail ? { ...Object.fromEntries(Object.entries(detail).filter(([key, value]) =>
        ['orderId', 'status', 'confirmedShares', 'confirmationDate', 'expectedConfirmationDate', 'navDate', 'nav', 'fee'].includes(key) && value !== undefined)) } : {}) };
  });
  const seen = new Map<string, AlipayOrderDraft>();
  result.orders = result.orders.map((row) => {
    const identity = row.orderId || `${row.code || fundName(row.name)}:${row.operationAt}:${row.side}:${row.quantity}:${row.unit}`;
    if (!row.operationAt || row.quantity === undefined) return row;
    const previous = seen.get(identity);
    if (previous) {
      const fields = ['code', 'operationAt', 'side', 'quantity', 'unit', 'status', 'navDate', 'confirmationDate', 'expectedConfirmationDate', 'confirmedShares', 'nav', 'fee'] as const;
      if (row.orderId && fields.some((key) => row[key] !== undefined && previous[key] !== undefined && row[key] !== previous[key])) {
        return { ...row, notes: [...row.notes, '同一订单内容冲突，请核对'] };
      }
      return { ...row, selected: false, notes: [...row.notes, '重复候选：默认不重复计入'] };
    }
    seen.set(identity, row); return row;
  });
  return result;
}

/** Validate the whole draft before touching the account store. Merge only observations from this date. */
export function materializeAlipayScreenshots(draft: AlipayScreenshotDraft, date: string, choices: AlipayFundChoice[], previous?: AlipayActualSnapshot): AlipayActualSnapshot {
  const old = previous?.date === date ? previous : undefined;
  const funds = new Map<string, AlipayActualFund>((old?.funds ?? []).map((fund) => [fund.code, { ...fund }]));
  const selected = draft.funds.filter((row) => row.selected);
  for (const row of selected) {
    if ((!row.code && fundName(row.name).includes('日经')) || (row.amountMatch && (row.code !== row.amountMatch.code
      || row.totalAmount !== row.amountMatch.totalAmount || row.amountKind !== row.amountMatch.amountKind))) throw new AlipayScreenshotValidationError('请先确认日经基金的 A/C 类别和代码', row.id, 'code');
    if (!/^\d{6}$/.test(row.code) || row.totalAmount === undefined || row.holdingProfit === undefined) throw new AlipayScreenshotValidationError('请补全勾选基金的代码、金额和持有收益', row.id,
      !/^\d{6}$/.test(row.code) ? 'code' : row.totalAmount === undefined ? 'totalAmount' : 'holdingProfit');
    const value: AlipayActualFund = { code: row.code, name: choices.find((choice) => choice.code === row.code)?.name ?? row.name,
      totalAmount: row.totalAmount, holdingProfit: row.holdingProfit, amountKind: row.amountKind };
    for (const key of ['shares', 'costPrice', 'nav', 'navDate', 'confirmedAmount', 'pendingBuyAmount'] as const) {
      if (row[key] !== undefined) Object.assign(value, { [key]: row[key] });
    }
    const fields = ['totalAmount', 'holdingProfit', 'amountKind', 'shares', 'costPrice', 'nav', 'navDate', 'confirmedAmount', 'pendingBuyAmount'] as const;
    const duplicate = selected.find((other) => other !== row && other.code === row.code
      && fields.some((key) => other[key] !== undefined && row[key] !== undefined && other[key] !== row[key]));
    if (duplicate) throw new AlipayScreenshotValidationError(`${value.name}：截图数据冲突，请仅保留同一时点的数据`, row.id,
      fields.find((key) => duplicate[key] !== undefined && row[key] !== undefined && duplicate[key] !== row[key]) ?? 'code');
    // New balances must not inherit stale shares, NAV or pending cash from an earlier screenshot.
    const sameBatch = selected.slice(0, selected.indexOf(row)).some((other) => other.code === row.code);
    funds.set(row.code, sameBatch ? { ...funds.get(row.code)!, ...value } : value);
  }
  const orders = new Map<string, AlipayActualOrder>((old?.orders ?? []).map((order) => [order.id, { ...order }]));
  const occurrences = new Map<string, number>();
  const imported = new Map<string, AlipayActualOrder>();
  const orderRows = new Map<string, AlipayOrderDraft>();
  const usedPrior = new Set<string>();
  for (const row of draft.orders.filter((entry) => entry.selected)) {
    if (!funds.has(row.code)) throw new AlipayScreenshotValidationError(`${row.name || '交易'}：请匹配基金并补充对应持有页`, row.id, 'code');
    if (!row.operationAt || row.quantity === undefined || row.status === 'unknown') throw new AlipayScreenshotValidationError(`${row.name}：请核对交易时间、金额和状态`, row.id,
      !row.operationAt ? 'operationAt' : row.quantity === undefined ? 'quantity' : 'status');
    const matches = (old?.orders ?? []).filter((order) => order.code === row.code && order.operationAt === row.operationAt && order.side === row.side && order.unit === row.unit && order.quantity === row.quantity);
    const key = `${row.code}:${row.operationAt}:${row.side}:${row.unit}:${row.quantity}`;
    const occurrence = (occurrences.get(key) ?? 0) + 1; occurrences.set(key, occurrence);
    const priorMatch = matches.filter((order) => !usedPrior.has(order.id));
    const id = row.orderId ?? (priorMatch.length === 1 ? priorMatch[0].id : `screenshot:${key}:${occurrence}`);
    usedPrior.add(id);
    const value: AlipayActualOrder = { id, code: row.code, operationAt: row.operationAt, side: row.side, quantity: row.quantity, unit: row.unit, status: row.status };
    for (const key of ['navDate', 'confirmationDate', 'expectedConfirmationDate', 'confirmedShares', 'nav', 'fee'] as const) if (row[key] !== undefined) Object.assign(value, { [key]: row[key] });
    const sameImport = imported.get(id);
    if (sameImport && JSON.stringify(sameImport) !== JSON.stringify(value)) throw new AlipayScreenshotValidationError('同一订单内容冲突，请仅保留最新状态', row.id, 'orderId');
    imported.set(id, value);
    orderRows.set(id, row);
    if (row.orderId && matches.length === 1 && matches[0].id !== id && !/^\d{15,40}$/.test(matches[0].id)) orders.delete(matches[0].id);
    const prior = orders.get(id);
    orders.set(id, prior?.status === value.status ? { ...prior, ...value } : value);
  }
  if (!selected.length && !draft.orders.some((order) => order.selected)) throw new AlipayScreenshotValidationError('请至少选择一项识别结果', draft.funds[0]?.id ?? draft.orders[0]?.id ?? '', 'selected');
  const snapshot = { date, funds: [...funds.values()], orders: [...orders.values()] };
  try { return parseAlipayActual(JSON.stringify(snapshot)); }
  catch (cause) {
    if (cause instanceof AlipayActualValidationError) {
      const fund = snapshot.funds[cause.index];
      const row = cause.collection === 'orders' ? orderRows.get(snapshot.orders[cause.index]?.id)
        : selected.find((row) => row.code === fund?.code && row[cause.field as keyof AlipayFundDraft] !== undefined)
          ?? selected.find((row) => row.code === fund?.code);
      if (row) throw new AlipayScreenshotValidationError(cause.message, row.id, cause.field);
    }
    throw cause;
  }
}
