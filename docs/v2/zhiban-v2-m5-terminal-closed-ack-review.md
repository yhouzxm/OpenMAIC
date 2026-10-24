# 维护边界复评与 CLOSED ACK 查证

2026-10-13。branch `refactor/zhiban-v2`，HEAD `daf63afa83470d24a9ed41d171c6a17f8a80adb6`，非 CLEAN，既有工作保留。状态：**REVIEW_FIXES_LOCAL_VERIFIED / CLOSED_ACK_OBSERVATION_IMPLEMENTED / KEEP_STARTUP_FENCE / EXISTING_CLUSTER_NOT_APPLIED**。本轮同会话复评及实现验证，没有独立第二评审者。未 commit/push/CI dispatch，未连接现有 55432/55433，未修改真实 HBA/凭据/receipt/host。

## 复评结果

| 编号 | 原问题与影响 | 当前处置 |
| --- | --- | --- |
| CA-01 / P2 | owner bootstrap 只查 installation 行/ledger，完整 Business profile 要等到新 controller 已获授权并调用 helper 后才比对。helper/ACL 漂移可能先获得一次执行机会 | 在登记 controller_authorizations **之前**，以管理会话采集固定完整 Business catalog + terminal Business profile，与签名 expected 比对；仅接受当前 controller 的 LOGIN 阶段差异。接管/查证额外核对 window/deployment/service。漂移及错 service 均在授权登记前拒绝 |
| CA-02 / P2 | 12 个角色全部 ALTER 后才保存新密码；部分 SQL/进程/磁盘失败可能使已变更密码无法从耐久文件找回，且未复核输出文件完整性 | 先生成全部值、O_EXCL/fsync 保存 PREPARED_UNDELIVERED，再逐角色 INTENT→ALTER→CONFIRMED；运行中持续核对凭据文件 hash。文件冲突在任何密码 ALTER 前失败；第三角色故障保留完整计划及前两角色已确认进度；文件漂移禁止恢复 |
| CA-03 / P2 | complete_resume 后未核验产品凭据、build/receipt 交付，就清 maintenance flag；旧 launcher 可进入失败启动。另有 CLOSED 内存状态早于 journal/连接清理，可能使清理异常绕过 BLOCKED 路径 | 正常 CLOSED 后也保留 flag，返回 credentialDeliveryReady=false / maintenanceFlagRetained=true；仅完成连接/journal/锁清理后才设置完成状态。CLOSED_ACKNOWLEDGED 阶段异常仍尝试进一步隔离。产品交付和清旗授权仍独立 deferred |

三项为 **ADDRESSED_IN_CANDIDATE / LOCAL_VERIFIED**。owner bootstrap 仍是受信本地管理员路径，短暂允许 postgres + 新 controller 进入 Business；不是密码学双人控制、容器权限隔离或任意管理员防护。Native 保持关闭，控制 helper 调用前管理会话已关闭、HBA 通道移除、实际排空至唯一新 controller。

## CLOSED ACK 合同及入口

新增未应用 helper `zhiban_reconcile.read_closed_result(deployment uuid, window uuid, epoch bigint, secret text)`，仅 controller EXECUTE，无客户端表权限、无 PUBLIC/issuer/executor/runtime 执行权限。使用当前限域 controller authorization，并按 service → epoch counter → window → 双 claims 顺序取 SHARE 锁；READ COMMITTED 事务因行锁使用 READ WRITE，但 helper 无 INSERT/UPDATE/DELETE。

精确核验 deployment/window/epoch、installation 的 cluster/双 OID。CLOSED 必须有唯一 RESUMING 与 CLOSED 控制审计，均为真实 controller、同 window nonce provenance，事件序号/时间有序，旧窗口不再持有 claim，且没有未消费 ISSUED grant。返回：

- **COMMITTED_CLOSED**：历史窗口已完成 CLOSED，给出 CLOSED event sequence/time、当前 claims；当前 claim 可以属于后继窗口，不清它。
- **NOT_CLOSED**：该窗口尚未 CLOSED，返回实际 phase/current claims；不能推断可以重试 complete_resume 或其他写入。

所有结果固定 `replayAllowed=false`、`restoreAllowed=false`、`clearMaintenanceFlagAllowed=false`。错授权范围、错 epoch、损坏审计/claims 均拒绝，不枚举窗口，不把历史提交当成当前开库/启用授权。

