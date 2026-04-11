# 盘账助手 - 个人财务管理Web应用 详细开发计划

## 项目概述

复刻并升级一个Excel个人财务管理系统，转为React Web应用。用户是一名在校研究生，每月通过分账户体系管理生活、消费、理财资金，每10天对账一次（1号、11号、21号），每月1号归档上月数据。

## 技术栈

- **框架**: React (Vite)
- **状态管理**: Zustand
- **路由**: React Router v6
- **UI**: Tailwind CSS
- **图表**: Recharts
- **日期**: date-fns
- **持久化**: localStorage (后续可迁移IndexedDB)
- **部署**: Vercel / Netlify

## 色彩规范

| 语义 | 颜色 | 用途 |
|------|------|------|
| 生活 | 蓝色 `#3b82f6` | 所有生活类支出、账户 |
| 消费 | 紫色 `#8b5cf6` | 消费类支出、交行账户 |
| 支出 | 绿色 `#10b981` | 支出总额显示 |
| 收入 | 红色 `#ef4444` | 收入相关数据 |
| 用户输入 | 淡黄色 `#fef3c7` bg | 需要用户手动填写的字段 |
| 待执行 | 橙色 `#fb923c` bg | 计算出的需要用户执行的操作 |

## 数据模型

### 1. AppConfig (全局配置，对应原"年"sheet，用户不直接看到)

```typescript
interface AppConfig {
  birthDate: string; // "2002-12-29"
  retireAge: number; // 55
  safeWithdrawRate: number; // 0.04

  // 理财目标比例 (股/债/商品各占1/3，内部再分)
  investAllocTargets: {
    us: number;      // 0.2333 (股70%)
    eu: number;      // 0.0333
    asia: number;    // 0.0333
    a: number;       // 0.0333
    longBond: number; // 0.2333
    usBond: number;  // 0.1
    gold: number;    // 0.3333
  };

  // 信用卡周期
  creditBillDate: number;   // 26 (出账日)
  creditPayDate: number;    // 13 (还款日)
  creditPrepDays: number;   // 5 (提前准备天数，考虑赎回时间)

  // 对账日
  reconcileDates: number[]; // [1, 11, 21]

  // 收入来源配置 (用于now sheet的时间预算中的收入项)
  incomeItems: {
    id: string;
    name: string;       // "导师劳务费", "院校低保", "家教"
    amount: number;      // 月收入金额
    isActive: boolean;
  }[];
}
```

### 2. AccountSnapshot (每次对账时的账户快照)

```typescript
interface AccountSnapshot {
  date: string; // ISO date "2026-04-11"
  reconcileType: "first" | "eleventh" | "twentyFirst";

  // 各账户余额 (用户输入，淡黄色)
  accounts: {
    credit: number;        // 信用卡待还额
    campusCard: number;    // 校园卡余额
    livingBank: number;    // 生活银行卡余额
    consumptionBank: number; // 消费账户(交行)余额
    wishJar: number;       // 心愿罐余额
  };

  // 理财各品类当前金额 (用户输入，淡黄色)
  investHoldings: {
    us: number;
    eu: number;
    asia: number;
    a: number;
    longBond: number;
    usBond: number;
    gold: number;
  };

  // 已执行转账 (用户输入，淡黄色)
  transfersDone: {
    campusCard: number;
    living: number;
    consumption: number;
    wishJar: number;
    invest: number;
  };
}
```

### 3. MonthlyRecord (每月归档数据，对应历史月sheet)

```typescript
interface MonthlyRecord {
  yearMonth: string; // "2026-03"

  // 用户输入 (淡黄色)
  income: number;              // 总收入
  totalExpense: number;        // 总支出
  accumulatedProfit: number;   // 累计盈利(用于算本月理财收入)
  investTotal: number;         // 理财总额(用于算收益率)
  volatileLife: number;        // 波动生活
  periodicLife: number;        // 周期生活
  consumption: number;         // 消费
  school: number;              // 校园卡支出

  // 大型支出明细
  majorExpenses: {
    type: "生活" | "消费";     // 生活=蓝色, 消费=紫色
    name: string;
    amount: number;
    note?: string;
  }[];

  // 自动计算
  investIncome: number;        // = 本月累计盈利 - 上月累计盈利
  investAnnualReturn: number;  // 理财年化收益率
  totalLife: number;           // = 周期生活 + 波动生活
  surplus: number;             // = 收入 - 总支出
  lifeSurplus: number;         // = 收入 - 生活支出

  // 天数统计 (从日历tag聚合)
  dayStats: {
    school: number;
    home: number;
    intern: number;
    travel: number;
    rest: number;
  };

  // 按tag类型的日均花费 (自动从dayStats + 支出计算)
  dailyAvgByTag: {
    school: number;    // 在校日均
    home: number;      // 在家日均
    intern: number;    // 实习日均
    travel: number;    // 出差/旅游日均
  };

  schoolDailyAvg: number; // 折算school/天 = school / 在校天数
}
```

