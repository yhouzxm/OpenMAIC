# ADR-011 — Tenant Isolation

## Status

ACCEPTED

## Context

V1已有PG transaction-local tenant context与RLS；V2不能将tenant字段塞入OpenMAIC表。
审计与设计基于 OpenMAIC 4d2e2bab82374ed45b95964a1f2ed03362666e1c；本次只新增文档。

## Decision

Zhiban tenant-owned数据显式tenant_id+repository predicate+复合约束+RLS；全局User/Credential/Session与系统目录是受控例外。跨租户默认禁止；使用非owner非BYPASSRLS运行角色。

## Alternatives

独立schema增加search_path与迁移管理；独立database隔离强但早期运维成本高，保留专属部署选项。

## Consequences

单租户恢复需工具与演练；缓存/job也需范围；OpenMAIC共享资源仍须bridge/私有网络验证，RLS不能保护其表。
本ADR已完成人工评审并 ACCEPTED；本次仅冻结文档，不授权建立数据库、认证实现、迁移V1数据或部署。

## Related design

[详细设计](../phase1/tenant-isolation.md)

## Fail-closed 契约（冻结）

对 tenant-owned 数据：missing tenant context = DENY；wrong tenant context = DENY；unknown tenant = DENY。wrong 包括候选与已验证 Membership/资源 Tenant 不符；Application 先验证 TenantContext，Repository 与 RLS 同时限定数据，RLS 不能自行证明调用者有资格选择某 Tenant。禁止 unscoped fallback 或默认公共 Tenant。
运行数据库角色必须同时是 non-superuser、non-owner、non-BYPASSRLS。migration owner 与 application runtime role 必须分离；不得使用迁移连接执行应用业务。
Phase 1B 必测：connection pool reuse、rollback reuse、missing context、wrong context、cross tenant id、batch operations、background jobs、cache keys、composite FK、unique constraints；另测 unknown tenant。使用真实受限运行角色，成功与失败事务之后都验证无上下文残留。
全局身份与控制面存储使用明确的专用授权 Port，不是 tenant-owned 仓储的无上下文回退。
