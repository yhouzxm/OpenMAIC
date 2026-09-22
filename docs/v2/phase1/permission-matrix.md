# 初版权限矩阵

Status: FROZEN；初版设计规则已冻结，不代表所有未来业务动作已实现或永久不可扩展。
V1_CONFIRMED 表示 V1 业务/实现存在，不代表下面 V2 角色组合已实现；V2_REQUIRED 为新设计；FUTURE 为后续领域；UNKNOWN 为需确认。租户业务“允许”仍需 active User/Tenant/Membership + 当前有效RoleGrant + 资源Policy；独立控制面操作验证User与SystemAdminGrant，不创建虚假Membership。

| 能力                        | SYSTEM_ADMIN（控制面） | TENANT_ADMIN                  | TEACHER                                | STUDENT                    | 依据                                                       |
| --------------------------- | ---------------------- | ----------------------------- | -------------------------------------- | -------------------------- | ---------------------------------------------------------- |
| Tenant Administration       | 开户/停用/恢复，审计   | 本空间配置，不变更平台角色    | 禁止                                   | 禁止                       | V2_REQUIRED；V1 tenant 表存在，但完整控制面 UNKNOWN        |
| User Management             | 全局身份恢复受限流程   | 仅成员投影/资格；不改全局密码 | 仅授课相关必要资料                     | 本人资料                   | V1_CONFIRMED accounts/admin API；V2_REQUIRED 全局/成员拆分 |
| Role assignment             | 系统角色受控引导       | tenant 允许委派子集           | 禁止                                   | 禁止                       | V1_CONFIRMED；V2_REQUIRED ceiling                          |
| Course Management           | 默认禁止               | 本空间运营管理                | 已分配课程创建/更新/发布须单独动作授权 | 只读已选/已发布课程        | V1_CONFIRMED course:manage/read；细粒度 V2_REQUIRED        |
| Class Management            | 默认禁止               | 本空间                        | 仅班主任/授权班级，不是所有教师        | 仅本人相关信息             | V1_CONFIRMED 005/head_teacher                              |
| Enrollment                  | 默认禁止               | 本空间批准                    | 经授权班级管理                         | 本人查询；自主选课 UNKNOWN | V1_CONFIRMED 005                                           |
| Learning                    | 默认禁止               | 默认不读个人详细证据          | 授课班级必要数据                       | 本人学习                   | V1_CONFIRMED curriculum；新动作 V2_REQUIRED                |
| Assessment                  | 默认禁止               | 运营不等于可改分              | 授课范围评分，发布分离                 | 本人已发布结果             | V1_CONFIRMED grade 权限；实施 FUTURE                       |
| Analytics                   | 默认禁止               | 最小聚合视图待审批            | 授课班级聚合                           | 本人视图                   | FUTURE；指标与脱敏 UNKNOWN                                 |
| OpenMAIC Activity Access    | 默认禁止               | 仅本空间 metadata             | 拥有/授予的活动 author                 | 已选且可用活动 consume     | V2_REQUIRED bridge；不是匿名底座权限                       |
| Cross-tenant teaching data  | 禁止（无默认超级读）   | 禁止                          | 禁止                                   | 禁止                       | V2_REQUIRED                                                |
| Risk review/research export | 不默认授予             | 不默认授予                    | 不默认授予                             | 禁止                       | V1_CONFIRMED 独立角色；FUTURE                              |

班主任与课程教师可以同为 TEACHER，但 RoleGrant scope + TeachingAssignment 不同；同一 User 在不同 Tenant 可有不同组合。V1 教师业务范围不能因角色合并而扩大。

## 控制面与租户角色（冻结）

STUDENT、TEACHER、TENANT_ADMIN 是 tenant-scoped role，只通过 Membership → RoleGrant 表达。SYSTEM_ADMIN 仅通过独立控制面授权记录 SystemAdminGrant 表达；不得属于 Membership RoleGrant，不得绑定虚假 Tenant，不得由 Tenant API 授予。SystemAdminGrant 关联全局 User，并独立校验有效期/撤销与控制面动作权限；默认不拥有教学数据全局读取权限。控制面操作不通过伪造 Membership 或无租户业务查询实现。

## Membership 恢复与 RoleGrant 生命周期（冻结）

Membership 状态仍仅 pending、active、disabled、left。pending 不授权；disabled 使所有 RoleGrant 在授权计算中失效，记录可以保留但不能授权。
disabled → active 必须显式选择 `PRESERVE_EXISTING_VALID_GRANTS` 或 `REPLACE_GRANTS`，禁止只写 membership.status = active 隐式恢复权限。前者仅保留重新审核且当前有效（未 revoked、未 expired、已到有效起始时间）的 grant；后者以新审批的角色/scope 集合替换，旧记录转为 revoked/history 并保留，不覆盖删除。revoked/expired grant 永不自动复活，未来起效 grant 不因恢复提前生效，亦不得未经显式审批留待后续自动授权。
left 表示已离开 Tenant 业务资格；历史 Membership 保留供审计、业务引用与迁移追踪。left → active 可复用同一 (userId, tenantId) MembershipId，但必须重新审批角色和 scope，旧 RoleGrant 绝不自动恢复，保留 revoked/expired/history 记录。
每种恢复/重新加入必须增加 authorizationVersion 并记录 audit event；重新检查 User/Tenant active、操作者权限、目标 scope 和 grant ceiling，尤其高权限 grant。Tenant disabled → active 不恢复单独 disabled Membership，不复活 revoked/expired grant，不扩大权限；仍 active 的成员也仅按当前有效 grants 重新判定。
恢复、撤权、grant替换与 authorizationVersion 更新须以同一原子命令处理，审计随事务提交；锁定或乐观版本冲突必须重读最新状态，禁止 stale snapshot 覆盖并发 revoke。幂等重放不重复授予；重试不撤销已生效的拒绝决定。

矩阵中的允许项仅适用于当前审批有效的grant：disabled恢复不默认拿回管理员权限，left重新加入也不自动得到旧TENANT_ADMIN。用户保持相同ID不代表授权连续。
