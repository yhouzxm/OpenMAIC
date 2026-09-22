# Phase 1A — Identity 领域边界

Status: FROZEN。只设计，不授权实施。审计日期：2026-09-22。
OpenMAIC 固定基线：4d2e2bab82374ed45b95964a1f2ed03362666e1c。
本次工作起点：176ff15d6c57ed3b813fd4661c8d6c6cacbd4ac0。

## 聚合与一致性

| 概念                                  | 分类                    | 规则与边界                                                                                   |
| ------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------- |
| User                                  | Aggregate Root          | 全局自然人登录身份；不携带 tenant role；凭据归认证子域管理。停用阻断所有空间                 |
| Tenant                                | Aggregate Root          | 独立业务与数据管理空间；状态 active/disabled/archived；不以班级替代                          |
| Membership                            | Aggregate Root          | 一个 User 在一个 Tenant 的资格；唯一(userId, tenantId)，停用后恢复原身份，不新建重复资格     |
| Role                                  | Entity / 版本化目录定义 | Phase 1 为受控系统模板，不提供自定义角色编辑；不是独立 Aggregate。未来租户自定义角色另审 ADR |
| RoleGrant                             | Membership 内 Entity    | roleCode + scope + 有效期；可多条、多角色；不能授予超过操作者可委派范围的权限                |
| Permission                            | Value Object            | 稳定业务动作码；目录由应用控制，不是可任意输入的数据库字符串                                 |
| Scope、UserId、TenantId、MembershipId | Value Object            | 显式类型与合法性校验，scope 引用必须属于当前 Tenant                                          |
| AuthorizationPolicy、MembershipPolicy | Domain Service          | 纯规则，对调用方提供的已验证事实作决策，不读取 cookies/HTTP/数据库                           |
| SystemAdminGrant                      | 控制面授权记录          | 与 Membership 分离；不是把某个 Tenant 的 admin 自动升级为平台管理员                          |

这细化了 Phase 0 的暂定 Account/RoleAssignment 聚合划分；本次人工评审已接受此细化，保留 Phase 0 历史文档作为溯源。RoleGrant 在 Membership 内维护可避免资格停用与授予角色不同步；跨 User/Tenant 状态不变量由 Application 在同一命令边界复核。凭据和 Session 有独立生命周期，不在每次加载 User 时全部加载。

## 十项决策

1. User 为全局身份；租户管理员只见本空间成员投影，不可枚举全局用户。
2. 同一 User 可有多个 Membership；不得因同手机号或同名自动合并 V1 人员。
3. Teacher、Student 是 Membership 的角色，不是互斥 User 类型；学籍/任教资料归业务档案。
4. Tenant Admin 是角色；System Admin 是独立控制面授予的角色，不是另一种人。
5. Membership 支持多 RoleGrant；权限并集之后仍需资源关系和状态 Policy；显式禁用优先。
6. Phase 1 租户角色仅系统定义模板 + tenant 内赋权；SystemAdminGrant 独立于此，Tenant Custom Role 为 DEFERRED。
7. Permission 使用 resource:action；作用范围单独表达。见 rbac-model.md。
8. 需要受控 SYSTEM_ADMIN 引导/停用租户与维护平台；不默认拥有所有教学数据读取权。
9. Tenant 停用立即使所有 Membership 无效，但不批量改写其状态；恢复 Tenant 不能恢复已单独停用的成员。
10. User 停用全局禁止登录及访问；Membership 停用仅阻断该空间，其他有效空间不受影响。

## Membership 创建与跨空间加入

创建资格须由可管理该 Tenant 的操作者发起，并经已验证 User 接受邀请或经批准的管理员导入流程确认；不能按输入 email/phone 自动把任意全局 User 加入。租户管理接口不泄漏“该身份是否在其他 Tenant”。邀请为单次、限时且绑定目标 Tenant 与待核验身份，接受时再次校验可授予角色范围。
Membership 可处于 pending/active/disabled/left；pending 不授权，left 保留历史引用，再加入须显式审批并恢复同一唯一资格。User 与 Tenant 只通过 ID 引用，不把全体 Membership 嵌入聚合。角色目录定义版本受控更新，禁止模板变更悄悄扩大既有 grant；权限扩张需审阅、审计和授权版本失效。

