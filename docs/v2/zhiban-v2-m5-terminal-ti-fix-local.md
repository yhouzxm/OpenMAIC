# TI-01–03 修复、真实 Native 参考与恢复观测接线

2026-10-12。branch `refactor/zhiban-v2`，HEAD `daf63afa83470d24a9ed41d171c6a17f8a80adb6`，工作区非 CLEAN，既有增量保留。状态：**TI_FIX_LOCAL_VERIFIED / RECOVERY_OBSERVATION_WIRED / EXISTING_CLUSTER_NOT_APPLIED / KEEP_ALL_FENCES**。本轮无 commit/push/CI dispatch，未连接 55432/55433。

## 修复与来源

| 项目 | 实际修复 | 验证 |
| --- | --- | --- |
| TI-01 | 11 完整 collector 与 Native 10 均采集确定排序的索引定义、谓词、unique/primary/valid/ready/live；11 另加入 DB owner/ACL；严格 profile 拒绝无效/未 ready 的 Native 索引 | 真实 Storage 同名谓词、unique 漂移、valid=false 均拒绝；恢复精确来源定义后重新匹配 |
| TI-02 | installer 签名前及 loader 返回前重查 source、目标、ledger、authority、双库关闭、writer LOGIN、PID/backend_start/postmaster 身份 | installer 最后 catalog 查询后的 admission 漂移不签 receipt；真实 Native loader 的晚到 admission 和普通 writer LOGIN 漂移均拒绝 |
| TI-03 | 任何变更前审查 Business admission ACL，拒绝未评审 grantee/缺失普通 CONNECT；新增独立管理员阶段 00-business-connect.sql，显式保留七个普通角色 CONNECT 后撤销 PUBLIC CONNECT | 未评审 CONNECT 在 DDL/admission 前拒绝；从实际 bootstrap 构建的真实参考没有 proof/observer 的 Business CONNECT，普通角色仍可 CONNECT |

原 [评审](zhiban-v2-m5-terminal-installer-review.md)三项现为 **ADDRESSED_IN_CANDIDATE / LOCAL_VERIFIED**，尚待增量复评。原 11/11 问题复现证据与原 42/42 最小 fixture 证据保持原 source/hash/scope。

未改已应用 Identity/Bridge/Native bootstrap 或 migrations，也未改 Content 0001。Business 0002 aggregate 仍为 `e1e7ea9517462edd855fb8715f49346db4c467c01aac43e8a370c39eebf7184a`；additive CONNECT 属独立管理员阶段，不能仅拿 Business aggregate 覆盖全部 source。当前 inventory：`4ab88165a1f6382f6540ac2cbbb9899203ba0648d11a2e70be909def377337ce`。terminal 29 文件；外部参考/broker 三文件通过 `recoveryWiringSha256` 绑定，两份 UNISSUED 模板已更新派生 hash。

## 维护恢复接线

[terminal-recovery.cjs](candidates/m5-terminal/terminal-recovery.cjs) 已接两个入口：

- `inspectPartialInstallation`：用已有三条 postgres 技术连接，核对两库关闭、物理身份、source/target 绑定的 install journal，查实际 ledger 和完整 catalog；报告 Business ledger 未观测、Native/整体未核验或两边 profile 匹配。它不推断回滚，不重放 DDL、不重签 receipt、不 seed authority。技术安装存在 service/ready/grant/controller authority 时拒绝。
- `readTakeoverAck`：只能用真实受限 controller 会话和现有 DB controller authorization，精确绑定 deployment/old/new/request，调用既有 read_takeover_result。NOT_OBSERVED/COMMITTED 均 `replayAllowed=false`。helper 有行锁，因此 READ COMMITTED RW 事务而非 PG READ ONLY；此能力不执行业务 DML。日志只记 request/身份/结果，不记 secret。COMMIT ACK 异常进入 BLOCKED并销毁客户端，无自动重查或写入重试。

