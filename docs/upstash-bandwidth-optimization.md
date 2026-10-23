# Upstash 读取流量优化（2026-10-23）

基于 main `f2a4ef0`；本记录描述代码优化和离线验证，未访问生产 Redis、迁移或删除数据、修改余额、升级套餐或操作生产部署。

## 实现范围

- 照片：鉴权及账号隔离后运行只读 Lua，读取现有照片并在 Redis 内比较内容校验值。命中只返回短校验值，不再把整个 base64 传到 API 后才响应 304。保留 Oct14 的浏览器私有缓存及 Vary，不使用 CDN 公共缓存。新校验值使用 `photo-v2-` 前缀；旧 SHA256 ETag 首次重新校验会得到 200 和新 ETag，后续可命中。原始 data URL 和历史 JSON 字符串存储均兼容；同键内容变化会更新校验值，已删除及其他账号的照片不会因旧 ETag 返回 304。SHA1 仅用于缓存比较，不用于认证。
- 历史：只读 Lua 从原 hash 筛选目标日期之前最近 30 个实际穿着日期，整天返回，同一天超过 30 条也保留。旧日期字段、新手动记录 ID、无 kind 的旧记录、styled 记录均沿用原语义。过去天气的回退读取仅返回当天记录。
- 确认穿搭：复用本就必读的完整衣柜，去掉逐件重复 HGET。最终保存仍通过原 Lua 原子版本与状态检查，不改变冲突、快照及幂等语义。
- 不改 key、写入格式、备份恢复或财务同步协议。衣柜主视图仍需完整历史进行保暖学习、配对及穿着次数计算。财务 `/api/sync` 的全量读取及 `cache:reload` 本轮保留，避免未经完整版本协议改造造成跨端旧数据或影响恢复逻辑。未添加内容日志。

## 可复现离线测量

需要本机 Redis 7.2.7（或兼容版本）的 `redis-server` / `redis-cli`，不需要任何线上凭据：

```sh
node scripts/measure-clothes-reads.mjs
# 不在 PATH 时：
REDIS_SERVER=/path/redis-server REDIS_CLI=/path/redis-cli node scripts/measure-clothes-reads.mjs
```

脚本启动无 TCP 端口、无持久化的临时 Redis Unix socket，插入合成夹具，直接执行生产 Lua，完成后退出并清理。测量为 Redis 返回值 JSON 序列化后的 UTF-8 字节，不包含 HTTP/RESP 头、请求脚本文本、计费开销，不能解释为实际月用量或生产节流比例。

| 场景 | 原返回值字节 | 新返回值字节 |
| --- | ---: | ---: |
| 200KiB 图片、ETag 命中 | 273,093 | 56 |
| 同一图片、冷读取 | 273,093 | 273,147 |
| 399 条历史、最近 30 个穿着日期（64 条） | 884,958 | 140,993 |
| 同一历史、单日天气回退（35 条） | 884,958 | 77,106 |

照片及历史仍各调用一次 Redis；命中照片仍在 Redis 内 GET 与计算校验值，历史仍在 Redis 内全量 HVALS、解析及筛选，没有声称减少扫描复杂度或 Redis 内部读取。Lua 增加少量请求字节及服务器计算，收益在于避免大返回值穿过 Redis → API 网络。无条件图片读取没有带宽收益。历史非常大时仍应评估脚本耗时，未来若做索引需另行设计兼容及同步策略。

七件穿搭确认的接口回归断言只执行 1 个 HGET（读旧穿搭记录），原来为 8 个（另读七件衣物）；保留 2 个 HGETALL、回执 GET 及保存 EVAL。一般每次确认减少 N 个重复衣物 HGET 和对应记录返回字节（N 为选择件数）。

## 验证与上线

- 全量 `npm test`：1894 通过、1 失败（113 个文件）；独立 main 基线：1893 通过、同一处 1 失败（112 个文件）。基线已存在 `src/utils/investmentRollover.test.ts:392`：`appliedTransactions` 实际 3、预期 2；没有修改或跳过。
- `npm run build` 包含项目类型检查、Vite 生产构建及 12/12 API 函数上限检查。
- 新生产 API 文件及新增 SDK 测试另按 bundler 模式严格类型检查通过（`tsc --noEmit --target ES2022 --module ESNext --moduleResolution bundler --esModuleInterop --skipLibCheck --strict api/_clothesReads.ts api/_bonClothesRoute.ts api/_clothesReads.test.ts`）。额外把旧 API 测试文件纳入严格检查时有 8 个既有类型诊断（Buffer 类型及旧测试夹具等），独立 main 同样复现，不属于项目默认类型检查范围。SDK 回归验证 Upstash 对嵌套 JSON 的自动反序列化，校验值以不带引号的 token 传输，HTTP 层再添加引号。
- 离线脚本覆盖真实 Lua、旧存储、旧校验值、同键变化与删除、不同账号键、整日分页、空页、styled 和单日回退。接口测试覆盖未登录不读 Redis、账号切换后不能用原账号 ETag 得到 304。

已获授权与移动端布局提交集成、复验并正常推送 main；生产部署操作及线上验收不属于本轮执行范围。不需要新环境变量或数据迁移。未来部署后的验收建议：照片首次 200/重复条件请求 304、另账号不能读取、历史分页及多端确认冲突；观察 Upstash 实际带宽与请求延迟。回滚代码即可，存储格式未变。图片外迁仍是另行确认事项，当前没有接入外部存储。
