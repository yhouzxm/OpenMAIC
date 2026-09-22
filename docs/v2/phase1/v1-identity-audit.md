# V1 Identity 能力审计

Status: FROZEN / read-only evidence。
V1 root: E:/openmaic/OpenMAIC；审计 HEAD: 0fa0a15e8b12ae9e4f7a2d78e80338874599bbae。
V2 work-start HEAD: 176ff15d6c57ed3b813fd4661c8d6c6cacbd4ac0；OpenMAIC snapshot: 4d2e2bab82374ed45b95964a1f2ed03362666e1c。
审计读取源码与migration定义，不执行SQL、不读取.env或生产个人数据。18项是本次确认的实现能力组，不是文件数或全部API数。schema存在不证明生产已应用。

路径均相对 V1 root；migrations 简写指 lib/zhiban/db/migrations，auth/rbac 简写指 lib/zhiban 对应目录。函数名作为可复核定位点。

## 01 账户

| 字段                      | 审计记录                                                                                                                          |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Capability                | 账户                                                                                                                              |
| V1 Location               | lib/zhiban/db/migrations/001-initial-identity.ts; 028-global-account-uniqueness.ts; lib/zhiban/auth/service.ts:createLocalAccount |
| Storage                   | accounts                                                                                                                          |
| Identifier                | UUID / login_name                                                                                                                 |
| Authentication Method     | 本地密码                                                                                                                          |
| Authorization Logic       | active且未deleted                                                                                                                 |
| Role Logic                | account_type互斥student/teacher/admin                                                                                             |
| Tenant/Organization Logic | account绑定tenant；028全局login唯一                                                                                               |
| Dependencies              | profiles/credentials                                                                                                              |
| Security Concern          | 全局登录与单租户身份混合                                                                                                          |
| Migration Value           | 保留人和资格区分                                                                                                                  |
| V2 Strategy               | REWRITE                                                                                                                           |

## 02 登录标识

| 字段                      | 审计记录                                                                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Capability                | 登录标识                                                                                                                   |
| V1 Location               | lib/zhiban/auth/identifiers.ts; auth/service.ts:authenticateLocalByIdentifier; migrations/025-ouc-organization-identity.ts |
| Storage                   | account_login_identifiers                                                                                                  |
| Identifier                | HMAC lookup_hash                                                                                                           |
| Authentication Method     | identifier+password                                                                                                        |
| Authorization Logic       | 唯一匹配才登录                                                                                                             |
| Role Logic                | 不直接授角色                                                                                                               |
| Tenant/Organization Logic | 全局标识索引，兼容扫描active tenants                                                                                       |
| Dependencies              | ZHIBAN_PII_KEY/HKDF                                                                                                        |
| Security Concern          | 全局预认证查询需最小化；verified写true不代表渠道验证                                                                       |
| Migration Value           | 保留规范化/冲突拒绝                                                                                                        |
| V2 Strategy               | REWRITE                                                                                                                    |

## 03 密码

| 字段                      | 审计记录                                                        |
| ------------------------- | --------------------------------------------------------------- |
| Capability                | 密码                                                            |
| V1 Location               | lib/zhiban/auth/password.ts; migrations/001-initial-identity.ts |
| Storage                   | password_credentials                                            |
| Identifier                | account_id                                                      |
| Authentication Method     | Argon2id                                                        |
| Authorization Logic       | 8..128与字母数字；dummy verify                                  |
| Role Logic                | 无                                                              |
| Tenant/Organization Logic | 通过account关联tenant                                           |
| Dependencies              | @node-rs/argon2                                                 |
| Security Concern          | 代码算法已确认，生产行未知                                      |
| Migration Value           | 条件性hash兼容                                                  |
| V2 Strategy               | ADAPT                                                           |

## 04 登录/锁定

