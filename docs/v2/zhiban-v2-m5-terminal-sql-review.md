# M5 终态候选 SQL/profile、服务审计与接管屏障定向评审

日期：2026-10-12。初版结论：`CHANGES_REQUIRED / 3_P2_OPEN / KEEP_ALL_FENCES`；R3 复评为 `TSQL_01_03_CLOSED / 1_P3_TEST_EVIDENCE / KEEP_ALL_FENCES`。范围为未应用的 terminal 候选、R2 设计及当前 Content/Native receipt profile。以下是候选闭环缺口，不是已启用接口的漏洞；本轮未修改 SQL、ACL、hash 或 receipt，也未授权安装/维护/终态处置。

核验 branch `refactor/zhiban-v2`、HEAD `daf63afa83470d24a9ed41d171c6a17f8a80adb6`。工作区包含既有未提交修改与候选，非 CLEAN。

## TSQL-01 / P2：接管 ACK_UNKNOWN 缺少 controller 可调用的窗口查证接口

位置：[recovery-plan.py](candidates/m5-terminal/recovery-plan.py) 第 77–85 行；[07-acl.sql](candidates/m5-terminal/07-acl.sql) 第 50–59 行；[04-control-and-lookup.sql](candidates/m5-terminal/04-control-and-lookup.sql) 的 takeover_blocked_window/read_recovery_result。

计划要求接管 COMMIT 回执丢失后，新 bootstrap 按 takeover_request_id、successor 和 claims 查证。controller 没有这些表的 SELECT 权限，获授的 helper 中也没有窗口状态查询；read_recovery_result 只查业务 resolutions，不返回接管结果。takeover_blocked_window 又拒绝 CLOSED/SUPERSEDED 的 old window，不能靠重试同一调用识别先前已提交的 successor。

具体反例：A→B 接管已提交，但 ACK 丢失且控制器退出。新 bootstrap 仍只有 A/B/request 的 journal；按原参数再次调用会因 A 已 SUPERSEDED 拒绝。它也无法在现有受限 SQL API 内验证 B 与双库 claims 后再选择 B→C。计划中的文字 GATE 未给出可执行的授权接口；直接增加表 SELECT 或改用管理员读取会扩大既定控制器权限边界。

最小修复：增加独立 controller-only、当前 deployment/backend capability 保护的窗口查证 helper，按 request/old/new 精确绑定返回脱敏的提交事实、双向边、epoch、当前 claims 和后继状态。明确区分“本次交接已提交”与“该 successor 仍为当前占用”；后者可能已再次被接管。计划在再次写入前使用该查询选择路径。不能将 NOT_OBSERVED 当成自动重放终态的依据。

验收：接管提交前断连、提交成功但 ACK 丢失、B 已再次交接到 C、错 deployment/request/old/new、两控制器竞争。controller 无原始表 SELECT；已提交交接可查；旧窗口不复活、epoch 只增、finalize 不重放。运行验收仍 NOT_RUN。

## TSQL-02 / P2：新增权限未全部进入候选 live catalog 采集范围

位置：[09-catalog-inspect.sql](candidates/m5-terminal/09-catalog-inspect.sql) 第 3–17、26–33 行；相关 [observer bootstrap](candidates/m5-terminal/00-catalog-observer.sql)、[Native ACL](candidates/m5-terminal/08-native-proof-acl.sql)。

当前采集器没有 pg_database 的 ACL/owner，没有 observer 获得的 pg_catalog.pg_control_system() EXECUTE 与 pg_subscription 列 ACL，也没有 Native public schema 和五张 document 表的表/列权限采集。即使在 Native 库执行同一查询，schema 过滤也会排除 public。新增权限的源文件 hash 不能代替安装后的实际授权观察。

可区分的反例包括：proof 从 UPDATE(id) 扩大为整表 UPDATE；observer 对 pg_subscription 的列 SELECT 扩大为整表 SELECT；维护角色获得另一目标库 CONNECT。现有 terminal_catalog 对这些权限变化没有对应字段。旧 Native loader 会拒绝新 proof profile，这保留了当前门禁，但不能被视为未来 terminal profile 已覆盖这些变化。

最小修复：给出明确的 Business、Native、cluster/catalog 三部分采集与组合合同，补齐上述实际 ACL、PUBLIC/继承后的有效权限和相关 owner/default ACL；逐项列出预期许可及额外许可的拒绝规则。旧 profile 保持严格。未来 issuer 必须验证完整组合，不能只签 09 的摘要或 source hash。

验收：逐项扩权、撤回必要权限、跨库 CONNECT、PUBLIC 授权和 Native UPDATE(id)→UPDATE 漂移均使新 profile 拒绝；恢复原精确授权后通过。本轮只确认采集缺项，未连接数据库、未运行漂移用例；installer/issuer/loader 尚未实现的状态继续保留。

## TSQL-03 / P2：RESULT_LOOKUP 撤销缺少不可变的控制审计

