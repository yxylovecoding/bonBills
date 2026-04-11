// MVP 阶段只放页面展示直接用到的类型
// 等确定风格后再扩展到 PLAN.md 里的完整模型

export type TagKind = 'school' | 'intern' | 'home' | 'travel' | 'rest';

export interface InvestHoldings {
  us: number;
  eu: number;
  asia: number;
  a: number;
  longBond: number;
  usBond: number;
  gold: number;
}

export interface LatestSnapshot {
  credit: number;         // 信用卡待还
  campusCard: number;     // 校园卡
  livingBank: number;     // 生活银行卡
  consumptionBank: number; // 消费(交行)
  investTotal: number;    // 理财总额
  investHoldings: InvestHoldings;
}

export interface MonthlyRecord {
  yearMonth: string;       // "2026-03"
  income: number;
  totalExpense: number;
  volatileLife: number;
  periodicLife: number;
  consumption: number;
  school: number;
  accumulatedProfit?: number;
  investTotal?: number;
  homeDays: number;
  travelDays: number;
}

export interface CurrentStats {
  periodicLifeAvg: number;
  volatileLifeAvg: number;
  consumptionAvg: number;
  totalExpenseAvg: number;
  monthlyIncomeAvg: number;
  schoolDailyAvg: number;
  savingsRate: number;
  totalLife: number;
}

// 资产配置目标比例 (MVP 用展示，暂不参与计算)
export interface InvestAllocTargets {
  us: number;
  eu: number;
  asia: number;
  a: number;
  longBond: number;
  usBond: number;
  gold: number;
}