### 4. DailyTag (日历标签)

```typescript
interface DailyTag {
  date: string;       // "2026-04-11"
  tag: "school" | "intern" | "home" | "travel" | "rest";
}
```

### 5. BudgetCalculation (对账时自动计算的预算，对应原月初sheet)

```typescript
interface BudgetCalculation {
  // 时间维度
  daysLeftInMonth: number;
  schoolDaysLeft: number;      // 从日历tag推算
  homeDaysLeft: number;

  // 四层预算 (周内 < 月内 < 月外)
  budget: {
    weekly: { income: number; expense: number; };
    monthly: { income: number; expense: number; };
    beyond: { income: number; expense: number; };
  };

  // 建议转账金额 (橙色，待执行)
  recommended: {
    campusCard: number;   // 应转校园卡
    living: number;       // 应转生活费
    consumption: number;  // 应转消费(交行)
    wishJar: number;      // 应转心愿罐
    invest: number;       // 应转理财
  };

  // 还需转账 = 建议 - 已转
  remaining: {
    campusCard: number;
    living: number;
    consumption: number;
    wishJar: number;
    invest: number;
  };

  // 转账后各层余额递推
  balanceAfter: {
    cash: number;
    weekly: number;
    monthly: number;
    beyond: number;
  };

  // 理财再平衡建议
  rebalance: {
    [key: string]: number; // 每个品类应加仓金额
  };
}
```

## 页面结构

### Page 1: 主页 `/`

**布局**: 单列卡片流

**卡片1: 财务概览**
- 理财总额 (大字)
- 净资产
- 本月已过天数/总天数进度条

**卡片2: 月度快照**
- 月均收入 (红色)
- 月均支出 (绿色)
  - 周期生活 (蓝色, 缩进)
  - 波动生活 (蓝色, 缩进)
  - 消费 (紫色, 缩进)
- 月均结余
- 储蓄率
- 各tag场景日均花费 (在校/在家/实习/出差)

**卡片3: FIRE 提前退休**
- 进度条 (当前资产 / 目标资产)
- 目标资产 (4%法则): 年支出 / 0.04
- 目标资产 (年龄法则): 年支出 × (退休年龄 - 当前年龄)
- 取较小值
- 当前年龄, 已积累, 月需存入, 当前月结余
- 人生进度条 (年龄/预期寿命)

**卡片4: 资产配置**
- 堆叠条形图显示当前比例
- 各品类: 名称, 金额, 当前比例, 目标比例, 偏差
- 偏差小于2%=绿色, 超配=红色, 欠配=蓝色

**卡片5: 账户余额**
- 信用卡(待还), 校园卡, 生活, 消费, 理财
- 信用卡还款倒计时提醒

**数据来源**: 从最近一次AccountSnapshot + 历史MonthlyRecord均值计算

---

### Page 2: 日历 `/calendar`

**布局**: 月历网格 + 底部统计

**顶部**: 月份导航 (< 四月 2026 >)

**Tag选择器**: 横向滚动按钮组, 每个tag有icon和颜色
- 📚上学(蓝) 💼实习(紫) 🏠回家(绿) ✈️出差/旅游(橙) 😴休息(灰)

**日历网格**:
- 7列(日-六), 每格显示日期数字
- 点击格子 → 设置为当前选中tag (再点取消)
- 已标记的格子显示tag对应的背景色+小icon
- 今天高亮边框
- 有月度历史数据时，格子可额外显示当日支出小数字(后续从记账导入)

**底部统计卡片**:
- 各tag天数柱状图
- 本月已标记天数 / 总天数
- 未标记天数提醒

