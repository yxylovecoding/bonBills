import type { MonthlyRecord, CurrentStats, TagKind } from '../models/types';
import type { BillExpenseMonth } from '../utils/importBill';
import { assignExpenseIds } from '../utils/importBill';
import { normalizeConfirmedSelection } from '../stores/calendarStore';
import type { LifePeriodOverrides } from '../stores/lifePeriodOverrideStore';
import { resolveLifePeriod } from '../stores/lifePeriodOverrideStore';

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

const TAG_KEYS: TagKind[] = ['school', 'intern', 'home', 'travel'];
type ByTag = Record<TagKind, number>;
const zeroByTag = (): ByTag => ({ school: 0, intern: 0, home: 0, travel: 0 });

// 单月已确切预聚合
//   shortLife/longLife：金额已被显式归属到短/长周期
//   resolvedLifeDays：该天所有 isLife 账单都已被显式归属（不论归到 short 还是 long）的天数
//   shortCons + shortConsDays：消费部分仅由 reviewed+勾选 决定，无 override
type MonthConfirmed = {
  shortLife: ByTag;
  shortCons: ByTag;
  resolvedLifeDays: ByTag;
  shortConsDays: ByTag;
  longLife: number;
};

function buildConfirmedAggregatesByMonth(
  records: MonthlyRecord[],
  tagMap: Record<string, TagKind>,
  confirmedExpenses: Record<string, { ids: string[]; reviewed: boolean } | string[]>,
  expenseItems: Record<string, BillExpenseMonth>,
  overrides: LifePeriodOverrides,
): MonthConfirmed[] {
  return records.map((r) => {
    const out: MonthConfirmed = {
      shortLife: zeroByTag(),
      shortCons: zeroByTag(),
      resolvedLifeDays: zeroByTag(),
      shortConsDays: zeroByTag(),
      longLife: 0,
    };
    const monthItems = expenseItems[r.yearMonth];
    if (!monthItems || monthItems.length === 0) return out;

    // 按日期分组当月账单
    const itemsByDate = new Map<string, { item: ReturnType<typeof assignExpenseIds>[number]['item']; id: string }[]>();
    for (const date of new Set(monthItems.map((it) => it.date))) {
      itemsByDate.set(date, assignExpenseIds(monthItems.filter((it) => it.date === date)));
    }

    for (const [date, dayItems] of itemsByDate) {
      const state = tagMap[date];
      if (!state) continue; // 无 tag 的天暂不归任何 state（也不进入 short/long 桶；金额仍在 y 里）

      const sel = normalizeConfirmedSelection(confirmedExpenses[date]);
      const reviewed = sel.reviewed;
      const selectedIds = new Set(sel.ids);

      let lifeAllResolved = true; // 该天所有 isLife 是否都被显式归属
      let dayHadShortCons = false;

      for (const { item, id } of dayItems) {
        const tagList = item.tags.split(',').map((t) => t.trim());
        const isLife = tagList.includes('周期生活') || tagList.includes('波动生活');
        const isCons = tagList.includes('消费');

        if (isLife) {
          // 优先级：override > reviewed-勾选 > 留在残差 y 里
          const ov = resolveLifePeriod(item, overrides);
          if (ov === 'long') {
            out.longLife += item.amount;
          } else if (ov === 'short') {
            out.shortLife[state] += item.amount;
          } else if (reviewed) {
            if (selectedIds.has(id)) out.shortLife[state] += item.amount;
            else out.longLife += item.amount;
          } else {
            // 未 reviewed 且无 override → 这条 isLife 留在月度 y 里给回归
            lifeAllResolved = false;
          }
        } else if (isCons) {
          // 消费仅在 reviewed 且勾选 时归短期；未勾选/未 reviewed 留 y
          if (reviewed && selectedIds.has(id)) {
            out.shortCons[state] += item.amount;
            dayHadShortCons = true;
          }
        }
      }

      // 该天 isLife 全部被显式归属 → resolvedLifeDays + 1（用于 X_life 残差扣除）
      // 没有 isLife 账单的天也算 "resolved"（life 部分本来就没有需要分配的金额）
      if (lifeAllResolved) out.resolvedLifeDays[state] += 1;
      if (dayHadShortCons) out.shortConsDays[state] += 1;
    }

    return out;
  });
}

