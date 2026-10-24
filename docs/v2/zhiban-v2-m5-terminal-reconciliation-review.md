# M5 终态处置设计定向复评

日期：2026-10-12。范围：[终态精确设计](zhiban-v2-m5-terminal-reconciliation-design.md)的服务审计例外、停写/恢复协议、Native 证明权限。初版结论：`DESIGN_CHANGES_REQUIRED / 3_P2_OPEN`；R2 修订后当前状态为 `3_P2_ADDRESSED_IN_DESIGN / PENDING_SQL_REVIEW / KEEP_ALL_FENCES`。以下是未实现设计的可执行性缺口，不是已上线终态接口的漏洞；不授权生成后直接应用 SQL 或执行处置。

## TR-01 / P2：区分当前写入授权与历史服务审计校验

位置：设计 §7.2，第 133–135 行；关联 §7.1 的 FORCE RLS、§7.3 的结果查询。

设计将例外描述为“服务分支核验当前事务精确 grant/resolution”，新增 owner policy 也仅描述 grant 对应对象。它没有定义恢复普通 runtime 后如何读取、校验已提交 resolution，也没有区分写入时的有效 grant 与永久历史证明。

这不是只在插入 audit 时发生的检查：[content.link_consistency](candidates/m5-content/02-helpers-and-guards.sql) 第 299–345 行会在后续同资源写入时扫描全部 Content operations，确认每笔终态仍有匹配审计；第 349–354 行还要求原最近成功 mutation 的凭据。Bridge [mapping_consistency](../../lib/zhiban/infrastructure/identity/postgres/migrations/0013_openmaic_bridge_consistency_fix.sql) 第 37–49 行也扫描 slot 历史。新 schema 为 FORCE RLS，不能依靠 SECURITY DEFINER owner 自动穿透。

反例：服务完成取消，grant CONSUMED、window CLOSED，随后服务 version 递增或撤销；正常用户 SAVE/PUBLISH 再次触发历史检查。若服务审计例外依赖当前服务 session/有效 grant，或 owner 在 runtime session 下看不到 resolution，合法历史无法通过，资源仍不能恢复正常使用。把原 actor 等值检查保留给整个 runtime 分支也会拒绝新服务 audit。反之，为了避免拒绝而无条件接受 SERVICE_RECONCILE，则丢失所需绑定校验。

最小修订：将检查拆成两层。新增服务写入必须验证当前 session、grant/window、完整处置条件；所有调用者下的历史一致性只校验不可变 COMMITTED resolution、消费凭据、真实服务 audit 与精确终态关系，不重新要求当前服务 ACTIVE、旧 grant 未过期或旧窗口仍开放。列明仅供一致性函数使用的 tenant/resource 历史 SELECT policy，包含原成功 mutation、原 active publication 及其 Bridge 来源；写权限仍只覆盖目标三行。结果查询也需独立只读权限规则，不能以过期写授权为由丢失 COMMIT 结果查证能力。

验收增量：处置后关闭窗口、过期 grant、撤销 service，再以普通 runtime 保存并新发布成功；旧 resolution/audit 不变。错 tenant、孤立/错绑历史记录仍拒绝，runtime 不能新增服务审计或直接读取其他资源维护信息。

## TR-02 / P2：BLOCKED 窗口与新 epoch 的唯一占用交接未定义

位置：设计 §4.2，第 68、75 行；关联 windows/数据库占用的唯一约束（第 121 行）。

异常转 BLOCKED，所有非 CLOSED 窗口继续占用 deployment 和 cluster/DB 唯一键；恢复又要求新建 epoch。当前状态机只列出正常的 RESUMING→CLOSED，没有 BLOCKED 的退役转换、旧 claim 的原子交接、该转换的授权/helper 与审计。因此控制器在双库关闭后崩溃，重新建立维护连接后仍不能合法插入新 window；强制删除旧行或绕过唯一键会破坏审计和双控制器排斥，借普通 RESUMING 流程提前恢复 admission 也不符合故障恢复目的。

最小修订：增加明确的恢复接管转换（例如旧窗口 SUPERSEDED，并记录 successor，或区分“关闭 ledger 窗口”与“重新开库”），在管理层已确认旧 backend 消失、普通 admission 仍被拦截后，由专用恢复入口在一个 Business 事务中锁旧 window/claims、作废未消费授权、保留已提交 resolution、转移占用并创建新 epoch。定义各崩溃点如何依据 durable journal 和 catalog 重入；不得删除旧窗口、复用旧 proof、重置 consumed grant 或自动重放 finalize。正常恢复服务与维护接管必须有不同的 admission 后置条件。