**数据存储**: `dailyTags` 按月存储, key = `tags:{YYYY-MM}`

**后续**: 接入Outlook日历API, 根据日程自动识别tag (会议=实习, 课表=上学, etc.)

---

### Page 3: 对账 `/reconcile`

**根据日期自动判断模式**, 也可手动切换

#### 模式A: 11号/21号 (常规对账)

**Step 1: 录入账户余额** (淡黄色输入框)
- 信用卡待还额
- 校园卡余额
- 生活银行卡余额
- 消费(交行)余额

**Step 2: 自动预算计算** (系统计算, 显示结果)

预算计算逻辑 (复刻月初sheet):
```
本月剩余天数 = getDaysInMonth() - today
在校剩余天数 = 从日历tag推算 (未标记的天数默认为上学)

// 周内预算 (最近10天)
周内支出预算 = (历史月均生活支出/30 × min(剩余天数, 10) + 波动调整) / 3
周内收入预算 = 周期收入 × min(7, 剩余天数) / 30

// 月内预算 (本月剩余)
月内支出预算 = 周期生活月均 + 波动生活月均
月内收入预算 = max(周期收入×剩余天数 - 周内收入, 0)

// 月外预算 (跨月)
月外支出预算 = max(周期预算×(剩余天数-7), 0) + 回家天数×200 + 愿望清单应转
月外收入预算 = 月收入×30 (全月)

// 应转金额
应转校园卡 = max(ceil(在校日均/30 × 剩余天数 - 已转校园卡), 0)
应转生活费 = max(周内支出预算 - 已转生活费, 0)
应转理财 = floor(可用余额)  // 可用 = 所有收入 - 所有预算支出 - 已转
应转消费 = 消费预算的一部分
应转心愿 = 愿望清单计算的月应存

// 余额递推 (每一步扣除后的余额)
收入余额 → 扣校园卡 → 扣生活费 → 扣月内预算 → 扣月外预算 → 剩余
```

**Step 3: 建议转账** (橙色显示)
- 表格: 目的账户 | 应转金额 | 已转金额 | 还需转
- 用户输入"已转"列 (淡黄色)
- "还需转" = 应转 - 已转

**Step 4: 信用卡提醒**
- 如果当前日期在20-26号: "⚠️ 26号出账, 请确认消费"
- 如果当前日期在8-13号: "⚠️ 13号还款, 请确保还款账户有 ¥X"
- 根据理财赎回时间提前提醒 (creditPrepDays)

**保存**: 存为AccountSnapshot

#### 模式B: 1号 (月初归档)

**包含模式A的所有内容**, 额外增加:

**额外Step: 上月归档** (在最前面)

录入上月数据 (淡黄色输入框):
- 收入
- 总支出
- 累计盈利 (不是本月盈利, 是截止本月的累计值)
- 理财总额
- 波动生活
- 周期生活
- 消费
- 校园卡支出(school)

大型支出明细 (可动态增减行):
- [生活/消费] 下拉 + 项目名 + 金额 + 备注

自动计算并显示:
- 理财收入 = 本月累计盈利 - 上月累计盈利
- 理财年化 = 理财收入 / 理财总额 × 12
- 折算日均 = school / 在校天数 (天数从日历tag获取)
- 生活支出 = 周期 + 波动
- 结余 = 收入 - 总支出
- 生活结余 = 收入 - 生活支出

**额外Step: 理财录入**

各品类当前金额 (淡黄色):
- 美股, 欧股, 亚股, A股, 长债, 美债, 黄金

自动计算:
- 当前比例 vs 目标比例
- 再平衡建议 (加仓金额)

再平衡逻辑:
```
新增资金 = 本次可投入理财的金额
总资产 = sum(各品类当前金额) + 新增资金

对每个品类:
  目标金额 = 总资产 × 目标比例
  差额 = 目标金额 - 当前金额
  if 差额 > 0: 正差额(欠配)
  if 差额 < 0: 负差额(超配)

正差额品类按比例分配新增资金:
  品类加仓 = 新增资金 × (该品类正差额 / 所有正差额之和)
```

**保存**: 存为MonthlyRecord + AccountSnapshot, 更新AppConfig中的统计均值

---

