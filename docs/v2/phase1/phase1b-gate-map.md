# Phase 1B Gate Map — Architecture Closeout

Status: APPROVED BY HUMAN ARCHITECTURE REVIEW / DOCUMENTATION ONLY。
HEAD: 700a7673becf0518bc6f8b2861229ee985c5d063。
OpenMAIC固定基线: 4d2e2bab82374ed45b95964a1f2ed03362666e1c。
ARCHITECTURE_REVIEW_RESULT: RESOLVED_FOR_IDENTITY_TRACK。
1B-0R: RESOLVED_FOR_TARGET_ARCHITECTURE；不是FULLY_RESOLVED。

## 两条逻辑Track

```text
Identity Track
Phase1A frozen + ADR007/008/009 accepted + 0R closeout accepted
  → 1B-1 Domain Contracts
  → 1B-2 Identity Repository / External Ports
  → 1B-3 Identity PostgreSQL Schema + RLS（独立schema review）
  → 1B-4 Identity PostgreSQL Repositories
  → 1B-5 Credential Authentication
  → 1B-6 Server Session
  → 1B-7 Authorization Policies
  → 1B-8 Identity Application Use Cases + Minimal API

OpenMAIC Integration Track
1B-0A Static Surface Audit [COMPLETE]
  → 1B-0R Architecture Resolution [RESOLVED_FOR_TARGET_ARCHITECTURE]
  → capability-specific 1B-0B [NOT RUN]
  → ADR-012 explicit human review [PROPOSED]
  → 1B-9 Bridge [BLOCKED]
```

不是两个项目，也不是完全独立：Identity use case真正调用OpenMAIC时，在Application boundary汇合，必须同时满足对应Integration Gate。0B属于1B-0内部诊断子Gate，不新增顶级编号；保留1B-0～1B-12，每批独立人工review与实现授权。本次不开始1B-1。

## Gate定义

| Gate | 当前值 | 必要限制 |
|---|---|---|
| IDENTITY_DOMAIN_1B1 | ALLOWED | 不再依赖Bridge成功、ADR012接受、全量0B；纯Domain不得依赖React/Next/OpenMAIC类型 |
| REPOSITORY_PORTS_1B2 | ALLOWED_AFTER_1B1 | 仅Identity ports和冻结Application边界，不实现Adapter，不泄漏route DTO/store type/PG implementation type |
| IDENTITY_SCHEMA_1B3 | ALLOWED_AFTER_1B1_AND_1B2_REVIEW | 还须独立schema/ownership review；只有Identity-owned数据，不能搭车加入资源mapping |
| 1B-4至1B-8 | 按各自前置顺序review | 不因未解决OpenMAIC能力整体阻塞；每批测试/安全验收不省略 |
| OPENMAIC_BRIDGE_1B9 | BLOCKED | 对应必需capabilities完成0B、ADR012明确人工接受、无P0 unresolved blocker；保留1B2/7等自身前置 |

1B-10综合Security/Integration Gate、1B-11 Minimal UI、1B-12 Handoff沿用原编号与依赖；本次不进一步解锁，也不以其未完成追溯阻塞1B1–8。所有部署、V1迁移仍无授权。

## Schema与Port所有权

1B-2候选：IdentityRepositoryPort、TenantRepositoryPort、MembershipRepositoryPort、RoleCatalogPort、CredentialVerifierPort、SessionRepositoryPort、AuditPort、ClockPort、IdGeneratorPort。具体接口仍需该批review，不提前生成代码。

1B-3未来可评估User、Tenant、Membership、Role、RoleGrant、Permission、SystemAdminGrant、Credential、Session、identity audit、legacy identity mapping；不是现在创建这些表，也不强制每概念一表。

OPENMAIC_MAPPING_IN_1B3: FORBIDDEN。
Stage mapping、Activity→Stage、runtimeHandle、ownerHandle、Asset/Agent/deployment mapping、OpenMAIC bridge session/credential全部排除。资源mapping persistence属于未来1B-9或独立子批次，仍由Zhiban-owned record表达；不能改OpenMAIC表。legacy identity mapping只关联V1/V2身份，不夹带Stage或runtime句柄。

## ADR关系与架构接受范围

- ADR-013：WHERE OpenMAIC capability lives。ACCEPTED FOR ARCHITECTURE / IMPLEMENTATION DEFERRED。
- ADR-014：HOW Zhiban prefers to consume capability。ACCEPTED FOR ARCHITECTURE / IMPLEMENTATION/CAPABILITY COVERAGE DEFERRED。
- ADR-012：HOW specific identity/authorization bridges individual resources。PROPOSED。

Model B、PRIVATE CAPABILITY RUNTIME、Package Host DEFAULT STRATEGY已获架构批准。Browser原则上只访问Zhiban pages/APIs/authorized resource proxy/short-lived restricted launch handles。原生Web为DISABLED TARGET，不是当前已网络隔离。Package Host coverage为PARTIAL，不是所有能力安全可用。013/014接受不自动接受012。

## 各能力Gate

| 能力 | 当前目标与启用前置 |
|---|---|
| Native Embedded HTTP Runtime | DISABLED TARGET；禁止insecure dev auth。server-owned host + published RuntimeStore/PgRuntimeStore仅PACKAGE_HOST_CANDIDATE |
| Runtime | 实现前Runtime Diagnostic：export/stability、可信server learner、cross learner/tenant denial、Stage/Attempt绑定、tenant mapping、revoke、persistence isolation、事务/安全行为 |
| Asset | published AssetStore + authenticated gateway候选；开放前Asset Diagnostic；raw/media/signed/generated URL非默认公开接口 |
| Full Classroom/Playback | 上游U01仍缺；原生classroom page不开放为业务页面。Portal由智伴拥有，renderer局部显示不等于full playback |
| Interactive/iframe | 上游U02仍缺；VirtualLab不绑定内部iframe pool；InteractiveRuntimePort保持Application边界，启用前对应诊断 |
| Stream | 对应流启用前验证撤权/停止副作用/重连；不因私网而默认安全 |
| Native Agent API/tools | DISABLED TARGET；Phase1不向student/teacher开放通用tool set；AIServicePort只暴露approved use cases |
| Generation | PACKAGE_HOST_CANDIDATE；teacher-authorized use case→AIServicePort→published generation，原生API不公开；单独review |
| Editor | PACKAGE_HOST_CANDIDATE仅限公开entrypoints足以独立宿主；若依赖private Zustand/Stage/action则延期或请求上游，不声称完整Editor安全 |
| Import | browser parser OPTIONAL CANDIDATE；Node/full workflow DEFERRED；parser公开不等于persistence workflow安全 |

0B是CAPABILITY-SPECIFIC ISOLATED DIAGNOSTIC GATE，不是Identity总前置；只对即将实现/开放的能力与其关联边界验证。本次未运行0B，production Bridge不能兼任首次可行性诊断。

## 保留历史与未决事项

0A CURRENT OPENMAIC SURFACE AUDIT保持原文件不变：SAFE_ADAPTER 0；NETWORK_ISOLATION_REQUIRED 10；UPSTREAM_EXTENSION_REQUIRED 9；BLOCKED 1；DIRECT_BROWSER_BYPASS YES；PRIVATE_OPENMAIC_REQUIRED YES。

0R TARGET ARCHITECTURE RESOLUTION与上述历史同时保留。真正剩余2项扩展：Full Classroom / Playback Hosting Contract、Isolated Interactive Hosting Protocol。P0 IDENTITY BLOCKERS: 0；不能据此声称P0 BRIDGE BLOCKERS为0。Individual capability diagnostics及ADR012尚未完成。
