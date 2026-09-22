# Tenant 模型

Status: FROZEN。

Tenant 表示可独立管理成员、业务数据和授权的空间，不等于组织树每个节点。Phase 1 默认一个办学单位一个 Tenant；是否将合作单位独立开户，取决于是否要求独立数据与管理责任，须业务确认，不能从 V1 organization_level 自动推导。

| 概念                 | 含义                           | 所属         |
| -------------------- | ------------------------------ | ------------ |
| Tenant               | 安全和业务隔离边界             | Identity     |
| OrganizationUnit     | 学院/教学点/合作单位的组织归属 | 未来组织目录 |
| Administrative Class | 学籍/班主任管理关系            | Course       |
| Teaching Class       | 某课程开课的教学分组           | Course       |
| Course               | 课程定义/开课引用              | Course       |

班级不得建成 Tenant。租户内部教师跨班授课通过任教关系与 scope 授权，不通过跨 Tenant 特例。

## 最小模型

TenantId、code（稳定且唯一）、displayName、status、audit fields；code 不作凭据。Membership(userId, tenantId, status, roleGrants) 是多对多身份关系，和班级 membership 不同。
DEFERRED: OrganizationUnit 的实际模型、导入和层级授权。V1 的 migrations/025 已有四级组织树与 tenant_organization_bindings，确实有业务价值，但不是 Phase 1 登录最小依赖。保留 legacy organization 映射清单，不能丢弃来源。

未来若确需组织授权，再新增 tenant 内的 OrganizationUnitId、parentId、type，限制父子同 Tenant、防环，允许学校/学院/教学点的不同深度，不强制四级。外部共享教育目录用 externalRef 映射，不直接获得本空间权限。Tenant 间合作走显式共享用例，不靠父组织继承跨租户数据权。

## 生命周期

停用 Tenant 后所有业务入口默认拒绝；平台控制面可审计地管理停用状态，但不读取教学内容。Membership 恢复需 Tenant/User 均有效。归档不删除学习记录。
Phase 1B 前确认首个 Tenant 的实际责任主体、管理员引导人、组织目录是否为首批上线硬需求。

Tenant恢复不能恢复单独disabled Membership或revoked/expired RoleGrant，也不扩大权限。Membership恢复按[冻结状态机](identity-domain.md)显式审批，不能仅更新status。