### Page 4: 历史 `/history`

**两个子视图tab**: 月度 | 年度

#### 月度视图

**列表**: 按时间倒序显示所有MonthlyRecord
- 每行: 月份 | 收入 | 支出 | 结余(红/绿) | 储蓄率

**点击展开详情**:
- 上半部分: 关键数据
  - 收入, 总支出, 结余
  - 周期生活, 波动生活, 消费
  - 理财收入, 理财年化
  - 各tag天数, 各场景日均花费
- 下半部分: 大型支出列表
  - [蓝/紫标签] 项目名 金额

**月度趋势图** (Recharts):
- 折线图: 收入 vs 支出 vs 结余 趋势
- 堆叠柱状图: 周期生活 + 波动生活 + 消费 的构成

#### 年度视图

**年度汇总卡片**:
- 总收入, 总支出, 总结余, 储蓄率
- 月均: 收入, 支出, 周期生活, 波动生活, 消费
- 各tag总天数, 各场景平均日均花费

**支出分类饼图** (后续从记账数据构建):
- 饮食, 生活, 购物, 娱乐, 交通, 课学, 人际, 医疗, 其他
- 每类可展开子分类

**年度趋势**: 月度数据的12个月折线图

---

## 核心计算逻辑

### 预算分配 (复刻月初sheet核心公式)

```typescript
function calculateBudget(
  config: AppConfig,
  snapshot: AccountSnapshot,
  historyAvg: HistoryAverages,
  calendarTags: DailyTag[],
  currentDate: Date
): BudgetCalculation {

  const daysInMonth = getDaysInMonth(currentDate);
  const dayOfMonth = currentDate.getDate();
  const daysLeft = daysInMonth - dayOfMonth;

  // 从日历推算剩余天数
  const futureSchoolDays = countFutureTagDays(calendarTags, "school", currentDate);
  const futureHomeDays = countFutureTagDays(calendarTags, "home", currentDate);

  // === 收入预算 ===
  const weeklyIncome = (historyAvg.schoolDailyAvg * 7) / 3; // 周内平滑
  const monthlyIncome = Math.max(
    (historyAvg.monthlyIncome - historyAvg.schoolDailyAvg * 7) * daysLeft / daysInMonth - weeklyIncome,
    0
  );
  const beyondIncome = historyAvg.monthlyIncome * 30;

  // === 支出预算 ===
  const weeklyExpense = (historyAvg.totalLife / 30 * Math.min(daysLeft, 10)
    + historyAvg.volatileLifeAvg * Math.min(7, daysLeft) / 30) / 3;
  const monthlyExpense = historyAvg.periodicLifeAvg + wishListMonthlyDue;
  const beyondExpense = Math.max(
    historyAvg.periodicLifeAvg * (daysLeft - 7) / 30, 0
  ) + futureHomeDays * 200 + wishListMonthlyDue;

  // === 转账建议 ===
  const campusCardNeeded = Math.max(
    Math.ceil(historyAvg.schoolDailyAvg / 30 * daysLeft) - snapshot.transfersDone.campusCard,
    0
  );
  const livingNeeded = Math.max(
    Math.ceil(weeklyExpense) - snapshot.transfersDone.living,
    0
  );

  // 可用于理财的余额
  const availableForInvest = Math.floor(
    totalIncome - totalExpenseBudget - allTransfersDone
  );

  // === 余额递推 ===
  let balance = totalIncome;
  balance -= campusCardNeeded;   // 扣校园卡
  balance -= livingNeeded;        // 扣生活费
  balance -= monthlyExpense;      // 扣月内预算
  balance -= beyondExpense;       // 扣月外预算
  // balance = 剩余可投资/消费

  // === 理财再平衡 ===
  const newFunds = availableForInvest;
  const rebalance = calculateRebalance(
    snapshot.investHoldings,
    config.investAllocTargets,
    newFunds
  );

  return { /* ... */ };
}
```

### 理财再平衡

