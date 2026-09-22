# ADR-010 — Authentication and Session

## Status

ACCEPTED

## Context

V1本地Argon2id与可撤销Session可借鉴，但tenant嵌入cookie与账户类型耦合不宜搬迁；当前是浏览器/Next服务端应用。
审计与设计基于 OpenMAIC 4d2e2bab82374ed45b95964a1f2ed03362666e1c；本次只新增文档。

## Decision

采用全局User认证+服务端opaque Session摘要记录，HttpOnly/Secure cookie；每请求核验状态与Membership，不缓存最终角色到token。access/refresh双token和OAuth平台DEFERRED。

## Alternatives

纯JWT削弱即时撤销；客户端localStorage增加泄露面；把OpenMAIC code/token当Session不满足身份保证。

## Consequences

需要Session存储、过期/撤销与CSRF/限速；初始8h绝对/30min闲置为可配置安全策略，非硬编码Domain invariant；密码迁移先验证真实编码和兼容性，未验证需reset或verification。
本ADR已完成人工评审并 ACCEPTED；本次仅冻结文档，不授权建立数据库、认证实现、迁移V1数据或部署。

## Related design

[详细设计](../phase1/session-strategy.md)

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
