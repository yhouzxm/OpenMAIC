# M5-C PNG 本地产品闭环

日期：2026-10-14（Asia/Shanghai）

STATUS: LOCAL_VERIFIED_DISPOSABLE_PRODUCT / UNCOMMITTED_CANDIDATE

基线：`refactor/zhiban-v2` / `daf63afa83470d24a9ed41d171c6a17f8a80adb6`。保留已有未提交候选；没有 commit、push、GitHub CI 或真实开发库升级。

## 产品与使用

教师上传 PNG → 从已登记资源选择 → 加入当前 slide → 调整布局/撤销/重做/删除 → 保存 → 预览 → 显式发布。学生只查看本教学班当前发布版本；教师撤回后拒绝后续发布版本字节请求。文本换行及原文本内容闭环保留；既有 `content-text-v1` 内容继续按原政策使用，新建内容采用 `content-png-v1`，旧资源没有偷偷升级。

可运行的本地隔离入口：

```bash
pnpm exec tsx scripts/zhiban-local/run-m5-png.ts --serve
```

入口 `https://127.0.0.1:3444/zhiban`；运行输出给出 owner-only `accounts.json` 路径。文件含教师、学生登录账号及直接内容页面地址，不在聊天或证据中输出密码。沿用已受信任的 localhost TLS 证书并验证其原 receipt/hash；不改证书、系统信任或真实 PG 配置。

此模式启动独立 mkdtemp PG16（56498，仅 owner-only Unix socket，TCP reject），真实独立业务库和 Native 库，调用正常 Identity、Academic、内容 API 和公开 provider。身份、课程和教学班为明确标记的合成数据。它不连接或修改 55432/55433。Ctrl-C/SIGTERM 正常结束后，确认 PG 停止再移除本次临时根；体验数据随 disposable 生命周期清理，不用于长期保存。异常失败目录保留查证；不能套用到其他 cluster。

## 数据、授权与发布

新增候选 [0002-png.sql](candidates/m5-png/0002-png.sql)，独立 `png_schema_migrations` ledger，避免与终态候选 0002 混用。所有旧 migration 文件、Content 0001 hash 和冻结 Bridge repository/protocol 不变。

- 原文本 validator 保留为 `valid_text_draft`；新政策允许严格 `{assetId,id,x,y,width,height}` 图片元素。旧政策仍强制原文本校验；资源 policy 不可变。
- `png_uploads` 保存私有、不可变草稿 staging 字节/摘要/尺寸/上传者/幂等 key。上传先锁当前身份、任教和资源，再验证、登记；同一资源行串行控制配额。学生、管理员、非任教和跨租户拒绝。历史字节不由请求删除。
- PNG 仅 8 位 RGB/RGBA、非交错，单项 4 MiB、边长 4096、总像素 4,194,304。检查 chunk 顺序、完整 EOF、CRC、IHDR、IDAT 解压长度/滤波类型及压缩尾部；拒绝 APNG/未知 critical chunks，剥离 ancillary metadata。解压 RGBA 上界约 16 MiB；上传和候选总字节分别至多 32 MiB，资源登记至多 128 项，原 slide/元素上限保留。
- 保存必须引用本资源已登记 PNG；普通 URL、外部资源、其他内容资源上传 ID 拒绝。图片与文本共用草稿 CAS；上传不隐式保存/发布。
- 发布先预留准确内容与字节摘要、场景意图和 PREPARE_CONTENT。每个图片实例再持久登记、提交 PREPARE_ASSET 子操作后调用公开 AssetStore；绑定 exact generation/scene/purpose/principal/byteDigest/length/providerRevision。
- `png_asset_operations` 与 `png_publication_refs` 固定父子和来源。PNG 专用父结算仅接受 RESERVED、相同 actor/version、PENDING generation 和连续精确子操作 revision 链；成功须全部子操作成功并完成 DocumentStore 写入/回读。没有 UNKNOWN→terminal 或 RECONCILE 入口。冻结 `BridgeRepository.finish` 未放宽。
- 新 PNG 文档投影保留 A/B 纯文本空白，按字节摘要归一化图片 identity；非文本封闭投影由原 Bridge validator 复核，实际存储/读取仍为公开 DocumentStore。发布前额外 SQL guard 检查每个图片来源、正确场景 ordinal、父准备操作和完整 binding 集合；原业务/Bridge 指针一致性和审计约束继续生效。
- 发布切换为新不可变 generation；旧版本 URL 拒绝，失败保留旧发布。部分 Native 结果未知时保留父/子 operation fence、孤立字节及隔离，不重试、不激活。页面标记待核验和草稿锁定。

