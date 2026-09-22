# Tenant 数据隔离

Status: FROZEN。任何跨 Tenant 读取默认禁止，包括统计、导出、缓存、日志检索及后台任务。

| 方案              | 复杂度/查询                       | 迁移与测试                                                    | 备份                         | OpenMAIC / SaaS                                   |
| ----------------- | --------------------------------- | ------------------------------------------------------------- | ---------------------------- | ------------------------------------------------- |
| A tenant_id 行级  | 最低运维成本；每次查询强制范围    | 一套 schema；漏条件风险，需复合 FK/唯一约束与真实 PG RLS 测试 | 整库易；单租户恢复需专门工具 | 适合早期多租户；OpenMAIC 不加字段，外部映射补足   |
| B 每租户 schema   | search_path、连接池与权限管理复杂 | 每租户升级/回滚、版本漂移                                     | 可按 schema 导出，仍共故障域 | 不自动隔离 OpenMAIC 全局 assets；客户多时成本增加 |
| C 每租户 database | 连接/运维成本最高，隔离较强       | 各库升级、连接路由与一致性测试                                | 单租户恢复清晰               | 合规专属实例可选，需同步规划 OpenMAIC 实例边界    |

推荐 A：Zhiban tenant-owned 业务表显式 tenant_id + Application scope + repository predicate + PostgreSQL RLS。User/Credential/Session 全局身份记录、Permission/系统 Role 模板例外，不强塞 tenant_id；它们不能通过普通租户仓储直接查询。租户成员投影按 Membership 限定。

## 约束

所有 tenant-owned 外键使用 tenant + id 校验，唯一性明确是否租户内；避免全局唯一错误泄漏别的 Tenant 存在性。事务内设置上下文，释放连接前事务完成，不使用连接级残留状态。缺少 context 必须拒绝，不默认公共租户。
应用数据库角色不能是 superuser/BYPASSRLS，迁移 owner 与运行角色分离；RLS 不是为错误的超权限连接兜底。该限制依据 [PostgreSQL RLS 文档](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)，具体项目部署角色仍须 Phase 1B 实测。

Zhiban owns Tenant/User/Membership/Role/Permission、所有业务关联与资源 mapping；OpenMAIC owns Stage/Scene/Asset/Runtime/Agent Session。不修改 OpenMAIC 表，不给 Stage 增 tenant_id/role，不往 OpenMAIC storage 写 Membership。Zhiban mapping 的 tenant_id 只在 Zhiban 持有。

缓存 key、对象引用、异步 job、幂等 key 需要 Tenant 范围。Session 身份是全局，但授权缓存还需 user/membership/tenant/policy version；Phase 1 优先不缓存授权。
系统管理员跨租户支持不是普通查询；若将来需要，须独立受审计、限时限目的用例批准，不能查询时省略 tenant 条件。

## 验收与演进

两租户共享一个 User、同业务编号不同资源、并发连接切换、缺失 context、rollback 后复用、批量写、后台任务、唯一/FK错误和导出都需负例。测试使用非 owner 真实 PostgreSQL 角色。
备份演练必须验证 tenant mapping 与引用完整；未来迁到独立 DB 时保留 TenantId，改变路由 Port，不改 Domain。Phase 1A 未创建库、表或策略。

## Fail-closed 契约（冻结）

对 tenant-owned 数据：missing tenant context = DENY；wrong tenant context = DENY；unknown tenant = DENY。wrong 包括候选与已验证 Membership/资源 Tenant 不符；Application 先验证 TenantContext，Repository 与 RLS 同时限定数据，RLS 不能自行证明调用者有资格选择某 Tenant。禁止 unscoped fallback 或默认公共 Tenant。
运行数据库角色必须同时是 non-superuser、non-owner、non-BYPASSRLS。migration owner 与 application runtime role 必须分离；不得使用迁移连接执行应用业务。
Phase 1B 必测：connection pool reuse、rollback reuse、missing context、wrong context、cross tenant id、batch operations、background jobs、cache keys、composite FK、unique constraints；另测 unknown tenant。使用真实受限运行角色，成功与失败事务之后都验证无上下文残留。
全局身份与控制面存储使用明确的专用授权 Port，不是 tenant-owned 仓储的无上下文回退。

## 与OpenMAIC授权的边界

PostgreSQL RLS只保护Zhiban-owned tenant tables，不保护OpenMAIC原生Stage、Asset、Runtime、Agent Session。Zhiban RLS测试通过不能证明OpenMAIC bridge安全；桥接仍需Application authorization + mapping + Adapter + 必要的network isolation。SystemAdminGrant是Zhiban-owned独立控制面记录，不写进OpenMAIC storage。