## Repository 与外部依赖

Application 定义 IdentityRepositoryPort（全局身份受限读写）、MembershipRepositoryPort、TenantRepositoryPort、RoleCatalogPort、CredentialVerifierPort、SessionRepositoryPort、AuditPort、ClockPort、IdGeneratorPort。CourseAccessPort 提供选课/任教关系事实；OpenMAICResourceAccessPort 只在应用层接入。
Infrastructure 实现这些 Port；Domain 不依赖 React、Next.js、cookies、HTTP Request 或 OpenMAIC store。业务对象不能从客户端自报的 principal 构造授权事实。

## 审计与删除

所有可变实体至少 created_at、updated_at（服务端 UTC）；created_by/updated_by 为可空 ActorRef，系统动作须记录原因和 requestId，不伪造人类用户。Membership/User/Tenant 使用 status + disabled_at + disabled_reason；恢复清除当前 disabled_at，历史在不可变审计事件中保留。RoleGrant 使用 revoked_at/有效期。
deleted_at 不默认铺到所有表：身份引用存在时禁用而非删除；删除/匿名化必须单独评估保留义务和历史关联。Credential、Session 有到期清理策略；Permission 退役保留历史 code，不能复用旧含义。User 合并是独立审计流程，不是 UPDATE 外键捷径。

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

## Membership 状态转换说明

下表是冻结的业务契约，不创建状态机代码或表。authorizationVersion 在任何改变授权有效性的转换中递增；以下恢复动作必须递增，审计不可省略。

| 转换               | Authorization impact                                     | RoleGrant behavior                                                        | Audit requirement                                                       |
| ------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| pending → active   | User/Tenant有效、邀请/审批有效才激活；不是仅接受导航候选 | 仅新审批的角色/scope可生效，pending阶段预置记录不自动授权                 | activation事件、操作者、审批依据、grant集合、authorizationVersion前后值 |
| pending → disabled | 拒绝任何授权；不新增cancelled状态                        | 预置grant不生效，保留审计记录                                             | invitation cancelled/expired原因、membership disabled事件和版本         |
| active → disabled  | 当前Tenant权限立即失效                                   | 保留记录但全部不参与授权                                                  | disable事件、原因、操作者、版本与失效通知                               |
| active → left      | 离开资格，阻断访问                                       | 当时未撤销grant标记历史/撤销；已expired/revoked保留；不得物理覆盖删除     | leave事件、历史grant引用、版本                                          |
| disabled → active  | 必须显式恢复命令且完整重新授权                           | 明确PRESERVE_EXISTING_VALID_GRANTS或REPLACE_GRANTS；不复活revoked/expired | recovery事件、策略、批准grant IDs/scope、grant ceiling结果、版本        |
| left → active      | 新的加入审批，允许复用MembershipId                       | 新角色/scope审批与新grant；全部旧grant只留历史，不自动恢复                | rejoin事件、新审批和新旧grant引用、版本                                 |

邀请是未来 Application workflow：到期/取消先使邀请凭据不可使用，可通过显式失效命令将 pending 转为 disabled；即使该命令尚未处理，pending仍不能授权。无需新增 cancelled Membership 状态；失效邀请不能用于 pending → active，重新邀请需新审批凭据。

## 与Phase 0上位决策的关系

OpenMAICResourceAccessPort是ADR-002的supplementary application port。UI → Application → Domain；Infrastructure实现Port；Domain禁止依赖OpenMAIC、Zustand、Next、React、OpenMAIC route DTO或database model。V1技术结构只供事实参考，不成为领域依赖。
Phase 1A freeze does not accept ADR-003 globally. 本次只细化Identity边界，Course/Learning/Assessment/Profile/Intervention/Classroom/VirtualLab仍需各自验证，不因本次冻结自动接受。
