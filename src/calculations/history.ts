import type { MonthlyRecord, CurrentStats, TagKind } from '../models/types';

// ── Ridge 回归（正规方程 + 对角正则化，避免奇异）────────────────
function ridgeSolve(X: number[][], y: number[], lambda = 0.1): number[] {
  const k = X[0].length;
  const n = X.length;

  const XtX: number[][] = Array.from({ length: k }, () => Array(k).fill(0));
  for (let i = 0; i < k; i++)
    for (let j = 0; j < k; j++)
      for (let r = 0; r < n; r++)
        XtX[i][j] += X[r][i] * X[r][j];

  for (let i = 0; i < k; i++) XtX[i][i] += lambda;

  const Xty: number[] = Array(k).fill(0);
  for (let i = 0; i < k; i++)
    for (let r = 0; r < n; r++)
      Xty[i] += X[r][i] * y[r];

  const aug: number[][] = XtX.map((row, i) => [...row, Xty[i]]);
  for (let col = 0; col < k; col++) {
    let pivotRow = -1;
    for (let row = col; row < k; row++) {
      if (Math.abs(aug[row][col]) > 1e-14) { pivotRow = row; break; }
    }
    if (pivotRow === -1) return Array(k).fill(0);
    [aug[col], aug[pivotRow]] = [aug[pivotRow], aug[col]];
    const scale = aug[col][col];
    for (let j = 0; j <= k; j++) aug[col][j] /= scale;
    for (let row = 0; row < k; row++) {
      if (row === col) continue;
      const f = aug[row][col];
      for (let j = 0; j <= k; j++) aug[row][j] -= f * aug[col][j];
    }
  }
  return aug.map((row) => row[k]);
}

// ── tagMap → 按月聚合各状态天数 ──────────────────────────────────
function buildTagCountsByMonth(tagMap: Record<string, TagKind>): Record<string, Record<TagKind, number>> {
  const result: Record<string, Record<TagKind, number>> = {};
  for (const [date, tag] of Object.entries(tagMap)) {
    const ym = date.slice(0, 7);
    if (!result[ym]) result[ym] = { school: 0, intern: 0, home: 0, travel: 0 };
    result[ym][tag]++;
  }
  return result;
}