| 字段                      | 审计记录                                                                         |
| ------------------------- | -------------------------------------------------------------------------------- |
| Capability                | 登录/锁定                                                                        |
| V1 Location               | app/api/zhiban/auth/login/route.ts; lib/zhiban/auth/service.ts:authenticateLocal |
| Storage                   | credentials/session/audit                                                        |
| Identifier                | account_id                                                                       |
| Authentication Method     | 服务端verify                                                                     |
| Authorization Logic       | active、锁定检查；5次失败锁15分钟                                                |
| Role Logic                | 返回accountType但非最终授权                                                      |
| Tenant/Organization Logic | 索引命中路径未见Tenant status join                                               |
| Dependencies              | auth enabled flag                                                                |
| Security Concern          | 每账户锁定不是完整IP限流；租户停用需补强                                         |
| Migration Value           | 保留状态校验，重做分层                                                           |
| V2 Strategy               | REWRITE                                                                          |

## 05 Session

| 字段                      | 审计记录                                                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Capability                | Session                                                                                                    |
| V1 Location               | lib/zhiban/auth/token.ts; auth/http.ts; auth/service.ts:getAccountForSession; migrations/002-local-auth.ts |
| Storage                   | user_sessions                                                                                              |
| Identifier                | tenantId.secret / hash                                                                                     |
| Authentication Method     | 32-byte随机secret，SHA256存储                                                                              |
| Authorization Logic       | expiry/revoked/account状态                                                                                 |
| Role Logic                | 角色另行加载                                                                                               |
| Tenant/Organization Logic | cookie tenant用于DB路由                                                                                    |
| Dependencies              | Next cookies                                                                                               |
| Security Concern          | 信任代理/secure override需部署审核；未检查Tenant状态                                                       |
| Migration Value           | 服务端可撤销会话                                                                                           |
| V2 Strategy               | KEEP_CONCEPT                                                                                               |

## 06 退出/改密

| 字段                      | 审计记录                                                                                                                                      |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Capability                | 退出/改密                                                                                                                                     |
| V1 Location               | app/api/zhiban/auth/logout/route.ts; app/api/zhiban/auth/password/route.ts; lib/zhiban/auth/service.ts:revokeLocalSession/changeLocalPassword |
| Storage                   | sessions/credentials/audit                                                                                                                    |
| Identifier                | session/account                                                                                                                               |
| Authentication Method     | 已登录验证                                                                                                                                    |
| Authorization Logic       | 改密撤销其他sessions；退出撤当前                                                                                                              |
| Role Logic                | 无                                                                                                                                            |
| Tenant/Organization Logic | tenant transaction                                                                                                                            |
| Dependencies              | Session/password                                                                                                                              |
| Security Concern          | V2全局凭据不能由tenant管理员随意重置                                                                                                          |
| Migration Value           | 保留撤销语义                                                                                                                                  |
| V2 Strategy               | REWRITE                                                                                                                                       |

## 07 重置凭据存储

| 字段                      | 审计记录                                   |
| ------------------------- | ------------------------------------------ |
| Capability                | 重置凭据存储                               |
| V1 Location               | lib/zhiban/db/migrations/002-local-auth.ts |
| Storage                   | password_reset_tokens                      |
| Identifier                | UUID/token_hash                            |
| Authentication Method     | 仅确认schema，不声称完整找回API            |
| Authorization Logic       | expires_at/used_at                         |
| Role Logic                | 无                                         |
| Tenant/Organization Logic | tenant/account FK + RLS                    |
| Dependencies              | 恢复渠道未确认                             |
| Security Concern          | 不可将表存在当成功恢复能力                 |
| Migration Value           | 单次短期恢复概念                           |
| V2 Strategy               | REVIEW                                     |

## 08 角色与动作目录

| 字段                      | 审计记录                                                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Capability                | 角色与动作目录                                                                                             |
| V1 Location               | lib/zhiban/db/migrations/001-initial-identity.ts; 003-default-rbac.ts; 005-academic-organization.ts        |
| Storage                   | roles/permissions/role_permissions                                                                         |
| Identifier                | UUID/code                                                                                                  |
| Authentication Method     | 消费认证principal                                                                                          |
| Authorization Logic       | permission集合                                                                                             |
| Role Logic                | student/head_teacher/course_teacher/risk_reviewer/teaching_admin/institution_admin/system_admin/researcher |
| Tenant/Organization Logic | global或tenant角色定义                                                                                     |
| Dependencies              | seed migrations                                                                                            |
| Security Concern          | system_admin全权限不宜继承                                                                                 |
| Migration Value           | 动作与角色分离                                                                                             |
| V2 Strategy               | KEEP_CONCEPT                                                                                               |

