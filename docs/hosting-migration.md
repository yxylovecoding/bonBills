# 免费托管迁移

核对日期：2026-11-04。当前分支已准备运行适配；上线状态须以实际部署、域名及调度检查为准。

## 方案与限制

| 平台 | 免费资源 | 对本项目的限制 |
| --- | --- | --- |
| Vercel Hobby | 4 小时 Active CPU/月 | 当前用户报告已耗尽 |
| Deno Deploy Free（已验证） | 10 小时 Active CPU、150 GiB·h 内存、100 万请求、20 GiB 出站/月；5 个自定义域名 | **需要银行卡验证**。控制台说明验证不收费，超限停服务，不收超额费用 |
| Deno Deploy Free（未验证） | 0.1 小时 Active CPU、1.5 GiB·h 内存、1 万请求、0.2 GiB 出站/月 | 只能用于迁移验证，不能承接正式负载 |
| Cloudflare Workers Free | 10 万请求/天，单次 10ms CPU | 不适合直接承接日历解析和完整排程 |
| Render Free | 工作区每月 750 实例运行小时 | 闲置休眠；禁止外发 SMTP 25/465/587，现有每日邮件不能直接沿用 |

资源计量不同：Render 实例运行小时不能直接与 Active CPU 小时比较。Deno 内存额度小于 Vercel，迁移后仍需同时查看 CPU、内存和流量。

来源：[Deno 价格](https://deno.com/deploy/pricing)、[Vercel Fluid](https://vercel.com/docs/functions/usage-and-pricing)、[Cloudflare 限制](https://developers.cloudflare.com/workers/platform/limits/)、[Render 免费限制](https://render.com/docs/free)。Deno 验证条件来自组织 Billing → Verify 页面。

## 运行适配

`server/index.ts` 通过 Node HTTP 兼容接口复用现有 12 个 API 入口，适用于 Node 和 Deno。显式路由表禁止访问内部模块；沿用三个 Vercel API 重写、Cookie、同源检查、账号隔离和 4.5MB 请求上限。只从 `dist` 提供前端文件，SPA 深链接返回首页，丢失资源返回 404。

`deno.json` 配置安装、构建和运行入口。构建会先执行现有前端类型检查及 API 导入检查，再打包服务端；运行时不依赖本机进程。

```sh
npm ci
npm run build:deploy
npm run verify:deploy
# 同一 HTTP 验证脚本也可指定 Deno 可执行文件：
node scripts/verify-deploy.mjs /absolute/path/to/deno
```

HTTP 验证使用独立假密钥，不连接正式数据、不发送邮件、不修改待办。另运行已有认证、数据隔离、日历、日志、衣柜和调度回归。

## 切换顺序

1. 在 Deno 创建免费组织，完成验证，确认控制台实际显示 10 小时额度；不购买 Pro。
2. 从迁移分支创建 `bonbills` 应用（先使用预览域名）。复制**应用所需**生产环境变量到加密 secret，保留原 `SYNC_SECRET`、存储后端、Turso 配置和调度密钥。不要复制 `VERCEL*` 平台变量，也不要把密钥写入源码、构建环境或日志。
3. 沿用现有 Turso 和对象存储，不导入、覆盖或搬运账本数据。检查健康接口、认证、同源 Cookie、只读数据、照片、SMTP 连接和外部服务连接后再切正式域名；不以测试名义发送每日邮件或执行排程。
4. 五个实际服务域名为 `www`、`bill`、`log`、`clothes`、`life.bonbills.cn`。根域 `bonbills.cn` 在 Cloudflare 保持跳转到 `www`，避免占用第六个 Deno 域名。`cv.bonbills.cn` 属于独立 BonCV 项目，不在此次 BonBills 迁移中修改。
5. 保留 Cloudflare `bonbills-scheduler` 及现有 Durable Object 队列。其 `ORIGIN=https://www.bonbills.cn` 会随域名切换到新后端。保留所有同步频率、休息窗口和未知写入结果不重试规则。
6. 月度备份入口已适配 Cloudflare 持久队列，以相同北京时间每月 1 日 08:10 调用 `/api/sync-monthly-backup`。将原 `CRON_SECRET` 写入 Worker 的 `BACKUP_RUN_SECRET`，并在切换时设置 `MONTHLY_BACKUP_ENABLED=true`；当前默认关闭。确认新调度开启后关闭旧 Vercel Cron，避免重复调度。备份响应不确定时不会自动重放。
7. 域名切换后检查响应、日志和下一次正常云端任务；观察实际 CPU 与内存增长。旧 Vercel 部署先保留作回滚，不删除数据库或原环境变量。

## 回滚

恢复五个业务域名的原 Vercel DNS 记录，并让月度备份只有一侧启用。Cloudflare 日常队列仍使用同一 `www` 地址，Turso 数据及会话沿用原实例，不应反向导入旧快照。回滚前确认原 Vercel 账户额度能提供服务。
