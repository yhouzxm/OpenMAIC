# M5 终态处置：精确授权、审计与并发屏障设计

日期：2026-10-12。修订：R2（TR-01–03）。状态：`DESIGN_REVISED / PENDING_SQL_REVIEW / NOT_IMPLEMENTED / NOT_APPLIED / KEEP_ALL_FENCES`。

本设计回应[只读报告评审 T1–T3](zhiban-v2-m5-reconciliation-review.md)，选择当前单机专用 PG16 环境的**离线、单笔、正向内容证明**处置。它是新增合同补充的评审输入，不是执行许可；不启动维护、不签发处置授权、不结算现有操作、不修改已应用 migration。现有只读 CLI、隔离和 UNISSUED enabled gate 保持原状。

## 1. 目标、边界与决定

唯一新增能力名为 `CANCEL_UNPUBLISHED_NATIVE_RETAINED_V1`：取消一笔已发出 Native prepare、尚未激活的 `PUBLISH_CONTENT`。完整公开文档与记录一致时，承认准备结果存在，保留 Native candidate，结束业务发布命令。**不激活、不发布、不清理 Native、不重放原请求。** 这是本地维护能力，没有 HTTP 路由或教师/管理员页面入口。

服务主体具有 `RECONCILE` purpose，不继承原教师、Session 或管理员的身份权限。原用户被撤权不阻止独立授权的取消；但本版要求 tenant ACTIVE、course 未归档、offering OPEN、resource 类型/策略/来源仍符合下述条件。其他业务状态继续隔离，避免把维护权扩大成跨租户或停用资源操作权。旧 Session、OS uid、技术安装 receipt、只读报告都不是单笔变更授权。

需要双库停服窗口：`zhiban_m1_dev` 和 `zhiban_m5_native`，当前专用开发 cluster 为 55433。窗口内 M1–M4 也不可使用。端口/库名只用于定位，实际授权绑定 cluster system identifier、数据库 OID、deployment 和安装来源。原 55432 disposable 测试 cluster 不在该维护范围。

本设计不调用现有 `GuardedBridgeProtocol.reconcilePrepared`：它校验原 USER，不能承担此服务能力。也不创建泛化 Bridge RECONCILE reservation：现有 reservation 必须递增 slot revision，会改变原 prepare 的版本关系。新增专用 resolution ledger 承载服务 RECONCILE，slot 完全不变。该选择及服务审计例外须作为 [B9-S02/S05/S06](phase1/phase1b-9a-bridge-design.md) 的显式补充评审，不能声称冻结合同已经实现它。

## 2. 唯一允许的状态矩阵

以下每项都是 AND 条件；不满足时返回 `KEEP`，不写业务终态。grant 必须绑定实际观察到的具体旧状态，而非笼统接受 RESERVED/UNKNOWN 任意一个。

| 对象 | 必须满足的当前事实 | 同一 Business 事务中的最终变化 |
| --- | --- | --- |
| Content operation | action=PUBLISH_CONTENT；state=RESERVED 或 OUTCOME_UNKNOWN；prepare 非空；activation/结果/完成时间为空 | state=FAILED；completed_at=T；result_revision/result_publication_id 仍为空 |
| 来源 resource | source_revision 与当前 revision 相等；SQL draft_digest 与 source_digest 相等；SLIDE_CONTENT/content-text-v1；offering/owner 等所有记录绑定一致 | 整行不变，包括草稿、revision、updated_by、active_publication_id、last_publication_no |
| PREPARE_CONTENT | RESERVED 或 OUTCOME_UNKNOWN；dispatch_started_at 非空；原 USER/intent/key/slot/generation/stage 均匹配；结果为空；slot.repository_revision=reserved_slot_revision | SUCCEEDED；reason=NONE；result_generation_id=原 generation；result_slot_revision=原 reserved_slot_revision；updated_at=completed_at=T；repository_revision+1 |
| 候选 generation | PENDING；activated_at/terminal_at 为空；content_digest=expected_native_digest；无 asset binding；scene bindings 精确匹配 | ORPHAN；terminal_at=updated_at=T；repository_revision+1；activated_at 仍为空；所有 refs/content/owner 不变 |
| activation | Content 引用为空，且该 generation 不存在任何 ACTIVATE_GENERATION operation（含未终态与失败）或 publication 引用 | 不创建、不修改 |
| slot / 既有发布 | slot 所有来源/owner/deployment 匹配，当前 active generation 若存在必须是另一代，原发布关系有效 | slot、原 active generation、publication 全部不变 |
| Native | 排空后取得 `FULL_PUBLIC_DOCUMENT_MATCH`，满足第 5 节 | 只读取并释放读取锁，不写数据 |

服务 resolution reason 固定为 `CANCELLED_UNPUBLISHED_NATIVE_RETAINED`。Content FAILED 表示**该业务命令没有发布**；PREPARE SUCCEEDED 表示公开可读内容与记录相符，不声称确定是哪一次网络请求写入。两者不矛盾。ORPHAN 保留并继续计入 slot.last_generation；不减少编号，不转为 ACTIVE，不物理删除。

明确 KEEP：prepare 已 SUCCEEDED/FAILED、dispatch 未开始、Native null/错 owner/缺场景/摘要不符/读取异常、任何 activation、generation 非 PENDING、来源漂移、slot 已推进、撤销/过期/重放 grant、安装来源变化、停写未证明。即使“未发出”看似可安全取消，本版也不纳入另一套失败推断。已经终态的操作只查历史结果；不重复结算。后续正常发布须恢复服务后提交新命令，并重新进行当时的用户授权。

## 3. 服务身份与逐笔授权

### 3.1 分离入口

