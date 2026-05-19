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
  taxRuleText?: string;  // 扣税规则文本（解析后从税前收入扣除）
}

export interface FutureFireExpense {
  id: string;
  name: string;
  monthlyAmount: number;
  isActive: boolean;
}

export interface AppConfig {
  birthDate: string;          // "2002-12-29"
  retireAge: number;          // 55
  fireTargetYears?: number;   // FIRE 攒钱目标年数，默认到退休年龄
  safeWithdrawRate: number;   // 0.04
  lifeExpectancy: number;     // 85
  investAllocTargets: InvestAllocTargets;
  creditBillDate: number;     // 26
  creditPayDate: number;      // 13
  creditPrepDays: number;     // 5
  reconcileDates: number[];   // [1, 11, 21]
  incomeItems: IncomeItem[];
  futureFireExpenses: FutureFireExpense[];
  majorExpenseThreshold: number; // 大额支出筛选门槛，默认 500
}

// ── AccountSnapshot ────────────────────────────────────────────────
export interface AccountSnapshot {
  date: string;
  reconcileType: 'first' | 'eleventh' | 'twentyFirst';
  accounts: {
    credit: number;        // 信用卡总待还
    creditMonthly: number; // 信用卡本月待还
    savingsCard: number;   // 储蓄卡（已预留还信用卡的钱，抵扣本期/下期待还）
    incomeBank: number;    // 收入账户
    livingBank: number;    // 生活账户
    campusCard: number;
    consumptionBank: number;
    wishJar: number;
    investCnyBank: number;       // 人民币理财账户
    usdLivingBank: number;       // 美元生活虚拟账户（美元原币）
    usdConsumptionBank: number;  // 美元消费虚拟账户（美元原币）
    usdWishJar: number;          // 美元心愿虚拟账户（美元原币）
    investUsdBank: number;       // 美元理财账户（美元原币）
  };
  investHoldings: InvestHoldings;
  investHoldingReserves?: Partial<InvestHoldings>; // 计入账户但不参与仓位再平衡的暂存金额
  transfersDone: {
    campusCard: number;
    repayment: number;
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
}

export interface MonthlyRecord {
  yearMonth: string;           // "2026-03"
  income: number;
  totalExpense: number;
  accumulatedProfit: number;   // 截止本月的累计盈利
  investTotal: number;          // 本月理财总额
  investBreakdown?: Partial<InvestHoldings>;       // 各品类持仓（月末）
  investBreakdownProfit?: Partial<InvestHoldings>; // 各品类累计收益（月末）
  investProfitComponents?: Partial<Record<'us' | 'usBond', { cny: number; rate: number; usd: number }>>;
  volatileLife: number;
  periodicLife: number;
  consumption: number;
  school: number;
  majorExpenses?: MajorExpense[];
  majorExpensesNote?: string;
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
  stateDailyAvg: { school: number; intern: number; home: number; travel: number };             // 生活支出日均（含共享均摊 base）
  stateConsumptionDailyAvg: { school: number; intern: number; home: number; travel: number }; // 消费支出日均
  stateDailyConfidence: { school: number; intern: number; home: number; travel: number };      // 各状态历史总天数
  sharedLifeDailyBase: number;  // 共享生活均摊基础日均（不分场景，已计入 stateDailyAvg）
  sharedLifeBreakdown: SharedLifeBreakdownRow[]; // 按分类拆解，sum 约等于 sharedLifeDailyBase
  savingsRate: number;
  totalLife: number;
}

export interface SharedLifeBreakdownRow {
  category: string;
  amountTotal: number;   // 历史累计金额（权重前）
  dailyBase: number;     // 加权后日均贡献
  subcategories: SharedLifeSubcategoryBreakdownRow[];
}

export interface SharedLifeSubcategoryBreakdownRow {
  subcategory: string;
  amountTotal: number;   // 历史累计金额（权重前）
  dailyBase: number;     // 加权后日均贡献
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
  stateDaysLeft: Record<TagKind, number>;
  stateDaysNextMonth: Record<TagKind, number>;
  weekly: BudgetTier;
  monthly: BudgetTier;
  beyond: BudgetTier;
  recommended: {
    campusCard: number;          // 校园卡需补充
    living: number;              // 生活账户需补充
    consumption: number;         // 消费账户分配
    wishJar: number;             // 心愿罐分配
    invest: number;              // 理财投入（收入剩余）
    needsRedemption: number;     // 需赎回理财（收入不足时 > 0）
    incomeAfterEssentials: number; // 补齐必要账户后收入剩余
  };
  // 各必要账户本月预计需求（用于显示对比）
  needs: {
    campusCard: number;
    living: number;
  };
}

// ── RebalanceResult ───────────────────────────────────────────────
export type RebalanceResult = Record<InvestKey, number>;
