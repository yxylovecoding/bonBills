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

## 163 邮箱账单导入

记录页的“邮箱导入”会通过服务端 IMAP 拉取最近匹配 `账单_数字.xls/xlsx` 的附件，然后复用前端账单导入规则；如果最新附件是图片，则自动走本地 OCR 并按内容判断资产页或理财页。

部署环境需要配置：

```bash
SYNC_SECRET=访问应用时 ?key= 使用的同步密钥
BILL_MAIL_USER=你的163邮箱
BILL_MAIL_PASS=163客户端授权码
```

可选配置：

```bash
BILL_MAIL_HOST=imap.163.com
BILL_MAIL_PORT=993
BILL_MAIL_LOOKBACK_DAYS=90
BILL_MAIL_SCAN_LIMIT=80
BILL_ATTACHMENT_PATTERN=^账单_\d{10}\.xlsx?$
BILL_IMAGE_ATTACHMENT_PATTERN=\.(png|jpe?g|webp|gif|bmp|tiff?)$
```

## 图片 OCR 导入

拖入图片或从邮箱获取图片附件时，会在浏览器本地通过 Tesseract OCR 识别，并按内容自动判断资产页或理财页。对账页的图片导入草稿会同步展示原图，便于和识别结果对照。账户截图按“生活=建设银行+微信、收入=收入栏、理财现金中国银行=境内/嘉信=境外”映射，理财截图金额按 now/当前市值写入。首次使用会下载 OCR worker 与中文语言包，之后由浏览器缓存。

## Schwab 同步

Schwab 读作 `/ʃwɑːb/`，近似“施瓦布/什瓦布”。首次使用前，需要在 [Schwab Developer Portal](https://developer.schwab.com/) 创建并获批 Trader API 应用，拿到 app key、app secret，并把 callback URL 配成和本地一致，例如 `https://127.0.0.1:8182/`。

本地新建 `.env.schwab.local`，填入：

```bash
SCHWAB_CLIENT_ID=你的 app key
SCHWAB_CLIENT_SECRET=你的 app secret
SCHWAB_REDIRECT_URI=https://127.0.0.1:8182/
```

首次授权：

```bash
npm run schwab:login
```

脚本会输出授权链接。登录 Schwab 并允许访问后，把浏览器最终跳转到的完整 URL 粘回终端。token 会写到 `.schwab-token.json`，该文件已被 git 忽略。

同步账户、余额、持仓和最近交易：

```bash
npm run schwab:sync -- --days=60
```

默认输出到 `src/data/schwabSnapshot.local.json`，该文件同样不会入库。Schwab 交易查询通常限制最近 60 天，可以用 `--from=YYYY-MM-DD --to=YYYY-MM-DD` 或 `--output=PATH` 调整。
只同步余额和持仓时可加 `--no-transactions`。

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