- **维护控制器**：本机受信 OS owner 经专用 socket 管理 cluster；窗口 ledger 使用独立 `zhiban_reconcile_controller` 角色，仅执行预定义 admission、role、catalog、backend 排空步骤。不能以 postgres 执行业务终态 DML。此信任边界不防御恶意 OS owner/superuser。
- **授权签发器** `zhiban_reconcile_issuer`：独立私有凭据，仅调用列出的签发/撤销 helper。操作者先查看精确 proposal，再明确批准一笔取消。操作者 uid/本机标识及批准文件 hash 记为 maintenance provenance，不能伪造成 Identity user/member。
- **执行器** `zhiban_reconcile_executor`：独立私有凭据；只可读取受限 proposal、提交证明和调用单笔 finalize helper。不能给自己签发 grant、改服务权限或提供任意 SQL。
- **Native 证明角色** `zhiban_reconcile_native_proof`：仅用于第 5 节公开读取。任何角色都不得成为 owner/superuser/BYPASSRLS 或获得通向这些角色的 membership；执行器不能 SET ROLE 为 issuer/runtime/owner。

issuer 的可信本地入口只接受当前逐笔批准，不从报告目录自动批量签发。DB grant 是真正的能力凭证；OS 批准文件不是 DB 权限本身。首次维护、角色配置、终态实现及实际运行均需后续明确授权，不由本次设计请求推导。

### 3.2 精确 grant

签发 `purpose=RECONCILE`、`capability=CANCEL_UNPUBLISHED_NATIVE_RETAINED_V1` 的单用途 grant，TTL 固定最多 300 秒，以 DB `clock_timestamp()` 计算。绑定以下全部字段：

1. service_ref、service authorization_version、deployment、cluster system identifier、Business/Native DB OID、postmaster start、维护 window_id/epoch。
2. tenant/offering/resource/content_operation/prepare_operation/slot/generation；记录中的 owner_handle、stage_ref、按 ordinal 排列的 scene ref/digest 的摘要。只接受 UUIDv7 和已有精确 refs，不接受前缀/通配符/调用者重建 handles。
3. Content 精确旧状态及整行 hash、prepare/generation/slot repository_revision、resource revision、source_digest、expected_native_digest、intent_digest、key_digest；当前全部来源行/映射/原 active publication 的规范快照 hash。
4. 当前 implementation、schema/migration、ACL/profile、Storage/DSL 来源、安装 receipt 与 maintenance build hash。安装 receipt 只证明安装兼容性；grant 才表示本次授权。
5. operation-specific request_id、proposal hash、maintenance operator provenance hash、issued_at/expires_at；随机 256-bit bearer secret 只交私有 worker，库内存 token digest，日志不输出 secret。

签发 helper 自行从 DB 锁定/读取对象生成这些绑定，不能照收调用者提供的“当前事实”。历史大整数按十进制字符串进入 canonical payload；schemaVersion 固定、键排序、数组顺序固定、拒绝额外字段，不混用 SQL jsonb draft_digest 和 JS document canonical hash。

service registry ACTIVE/version、window、grant 三者在 finalize 内再次检查并持锁到事务结束。服务撤销与 finalize 竞争同一 service 行；逐笔 grant 撤销也先锁 service，再按第 6 节顺序锁 grant。撤销先提交则处置失败；处置先持锁且提交则撤销随后生效。承诺是按锁顺序串行生效，不能承诺撤销逆转已提交事务。

## 4. 停写、排空、迟到写入屏障

### 4.1 不能替代屏障的信号

`pg_try_advisory_xact_lock` 的 dispatch 锁在 markDispatch COMMIT 已释放；锁住 resource/operation 无法阻止迟到 Native save。停止 Node、HTTP 超时、取消 query、Business client 已销毁、只看到零 active query、锁 TTL 到期，都不证明 Native 事务已结束。维护 flock/advisory lock 只排除重复控制器。

### 4.2 固定顺序

1. 校验专用单机 cluster/双库/完整角色继承与来源清单，保存 admission 与 role 原配置到私有耐久 journal，建立唯一 deployment window（epoch 单调增长）。正常窗口阶段为 `PREPARING → DRAINED → PROVING → SETTLING → RESUMING → CLOSED`；异常进入 `BLOCKED`。故障接管只允许旧窗口转 `SUPERSEDED` 并指向新 PREPARING 窗口（§4.4），不经过正常开库流程。CLOSED/SUPERSEDED 均为不可重新开启的终态；其余阶段继续占用 deployment。另按 cluster system identifier 与目标 DB OID 取得唯一当前窗口占用，禁止其他 deployment 对同库开第二个窗口。禁止 epoch 回退。
2. 停止 host、测试脚本、worker 和所有自动启动源；启动入口读取 maintenance flag 并拒绝启动。预先建立唯一允许保留的 Business 控制/issuer/executor 连接及 Native proof 连接；登记 `(database_oid, pid, backend_start, session_user, controller_nonce)`。控制器另有连接到 `postgres` 管理库。禁止仅按 application_name 或 PID 放行。
3. 管理连接对**两个目标库**设置 `ALLOW_CONNECTIONS false` 并回读确认。逐一禁用普通 writer 的 LOGIN，轮换其凭据，并核验 pg_hba 不允许普通 writer 通过 trust/peer/其他认证通道绕过轮换；否则不进入 DRAINED。普通 writer 包括本次 deployment 的 Identity/Academic/Learning/Assessment/Bridge/Native/migrator 等全部入口，不只 Bridge。清单外 writer、复制订阅、可写后台扩展不接受；要求 `max_prepared_transactions=0` 且无 prepared transaction。
4. 等待有限排空，超时后只按已授权维护窗口终止两个目标库的非允许 backend。不按角色遗漏 idle/idle-in-transaction/Native 后端；逐个等待真实 backend 消失并再扫描。跨库事务可能已在 Native COMMIT，也可能回滚；排空完成后的新快照决定能证明的内容。
5. admission 两库均关闭、允许连接身份全部存活、非允许 backend 为零、无可写 background/replication/prepared transaction，且 system identifier/postmaster start 未变，才能持久记录 DRAINED。用目录检查和实际普通连接拒绝验证，不能只相信 journal 中的标志。所有证明快照始于这个时刻之后。
6. proof 与 finalize 期间保持双库 admission 关闭及固定连接 allowlist。控制器在签发、proof 注册、finalize 前检查实际 barrier 并记录单调序号；DB helper 同时检查当前 window、两个 `pg_database.datallowconn=false`、已登记 backend 和窗口有效期。禁止 worker 自报 barrier=true。窗口租约为 60 秒，由控制器每 10 秒重新检查后续租；helper 以 DB 时间检查未过期，且最新实际 barrier 检查距当前不得超过 10 秒。窗口租约/心跳过期只能使处置失败，不会自动开库。

