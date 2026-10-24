# Handoff 定向复评与未应用候选

2026-10-13。branch `refactor/zhiban-v2`，HEAD `daf63afa83470d24a9ed41d171c6a17f8a80adb6`，工作区非 CLEAN，既有改动保留。本轮同会话定向复评、修订 R2 并生成候选，不声称独立第二评审。状态 **REVIEW_ADDRESSED_IN_CANDIDATE / UNAPPLIED / UNISSUED / KEEP_STARTUP_FENCE**。未连接现有 55432/55433、未签真实 receipt/authority、未发布 gate/启动 host、无 commit/push/CI dispatch。

## 复评结果

| 编号 | 问题/影响 | 修订及具体候选 | 当前判据 |
| --- | --- | --- | --- |
| HC-01 / P2 | 仅声明packages external在release内仍不能证明动态require/import/native/ELF闭包；真实Identity使用@node-rs/argon2 2.2.1。全package build也可能超过300秒live批准 | 离线build先完成再签有界prepare；closure contract列file/edge/native ABI/platform/libc/OS libraries/dynamic review，ambient/unresolved拒绝；结构检查明确physicalFilesVerified=false | **ADDRESSED_IN_DESIGN_AND_CONTRACT**；真实依赖扫描/解析instrumentation/独立加载NOT_RUN |
| HC-02 / P2 | 只靠deployment参数调用启动facts helper未限制release scope；控制role可枚举维护元数据/把自己填写的ready当能力 | 新host_read_authorizations精确deployment/release/credential generation/token/epoch，只有control runtime执行inspect；FORCE RLS/无原始表权限，REGISTERED/ACTIVE读阶段明确，latest epoch复核 | **ADDRESSED_IN_CANDIDATE / LOCAL_SCOPED_VERIFIED**；真实owner seeders和兼容loader未实现 |
| HC-03 / P2 | 旧“读锁→fsync→直接发布”假定PG连接持续存活；idle timeout/重启可使文件发布依据已失效守卫；COMMIT ACK语义不完整 | 新guard_scopes同PID/txid；staging后commit_clear重新校验，只写独立clear_commits并消费批准；deferred约束拒绝guard-only/半消费；实际COMMIT后才可发布，launcher必须验DB记录+签名gate+fresh epoch/claims/fence。未知结果只query | **ADDRESSED_IN_CANDIDATE / LOCAL_SCOPED_VERIFIED**；publisher/全崩溃矩阵未实现 |
| HC-04 / P2 | 已知schema过滤采集不能支撑“拒绝任意额外schema”的新普通profile承诺 | 04完整collector另列全部非pg/information_schema namespace owner/ACL；固定九Business schema+Native public全对象和旧observer/effective privileges；helper返回的profile_digest只作登记绑定，实际catalog必须独立查询/对照shadow | **ADDRESSED_IN_COLLECTOR_AND_CONTRACT**；signed expected尚UNISSUED，完整profile loader NOT_RUN |
| HC-05 / P2 | 验证child先需要读scope，但scope原先要求绑定尚未生成的handoff receipt hash，形成receipt→ACK→receipt环 | 先REGISTERED，receiptDigest=NULL；validation/ACK后签receipt，owner一次REGISTERED→ACTIVE封存digest；客户端无封存权，ACTIVE后摘要不可变，clear只接受ACTIVE | **ADDRESSED_IN_CANDIDATE / LOCAL_SCOPED_VERIFIED** |

真实清旗必须有新的受审批准和owner bootstrap。不得使用现有--closed-ack复用bootstrap，因为它会轮换普通密码并使已签handoff失效。新bootstrap仅建立fresh controller/精确permission，final普通密码在HANDOFF_VERIFIED后不再变；管理target连接先结束，controller预开后NOLOGIN且HBA移除，最终目标backend只有controller。

## 新 SQL、ACL 与提交模型

[候选目录](candidates/m5-handoff/README.md)共 **20 文件**，未放入active migration路径。未来installer一笔Business owner事务执行01..03，然后追加独立 `zhiban_handoff.schema_migrations 0001` 的computed checksum；不编辑Content ledger/version规则，不重写terminal 0002，Native无新增DDL/DML或role edges。

新增5表：schema_migrations、host_read_authorizations、clear_authorizations、clear_commits、guard_scopes；ENABLE/FORCE RLS、owner内部policy。host read token只提供固定限域元数据，不提供写能力；receiptDigest唯一迟绑定后不可改。clear授权包括不可变approval/target gate/pointer/fence/history、release/window/epoch、PID/start/postmaster、secret/TTL。CONSUMED和clear_commits双向一致，clear_commits append-only，无删除/复活授权。

客户端仅获准确helper签名的EXECUTE：

- zhiban_control_runtime：`inspect_host_installation(uuid,uuid,text)`。
- zhiban_reconcile_controller：`begin_clear(uuid,text,text)`、`commit_clear(uuid,text,text)`、`read_clear_result(uuid,text)`。

assert/一致性/trigger函数无客户端EXECUTE；无表级SELECT/DML，其他runtime/issuer/executor/PUBLIC不能清旗。controller仍需现有controller_context绑定实际backend和当前deployment授权，clear secret本身不能查询/写入全部scope。

