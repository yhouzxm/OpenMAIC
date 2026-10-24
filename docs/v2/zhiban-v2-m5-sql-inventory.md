# M5-A/B SQL / helper / ACL / receipt 清单

2026-10-09。分支 `refactor/zhiban-v2`，基线 `daf63afa83470d24a9ed41d171c6a17f8a80adb6`。当前 M1–M4 未提交增量保留；worktree 不是 CLEAN。首次生成仅产出文件与离线检查；后续四项修复已在自建临时 PG16 fixture 执行候选验证。未连接或应用开发库/既有测试库，未签发 receipt、改 host/active runner 或 commit/push/dispatch CI。

评审/修复更新：初次 [评审](zhiban-v2-m5-sql-review.md)的四项问题已修复并更新 hash，独立临时 PG16 **30/30 PASS**；见 [修复记录](zhiban-v2-m5-sql-fix-local.md)。后续 SM-01 activation 反向绑定已修复，当前候选 hash 与 **53/53 PASS** 见 [最新记录](zhiban-v2-m5-sm01-fix-local.md)。上述为当时证据。2026-10-09 后续已获本地实现授权，由 installer 在专用开发库应用相同 e335… SQL；技术 receipt 与文本闭环验证见 [本地交付记录](zhiban-v2-m5-ab-local-closeout.md)。完整启用签收及生产授权仍未完成。

选型依据：[M5-A/B 精确设计](zhiban-v2-m5-ab-design.md)、[gate / 发布协调 ACL / 局部 CSP 评审](zhiban-v2-m5-enablement-review.md)。状态 `UNAPPLIED_CANDIDATE`，不是 `BUILD_READY`、`D08_ACCEPTED` 或 enabled Bridge signoff。

## 1. 文件与应用边界

候选目录 [candidates/m5-content](candidates/m5-content/README.md) 不在既有 active migration directory。后续新增显式本地 installer；运行时仍无自动 DDL。logical migration 名 `0001_content`，一次显式事务按 01→02→03 执行，ledger checksum 为这三个文件原始 UTF-8 bytes 按该顺序直接拼接的 SHA-256（不含路径、额外分隔符、preflight 或 inspect）。不能单独应用 helper 或 ACL。

| 文件 | 作用 | 当前状态 |
| --- | --- | --- |
| [00-preflight.sql](candidates/m5-content/00-preflight.sql) | exact LOCAL dev cluster、PG16、READ COMMITTED、既有角色/ledger shape/closed gate/Academic profile 检查；不代替来源和完整 ACL 检验 | 开发库未执行；临时 fixture 定向验证 |
| [01-schema.sql](candidates/m5-content/01-schema.sql) | content ledger、四张业务表、受限草稿验证、复合 FK、幂等与 unresolved publish fence | 开发库未执行；临时 fixture 定向验证 |
| [02-helpers-and-guards.sql](candidates/m5-content/02-helpers-and-guards.sql) | business lock helper、structural ready、mutation guards、跨 content/Bridge deferred link guards | 开发库未执行；临时 fixture 定向验证 |
| [03-acl.sql](candidates/m5-content/03-acl.sql) | FORCE RLS、精确对象/列授权、Academic owner read/lock policies、PUBLIC 撤权 | 开发库未执行；临时 fixture 定向验证 |
| [04-receipt-inspect.sql](candidates/m5-content/04-receipt-inspect.sql) | 未来私有 admin 的只读 catalog/ledger 采集输入；不参与 migration checksum | 开发库未执行；临时 fixture 定向验证 |
| [inventory.json](candidates/m5-content/inventory.json) | 文件/既有 migration hash、函数签名/投影/安全配置/body hash、精确 ACL 与 profile 清单 | 静态候选 |
| [receipt.template.json](candidates/m5-content/receipt.template.json) | `UNISSUED / UNAPPLIED` 模板；actual fingerprint、安装时间、批准引用、验证结果保持 null/NOT_RUN | 未签发 |
| [verify-static.py](candidates/m5-content/verify-static.py) | 离线 hash/边界检查；可选 PG16 pglast 语法解析，不触达数据库 | 已运行，结果见静态证据 |

Identity 0001–0013 逐文件与当前 HEAD 比较；Academic/Learning/Assessment 0001 为现有未提交文件，记录当前 bytes hash，未来 installer 必须与真实已应用 ledger/原 receipt 比较。本次未读数据库，因此不声称已证明其 live ledger。全体旧 migration 未修改。

## 2. schema 与必要设计补充

`resources` 为 mutable draft/CAS 和当前发布指针；`publications` 为 immutable history/Native generation 来源；`operations` 为 durable 命令/幂等事实；`audit_events` 为 append-only 闭合审计。revision 为正 signed-int8；最大值拒绝，真实变化 +1，no-op 先拒绝 stale，成功后不写 resource。WITHDRAW no-op 仅适用于已经 WITHDRAWN 的资源。

为把现有设计落实成可核对约束，候选明确增加（尚待 SQL 评审，不是冻结设计的静默改写）：