如果某一步只成功一半，保留已生效的 admission 限制并标记 BLOCKED，不在 `finally` 恢复流量。控制器崩溃、允许连接丢失、PG 重启或来源变化后，原 epoch 的 proof/grant 均不可用。双库关闭状态下不能新建目标库连接，因此**不得直接重连续用旧窗口**；故障恢复按 §4.4 先隔离全部旧维护凭据和普通连接通道、排空旧 backend，再以仅恢复控制器可进入的临时 admission 原子接管占用、建立新 epoch，随后重新关闭双库并重做排空。此恢复程序必须和正常路径一起实现、验证，未实现前不能执行维护。

### 4.3 恢复服务的排序

控制器先按第 6 节锁序取得 window 排他锁，等待在途 finalize 完成；在 Business 提交 `RESUMING` 并废止本 epoch 全部未消费 grants/proofs，然后才能从管理连接恢复 admission。这样开库不能与仍可提交的处置并发。逐项恢复批准的角色与新凭据，校验 receipts/ACL；最后启动重新构建的 host。旧进程已消失、旧凭据失效，不能在重新开库后回放缓存请求。恢复一半失败则保持 host 停止，记录实际门状态；不谎报完整关闭或完整恢复。确认批准的双库 admission/角色已恢复后，在 Business 事务内将窗口标 CLOSED、将两个 claim.current_window_id 清为空并追加恢复审计；提交后释放 maintenance 启动阻断再启动 host。新普通维护窗口只允许锁定并取得空 claims；SUPERSEDED 的 claims 已属于 successor，不能作为空闲占用。

窗口的跨库 DDL 和 journal 不是分布式 ACID。每个步骤均记录 intent/confirmed，重启后依据真实 catalog/backend 事实恢复，不能仅凭阶段名跳过检查。业务终态原子性只由第 6 节 Business 事务提供。

### 4.4 BLOCKED 接管：占用交接与 admission 分开

恢复入口为 `takeover_blocked_window`，只给独立 `zhiban_reconcile_controller` 的恢复包装调用，不给 issuer/executor/runtime。其控制权限绑定 deployment/cluster/双库和本次恢复 bootstrap nonce；不依赖旧 service 的 ACTIVE 状态、旧 grant 或旧租约。它只能接管窗口、作废未消费授权、查询提交结果，不能签发新处置 grant 或执行 finalize。

1. 取得同 cluster 的维护 flock，读取耐久 journal 和实际 catalog。经管理库连接保留/建立双库关闭状态，禁用普通角色及**全部旧维护登录角色**，轮换旧 controller/issuer/executor/proof 凭据，取消旧启动源。等待两个目标库全部旧 backend 消失，包含原 allowlist；记录不可复用的 backend 身份。普通 pg_hba 通道保持拒绝，只有新恢复控制器的精确角色、源地址/私有 socket 及认证方式可进入；回读配置并实测普通、旧维护凭据均被拒绝。不能单凭密码轮换排除 trust/peer/证书映射。
2. 记录临时 admission intent，Native 保持关闭，仅临时开放 Business 供新恢复控制器 bootstrap。此期间 ordinary admission 被 pg_hba/NOLOGIN 双重阻断，issuer/executor/proof 均不能建立连接，所有 finalize 又因双库 datallowconn 条件不成立被拒绝；新连接不是旧 proof 的延续。若旧窗口因崩溃仍处于正常活跃阶段，恢复 helper 在下述同一事务先将其标为 BLOCKED，并追加失联/排空证据；不能等待已死旧控制器写 BLOCKED。
3. 在一个 Business READ COMMITTED 事务内，按 §6 锁序锁 service/deployment epoch counter、旧 window、双库 claim 行与旧窗口未消费 grants（ID 升序），回读 bootstrap 身份、排空证据及当前占用。将旧窗口未消费 grants 标 REVOKED；旧 proofs 保留但因旧 epoch/window 永远不可再用于 finalize；CONSUMED grants、COMMITTED resolutions 和审计原样保留。旧 window 标 SUPERSEDED，创建 epoch=counter+1 的新 PREPARING window，绑定全新 backend/nonce/build，设置旧 successor/new predecessor 双向 FK；两个 claim 原子指向新 window，epoch counter 同事务递增，追加 takeover control event。提交时检查只有一个当前占用、无环/跨 deployment successor、epoch 严格增大。窗口/claim 不删除，不使用普通 RESUMING helper。
4. 接管提交后，普通连接仍被拦截；再次关闭 Business，回读双库 datallowconn=false，确认新 allowlist、排空并获取新 barrier，才可推进新窗口 DRAINED。需要 issuer/executor/proof 时，仅在精确维护 admission 下预建它们的新连接，随后重新关闭双库；此 bootstrap 只允许 PREPARING，不允许签发/证明/结算。后续签发仍须当前服务有效和一笔新的明确批准，旧批准文件/secret/proof 不复用。

