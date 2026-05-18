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
export type BillExpenseItem = {
  date: string;
  category: string;
  subcategory: string;
  amount: number;
  account: string;
  tags: string;
  note: string;
};
export type BillExpenseMonth = BillExpenseItem[];

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
};

const COL_DATE = 0, COL_TYPE = 1, COL_AMT = 2, COL_CAT = 3, COL_SUBCAT = 4, COL_ACCOUNT = 5, COL_NOTE = 9, COL_TAGS = 10, COL_REIMB = 12, COL_OTHER = 17;

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

  const ensureAgg = (ym: string) => {
    if (!aggs[ym]) aggs[ym] = emptyBillMonthlyAgg();
    return aggs[ym];
  };

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseLine(line);

    const other = (cols[COL_OTHER] || '').trim();
    if (other.includes('不计入')) continue;
    // 待报销：还没真正报销下来，整行先忽略；扫描全列避免依赖具体列位
    if (cols.some((c) => c && c.includes('待报销'))) continue;

    const date = normalizeBillDate(cols[COL_DATE] || '');
    if (!date) continue;
    const yearMonth = date.slice(0, 7);

    const type = (cols[COL_TYPE] || '').trim();
    const grossAmount = parseAmount(cols[COL_AMT] || '0');
    const reimbRaw = (cols[COL_REIMB] || '').trim();
    const reimb = parseAmount(reimbRaw);
    // 报销列有内容但解析不出金额：通常是「待报销」时填的报销账户名，整行先跳过
    if (reimbRaw && reimb === 0) continue;
    const amount = Math.max(0, grossAmount - reimb);
    if (amount === 0) continue;
    if (type !== '支出' && type !== '收入') continue;

    const tagsRaw = (cols[COL_TAGS] || '').trim();
    const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);
    const account = (cols[COL_ACCOUNT] || '').trim();
    const category = (cols[COL_CAT] || '').trim();
    const subcategory = (cols[COL_SUBCAT] || '').trim();
    const note = (cols[COL_NOTE] || '').trim();

    const a = ensureAgg(yearMonth);
    if (type === '收入') {
      a.income += amount;
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
      amount: Math.round(amount * 100) / 100,
      account, tags: tagsRaw, note,
    });

    if (!months[yearMonth]) {
      months[yearMonth] = {
        eatDrinkAmount: 0, eatDrinkCount: 0, redAmount: 0, blackAmount: 0,
        eatDrinkItems: [], redItems: [], blackItems: [],
      };
    }
    const m = months[yearMonth];
    const item: BillItem = { date, category, subcategory, amount: Math.round(amount * 100) / 100, tags: tagsRaw, note };
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
  return { tagStats: months, aggregates: aggs, expenseItems };
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