位置：[04-control-and-lookup.sql](candidates/m5-terminal/04-control-and-lookup.sql) 第 143–164 行；[01-schema.sql](candidates/m5-terminal/01-schema.sql) 的 lookup_permissions/control_events。

issue_result_lookup 只插入可变许可行；revoke_result_lookup 只把 status 改为 REVOKED。两者均不写 control_events，虽然 schema 已列出 LOOKUP_ISSUED/LOOKUP_REVOKED 事件。撤销后仅剩签发时的 provenance/issued_at，无法从不可变数据库记录确认撤销发生时间和执行身份；即使调用成功也没有撤销事件。原终态服务审计完整不能替代这个独立只读能力的生命周期审计。

最小修复：签发及有效撤销在同一事务追加 control_events，绑定 deployment、tenant、lookup、operation/request、调用身份、DB 时间与受审 provenance；不记录 secret。定义重复撤销的幂等结果，避免虚构第二次权限变化。若需要区分本次撤销批准，应为 revoke 增加明确的 provenance 参数并同步 ACL/signature/receipt 清单。

验收：成功签发/撤销各有精确不可变事件；中途失败许可与事件一并回滚；重复撤销按约定返回；撤销与持 FOR SHARE 的结果查询按锁序串行化；跨 deployment/tenant 拒绝。运行验收仍 NOT_RUN。

## 本轮可以保留的部分

- 业务服务审计保持原 USER operation 主体，新增真实 SERVICE_RECONCILE audit/resolution。assert_resolution_history 对照 CONSUMED grant、proof、历史 ACTIVE service version 及不可变终态；不重新要求当前 service、旧 grant TTL 或旧 window 活跃。当前授权由 lock_grant/assert_barrier 单独检查。这一拆分符合 TR-01，尚待实际 RLS 与撤权后的 SAVE/PUBLISH 验收。
- 三个原函数的 replacement 和 business_resource_ready 增量保留原 pointer/publication/activation 一致性检查；private write scope 限制 executor 目标行。未发现本轮范围内另一个可明确复现的服务 actor 例外缺陷；这不等同于运行验证通过。
- 接管在一个 Business 事务中撤销 ISSUED grants、写 SUPERSEDED/predecessor/successor、递增 epoch 并转移双库 claims；历史 CONSUMED/resolutions 保留。新连接身份、旧 backend 排空及 Native 关闭条件有显式检查。TSQL-01 补的是回执丢失后的受限读取与重入，不要求改变这些原子写入语义。
- 普通恢复先提交 RESUMING/撤权，再由外部管理层开库；不在 finally 开库。HBA/凭据、journal、backend broker、Native worker 仍只是待实现执行器要求；没有把这些文字 GATE 记为已执行屏障。
- 新角色无直接业务表 DML/SELECT、无 owner SET ROLE 边；Native UPDATE(id) 实际写权限和受信 proof worker 边界已披露。旧 loader/profile 保持拒绝新增 ledger/ACL，现有 LOCAL 与历史 CI 证据不自动扩展到 terminal。

## 本轮证据及下一步

被审 candidate inventory SHA256：`8c070395d2bd3af35354480f64a4d7150b82f088cd4a1e487f8297f9c8f88733`；Business aggregate：`28085117a89097f7aa7b9da58b9f2f79ef088adc1c77212744548cbea1238b26`。以上仍是被审原候选，未刷新 hash 或签发 receipt。

重跑 verify-candidate.py --sql-parser：9 组 STATIC_PASS，pglast v6.16 / PG16.1 grammar，114 条 SQL、33 个 PL/pgSQL 函数可解析。这些检查没有验证本评审的三项缺口，不能据此关闭问题。applied prerequisite 字节检查通过；没有数据库连接、真实 ACL/DDL/DML、启停、处置或 CI。已有静态证据继续保留其原适用范围。

下一步先修复 TSQL-01–03 的未应用候选，更新来源/签名/receipt hash，补针对性离线检查，再复评；之后实现执行器与新 loader，并在专用本地 PG16 完成必要负向与崩溃用例。建议修复使用 GPT-6.1 Sol / high；跨权限及恢复复评使用 GPT-6 Astra / high。NO COMMIT / NO PUSH / NO CI DISPATCH。

2026-10-12 [R3 修复与本地定向证据](zhiban-v2-m5-terminal-sql-r3-fix-local.md)：TSQL-01–03 已在未应用候选修复，静态 12 组 PASS、独立临时 PG16 26/26 PASS。原 hash/问题描述保留为被审初版历史；新候选待复评，实际开发库安装、完整结算/Native worker 与维护 crash driver 未验收。

2026-10-12 [R3 定向复评结论](zhiban-v2-m5-terminal-r3-review.md)：三项 P2 在候选范围关闭；一项 P3 测试证据问题单列，签发错误用例的适用范围已更正。实际执行与完整运行门禁继续 deferred。
