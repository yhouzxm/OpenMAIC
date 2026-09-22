# ADR-009 — RBAC Policy

## Status

ACCEPTED

## Context

V1已有role+permission+scope，也有accountType路由判断和SQL/TS scope漂移；角色不是完整资源关系。
审计与设计基于 OpenMAIC 4d2e2bab82374ed45b95964a1f2ed03362666e1c；本次只新增文档。

## Decision

受控STUDENT/TEACHER/TENANT_ADMIN模板，SYSTEM_ADMIN在控制面单独授予。Permission+scope+业务关系+当前状态决定授权；默认拒绝，授权在Application与数据边界。

## Alternatives

UI if-role不是安全边界；仅RBAC不解决IDOR；直接复制所有V1角色/tenant-wide grants会扩大访问面；复杂全量ABAC平台当前不需要。

## Consequences

角色委派需上限与最后管理员并发保护；risk/research角色延期审查；必须统一scope contract。
本ADR已完成人工评审并 ACCEPTED；本次仅冻结文档，不授权建立数据库、认证实现、迁移V1数据或部署。

## Related design

[详细设计](../phase1/rbac-model.md)

## 控制面与租户角色（冻结）

STUDENT、TEACHER、TENANT_ADMIN 是 tenant-scoped role，只通过 Membership → RoleGrant 表达。SYSTEM_ADMIN 仅通过独立控制面授权记录 SystemAdminGrant 表达；不得属于 Membership RoleGrant，不得绑定虚假 Tenant，不得由 Tenant API 授予。SystemAdminGrant 关联全局 User，并独立校验有效期/撤销与控制面动作权限；默认不拥有教学数据全局读取权限。控制面操作不通过伪造 Membership 或无租户业务查询实现。

## Phase 1 Scope 契约（冻结）

ScopeType 是有限集合：`SELF | CLASS | COURSE | TENANT`，不得用任意 string 作为合法 scope 类型。ScopeId 的字段名为 scopeId，其类型由 ScopeType 决定：

| ScopeType | ScopeId / scopeId | 约束                                                         |
| --------- | ----------------- | ------------------------------------------------------------ |
| SELF      | null              | 资源关系必须证明属于当前 User/Membership                     |
| CLASS     | ClassId           | 服务端确认 Class 属于当前 TenantContext，并验证实际班级关系  |
| COURSE    | CourseId          | 服务端确认 Course 属于当前 TenantContext，并验证实际课程关系 |
| TENANT    | null              | 实际 Tenant 仅由已验证 TenantContext 确定                    |

未知 ScopeType、缺失/多余/类型错误的 scopeId：DENY。禁止 fallback 到其他 scope。ORGANIZATION、ACTIVITY 及其他 scope（包括 V1 project_group/system）均为 DEFERRED，不在 Phase 1 隐式接受。SystemAdminGrant 不是新增 SYSTEM ScopeType。
Permission 继续采用 `resource:action`；不得把 TenantId、ClassId、CourseId 或 Role 名称编码进 Permission 字符串。业务动作中的 self/class 语义不能替代 Scope 和资源关系验证。

## Membership 恢复与 RoleGrant 生命周期（冻结）

Membership 状态仍仅 pending、active、disabled、left。pending 不授权；disabled 使所有 RoleGrant 在授权计算中失效，记录可以保留但不能授权。
disabled → active 必须显式选择 `PRESERVE_EXISTING_VALID_GRANTS` 或 `REPLACE_GRANTS`，禁止只写 membership.status = active 隐式恢复权限。前者仅保留重新审核且当前有效（未 revoked、未 expired、已到有效起始时间）的 grant；后者以新审批的角色/scope 集合替换，旧记录转为 revoked/history 并保留，不覆盖删除。revoked/expired grant 永不自动复活，未来起效 grant 不因恢复提前生效，亦不得未经显式审批留待后续自动授权。
left 表示已离开 Tenant 业务资格；历史 Membership 保留供审计、业务引用与迁移追踪。left → active 可复用同一 (userId, tenantId) MembershipId，但必须重新审批角色和 scope，旧 RoleGrant 绝不自动恢复，保留 revoked/expired/history 记录。
每种恢复/重新加入必须增加 authorizationVersion 并记录 audit event；重新检查 User/Tenant active、操作者权限、目标 scope 和 grant ceiling，尤其高权限 grant。Tenant disabled → active 不恢复单独 disabled Membership，不复活 revoked/expired grant，不扩大权限；仍 active 的成员也仅按当前有效 grants 重新判定。
恢复、撤权、grant替换与 authorizationVersion 更新须以同一原子命令处理，审计随事务提交；锁定或乐观版本冲突必须重读最新状态，禁止 stale snapshot 覆盖并发 revoke。幂等重放不重复授予；重试不撤销已生效的拒绝决定。
