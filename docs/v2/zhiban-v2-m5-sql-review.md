# M5 未应用 SQL 与 receipt/profile 评审

2026-10-09，`refactor/zhiban-v2` / `daf63afa83470d24a9ed41d171c6a17f8a80adb6`。

初次评审结论：`NEEDS_REVISION`。发现 3 项 P1 发布一致性问题、1 项 P2 receipt 采集缺项；当前候选不进入应用或启用签收。评审只读候选与现有代码，新增本记录；未应用 migration、连接数据库、签发 receipt、修改冻结 migration、commit/push/dispatch CI。

后续更新：F1–F4 已修复并完成独立临时 PG16 **30/30** 定向验证，见 [修复与证据边界](zhiban-v2-m5-sql-fix-local.md)。以下保留原评审 SHA 的问题与定位，不代表当前修复候选仍未解决；开发库未应用、receipt 未签发，完整启用签收仍待。

评审绑定：logical migration SHA-256 `056986180058ee9d6888f310b652c590b79d2836b7644a567438c1129e6f44c4`，inventory SHA-256 `f8a17b3937ca5b6a8677515380a0ad36c496d97ed4378f6036fe1d63c6b62007`。以下是源码控制流反例，尚未在 PG 执行；不能表述为实测提交成功或已有线上漏洞。

## F1 / P1：首次 Bridge 激活缺少反向 publication 约束

定位：`candidates/m5-content/02-helpers-and-guards.sql:223–232`。

`link_consistency` 只有在 resource.active_publication_id 非 NULL 时才核对 Bridge active pointer；其后 history 检查也只遍历已经存在的 publication。对于已经合法创建且有 CREATE operation/audit 的 DRAFT，`last_publication_no=0`、空 history 均通过。此时若预留、准备、激活 Bridge generation 并写完 Bridge 自身 operation/audit，却遗漏 content publication、PUBLISH 成功结算及 resource pointer，新增的 deferred guard 仍没有拒绝条件。即使 content PUBLISH operation 仍是 RESERVED，带有 reservation audit 也符合当前检查。

结果：首发可以留下 Bridge ENABLED/ACTIVE 与 content DRAFT 分离的状态；数据库没有实现设计要求的同事务双向发布一致性。这个结论不等于已存在学生绕权 API；未来 read gate 仍应检查 content 状态，但不能用它替代数据库原子性。

修复：对本业务 resource 对应的 Bridge slot/current generation 做反向约束。DRAFT 不得有已激活映射；每个属于本内容能力的当前 ACTIVE generation 必须绑定完整 publication 与成功 content PUBLISH，并和 resource 当前指针及 PUBLISHED/WITHDRAWN 状态匹配。明确多 deployment slot 的约束，不能只检查当前 publication 指向的那一个 slot。

最小验证：完成合法准备后，只激活 Bridge 并保留 DRAFT/RESERVED，应在 COMMIT 失败；同事务补齐 publication/content pointer/terminal operation/audit 后成功；WITHDRAWN 的 suspended slot 保留 active generation/history 应继续成功。

## F2 / P1：FAILED 可以提前释放仍有未知 Native 结果的发布限制

定位：`candidates/m5-content/02-helpers-and-guards.sql:261–279`，结合 operation_guard 的 `:144–155` 以及 `01-schema.sql:129–130`。

prepare 引用检查完全不核验 Bridge operation.state；activation 引用只在 content SUCCEEDED 时要求 Bridge SUCCEEDED。因而 content RESERVED/OUTCOME_UNKNOWN 可在关联 PREPARE_CONTENT 仍为 OUTCOME_UNKNOWN（或已 dispatch 的 RESERVED）时转为 FAILED，填 completed_at 并增加 OPERATION_FAILED 审计；现有 state/source/link 条件没有拒绝这一组合。FAILED 一旦提交，partial unique index 和 resource_guard 都不再把该 operation 视为未决发布。

结果：上一次 Native 结果未决时，后续保存/发布命令已可进入；改变 slot revision 还可能使旧操作无法按精确 reservation revision 结算。仅在注释中要求服务端 reconciliation 不能保证这条跨表状态不变量。

修复：为 content 与关联 Bridge 操作定义明确的允许状态矩阵。content 终结 FAILED 前必须证明没有仍在 dispatch/unknown 的关联操作；必要时同事务终结 Bridge，再释放 content fence。PREPARE 已确定成功而 ACTIVATE 明确取消/失败的可终结情形要单独列出，不能粗略要求所有 Bridge 引用都是 FAILED；授权检查仍由既有 guard 执行。