// ── 主计算函数 ────────────────────────────────────────────────────
// tagMap 可选传入；有数据的月份优先用 tagMap 的实际天数，否则 fallback 到 MonthlyRecord 字段
// confirmedExpenses + expenseItems 可选传入；用于"扣除式反哺"+ 长周期均摊
export function calcHistoryStats(
  records: MonthlyRecord[],
  tagMap: Record<string, TagKind> = {},
  confirmedExpenses: Record<string, { ids: string[]; reviewed: boolean } | string[]> = {},
  expenseItems: Record<string, BillExpenseMonth> = {},
  overrides: LifePeriodOverrides = { categories: {}, subcategories: {}, tags: {} },
): CurrentStats {
  const n = records.length;
  if (n === 0) {
    return {
      periodicLifeAvg: 0, volatileLifeAvg: 0, consumptionAvg: 0,
      totalExpenseAvg: 0, monthlyIncomeAvg: 0, schoolDailyAvg: 0,
      stateDailyAvg: { school: 0, intern: 0, home: 0, travel: 0 },
      stateConsumptionDailyAvg: { school: 0, intern: 0, home: 0, travel: 0 },
      stateDailyConfidence: { school: 0, intern: 0, home: 0, travel: 0 },
      longLifeDailyBase: 0,
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
  function getStateDays(r: MonthlyRecord): ByTag {
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
  const allDays = records.map((r) => getStateDays(r));
  const stateDailyConfidence: ByTag = zeroByTag();
  for (const d of allDays) {
    for (const k of TAG_KEYS) stateDailyConfidence[k] += d[k];
  }

  // ── 已确切预聚合 ──────────────────────────────────────────────
  const confirmed = buildConfirmedAggregatesByMonth(records, tagMap, confirmedExpenses, expenseItems, overrides);

  // 历史汇总
  const totalConfShortLife: ByTag = zeroByTag();
  const totalConfShortCons: ByTag = zeroByTag();
  const totalResolvedLifeDays: ByTag = zeroByTag();
  const totalConfConsDays:  ByTag = zeroByTag();
  let totalLongLife = 0;
  for (const c of confirmed) {
    for (const k of TAG_KEYS) {
      totalConfShortLife[k] += c.shortLife[k];
      totalConfShortCons[k] += c.shortCons[k];
      totalResolvedLifeDays[k] += c.resolvedLifeDays[k];
      totalConfConsDays[k]  += c.shortConsDays[k];
    }
    totalLongLife += c.longLife;
  }

  // 长周期均摊 base：按月独立算「月长周期日均」后做时间衰减加权平均
  // 半衰期 6 个月：最新月权重 1，6 月前权重 0.5，12 月前权重 0.25
  // 这样话费等价格型支出在涨价后 base 能快速反映，季度订阅也不会被漏掉
  void totalLongLife; // 已不再直接使用（保留是为了调试/观察），改用月度展开
  const HALF_LIFE_MONTHS = 6;
  function ymToIndex(ym: string): number {
    const [y, m] = ym.split('-').map(Number);
    return y * 12 + (m - 1);
  }
  let maxYmIdx = -Infinity;
  for (const r of records) {
    const idx = ymToIndex(r.yearMonth);
    if (idx > maxYmIdx) maxYmIdx = idx;
  }
  let baseWeightSum = 0;
  let baseValueSum = 0;
  for (let i = 0; i < n; i++) {
    const totalDaysM = TAG_KEYS.reduce((s, k) => s + allDays[i][k], 0);
    if (totalDaysM <= 0) continue;
    const monthlyBase = confirmed[i].longLife / totalDaysM;
    const monthsAgo = maxYmIdx - ymToIndex(records[i].yearMonth);
    const weight = Math.pow(0.5, monthsAgo / HALF_LIFE_MONTHS);
    baseWeightSum += weight;
    baseValueSum += weight * monthlyBase;
  }
  const longLifeDailyBase = baseWeightSum > 0 ? baseValueSum / baseWeightSum : 0;

  // ── 残差回归：生活（扣除已勾短周期 + 长周期），消费（仅扣已勾短周期）──
  const yLifeResidual = records.map((r, i) => {
    const c = confirmed[i];
    const sumShort = TAG_KEYS.reduce((s, k) => s + c.shortLife[k], 0);
    return (r.periodicLife + r.volatileLife) - sumShort - c.longLife;
  });
  const yConsResidual = records.map((r, i) => {
    const c = confirmed[i];
    const sumShort = TAG_KEYS.reduce((s, k) => s + c.shortCons[k], 0);
    return r.consumption - sumShort;
  });

  const XLifeResidual: number[][] = records.map((_, i) => {
    const d = allDays[i];
    const c = confirmed[i];
    return [
      Math.max(0, d.school - c.resolvedLifeDays.school),
      Math.max(0, d.intern - c.resolvedLifeDays.intern),
      Math.max(0, d.home   - c.resolvedLifeDays.home),
      Math.max(0, d.travel - c.resolvedLifeDays.travel),
    ];
  });
  const XConsResidual: number[][] = records.map((_, i) => {
    const d = allDays[i];
    const c = confirmed[i];
    return [
      Math.max(0, d.school - c.shortConsDays.school),
      Math.max(0, d.intern - c.shortConsDays.intern),
      Math.max(0, d.home   - c.shortConsDays.home),
      Math.max(0, d.travel - c.shortConsDays.travel),
    ];
  });

  const clamp = (v: number) => Math.max(v, 0);

  // 各状态在残差 X 中仍有剩余天数的月份计数（用于稀疏判断）
  const monthsWithLifeResidual: ByTag = zeroByTag();
  const monthsWithConsResidual: ByTag = zeroByTag();
  for (let i = 0; i < n; i++) {
    for (let kIdx = 0; kIdx < TAG_KEYS.length; kIdx++) {
      const k = TAG_KEYS[kIdx];
      if (XLifeResidual[i][kIdx] > 0) monthsWithLifeResidual[k]++;
      if (XConsResidual[i][kIdx] > 0) monthsWithConsResidual[k]++;
    }
  }

  const MIN_MONTHS = 3; // 少于 3 个月的状态不信任回归，用残差法

  // 通用：跑 Ridge + 残差兜底，得到各状态的 β
  function solveWithResidualFallback(
    XR: number[][],
    yR: number[],
    monthsAvail: ByTag,
  ): ByTag {
    const yMean = yR.reduce((s, v) => s + v, 0) / n;
    const lambda = Math.max(yMean * 0.01, 0.1);
    const beta = ridgeSolve(XR, yR, lambda);
    const result: ByTag = {
      school: clamp(beta[0]),
      intern: clamp(beta[1]),
      home:   clamp(beta[2]),
      travel: clamp(beta[3]),
    };
    // 稀疏修正：数据不足的状态用残差法
    for (const sparseKey of TAG_KEYS) {
      if (monthsAvail[sparseKey] === 0 || monthsAvail[sparseKey] >= MIN_MONTHS) continue;
      let residual = 0;
      let totalDays = 0;
      const sparseIdx = TAG_KEYS.indexOf(sparseKey);
      for (let i = 0; i < n; i++) {
        const sparseDays = XR[i][sparseIdx];
        if (sparseDays <= 0) continue;
        let other = 0;
        for (let oIdx = 0; oIdx < TAG_KEYS.length; oIdx++) {
          const ok = TAG_KEYS[oIdx];
          if (ok === sparseKey || monthsAvail[ok] < MIN_MONTHS) continue;
          other += result[ok] * XR[i][oIdx];
        }
        residual += yR[i] - other;
        totalDays += sparseDays;
      }
      if (totalDays > 0) result[sparseKey] = clamp(residual / totalDays);
    }
    return result;
  }

  const betaLife = solveWithResidualFallback(XLifeResidual, yLifeResidual, monthsWithLifeResidual);
  const betaCons = solveWithResidualFallback(XConsResidual, yConsResidual, monthsWithConsResidual);

  // ── 合并：场景日均 = 短周期部分 + 长周期 base（仅生活）──
  const stateDailyAvg: ByTag = zeroByTag();
  const stateConsumptionDailyAvg: ByTag = zeroByTag();
  for (const s of TAG_KEYS) {
    const totalDays = stateDailyConfidence[s];
    if (totalDays <= 0) {
      stateDailyAvg[s] = 0;
      stateConsumptionDailyAvg[s] = 0;
      continue;
    }

    // 生活
    const remainLife = totalDays - totalResolvedLifeDays[s];
    let shortLifeAvg: number;
    if (remainLife <= 0) {
      shortLifeAvg = totalConfShortLife[s] / totalDays;
    } else {
      shortLifeAvg = (totalConfShortLife[s] + betaLife[s] * remainLife) / totalDays;
    }
    stateDailyAvg[s] = shortLifeAvg + longLifeDailyBase;

    // 消费
    const remainCons = totalDays - totalConfConsDays[s];
    if (remainCons <= 0) {
      stateConsumptionDailyAvg[s] = totalConfShortCons[s] / totalDays;
    } else {
      stateConsumptionDailyAvg[s] = (totalConfShortCons[s] + betaCons[s] * remainCons) / totalDays;
    }
  }

  return {
    periodicLifeAvg, volatileLifeAvg, consumptionAvg,
    totalExpenseAvg, monthlyIncomeAvg, schoolDailyAvg,
    stateDailyAvg, stateConsumptionDailyAvg, stateDailyConfidence,
    longLifeDailyBase,
    savingsRate, totalLife: periodicLifeAvg + volatileLifeAvg,
  };
}
