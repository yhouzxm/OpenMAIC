# M5 terminal R3 定向复评

日期：2026-10-12。结论：`R3_CANDIDATE_REVIEWED / TSQL_01_03_CLOSED / 1_P3_TEST_EVIDENCE / KEEP_ALL_FENCES`。原 TSQL-01、02、03 三项 P2 在本次候选范围内关闭；未发现新的 P1/P2 阻塞项。另有一处低优先级测试证据问题，见 R3-01；现已在后续[接线实现](zhiban-v2-m5-terminal-installer-wiring.md)补齐，历史描述保留。此结论允许继续实现，不能用作现有开发库应用、终态处置或 enabled gate 的批准。

核验 branch `refactor/zhiban-v2`、HEAD `daf63afa83470d24a9ed41d171c6a17f8a80adb6`，工作区非 CLEAN，保留既有候选。被审 inventory `855ac6019326fdd4a56c4a231fa64364dff3f0b5cee85748a2b9952cb6ac8e5d`；Business aggregate `e1e7ea9517462edd855fb8715f49346db4c467c01aac43e8a370c39eebf7184a`。

## 原问题关闭依据

| 原问题 | 定向核对 | 结论 |
| --- | --- | --- |
| TSQL-01 接管 ACK 查证 | read_takeover_result 的 controller_context 校验 deployment、secret、backend 与 TTL；ACL 仅给 controller，无表 SELECT。先锁 service，再 epoch counter、old/new window、双库 claims，和 takeover 的写入锁序一致；正常 resume 的 service 排他锁提供同服务串行化。查询核对 old/new/request 双向关系，分别返回历史 COMMITTED 与 successorIsCurrent/currentWindowId，不复活旧窗口。恢复计划的写入是明确条件分支，断连后要求新 bootstrap 查证 | CLOSED_IN_R3；完整执行器及故障注入仍 deferred |
| TSQL-02 profile 缺项 | 09 新增双库 owner/ACL/有效 CONNECT/CREATE/TEMP，以及 observer 特殊 catalog ACL/有效权限；10 独立采 Native schema/关系/列 ACL、默认权限和有效表列权限。比较器拒绝缺失 part、跨库扩权、Native 超额写权，并和外部 expected 精确比较。receipt 仍 UNISSUED，预期来源字段为空；工具返回 runtimeAccepted=false，不把可自选 expected 文件当成可信凭据 | CLOSED_IN_R3；可信 expected 来源、原业务/Storage profile 组合及 issuer/loader 接线仍需实现验收 |
| TSQL-03 lookup 生命周期审计 | 签发/有效撤销在同一 helper 事务内追加控制事件，绑定 deployment、tenant、lookup、operation/request、调用角色、时间与 provenance。撤销先锁许可 FOR UPDATE，读结果锁 FOR SHARE；重复撤销不追加虚假变化。控制事件 append-only，无客户端 DML。新 revoke 签名与 ACL/inventory 一致 | CLOSED_IN_R3；下述签发故障测试不能算审计失败注入 |

nullable v7 domain 修复仅允许原本可空的字段为 NULL；必填列的 NOT NULL 与非 v7 拒绝继续存在。没有修改旧 applied domain。PG16 既有 PUBLIC subscription 非敏感列权限及 pg_control_system proacl 已被如实记录，不将显式三列 GRANT 误称为全部有效权限。

## R3-01 / P3：签发测试在许可表先失败，没有覆盖审计插入失败

位置：[verify-local-pg16.cjs](candidates/m5-terminal/verify-local-pg16.cjs) 第 418–429 行。用例名为 `issue audit error rolls back permission`，实际调用 `issue(id(40), null)`；[04-control-and-lookup.sql](candidates/m5-terminal/04-control-and-lookup.sql) 第 153–158 行先向 lookup_permissions 插入相同 provenance。该列在 [01-schema.sql](candidates/m5-terminal/01-schema.sql) 第 131 行为 NOT NULL，因此请求先在许可 INSERT 失败，不会执行后面的 control_events INSERT。

当前用例通过只证明无效签发参数被拒绝、没有许可残留；即使删掉签发 helper 的审计 INSERT，这个负向用例本身仍会通过。成功签发事件的另一用例可以检测审计整体缺失，SQL 的同事务写法也提供原子性，因此本项不重新打开 TSQL-03 的实现缺陷，但不能把它宣称为审计失败后的签发回滚实测。

建议在下一实现批次把该用例改名为无效 provenance 拒绝，并使用合法 provenance，在临时 cluster 的 control_events INSERT 点注入精确故障，确认许可先尝试写入后仍全部回滚，同时断言失败 SQLSTATE/目标。不要在现有开发库安装故障触发器。本轮已收窄修复报告中的表述，原测试源码/历史 JSON 记录及其 hash 不改写。

撤销负向用例不同：revoke(null) 先 UPDATE 许可，再因 control_events.provenance_digest NOT NULL 失败，其状态恢复 ACTIVE 能证明该撤销事务回滚。55P03 断言也确实覆盖读取锁与撤销锁的冲突。

## 证据与后续范围

本轮重跑静态校验 **12/12 PASS**，PG16 grammar 116 条 SQL、34 个 PL/pgSQL 函数解析通过，候选/prerequisite/hash/receipt 绑定一致。核对已有 [26/26 本地证据](evidence/m5-terminal-sql-r3-directed-local.json)与测试实现，未重复执行数据库测试，未连接或改变 55432/55433。26/26 保留为原断言执行结果，其中上述一项仅具有收窄后的意义。

临时 fixture 使用 replica 初始化部分 Business 对象、最小 Native 五表；没有完整服务终态 provenance、公开 Storage worker、full finalize、真实 COMMIT 丢包、双控制器/恢复进程崩溃执行器或 host 回归证据。不能因三项 P2 关闭而扩大证据适用范围。当前库仍 UNAPPLIED，所有隔离、UNISSUED receipt 和完整 enabled gate 的 deferred 状态保持。

下一步可补 R3-01 用例并进入 terminal installer/receipt loader 的可信 expected profile 接线；随后实现 Native proof worker、维护执行器并完成必要的本地验收。无需为这一候选复评重复相同 GitHub CI。建议实现使用 GPT-6.1 Sol / high。NO COMMIT / NO PUSH / NO CI DISPATCH。

2026-10-12 后续已补 R3-01：合法 provenance + 审计 INSERT 前 ZX001 故障，许可/事件均回滚；见[技术 installer/expected/loader 接线](zhiban-v2-m5-terminal-installer-wiring.md)。新 42 项证据绑定新 inventory，不改写原 26 项的范围；接线增量待复评。