最小验证：Bridge PREPARE 为 dispatched RESERVED、OUTCOME_UNKNOWN 时，content 单独改 FAILED 必须拒绝并保留 fence；已知失败/安全取消的合法原子终结应成功；其后才能接受新的保存/发布。

## F3 / P1：发布源版本没有绑定预期 Native 内容摘要

定位：`candidates/m5-content/02-helpers-and-guards.sql:243–256` 与 `01-schema.sql:105–108`。

当前只分别核对 `co.source_digest = 当前 draft 的 jsonb 摘要` 和 `generation.content_digest = publication.content_digest`，两组摘要之间没有持久化的预期投影绑定。prepare 引用可登记同资源、同 actor 的既有 PREPARE_CONTENT，也没有专属于 content reservation 的唯一关联。

反例：草稿 A 已成功 prepare 到仍未发布的 generation G，随后该 content 发布被合法取消；教师保存草稿 B 并建立新的 content operation（source_revision/source_digest 都正确对应 B）。如果错误地登记旧 prepare/G，再新建 ACTIVATE 并把 G.content_digest 复制到 publication，当前检查仍允许 publication 记录 B 的 title/source_revision，而实际 Native 内容为 A。单纯保证 prepare/activate 同 generation 不能排除这个情况。

修复：在当前 source revision 的发布 reservation 中保存服务端从精确草稿与已分配 refs 构造的预期 Native digest，并保持不可变；链接/结算须同时核对它、generation digest、publication digest 与对应 prepare。禁止把其他 content reservation 的 prepare 偷换过来。两个不同编码域的摘要仍应分开，不能直接比较 jsonb 摘要与 Native 摘要。

最小验证：保留 A 的合法 prepared generation，保存 B 后试图绑定 A 应拒绝；B 的正确投影成功；同一 reservation 的精确恢复仍允许，跨 reservation 的旧 prepare 复用拒绝。

## F4 / P2：receipt 角色边遗漏 PG16 的 INHERIT/SET 属性

定位：`candidates/m5-content/04-receipt-inspect.sql:8–11`。

该查询只采集 member/granted_role/admin_option，遗漏 `inherit_option` 与 `set_option`。既有 `bootstrap-roles.pg16.sql:110–126` 明确要求唯一 migrator→owner 边为 ADMIN FALSE、INHERIT FALSE、SET TRUE。仅改变 INHERIT 或 SET 后，这份 receipt 查询输出仍相同；当前 preflight 也没有完整校验该 incoming owner 边。旧 bootstrap 是建环境时的检查，不是新 receipt 的持续只读核验器。

修复：在采集与精确期望 profile 中包含两项 PG16 属性和完整受保护角色边集；明确复用哪个只读 baseline verifier、其输出/版本/hash，或把所需核验落实到新 issuer/loader。不能只要求“旧 receipt 通过”而不核对当前角色图。

最小验证：分别改变该边的 INHERIT/SET，必须导致 preflight/签发或启动精确核验拒绝；合法原边通过。新加 incoming owner/runtime 边也必须拒绝。

## profile 差异与证据处置

下列方向正确，继续保留：同一 bridge business client、无新 LOGIN role、无 Bridge 原始 Academic DML；四个 Academic 父表各新增 owner SELECT 与 WITH CHECK(false) lock-only UPDATE policy；其他表仍旧 profile；PUBLIC content 权限撤销；旧已应用 source/ledger 不改；receipt 明确 LOCAL/UNISSUED，live fingerprint 为 null。

旧 M2 loader 的单 policy/bool_and 条件会拒绝新 profile，这已经在候选明确列为待实现事项，不重复当成新增缺陷。新 loader 必须 exact-match 两种 profile，content 启用只接受新 profile。旧 Bridge 整体 fingerprint 不能签收新 gate/trigger/content ACL；旧 foundation/native 证据仅在未变对象与协议范围保留。

本次重跑离线 verifier：42 项来源/hash/元数据检查通过，语法解析为 NOT_RUN（先前临时 pglast 已清理）。历史静态证据的 64 项和 PG16 parser 检查保持原文件，未改写为本轮实测；它们证明语法与来源，不证明上述事务不变量。未增加 PG/Native/HTTPS 验证结论。

下一步：修复 F1–F4 的未应用候选和 receipt/profile 模型，重新生成 hash，随后按明确本地应用范围完成最小 PG16 正负例及实际文本闭环；不安排重复 GitHub CI。定向修复建议 GPT-6.1 Sol medium，跨表状态矩阵复评建议 GPT-6 Astra high。