两入口总预算 30 秒、SQL 5 秒、锁 1 秒、事务 idle 10 秒；禁止复用超时/失败客户端，禁止重叠调用。install journal 新 preflight 耐久记录精确 target/source/expected、原 DB ACL/admission 和物理身份，用于审计和制定另行批准的恢复计划。历史 PUBLIC CONNECT 不能自动恢复到已安装的 terminal profile。

[broker](candidates/m5-terminal-preparation/technical-broker.cjs) 默认持有完整安装的原连接，新增显式 `partial-recovery` 模式持有部分安装连接并调用观测入口；仍只有 inspect/status/close，不提供执行 SQL、签发、takeover/resume/finalize 或开库的端点。状态只是上次观察，不构成窗口 lease 或当前写授权。

新增 `terminal-installer.cjs --install-blocked-hold`：安装成功后同进程交接三条连接给 broker，stdin 仅接收 inspect/status/close。EOF/关闭/信号只释放连接，admission 保持关闭。CLI 连接 3 秒，query/statement 5 秒，lock 1 秒，事务 idle 10 秒。现有 --install-blocked 仍为一次性入口。hold CLI 未在真实开发库执行；同进程连接持有及 partial 模式由 PG16 模块级验证覆盖，不宣称已完成真实维护入口验收。

完整恢复执行仍 deferred：OS 维护锁、host/自动启动阻断、普通及旧维护通道 HBA 拒绝、凭据轮换、有限排空/受限 ServiceActor 连接、DB window/epoch/60 秒 lease/10 秒检查、接管事务执行、RESUMING→批准的 ACL/admission 恢复→CLOSED/清 claims。关闭双库后不能自行新连续用旧窗口。正常和接管两条路径未完成前，现有开发库继续隔离。

## 本地证据与真实参考

| 证据 | 结果 | 范围 |
| --- | --- | --- |
| [候选 PG16](evidence/m5-terminal-ti-fix-local.json) | **50/50 PASS** | 既有 R3/installer 用例，加实际 partial journal/catalog 报告、partial broker 持有、受限 ACK 查询、丢失 ACK 不重试、未评审 ACL、签发前最后 barrier |
| [真实 Native 参考](evidence/m5-terminal-ti-native-reference-local.json) | **13/13 PASS** | 实际 provisionNative / public Storage ensure 创建 11 表、23 索引；三项修复的 schema/admission/writer 负向及 broker 拒绝重叠/漂移 |
| [静态 PG16](evidence/m5-terminal-ti-fix-static-local.json) | **13 组 PASS** | 来源与 prerequisite 字节绑定、template、helper/ACL、offline plan；PG16 grammar 122 SQL、34 PLpgSQL 无解析限制 |

参考和精确 source bindings 存在 `/home/zxm/.local/share/zhiban-terminal-references/fix-ti-20261012-3/`（目录 0700、文件 0600）；证据给出逐文件 hash。状态为 **UNSIGNED_REVIEW_REQUIRED**，不再有 PUBLIC CONNECT 的测试专用修补。tracked Storage/DSL 源码与本地 official commit 相同，实际 dist/bundle inputs 绑定；本轮没有完整重建 packages、远端核验或真实目标比对。

全部数据库执行仅在独立 0700 临时 Unix socket PG16 cluster，禁 TCP，结束后停机并删除。fixture signature/receipt 不导出，不读取真实 authority/凭据。候选 50/50 的 Native 仍为最小五表；真实参考 13/13 补 schema 范围，仍不覆盖完整业务 provenance、公共 Native proof worker、finalize/生产 host/实际 HBA 凭据和 PG/network crash driver。原始开发库、真实 receipts、enabled/production signoff 均未改变。

定向 TypeScript 检查 PASS；全项目 tsc 在 Node 默认 2GB 堆限制下 OOM，未完成，不计为全项目类型回归通过。CJS 语法、格式、文档链接、source/artifact hash 和 diff 空白检查通过。

下一步定向复评 additive ACL、最终屏障及恢复观测/ACK 边界，然后实现维护锁、启动阻断、HBA/凭据与正常/接管执行器。建议复评使用 GPT-6 Astra / high；恢复实现使用 GPT-6.1 Sol / high。
