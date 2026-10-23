# 衣物照片 R2 存储

照片使用 Cloudflare R2 **Standard** 私有桶。Upstash 保留衣物信息及照片对象引用；浏览器仍通过已有的鉴权接口读取照片，使用 30 天私有缓存。未转存的照片仍可从 Upstash 读取。不要开启公开访问或切换到 Infrequent Access。

## 服务端配置

仅在 BonBills 的 Vercel Production 环境配置，不能使用 `VITE_` 前缀，也不能提交真实密钥：

- `CLOTHES_R2_ENDPOINT`：R2 控制台提供的 HTTPS S3 endpoint。
- `CLOTHES_R2_BUCKET`：照片桶名。
- `CLOTHES_R2_ACCESS_KEY_ID`：仅限该桶的 Object Read & Write 凭据，以 Secret 保存。
- `CLOTHES_R2_SECRET_ACCESS_KEY`：对应密钥，以 Secret 保存。

四项都未配置时继续使用 Upstash；部分配置不完整时拒绝 R2 操作。环境变量配置后需重新部署。先上传一张测试照片、读取验证，再进行旧照片转存。

## 旧照片转存

衣柜底部「转存旧照片」逐张处理当前衣物、已丢弃衣物及历史穿搭引用的照片。服务端先上传，再下载验证长度、格式及 SHA-256，成功后仅在 Upstash 原版本未变时替换照片正文。衣物和历史记录的 photoId 保持不变；中断后可重试，已经转存的照片会跳过。失败不会覆盖原照片。

转存旧照片本身需要从 Upstash 读一次原图；转存完成后，后续读取只从 Upstash 获取小引用，图片正文由 R2 返回，经现有 Vercel 接口传给浏览器。R2 的免费出站流量不代表其他服务的额度也不计量。

## 试用与费用

2026-10-23 用户同意先试用一个月。控制台当前账期为 2026-10-23 至 2026-11-23。接入完成后核对 R2 Usage/Billing，关注存储量及 Class A/B 操作次数；试用到期评估是否继续，不自动删除照片或撤销读取密钥。

按 2026-10-23 官方价格，Standard 每月免费 10 GB-month、100 万次 Class A 操作及 1000 万次 Class B 操作；R2 出站流量免费。超过免费额度仍会计费，预算提醒不是停用或零扣费上限。价格以 https://developers.cloudflare.com/r2/pricing/ 为准。

转存后不要直接删除桶、撤销凭据或移除环境变量，否则已转存的照片将无法读取。若决定退回 Upstash，必须先逐张读回照片并校验、恢复相同 photoId 的存储值，确认全部可读后再停用 R2；不能回滚到不认识 R2 引用的旧版代码。

## 验证

`npx vitest run api/_clothesR2.test.ts api/_bonClothes.test.ts api/_clothesReads.test.ts api/_accountKv.test.ts api/_auth.test.ts`

`REDIS_SERVER=/path/to/redis-server REDIS_CLI=/path/to/redis-cli node scripts/measure-clothes-photo-compression.mjs`

测试仅使用本地合成数据，覆盖失败保留源文件、账号隔离、条件缓存、版本冲突与幂等迁移。
