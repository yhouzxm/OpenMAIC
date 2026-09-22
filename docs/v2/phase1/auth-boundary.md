# Authentication / Authorization / Tenancy 边界

Status: FROZEN。

| 边界                     | 回答                       | 可信来源                                 | 不可替代它的东西                  |
| ------------------------ | -------------------------- | ---------------------------------------- | --------------------------------- |
| Authentication           | 你是谁                     | 服务端验证凭据和 Session 后的 UserId     | role 参数、OpenMAIC access code   |
| Tenancy                  | 在哪个空间操作             | 服务端确认有效的 Tenant + Membership     | URL/header/cookie 中自报 tenantId |
| Authorization            | 能对哪个资源做什么         | Permission + scope + 业务关系 + 最新状态 | UI 隐藏、accountType              |
| OpenMAIC Resource Access | 可否访问 Stage/Scene/Asset | 已授权应用命令 + 服务端映射 + Adapter    | 猜到 StageId、匿名 owner cookie   |

OpenMAIC lib/server/access-token.ts 是 access-code 派生的时间戳 HMAC token，不标识 Zhiban User；lib/server/stage-access.ts 读取 owner/public/deleted 元数据，不验证 Membership。两者不能当作 RBAC。
lib/persistence/server-auth.ts 明示开发认证及共享 asset principal；lib/server/agent-runtime/owner.ts 的匿名 cookie 也不是 Zhiban Session。

UI → Application → Domain；Infrastructure 实现 Port。Next handler 只负责协议、认证上下文与错误转换；Application 在所有入口（API、Server Action、后台任务）强制授权；Domain 接收普通值及关系事实；Repository 校验租户限定，Adapter 不接受浏览器 owner/principal。

认证可成功但没有有效 Membership，此时普通业务入口仅允许个人身份/退出及经批准的空间选择流程，不能默认进入第一个 Tenant。独立控制面须另外验证 SystemAdminGrant，不要求虚假 Membership，也不因此开放教学数据。授权失败禁止用 OpenMAIC 公共资源 fallback 绕过。

全局 Credential 访问限认证服务；租户管理员可停用本空间 Membership，不能修改其他空间成员身份、读取密码 hash、替全局 User 重置密码。全局身份恢复需独立验证流程。

## Session 与请求上下文（冻结）

Session.userId = authentication identity。Tenant 候选/activeTenant = request/navigation context，不是 authorization proof；切换空间只改变导航候选，不授予权限。
每个受保护的 Tenant 业务请求必须验证：User active、Tenant active、Membership active、RoleGrant validity、Permission、Scope、Resource relationship、Resource status。身份专用入口和独立控制面入口使用各自显式 Policy；不伪造 Tenant/Membership，也不形成 unscoped 教学数据访问。
保留 login 后 session rotation、credential change rotation/revocation、role change authorization version invalidation、logout server-side revoke。8h absolute / 30min idle 是初始可配置安全策略，不是硬编码 Domain invariant。
