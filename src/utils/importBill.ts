import * as XLSX from 'xlsx';

export type BillItem = { date: string; category: string; subcategory: string; amount: number; tags: string; note: string };
export type BillTagMonth = {
  eatDrinkAmount: number; eatDrinkCount: number;
  redAmount: number; blackAmount: number;
  eatDrinkItems: BillItem[]; redItems: BillItem[]; blackItems: BillItem[];
};

const COL_DATE = 0, COL_TYPE = 1, COL_AMT = 2, COL_CAT = 3, COL_SUBCAT = 4, COL_ACCOUNT = 5, COL_NOTE = 9, COL_TAGS = 10, COL_OTHER = 17;

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

async function fileToCsvText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv')) return await file.text();
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_csv(sheet);
}

export async function parseBillFile(file: File): Promise<Record<string, BillTagMonth>> {
  const raw = await fileToCsvText(file);
  const lines = raw.split('\n');
  const months: Record<string, BillTagMonth> = {};

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseLine(line);

    const other = (cols[COL_OTHER] || '').trim();
    if (other.includes('不计入')) continue;

    const dateStr = (cols[COL_DATE] || '').trim();
    const yearMonth = dateStr.slice(0, 7);
    if (!yearMonth || yearMonth.length !== 7) continue;

    const type = (cols[COL_TYPE] || '').trim();
    const amount = parseAmount(cols[COL_AMT] || '0');
    if (amount === 0) continue;
    if (type !== '支出') continue;

    const tagsRaw = (cols[COL_TAGS] || '').trim();
    const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);
    void (cols[COL_ACCOUNT] || '').trim();
    const category = (cols[COL_CAT] || '').trim();
    const subcategory = (cols[COL_SUBCAT] || '').trim();
    const note = (cols[COL_NOTE] || '').trim();
    const date = dateStr.slice(0, 10);

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
  return months;
}

const LS_KEY = 'billTagStats.override.v1';

export function loadOverride(): Record<string, BillTagMonth> | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function saveOverride(data: Record<string, BillTagMonth>) {
  localStorage.setItem(LS_KEY, JSON.stringify(data));
}

export function clearOverride() {
  localStorage.removeItem(LS_KEY);
}