验收增量：双库关闭后控制器崩溃、Business 结算已提交但回执丢失、接管事务前后再崩溃；每次最多一个占用者，新 epoch 可建立，旧凭据/旧执行器不可恢复权限，历史已提交结果可查且没有重复终态。此项不是请求执行真实停服测试，本轮全部 NOT_RUN。

## TR-03 / P2：同一外部事务的 Native 读取方案违反当前公共 seam 合同

位置：设计 §5，第 85 行，及验收表的“两个公共读取同快照”。

[PgDocumentStoreOptions.withTransaction](../../packages/@openmaic/storage/src/document/pg.ts) 第 58–62 行要求每次调用取得连接、开启事务、提交/回滚并释放；文件第 9–12 行还声明 READ COMMITTED 假设。实际 `loadDocument` 第 821–825 行和 `readFreshnessManifest` 第 828–842 行都会调用 transactionHook，要求不限于写方法。

设计要求先开一个外部 RR READ WRITE 事务、两次公共方法共用同一 pinned queryable/snapshot，却将新事务约定描述成“公共写方法”的要求。按公共合同实现 hook 会得到两次独立事务；按本文同快照方案实现 hook 则必须绕过该约定，或发生嵌套 BEGIN/提前 COMMIT。不能同时声称无上游合同变化和已满足该方案。

最小修订建议：在已经证明且持续有效的双库停写屏障内，顺序运行两个独立的 READ COMMITTED 事务，每次完整履行公共 hook；manifest 非空后才允许 ID-only document 读取。证明中的一致性依据是两次调用之间无 writer，明确记录两个事务观察值及屏障 epoch，不再声称同一快照。维护连接池需只使用预登记存活 backend、独立 checkout/事务、禁止自动补新连接或空闲淘汰；连接丢失即废弃本次证明。若坚持同快照，须另行批准支持它的公共 API 合同，不能静默使用 no-op hook。

现有只读报告每次外层快照仅调用一次 manifest，未取得完整文档证明；其历史测试不能证明本设计的两次调用合同成立。本项不要求在此次评审中修改已有只读实现或上游包。

验收增量：两个公共方法各有完整 BEGIN/COMMIT/释放周期；无嵌套事务；关库后不会尝试新连接；manifest null/错 owner 不调用 loadDocument；两次读取之间 barrier 失效即 KEEP；只有完整逻辑文档 hash 相等才可能登记 proof。

## 三个方向中可以保留的决定

服务审计保留原 USER operation，使用真实 SERVICE_RECONCILE audit/resolution，不伪造原教师；prepare 成功与取消未发布业务命令分开表达；slot/publication 不变。这些语义可保留，TR-01 补的是历史可持续校验。

停写覆盖双库、关闭 admission、排除全部非允许 backend、拒绝 prepared/background writer、轮换旧 writer 凭据、恢复前先废止处置能力，足以作为本地离线方案的设计方向。TR-02 补的是故障接管闭环，不建议退回仅使用资源锁/超时的方案。

Native 公共读取所需五张表的 SELECT 与 stages 的 UPDATE(id) 均已在清单中；manifest 提供 owner 门禁，loadDocument 为 ID-capable。设计明确披露 UPDATE(id) 是实际写权限，完整文档证明信任绑定的本地 worker/封闭 adapter，并非数据库强制只读或恶意 OS owner 防御。这个信任边界没有被包装成更强保证，不另列缺陷；仍须在未来 SQL/adapter 候选中核对精确 grant、语句和参数约束、凭据隔离、无可调用写方法，以及错误路径不进入 finalize。TR-03 修订前 Native 证明路径不能标为可实现性通过。

## 证据范围与后续

核验 branch `refactor/zhiban-v2`、HEAD `daf63afa83470d24a9ed41d171c6a17f8a80adb6`；工作区仍有既有未提交候选。读取设计、现有 Content/Bridge SQL、Storage 公共实现及 receipt profile；未连接数据库，未启动/停止 host/cluster，未改变角色、ACL、migration 或 receipt/hash，未执行终态路径或 CI。格式/链接检查只证明文档有效，不是运行测试。