`window_database_claims` 是每个 `(cluster_system_identifier,database_oid)` 一行的当前占用指针（current_window_id 可为空，仅正常 CLOSED 完成时清空），迁移时预建，客户端不可创建/删除；接管只改变其 window_id，历史交接进入 append-only control_events。deployment epoch counter 只增不减。窗口唯一索引的活动谓词为 phase NOT IN ('CLOSED','SUPERSEDED')，SUPERSEDED 不释放普通流量，只交接维护占用。正常 CLOSED 才表示恢复流程已完成。

| 恢复崩溃点 | 再次接管时必须做的事 |
| --- | --- |
| 临时开放前/后、接管事务未提交 | 普通角色保持阻断；先关库并杀掉上轮恢复 backend，旧 claim 仍有效，重新 bootstrap，不猜测提交结果 |
| 接管 COMMIT 回执丢失 | 新 bootstrap 查询 takeover_request_id/双向 successor/claims；已提交则不得重复创建同一 successor。上轮新窗口若失去控制器也要作为旧窗口接管到更高 epoch，不能复活其 lease/allowlist |
| claim 已交接、重新关库前崩溃 | 新窗口 PREPARING 不具处置能力；先确认普通连接仍被阻断并关闭双库，再通过新恢复循环接管，不跳过排空 |
| 原 finalize 已提交但 ACK_UNKNOWN | 读取保留的 resolution 重建原 receipt；不重置 grant、不重做 finalize、不把它算成新 epoch 的结算 |

任何一行的 admission 或 DB 结果不确定都保留 BLOCKED/普通连接阻断；恢复不自动发布、不删除 orphan，也不由超时触发正常开库。

## 5. Native 正向证明的精确含义

证明 worker 在排空后，顺序调用公开 `PgDocumentStore.readFreshnessManifest(stage_ref)` 和 `loadDocument(stage_ref)`；**每次调用各自 checkout 连接、BEGIN READ COMMITTED READ WRITE、固定本次 queryable、COMMIT/ROLLBACK、release**，完整遵守公共 withTransaction 合同。该合同也适用于读取。无外部共享事务、无嵌套 BEGIN、无 no-op transaction hook；不改上游 SQL、不读私有表内容、不删除 FOR SHARE。

维护连接池仅含 admission 关闭前预建、登记的 proof backend；每次获取新的 checkout lease，物理 backend 可在释放后串行复用。关闭 idle/max-lifetime 淘汰，池容量固定；禁止在连接损坏时自动补连接、回退普通 Pool 或在关库后重新 connect。lease 释放前事务必须已结束，持有旧 lease 的 query 必须拒绝。损坏/丢失任一必需 backend 即废弃 proof 并转 BLOCKED；30 秒预算仍覆盖两次调用及屏障检查。

两次调用是独立事务观察，READ COMMITTED 内也不承诺单一事务快照。其 owner/内容一致性来自从首次 owner gate 前持续到最后 proof/finalize 的停写屏障与受信 proof adapter 无 DML。控制器在首次读取前、两次读取之间、末次读取后及 proof 注册/finalize 前核验同一 window/epoch/allowlist 与真实 barrier；任一检查失败、epoch 改变或 backend 丢失均 KEEP。

先使用记录的 owner_handle 创建 owner-scoped store；manifest null 即停止，绝不能继续调用 ID-only loadDocument。manifest 的 stage/scene IDs、顺序、合法 revision 与映射匹配后，再读取完整文档。完整返回值须通过当前纯文本封闭 schema，并且 `hash(canonical(document))` 精确等于 operation.expected_native_digest、generation.content_digest 及本地记录重建文档 hash；无 asset、额外 outline、字段/场景、版本差异均拒绝。两次读取之间及前后窗口/后端/安装绑定均有效，且限时完成，才能登记 `FULL_PUBLIC_DOCUMENT_MATCH`；manifest 不合法时与 null 相同，禁止进入第二次调用。

公开 loadDocument 会执行 DSL migrate；证明对象是**绑定版本公共 API 返回的完整逻辑文档**，不是 Native 原始存储字节、历史 schema version 或原网络请求的来源。不能声称通过公共 API 区分了所有内部迁移，也不能把 manifest revision 合法视为历史 revision 相等。未来若要求原始持久化字节/写入者证明，需要新的公开能力及独立合同，本版不提供。

FOR SHARE 不能运行于 PG READ ONLY，并需要 UPDATE 权限。拟给 proof role 仅 CONNECT/USAGE、SELECT 于 `document_stages/document_scenes/document_outlines/document_stage_revision/document_scene_revision`，以及 `UPDATE(id)` 于 document_stages 以允许行锁；无 INSERT/DELETE/DDL/其他列 UPDATE 或角色继承。**该 UPDATE(id) 仍是实际写权限，不能宣称数据库强制只读**。凭据只在受信私有证明进程，封闭 adapter 只允许这两个公共读取方法产生的绑定版本语句及事务控制，禁止任意 SQL/参数化表名；禁止通过 HTTP 暴露。这个最小权限仍需评审接受并用本地 ACL/adapter 负向验证，未接受则终态能力保持禁用，现有严格 READ ONLY 报告继续使用。

