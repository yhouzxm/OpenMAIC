# Phase 1B-0R — OpenMAIC Integration Architecture Review

Status: ARCHITECTURE CLOSEOUT ACCEPTED。
ARCHITECTURE_REVIEW_RESULT: RESOLVED_FOR_IDENTITY_TRACK。
1B-0R: RESOLVED_FOR_TARGET_ARCHITECTURE。
人工已批准Model B与Gate解耦；不是部署决定或具体能力实现授权，individual capability validation尚未完成。
Branch: refactor/zhiban-v2
HEAD: 700a7673becf0518bc6f8b2861229ee985c5d063
OpenMAIC baseline: 4d2e2bab82374ed45b95964a1f2ed03362666e1c

## 结论

RECOMMENDED INTEGRATION MODEL: B — Zhiban Package Host。
PACKAGE HOST FEASIBLE: PARTIAL。
PRIVATE OPENMAIC: REQUIRED（能力、持久存储与字节不直达浏览器；独立原生Web服务不是必需）。
NATIVE OPENMAIC WEB ROUTES: DISABLED（目标，不是当前已关闭）。
EMBEDDED HTTP RUNTIME: DISABLE_AND_REPLACE_CANDIDATE。
ARCHITECTURE_REVIEW_RESULT: RESOLVED_FOR_IDENTITY_TRACK。

公开包足以支持受控文档/资产/运行态存储、slide渲染、slide编辑、受控内容生成；不等于完整Classroom/Playback/Interactive engine。选B是因为当前必要的身份敏感能力已有host seam，未发现必须借私有原生Web完成的基础操作。C可在真实导出/render需求出现后独立评审，不为了“混合更全面”先引入native routes。A仅靠反代不能修正principal；D违背upstream-first成本约束。

本轮不改0A的SAFE_ADAPTER 0、NETWORK_ISOLATION_REQUIRED 10、UPSTREAM_EXTENSION_REQUIRED 9、BLOCKED 1。0A审计现有入口，本轮审计拟议目标能力。下面PACKAGE_HOST_CANDIDATE不是0A的第五种VERDICT，也不是安全认证。

## 证据范围与契约检查

读取0A五份文档、Phase0架构/core边界、ADR001/002/004/006/012、冻结identity bridge与实施计划；不重新扫描133入口。为核验目标判断，定向读取六包manifest、README、barrel/类型/实现片段与现有测试。没有安装、执行测试或动态验证。以下版本是本地manifest，不声称已核验npm registry的发布产物；独立dist消费是0B检查项。

