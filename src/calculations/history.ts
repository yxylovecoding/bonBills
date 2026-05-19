import type { MonthlyRecord, CurrentStats, TagKind } from '../models/types';
import type { BillExpenseMonth } from '../utils/importBill';
import { assignExpenseIds } from '../utils/importBill';
import { normalizeConfirmedSelection } from '../stores/calendarStore';
import type { ExpenseScopeOverrides } from '../stores/expenseScopeOverrideStore';
import { resolveExpenseScope } from '../stores/expenseScopeOverrideStore';

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
const zeroCategoryByTag = (): Record<TagKind, Record<string, number>> => ({ school: {}, intern: {}, home: {}, travel: {} });
const zeroSubcategoryByTag = (): Record<TagKind, Record<string, Record<string, number>>> => ({
  school: {},
  intern: {},
  home: {},
  travel: {},
});

// 单月已确切预聚合
//   localLife：金额已被显式归属到本地生活
//   sharedLife：仅周期生活里被归属到共享的金额，用于共享均摊 base
//   resolvedLifeDays：该天所有 isLife 账单都已被显式归属（不论归到 local 还是 shared）的天数
//   localCons + localConsDays：消费部分仅由 reviewed+勾选 决定，无 override
type MonthConfirmed = {
  localLife: ByTag;
  localCons: ByTag;
  resolvedLifeDays: ByTag;
  localConsDays: ByTag;
  sharedLife: number;
  localLifeByCategory: Record<TagKind, Record<string, number>>;
  localLifeBySubcategory: Record<TagKind, Record<string, Record<string, number>>>;
  sharedLifeByCategory: Record<string, number>;
  sharedLifeBySubcategory: Record<string, Record<string, number>>;
};

