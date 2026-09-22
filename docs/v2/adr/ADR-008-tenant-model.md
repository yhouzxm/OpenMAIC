# ADR-008 — Tenant Model

## Status

ACCEPTED

## Context

V1有四级组织目录、班级、Tenant，不是同一个概念；开放大学未来有学院/教学点/合作单位。
审计与设计基于 OpenMAIC 4d2e2bab82374ed45b95964a1f2ed03362666e1c；本次只新增文档。

## Decision

Tenant是独立数据和管理空间；班级/课程归Course。OrganizationUnit实际实现DEFERRED，保留来源映射；只有组织层级授权成为明确首批需求时再引入同Tenant组织树。

## Alternatives

每班级一Tenant造成授课/选课碎片；复制V1固定四层组织过度限制；完全删除组织信息损失迁移溯源。

## Consequences

OrganizationUnit 延期已接受；首个实际 Tenant 责任主体在后续配置时确认；不从组织父子关系推导跨Tenant权限。
本ADR已完成人工评审并 ACCEPTED；本次仅冻结文档，不授权建立数据库、认证实现、迁移V1数据或部署。

## Related design

[详细设计](../phase1/tenant-model.md)