## 09 有范围授予

| 字段                      | 审计记录                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------ |
| Capability                | 有范围授予                                                                                       |
| V1 Location               | lib/zhiban/db/migrations/004-rbac-data-scopes.ts; lib/zhiban/rbac/service.ts:hasScopedPermission |
| Storage                   | role_assignments/authorization_scopes/role_scope_policies                                        |
| Identifier                | scope_type/id                                                                                    |
| Authentication Method     | 服务端principal                                                                                  |
| Authorization Logic       | self/class/course/project/tenant/system                                                          |
| Role Logic                | role约束允许scope；有效期/撤销                                                                   |
| Tenant/Organization Logic | scope同tenant触发器                                                                              |
| Dependencies              | SQL+TS                                                                                           |
| Security Concern          | 025新增organization但读取TS分支未对应，末分支按projectGroup处理                                  |
| Migration Value           | 保留范围，统一契约                                                                               |
| V2 Strategy               | REWRITE                                                                                          |

## 10 API授权

| 字段                      | 审计记录                                                                          |
| ------------------------- | --------------------------------------------------------------------------------- |
| Capability                | API授权                                                                           |
| V1 Location               | lib/zhiban/rbac/http.ts; rbac/service.ts:getAuthorizedPrincipal/requirePermission |
| Storage                   | sessions/accounts/grants                                                          |
| Identifier                | principal id                                                                      |
| Authentication Method     | cookie lookup                                                                     |
| Authorization Logic       | 无context要求tenant-wide；scoped检查关系                                          |
| Role Logic                | 每请求加载active roles                                                            |
| Tenant/Organization Logic | tenant SQL context                                                                |
| Dependencies              | Next wrapper + domain混合                                                         |
| Security Concern          | granted-only helper需要下游补资源检查                                             |
| Migration Value           | 统一Application Policy                                                            |
| V2 Strategy               | REWRITE                                                                           |

## 11 管理员赋权

| 字段                      | 审计记录                                                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Capability                | 管理员赋权                                                                                                 |
| V1 Location               | app/api/zhiban/admin/role-assignments/route.ts; lib/zhiban/rbac/service.ts:assignRole/revokeRoleAssignment |
| Storage                   | role_assignments/audit                                                                                     |
| Identifier                | account/assignment UUID                                                                                    |
| Authentication Method     | requireRequestPermission                                                                                   |
| Authorization Logic       | account:manage；system_admin专门限制                                                                       |
| Role Logic                | 可分配角色查询与scope验证                                                                                  |
| Tenant/Organization Logic | 同tenant目标account                                                                                        |
| Dependencies              | role_scope trigger                                                                                         |
| Security Concern          | 未见通用可委派上限；需最后管理员并发约束；不是已验证利用                                                   |
| Migration Value           | 角色管理独立权限                                                                                           |
| V2 Strategy               | REWRITE                                                                                                    |

## 12 成员停用

| 字段                      | 审计记录                                              |
| ------------------------- | ----------------------------------------------------- |
| Capability                | 成员停用                                              |
| V1 Location               | lib/zhiban/rbac/service.ts:updateManagedAccountStatus |
| Storage                   | accounts/user_sessions/audit                          |
| Identifier                | account UUID                                          |
| Authentication Method     | 管理principal                                         |
| Authorization Logic       | 禁止停用自己；disabled撤销sessions                    |
| Role Logic                | 依赖API管理权限                                       |
| Tenant/Organization Logic | tenant范围                                            |
| Dependencies              | session revocation                                    |
| Security Concern          | 单租户account禁用不等于V2全局User禁用                 |
| Migration Value           | 资格状态概念                                          |
| V2 Strategy               | ADAPT                                                 |

