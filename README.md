# monthlyBills

个人财务管理 Web 应用（盘账助手）— 由 `PLAN.md` 驱动开发。

## 当前状态：MVP 测试版

本阶段只做视觉骨架，用于评审页面布局和风格。数据全部来自 `src/data/mockData.ts`（从 `PLAN.md` §初始数据 摘取），不落盘、不做真实计算。

## 本地运行

```bash
npm install
npm run dev       # 开发模式 (http://localhost:5173)
npm run build     # 生产构建
```

## 目录

```
src/
├── App.tsx            # 路由
├── main.tsx           # 入口
├── index.css          # Tailwind + 全局样式
├── components/        # Layout / Nav / Card / StatRow / CurrencyDisplay
├── data/mockData.ts   # 来自 PLAN.md §初始数据
├── models/types.ts    # MVP 类型
└── pages/
    ├── HomePage.tsx       # 财务概览 / 月度快照 / FIRE / 资产配置 / 账户余额
    ├── CalendarPage.tsx   # 月历 + tag 标记
    ├── ReconcilePage.tsx  # 对账 / 转账建议
    └── HistoryPage.tsx    # 月度 / 年度历史
```

完整设计与下一阶段规划见 `PLAN.md`。
