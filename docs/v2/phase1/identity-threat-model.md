# Identity 威胁模型

Status: FROZEN。优先级 P0 为多租户开放前必须阻断，P1 为 Phase 1B 身份上线关卡；不是已验证漏洞清单。

| Threat                               | Boundary                          | Mitigation                                                 | Test Requirement                                    |
| ------------------------------------ | --------------------------------- | ---------------------------------------------------------- | --------------------------------------------------- |
| P0 cross-tenant access               | Application/Repository/cache/jobs | tenant predicate + RLS +复合引用；缓存/job携带范围         | 两 Tenant 读写/列表/导出/批量/缓存串用              |
| P0 IDOR                              | 资源解析                          | tenant 内查找 + ownership/enrollment；id 不作凭据          | 替换同 Tenant 他人 ID 与外 Tenant ID                |
| P0 privilege escalation              | RoleGrant 管理                    | 可委派上限、禁止系统角色租户授予、最后管理员并发保护       | 自授角色、扩大 scope、双请求撤销最后管理员          |
| P1 stale session                     | Session store                     | 服务端过期/撤销、失败关闭、不以 cookie 生命周期为准        | 过期/退出 token 重放、状态库故障                    |
| P1 disabled user access              | User/Session                      | 禁用即全局撤销且请求重查                                   | 旧 cookie、后台请求、切 Tenant 均拒绝               |
| P1 role change after login           | Policy/cache/stream               | 版本重查、敏感事务复核、流终止                             | 撤权后 API/写提交/长连接                            |
| P0 forged tenant id                  | Request→TenantContext             | 候选 tenant 必须绑定当前 User active Membership            | 修改 URL/header/body、多标签页并发                  |
| P0 client-side authorization bypass  | UI→API/Server Action              | 服务端所有入口授权                                         | 手工请求隐藏操作、批处理调用                        |
| P0 OpenMAIC resource id guessing     | Adapter/network                   | 映射+动作校验、原始入口不可达、覆盖资产/流                 | Stage/Scene/Asset/runtime/agent 与下载旁路          |
| P0 credential leakage                | Cookie/logs/DTO                   | HttpOnly/Secure、脱敏、不返 hash、不记 token               | 日志扫描、DTO契约、错误堆栈检查                     |
| P1 CSRF/session fixation             | Browser/server                    | 同源/CSRF 校验、登录轮换、禁止 URL token                   | 跨站 POST、预置旧 cookie 后登录                     |
| P1 credential stuffing / enumeration | 登录/恢复                         | 多维限速、统一错误、单次恢复 token                         | 不存在用户与错误密码、重放、恶意锁号                |
| P0 confused deputy                   | Bridge                            | action/resource/actor 绑定，不接受浏览器 owner/learner key | 转发他人 launch、教师上下文用于学生编辑             |
| P1 migration identity collision      | Import boundary                   | 权威核验+冲突隔离，不靠姓名电话合并                        | 同名/共享电话/重复 legacy key                       |
| P1 organization scope drift          | SQL→Domain/API                    | 单一 scope contract，未知 scope 拒绝                       | V1 organization 输入不得落入 project_group fallback |

## 信任与残余风险

浏览器、iframe、导入文件、客户端 tenant/role/owner 均不可信。可信组件是经部署验证的应用边界、数据库受限角色、私有 Adapter；密钥泄露和数据库管理员失陷需要运维控制，RLS 不解决超管风险。
未读生产数据库，因此实际弱密码、部署网络暴露、RLS运行角色和日志泄漏状态 UNKNOWN。已有 CI 只说明运行基线，不替代以上安全测试。已下载资源不能靠撤权收回；敏感资源需最小输出与保留策略。

## Membership 恢复与 RoleGrant 生命周期（冻结）

Membership 状态仍仅 pending、active、disabled、left。pending 不授权；disabled 使所有 RoleGrant 在授权计算中失效，记录可以保留但不能授权。
disabled → active 必须显式选择 `PRESERVE_EXISTING_VALID_GRANTS` 或 `REPLACE_GRANTS`，禁止只写 membership.status = active 隐式恢复权限。前者仅保留重新审核且当前有效（未 revoked、未 expired、已到有效起始时间）的 grant；后者以新审批的角色/scope 集合替换，旧记录转为 revoked/history 并保留，不覆盖删除。revoked/expired grant 永不自动复活，未来起效 grant 不因恢复提前生效，亦不得未经显式审批留待后续自动授权。
left 表示已离开 Tenant 业务资格；历史 Membership 保留供审计、业务引用与迁移追踪。left → active 可复用同一 (userId, tenantId) MembershipId，但必须重新审批角色和 scope，旧 RoleGrant 绝不自动恢复，保留 revoked/expired/history 记录。
每种恢复/重新加入必须增加 authorizationVersion 并记录 audit event；重新检查 User/Tenant active、操作者权限、目标 scope 和 grant ceiling，尤其高权限 grant。Tenant disabled → active 不恢复单独 disabled Membership，不复活 revoked/expired grant，不扩大权限；仍 active 的成员也仅按当前有效 grants 重新判定。
恢复、撤权、grant替换与 authorizationVersion 更新须以同一原子命令处理，审计随事务提交；锁定或乐观版本冲突必须重读最新状态，禁止 stale snapshot 覆盖并发 revoke。幂等重放不重复授予；重试不撤销已生效的拒绝决定。

## 恢复/重新加入威胁补充

| Threat                   | Boundary                   | Mitigation                                                     | Test Requirement                            |
| ------------------------ | -------------------------- | -------------------------------------------------------------- | ------------------------------------------- |
| 历史管理员grant复活      | Membership恢复命令         | 显式preserve/replace、新审批、grant ceiling；left旧grant不恢复 | revoked/expired管理员grant恢复后仍deny      |
| 恢复与revoke竞态提权     | Application事务/Repository | 版本比较或锁、原子审计/版本递增、冲突后重读                    | 两种提交顺序均不能覆盖revoke或留下越权grant |
| 旧Session/launch重获权限 | Policy/cache/stream        | authorizationVersion失效；恢复不恢复旧凭据                     | 同MembershipId恢复后旧授权快照仍失败        |
