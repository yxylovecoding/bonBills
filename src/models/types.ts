export type TagKind = 'intern' | 'school' | 'home' | 'travel';

// ── 理财持仓 ──────────────────────────────────────────────────────
export interface InvestHoldings {
  us: number;
  eu: number;
  asia: number;
  a: number;
  longBond: number;
  usBond: number;
  gold: number;
}

export type InvestKey = keyof InvestHoldings;

export interface InvestAllocTargets extends InvestHoldings {}

// ── AppConfig ─────────────────────────────────────────────────────
export interface IncomeItem {
  id: string;
  name: string;
  amount: number;        // 固定月收入（dailyRate 未设置时使用）
  payDay: number;        // 每月发薪日（1–31）
  isActive: boolean;
  dailyRate?: number;    // 日薪（设置后按 tagKind 天数动态计算总额）
  tagKind?: TagKind;     // 日薪对应的日历标签
}

export interface AppConfig {
  birthDate: string;          // "2002-12-29"
  retireAge: number;          // 55
  safeWithdrawRate: number;   // 0.04
  lifeExpectancy: number;     // 85
  investAllocTargets: InvestAllocTargets;
  creditBillDate: number;     // 26
  creditPayDate: number;      // 13
  creditPrepDays: number;     // 5
  reconcileDates: number[];   // [1, 11, 21]
  incomeItems: IncomeItem[];
}

// ── AccountSnapshot ────────────────────────────────────────────────
export interface AccountSnapshot {
  date: string;
  reconcileType: 'first' | 'eleventh' | 'twentyFirst';
  accounts: {
    credit: number;
    campusCard: number;
    livingBank: number;
    consumptionBank: number;
    wishJar: number;
  };
  investHoldings: InvestHoldings;
  transfersDone: {
    campusCard: number;
    living: number;
    consumption: number;
    wishJar: number;
    invest: number;
  };
}

// ── MonthlyRecord ─────────────────────────────────────────────────
export interface MajorExpense {
  type: '生活' | '消费';
  name: string;
  amount: number;
  note?: string;
}

export interface MonthlyRecord {
  yearMonth: string;           // "2026-03"
  income: number;
  totalExpense: number;
  accumulatedProfit: number;   // 截止本月的累计盈利
  investTotal: number;          // 本月理财总额
  volatileLife: number;
  periodicLife: number;
  consumption: number;
  school: number;
  majorExpenses?: MajorExpense[];
  // 从日历聚合
  homeDays: number;
  travelDays: number;
  schoolDays?: number;
  internDays?: number;
}

// ── DailyTag ──────────────────────────────────────────────────────
export interface DailyTag {
  date: string;   // "2026-04-11"
  tag: TagKind;
}

// ── CurrentStats (历史均值) ───────────────────────────────────────
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

// ── LatestSnapshot (首页用) ───────────────────────────────────────
export interface LatestSnapshot {
  credit: number;
  campusCard: number;
  livingBank: number;
  consumptionBank: number;
  investTotal: number;
  investHoldings: InvestHoldings;
}

// ── BudgetResult (对账计算结果) ───────────────────────────────────
export interface BudgetTier {
  income: number;
  expense: number;
}

export interface BudgetResult {
  daysLeftInMonth: number;
  schoolDaysLeft: number;
  homeDaysLeft: number;
  weekly: BudgetTier;
  monthly: BudgetTier;
  beyond: BudgetTier;
  recommended: {
    campusCard: number;
    living: number;
    consumption: number;
    wishJar: number;
    invest: number;
  };
}

// ── RebalanceResult ───────────────────────────────────────────────
export type RebalanceResult = Record<InvestKey, number>;
