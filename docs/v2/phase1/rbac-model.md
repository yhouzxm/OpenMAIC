# RBAC + Policy

Status: FROZEN。V1 事实见 v1-identity-audit.md；以下是新设计，不是对 V1 权限逐字搬迁。

## 基础角色

- STUDENT：本人学习和已选课资源。
- TEACHER：承担授课/班级职责的资源；V1 course_teacher 与 head_teacher 的差异转为显式 scope/assignment，不因成为教师就能管理全校。
- TENANT_ADMIN：本 Tenant 的成员和运营管理；来源是 V1 teaching_admin/institution_admin，迁移需重新批准权限子集。
- SYSTEM_ADMIN：控制面角色，V1 system_admin 的业务全权不继承。开户、停用、恢复由受控管理流程执行，教学数据默认禁止。

Risk Reviewer、Researcher 有 V1 证据，但均为 DEFERRED；Phase 1 不启用，未来另行评审。普通教师不自动获得风险研判、全体数据导出或角色管理能力。

## 命名与 Policy

Permission 为小写单数资源 + 冒号 + 动作，稳定 code 不含 TenantId、角色名、API 路径或翻译文本。候选最小集：
tenant:manage、membership:read、membership:manage、role:assign、course:create/read/update/publish、class:manage、enrollment:manage、learning:view_self/view_class、assessment:grade、analytics:view_class、activity:author/consume/manage_metadata。
这是动作词汇评审集，并非 Phase 1B 必须实现所有领域。细分 self/class 动作可以保留业务语义，但仍须做实际资源 scope 校验。

Membership RoleGrant = tenant-scoped RoleRef + Scope(SELF/CLASS/COURSE/TENANT) + validity。Role 定义 Permission 集；Policy = 有效身份/空间/资格 AND permission AND scope AND 资源关系 AND 资源状态。默认拒绝，禁用优先；不能把若干不相关 scope 拼接成越权组合。同一条 grant 必须同时满足动作与范围。

## 管理权边界

role:assign 单独于 membership:manage。只能委派自己被允许委派的角色与范围（不能仅比较角色字符串）；TENANT_ADMIN 不能授 SYSTEM_ADMIN、修改系统角色模板或全局凭据。防自我提权；撤销最后有效租户管理员要有原子替代/控制面恢复方案。平台角色不可由租户 API 写入。
角色变更增加授权版本并使旧授权快照失效，下一请求重读；高风险写操作在提交事务内再验证。UI capability DTO 仅辅助显示。

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
