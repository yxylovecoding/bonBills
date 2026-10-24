# Cloudflare 云端调度

Cloudflare Workers Free + SQLite Durable Object 队列负责触发，Vercel 执行业务逻辑，Turso 保存应用数据。GitHub Actions 不再执行任务，旧工作流和手动入口均已移除，月度备份仍由 Vercel Cron 执行。

| 北京时间 | 工作 |
| --- | --- |
| 00:01、08:01–23:01 | 普通重排、固定今日、具体时刻显隐 |
| 07:01 | 显隐恢复 → 经期归档 → 完整排程（含当天重排）→ 每日邮件，不重复投递小时任务 |
| 12:00 / 17:00 | 经期归档、完整排程 |
| 20:00 | 洗头与阅读显示、经期归档、完整排程 |
| 22:00 | 夜间 routine、未完成运动 |
| 00:00 | 凌晨临时隐藏、固定今日 |
| 每月 1 日 08:10 | Vercel 月度备份 |

## 部署

全部自动任务在北京时间 00:30–06:30 暂停，UTC cron 为 `1 0-16,23 * * *`；延迟进入休息窗口的任何任务由队列与服务端再次拦截。晨间显隐恢复、完整同步和每日邮件统一移至 07:01，依次执行；当天邮件须等归档与排程成功。`always-today` 当天完成过时保留下一次日期，次日再固定为当天。

使用官方 Wrangler CLI，固定版本 `4.152.0`，不连接 GitHub Builds。首次部署需要 Cloudflare Workers Scripts Write 权限；日志检查使用 Workers Tail Read。

1. `npx wrangler@4.152.0 login --scopes account:read user:read workers_scripts:write workers_tail:read`
2. `npx wrangler@4.152.0 deploy -c workers/scheduler/wrangler.jsonc`
3. 通过 `wrangler secret put` 或私有临时 JSON 的 `secret bulk` 配置 两枚新生成的独立随机密钥 `SCHEDULER_RUN_SECRET` 和 `DISPATCH_SECRET`，不复制旧生产定时密钥。不得写入仓库、命令行参数或公开日志。
4. Vercel 生产环境配置 `CLOUD_SCHEDULER_URL` 为部署后的 HTTPS workers.dev 地址，`CLOUD_SCHEDULER_SECRET` 与 `DISPATCH_SECRET` 相同，`CLOUD_SCHEDULER_RUN_SECRET` 与 Worker 的 `SCHEDULER_RUN_SECRET` 相同。发布应用后验证手动完整同步和小时同步。
5. 禁用并移除 GitHub 三个旧工作流，检查没有旧运行仍在排队；发布 Vercel 并验证 Worker 手动调用成功后，启用 Cloudflare Cron。Cron 配置传播可能需要最多 15 分钟。

Worker 固定调用生产域名，不接受请求方提供目标 URL、任意 action 或邮件指令。公开 HTTP 入口全部检查独立调度密钥。Vercel 的 `scheduler=1` 只在 原有 CRON 或专用调度授权通过后返回精简响应，Cloudflare 不存储应用记录或错误正文。

## 检查与恢复

- `GET /status`：附 `Authorization: Bearer <DISPATCH_SECRET>`，返回最近 3 天、最多 200 条队列状态和 `lastCronAt`。仅输出固定阶段、时间、HTTP 状态和失败类别。
- `POST /dispatch`：同样鉴权，JSON `{ "kind": "full", "id": "<唯一请求ID>" }` 或 `kind=hourly`。相同 ID 去重，正在排队或执行的同类请求合并；不发邮件。
- 一次 Durable Object alarm 只执行一次有超时的 HTTP 调用，完成状态持久化后唤醒下一步。任务不会依赖 HTTP 客户端保持连接，也不依赖本地进程。
- 已确认的安全读取失败最多重试两次；锁占用每 30 秒等待，最多 12 次。响应未知或进程中断后不会重发写入。需先检查业务结果，再手动补同步。
- 经期导入失败仍执行完整排程，但当日邮件只在依赖均成功后发出。旧任务等待超过 45 分钟或跨上海日期则失败，避免过时执行。
- 需要补跑时，检查业务状态后通过 Worker `/dispatch` 或网页重排入口触发。GitHub 不再提供任务执行入口，不能重新启用旧工作流。

## 额度

只使用 Workers Free 和 SQLite Durable Objects Free，不升级套餐。免费额度内包含 Cron、持久队列及少量运行状态存储；超额会失败，不能保证平台永远不调整规则。Vercel 单次函数仍有 300 秒上限；队列分步继续，不把整个流程塞进一个 15 分钟 Cron 调用。队列串行等待意味着 01 分是触发时间，不是业务完成时间。

官方说明：[Cron](https://developers.cloudflare.com/workers/configuration/cron-triggers/)、[Durable Objects 免费额度](https://developers.cloudflare.com/durable-objects/platform/pricing/)、[alarm 行为](https://developers.cloudflare.com/durable-objects/api/alarms/)。

专用执行密钥只授权 `ticktick-trips` 的 `scheduler=1`、GET 和固定业务 action 白名单；不授权账本、照片、账号或月度备份接口。旧 `CRON_SECRET` 保留用于原 Vercel 备份。