- publications 分别保存 `prepare_operation_id` 与 `activation_operation_id`，两者都须匹配同 tenant/slot/generation/actor 且 SUCCEEDED；成功 prepare 不构成成功发布。
- operations 增加 closed `action`、`source_digest` 与独立 `prepare_operation_id`。`bridge_operation_id` 表示 ACTIVATE_GENERATION 或 WITHDRAW 的 SUSPEND，不复用为 prepare。保留 `source_revision`、不可变 `expected_native_digest`、命令 key/intent digest 和 result publication/revision。
- `source_digest` 是 PostgreSQL `sha256(convert_to(draft::text,'UTF8'))` 的 jsonb snapshot 摘要。它不是命令 intent 摘要，也不是 Native Document/content 摘要；未来服务端从同客户端 SQL 取得，不能用 JS JSON.stringify 假定等价。
- 所有资源 prepare 必须绑定 content reservation；prepare 按 tenant 唯一，时间不得早于 reservation，generation digest 必须等于预期 Native digest。一资源最多一个 RESERVED/OUTCOME_UNKNOWN publish；该 fence 存在时拒绝保存、撤回及新命令。它不冒充 Runtime active-operation fence；未撤回的旧 publication 按当前授权继续读。失败/未知要持久审计，只有新鲜授权的精确 reconciliation 才能结束，不自动清理、抢占或转移 owner。
- 所有资源 ACTIVATE_GENERATION 在提交时须恰好绑定一个同 tenant/resource 的 PUBLISH_CONTENT，其 prepare 与 activation 的 slot/generation 一致；涵盖 RESERVED/OUTCOME_UNKNOWN，防止未登记 activation 绕过 fence。
- RESERVED 可单调登记一次各 Bridge 引用，不能清空/替换；状态只可 RESERVED→UNKNOWN/terminal、UNKNOWN→terminal。operation_guard 在锁 resource 后复核源版本与摘要。FAILED 结算不能留任何关联 Bridge 未决结果；prepare 允许已知 SUCCEEDED/FAILED，activation 仅允许 FAILED。SQL 不提供管理员 reconciliation API。
- `COMMAND_NOOP` 审计记录成功无变化的 SAVE/WITHDRAW；真实 mutation 按 resource/result_revision 唯一。创建 resource、CREATE operation、审计须同事务完成。
- `lock_business_context` 的 resource 参数仅 CREATE/TEACHER_WRITE 允许 NULL；所有其他路径要求真实 resource。未来服务端必须将 NULL 限于 CREATE，不能用它跳过既有资源检查。

内容 DTO 是闭合纯文本结构：1–32 slides，每页最多 32 文本框，UUIDv7 全局唯一，960×540 有界整数几何，标题 1–120/正文 ≤2000 UTF-16 units、拒绝 `<>&` 和不允许的控制字符，SQL jsonb 文本大小 ≤256 KiB。HTTP/body 原始字节、Unicode 和 Native Document 编码仍需服务端验证，SQL 不替代它。

## 3. helper / gate 与锁边界

| 对象 | 权限/投影 | 要求 |
| --- | --- | --- |
| content.lock_business_context(uuid,uuid,uuid,uuid,text) | VOLATILE SECURITY DEFINER，owner=identity_owner，row_security=on，fixed search_path；仅 bridge EXECUTE；10 列 closed projection | session_user=bridge、tenant/UUID/action 校验；Offering→Course→当前 assignment/enrollment FOR SHARE；返回锁定事实，不给 Role/Scope/Session 授权 |
| bridge.business_resource_ready(uuid,uuid) | 原 owner/签名/STABLE/SECURITY INVOKER/search_path/proacl 保留；仅替换 body | tenant/context/UUIDv7 +真实 SLIDE_CONTENT/content-text-v1 resource；DRAFT/WITHDRAWN 也可 structural ready；不是已发布/授权/visible 判断 |
| content.utf16_length / valid_draft / draft_digest | IMMUTABLE STRICT SECURITY INVOKER，fixed search_path；bridge EXECUTE | SQL 防线与源摘要 |
| resource_guard / operation_guard / publication_guard / append_only | SECURITY INVOKER；无 runtime direct EXECUTE | 不变字段、CAS、源版本、state machine、不可变历史 |
| content.link_consistency | SECURITY DEFINER / owner / row_security=on / fixed search_path；无 runtime direct EXECUTE | COMMIT 重新读最终 rows；四张 content 表和 Bridge slots/generations/operations 附加 deferred trigger；pointer、provenance、terminal operation/audit 一起核验 |

Identity helper 的 session_user 限定、13 列 closed projection、相关 participant 上限和冻结代码不改。每个本地阶段同一 bridge client/READ COMMITTED；先 Identity guard 锁 actor+canonical owner，再业务父关系、resource、slot、generation、operation。canonical owner 保持 created_by，inactive owner 拒绝。Native 私有连接使用原协议，跨库不是 ACID；本地 pointer/audit 全回滚不意味着 Native bytes 没有提交。

