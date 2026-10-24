# Upstash → Turso

## 当前状态（2026-10-24）

- 已建立 Turso `bonbon/bonbills`，Free，AWS US East (Virginia)，与 Vercel `iad1` 相邻；使用 libSQL。
- 已初始化表，真实云端读写和回滚验证通过；没有导入业务数据，也没有启用标记。
- Vercel production 已配置服务端 `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`。**尚未设置 `STORAGE_BACKEND=turso` 或 `TURSO_MIGRATION_ID`。**
- Upstash 控制台确认因 **10GB/月带宽耗尽**暂停；命令约 24 万/50 万，存储约 10MB/250MB。API 403，Backup & Export 按钮禁用。之前仅根据模糊错误推断的“请求额度耗尽”不准确。
- 等 Upstash 恢复读取/导出后执行以下流程。不得根据空响应、客户端缓存或不完整月度备份切换；不能保证所有账号、会话和连接完整。

## 数据模型与运行约束

`api/_storage.ts` 明确选择后端，默认仍是 Upstash；Turso 不可用时失败，不向旧库自动回写。Turso 启用必须同时提供 URL、令牌、迁移 ID，并且 ID 与数据库 `verified_migration` 一致。

`storage_keys` 保存原始键、类型、字符串与绝对毫秒过期时间；`storage_hash` / `storage_zset` 保存成员。保持 Redis SDK 原始编码、JSON null、字符串、数字和账号前缀；迁移不重加密凭据，不更改原有 `SYNC_SECRET`，R2 图片保留原引用。

每次写入使用主库事务。NX/TTL/计数器、版本冲突、幂等回执和条件解锁均原子执行。16 类 Lua 操作已显式移植为 SQL 事务；指纹表拒绝未知脚本，修改脚本必须同步移植并验证。照片和历史过滤在 SQL 内完成，避免整批图片或历史跨网络传输。过期记录始终不可读；写入时定期批量回收物理记录。

## 切换步骤

1. 确认生产部署已包含本实现。设置生产 `STORAGE_MAINTENANCE=1` 并重新部署，确认新请求拒绝存储访问。暂停使用旧预览地址/本地开发；等待所有旧请求结束，至少 300 秒。所有定时任务继续留在云端，维护期间会明确失败。
2. 将旧库 URL/token 与目标库 URL/token 放在本机私有环境文件（权限 600，位于仓库外），使用 Node `--env-file` 或受保护环境注入。不要打印环境值、原始数据、错误响应或带 token 的链接，也不要把快照提交到 Git。
3. 设置本机 `STORAGE_MAINTENANCE=1`。依次执行：

   ```sh
   npm run storage:migrate -- export /private/path/snapshot.json
   npm run storage:migrate -- import /private/path/snapshot.json
   npm run storage:migrate -- finalize /private/path/snapshot.json
   ```

   export 扫描**全部账号与原始键**，每键在 Lua 内一起读取类型、原始值、绝对过期时间。任何错误、空库或未知类型都会停止。快照文件独占创建且权限 600；import 验证摘要并完整回读比较，允许相同快照重试，拒绝覆盖不同快照或已启用数据库。finalize **再次读取源库**，检查未发生写入，再逐键检查目标，全部一致才写入启用标记。源库必须持续冻结。

4. 将输出的摘要设置为生产 `TURSO_MIGRATION_ID`，设置 `STORAGE_BACKEND=turso`，移除 `STORAGE_MAINTENANCE` 并重新部署。不能只改变量而不部署。预览/开发环境需单独选择后端，不能让旧代码向旧库写入后误以为已经进入新库。
5. 验证账号登录、本人/其他账号隔离、衣柜、日志、账本、原 TickTick/Outlook 连接；手动运行已有云端同步工作流，确认 always-today / 每小时排程成功。清理本机私有临时凭据与快照（如需保留备份，交给用户的加密备份位置）。

若任一步失败，**保持原库及其数据，不启用 Turso**。新库已经接受业务写入后，不能直接切回旧库，否则会丢失新增修改；必须停写并迁回已验证的最新数据，或修复 Turso。切换前可移除维护变量恢复旧后端，前提是旧库本身已解除暂停。

## 验证

```sh
npm test -- api src scripts
npm run build
# 临时本地 Redis，只有合成数据，不读取生产连接配置：
REDIS_SERVER=/path/redis-server REDIS_CLI=/path/redis-cli npm run storage:verify
```

对照测试执行所有原 Lua 脚本与 SQLite 移植，比较返回值、完整副作用与过期时间。迁移测试覆盖完整复制、摘要损坏、源库变化、目标损坏、重试、未知类型及空源失败。
