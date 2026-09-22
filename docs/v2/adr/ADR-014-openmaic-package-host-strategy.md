# ADR-014 — OpenMAIC Package Host Strategy

## Status

ACCEPTED FOR ARCHITECTURE
IMPLEMENTATION/CAPABILITY COVERAGE DEFERRED

## Context

六包正式exports支持不同粒度：DSL/storage为数据与存储；generation为受控内容生成；renderer/editor为slide UI；importer当前browser-only。原生HTTP Runtime阻塞不等于公开RuntimeStore不能宿主。完整课堂/Interactive尚无足够公开host契约。

## Decision

人工架构评审接受Model B作为默认策略：智伴Application/Infrastructure通过正式package exports消费能力，UI使用正式渲染/编辑包。Domain不依赖OpenMAIC DTO、React、Next或Zustand；遵守ADR002的Ports方向。

Runtime采用公开RuntimeStore + PgRuntimeStore候选，server构造opaque learner上下文和Attempt/Stage映射，不使用原生dev auth/bootstrap。Asset采用公开AssetStore +智伴授权字节gateway。Document存储、生成与编辑保存必须重新授权。浏览器parser只提供不可信内容，不能直接Node host。

不开放native agent/tools/actions/原生Web；完整Classroom/Playback与Interactive分别等待U01/U02或另行批准的能力方案。禁止直接引用internal模块以完成“包集成”：不得依赖private Zustand/Stage store、private server helper、private PG schema或把原生Server Action作为智伴业务API。优先检查@openmaic/dsl、@openmaic/storage、@openmaic/generation、@openmaic/importer、@openmaic/renderer、@openmaic/editor的受支持published contracts。

公开export不是安全保证；版本固定、dist可消费性、host安全、事务和实际网络必须通过另授0B。不得把本ADR当实施授权或自动接受ADR012。

## Alternatives

Model A难以靠反代修复业务身份契约。Model C可用于未来私有render重任务，但需正式service契约和测试。Model D本地fork auth不是当前必要路径。全面自行实现课堂引擎是产品范围重大改变，未获批准。

## Consequences

基础候选直接internal依赖目标为0；不复制核心代码、不改OpenMAIC schema。运行宿主由智伴拥有不改变Stage/Scene/Asset/Runtime的数据契约所有权。

需要新host的Application wrapper、版本兼容测试及资源生命周期设计；本轮均未实现。完整课堂/互动能力仍有真实缺口，PACKAGE HOST FEASIBLE: PARTIAL；架构closeout结论RESOLVED_FOR_IDENTITY_TRACK，不宣称所有V2能力可直接迁移。

上游同步仍main→sync/openmaic-*→compatibility tests→refactor/zhiban-v2，不自动merge upstream到V2。本次人工已批准Identity/OpenMAIC Gate解耦，具体依赖见phase1b-gate-map.md；不授权本轮实施。

## ADR关系与接受范围

ADR-013定义WHERE（私有能力边界）；ADR-014定义HOW（默认Package Host消费策略）；ADR-012定义具体身份/权限到资源的安全桥接。ADR-012保持PROPOSED，不能由013/014接受自动接受。IMPLEMENTATION/CAPABILITY COVERAGE DEFERRED表示具体capability仍需诊断、review与实现授权，不是全部安全可宿主。
