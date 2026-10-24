# M5 SQL 四项修复与 LOCAL 定向验证

2026-10-09，分支 `refactor/zhiban-v2`，基线 `daf63afa83470d24a9ed41d171c6a17f8a80adb6`。

[SQL/receipt 评审](zhiban-v2-m5-sql-review.md)的 F1–F4 已修复。状态 `FIXED / LOCAL_PG16_FOCUSED_VERIFIED / DEV_UNAPPLIED`；不标 enabled Bridge signoff、D08 ACCEPTED 或 M5 产品闭环完成。

后续[状态矩阵复评](zhiban-v2-m5-state-matrix-review.md)复现 F2 相关的未登记 activation 缺口 SM-01 / P1；随后已[修复并更新 hash，PG16 53/53 PASS](zhiban-v2-m5-sm01-fix-local.md)。下述旧 hash 与 30 项仍保留其历史局部范围，不构成全矩阵通过。

## 1. 候选变更

- F1：新增反向检查，遍历资源的所有 deployment slot/ACTIVE generation。每个 ACTIVE 必须绑定完整成功发布和当前 content 指针；DRAFT 的 Bridge-only 首次激活不能 COMMIT。WITHDRAWN/SUSPENDED 保留 ACTIVE generation/history 仍合法。
- F2：每个资源 PREPARE_CONTENT 都必须关联一个 durable content reservation；RESERVED/OUTCOME_UNKNOWN 结算时必须已登记 prepare。content FAILED 的 prepare 引用仅允许 SUCCEEDED/FAILED，activation 引用仅允许 FAILED，任何未决引用保留 fence。允许 PREPARE 已知成功但未 activation 的安全取消，也允许 Bridge 已知失败后同事务终结 content。没有添加 reconciliation 权限或自动结果判断。
- F3：operations 新增 `expected_native_digest`，恰好 PUBLISH_CONTENT 非 NULL、闭合 hex SHA-256、不可变、不授 UPDATE。它由未来服务端从锁定草稿与已分配 refs 构造的精确 Native Document 计算，与 jsonb source_digest 分开；链接/发布检查要求 expected/generation/publication 三者一致。prepare 引用按 tenant 唯一，prepare 时间不得早于 content reservation，禁止其他 reservation 的旧 prepare 复用。
- F4：receipt 查询采集 `admin_option,inherit_option,set_option`。preflight 明确唯一 migrator→owner 为 FALSE/FALSE/TRUE，禁止其他 owner 边、migrator incoming/其他 outgoing 边。inventory 写入精确角色边模型。

`refresh-inventory.py` 仅更新候选 source/body/checksum bindings 和 UNISSUED 模板引用；不连接数据库、不签发 receipt。既有 Identity 0001–0013 及 Academic/Learning/Assessment 0001 bytes 不改。新逻辑仍在 docs 候选目录，没有接入 active runner 或 host。

当前 logical migration SHA-256：`17150c198cb72c7cfd23ddea4bd22e162fe6677ade9b5de84fab255991241e1d`。

当前 inventory SHA-256：`de54a4f88779c06d9e4e5a8bd9c67babf63fcd72efae4eb61ec9d4541bbc0256`。

初次生成/评审的旧 SHA 与 [历史静态证据](evidence/m5-sql-inventory-static.json)保留其原快照边界，不能当成当前 bytes 的核验。当前静态核验见 [m5-sql-fix-static.json](evidence/m5-sql-fix-static.json)，42 项 hash/来源/元数据通过；未安装 pglast，明确 syntaxParser=NOT_RUN。实际 SQL 已由下述 PG16 fixture 执行，未把静态检查冒充 ACL 实测。

## 2. 验证环境与结果

命令：`pnpm exec tsx scripts/zhiban-local/verify-m5-sql.mts`。

实际 PG16 `160015`、Node `v22.23.3`、pnpm `10.28.0`。脚本在 mkdtemp 创建私有目录（0700），initdb 独立 cluster、数据库 `zhiban_m5_disposable`、port 55439，仅私有 Unix socket，`listen_addresses=''`、host authentication reject；所有 psql/pg.Client 都显式绑定该 socket。装载原始 16 个 prerequisite migration、原角色 bootstrap，再执行真实候选 01/02/03，并使用 shipped BridgeRepository 的 reservation/mark/finish/activate primitives。没有修改 frozen fixture 契约或禁用 RLS/trigger。

00-preflight 的完整 exact dev target 在该 fixture 正确拒绝；角色边子句从原文件精确提取后单独验证，没有重写 dev 的端口/目录条件冒充正式 installer 通过。04 receipt 查询在真实 fixture 执行，确认 PG16 两项属性可采集。

[LOCAL 证据](evidence/m5-sql-fix-local.json) **30/30 PASS**（含实际候选 DDL 装载）。覆盖：

- role edge 正常/INHERIT TRUE/SET FALSE/额外 incoming owner 边；真正 helper FOR SHARE、10 列投影、Bridge raw Academic 写拒绝及 owner lock-only 真实写拒绝。
- structural ready 的 DRAFT 正例、NULL/错 tenant/未注册负例。
- Bridge-only 首发、另一 deployment 的未绑定激活、缺少 content audit 的原子回滚；完整发布成功；撤回保留历史成功。
- 未登记 prepare 的取消、dispatched RESERVED/UNKNOWN 仍不得释放 fence；fence 保留时保存拒绝；已知失败原子终结后保存成功；已知 prepared success/无 activation 的安全取消成功。
- 错 Native digest 在 COMMIT 拒绝、无残留 reservation/generation；摘要列 ACL 和触发器均拒绝改写（额外 UPDATE grant 只在 fixture 临时测试后撤销）；原精确 reservation 仍能成功完成；旧 prepare 跨 reservation 复用拒绝。

证据绑定当前 migration、runner、原 migration/bootstrap、Bridge primitives、lockfile bytes，并记录实际工具版本。所有连接在结束时关闭，cluster 停止、精确临时目录删除；首轮脚本异常遗留的已停止 fixture 也已核验 PG_VERSION/无 postmaster.pid 后清理。

## 3. 适用范围与下一步

这是 SQL/RLS/提交一致性的受限实测：synthetic actor 与受控 Bridge ledger 状态；Native provider 调用为 0。UNKNOWN→已知失败测试模拟可靠 outcome 事实，再调用既有 OUTCOME_RECONCILED 路径；它不证明真实 Native outcome 检查已经实现。fixture-only owner write probe 和额外 grant 都不进入候选 SQL/profile。

开发库 55433 与原测试 cluster 55432 未连接/未应用。receipt 继续 `LOCAL / UNISSUED / UNAPPLIED`，live catalog/Native/TLS bindings 均未签发。没有 commit/push/CI dispatch。

仍待：独立 installer 和精确 issuer/loader、实际 Native provisioning/outcome、同客户端 Session/Role/Scope/owner/assignment 并发撤权、M1–M4 新 profile 回归，以及真实 editor/preview/API/HTTPS/CSP 旅程。这些不能由本轮 30 个场景替代。

本记录完成时的下一步：对修复后的跨表状态矩阵做定向复评（现已完成并发现 SM-01，须先修复），然后推进 M5-A/B 本地 installer/启用 composition 与文本编辑、保存、发布页面；继续受影响 LOCAL 验证，无须重复 GitHub CI。复评建议 GPT-6 Astra high；常规实现建议 GPT-6.1 Sol medium。