## API、gateway 与启用

沿用 `/api/zhiban/content/:tenant/offerings/:offering`：

| API | 行为 |
| --- | --- |
| POST `…/resources/:resource/assets?revision=:revision` | `image/png` 原始有界字节；Origin、CSRF、command key 和当前教师授权 |
| GET `…/resources/:resource/assets` | 仅教师读取本资源登记 ID、尺寸和字节数，不返回私有 origin/Native refs |
| GET/HEAD `…/resources/:resource/assets/:asset?source=draft&version=:revision&slide=:slide` | 当前教师、精确草稿 revision 和已保存引用；无引用上传不提供字节 |
| GET/HEAD 同路径 `source=published&version=:publication` | 当前 Session/关系/权限、当前发布指针、active slot/generation、准确场景及 asset binding |

学生 DTO 的 `assetId` 是业务 binding ID。gateway 支持 HEAD 和单 Range；认证先于 Range，错误无字节。`private,no-store`、nosniff、CORP same-origin、独立资源 CSP；无 ETag/公开缓存或 Native 路由。每 64 KiB 重新读取身份、任教/Enrollment 和发布状态；背压、取消和 10 秒期限有界，不能声称收回浏览器已下载字节。

图片请求可使用浏览器标准 same-origin image fetch；无自定义 marker 时须同时通过 Sec-Fetch-Site、Sec-Fetch-Dest 与同源 Referer 检查，随后仍执行相同 Session/资源授权。写请求保持原 Origin/CSRF 合同。

仅内容页面启用 [PNG CSP](evidence/m5-png-csp-profile.json)，`img-src 'self'`，保留原 style hashes 与 `style-src-attr 'none'`；不允许 blob/data/external URL 或 unsafe-inline。

普通 loader 支持 `LOCAL_M5_CONTENT_PNG_V1`，必须匹配 PNG migration、参考 profile、双库 ledger/ACL、原 Content 0001 和当前实现/包/TLS binding。候选 installer 的 `--png` 需继承真实 exclusive maintenance fd；安装后 flag 保留，清旗仍走独立 CLOSED 协议。**本轮未运行真实 55433 installer、未刷新真实安装 receipt、未清任何原维护旗。** 当前 real inputs 的“保留待补”不作为继续产品开发的前置任务。

## 本地证据与边界

[实际 PG16/API/HTTPS/浏览器证据](evidence/m5-c-png-local.json)、[隔离参考 profile](evidence/m5-png-profile-reference.json)、[迁移 inventory](candidates/m5-png/inventory.json)及[学生页面截图](evidence/m5-c-png-student-local.png)记录本轮具体来源和生命周期。

验收：PG16/API/HTTPS/浏览器 **23/23 PASS**；PNG/Bridge 内容/同 Session 认证定向测试 **34/34 PASS**；本次文件及依赖类型检查、定向 lint（下述明确规则例外）、格式与来源/hash核对通过。静态命令与限制见 [补充验证记录](evidence/m5-c-png-static-local.json)。

覆盖上传/选择/图片单独发布/图片与换行文本混合、学生只读、跨租户/教学班/场景/资源、CSRF/MIME/截断/像素预算、无引用拒绝、HEAD/Range/缓存头、旧版本、Session/Enrollment/版本切换中途撤权、客户端取消、实际 Native 提交后丢 ACK 的隔离和无重放、ACL 禁止更新/删除/截断，以及原文本发布回归。公开包 src 与 HEAD 比较并重新构建，证据绑定 src/dist、锁文件、执行 artifact 和页面源码。

这完成 **M5-C 的 disposable LOCAL 产品验收**，与历史 A/B 一起证明 A–C 已有本地功能。不能据此签收旧 55433 部署的当前源码、完整 enabled gate、生产网络/维护恢复、Runtime 或 AI。旧 observer/R6/C9 证据保持自己的 SHA 和适用范围，不重新绑定到 PNG 增量。

定向类型检查覆盖本次文件及导入依赖；全仓库 tsc 首次触发默认堆上限，未作为本轮通过项。lint 沿用动态 JSON 边界的既有 any 风格，以显式关闭 no-explicit-any 的定向命令验证其余规则，不声称仓库默认 strict lint 全通过。

下一产品工作包：M6 首个教师统计页面，基于真实 Enrollment/Submission/已发布人工成绩，指标、权限和页面同一轮交付；Runtime/AI 及维护恢复输入继续独立 deferred。建议 GPT-6.1 Sol / medium。