```typescript
function calculateRebalance(
  holdings: Record<string, number>,
  targets: Record<string, number>,
  newFunds: number
): Record<string, number> {
  const totalAfter = Object.values(holdings).reduce((s, v) => s + v, 0) + newFunds;
  const diffs: Record<string, number> = {};

  for (const [key, current] of Object.entries(holdings)) {
    const target = totalAfter * targets[key];
    diffs[key] = target - current;
  }

  // 只分配给欠配的品类
  const positiveDiffs = Object.entries(diffs).filter(([, v]) => v > 0);
  const totalPositive = positiveDiffs.reduce((s, [, v]) => s + v, 0);

  const result: Record<string, number> = {};
  for (const [key] of Object.entries(holdings)) {
    if (diffs[key] > 0 && totalPositive > 0) {
      result[key] = newFunds * (diffs[key] / totalPositive);
    } else {
      result[key] = 0;
    }
  }
  return result;
}
```

### FIRE计算

```typescript
function calculateFIRE(config: AppConfig, historyAvg: HistoryAverages) {
  const age = getAge(config.birthDate);
  const annualExpense = historyAvg.totalExpenseAvg * 12;

  const target4pct = annualExpense / config.safeWithdrawRate;
  const targetAge = annualExpense * (config.retireAge - age);
  const fireTarget = Math.min(target4pct, targetAge);

  const progress = config.investTotal / fireTarget;
  const monthlyNeeded = (fireTarget - config.investTotal) / ((config.retireAge - age) * 12);
  const monthlySurplus = historyAvg.monthlyIncome - historyAvg.totalExpenseAvg;

  return {
    age, fireTarget, target4pct, targetAge,
    progress, monthlyNeeded, monthlySurplus,
    yearsToFIRE: (fireTarget - config.investTotal) / (monthlySurplus * 12),
  };
}
```

### 历史均值计算

```typescript
function calculateHistoryAverages(records: MonthlyRecord[]): HistoryAverages {
  if (records.length === 0) return defaults;
  const n = records.length;
  return {
    monthlyIncome: sum(records, "income") / n,
    totalExpenseAvg: sum(records, "totalExpense") / n,
    periodicLifeAvg: sum(records, "periodicLife") / n,
    volatileLifeAvg: sum(records, "volatileLife") / n,
    consumptionAvg: sum(records, "consumption") / n,
    schoolDailyAvg: weightedAvg(records, "school", "dayStats.school"),
    // 按tag的日均: 只取有该tag天数>0的月份
    dailyAvgByTag: {
      school: avgDailyForTag(records, "school"),
      home: avgDailyForTag(records, "home"),
      intern: avgDailyForTag(records, "intern"),
      travel: avgDailyForTag(records, "travel"),
    },
    savingsRate: (sum(records, "income") - sum(records, "totalExpense")) / sum(records, "income"),
  };
}
```

## 目录结构

```
src/
├── main.tsx
├── App.tsx
├── router.tsx
│
├── stores/
│   ├── configStore.ts       # AppConfig (Zustand + localStorage)
│   ├── snapshotStore.ts     # AccountSnapshot[]
│   ├── monthlyStore.ts      # MonthlyRecord[]
│   └── calendarStore.ts     # DailyTag[]
│
├── models/
│   ├── types.ts             # 所有TypeScript类型定义
│   └── defaults.ts          # 默认值和初始数据
│
├── calculations/
│   ├── budget.ts            # 预算分配计算
│   ├── rebalance.ts         # 理财再平衡
│   ├── fire.ts              # FIRE计算
│   ├── history.ts           # 历史均值统计
│   └── dailyAvg.ts          # 按tag日均花费计算
│
├── pages/
│   ├── HomePage.tsx          # 主页: 财务概览 + FIRE
│   ├── CalendarPage.tsx      # 日历: 月历 + tag标记
│   ├── ReconcilePage.tsx     # 对账: 三种模式
│   │   ├── AccountInput.tsx  # 账户余额录入组件
│   │   ├── BudgetResult.tsx  # 预算计算结果展示
│   │   ├── TransferPlan.tsx  # 转账建议 + 已转录入
│   │   ├── MonthlyArchive.tsx # 月度归档(仅1号)
│   │   ├── InvestInput.tsx   # 理财品类录入(仅1号)
│   │   └── CreditReminder.tsx # 信用卡提醒
│   └── HistoryPage.tsx       # 历史
│       ├── MonthlyView.tsx   # 月度列表+详情
│       ├── YearlyView.tsx    # 年度汇总
│       └── TrendCharts.tsx   # 趋势图表
│
├── components/
│   ├── Layout.tsx            # 整体布局 + 底部导航
│   ├── Nav.tsx               # 底部4tab导航
│   ├── Card.tsx              # 通用卡片容器
│   ├── StatRow.tsx           # 标签-值行
│   ├── InputField.tsx        # 带标签的输入框(淡黄色)
│   ├── ActionField.tsx       # 待执行值显示(橙色)
│   ├── ProgressBar.tsx       # 进度条
│   ├── AllocBar.tsx          # 资产配置条形图
│   ├── TagBadge.tsx          # 日历tag徽章
│   └── CurrencyDisplay.tsx   # 金额格式化显示
│
└── utils/
    ├── format.ts             # 数字/日期格式化
    ├── date.ts               # 日期工具函数
    └── storage.ts            # localStorage 读写封装
```