Business 无法自行验证跨库内容，信任绑定 build 的本地 proof worker 作限域证明。proof 记录绑定 grant/window/epoch、两次 checkout 的 backend/lease 身份、各事务起止时间及观察序号、前/中/后 barrier check 序号、manifest/document/expected digest、源码/DSL/receipt hashes、observed_at/到期时间（不晚于 grant）；这些是两次观察记录，不称为共享 snapshot。输入 secret 与 worker session_user 必须通过校验；不能用一份 caller 自填 JSON 或旧只读报告代替 worker 执行。两次 Native 读取各自先完成事务并释放 lease，全部检查通过后再注册 proof；双库写入屏障保持至 finalize，故观察之间及到 finalize 之间结果不被其他 writer 改写。

## 6. Business 原子结算与锁序

服务事务要求 READ COMMITTED、tenant GUC 精确匹配；GUC 只是 scope，不是授权。新增 helper 对 session_user、登记 backend、service grant、window 全部校验。单次命令总体预算 30 秒，连接/语句/锁/idle 上界沿用已验证的 3s/5s/1s/10s；超时销毁客户端，无自动重放。300 秒是授权外部有效期，不扩大单次运行预算。

所有新 helper 采用同一锁序：service registry（同层 deployment epoch counter）→ deployment window → window_database_claims → grant → proof → tenant → offering → course → resource → slot → generation → Content operation → prepare operation；同类多行按 ID 升序。一般读取事实用 FOR SHARE，window/claims/grant/目标写行及 resource/slot 用 FOR UPDATE，撤销/接管需要修改 service/counter 时在最前取得 FOR UPDATE。proof 行保持 append-only，消费由唯一 resolution.proof_id 表示，读取持 FOR SHARE 到提交；不 UPDATE proof 状态。issuer/revoke/resume 如需其中子集，保持相同相对顺序；resume 先锁对应 service registry，再锁 window，不反向拿锁。Identity tenant 只读锁及当前状态验证必须明确新增 owner policy；不调用需要 USER Session 的 guard，也不把历史 membership 当成服务授权。历史原 actor/owner FK、所属 tenant 和 binding 仍必须有效，状态撤权不改写历史。

finalize 是一条封闭 helper 调用，禁止任意状态目标/SQL 参数。步骤：

1. 按锁序查当前授权和来源，校验 grant 未使用/未撤销/未过期、service version/window epoch 相等、实际 barrier、proof 匹配、状态矩阵及所有快照 hash。仅 provenance 匹配不足以绕过任何来源/当前状态检查。
2. 插入 resolution（事务内尚未对外可见），取得 DB 时间 T；要求 T 不早于相关 updated_at/created_at 且版本不会溢出。更新 prepare、generation、Content operation；插入真实服务 Bridge/Content audit；grant 标 CONSUMED 并绑定 resolution，proof 由唯一 resolution 引用完成一次性消费；resolution 标记 COMMITTED。所有更改共用 T，按第 2 节固定赋值。
3. 检查当前 service/grant 有效期及 window，触发所有 deferred consistency 约束并 COMMIT。expiry 定义为最后授权检查时刻：服务/撤销锁持有到 COMMIT，TTL 不承诺远端收到回执时仍有效。截止/COMMIT 异常按结果不确定处理，绝不假报回滚成功。
4. 成功后导出私有 receipt。导出失败不回滚已提交终态；通过 resolution/request_id 查询 DB 重建同一 receipt，不再调用 finalize。COMMIT 回执丢失同理，只做新连接的精确结果查询；若窗口禁止重连则先走恢复程序，期间标记 ACK_UNKNOWN，禁止重复写入。

request_id 与 grant/content operation 唯一。重复请求：已存在完全匹配 COMMITTED resolution 只返回原结果；参数不匹配拒绝；只有 started attempt/无结果不能自动解释为“未写入”。失败事务不能残留一半终态、消费一半 grant 或缺审计。一次性业务 key 不复用为服务授权 key。

## 7. 新 schema、helper、ACL 与真实审计清单

以下是待生成的**新增 migration**规格，不是可执行 SQL；版本号由实际 ledger allocator 分配，不重写 0001_content 或 Identity 0012/0013。当前 content schema_migrations 的 version CHECK 只允许 0001，新增 migration 必须显式扩展为列明的后继版本，并升级 installer/receipt 的版本清单验证，不能偷偷绕过 ledger。

### 7.1 数据对象

新增 `zhiban_reconcile` schema，owner 为既有可信迁移 owner；所有函数默认 REVOKE PUBLIC，tenant 表 ENABLE/FORCE RLS，无直接客户端 DML。