## 13 Tenant与RLS

| 字段                      | 审计记录                                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| Capability                | Tenant与RLS                                                                                          |
| V1 Location               | lib/zhiban/db/migrations/001-initial-identity.ts; 002-local-auth.ts; lib/zhiban/db/tenant-context.ts |
| Storage                   | tenants及tenant-owned tables                                                                         |
| Identifier                | UUID/code                                                                                            |
| Authentication Method     | 上层身份                                                                                             |
| Authorization Logic       | 事务set_config + RLS FORCE                                                                           |
| Role Logic                | tenant/system类型非角色                                                                              |
| Tenant/Organization Logic | active/suspended/archived                                                                            |
| Dependencies              | PG runtime DB role                                                                                   |
| Security Concern          | 超管/BYPASSRLS无法靠策略隔离；运行角色未知                                                           |
| Migration Value           | 保留隔离，补状态                                                                                     |
| V2 Strategy               | KEEP_CONCEPT                                                                                         |

## 14 组织目录

| 字段                      | 审计记录                                                                         |
| ------------------------- | -------------------------------------------------------------------------------- |
| Capability                | 组织目录                                                                         |
| V1 Location               | lib/zhiban/db/migrations/025-ouc-organization-identity.ts                        |
| Storage                   | organization_units/tenant_organization_bindings/account_organization_memberships |
| Identifier                | external_id/UUID                                                                 |
| Authentication Method     | 目录导入不等于认证                                                               |
| Authorization Logic       | 绑定表RLS；组织目录共享                                                          |
| Role Logic                | organization scope扩展                                                           |
| Tenant/Organization Logic | 四级headquarters/branch/college/learning_center                                  |
| Dependencies              | source/version/history                                                           |
| Security Concern          | 组织归属与租户边界不能等同                                                       |
| Migration Value           | 保留概念延后实施                                                                 |
| V2 Strategy               | REVIEW                                                                           |

## 15 教师学生管理员档案

| 字段                      | 审计记录                                                                                                                          |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Capability                | 教师学生管理员档案                                                                                                                |
| V1 Location               | lib/zhiban/db/migrations/001-initial-identity.ts; 025-ouc-organization-identity.ts; lib/zhiban/auth/service.ts:createLocalAccount |
| Storage                   | student_profiles/teacher_profiles/admin_profiles                                                                                  |
| Identifier                | account+tenant/student_no/employee_no                                                                                             |
| Authentication Method     | 共享account密码                                                                                                                   |
| Authorization Logic       | 档案不是授权结果                                                                                                                  |
| Role Logic                | admin_level和account_type不可替代role grant                                                                                       |
| Tenant/Organization Logic | 组织与学籍资料                                                                                                                    |
| Dependencies              | PII/source mappings                                                                                                               |
| Security Concern          | 同人多身份受互斥类型限制；PII最小化                                                                                               |
| Migration Value           | 拆资格与业务档案                                                                                                                  |
| V2 Strategy               | REWRITE                                                                                                                           |

## 16 班级选课与业务门禁

| 字段                      | 审计记录                                                                                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capability                | 班级选课与业务门禁                                                                                                                                                              |
| V1 Location               | lib/zhiban/db/migrations/005-academic-organization.ts; app/api/zhiban/student/courses/[courseId]/structure/route.ts; lib/zhiban/curriculum/service.ts:getStudentCourseStructure |
| Storage                   | classes/class_memberships/teaching_assignments/enrollments                                                                                                                      |
| Identifier                | course/offering/student UUID                                                                                                                                                    |
| Authentication Method     | requireRequestPrincipal                                                                                                                                                         |
| Authorization Logic       | API accountType=student；service查enrolled+published                                                                                                                            |
| Role Logic                | 班主任/任课关系                                                                                                                                                                 |
| Tenant/Organization Logic | withZhibanTenant；部分SQL依赖RLS而未显式tenant条件                                                                                                                              |
| Dependencies              | Course/Curriculum                                                                                                                                                               |
| Security Concern          | 类型判断散落；RLS配置错误影响查询                                                                                                                                               |
| Migration Value           | 关系保留，授权重写                                                                                                                                                              |
| V2 Strategy               | ADAPT                                                                                                                                                                           |

