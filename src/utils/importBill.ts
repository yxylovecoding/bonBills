import * as XLSX from 'xlsx';

export type BillItem = { date: string; category: string; subcategory: string; amount: number; tags: string; note: string };
export type BillTagMonth = {
  eatDrinkAmount: number; eatDrinkCount: number;
  redAmount: number; blackAmount: number;
  eatDrinkItems: BillItem[]; redItems: BillItem[]; blackItems: BillItem[];
};
export type BillMonthlyAgg = {
  income: number;
  totalExpense: number;
  periodicLife: number;
  volatileLife: number;
  consumption: number;
  school: number;
};
export type BillTransactionItem = {
  date: string;
  category: string;
  subcategory: string;
  amount: number;
  account: string;
  tags: string;
  note: string;
};
export type BillAccountTransaction = BillTransactionItem & {
  id: string;
  occurredAt: string;
  transactionType: '收入' | '支出';
};
export type BillExpenseItem = BillTransactionItem;
export type BillIncomeItem = BillTransactionItem;
export type BillExpenseMonth = BillExpenseItem[];
export type BillIncomeMonth = BillIncomeItem[];

export function emptyBillMonthlyAgg(): BillMonthlyAgg {
  return { income: 0, totalExpense: 0, periodicLife: 0, volatileLife: 0, consumption: 0, school: 0 };
}

export function aggregateExpenseItems(items: BillExpenseMonth): Omit<BillMonthlyAgg, 'income'> {
  const agg = { totalExpense: 0, periodicLife: 0, volatileLife: 0, consumption: 0, school: 0 };
  for (const item of items) {
    const tags = item.tags.split(',').map((t) => t.trim()).filter(Boolean);
    agg.totalExpense += item.amount;
    if (tags.includes('周期生活')) agg.periodicLife += item.amount;
    if (tags.includes('波动生活')) agg.volatileLife += item.amount;
    if (tags.includes('消费')) agg.consumption += item.amount;
    if (item.account === '校园卡' && tags.includes('周期生活')) agg.school += item.amount;
  }
  return {
    totalExpense: Math.round(agg.totalExpense * 100) / 100,
    periodicLife: Math.round(agg.periodicLife * 100) / 100,
    volatileLife: Math.round(agg.volatileLife * 100) / 100,
    consumption: Math.round(agg.consumption * 100) / 100,
    school: Math.round(agg.school * 100) / 100,
  };
}

// 派生稳定 id：相同字段的多条用日内序号 dupIdx 区分
export function expenseItemId(it: BillExpenseItem, dupIdx: number): string {
  return `${it.date}|${it.amount}|${it.category}|${it.subcategory}|${it.note}|${dupIdx}`;
}

// 给一组同日条目分别派生 id：内部按内容 key 计 dupIdx
export function assignExpenseIds(items: BillExpenseItem[]): { item: BillExpenseItem; id: string }[] {
  const seen = new Map<string, number>();
  return items.map((it) => {
    const key = `${it.date}|${it.amount}|${it.category}|${it.subcategory}|${it.note}`;
    const dup = seen.get(key) ?? 0;
    seen.set(key, dup + 1);
    return { item: it, id: expenseItemId(it, dup) };
  });
}
export type BillParseResult = {
  tagStats: Record<string, BillTagMonth>;
  aggregates: Record<string, BillMonthlyAgg>;
  expenseItems: Record<string, BillExpenseMonth>;
  incomeItems: Record<string, BillIncomeMonth>;
  accountTransactions: BillAccountTransaction[];
};

type BillColumnMap = {
  date: number;
  type: number;
  amount: number;
  category: number | null;
  subcategory: number | null;
  account: number | null;
  reimburseAmount: number | null;
  note: number | null;
  tags: number | null;
  other: number | null;
};

function normalizeHeaderName(value: string): string {
  return value.replace(/^\uFEFF/, '').trim();
}

function buildHeaderMap(cols: string[]): Map<string, number> {
  const map = new Map<string, number>();
  cols.forEach((col, idx) => {
    const name = normalizeHeaderName(col);
    if (name && !map.has(name)) map.set(name, idx);
  });
  return map;
}

function findHeaderIndex(headerMap: Map<string, number>, aliases: string[]): number | null {
  for (const alias of aliases) {
    const idx = headerMap.get(alias);
    if (idx !== undefined) return idx;
  }
  return null;
}

function requireHeaderIndex(headerMap: Map<string, number>, aliases: string[], label: string): number {
  const idx = findHeaderIndex(headerMap, aliases);
  if (idx === null) throw new Error(`账单缺少「${label}」列`);
  return idx;
}