下一步只修订 TR-01–03 的设计和验收矩阵，再定向确认这三项关闭，然后生成未应用 SQL/helper/ACL/receipt 候选。建议修订使用 GPT-6.1 Sol / medium；若后续审核新增 SQL 的跨表权限与并发屏障，可使用 GPT-6 Astra / high。现有本地/历史 CI 证据保留原适用范围，完整 enabled gate 与终态执行继续 deferred。NO COMMIT / NO PUSH / NO CI DISPATCH。

## 2026-10-12 R2 修订与定向核对

上文问题及原行号保留为初版评审记录；当前设计已原位修订，引用应按小节定位。本轮仅文档修订及对照核对，以下状态不表示独立 SQL 评审或运行验收已通过。

| 项目 | 修订位置与闭环 | 当前状态 |
| --- | --- | --- |
| TR-01 | §7.2 分开当前写入授权和永久历史校验，列出完整历史 SELECT 闭包/owner RLS 边界；旧服务版本取历史授权事件，不依赖当前 ACTIVE/TTL/window；不会将旧资源快照与新资源整行比较。§7.1/7.3 新增独立 RESULT_LOOKUP 权限与只读 helper，ACK 查询不需要旧写 grant 活跃 | ADDRESSED_IN_DESIGN；SQL/ACL/运行待验 |
| TR-02 | §4.4 明确 BLOCKED→SUPERSEDED、successor/predecessor、epoch counter 和双库 claims 同事务交接；正常 CLOSED 释放 claims 与接管保持 admission 阻断分开。列出临时 admission、旧维护凭据/backend 排空、接管前后及 COMMIT 回执丢失的重入规则 | ADDRESSED_IN_DESIGN；故障注入待验 |
| TR-03 | §5 两次公共读取分别履行 READ COMMITTED READ WRITE checkout/BEGIN/COMMIT或ROLLBACK/release；只复用预登记物理 backend，独立 lease；持续 barrier 代替同快照承诺；proof 记录两次观察与前/中/后 barrier，连接丢失即 KEEP | ADDRESSED_IN_DESIGN；adapter/ACL/运行待验 |

§8 已同步历史撤权后正常 SAVE/PUBLISH、独立结果查证及跨租户负向、原子接管/双控制器/崩溃重入、Native 独立事务及释放后 query/关库后补连接等验收行，全部 NOT_RUN。proof 保持 append-only，以 resolution.proof_id 唯一约束消费，避免“不可变证明同时 UPDATE 消费状态”的歧义。

定向核对：Storage pg.ts 文件合同及两个公共方法均调用 transactionHook；Content link_consistency 的历史扫描/最近成功 mutation 要求已纳入读取闭包；活动窗口唯一谓词排除 CLOSED/SUPERSEDED，claim 交接与 epoch 递增在同一事务；历史校验不重新依赖旧 postmaster/服务/授权有效期。文档格式和链接检查通过。未读取本机凭据、连接数据库、改代码/SQL/ACL/receipt/hash、启动停服或执行结算；所有原证据保留其适用范围。

下一步生成未应用 SQL/helper/ACL/receipt/profile 与 bootstrap/recovery 候选，对新增合同补充和候选逐项评审。建议候选实现使用 GPT-6.1 Sol / high；并发与权限的最终复评使用 GPT-6 Astra / high。NO COMMIT / NO PUSH / NO CI DISPATCH。

2026-10-12 已生成[SQL/helper/ACL/receipt 与恢复候选](zhiban-v2-m5-terminal-candidate-inventory.md)。TR-01–03 从设计进入未应用候选，尚未对本批 SQL 作独立权限/并发复评；下一步评审候选及新 profile 差异。静态解析/离线计划证据与原 LOCAL/CI 证据分别保留，运行门禁仍未通过。

2026-10-12 已完成[候选 SQL/profile 定向评审](zhiban-v2-m5-terminal-sql-review.md)：`CHANGES_REQUIRED / 3_P2_OPEN`，TSQL-01–03 需先修复。TR-01–03 的设计修订状态保留，但不表示候选 SQL 或运行门禁通过；隔离保持。

2026-10-12 [TSQL-01–03 R3 修复](zhiban-v2-m5-terminal-sql-r3-fix-local.md)已完成：候选待复评，静态 12 组与 scoped 临时 PG16 26/26 PASS；不自动关闭完整运行门禁或解除隔离。