锁序controller_context → service → epoch counter → CLOSED window → 双 claims → host read authorization → clear authorization，与新window/接管/撤销协调。guard-only COMMIT在deferred约束拒绝；commit_clear必须同PID/txid，重新验scope/expiry/实际backend/六普通LOGIN/全部维护NOLOGIN/最高epoch/空claims/唯一CLOSED审计。返回 **COMMIT_PENDING，launchAllowed=false**，不是网络COMMIT回执；actual COMMIT或fresh exact lookup才证明控制记录已持久化。lookup COMMITTED/NOT_OBSERVED均不返回publishGate或write replay权限。

该commit只新增handoff控制账本，不更改tenant业务状态、window/claims、installations.ready、services/grants/proofs；它不是terminal处置或完整enabled signoff。模板gate purpose为 **LOCAL_STARTUP_RELEASE_GATE**：先签待激活字节，后clear批准绑定其SHA256，避免签名/hash环；只有DB COMMITTED、签名file、当前epoch/claims/fence/pointer一致才能派生CLEARED。PostgreSQL不能验证真实文件/HBA字节或Ed25519签名：这些由受信owner seeder/issuer/publisher分别核对，未实现就不得启用。

## 文件清单

| 组 | 文件及作用 |
| --- | --- |
| SQL/helper/ACL | 01-schema.sql、02-helpers.sql、03-acl.sql：独立ledger、scope/commit/约束、最小权限 |
| Profile collectors | 04-complete-catalog.sql、05-business-terminal-catalog.sql、06-native-terminal-catalog.sql：全对象/未知namespace、observer/effective ACL；新的ordinary-profile.contract.json提供合同，不是signed expected |
| Templates | closure-manifest、prepare-approval、handoff-receipt、clear-approval、cleared-gate、activation-result六份*.template.json；全部UNISSUED/null，不含真实ID/凭据/签名 |
| Offline contracts | dependency-closure.cjs结构拒绝；execution.contract.json.executionSupported=false，无真实CLI/文件publish能力 |
| Binding/verification | refresh-inventory.py、verify-static.py、verify-local-pg16.cjs、inventory.json |
| Docs | README.md；R2设计及本评审是独立文档 |

build/issuer/owner seeder/installer/兼容M1–M5 loader/gate reader/publisher均未接线。旧Content loader继续严格拒绝0002，不覆盖它重签。旧terminal blocked技术receipt不提供handoff普通host能力，旧固定schema collector也不声称能检测任意新增handoff schema；新ordinary loader必须使用本合同及独立shadow。

## 来源及证据适用范围

新candidate inventory：`cfcdca0e59cac133d1c74f803eb1a9407b48c1062c3dea16545d176f44e52235`。

独立handoff migration aggregate：`38087fa9a1ec583d66179c8640c971bccf54ec6934d9791e5b3aa9bb98a72332`。

terminal前置inventory仍 `4e5585a55aae259a39ac5c0aa01f40e66c4dbb138d99b2d093c626565c9d662a`，0002 aggregate仍 `ec2aa8066aae0455127522df40a32b86249a98417391dc714d243f366e592548`；已应用0001及其他prerequisite字节保持。所有新模板未签。旧30/50/13及14组证据保留原SHA/hash/scope，不升级为本轮交付/清旗证明。

| 本轮证据 | 结果 | 适用范围 |
| --- | --- | --- |
| [静态](evidence/m5-handoff-candidate-static-local.json) | **7组 PASS**；PG16.1 grammar 30 SQL/8 PLpgSQL | 来源/新aggregate/模板、ACL/RLS、旧业务无mutation、same-tx/当前窗口边界、deferred执行和链接 |
| [独立临时PG16](evidence/m5-handoff-candidate-pg16-local.json) | **12/12 PASS** | 实际新SQL/helper/ACL单事务编译及独立ledger；exact read token/不可枚举/无表权；REGISTERED先于receipt、owner唯一封存、client拒绝；guard-only COMMIT、epoch rival等待、late backend、真实idle事务超时销毁guard、fresh ACK无重放、实际控制COMMIT/消费/不可重放、结构闭包负向 |
| CJS/格式/diff/绑定 | **PASS** | 新CJS解析、JSON/改动CJS格式、文档链接、全部来源/旧prerequisite hash |

PG只创建新0700临时socket-only cluster（56494），禁TCP，finally停机删除；未连接55432/55433。deployment/service/CLOSED history是privileged replica合成fixture，Native是原最小fixture；fixture false installationReady证明helper不seed ready，不能代替真实安装批准/provenance。idle transaction timeout用真实server断开，epoch竞争是真独立PG连接；没有签名gate文件发布/fsync故障、真实host、Native API或完整并发/每个崩溃边界测试。结构closure返回physicalFilesVerified=false，不能给真native依赖PASS。

本轮测试中一次fixture仍引用旧approvalId，超时后正确被拒绝；已修正为fresh批准并在最终hash下重跑通过，不放宽helper。

## 下一步

定向复评新增SQL/profile、REGISTERED封存与clear控制账本的owner seed/撤销边界；随后实现非轮换bootstrap、prepare/verifier、commit-aware publisher/launcher，并按R2矩阵补受影响本地验证。实际依赖/ABI库闭包、独立signed expected、真实产品回归/receipt/gate、完整enabled/生产签收仍deferred。

建议复评 **GPT-6 Astra / high**；不因本候选局部PASS执行真实清旗。