## 开发阶段

### Phase 1: 基础架构 + 数据层
1. Vite + React + TypeScript + Tailwind 项目初始化
2. 定义所有TypeScript类型 (`models/types.ts`)
3. 实现Zustand stores (config, snapshot, monthly, calendar)
4. 实现localStorage持久化
5. 填入初始默认数据 (从Excel读取的实际值)
6. 实现通用UI组件 (Card, StatRow, InputField, Nav等)

### Phase 2: 主页
1. 财务概览卡片
2. 月度快照卡片 (从历史均值计算)
3. FIRE计算和展示
4. 资产配置可视化
5. 账户余额 + 信用卡提醒

### Phase 3: 日历
1. 月历网格渲染
2. Tag选择器和点击标记
3. 月份导航
4. 标记统计
5. 数据持久化

### Phase 4: 对账
1. 模式自动识别 + 手动切换
2. 11/21号模式: 账户录入 → 预算计算 → 转账建议
3. 1号模式: 月度归档 + 理财录入 + 再平衡
4. 信用卡周期提醒
5. 预算计算引擎 (budget.ts)
6. 再平衡引擎 (rebalance.ts)
7. 保存逻辑

### Phase 5: 历史
1. 月度列表视图
2. 月度详情展开
3. 年度汇总
4. Recharts趋势图
5. 历史均值计算引擎

### Phase 6: 优化
1. 深色主题完善
2. 移动端响应式优化
3. 数据导入 (从Excel历史数据批量导入)
4. 数据导出 (JSON备份/恢复)
5. PWA支持 (离线使用)

### Phase 7: 后续集成 (未来)
1. Outlook日历API → 自动识别tag
2. 一木记账CSV导入 → 自动填充支出分类
3. 愿望清单模块
4. 时间预算模块
5. 支出分类细化 (饮食/生活/购物/娱乐/交通/课学/人际/医疗)

## 初始数据 (从Excel提取)