| 对象 | 字段及约束（公共字段见下） |
| --- | --- |
| services | service_ref PK；purpose 固定 RECONCILE；deployment；authorization_version bigint>0；ACTIVE/REVOKED；绑定 executor 角色及变更审计 ID；版本只递增，禁止删除 |
| windows | window_id UUIDv7 PK；service_ref FK；deployment、epoch bigint>0、phase、cluster/DB/postmaster 身份、allowlist、barrier/config hash、lease_until；UNIQUE(deployment,epoch) 及 phase NOT IN (CLOSED,SUPERSEDED) 的 deployment 唯一索引；predecessor/successor 双向 FK；关联 window_database_claims；BLOCKED→SUPERSEDED 与正常恢复分开的状态守卫 |
| window_database_claims / epoch_counters | claims 按 (cluster_system_identifier,database_oid) PK，current window FK；counter 按 deployment PK 且 epoch 单调增长；按 §4.4 接管，同事务唯一占用交接，禁止删除或回退 |
| grants | (tenant_id,grant_id) PK；第 3.2 节所有精确绑定、token_digest、授权 TTL、issued_by/provenance；状态 ISSUED/REVOKED/CONSUMED；FK service/window 和所有 tenant-scoped 目标；授权事实不可 UPDATE，只有状态/消费引用可按 helper 转移 |
| lookup_permissions | (tenant_id,lookup_id) PK；purpose 固定 RESULT_LOOKUP；deployment/resource/operation/request_id/caller_role/provenance、token_digest、issued_at/expires_at、ACTIVE/REVOKED；由独立 controller 控制入口限域签发/撤销，无关联旧处置grant有效性的要求；无写入/处置权限 |
| proofs | (tenant_id,proof_id) PK；grant_id 唯一；固定 FULL_PUBLIC_DOCUMENT_MATCH；第 5 节证明字段；注册后 append-only；不存内容正文/凭据；epoch/绑定必须与 grant 同值 |
| resolutions | (tenant_id,resolution_id) PK；grant_id、proof_id、content_operation_id 各唯一；request_id 唯一于 deployment/service；capability/reason 固定；原/终状态和快照 hash、完整版本增量、service_ref/version、T、两个 audit ID；只允许事务完成的 COMMITTED 行存活；append-only |
| control_events / attempts | append-only；grant issued/revoked、service version、window phase/drain/resume、attempt started/denied/ACK_UNKNOWN/committed/acknowledged；真实 DB session role、request_id、provenance hash、错误分类、DB 时间；控制层事件与 tenant 业务事件分表，避免全局窗口泄露跨租户对象 |

UUID 为 UUIDv7；摘要小写 SHA256；时间沿用合法 epoch 毫秒 bigint；counter/revision 正数 int8、显式防溢出；service_ref 有界无控制字符。所有业务 FK 含 tenant，scope 复合 FK 把 resource/offering/slot/generation/operation 绑定起来，DELETE RESTRICT。JSON snapshot 只作留证，不能代替可验证的 typed column/FK。新增 deferred 双向约束：resolution 必须对应真实终态+两条服务 audit+已消费 grant/proof；服务 audit 必须反向对应唯一 resolution。不能以“存在一条旁表记录”无条件放宽现有检查。

### 7.2 审计归属及现有约束的有限补充

- Content operation.actor_id 与 Bridge prepare USER actor 保持原值。新 Content audit 增加 actor_kind（旧行默认 USER）、service_ref、reconciliation_id；允许 actor_id 在 SERVICE_RECONCILE 时为空，USER 时仍非空且等于 operation.actor_id。新 event 固定 `CONTENT_RECONCILED_UNPUBLISHED`，revision_before=revision_after=source_revision，occurred_at=T。不得用原教师填充一次假 OPERATION_FAILED。
- Bridge audit 增加 reconciliation_id，event 固定 OUTCOME_RECONCILED，actor_kind=SERVICE_RECONCILE，user/member=NULL，service_ref=真实执行者，reason=NONE，slot_revision_before=slot_revision_after=原 reserved_slot_revision，occurred_at=T。prepare 保持 USER。因此必须显式补充 mapping_consistency 的 actor 等值分支，只允许第 2 节那一笔 USER PREPARE 被其 resolution 记录的服务完成；其他 audit 保留原规则。
- Content operation_guard/link_consistency 的 session_user 限制、失败终态 audit 类型/主体检查，以及 Bridge business_resource_ready 的 runtime-only 条件，都需要新增受限服务分支。不能只加审计旁表，也不能用 SET ROLE/runtime 凭据冒充原路径。新增写入授权分支核验当前事务精确 grant/resolution 与单笔对象；历史审计校验使用下述永久关系，不依赖该写入分支；tenant GUC、自定义 GUC 或 role 名本身不构成能力。
- 原 resource/publication 写入路径保持 runtime-only；generation/prepare 的历史不可变字段、版本+1、终态不可再写继续沿用。Content/Bridge link 检查还要执行所有原 pointer/publication/activation 反向绑定条件，不能提前 RETURN 绕开。
- 为新服务写入补精确 owner RLS policy：当前授权对应的 tenant/资源/操作及其一致性读取闭包；slot/资源与 Identity/Academic 读取锁可使用 WITH CHECK(false) 的 owner lock policy，实际 mutation 只允许上表三行及审计/ledger。读取闭包包括同资源全部历史 operations/audits、最近成功 mutation、既有 publications、相关 slots/generations/prepares/activations/scenes，以及这些服务终态对应的 resolution、CONSUMED grant、proof 和历史控制事件；只准 SELECT，不授 runtime/executor 原始表读取。更改前后精确 proacl、owner、search_path、row_security 和 policy inventory 全量比对。

历史校验与新增写入授权分别实现：`assert_resolution_history` 为内部一致性函数使用，无客户端 EXECUTE。其结果只表示不可变历史关系成立，不能被写入 helper 用作当前授权。对普通 runtime 和服务 session 都验证以下永久关系：

1. 唯一 COMMITTED resolution 绑定同 tenant/resource/content operation/prepare/generation/两条服务 audit；grant 为 CONSUMED 且 consumed_resolution_id 精确对应，proof 由该 resolution 唯一消费。purpose/capability/intent/hash/服务主体与签发时 authorization_version 等不可变事实一致；服务版本引用 append-only 授权事件，而非强制等于当前 registry 版本。
2. 原 Content FAILED、prepare SUCCEEDED、generation ORPHAN 的终态字段/版本和 T 与 resolution 一致；真实 SERVICE_RECONCILE audit 的主体、类型、时间、reason、revision 与 §7.2 精确一致；旧 USER reserved/quarantine 审计和 actor 身份保留。不能仅凭 event_type 或存在一条 resolution 放行。
3. 不重新要求旧 grant ISSUED/未过期、旧 window 活跃、旧服务 ACTIVE、旧 epoch 等于当前 epoch、旧 postmaster 等于当前启动。不把 resolution 保存的资源/slot 快照 hash 与**后续正常更新**的整行比较；只核对不可变处置对象及历史凭据，同时继续执行原有当前 pointer/publication/最近 mutation 检查。