function buildConfirmedAggregatesByMonth(
  records: MonthlyRecord[],
  tagMap: Record<string, TagKind>,
  confirmedExpenses: Record<string, unknown>,
  expenseItems: Record<string, BillExpenseMonth>,
  overrides: ExpenseScopeOverrides,
  tripTagSet: Set<string>,
): MonthConfirmed[] {
  return records.map((r) => {
    const out: MonthConfirmed = {
      localLife: zeroByTag(),
      localCons: zeroByTag(),
      resolvedLifeDays: zeroByTag(),
      localConsDays: zeroByTag(),
      sharedLife: 0,
      localLifeByCategory: zeroCategoryByTag(),
      localLifeBySubcategory: zeroSubcategoryByTag(),
      sharedLifeByCategory: {},
      sharedLifeBySubcategory: {},
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
      if (!state) continue; // 无 tag 的天暂不归任何 state（也不进入 local/shared 桶；金额仍在 y 里）

      const sel = normalizeConfirmedSelection(confirmedExpenses[date]);
      const reviewed = sel.reviewed;
      const localSet = new Set(sel.localIds);
      const hasExplicitShared = sel.sharedIds !== undefined;
      const sharedSet = new Set(sel.sharedIds ?? []);

      let lifeAllResolved = true; // 该天所有 isLife 是否都被显式归属
      let dayHadLocalCons = false;

      for (const { item, id } of dayItems) {
        const tagList = item.tags.split(',').map((t) => t.trim());
        const isPeriodicLife = tagList.includes('周期生活');
        const isLife = isPeriodicLife || tagList.includes('波动生活');
        const isCons = tagList.includes('消费');

        // 出游归集：命中 trip tag 的账单直接转入 travel 桶，不论当天 state，
        // 也不动 resolvedLifeDays / localConsDays（只搬钱不搬天）
        if (tripTagSet.size > 0 && tagList.some((t) => tripTagSet.has(t))) {
          if (isLife) {
            out.localLife.travel += item.amount;
            const cat = item.category || '(未分类)';
            const sub = item.subcategory || '未细分';
            out.localLifeByCategory.travel[cat] = (out.localLifeByCategory.travel[cat] ?? 0) + item.amount;
            out.localLifeBySubcategory.travel[cat] = out.localLifeBySubcategory.travel[cat] ?? {};
            out.localLifeBySubcategory.travel[cat][sub] = (out.localLifeBySubcategory.travel[cat][sub] ?? 0) + item.amount;
          } else if (isCons) {
            out.localCons.travel += item.amount;
          }
          // life 类视为已 resolved（不进 !lifeAllResolved 分支）
          continue;
        }

        if (isLife) {
          // 优先级：override > 显式 local/shared > 旧数据 reviewed 兜底 > 残差
          const ov = resolveExpenseScope(item, overrides);
          const addLocal = () => {
            out.localLife[state] += item.amount;
            const cat = item.category || '(未分类)';
            const sub = item.subcategory || '未细分';
            out.localLifeByCategory[state][cat] = (out.localLifeByCategory[state][cat] ?? 0) + item.amount;
            out.localLifeBySubcategory[state][cat] = out.localLifeBySubcategory[state][cat] ?? {};
            out.localLifeBySubcategory[state][cat][sub] = (out.localLifeBySubcategory[state][cat][sub] ?? 0) + item.amount;
          };
          const addShared = () => {
            out.sharedLife += item.amount;
            const cat = item.category || '(未分类)';
            const sub = item.subcategory || '未细分';
            out.sharedLifeByCategory[cat] = (out.sharedLifeByCategory[cat] ?? 0) + item.amount;
            out.sharedLifeBySubcategory[cat] = out.sharedLifeBySubcategory[cat] ?? {};
            out.sharedLifeBySubcategory[cat][sub] = (out.sharedLifeBySubcategory[cat][sub] ?? 0) + item.amount;
          };
          if (ov === 'shared' && isPeriodicLife) {
            addShared();
          } else if (ov === 'local') {
            addLocal();
          } else if (localSet.has(id)) {
            addLocal();
          } else if (sharedSet.has(id) && isPeriodicLife) {
            addShared();
          } else if (reviewed && !hasExplicitShared && isPeriodicLife) {
            // 旧数据兼容：reviewed 但没存 sharedIds → 未勾即共享
            addShared();
          } else {
            // 新数据模型下：未显式归属即残差，留给月度 y 回归
            lifeAllResolved = false;
          }
        } else if (isCons) {
          // 消费仅在显式归本地时进入本地；其它情况留 y
          if (localSet.has(id)) {
            out.localCons[state] += item.amount;
            dayHadLocalCons = true;
          }
        }
      }

      // 该天 isLife 全部被显式归属 → resolvedLifeDays + 1（用于 X_life 残差扣除）
      // 没有 isLife 账单的天也算 "resolved"（life 部分本来就没有需要分配的金额）
      if (lifeAllResolved) out.resolvedLifeDays[state] += 1;
      if (dayHadLocalCons) out.localConsDays[state] += 1;
    }

    return out;
  });
}