## 4. 精确 ACL / profile 差异

不新增 LOGIN role、不改原 runtime role、不授新 role membership、Native CONNECT 或 Academic raw DML。新对象均 owner=identity_owner；PUBLIC 无 content schema/table/function 权限。schema USAGE 仅授 bridge。

- 四张 content 表：bridge SELECT/INSERT；resources UPDATE 仅 `title,draft,state,revision,active_publication_id,last_publication_no,updated_by,updated_at`；operations UPDATE 仅 `state,prepare_operation_id,bridge_operation_id,result_publication_id,result_revision,completed_at`。无 DELETE/TRUNCATE/REFERENCES/TRIGGER/DDL。ledger 仅 SELECT，installer owner 插入 checksum。
- content 四表 FORCE RLS：`content_read` SELECT 给 bridge+owner，`content_insert` INSERT 给 bridge；resources/operations 另有 `content_update` UPDATE 给 bridge。谓词都要求 session_user=bridge 和当前 tenant。owner 没有 content UPDATE policy，也不需要 content row lock 来跑只读 consistency。
- Academic courses/offerings/assignments/enrollments 原 `tenant_scope` 不改；各增加两个仅 owner policy：`content_owner_read` SELECT 和 `content_owner_lock` UPDATE，USING 同样 bridge session/tenant、lock 的 WITH CHECK=false。owner FOR SHARE 可取得锁，实际写入被拒绝。其他七张 Academic 表仍恰好原 policy。
- receipt 支持两种精确 Academic profile：`academic-v1-closed`（全部仅原 policy）或 `academic-v1-content-enabled`（仅指定四表各多准确两个 owner policies）。不能 count≥1/忽略新增权限；content 启用必须选择后者且 Bridge manifest 精确匹配。
- Bridge 旧总体 fingerprint 不再适用于未来应用后的环境；旧 foundation/native 证据只在未变对象/协议范围保留。旧 foundation root 仍拒绝业务；新启用 composition 与 loader/receipt verifier 尚未实现。

## 5. receipt / installer 待办与证据边界

模板 `evidenceOrigin=LOCAL`，不设置或伪造 GITHUB_ACTIONS。静态候选 source/hash 可填写；live catalog fingerprint、Native provisioning/deployment fingerprint、real source pin/artifact binding、TLS/CSP host 验证结果均未测得。模板不能作为启动凭证。

未来显式 installer：先核验私有 admin 连接的 exact dev cluster（55433/zhiban_m1_dev，绝不误用 55432 test cluster）、旧 receipt/角色及每条 ledger 对应 source bytes→BEGIN READ COMMITTED→00 preflight→SET LOCAL ROLE owner→01/02/03→用精确 aggregate SHA 插入 content ledger→COMMIT。任一步失败全事务回滚，包括 ready body；不能先开放 gate 再补 ACL。重跑必须先 exact ledger+catalog+receipt 验证，未知 schema/drift 拒绝，不 reset/rewrite ledger。

签发新 receipt 前，按 inventory 的期望模型逐项核对 query 输出与旧 profile 差异，再对排序/规范化后的完整 catalog manifest 求 hash；不要把当前采集值直接当期望并自证。显式包含 table/column/function/schema/database ACL、default ACL、roles/membership、FORCE RLS、policy role/command/predicate/WITH CHECK、函数 body/security/search_path/proacl、constraint/index/trigger 和旧 Identity ledger。Native 的原独立 catalog/角色/provisioning verifier 必须继续通过并绑定 deployment。私有 receipt 文件 0600，无密码/DSN/session/token。

**已受限验证：** fixture 中真实 PG16 DDL、helper owner RLS/禁止实际写、NULL/错 tenant gate、audit/link 原子回滚、未决发布限制、摘要来源绑定、PG16 角色边变化。**尚未验证：** 实际认证/撤权/CAS 并发、真实 Native 成功本地失败与 outcome 检查、startup drift/旧 receipt 拒绝、M1–M4 新 profile 回归、实际 editor/preview HTTPS/CSP。link_consistency 当前按单资源扫描 history，真实负载与重复 deferred callbacks 成本需实现时实测；本轮不声称性能验收或全集权限证明。

当前静态检查见 [m5-sql-fix-static.json](evidence/m5-sql-fix-static.json)，PG fixture 证据见 [m5-sql-fix-local.json](evidence/m5-sql-fix-local.json)；初次 [静态证据](evidence/m5-sql-inventory-static.json)仅适用于旧 hash。离线解析不解析真实 catalog/type/权限，不等于执行 migration；已有 D08 7/7、CSP 9/9 仅证明原隔离包/host范围，未扩展到 SQL。

下一步：在明确的本地应用范围内实现 installer/启用 composition/文本保存发布页面并做受影响 LOCAL 验证，无须重复 GitHub CI。建议这轮跨 schema 权限/事务评审使用 GPT-6 Astra high，常规实现使用 GPT-6.1 Sol medium；这是按任务风险选择，并非统一固定 high。
