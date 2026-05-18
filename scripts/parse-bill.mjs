import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as XLSX from 'xlsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 自动挑选或接受 CLI 传入的账单文件
function pickInputFile(arg) {
  if (arg) return path.resolve(arg);
  const root = path.join(__dirname, '..');
  const cands = fs.readdirSync(root)
    .filter((f) => /^账单_.*\.(xls|xlsx|csv)$/i.test(f))
    .map((f) => ({ f, mtime: fs.statSync(path.join(root, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (!cands.length) throw new Error('未找到 账单_*.{xls,xlsx,csv}');
  return path.join(root, cands[0].f);
}

// xls/xlsx → csv（落地中间产物便于人工对照）
function xlsToCsv(xlsPath) {
  const buf = fs.readFileSync(xlsPath);
  const wb = XLSX.read(buf, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const csvText = XLSX.utils.sheet_to_csv(sheet);
  const csvPath = xlsPath.replace(/\.xlsx?$/i, '.csv');
  fs.writeFileSync(csvPath, csvText, 'utf-8');
  console.log(`  xls → csv: ${path.basename(csvPath)}`);
  return csvText;
}

const input = pickInputFile(process.argv[2]);
console.log(`Input: ${path.basename(input)}`);
const raw = /\.xlsx?$/i.test(input)
  ? xlsToCsv(input)
  : fs.readFileSync(input, 'utf-8');

// Simple CSV parser that handles quoted fields (e.g. "1,500.00")
function parseLine(line) {
  const cols = [];
  let inQuote = false;
  let cur = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && !inQuote) { inQuote = true; }
    else if (ch === '"' && inQuote) { inQuote = false; }
    else if (ch === ',' && !inQuote) { cols.push(cur); cur = ''; }
    else { cur += ch; }
  }
  cols.push(cur);
  return cols;
}

function parseAmount(s) {
  // Remove quotes, commas, spaces; return absolute value
  const n = parseFloat(s.replace(/[",\s]/g, ''));
  return isNaN(n) ? 0 : Math.abs(n);
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function isValidDateParts(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
}

function normalizeBillDate(rawDate) {
  const value = String(rawDate || '').trim();
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

const lines = raw.split('\n');
// Col indices (0-based):
// 0:日期 1:收支类型 2:金额 3:类别 4:二级分类 5:账户 6:账本 7:退款 8:优惠 9:备注 10:标签 ... 17:其他
const COL_DATE = 0, COL_TYPE = 1, COL_AMT = 2, COL_CAT = 3, COL_SUBCAT = 4, COL_ACCOUNT = 5, COL_NOTE = 9, COL_TAGS = 10, COL_OTHER = 17;

const months = {};

for (let i = 1; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;
  const cols = parseLine(line);

  // Skip balance-adjustment / non-budget entries
  const other = (cols[COL_OTHER] || '').trim();
  if (other.includes('不计入')) continue;

  const date = normalizeBillDate(cols[COL_DATE] || '');
  if (!date) continue;
  const yearMonth = date.slice(0, 7); // "YYYY-MM"

  const type = (cols[COL_TYPE] || '').trim();
  const amount = parseAmount(cols[COL_AMT] || '0');
  if (amount === 0) continue;

  const tagsRaw = (cols[COL_TAGS] || '').trim();
  const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);
  const account = (cols[COL_ACCOUNT] || '').trim();
  const category = (cols[COL_CAT] || '').trim();
  const subcategory = (cols[COL_SUBCAT] || '').trim();
  const note = (cols[COL_NOTE] || '').trim();

  if (!months[yearMonth]) {
    months[yearMonth] = {
      income: 0, periodicLife: 0, volatileLife: 0, consumption: 0, school: 0,
      eatDrinkAmount: 0, eatDrinkCount: 0, redAmount: 0, blackAmount: 0,
      eatDrinkItems: [], redItems: [], blackItems: [],
    };
  }
  const m = months[yearMonth];

  if (type === '支出') {
    const hasPeriodic = tags.some(t => t === '周期生活');
    const hasVolatile = tags.some(t => t === '波动生活');
    const hasConsumption = tags.some(t => t === '消费');
    if (hasPeriodic) m.periodicLife += amount;
    else if (hasVolatile) m.volatileLife += amount;
    else if (hasConsumption) m.consumption += amount;
    // else: unclassified, skip (e.g. 平账, 不计入 already filtered)
    // school = 校园卡 account expenses that are periodicLife
    if (hasPeriodic && account.includes('校园卡')) m.school += amount;

    // 吃好喝好 / 红 / 黑 标签聚合 + 明细
    const item = { date, category, subcategory, amount: Math.round(amount * 100) / 100, tags: tagsRaw, note };
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
  } else if (type === '收入') {
    // Include both periodic and volatile income (balance adjustments already filtered via '不计入')
    m.income += amount;
  }
}

// Round to 2dp
const r2 = (n) => Math.round(n * 100) / 100;
for (const ym of Object.keys(months)) {
  const m = months[ym];
  m.income = r2(m.income);
  m.periodicLife = r2(m.periodicLife);
  m.volatileLife = r2(m.volatileLife);
  m.consumption = r2(m.consumption);
  m.school = r2(m.school);
  m.totalExpense = r2(m.periodicLife + m.volatileLife + m.consumption);
  m.eatDrinkAmount = r2(m.eatDrinkAmount);
  m.redAmount = r2(m.redAmount);
  m.blackAmount = r2(m.blackAmount);
}

// Filter to relevant range (2021-01 to 2026-12) and sort descending
const relevant = Object.entries(months)
  .filter(([ym]) => ym >= '2021-01' && ym <= '2026-12')
  .sort(([a], [b]) => b.localeCompare(a));

const output = Object.fromEntries(relevant);
const outPath = path.join(__dirname, 'bill-aggregates.json');
fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');
// 同步写一份精简版到 src/data，供前端直接 import
const tagStats = Object.fromEntries(
  relevant.map(([ym, m]) => [ym, {
    eatDrinkAmount: m.eatDrinkAmount,
    eatDrinkCount: m.eatDrinkCount,
    redAmount: m.redAmount,
    blackAmount: m.blackAmount,
    eatDrinkItems: m.eatDrinkItems,
    redItems: m.redItems,
    blackItems: m.blackItems,
  }]),
);
const srcPath = path.join(__dirname, '..', 'src', 'data', 'billTagStats.json');
fs.writeFileSync(srcPath, JSON.stringify(tagStats, null, 2), 'utf-8');
console.log(`Wrote ${Object.keys(output).length} months to ${outPath} and ${srcPath}`);
