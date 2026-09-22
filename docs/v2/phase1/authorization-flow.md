# 服务端授权流程

Status: FROZEN。

Request → Authentication → Tenant Resolution → Membership → Authorization → Use Case → Repository / Adapter → Result

1. Request：校验结构、大小、方法；修改请求校验 CSRF/Origin；不信任 userId、role、owner、tenant 参数。
2. Authentication：解析 HttpOnly opaque session；服务端校验 hash、期限、撤销、User 状态。无效返回通用 401。
3. Tenant Resolution：URL 或选择项只是候选；确认 Tenant active，绑定本次不可变 TenantContext，禁止全局可变变量。
4. Membership：按 userId + tenantId 读取 active 资格与有效 RoleGrant。跨 Tenant 默认拒绝；未授予返回 403 或防枚举 404。
5. Authorization：最小化加载当前 Tenant 的资源事实；Permission + scope + enrollment/teacher ownership + 状态判断。资源不存在与无权读取避免泄漏区别。
6. Use Case：业务规则和写入；敏感操作在同一事务内复核资格版本、作用范围和最后管理员约束，处理并发撤销，不依赖请求初始快照一直有效。
7. Repository：所有 tenant-owned 读取/写入/列表/计数/批量/导出携带 TenantContext；数据库复合约束与 RLS 防漏。全局身份仓储仅供受限认证/身份用例。
8. Adapter：通过 Zhiban mapping 验证 resource 同 Tenant；只转换已授权命令，限制 action/resource/expiry，不透传客户端凭据。长期流在撤销事件或周期边界重查并中止。
9. Result：返回最小 DTO；不含 hash/token/internal principal。审计 requestId、actor、tenant、action、resource、decision、reason；不记录敏感请求正文。

Domain 表达纯 Policy，不导入 Next/React/cookies/HTTP/OpenMAIC store。Application 是主要授权安全边界，Repository 是租户隔离第二道边界。后台任务携带受限 ServiceActor 与明确 Tenant，同样授权，不伪造 SYSTEM_ADMIN。

验收：相同用例经 API/Server Action/worker 均受保护；枚举 id、伪造 tenant、批量混入外租户、并发撤权、过期流、跨租户缓存命中全部拒绝。

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

## Session 与请求上下文（冻结）

Session.userId = authentication identity。Tenant 候选/activeTenant = request/navigation context，不是 authorization proof；切换空间只改变导航候选，不授予权限。
每个受保护的 Tenant 业务请求必须验证：User active、Tenant active、Membership active、RoleGrant validity、Permission、Scope、Resource relationship、Resource status。身份专用入口和独立控制面入口使用各自显式 Policy；不伪造 Tenant/Membership，也不形成 unscoped 教学数据访问。
保留 login 后 session rotation、credential change rotation/revocation、role change authorization version invalidation、logout server-side revoke。8h absolute / 30min idle 是初始可配置安全策略，不是硬编码 Domain invariant。

## Membership 恢复与 RoleGrant 生命周期（冻结）

Membership 状态仍仅 pending、active、disabled、left。pending 不授权；disabled 使所有 RoleGrant 在授权计算中失效，记录可以保留但不能授权。
disabled → active 必须显式选择 `PRESERVE_EXISTING_VALID_GRANTS` 或 `REPLACE_GRANTS`，禁止只写 membership.status = active 隐式恢复权限。前者仅保留重新审核且当前有效（未 revoked、未 expired、已到有效起始时间）的 grant；后者以新审批的角色/scope 集合替换，旧记录转为 revoked/history 并保留，不覆盖删除。revoked/expired grant 永不自动复活，未来起效 grant 不因恢复提前生效，亦不得未经显式审批留待后续自动授权。
left 表示已离开 Tenant 业务资格；历史 Membership 保留供审计、业务引用与迁移追踪。left → active 可复用同一 (userId, tenantId) MembershipId，但必须重新审批角色和 scope，旧 RoleGrant 绝不自动恢复，保留 revoked/expired/history 记录。
每种恢复/重新加入必须增加 authorizationVersion 并记录 audit event；重新检查 User/Tenant active、操作者权限、目标 scope 和 grant ceiling，尤其高权限 grant。Tenant disabled → active 不恢复单独 disabled Membership，不复活 revoked/expired grant，不扩大权限；仍 active 的成员也仅按当前有效 grants 重新判定。
恢复、撤权、grant替换与 authorizationVersion 更新须以同一原子命令处理，审计随事务提交；锁定或乐观版本冲突必须重读最新状态，禁止 stale snapshot 覆盖并发 revoke。幂等重放不重复授予；重试不撤销已生效的拒绝决定。