| Evidence | 公开入口与实际支持 | Host与信任边界 | 限制、契约分类与测试证据 |
|---|---|---|---|
| P01 DSL 0.11.2 | packages/@openmaic/dsl/package.json，src/index.ts；root与schema/*；Stage/Scene/Action、runtime、AssetRef、validate/normalize/version | Adapter负责转换；不是Domain直接依赖的业务模型。纯数据可服务端使用 | PUBLIC_STABLE数据契约，不含授权/执行引擎。test/runtime.test.ts、stage.test.ts、validate.test.ts |
| P02 storage 0.31.1 | package.json；src/index.ts；runtime/types.ts、runtime/pg.ts；document/pg、asset/pg、asset/pg-bytes、asset/s3-bytes、server公开subpaths | 服务端提供Queryable及正确withTransaction、AssetPrincipal、业务授权上下文；无需app bootstrap | PUBLIC_STABLE存储契约，不含智伴RBAC；test/runtime-contract.ts、pg-runtime-store.pg.test.ts、document-contract.ts、pg-asset-store.test.ts、asset-http-egress.test.ts。测试覆盖不代表新host已验证 |
| P03 generation 0.3.10 | package.json、README、src/index.ts、pipeline-types.ts；generateSceneContent/Actions、buildCompleteScene、PBL planner/kernel与AICallFn | teacher-authorized服务端用例提供模型调用，保管密钥、预算、取消、错误与asset mapping | PUBLIC_STABLE公开包面，0.x需pin；不是agent runner。test/type-surface.test.ts明确provider/model不在内容选项、由AICallFn闭包提供；scene-generation.test.ts保护内容行为 |
| P04 importer 0.2.5 | package.json、README:3–7、src/index.ts；importPptx/parsedToSlides/normalizeImportedSlides、upload callback | 浏览器parser候选；服务端接收其输出仍是用户不可信输入。不能在纯Node server直接host | PUBLIC_STABLE解析API但有运行环境约束。README旧“实验Node”段不推翻当前Browser-only警告；不依赖内部agent import shim。test/normalizeImportedSlides.test.ts等保护解析结果，不能证明安全导入工作流 |
| P05 renderer 0.1.9 | package.json、README、src/index.ts、SlideCanvas.tsx；root/elements/types/snapshot/fonts.css | React UI层host，服务端授权内容后传props；renderImage/renderVideo插槽支持媒体注入 | PUBLIC_STABLE slide组件，不是服务端Classroom。test/SlideCanvas.test.tsx、SlideElement.test.ts等。背景/audio等仍需统一URL策略；可选fonts.css外部CDN默认不加载 |
| P06 editor 0.0.7 | package.json、README、src/react/index.ts、src/ui/host.ts；root/core、react、ui | controlled slide/selection/onTransaction；host提供asset picker、id、locale；保存回智伴Application | PUBLIC_STABLE编辑包面，但不是server鉴权。test/ui/host.test.ts、EditableSlideCanvasWithUI.test.tsx、core/transaction.test.ts。无需导入app Zustand/Server Action；insertItems只是UI配置不是权限 |

这里PUBLIC_STABLE表示在固定快照有正式export、文档与对应测试保护的消费面，不保证未来0.x不破坏兼容；每次升级pin版本并跑contract tests。裸Next JSON路由为PUBLIC_BUT_UNVERSIONED；I01–I08内部依赖为INTERNAL；未核验发布artifact及尚不存在的U01/U02契约为UNKNOWN。package exported ≠ security-safe。

存储schema由OpenMAIC包拥有，即使运行在智伴server也不变成智伴业务表。未来仅经批准使用公开初始化/升级能力；不得手写针对其私有列的SQL，不加Tenant字段，不把运行环境可控等同数据所有权转移。

## Runtime：原BLOCKED的目标替代路径

NATIVE_HTTP_RUNTIME: DISABLED。
TARGET_RUNTIME: PACKAGE_HOST_CANDIDATE。

公开@openmaic/storage导出RuntimeStore；@openmaic/storage/runtime/pg导出PgRuntimeStore、Queryable/WithTransaction和初始化接口。src/runtime/pg.ts:264/269的构造器接收外部queryable/options；无需lib/server/persistence/bootstrap、insecure dev auth、浏览器x-learner-key。现有pg-runtime-store.pg.test.ts:1–85用连接池事务构造store并运行共享contract，证明这不是只有内部host才能实例化的类。

拟议调用：可信Actor/Tenant/Membership → Attempt授权 → mapping选取server learner handle和StageRef → 受限Application wrapper → PgRuntimeStore。learner handle为opaque、部署与业务范围隔离，不直接使用MembershipId。store的getSession/listRecords/update/delete等按id操作不验证业务主体；wrapper须加载session后核对Stage、learner、Attempt和mapping状态，不暴露mergeLearner/deleteAllRuntime等管理面。

PUBLIC server/runtime handler的authenticate回调可以注入principal，但只验证learner相等不等于Stage授权；直接挂载完整handler仍不安全。因此优先在智伴显式用例里调用store，不把通用HTTP API挂在公网。server/reference的简化bearer身份示例不采用。

PG withTransaction必须每次独立checkout连接、BEGIN/COMMIT/ROLLBACK/release并pin查询；不能共享client假事务。授权版本与跨系统mapping变更还需wrapper协调、fail closed与幂等，不靠store自动实现业务事务。

仍需0B：dist公开入口兼容、真实PG契约、并发/CAS、拒绝客户端learner、同Tenant及跨Tenant隔离、Stage绑定、撤权/孤儿/重试。当前只是静态可行路径，未实现wrapper，原BLOCKED入口仍旧BLOCKED。

## Classroom、Editor、Import与AI的实际边界

Teacher authoring：单slide编辑可用editor/core+react+ui配合DocumentStore和受控asset picker；非slide场景编排、完整课程编辑不能从这个结论推出。Teacher Portal由智伴实现（未来单独授权）。

Student playback：renderer可只读显示slide和效果，支持媒体注入；没有完整Action调度/音频/多Scene/Quiz/PBL课堂生命周期。不能导入内部Stage store来补齐。完整执行U01；互动iframe U02。静态预览不是完成学习或评估证据。

Generation：公开包可在受限服务端use case中调用；Provider选择/密钥/预算放AICallFn closure，输出校验、资源入库、retry幂等、错误翻译、取消由host负责。不开放原生generation路由，不将生成HTML立即执行。PBL planner/kernel函数不是通用agent工具集。

Agent：native Agent API/tools、owner cookie与原生流全部不接入。受控AI生成有公开契约，因此不用为未使用的runner身份/撤权提出必需上游改动。

Import：当前不能宣告server-side Node host可行。浏览器解析可选，用upload hook走智伴受控资源入口，解析结果/文件/外链均不可信；限制体积/压缩复杂度，服务端验证DSL与资源归属，upload失败不得发布半成品。内部XHR/DOM shim不进入目标依赖。完整Node/material pipeline延期，不阻塞Identity。

Asset推荐方案B见public-surface：可信服务端AssetPrincipal分区 +逐资源授权 +代理字节。不使用原生shared principal或signed URL绕开授权。标准AssetStore有资产生命周期维护契约，但删除Stage不等于立即不可读；mapping失效时必须先拒绝访问，垃圾回收另行负责。

## 四模型比较

本轮A/B/C/D是集成模型，不能与0A网络文档A/B/C同字母直接等同。内部依赖数量以0A I01–I08“依赖家族”为口径，不伪造代码import精确数。

| 评估维度 | A Native Web behind proxy | B Package Host（推荐） | C Hybrid | D Local auth fork |
|---|---|---|---|---|
| Security boundary | gateway+原生授权两套，易错位 | 单一Zhiban Application决策，包执行 | Application+服务边界双层 | 本地改造core，需全栈重审 |
| Browser bypass | 必须隔离所有直链/动作派生入口 | 不宿主原生routes；字节私有，仍须验证发布产物 | 所有原生服务私网+无派生直链 | 取决于补丁是否覆盖，不能假定 |
| Tenant isolation | 原生无业务Tenant，proxy逐资源补齐 | mapping+Application/Repository策略 | mapping贯穿调用与服务返回 | 容易污染上游表，不接受 |
| Identity mapping | cookie owner转换缺正式接线 | server opaque handles，拒绝浏览器principal | 服务principal额外转换 | 修改owner/session核心 |
| Runtime identity | dev入口阻塞未消失 | PgRuntimeStore公开构造+wrapper | 仍应package host；不能私网就信header | 修改server auth/bootstrapping |
| Asset access | shared principal+proxy风险 | AssetStore分区+授权字节gateway | 服务返回URL必须重新收口 | 定制媒体/存储所有路径 |
| Agent authorization | 无role/tool稳定桥，需关闭 | 原生Agent关闭，受控AI | 默认关闭，需明确service contract才接 | tool权限与撤权长期维护 |
| iframe | 原页面内部bridge不变 | 默认禁用，等待U02 | 私网不能解决浏览器消息边界 | 修改D类iframe，风险高 |
| Streaming | 原生流撤权未知 | 原生流关闭，host流另验证 | 双hop取消/背压/授权 | runner生命周期全面改造 |
| Editor | 原生授权/内部store依赖 | 独立slide editor候选 | slide同B，原生编辑无必要 | editor/store耦合补丁 |
| Generation | 原路由权限补齐 | generation + AICallFn | 可同B；远程服务需额外契约 | 定制routes/provider |
| Classroom/playback | 功能齐但授权与内部依赖重 | slide可用；完整U01未解决 | 私有Classroom仍缺安全host契约，不能自动成立 | 需要改造内部运行编排 |
| Upgrade compatibility | route/cookie/URL行为易变 | pin正式exports+contract tests | 包+service两套版本测试 | 每次merge重验补丁 |
| Published contracts | HTTP多为未版本化，缺身份hook | 六包正式exports；环境/能力限制明确 | 包强、原生service弱 | 主要依赖内部实现 |
| Internal dependency count | 完整原生集成涉及I01–I08共8家族 | 必需直接INTERNAL依赖0（候选约束，不是实现已测） | package部分0；native部分0–8取决于服务，未定 | 至少owner/store/runner/iframe等；全功能涉及8，非精确import数 |
| Required core changes | 缺契约时C/D，不能靠proxy消除 | 当前基础路径0；完整能力请求上游U01/U02，不本地改 | 未定，拒绝依赖C/D补丁方案 | YES，含C/D |
| Network complexity | 高，路由/流/资源全收口 | 中，应用+私有存储/provider | 高，额外服务拓扑和egress | 中至高，不减授权复杂度 |
| Deployment complexity | 两套web生命周期 | 新host与包版本管理，不跑原生web | 多服务、独立扩缩容/凭据 | 定制镜像/补丁版本 |
| Testing complexity | 原生面广、旁路繁多 | 必需能力contract+业务负例 | B+服务间auth/timeout测试 | 上游回归+安全补丁全量 |
| Operational observability | gateway/原生owner关联难 | Application trace+opaque mapping，脱敏 | 分布式trace+工作队列 | 定制埋点维护 |
| Failure isolation | 原生服务隔离，proxy仍可能泄漏 | 包故障同宿主；可受控worker/资源限额 | 重任务服务隔离较好 | 依部署，改core不自动隔离 |
| Future upstream synchronization | route兼容成本高 | upstream→main→sync/*→contracts→refactor | 另需服务协议矩阵 | 冲突最多，违背低fork目标 |

A不是“只加网关就安全”；B不是“package自动安全”；C不是“私有课堂天然安全”；D没有当前必须选择的证据。B的内部依赖0是硬约束：发现必须import internal即停止该能力，延期或请求上游，不把缺口藏进Adapter。

## 八个决策问题

1. OpenMAIC应视为private runtime capability吗？是，包括私有存储/执行能力；客户端renderer/editor是受限UI包，不是公开后台。
2. 浏览器是否只访问Zhiban public surface？目标是，仅经授权的智伴页面/API/resource gateway；不默认允许外部media/font/signed URL例外。
3. 是否需要原生Web pages？基础目标不需要，完整课堂缺口不能靠偷偷开放页面补齐。
4. 是否完全禁用Embedded HTTP Runtime？目标可以；没有修改当前入口，只建议未来host不装载它。
5. Package Host能否解决BLOCKED runtime？存在公开契约替代候选，静态可行；未验证的新wrapper不能标SAFE_ADAPTER。
6. 原9项如何变化？S05 slide编辑、S06 browser parser转package候选；S13/S14/S15/S17/S19关闭原生路径；S11/U01、S12/U02保留后续契约缺口。详见backlog。
7. 真正剩余上游扩展？2：U01完整课堂执行host、U02隔离Interactive host。
8. P0 blocker？当前Identity基础范围upstream P0为0；生产Bridge仍有host动态验证、范围批准与ADR Gate阻塞，不能混称“无阻塞”。完整课堂首发要求会使U01/U02成为发布P0。

## Mapping与权限不变项

Zhiban-owned mapping + opaque OpenMAIC ids；owner不等于UserId，learnerKey不等于MembershipId。宿主替换不改变ADR004数据所有权。mapping本身仍不够，需原生入口不暴露、字节不可直达、每次Application授权。CREATE/PUBLISH/TRANSFER/DISABLE/REVOKE/DELETE/ORPHAN/RECONCILE/RETRY细则见public-surface；跨系统一致性不能假装单事务解决。

OpenMAIC published最多渲染状态，不授予Enrollment或Tenant访问。Tenant Admin并非学习证据默认读者。浏览器runtime/iframe报告必须标不可信，Assessment服务独立验证。

## Phase Gate — 人工批准的Closeout

本次人工已批准计划变更；phase1b-implementation-plan.md与phase1b-gate-map.md已同步。Phase1A领域结论不变。以下为当前Gate，取代本报告上一轮CONDITIONAL/BLOCKED的Identity总前置判断。

| Gate | 当前结论 | 前置与范围 |
|---|---|---|
| IDENTITY_DOMAIN_1B1 | ALLOWED | Phase1A frozen；ADR007/008/009 accepted；0R closeout accepted；不依赖Bridge/ADR012/全量0B |
| REPOSITORY_PORTS_1B2 | ALLOWED_AFTER_1B1 | 仅Identity ports；不实现OpenMAIC Adapter或泄漏内部DTO |
| IDENTITY_SCHEMA_1B3 | ALLOWED_AFTER_1B1_AND_1B2_REVIEW | 独立Identity schema review；禁止OpenMAIC resource mapping |
| OPENMAIC_BRIDGE_1B9 | BLOCKED | 对应必需capabilities通过0B、ADR012明确人工接受、无P0 unresolved blocker，并满足Identity前置 |

ADR013回答WHERE capability lives；ADR014回答HOW优先消费；ADR012回答具体identity/authorization如何安全桥接到每类资源。013/014已接受架构方向，实施/覆盖延期；012保持PROPOSED，不能自动接受。

PROPOSED_PLAN_CHANGE: APPROVED BY HUMAN REVIEW。
两Track逻辑拆分，非两个项目；Identity 1B1–8顺序且逐批review，0B只在对应OpenMAIC能力准备实现/开放前执行。OpenMAIC mapping persistence归1B9或独立子批次，不进入Identity schema。本次不开始1B1。

P0 IDENTITY BLOCKERS: 0。完整Classroom/Playback与隔离Interactive协议仍为2项上游扩展；Bridge没有通过，不能写FULLY_RESOLVED或P0 BRIDGE BLOCKERS为0。

## Deliverables与验证范围

新建6份phase1文档：本报告、capability-necessity、public-surface、upstream-extension-backlog、feature-disable-matrix、0b-diagnostic-plan；ADR013/014经人工接受架构方向。
10关闭 +5延期条目；0B10个按启用时点分层的surface families。无dynamic PASS、无部署验收、无源码或测试变更、无数据库操作、无V1读写、无git add/commit/push。