`maintenance-cli.cjs --closed-ack` 接入新的精确签名批准：mode=closed-ack，oldWindowId/takeoverRequestId=null，restoreLoginRoles=[]，另绑定 ackRequestId、expectedWindowEpoch（正 int8 字符串）、resumeJournalSha256。必须有同 deployment/window/cluster/OIDs 的原 preflight，以及 complete-resume-commit INTENT。原 journal 不修改，结果写入以 ackRequestId 命名的新私有 journal。

**SQL 查证是只读的，CLI 引导不是无副作用读取。** 关闭库中没有可重用 controller 时，入口仍执行批准的 flock/耐久凭据准备/轮换/关库/排空/owner bootstrap，限定 Business 暂时 admission；Native 不开放。完成查证后关闭 Business、禁用普通与维护 LOGIN、释放连接并保留 flag，不创建 window/新 epoch，不调用 takeover、complete_resume 或 finalize。旧 ACK 或原 journal 本身不是授权，仍需当前独立签名批准。

正常 resume 的 CLOSED 表示 DB 窗口与 claims 已按协议完成，双库 admission 此时可以已经恢复；本轮刻意保留**启动标记**，不把它表述为双库仍关闭。CLOSED ACK 的恢复引导则最终重新隔离双库并保留标记。二者都未交付 runtime.json/content.json、未重建/签收产品 receipt、未启动 host。

## 来源与本地证据

候选 inventory：`4e5585a55aae259a39ac5c0aa01f40e66c4dbb138d99b2d093c626565c9d662a`。新增只读 helper/ACL 使**未应用** Business 0002 aggregate 更新为 `ec2aa8066aae0455127522df40a32b86249a98417391dc714d243f366e592548`。已应用 Content 0001 aggregate 仍为 `e335f83bb48cc6c4ec754f8e3270dc0e6941e14f38306bd67aa29844c3713324`，Identity/Academic/Learning/Assessment prerequisites 与原 bootstrap 均未改。原 helper 的生产状态迁移规则不变。两份 receipt 模板仍 UNISSUED。

| 证据 | 结果 | 边界 |
| --- | --- | --- |
| [维护与 CLOSED ACK](evidence/m5-terminal-closed-ack-local.json) | **30/30 PASS** | 原维护场景；profile 前置拒绝；凭据 staging/部分轮换/文件漂移；丢失 CLOSED COMMIT 回执；精确查证/错 epoch/journal/service；helper ACL；历史 CLOSED 不清后继 claims；NOT_CLOSED 无重放权；启动标记保持 |
| [既有定向回归](evidence/m5-terminal-closed-ack-regression-local.json) | **50/50 PASS** | SQL/helper/ACL、installer/blocked loader、partial recovery、takeover ACK/broker；最小 Native fixture |
| [真实 Native 参考](evidence/m5-terminal-closed-ack-native-reference-local.json) | **13/13 PASS** | 实际 provisionNative/public Storage ensure 的 11 表/23 索引、新 helper/profile 安装、TI 修复及 broker；没有 Native proof/finalize |
| [静态 PG16](evidence/m5-terminal-closed-ack-static-local.json) | **14 组 PASS** | 来源/template/ACL；CLOSED helper 无写入、精确 scope/审计/claims；PG16 grammar 123 SQL / 35 PLpgSQL |

CJS 语法、改动文件格式及 diff 空白检查 PASS；本轮无 TypeScript 修改，未重复全项目 tsc。所有数据库执行都在新建 0700、禁 TCP 的临时 socket PG16 cluster，最终停机删除，原有测试/开发 cluster 未访问。fixture 中 ready/service/产品 FK 初始化和签名 authority 为合成授权，不是生产 provenance 或独立人工签收。

真实 Native 参考重建于 `/home/zxm/.local/share/zhiban-terminal-references/closed-ack-20261013-1/`，0700/0600，**UNSIGNED_REVIEW_REQUIRED**；不重写旧参考/旧证据。CLOSED COMMIT 回执丢失为实际服务器 COMMIT 后的 driver 返回值故障 seam，不冒称真实网络断线；继承的 SIGKILL 用例是真进程退出。维护 fixture 为连续独立场景，测试中显式清旗/reset 仅用于准备后续场景，不能证明产品凭据已交付。

## 剩余工作

下一步制定并实现独立的**凭据交付、host build/receipt 接收确认与清除启动标记**协议，包含部分交付/丢 ACK/旧进程拒绝；完成后再接公共 Native proof worker。建议 **GPT-6 Astra / high** 先复评该交付边界。真实目标执行、完整 enabled gate、逐笔终态授权/finalize、解除隔离、生产 signoff 均未开放。
