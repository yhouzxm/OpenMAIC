# ADR-012 — OpenMAIC Identity Bridge

## Status

ACCEPTED FOR LIMITED ARCHITECTURE — D02–D05

IMPLEMENTATION / PRODUCTION INTEGRATION DEFERRED

2026-10-04：用户明确授权“审阅并决定 ADR-012 对已验证 D02–D05 范围的接受状态，同时决定 U01/U02 首发要求”。本轮据此接受下述限定架构与发布门禁。接受范围不包含完整 Classroom/Playback、Interactive/iframe、正向 Agent/stream、编辑、生成或导入能力。

评审基线：`refactor/zhiban-v2`，HEAD `8742fddefeaf6456d207eee744e87f2033f1c092`，worktree CLEAN。动态候选为 `b46f1f6aa452ad2026385d3ddcf6dee060272c32`；证据见 [1B-0B-B closeout](../phase1/phase1b-0b-b-review.md)。本轮仅文档，不自动开始 1B-9、创建资源、修改角色/schema、派发 CI 或部署。

## Context

上游匿名owner、access-code token、共享asset principal与document read策略不等同Zhiban多租户授权。现有helper存在不代表路由已接入认证。
历史 0A 审计与原提案基于 OpenMAIC `4d2e2bab82374ed45b95964a1f2ed03362666e1c`。本次接受基于官方 v1.1.2 `1f05a70ac93e09c67fb4d3aafb9c2b068d14fcce` 的公开包、已批准 Model B 和真实隔离诊断；不改写历史审计结论。