// ── 主计算函数 ────────────────────────────────────────────────────
// tagMap 可选传入；有数据的月份优先用 tagMap 的实际天数，否则 fallback 到 MonthlyRecord 字段
export function calcHistoryStats(
  records: MonthlyRecord[],
  tagMap: Record<string, TagKind> = {},
): CurrentStats {
  const n = records.length;
  if (n === 0) {
    return {
      periodicLifeAvg: 0, volatileLifeAvg: 0, consumptionAvg: 0,
      totalExpenseAvg: 0, monthlyIncomeAvg: 0, schoolDailyAvg: 0,
      stateDailyAvg: { school: 0, intern: 0, home: 0, travel: 0 },
      stateConsumptionDailyAvg: { school: 0, intern: 0, home: 0, travel: 0 },
      stateDailyConfidence: { school: 0, intern: 0, home: 0, travel: 0 },
      savingsRate: 0, totalLife: 0,
    };
  }

  const tagCountsByMonth = buildTagCountsByMonth(tagMap);

  const sum = (key: keyof MonthlyRecord) =>
    records.reduce((s, r) => s + ((r[key] as number) ?? 0), 0);

  const periodicLifeAvg  = sum('periodicLife') / n;
  const volatileLifeAvg  = sum('volatileLife') / n;
  const consumptionAvg   = sum('consumption') / n;
  const totalExpenseAvg  = sum('totalExpense') / n;
  const monthlyIncomeAvg = sum('income') / n;

  const totalIncome  = sum('income');
  const totalExpense = sum('totalExpense');
  const savingsRate  = totalIncome > 0 ? (totalIncome - totalExpense) / totalIncome : 0;

  // 按月解析实际各状态天数：tagMap 优先，fallback 到 MonthlyRecord 字段或推算
  function getStateDays(r: MonthlyRecord): { school: number; intern: number; home: number; travel: number } {
    const tc = tagCountsByMonth[r.yearMonth];
    if (tc) return tc; // tagMap 有该月数据，直接用
    // fallback：从 MonthlyRecord 字段推算
    const [yr, mo] = r.yearMonth.split('-').map(Number);
    const daysInMonth = new Date(yr, mo, 0).getDate();
    const intern = r.internDays ?? 0;
    const home   = r.homeDays;
    const travel = r.travelDays;
    const school = r.schoolDays ?? Math.max(daysInMonth - intern - home - travel, 0);
    return { school, intern, home, travel };
  }

  // 校园卡日均（用 school 支出 / 实际在校天数）
  const schoolCampusMonths = records
    .map((r) => ({ r, days: getStateDays(r) }))
    .filter(({ days }) => days.school > 0);
  const schoolDailyAvg = schoolCampusMonths.length > 0
    ? schoolCampusMonths.reduce((s, { r, days }) => s + r.school / days.school, 0) / schoolCampusMonths.length
    : 0;

  // 各状态历史总天数（置信度）
  const stateDailyConfidence = records.reduce(
    (acc, r) => {
      const d = getStateDays(r);
      return {
        school: acc.school + d.school,
        intern: acc.intern + d.intern,
        home:   acc.home   + d.home,
        travel: acc.travel + d.travel,
      };
    },
    { school: 0, intern: 0, home: 0, travel: 0 },
  );

  // ── Ridge 回归：估算各状态生活支出日均 ──────────────────────────
  // X 列：[schoolDays, internDays, homeDays, travelDays]
  // y  ：periodicLife + volatileLife（生活支出，不含消费）
  const yVals = records.map((r) => r.periodicLife + r.volatileLife);
  const yMean = yVals.reduce((s, v) => s + v, 0) / n;
  const lambda = Math.max(yMean * 0.01, 0.1);

  const X: number[][] = records.map((r) => {
    const d = getStateDays(r);
    return [d.school, d.intern, d.home, d.travel];
  });

  const clamp = (v: number) => Math.max(v, 0);

  // 各状态出现的月份数
  const allDays = records.map((r) => getStateDays(r));
  const TAG_KEYS: TagKind[] = ['school', 'intern', 'home', 'travel'];
  const monthsWithState = { school: 0, intern: 0, home: 0, travel: 0 };
  for (const d of allDays) {
    for (const k of TAG_KEYS) if (d[k] > 0) monthsWithState[k]++;
  }

  const MIN_MONTHS = 3; // 少于 3 个月的状态不信任回归，用残差法

  // 回归①：生活支出（periodicLife + volatileLife）
  const betaLife = ridgeSolve(X, yVals, lambda);
  const stateDailyAvg = {
    school: clamp(betaLife[0]),
    intern: clamp(betaLife[1]),
    home:   clamp(betaLife[2]),
    travel: clamp(betaLife[3]),
  };

  // 回归②：消费支出（consumption）
  const yConsumption = records.map((r) => r.consumption);
  const yConsumptionMean = yConsumption.reduce((s, v) => s + v, 0) / n;
  const lambdaC = Math.max(yConsumptionMean * 0.01, 0.1);
  const betaConsumption = ridgeSolve(X, yConsumption, lambdaC);
  const stateConsumptionDailyAvg = {
    school: clamp(betaConsumption[0]),
    intern: clamp(betaConsumption[1]),
    home:   clamp(betaConsumption[2]),
    travel: clamp(betaConsumption[3]),
  };

  // 稀疏状态修正：数据不足时用残差法替代回归系数
  for (const sparseKey of TAG_KEYS) {
    if (monthsWithState[sparseKey] === 0 || monthsWithState[sparseKey] >= MIN_MONTHS) continue;
    let residualLife = 0, residualCons = 0, totalDays = 0;
    for (let i = 0; i < n; i++) {
      const d = allDays[i];
      if (d[sparseKey] <= 0) continue;
      let otherLife = 0, otherCons = 0;
      for (const ok of TAG_KEYS) {
        if (ok === sparseKey || monthsWithState[ok] < MIN_MONTHS) continue;
        otherLife += stateDailyAvg[ok] * d[ok];
        otherCons += stateConsumptionDailyAvg[ok] * d[ok];
      }
      residualLife += yVals[i] - otherLife;
      residualCons += yConsumption[i] - otherCons;
      totalDays += d[sparseKey];
    }
    if (totalDays > 0) {
      stateDailyAvg[sparseKey] = clamp(residualLife / totalDays);
      stateConsumptionDailyAvg[sparseKey] = clamp(residualCons / totalDays);
    }
  }

  return {
    periodicLifeAvg, volatileLifeAvg, consumptionAvg,
    totalExpenseAvg, monthlyIncomeAvg, schoolDailyAvg,
    stateDailyAvg, stateConsumptionDailyAvg, stateDailyConfidence,
    savingsRate, totalLife: periodicLifeAvg + volatileLifeAvg,
  };
}