// ── 主计算函数 ────────────────────────────────────────────────────
// tagMap 可选传入；有数据的月份优先用 tagMap 的实际天数，否则 fallback 到 MonthlyRecord 字段
// confirmedExpenses + expenseItems 可选传入；用于"扣除式反哺"+ 共享均摊
export function calcHistoryStats(
  records: MonthlyRecord[],
  tagMap: Record<string, TagKind> = {},
  confirmedExpenses: Record<string, unknown> = {},
  expenseItems: Record<string, BillExpenseMonth> = {},
  overrides: ExpenseScopeOverrides = { categories: {}, subcategories: {}, notes: {}, tags: {} },
  tripTags: Record<string, string> = {},
): CurrentStats {
  const n = records.length;
  if (n === 0) {
    return {
      periodicLifeAvg: 0, volatileLifeAvg: 0, consumptionAvg: 0,
      totalExpenseAvg: 0, monthlyIncomeAvg: 0, schoolDailyAvg: 0,
      stateDailyAvg: { school: 0, intern: 0, home: 0, travel: 0 },
      stateConsumptionDailyAvg: { school: 0, intern: 0, home: 0, travel: 0 },
      stateDailyConfidence: { school: 0, intern: 0, home: 0, travel: 0 },
      localLifeBreakdown: { school: [], intern: [], home: [], travel: [] },
      sharedLifeDailyBase: 0, sharedLifeBreakdown: [],
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
  const tripTagSet = new Set(Object.values(tripTags).filter((v) => !!v));
  const confirmed = buildConfirmedAggregatesByMonth(records, tagMap, confirmedExpenses, expenseItems, overrides, tripTagSet);

  // 历史汇总
  const totalConfLocalLife: ByTag = zeroByTag();
  const totalConfLocalCons: ByTag = zeroByTag();
  const totalResolvedLifeDays: ByTag = zeroByTag();
  const totalConfConsDays:  ByTag = zeroByTag();
  const localLifeByCategory = zeroCategoryByTag();
  const localLifeBySubcategory = zeroSubcategoryByTag();
  let totalSharedLife = 0;
  for (const c of confirmed) {
    for (const k of TAG_KEYS) {
      totalConfLocalLife[k] += c.localLife[k];
      totalConfLocalCons[k] += c.localCons[k];
      totalResolvedLifeDays[k] += c.resolvedLifeDays[k];
      totalConfConsDays[k]  += c.localConsDays[k];
      for (const [cat, amount] of Object.entries(c.localLifeByCategory[k])) {
        localLifeByCategory[k][cat] = (localLifeByCategory[k][cat] ?? 0) + amount;
      }
      for (const [cat, subMap] of Object.entries(c.localLifeBySubcategory[k])) {
        localLifeBySubcategory[k][cat] = localLifeBySubcategory[k][cat] ?? {};
        for (const [sub, amount] of Object.entries(subMap)) {
          localLifeBySubcategory[k][cat][sub] = (localLifeBySubcategory[k][cat][sub] ?? 0) + amount;
        }
      }
    }
    totalSharedLife += c.sharedLife;
  }

  const localLifeBreakdown = Object.fromEntries(TAG_KEYS.map((k) => {
    const totalDays = stateDailyConfidence[k];
    const rows = totalDays > 0
      ? Object.entries(localLifeByCategory[k])
          .map(([category, amountTotal]) => ({
            category,
            amountTotal,
            dailyBase: amountTotal / totalDays,
            subcategories: Object.entries(localLifeBySubcategory[k][category] ?? {})
              .map(([subcategory, subAmountTotal]) => ({
                subcategory,
                amountTotal: subAmountTotal,
                dailyBase: subAmountTotal / totalDays,
              }))
              .sort((a, b) => b.dailyBase - a.dailyBase),
          }))
          .sort((a, b) => b.dailyBase - a.dailyBase)
      : [];
    return [k, rows];
  })) as CurrentStats['localLifeBreakdown'];

  // 共享均摊 base：按月独立算「月共享日均」后做时间衰减加权平均
  // 半衰期 6 个月：最新月权重 1，6 月前权重 0.5，12 月前权重 0.25
  // 这样话费等价格型支出在涨价后 base 能快速反映，季度订阅也不会被漏掉
  void totalSharedLife; // 已不再直接使用（保留是为了调试/观察），改用月度展开
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
  const byCatValueSum: Record<string, number> = {};
  const byCatAmountTotal: Record<string, number> = {};
  const bySubValueSum: Record<string, Record<string, number>> = {};
  const bySubAmountTotal: Record<string, Record<string, number>> = {};
  for (let i = 0; i < n; i++) {
    const totalDaysM = TAG_KEYS.reduce((s, k) => s + allDays[i][k], 0);
    if (totalDaysM <= 0) continue;
    const monthlyBase = confirmed[i].sharedLife / totalDaysM;
    const monthsAgo = maxYmIdx - ymToIndex(records[i].yearMonth);
    const weight = Math.pow(0.5, monthsAgo / HALF_LIFE_MONTHS);
    baseWeightSum += weight;
    baseValueSum += weight * monthlyBase;
    for (const [cat, amt] of Object.entries(confirmed[i].sharedLifeByCategory)) {
      byCatValueSum[cat] = (byCatValueSum[cat] ?? 0) + weight * (amt / totalDaysM);
      byCatAmountTotal[cat] = (byCatAmountTotal[cat] ?? 0) + amt;
    }
    for (const [cat, subMap] of Object.entries(confirmed[i].sharedLifeBySubcategory)) {
      bySubValueSum[cat] = bySubValueSum[cat] ?? {};
      bySubAmountTotal[cat] = bySubAmountTotal[cat] ?? {};
      for (const [sub, amt] of Object.entries(subMap)) {
        bySubValueSum[cat][sub] = (bySubValueSum[cat][sub] ?? 0) + weight * (amt / totalDaysM);
        bySubAmountTotal[cat][sub] = (bySubAmountTotal[cat][sub] ?? 0) + amt;
      }
    }
  }
  const sharedLifeDailyBase = baseWeightSum > 0 ? baseValueSum / baseWeightSum : 0;
  const sharedLifeBreakdown = baseWeightSum > 0
    ? Object.entries(byCatValueSum)
        .map(([category, vSum]) => ({
          category,
          amountTotal: byCatAmountTotal[category] ?? 0,
          dailyBase: vSum / baseWeightSum,
          subcategories: Object.entries(bySubValueSum[category] ?? {})
            .map(([subcategory, subVSum]) => ({
              subcategory,
              amountTotal: bySubAmountTotal[category]?.[subcategory] ?? 0,
              dailyBase: subVSum / baseWeightSum,
            }))
            .sort((a, b) => b.dailyBase - a.dailyBase),
        }))
        .sort((a, b) => b.dailyBase - a.dailyBase)
    : [];

  // ── 残差回归：生活（扣除本地 + 共享），消费（仅扣本地）──
  const yLifeResidual = records.map((r, i) => {
    const c = confirmed[i];
    const sumLocal = TAG_KEYS.reduce((s, k) => s + c.localLife[k], 0);
    return (r.periodicLife + r.volatileLife) - sumLocal - c.sharedLife;
  });
  const yConsResidual = records.map((r, i) => {
    const c = confirmed[i];
    const sumLocal = TAG_KEYS.reduce((s, k) => s + c.localCons[k], 0);
    return r.consumption - sumLocal;
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
      Math.max(0, d.school - c.localConsDays.school),
      Math.max(0, d.intern - c.localConsDays.intern),
      Math.max(0, d.home   - c.localConsDays.home),
      Math.max(0, d.travel - c.localConsDays.travel),
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

  // ── 合并：场景日均 = 本地部分 + 共享 base（仅生活）──
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
    let localLifeAvg: number;
    if (remainLife <= 0) {
      localLifeAvg = totalConfLocalLife[s] / totalDays;
    } else {
      localLifeAvg = (totalConfLocalLife[s] + betaLife[s] * remainLife) / totalDays;
    }
    stateDailyAvg[s] = localLifeAvg + sharedLifeDailyBase;

    // 消费
    const remainCons = totalDays - totalConfConsDays[s];
    if (remainCons <= 0) {
      stateConsumptionDailyAvg[s] = totalConfLocalCons[s] / totalDays;
    } else {
      stateConsumptionDailyAvg[s] = (totalConfLocalCons[s] + betaCons[s] * remainCons) / totalDays;
    }
  }

  return {
    periodicLifeAvg, volatileLifeAvg, consumptionAvg,
    totalExpenseAvg, monthlyIncomeAvg, schoolDailyAvg,
    stateDailyAvg, stateConsumptionDailyAvg, stateDailyConfidence,
    localLifeBreakdown,
    sharedLifeDailyBase, sharedLifeBreakdown,
    savingsRate, totalLife: periodicLifeAvg + volatileLifeAvg,
  };
}