新增 FORCE RLS 的历史 SELECT policy 只给一致性 owner，在 tenant GUC 匹配且 session_user 为已列明 runtime 或服务角色时允许该 tenant 的历史行；客户端无表 SELECT 或内部函数 EXECUTE。资源边界由不可调用的触发器读取路径和精确 tenant/resource joins 限定，不使用客户端可伪造的 helper-active GUC。原 Content/Bridge/Identity/Academic 的 owner 历史读 policy 同样列明该读取闭包，避免隐藏旧成功 mutation/原发布来源。RLS 对 tenant 隔离负责，内部函数对 resource 读取边界负责；任何额外客户端授权都是 profile 差异并拒绝安装。

### 7.3 helper 与权限边界

| helper 类别 | 唯一允许调用者 | 能力 |
| --- | --- | --- |
| inspect_proposal | issuer/executor 的各自封闭包装 | 当前维护授权的单笔 proposal，不任意列租户 |
| read_resolution | controller 的恢复包装；issuer/executor 的独立结果查询包装 | 独立只读查证能力，精确 request_id/tenant/resource/operation/result scope，不赋予处置能力 |
| assert_resolution_history | 仅内部 consistency trigger | 永久历史关系检查，无客户端 EXECUTE，不能用于签发或 finalize |
| issue_grant、revoke_grant | issuer | 从当前 DB 事实生成一次性授权/撤销，不能写业务对象 |
| register_proof | executor + 绑定 proof worker | 校验 secret/session/backend/窗口与匹配证明，不能消费授权或解除 fence |
| finalize_cancel_unpublished | executor | 第 6 节唯一原子结算路径，无 publication/pointer/Native DML |
| service/window/control lifecycle | 本地维护控制器专用角色 | 固定状态机、版本与排空记录；与 cluster admin DDL 分离；无业务终态 DML |
| issue_result_lookup、revoke_result_lookup | controller 的限域查询授权包装 | 当前 controller scope/provenance 下签发或撤销单笔只读许可；无处置授权签发权 |
| takeover_blocked_window | controller 专用恢复包装 | §4.4 原子交接、未消费授权撤销与历史保留；无业务终态 DML |

`read_resolution` 的查询权与处置 grant 分离：controller 必须持当前受限 deployment 恢复授权；issuer/executor 必须持当前的 `RESULT_LOOKUP` 只读许可，绑定精确 tenant/resource/operation/request_id 与调用角色。新维护角色/凭据可由独立控制入口重新签发查询许可，即使原处置 service 已撤销；旧处置 secret 不能单独充当查询许可。helper 锁当前查询许可后按精确 FK 查询脱敏 COMMITTED 结果或 NOT_OBSERVED，不枚举历史、不返回 proof 内容/secret，结果不存在不推断原事务回滚。内部 consistency 函数无此客户端查询入口，也不要求 RESULT_LOOKUP 才能检查历史。关闭 admission 时需已登记允许连接，否则先走 §4.4；查询永远不改变业务终态。

上述 helper 固定 SECURITY DEFINER owner、限定 search_path（pg_catalog 优先，schema 显式，pg_temp 最后）、row_security=on、PARALLEL UNSAFE；默认及 PUBLIC EXECUTE 撤销。trigger helper 不给客户端 EXECUTE。issuer/executor 不授表级 INSERT/UPDATE/DELETE、TRUNCATE、DDL、角色管理、Native runtime 凭据或通用 SET ROLE；只能按签名授 EXECUTE。直接 DML、伪造 GUC/actor/proof、跨 tenant、从 runtime 调服务 helper 均须拒绝。

业务审计是 Business COMMIT 的一部分；attempt STARTED 可预先独立提交，异常后另行追加失败分类，若断连只保留 STARTED/ACK_UNKNOWN，不能伪造“所有失败均已写入 DB”。维护系统级变更写入 owner-only 耐久 journal 并关联 control_events；无密码、Native 内容、原始数据库错误。私有结果 receipt 包含 resolution/grant/proof/window IDs、真实服务主体、前后状态/版本、所有来源 hash、LOCAL 标志和不发布/保留 orphan 的事实；不替代 DB 审计、不标 GITHUB_ACTIONS、不签发完整 enabled gate。

## 8. 必须产生的新增候选与定向验收

后续实现先产出未应用的 schema/guard/helper/ACL SQL、角色/bootstrap/admission/recovery 脚本清单、expected catalog/profile、installer/loader/issuer binding 变更和 receipt 模板。新增 receipt profile 为 terminal-reconciliation-local-v1；旧 content-enabled /只读 profile 不自动获得终态能力。installer 校验旧 ledger 字节后追加新版本，未知/部分安装 fail closed；不以重签 receipt 代替安装或 ACL 验证。

