# ADR-012 — OpenMAIC Identity Bridge

## Status

PROPOSED

## Context

上游匿名owner、access-code token、共享asset principal与document read策略不等同Zhiban多租户授权。现有helper存在不代表路由已接入认证。
审计与设计基于 OpenMAIC 4d2e2bab82374ed45b95964a1f2ed03362666e1c；本次只新增文档。

## Decision

通过Application Port/Infrastructure Adapter与Zhiban-owned mapping桥接；不改access-token、stage-access或persistence principal。优先验证私有底座+服务端受控网关；未验证入口隔离的功能保持关闭。

## Alternatives

直接给Stage加tenant/role侵犯所有权；把匿名cookie映射当授权不安全；改底座鉴权违背本阶段与保护边界；仅保护launch而直连资产存在旁路。

## Consequences

Phase 1B-0A只读静态审计全部资源与调用入口；证据不足则要求未来另行授权的1B-0B隔离诊断。两者属于同一1B-0，不自动授权动态写入。禁止不安全dev auth；无可靠契约时BLOCKED并另审，不承诺目前可生产接通。
本ADR未经人工接受，不授权建立数据库、认证实现、迁移V1数据或部署。

## Related design

[详细设计](../phase1/openmaic-identity-bridge.md)

## 未决授权表面验证

Awaiting Phase 1B-0 authorization surface validation.
保持 PROPOSED，直到 Phase 1B-0 完成且证据证明需要开放的全部 OpenMAIC 资源入口处于统一授权边界内，再进行明确接受评审；完成 spike 不自动改为 ACCEPTED。
Phase 1B-0 是首个技术批次，必须在数据库 schema 实施之前完成，不是生产 Adapter 实现。逐项清单与证据字段见 [实施计划](../phase1/phase1b-implementation-plan.md)。任何必需能力若只能通过 Category C/D 核心修改实现，禁止修改，输出 BLOCKED_FOR_ARCHITECTURE_REVIEW。OpenMAICResourceAccessPort 仍为 Application Port；该命名不表示已有安全接线实现。

网络方向仅为PREFERRED CANDIDATE，不是ACCEPTED DEPLOYMENT。VERDICT保持原四值；新增独立VERIFICATION_STATUS（STATIC_CONFIRMED / REQUIRES_ISOLATED_DIAGNOSTIC）及DYNAMIC_VERIFICATION_REQUIRED。静态证据不足或仅依赖内部实现时不得SAFE_ADAPTER；无隔离环境记录DYNAMIC_VERIFICATION_BLOCKED_BY_ENVIRONMENT，不标PASS。详见[完整验证分层](../phase1/phase1b-implementation-plan.md)。
