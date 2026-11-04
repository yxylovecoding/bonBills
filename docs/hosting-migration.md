# 免费托管迁移

核对日期：2026-11-04。目标为 Render 免费 Web Service，已在用户确认的 `xinyi's workspace` 创建新加坡 `bonbills` 服务（`srv-dbld16gu01pc739s7o2g`，`https://bonbills.onrender.com`）。17 项应用配置已迁入；登录、Turso 规则/衣柜读取及既有 R2 照片验证通过。正式域名尚未切换。

## 方案与限制

| 平台 | 免费资源 | 本项目结论 |
| --- | --- | --- |
| Vercel Hobby | 4 小时 Active CPU/月 | 用户报告已耗尽 |
| Render Free | 每工作区每月 750 实例运行小时；0.1 CPU、512 MB 内存 | 当前迁移目标；闲置 15 分钟休眠，唤醒有延迟；单实例运行时长可覆盖一个月，但 CPU 较慢 |
| Deno Deploy | 已验证账号原有 10 小时 Active CPU/月 | **已放弃**：2026-10-09 官方宣布六个月后停服，约 2027 年 4 月，不应再推荐长期迁入 |
| Koyeb | 文档仍保留 free 实例说明 | 2026-02-17 公告取消新用户 Starter 免费计划；不按过时文档推荐 |
| Cloudflare Workers Free | 10 万请求/天，单次 10ms CPU | 继续负责现有调度，不直接承接完整日历解析与排程 |

Render 的实例运行小时不能直接与 Active CPU 小时比较。750 小时是一个工作区所有免费服务共享，不能保证在 512 MB / 0.1 CPU 上达到原有速度。账户后台已核对：Hobby 每月 5 GB 出站流量、500 构建分钟、两个自定义域名；构建额外预算为 $0，用尽后停止构建。已绑卡账户的公网出站超额仍按 $0.15/GB 收费；额外域名为 $0.25/个/月。当前账单及当月预估均为 $0。免费 Web Service 未规定固定到期日，免费 Postgres 的 30 天期限不适用于本项目继续使用的 Turso；平台政策不等于永久免费承诺。不创建付费实例、数据库、磁盘或 Cron。

Render 免费服务禁止 SMTP 25/465/587。用户于 2026-11-04 明确取消每日计划邮件，因此已删除自动发信步骤、发信实现和 SMTP 依赖；旧队列邮件步骤不发请求，旧邮件 API 退役。网页计划、云端同步及账单导入保留。

来源：[Render 免费限制](https://render.com/docs/free)、[计算规格](https://render.com/docs/compute-plans)、[自定义域名](https://render.com/docs/custom-domains)、[Deno 停服公告](https://deno.com/blog/cloudflare)、[Koyeb 公告](https://www.koyeb.com/blog/koyeb-is-joining-mistral-ai-to-build-the-future-of-ai-infrastructure)、[Vercel Fluid](https://vercel.com/docs/functions/usage-and-pricing)、[Cloudflare 限制](https://developers.cloudflare.com/workers/platform/limits/)。

## 运行适配

`server/index.ts` 通过 Node HTTP 兼容接口复用现有 12 个 API 入口。显式路由表禁止访问内部模块；沿用 API 重写、Cookie、同源检查、账号隔离和 4.5MB 请求上限。只从 `dist` 提供前端文件，SPA 深链接返回首页，丢失资源返回 404。

`render.yaml` 固定 `plan: free`、Singapore、Node 24、构建和启动命令及 `/healthz`；不声明数据库或额外服务。初次部署使用迁移分支，正式切换后跟随 main。应用所需密钥单独迁移，不写进仓库。

```sh
npm ci --include=dev
npm run build:deploy
npm run verify:deploy
```

HTTP 验证使用独立假密钥，不连接正式数据、不发送邮件、不修改待办。另运行已有认证、数据隔离、日历、日志、衣柜和调度回归。

## 切换顺序

1. 在用户确认的 Render 工作区创建一个 `bonbills` 免费 Web Service，先使用 `onrender.com` 域名；核对实际 `free` 套餐。不开通付费服务。
2. 迁移**应用所需**生产环境变量，保留原 `SYNC_SECRET`、存储后端、Turso 配置和调度密钥。不复制 `VERCEL*` 平台变量、过时 GitHub Actions token 或已取消的每日发信凭据。构建脚本不输出密钥，前端只允许既有公开配置。
3. 沿用现有 Turso 和对象存储，不导入、覆盖或搬运账本数据。检查健康接口、认证、同源 Cookie、只读数据、照片和外部服务连接后再切正式域名；不以测试名义执行排程。
4. 五个业务域名为 `www`、`bill`、`log`、`clothes`、`life.bonbills.cn`。使用 `*.bonbills.cn` 加根域的两域名配置；注意 Render 添加根域会自动添加 `www`，须在添加通配域名前移除自动生成的 `www` 绑定，避免超过两个免费域名。按 Render 要求验证 DNS 与证书后切换。`cv.bonbills.cn` 属于独立 BonCV 项目，保留其明确的 Vercel DNS 记录；Node 入口将根域以 308 跳转到 `www` 并保留路径和查询。任何会增加费用的域名配置都不得直接执行。
5. 保留 Cloudflare `bonbills-scheduler` 及现有 Durable Object 队列。其 `ORIGIN=https://www.bonbills.cn` 会随域名切换到新后端。保留所有同步频率、休息窗口和未知写入结果不重试规则；每日邮件已取消。
6. 月度备份入口已适配 Cloudflare 持久队列，以相同北京时间每月 1 日 08:10 调用 `/api/sync-monthly-backup`。将原 `CRON_SECRET` 写入 Worker 的 `BACKUP_RUN_SECRET`，并在切换时设置 `MONTHLY_BACKUP_ENABLED=true`；当前默认关闭。确认新调度开启后关闭旧 Vercel Cron，避免重复调度。备份响应不确定时不会自动重放。
7. 切换后检查响应、日志和下一次正常云端任务；观察实际内存、流量与任务耗时。旧 Vercel 部署先保留回滚，不删除数据库或原环境变量。

## 回滚

恢复业务域名的原 Vercel DNS 记录，并让月度备份只有一侧启用。Cloudflare 日常队列仍使用同一 `www` 地址，Turso 数据及会话沿用原实例，不应反向导入旧快照。回滚前确认原 Vercel 账户额度能提供服务。每日邮件的取消是独立用户要求，回滚托管时也不得恢复发信。