function buildBillColumnMap(headerCols: string[]): BillColumnMap {
  const headerMap = buildHeaderMap(headerCols);
  return {
    date: requireHeaderIndex(headerMap, ['日期'], '日期'),
    type: requireHeaderIndex(headerMap, ['收支类型'], '收支类型'),
    amount: requireHeaderIndex(headerMap, ['金额'], '金额'),
    category: findHeaderIndex(headerMap, ['类别', '分类']),
    subcategory: findHeaderIndex(headerMap, ['二级分类', '子类', '子类别', '子分类']),
    account: findHeaderIndex(headerMap, ['账户', '账号']),
    reimburseAmount: findHeaderIndex(headerMap, ['报销金额']),
    note: findHeaderIndex(headerMap, ['备注', '说明']),
    tags: findHeaderIndex(headerMap, ['标签']),
    other: findHeaderIndex(headerMap, ['其他']),
  };
}

function cell(cols: string[], idx: number | null): string {
  return idx === null ? '' : (cols[idx] || '');
}

function parseLine(line: string): string[] {
  const cols: string[] = [];
  let inQuote = false;
  let cur = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && !inQuote) inQuote = true;
    else if (ch === '"' && inQuote) inQuote = false;
    else if (ch === ',' && !inQuote) { cols.push(cur); cur = ''; }
    else cur += ch;
  }
  cols.push(cur);
  return cols;
}

