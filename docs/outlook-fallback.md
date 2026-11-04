# Outlook 的 Make / Activepieces 备用连接

Make 是主通道，Activepieces 只在 Make 的本地调用保护达到上限或只读请求确认其不可用时接管。功能部署后仍需先建立 Activepieces 工作流并授权 Outlook，保存备用连接后才会启用切换。

## 平台选择

使用 Activepieces Cloud 的免费方案，不启用自动付费或 AI 步骤。2026-11-04 核对时，官方价格页提供免费方案及每月 1,000 credits；该页的日/月恢复表述不一致，因此不将第三方账期写死在代码里，实际余额以账户后台为准。Pipedream Workflows 已停止接受新用户并公告于 2027-03-31 关闭，不作为新备用。

- [Activepieces 价格](https://www.activepieces.com/pricing)
- [Outlook Calendar 集成](https://www.activepieces.com/mcp/microsoft-outlook-calendar)
- [Webhook 集成](https://www.activepieces.com/pieces/webhook)
- [Pipedream 公告](https://pipedream.com/docs/workflows)

## 工作流约定

在 Activepieces 创建一个云端流程，使用它内置的 Microsoft Outlook Calendar 连接，授权与 Make 相同的微软账户。微软刷新令牌保留在平台内，不复制到 BonBills。

1. **Webhook / Catch Webhook**：Authentication 选 Header Auth，Header Name 为 `X-BonBills-Key`，Header Value 为随机生成的 32–128 位可打印 ASCII 密钥。正式 URL 使用 `https://cloud.activepieces.com/api/v1/webhooks/<flow-id>/sync`；BonBills 会为没有后缀的正式地址补 `/sync`，拒绝测试地址、查询参数、其他域名和重定向。
2. **请求校验**：只允许 `GET /v1.0/me/calendars` 列表查询，以及已选中日历的 `events` 接口。目标 Graph 主机固定为 `https://graph.microsoft.com`；不接收调用方提供的完整主机、Authorization 或任意请求头。事件创建使用 POST、修改使用 PATCH；DELETE 只能删除单条事件，必须带 `If-Match` 且没有正文。非法请求停止流程。
3. **Microsoft Outlook Calendar / Custom API Call**：把已经校验的 `path`、`method`、`body` 和请求头传入 Graph。`body` 是 JSON 文本，空串表示无正文；`headers` 是 key/value 数组，需要转为接口所用的对象。保留 `Prefer: IdType="ImmutableId", outlook.timezone="Asia/Shanghai"` 和条件更新的 `If-Match`。微软认证由平台连接注入。
4. **Webhook / Return Response**：返回 HTTP 200、JSON 类型，Flow Execution 明确设为 Stop。成功和失败分支都需返回下面的协议，把 Graph 的实际状态码和正文映射进来。禁止把平台的默认 Accepted、空正文或自定义成功状态作为 Graph 成功。关闭写入步骤的自动重试，失败交由应用下一轮查重处理。

```json
{
  "protocol": "bonbills-outlook-v1",
  "status": 200,
  "body": { "value": [] }
}
```

`status` 必须是数字，来自 Graph，不是外层 Webhook 的 HTTP 状态；尤其保留 401、403、404、412、429。Graph 删除成功时返回 `status: 204`，可以省略 `body`。其他成功必须返回对象正文。平台网络失败可以直接让流程失败，应用会显示备用连接失败。

以上为服务端接入协议；流程字段需根据实际平台版本配置并进行联调，不能仅凭保存流程就认定已连接。仅启用 Header Auth、日历接口白名单及完整响应后，才在 BonBills 保存正式 Webhook 和密钥。保存过程仅列出可写日历，必须验证原日历 ID，失败不替换已有备用。

## 切换、恢复和一致性

- 主、备各自最多滚动 32 天 200 次请求，失败也计入，重连及移除备用不清零。沿用相同的原子配额脚本，Turso 与 Redis 均支持；这是 BonBills 的保护计数，不是平台真实余额。
- 本地 Make 配额拒绝发生在发送前，读写均可转备用。旧调用过期后，下一个需要请求的同步自动使用 Make。
- Make 的超时、非协议响应或平台错误使其冷却六小时，只读请求可当轮转备用。冷却过后沿用现有同步做恢复检查；如果第一条是写入，先用只读请求确认 Make 可用。没有额外 Cron 或浏览器轮询。
- Graph 明确的授权、权限、404、版本冲突和限流错误保持原样，不当成 Make 额度耗尽绕到备用。
- 写入超时可能仍在平台队列中，因此本次不会跨平台立即重放。后续沿用已有任务同步的事件查询、归属校验、transactionId、ETag 和回读确认；两条通道共用同一个日历与事件状态。
- 备用失败或也达到保护上限时明确失败，不反复跨平台重试，不自动购买额度。
- 当前通道表示最后一次成功请求使用的平台；没有待同步变化时不额外发请求更新这一显示。
- 移除备用只删除备用凭据及通道状态；保留 Make、调用计数和 Outlook 日程。断开主连接同时移除备用凭据。

## 上线前联调

先完成平台登录、微软授权和流程发布。用只读日历列表验证认证和返回协议；拒绝同名但不同 ID 的日历。通过一个明确标识的测试事件核对创建、修改、条件删除和 404/412 的响应映射，测试写入须单独得到用户授权。随后在应用保存备用连接，检查“备用 · Activepieces 已连接”。代码层已有额度切换、冷却恢复、写入不即时重放和凭据保护回归用例；真实平台尚未连通时不得声称已启用或联调通过。