## 17 审计

| 字段                      | 审计记录                                                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Capability                | 审计                                                                                                           |
| V1 Location               | lib/zhiban/db/migrations/001-initial-identity.ts; lib/zhiban/auth/service.ts:writeAudit; rbac/service.ts:audit |
| Storage                   | audit_log                                                                                                      |
| Identifier                | bigint identity/request_id                                                                                     |
| Authentication Method     | actor account/service/system/anonymous                                                                         |
| Authorization Logic       | 触发器拒绝update/delete                                                                                        |
| Role Logic                | 记录操作不授予权限                                                                                             |
| Tenant/Organization Logic | tenant_id可空用于系统事件                                                                                      |
| Dependencies              | before/after/metadata                                                                                          |
| Security Concern          | 敏感JSON必须脱敏，不能无选择复制                                                                               |
| Migration Value           | 不可变审计概念                                                                                                 |
| V2 Strategy               | KEEP_CONCEPT                                                                                                   |

## 18 服务身份与导入兼容

| 字段                      | 审计记录                                                                                                                                     |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Capability                | 服务身份与导入兼容                                                                                                                           |
| V1 Location               | lib/zhiban/db/migrations/001-initial-identity.ts; 025-ouc-organization-identity.ts; lib/zhiban/auth/service.ts:authenticateLocalByIdentifier |
| Storage                   | service_principals/identity_import_batches/revisions                                                                                         |
| Identifier                | service UUID/source ids                                                                                                                      |
| Authentication Method     | schema凭据；不声称已完整服务认证                                                                                                             |
| Authorization Logic       | 默认disabled；导入有版本/回滚记录                                                                                                            |
| Role Logic                | service actor不等同人                                                                                                                        |
| Tenant/Organization Logic | tenant/source context                                                                                                                        |
| Dependencies              | legacy backfill                                                                                                                              |
| Security Concern          | 025允许生日初始密码；登录兼容全租户扫描不搬迁                                                                                                |
| Migration Value           | 去除临时兼容路径，服务身份另审                                                                                                               |
| V2 Strategy               | REMOVE                                                                                                                                       |

## 业务规则与临时实现

保留业务概念：身份与学籍/任教档案不同、班主任与任课范围、选课后访问发布课程、角色授予有效期、组织来源溯源、可撤销Session与审计。
不复制临时实现：accountType散落条件、同账户绑定一个tenant的登录耦合、login时跨tenant扫描并回填、默认全权限system_admin、单一OpenMAIC owner等同业务身份、硬编码组织层级和示例组织ID。
KEEP_CONCEPT 不表示复制代码。REMOVE 在第18项指移除旧登录回填/弱初始密码等兼容路径，不否定服务主体和导入审计业务价值（它们应独立 REVIEW）。

## 重点不确定性

- getAuthorizedPrincipal/getAccountForSession 和索引命中登录查询检查账户状态，但读取实现未联合验证Tenant状态；不能声称停用Tenant已经全面阻断。
- 025扩展organization范围，当前role API zod枚举和hasScopedPermission未完整匹配；需测试证实影响范围，不能把DB支持等同端到端支持。
- 密码算法已确认Argon2id，生产hash编码/迁移版本/密钥/实际弱初始密码使用仍UNKNOWN。
- 未全量证明每个API都正确授权；此为能力审计，不是渗透测试或安全认证。

## 历史证据与冻结契约

上文 V1 的 system/organization/project_group scope、tenant-bound Session 等是历史实现证据，不是 V2 接受的契约。V2 ScopeType 仅 SELF/CLASS/COURSE/TENANT；未知值 DENY。V1 审计内容保留，不用新设计改写历史事实。