function parseAmount(s: string): number {
  const n = parseFloat(s.replace(/[",\s]/g, ''));
  return isNaN(n) ? 0 : Math.abs(n);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function isValidDateParts(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
}

export function normalizeBillDate(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;

  const direct = value.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (direct) {
    const year = Number(direct[1]);
    const month = Number(direct[2]);
    const day = Number(direct[3]);
    if (!isValidDateParts(year, month, day)) return null;
    return `${year}-${pad2(month)}-${pad2(day)}`;
  }

  const serial = Number(value);
  if (Number.isFinite(serial) && serial > 20000 && serial < 80000) {
    const parsed = XLSX.SSF.parse_date_code(serial);
    if (parsed && isValidDateParts(parsed.y, parsed.m, parsed.d)) {
      return `${parsed.y}-${pad2(parsed.m)}-${pad2(parsed.d)}`;
    }
  }

  return null;
}

function normalizeBillOccurredAt(raw: string): string | null {
  const date = normalizeBillDate(raw);
  if (!date) return null;
  const time = raw.trim().match(/(?:T|\s)(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!time) return date;
  const hour = Number(time[1]);
  const minute = Number(time[2]);
  const second = Number(time[3] ?? 0);
  if (hour > 23 || minute > 59 || second > 59) return date;
  return `${date}T${pad2(hour)}:${pad2(minute)}:${pad2(second)}`;
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function normalizeBillYearMonth(raw: string): string | null {
  const value = raw.trim();
  const direct = value.match(/^(\d{4})[-/.年](\d{1,2})/);
  if (!direct) return null;
  const year = Number(direct[1]);
  const month = Number(direct[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || year < 1900 || month < 1 || month > 12) return null;
  return `${year}-${pad2(month)}`;
}

async function fileToCsvText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv')) return await file.text();
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_csv(sheet);
}

function splitCsvRows(raw: string): string[] {
  // 支持单元格内换行：引号未闭合时把下一物理行合并进当前逻辑行
  const out: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '"') inQuote = !inQuote;
    if (ch === '\n' && !inQuote) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

export async function parseBillFile(file: File): Promise<BillParseResult> {
  const raw = await fileToCsvText(file);
  const lines = splitCsvRows(raw);
  const months: Record<string, BillTagMonth> = {};
  const aggs: Record<string, BillMonthlyAgg> = {};
  const expenseItems: Record<string, BillExpenseMonth> = {};
  const incomeItems: Record<string, BillIncomeMonth> = {};
  const accountTransactions: BillAccountTransaction[] = [];
  const accountIdentityOccurrences = new Map<string, number>();
  const headerIdx = lines.findIndex((line) => line.trim());
  if (headerIdx < 0) throw new Error('账单内容为空');
  const columns = buildBillColumnMap(parseLine(lines[headerIdx]));

  const ensureAgg = (ym: string) => {
    if (!aggs[ym]) aggs[ym] = emptyBillMonthlyAgg();
    return aggs[ym];
  };

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseLine(line);

    const rawDate = cell(cols, columns.date);
    const date = normalizeBillDate(rawDate);
    if (!date) continue;
    const occurredAt = normalizeBillOccurredAt(rawDate) ?? date;
    const yearMonth = date.slice(0, 7);

    const type = cell(cols, columns.type).trim();
    // 「金额」已是退款后的净额，退款列无需再扣
    const amount = parseAmount(cell(cols, columns.amount) || '0');
    if (amount === 0) continue;
    if (type !== '支出' && type !== '收入') continue;

    const tagsRaw = cell(cols, columns.tags).trim();
    const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);
    const account = cell(cols, columns.account).trim();
    const category = cell(cols, columns.category).trim();
    const subcategory = cell(cols, columns.subcategory).trim();
    const note = cell(cols, columns.note).trim();
    const other = cell(cols, columns.other).trim();
    const roundedAmount = Math.round(amount * 100) / 100;
    const accountIdentity = [occurredAt, type, roundedAmount, account, category, subcategory, note, tagsRaw, other].join('|');
    const occurrence = accountIdentityOccurrences.get(accountIdentity) ?? 0;
    accountIdentityOccurrences.set(accountIdentity, occurrence + 1);
    accountTransactions.push({
      id: `bill-account:${stableHash(`${accountIdentity}|${occurrence}`)}`,
      date,
      occurredAt,
      transactionType: type,
      category,
      subcategory,
      amount: roundedAmount,
      account,
      tags: tagsRaw,
      note,
    });

    // 不计入与报销记录仍影响真实账户余额，但不进入收支统计。
    if (other.includes('不计入')) continue;
    // 报销金额列非空 ⇒ 整行跳过（无论待报销 0.00 还是已报销正数，都不算自己实际支出）
    if (cell(cols, columns.reimburseAmount).trim()) continue;

    const a = ensureAgg(yearMonth);
    if (type === '收入') {
      a.income += amount;
      if (!incomeItems[yearMonth]) incomeItems[yearMonth] = [];
      incomeItems[yearMonth].push({
        date, category, subcategory,
        amount: roundedAmount,
        account, tags: tagsRaw, note,
      });
      continue;
    }
    // type === '支出'
    a.totalExpense += amount;
    if (tags.includes('周期生活')) a.periodicLife += amount;
    if (tags.includes('波动生活')) a.volatileLife += amount;
    if (tags.includes('消费')) a.consumption += amount;
    if (account === '校园卡' && tags.includes('周期生活')) a.school += amount;

    if (!expenseItems[yearMonth]) expenseItems[yearMonth] = [];
    expenseItems[yearMonth].push({
      date, category, subcategory,
      amount: roundedAmount,
      account, tags: tagsRaw, note,
    });

    if (!months[yearMonth]) {
      months[yearMonth] = {
        eatDrinkAmount: 0, eatDrinkCount: 0, redAmount: 0, blackAmount: 0,
        eatDrinkItems: [], redItems: [], blackItems: [],
      };
    }
    const m = months[yearMonth];
    const item: BillItem = { date, category, subcategory, amount: roundedAmount, tags: tagsRaw, note };
    if (tags.includes('吃好喝好')) {
      m.eatDrinkAmount += amount;
      m.eatDrinkCount += 1;
      m.eatDrinkItems.push(item);
    }
    if (tags.includes('红')) {
      m.redAmount += amount;
      m.redItems.push(item);
    }
    if (tags.includes('黑')) {
      m.blackAmount += amount;
      m.blackItems.push(item);
    }
  }

  const r2 = (n: number) => Math.round(n * 100) / 100;
  for (const ym of Object.keys(months)) {
    const m = months[ym];
    m.eatDrinkAmount = r2(m.eatDrinkAmount);
    m.redAmount = r2(m.redAmount);
    m.blackAmount = r2(m.blackAmount);
  }
  for (const ym of Object.keys(aggs)) {
    const a = aggs[ym];
    a.income = r2(a.income);
    a.totalExpense = r2(a.totalExpense);
    a.periodicLife = r2(a.periodicLife);
    a.volatileLife = r2(a.volatileLife);
    a.consumption = r2(a.consumption);
    a.school = r2(a.school);
  }
  return { tagStats: months, aggregates: aggs, expenseItems, incomeItems, accountTransactions };
}

// ── 导出为内置数据文件 ──────────────────────────────────────────────

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportBillDefaults(
  tagStats: Record<string, BillTagMonth>,
  expenseItems: Record<string, BillExpenseMonth>,
) {
  downloadJson(tagStats, 'billTagStats.json');
  setTimeout(() => downloadJson(expenseItems, 'billExpenseItems.json'), 300);
}

export function exportCalendarDefaults(tagMap: Record<string, string>) {
  downloadJson(tagMap, 'calendarTags.json');
}

export function exportAppConfig(config: unknown) {
  downloadJson(config, 'appConfig.json');
}