[Run 37208515834](https://github.com/yhouzxm/OpenMAIC/actions/runs/37208515834) 在精确动态候选上 SUCCESS：PostgreSQL 16.15、Node v22.23.3 linux/x64，两轮各 101/101 unit/PG（含 25/25 PG）+ 1/1 browser；公开包 fresh build/provenance 和隔离 typecheck 通过。该证据支持被测契约可行性；生产网络、真实 Identity/mapping 组合、root full-project tooling 仍有独立门禁。

## Decision

通过Application Port/Infrastructure Adapter与Zhiban-owned mapping桥接；不改access-token、stage-access或persistence principal。优先验证私有底座+服务端受控网关；未验证入口隔离的功能保持关闭。

限定接受 [ADR-014](ADR-014-openmaic-package-host-strategy.md) 的 Model B：智伴宿主通过公开 package exports 消费以下能力，Zhiban-owned durable mapping 和当前 Application authorization 决定访问权。Domain 不依赖 OpenMAIC DTO；owner/principal/learner handle 由服务端通过已授权映射解析，浏览器不提供身份或资源所有权证明。

| 已接受范围 | 公开契约 / 架构条件 | 仍须完成的生产证明 |
| --- | --- | --- |
| D02 私有资产/字节 | PgAssetStore、PgAssetByteStore；逐资源关联授权的 gateway，GET/HEAD/range 同边界，private/no-store；不交付原始 signed bearer URL | 真正业务关联、角色/ACL、撤权、cache/range、全部媒体派生路径、部署直连闭合 |
| D03 运行态持久化 | 公开 PgRuntimeStore；服务端 Stage/Attempt/learner 绑定、expectedLastSeq CAS、受控事务 hook；广域 merge/delete/admin 关闭 | 真实 Identity 与运行态 mutation 的竞态协调、提交前复核、可信业务事件；scalar-column/JSON 一致性按下述规则处理 |
| D04 Document/Scene | 公开 DocumentStore/PgDocumentStore + DSL；所有 id-capable 读写先通过当前授权、durable mapping 和生命周期复核 | pending/orphan/transfer、CAS/幂等、故障对账/补偿、外部保存后的发布门禁；不声称跨系统 ACID |
| D05 单 slide 预览 | 公开 SlideCanvas；已验证的封闭 plain-text/image/audio/video 请求投影，媒体仅经过授权 gateway | 生产内容校验、HTML/URL/sink 策略、真实支持的媒体格式/解码、资源撤权；不包含完整课堂执行 |

D01 是以上四项共同的生产前置：智伴部署入口不装载/暴露未批准的原生 pages/API/action/字节/Runtime 通道。当前 isolated host 负例 PASS；root 原生路由仍存在，生产隔离 NOT_VERIFIED。NETWORK_ISOLATION_REQUIRED 状态保留，不能只凭路由前缀、隐藏按钮或反代声明完成。

PgRuntimeStore 的公开 getter 未比较 `learner_key`/`stage_id` 与 JSONB。1B-9A 必须明确所有允许的读/list/write 如何绑定可信身份与资源；若其正确性需要 scalar/JSON 一致性，须取得受支持的公开契约/上游方案并独立验证。该缺口未解决时阻止对应路径 BUILD/开放；不得用忽略风险、私有 SQL 生产 guard、改 core 或默默修复数据代替。

公开包树保持官方固定版本；诊断数据库拓扑、测试 provisioning 或 in-memory fixture 不决定生产 schema、角色和资源配置。1B-9A 必须先设计 ownership、durable mapping、操作闭集、ACL/网络、幂等及对账，再按独立批准的 1B-9B/C 实现；1B-10/OPS 门禁通过后才可开放部署。

## 首发 U01/U02 决定

沿用已批准计划的 R1 教学闭环优先，明确冻结 **U01、U02 不作为 R1 硬要求**。两者继续 REQUIRED_LATER，属于完整能力交付/迁移的必需门禁，默认安排于 R3 的 7A/7B；不批准删除需求。

- R1 可以在对应业务设计、Bridge 与集成门禁通过后采用受控文档/媒体/slide 预览、智伴拥有的学习/提交/人工评分用例。预览本身不是学习完成证据，Runtime JSON 或客户端观测也不直接成为成绩。
- R1 不宣称完整 OpenMAIC Classroom、多 Scene/Action/音频时序/Quiz/PBL 执行或 Interactive/VirtualLab 可用；相应 launch/API/UI 入口保持关闭。实际 R1 活动种类、关系、状态机、内容限制、学习完成和提交规则由 2C/3A/3B/4A 设计单元明确，不在本 ADR 预填。
- U01 仍为 UPSTREAM_EXTENSION_REQUIRED：受支持的完整宿主契约，或另行批准的独立引擎 ADR，随后完成正向诊断与真实集成。U02 仍为 UPSTREAM_EXTENSION_REQUIRED：版本化隔离 host/bridge、origin/sandbox/channel/instance/资源/Attempt 契约和正向诊断。
- 若以后某个 release 将 U01/U02 纳入必须活动，其未关闭即成为该 release 的 P0 阻塞；须明确修改 release manifest 并前置 7A/7B。R1 试点可独立验收，但 FULL_MIGRATION_COMPLETE 必须等待两者实现并验收，或另有明确人工处置记录。

完整课堂、互动及其学习 Portal 路径的前置不因本次 D02–D05 接受而解除。D06/D07 的关闭负例仅证明被测配置拒绝执行；D08/D09/D10 仍待单独诊断授权，导出解析成功不表示编辑/生成/导入获得接受。

## Alternatives

直接给Stage加tenant/role侵犯所有权；把匿名cookie映射当授权不安全；改底座鉴权违背本阶段与保护边界；仅保护launch而直连资产存在旁路。

## Consequences

Phase 1B-0A只读静态审计全部资源与调用入口；证据不足则要求未来另行授权的1B-0B隔离诊断。两者属于同一1B-0，不自动授权动态写入。禁止不安全dev auth；无可靠契约时BLOCKED并另审，不承诺目前可生产接通。
本 ADR 的限定架构接受允许后续单独授权 1B-9A DESIGN；本轮不授权 BUILD、建立生产数据库、迁移 V1 数据或部署。Identity/Credential/Session/Authorization 与 1B-8 冻结语义不变。

## Related design

[详细设计](../phase1/openmaic-identity-bridge.md)

## 当前门禁与历史解释

本次为隔离诊断完成后的显式接受评审，状态不由绿色 CI 自动升级。历史 [Bridge 提案](../phase1/openmaic-identity-bridge.md)、0A/0R、gate map 及 0B BUILD/closeout 的 PROPOSED/未执行文字记录各自当时状态；本 ADR 是 D02–D05 当前接受范围及 U01/U02 首发决定的权威。其他 capability 未被追溯改判；历史“0B 在 Identity schema 前”的总前置按已接受 gate map 的两 Track 解释。

VERDICT 保持原四值，动态 ISOLATED_PASS 不写成 STATIC_CONFIRMED。任何必需能力只能通过 Category C/D core 修改实现时输出 BLOCKED_FOR_ARCHITECTURE_REVIEW。OpenMAICResourceAccessPort 仍为 Application Port，其名称不是已完成生产接线的证明。

REVIEW_VERDICT: ACCEPT_LIMITED_ARCHITECTURE

ACCEPTED_SCOPE: D02_D03_D04_D05

COMMON_PRODUCTION_PREREQUISITE: D01_ISOLATION_AND_REAL_AUTHORIZATION

U01_R1_HARD_REQUIREMENT: NO

U02_R1_HARD_REQUIREMENT: NO

U01_U02_FULL_MIGRATION_REQUIREMENT: RETAINED

PRODUCTION_INTEGRATION: NOT_VERIFIED

PRODUCTION_DEPLOYMENT: NOT_AUTHORIZED

SCALAR_JSON_CONSISTENCY: NOT_VERIFIED

NEXT_DESIGN: 1B9A_AFTER_DOCUMENT_CHECKPOINT_AND_SEPARATE_AUTHORIZATION

BUILD_AUTHORIZED_THIS_REVIEW: NO

FROZEN_IDENTITY_CONTRACT_CONFLICT: NO

COMMIT: NO

PUSH: NO
