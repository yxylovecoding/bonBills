import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const csvPath = path.join(__dirname, '..', '账单_0413170859.csv');
const raw = fs.readFileSync(csvPath, 'utf-8');

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

const lines = raw.split('\n');
// Col indices (0-based):
// 0:日期 1:收支类型 2:金额 3:类别 4:二级分类 5:账户 6:账本 7:退款 8:优惠 9:备注 10:标签 ... 17:其他
const COL_DATE = 0, COL_TYPE = 1, COL_AMT = 2, COL_ACCOUNT = 5, COL_TAGS = 10, COL_OTHER = 17;

const months = {};

for (let i = 1; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;
  const cols = parseLine(line);

  // Skip balance-adjustment / non-budget entries
  const other = (cols[COL_OTHER] || '').trim();
  if (other.includes('不计入')) continue;

  const dateStr = (cols[COL_DATE] || '').trim();
  const yearMonth = dateStr.slice(0, 7); // "YYYY-MM"
  if (!yearMonth || yearMonth.length !== 7) continue;

  const type = (cols[COL_TYPE] || '').trim();
  const amount = parseAmount(cols[COL_AMT] || '0');
  if (amount === 0) continue;

  const tagsRaw = (cols[COL_TAGS] || '').trim();
  const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);
  const account = (cols[COL_ACCOUNT] || '').trim();

  if (!months[yearMonth]) {
    months[yearMonth] = { income: 0, periodicLife: 0, volatileLife: 0, consumption: 0, school: 0 };
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
  } else if (type === '收入') {
    // Include both periodic and volatile income (balance adjustments already filtered via '不计入')
    m.income += amount;
  }
}

// Round to 2dp
for (const ym of Object.keys(months)) {
  const m = months[ym];
  m.income = Math.round(m.income * 100) / 100;
  m.periodicLife = Math.round(m.periodicLife * 100) / 100;
  m.volatileLife = Math.round(m.volatileLife * 100) / 100;
  m.consumption = Math.round(m.consumption * 100) / 100;
  m.school = Math.round(m.school * 100) / 100;
  m.totalExpense = Math.round((m.periodicLife + m.volatileLife + m.consumption) * 100) / 100;
}

// Filter to relevant range (2021-01 to 2026-12) and sort descending
const relevant = Object.entries(months)
  .filter(([ym]) => ym >= '2021-01' && ym <= '2026-12')
  .sort(([a], [b]) => b.localeCompare(a));

console.log(JSON.stringify(Object.fromEntries(relevant), null, 2));