| 验收组 | 本地独立连接/进程必须验证的结果 |
| --- | --- |
| 允许矩阵 | Content RESERVED/UNKNOWN × prepare RESERVED/UNKNOWN 四组，均有 dispatch；原 active publication 有/无均保持不变；仅三行和精确审计/授权记录变化 |
| 真实授权 | 旧 Session/只读报告/安装 receipt 无权；越租户/越对象/错 refs/来源漂移/额外字段/撤销/TTL/重放拒绝；原 actor 撤权后经独立服务 grant 可取消，审计仍记录服务 |
| 串行撤权 | issuer 撤销先提交、finalize 先持锁两种顺序；service version、grant、resume 的同类竞争；无死锁反向拿锁，无开库与可提交处置重叠 |
| 迟到 writer | 原 dispatcher 在 markDispatch 后暂停；Native COMMIT 前/后暂停；Business 连接先死而 Native 仍活；双库全部排空后才证明，旧进程/凭据在恢复后均不能写 |
| Native 证明 / TR-03 | null/foreign owner/场景变化/全文差异/额外内容/版本错误/超时 KEEP；manifest 无效不调用 loadDocument；两个公共读取各有独立 READ COMMITTED READ WRITE BEGIN/COMMIT或ROLLBACK/release，无嵌套/共享 snapshot/no-op hook；持续 barrier 与同 epoch 保证稳定；READ WRITE 与 UPDATE(id) ACL 边界真实披露，adapter 拒绝写 SQL |
| proof 连接生命周期 / TR-03 | 每次重新 checkout lease，但仅用预登记物理 backend；事务完整结束才释放；释放后旧 lease 禁止 query；关库后无自动补连接/空闲淘汰；两次观察之间断连、barrier失效或epoch变化均 KEEP，不能注册可结算 proof |
| 数据与权限 | issuer/executor/runtime/PUBLIC 负向矩阵；service audit 冒名、孤立 resolution、缺任一 audit、半消费 grant、activation 回填、pointer 改动在 COMMIT 拒绝 |
| 崩溃恢复 / TR-02 | 每个关库/轮换/drain/proof/finalize/resume/bootstrap/takeover 边界注入崩溃；旧窗口仍正常阶段或 BLOCKED 两种起点；临时开放前后、接管 COMMIT 回执丢失、交接后关库前失败均按 §4.4 重入；每库恰有一个当前 claim，旧窗口不可复活；普通/旧维护凭据始终拒绝；新 epoch 重证，ACK_UNKNOWN 只查结果 |
| 原子交接 / TR-02 | 并发两个 takeover 只产生一个有效 successor；中途失败旧claim不丢失；无删除窗口、复用proof、重置CONSUMED grant或重复finalize；SUPERSEDED与CLOSED的 admission 后置条件分别验证 |
| 历史服务审计 / TR-01 | 处置后正常关闭窗口、等待grant过期、递增并撤销service、PG重启，再用当时有权runtime SAVE及新PUBLISH成功；旧resolution/audits/grant/proof不变；原active publication有/无两组；历史检查可读最近成功mutation与全部关联来源，允许resource/slot正常推进 |
| 历史读取与 ACK 查证 / TR-01 | runtime不可直接SELECT维护表或EXECUTE内部校验函数/新增服务audit；错tenant/错scope/孤立resolution/不匹配audit拒绝；旧处置secret无查询或写权；独立RESULT_LOOKUP或恢复授权可在service撤销/旧grant过期后查同一结果；NOT_OBSERVED不触发重放 |
| 来源和升级 | 已应用 migration bytes/aggregate 保持；新 ledger/profile/hash 精确校验；旧 profile/部分安装不能启用；存量隔离 cohort 除明确批准目标外不变 |

只跑受影响的本地 PG16 用例及必要 host 回归，不重跑同内容 GitHub CI。上述是**待验收标准，全部 NOT_RUN**；本文没有声称 SQL/ACL、断连恢复、Native proof 或终态路径已验证。

## 9. 当前证据、后续工作与开放门禁

基线 HEAD `daf63afa83470d24a9ed41d171c6a17f8a80adb6`，branch `refactor/zhiban-v2`，工作区含既有未提交候选，非 CLEAN。本轮仅补设计文档与索引。

现 implementation binding `fd4920297e1abeb499fd7690a9182127871e6a430b8a24795da092a1eaaf84f4`，已应用 content candidate aggregate `e335f83bb48cc6c4ec754f8e3270dc0e6941e14f38306bd67aa29844c3713324`。这些是现实现绑定，**不包括本文尚未实现的能力**。R1/R2 的 LOCAL 9/9、旧只读 20/20/host 5/5、旧产品/installer/撤权与历史 CI 证据均只保留各自 SHA/hash/范围，不能升级为终态处置证明。

本轮 TR-01–03 已修订并定向核对为 **ADDRESSED_IN_DESIGN**，详细映射见[复评修订记录](zhiban-v2-m5-terminal-reconciliation-review.md)。下一步生成未应用 SQL/helper/ACL/receipt/profile/bootstrap/recovery 候选并评审，随后才实现与本地验证。此状态只表示三个设计缺口已有闭环，不是冻结合同补充批准、SQL/ACL 门禁通过或实际处置授权。实际处置、未知/缺失 Native 的结算、在线 reconciliation、Native GC、完整 enabled gate、C PNG/D Runtime/E AI、生产 OPS/DATA 继续 deferred。NO COMMIT / NO PUSH / NO CI DISPATCH。

2026-10-12 初版复评发现 3 项 P2；R2 已原位修订 §4.4、§5、§6–7 和 §8 验收矩阵。运行验收仍全部 NOT_RUN，所有隔离保持。

2026-10-12 R2 候选产出：已生成[未应用 SQL/helper/ACL/receipt 与恢复计划候选清单](zhiban-v2-m5-terminal-candidate-inventory.md)，静态 9 组 PASS、PG16 grammar 可解析；全部 UNAPPLIED/UNISSUED/NOT_WIRED。live installer/loader、proof worker 与维护执行器仍待实现，未执行任何处置。