```typescript
const INITIAL_DATA = {
  // 最近一次快照 (2026年4月)
  latestSnapshot: {
    credit: 2005.72,
    investTotal: 23369.6,
    investHoldings: {
      us: 3417.6, eu: 459.16, asia: 503.78, a: 485.45,
      longBond: 11314.13, usBond: 2381.37, gold: 4808.11,
    },
  },

  // 历史月度数据 (用于计算均值)
  monthlyRecords: [
    { yearMonth: "2026-03", income: 6487.86, totalExpense: 5929.28,
      volatileLife: 531.9, periodicLife: 2546.05, consumption: 2851.33,
      school: 80.69, accumulatedProfit: 3493.93, investTotal: 12843.62,
      homeDays: 0, travelDays: 0 },
    { yearMonth: "2026-02", income: 11565.16, totalExpense: 5745.07,
      volatileLife: 1986.37, periodicLife: 1656.49, consumption: 2102.21,
      school: 80.69, accumulatedProfit: 4575.02, investTotal: 12830,
      homeDays: 13, travelDays: 9 },
    { yearMonth: "2026-01", income: 8233.37, totalExpense: 6506.43,
      volatileLife: 1622.42, periodicLife: 2155.15, consumption: 2728.87,
      school: 1.26, accumulatedProfit: 4761.43, investTotal: 12830,
      homeDays: 30, travelDays: 0 },
    { yearMonth: "2025-12", income: 5361.51, totalExpense: 7777.51,
      volatileLife: 301.19, periodicLife: 3080.28, consumption: 4396.04,
      school: 616.9, accumulatedProfit: 3678.58, investTotal: 12924.53,
      homeDays: 0, travelDays: 3 },
    { yearMonth: "2025-11", income: 7406.55, totalExpense: 8725.54,
      volatileLife: 2500.37, periodicLife: 2877.59, consumption: 2157.14,
      school: 518.64, accumulatedProfit: 3547.15, investTotal: 21831.64,
      homeDays: 0, travelDays: 5 },
    { yearMonth: "2025-10", income: 4827.57, totalExpense: 6133.92,
      volatileLife: 884.57, periodicLife: 1022.79, consumption: 1020.21,
      school: 357.38, accumulatedProfit: 3532.42, investTotal: 15252.87,
      homeDays: 10, travelDays: 0 },
    { yearMonth: "2025-09", income: 6706.29, totalExpense: 12088.65,
      volatileLife: 1069.97, periodicLife: 1328.66, consumption: 1879.5,
      school: 720.99, accumulatedProfit: 1575.2, investTotal: 16295.69,
      homeDays: 1, travelDays: 0 },
    { yearMonth: "2025-08", income: 9225.27, totalExpense: 8360.89,
      volatileLife: 725.15, periodicLife: 278.96, consumption: 941.85,
      school: 0, accumulatedProfit: 728.41, investTotal: 21827.03,
      homeDays: 23, travelDays: 0 },
    { yearMonth: "2025-07", income: 1615.94, totalExpense: 7284.71,
      volatileLife: 276.28, periodicLife: 509.45, consumption: 3871.48,
      school: 0, homeDays: 20, travelDays: 0 },
    { yearMonth: "2025-06", income: 8312.84, totalExpense: 4204.72,
      volatileLife: 853.14, periodicLife: 854.81, consumption: 1475.53,
      school: 0, homeDays: 14, travelDays: 0 },
    { yearMonth: "2025-05", income: 5804.51, totalExpense: 9617.16,
      volatileLife: 295.39, periodicLife: 1415.78, consumption: 1149.39,
      school: 0, homeDays: 12, travelDays: 0 },
    { yearMonth: "2025-04", income: 2972.61, totalExpense: 5570.65,
      volatileLife: 175.77, periodicLife: 1045.11, consumption: 3547.69,
      school: 0, homeDays: 7, travelDays: 0 },
    { yearMonth: "2025-03", income: 3879.58, totalExpense: 7590.8,
      volatileLife: 747.95, periodicLife: 950.32, consumption: 3885.48,
      school: 0, homeDays: 13, travelDays: 0 },
    { yearMonth: "2025-02", income: 3162.8, totalExpense: 3550.62,
      volatileLife: 281.95, periodicLife: 374.26, consumption: 1048.58,
      school: 0, homeDays: 0, travelDays: 0 },
    { yearMonth: "2025-01", income: 5227.42, totalExpense: 12080.74,
      volatileLife: 230.59, periodicLife: 2299.67, consumption: 5402.82,
      school: 0, homeDays: 0, travelDays: 0 },
  ],

  // now sheet 统计值
  currentStats: {
    periodicLifeAvg: 2479.98,
    volatileLifeAvg: 766.67,
    consumptionAvg: 3523.73,
    totalExpenseAvg: 6387.04,
    monthlyIncomeAvg: 5611.85,
    schoolDailyAvg: 139.88,
    savingsRate: -0.138,
    totalLife: 2863.31,
  },
};
```

## 注意事项

1. **所有金额使用number类型**, 显示时格式化为两位小数带千分符
2. **日期统一用ISO字符串** "YYYY-MM-DD", 月份用 "YYYY-MM"
3. **淡黄色输入框**: `bg-amber-50 border-amber-200` (浅色主题) 或 `bg-yellow-900/20 border-yellow-700/30` (深色主题)
4. **橙色待执行**: `bg-orange-50 text-orange-700` 或 `bg-orange-900/20 text-orange-400`
5. **深色主题为主**, 背景 `#0a0a16`, 卡片 `#111128`
6. **移动端优先**, max-width 480px 居中
7. **数据安全**: 所有数据存localStorage, 提供JSON导出/导入备份功能
8. **计算精度**: 金额计算保留2位小数, 比例保留4位小数
