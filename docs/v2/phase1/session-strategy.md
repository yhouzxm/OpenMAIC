# Session 与凭据策略

Status: FROZEN。

## 最小方案

Next.js 同源浏览器 + 服务端 API：Browser 持有高熵 opaque session cookie；Server 持有可撤销 Session（仅 token digest，关联全局 User，不保存最终权限结论）。Cookie 不含角色、tenant membership 或密码。
不同时引入 JWT access token + refresh token；移动端/API 尚无确定需求，标 DEFERRED，未来通过独立认证 Adapter 评审 OAuth/OIDC，不自建 OAuth 平台。OpenMAIC access token 仍是另一类资源机制，不能充当登录会话。

已接受的初始可配置安全策略（非硬编码 Domain invariant）：绝对期限 8 小时，空闲期限 30 分钟，不默认 remember-me；管理员敏感操作要求近期重新认证。登录成功/凭据变更轮换 session；退出服务端撤销并清 cookie。重放撤销 token 一律失败。
Cookie 使用 HttpOnly、Secure（生产 HTTPS）、SameSite=Lax、Path=/、无 Domain，可使用 \_\_Host- 名称；所有修改动作检查同源/CSRF，不靠 SameSite 单独保护。不得存 localStorage。参考 [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)。

## 状态变化

| 事件                   | 既有 Session 与授权                                      |
| ---------------------- | -------------------------------------------------------- |
| logout                 | 撤销当前 Session；提供全部退出的受认证操作               |
| session expiry         | 服务端强制到期；前端 cookie 未过期也无权                 |
| User disabled          | 全部 Session 撤销，每请求检查 User；不能切换 Tenant 绕过 |
| Membership disabled    | 身份会话可以继续，但该空间立即拒绝；其他空间仍需独立验证 |
| Tenant disabled        | 全空间拒绝；不改写所有 Membership，恢复不复活独立禁用者  |
| Role changed           | 下一请求读取新 grants/version；流和桥接 launch 撤销/重查 |
| Password changed/reset | 撤销旧 Session；受控流程重新认证建立新 Session           |

多个标签页显式携带 Tenant 候选，服务端逐次核验，不用全局可变“当前租户”造成串号。状态库不可用时 fail closed。敏感写事务验证授权版本；撤销后的已开始长任务应在下一安全边界取消，不承诺收回已下载内容。

## 密码与恢复

密码只交给 CredentialVerifier/Hasher Port；hash 不进入公开 User DTO，不写日志；token、Cookie、Authorization header 同样脱敏。限速需 IP/identifier/账户多维，统一失败信息；防暴力破解也防恶意锁号。重置 token 单次、短时、摘要存储、验证渠道后发送，不能让租户管理员设置他人的全局密码。
V1 password.ts 已确认 Argon2id（memoryCost 19456、timeCost 2、parallelism 1；encoded version 19）。这证明实现，不证明生产每条 hash；未验证行标记 MIGRATION_REQUIRES_RESET_OR_VERIFICATION。兼容验证通过才允许有条件转移编码 hash，首次成功登录可按新政策 rehash；禁止解密“恢复密码”、生日初始密码和共用默认密码。
Phase 1B 需在目标 Node 22/Linux 验证库与参数性能、限流、CSRF、密钥管理；此文不安装依赖或实现凭据代码。

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

Membership恢复不恢复已撤销/过期Session；有效Session仍须读取新authorizationVersion与当前grant集合。旧权限缓存、launch与stream上下文不能因为同一个MembershipId重新active而复活。
