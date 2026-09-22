# OpenMAIC Authorization Surface Static Audit — 1B-0A

Status: STATIC AUDIT COMPLETE / ARCHITECTURE_REVIEW_REQUIRED。日期：2026-09-22。
冻结文档提交：`700a7673becf0518bc6f8b2861229ee985c5d063`。
源码基线：`4d2e2bab82374ed45b95964a1f2ed03362666e1c`。
工作目录：`E:\openmaic\zhiban`，分支：`refactor/zhiban-v2`。

## 范围、证据与计数

开始时 branch / HEAD / clean gate 全部通过。固定基线到 HEAD 的 app、components、lib、packages、render-service、tests、e2e、middleware.ts、next.config.ts 源码 diff 为空。
已先阅读 architecture baseline、core boundary、ADR-001 至 ADR-012，以及冻结 bridge、implementation-plan、auth-boundary、authorization-flow、identity-threat-model、tenant-isolation。
本报告不重写 Phase 1A，不改变 ADR 状态。未运行测试、应用、HTTP请求、数据库或部署；未读取真实凭据。

统计单位：
- **20 个 surface**：下表 S01–S20；VERDICT汇总按这20组，不按重复调用次数。
- **133 个入口/操作**：81个显式非persistence Next route方法 + 24个persistence子操作 + 6个page + 1个Server Action + 15个组件/进程内/URL入口 + 6个render-service HTTP入口。
- 扫描69个 Next route文件，共86个显式方法；catch-all的5个方法不重复计入入口，其24个子操作单独列出。HEAD asset是package契约且Next隐式分派需验证，不声称已有显式HEAD export。
- 公开稳定契约按5个安全相关契约族统计，不将每个export重复计数。内部依赖按8个家族统计。
- 源码行号为固定快照锚点；入口表列出handler声明或实际委托实现，不以过时注释替代执行逻辑。
- “浏览器可达”表示源码暴露可调用入口，在相应feature/config开启且通过可选部署access code时；**不是已探测生产网络**。API并非都可用地址栏GET调用。
- NETWORK_ISOLATION_REQUIRED只是隔离必要条件与候选适配路径，不代表私网配置已实施，也不代表动态验证完成。
- CORE CHANGE REQUIRED=YES只针对保留现有内嵌Runtime认证/原生authenticated publish路径的必需安全接线；仅上游候选，绝不授权本地C/D修改。独立package宿主可能绕开此路径，尚未证明完整集成。

## 关键静态结论

1. **Stage读不是owner-only**。`lib/persistence/owner-bound-document-store.ts:255`只有非read才比对owner；`document-access.ts:68`读取仅要求meta未deleted。`tests/persistence/stage-access-fidelity.test.ts:101`明确验证visitor能读、不能写、列表只含自有文档。部分route头注释称foreign read 404，与实际实现冲突；以代码和测试为准。
2. **Classroom不是授权网关**。client page → ClassroomSurface → loadFromStorage → HttpDocumentStore或浏览器存储 → Stage/Scene；必要时fallback `/api/classroom?id=`读取文件。sidecar isOwner控制编辑/续生成，不阻断按ID读取。旧文件路径没有owner模型。
3. **Playback单独存在于Stage模式而非独立page**。页面目录无playback/share page；播放、编辑共用壳但数据/素材/runtime授权分开。未删除文档ID可能足够播放；public=false也不阻止读取。V2 published但Tenant-scoped应属于Zhiban发布/Enrollment policy，不可直接等于OpenMAIC public。
4. **Asset全局shared是实际应用策略，不是package限制**。嵌入route对documents/assets不使用dev authenticator，虽仍要求PERSISTENCE_DEV_TOKEN配置存在；assets key固定shared，读/allocate开放、替换/删除全拒。package本身可按principal分区，但当前应用没采用tenant/user分区。stage metadata不是访问凭据。
5. Asset registry中document引用计数负责生命周期，不是读授权；最后引用撤销后仍有GC宽限，多文档共享可继续存活，signed URL在expiry前也是bearer。Stage删除不等于立刻撤销全部素材访问。
6. **legacy classroom-media没有tombstone veto**，只有路径/realpath/Range检查，成功响应public缓存一天。`lib/server/media-origin.ts`注释声称private/tombstone，不符合实际route。供应商直接URL进一步脱离应用撤销。
7. **Runtime生产路径不能启用insecure作为修复**。package验证learnerKey与session分区，但embedded将客户端header作为principal来源。生产默认拒绝是保护；无可信Enrollment/Attempt绑定。Postgres RuntimeStore按stage/learner保存不意味着验证document存在或课程权限。
8. Agent session owner是匿名cookie；`authenticatedOwnerId`只在helper定义/测试出现，当前调用不传。UUID格式和HttpOnly不使cookie成为签名身份。知道他人的UUID才可能冒用；不能把“可自选新UUID”夸大为可猜中所有用户。
9. Agent工具捕获session owner并做owner stage probe/事务lease保护，不能说完全无授权；但所有获得入口的匿名用户可创建自己的authoring session，无Teacher/Student工具权限区分。后台media job与主run lease不同，关闭SSE不等于撤销后台写。
10. iframe sandbox有隔离且严格source校验，不能笼统说任意其他iframe可伪造。observation身份只是关联字段，不是认证token；恶意当前frame的自报告不可升级为可信学习成绩。外链资源仍可能绕过gateway。
11. 唯一Server Action `deleteWorkspaceSession`重新解析cookie但没有业务认证；middleware对页面请求放行而API拒绝分支不适用。属于未来Zhiban网关旁路候选，不宣称已动态复现未认证删除。
12. server components未发现直接读取目标业务存储；但runner/after job/server helpers直接访问存储，不能以API网关自然覆盖。render-service存在独立HTTP面，job读/删/下载无owner检查。

## 搜索证据与不存在项

在 app/components/lib/packages 的 ts/tsx 中全文搜索 `use server`：真正directive仅 `lib/workbench/workspace-actions.ts:1`；其余命中为注释。仅1个导出action。
`rg --files app` 的page清单：根、classroom/[id]、generation-preview、workspace、workbench/new、eval/whiteboard。独立playback page、share page、editor page、Stage/Scene Server Action：**NOT_PRESENT**（功能在组件/API中，不是功能不存在）。
`rg -n 'getServerPersistenceProvider|new Pg|loadDocument|readClassroom|cookies\\(' app components --glob '*.tsx'`：只有generation-preview客户端loadDocumentBlob，无服务端业务直读命中；WorkspaceEntry只包装client WorkspaceShell。layout只包装providers/AccessCodeGuard。packages/docs为文档站，不是业务授权面。
iframe存储shim为in-memory localStorage/sessionStorage；未发现其直接转发任意storage操作到RuntimeStore的message handler：**NOT_PRESENT**。观察桥和quiz/PBL/whiteboard runtime链分别列出，不发明统一runtime bridge。
全仓核心调用搜索 `authenticatedOwnerId|resolveRequestOwnerId\\(`：with-owner、两个agent SSE、stage freshness均未传第三参。
搜索 `fetch|proxyFetch|/api/` 覆盖lib/server、lib/persistence与app：主要内部服务调用为render/preview，业务job直接调用helpers，浏览器bootstrap直连/api/persistence。没有发现通用“内部请求自动经过Zhiban授权”机制。
配置只读检查：middleware、next.config、docker-compose；compose发布3000:3000，render expose。不能据此认定真实防火墙/对象桶权限。未读取.env。
已有测试仅静态阅读：stage-access-fidelity、server-auth、owner、runtime-reference-server、asset-http-egress，以及iframe/source相关测试。未执行；旧CI PASS不能替代本报告新增安全场景的0B验证。

## 稳定契约目录

| ID | 契约族 | 分类 | 支撑与边界 |
|---|---|---|---|
| C01 | @openmaic/dsl validators / versioned DTO | PUBLIC_STABLE | package.json exports，纯DSL，不包含Zhiban身份；只在adapter翻译，不进Domain |
| C02 | DocumentStore / HttpDocumentStore | PUBLIC_STABLE | storage exports + docs/document-http-contract.md + test/document-contract.ts；宿主负责授权，无tenant语义 |
| C03 | RuntimeStore / HTTP | PUBLIC_STABLE | docs/runtime-http-contract.md:55 + test/runtime-reference-server.test.ts；learner key必须由可信认证验证 |
| C04 | AssetStore / HTTP / byte egress | PUBLIC_STABLE | docs/asset-http-contract.md + test/asset-http-egress.test.ts；principal、redirect、expiry契约不等于应用已安全 |
| C05 | storage/server factory authentication & authorization hooks | PUBLIC_STABLE | src/server/index.ts:728、document.ts:316、asset.ts:575；可构造独立宿主，不能热注入现有Next route |

PUBLIC_STABLE含义是固定版本显式export/文档/测试保护，不承诺永不破坏兼容。storage版本0.31.1、dsl版本0.11.2。其他公开export（renderer/editor/importer等）不计入5个安全契约族；没有证据说明它们承诺应用身份/授权接口。
Next JSON/SSE/页面：PUBLIC_BUT_UNVERSIONED。供应商URL撤销/TTL：UNKNOWN，按provider分别诊断。

8个INTERNAL-only依赖家族：I01 app anonymous owner/with-owner；I02 stage_meta/stage-access/owner-bound SQL；I03 embedded persistence principal/bootstrap；I04 Zustand Stage/editor/playback orchestration；I05 iframe patch/pool/observation；I06 agent runner/tools/lease；I07 job/material/asset server helpers；I08 Next Server Action/UI authoring orchestration。底层可引用公开package不使这些应用家族变为PUBLIC_STABLE。

## Surface汇总

| ID | SURFACE | VERDICT | VERIFICATION_STATUS | CORE边界 |
|---|---|---|---|---|
| S01 | Classroom | NETWORK_ISOLATION_REQUIRED | REQUIRES_ISOLATED_DIAGNOSTIC | A |
| S02 | Stage / Scene / Document | NETWORK_ISOLATION_REQUIRED | REQUIRES_ISOLATED_DIAGNOSTIC | A（route）/ D（store） |
| S03 | Playback | NETWORK_ISOLATION_REQUIRED | REQUIRES_ISOLATED_DIAGNOSTIC | A/C |
| S04 | Generation | NETWORK_ISOLATION_REQUIRED | REQUIRES_ISOLATED_DIAGNOSTIC | A |
| S05 | Edit / Editor | UPSTREAM_EXTENSION_REQUIRED | REQUIRES_ISOLATED_DIAGNOSTIC | C / D |
| S06 | Import / Materials | UPSTREAM_EXTENSION_REQUIRED | REQUIRES_ISOLATED_DIAGNOSTIC | B（parser）/ A/C（agent） |
| S07 | Asset | NETWORK_ISOLATION_REQUIRED | REQUIRES_ISOLATED_DIAGNOSTIC | B（contract）/ D（embedded） |
| S08 | Media / Proxy | NETWORK_ISOLATION_REQUIRED | REQUIRES_ISOLATED_DIAGNOSTIC | A |
| S09 | Download / Render | NETWORK_ISOLATION_REQUIRED | REQUIRES_ISOLATED_DIAGNOSTIC | A/C |
| S10 | Embedded HTTP Runtime | BLOCKED | STATIC_CONFIRMED | D（embedded auth）/ B（package） |
| S11 | Quiz / PBL / Whiteboard Runtime | UPSTREAM_EXTENSION_REQUIRED | REQUIRES_ISOLATED_DIAGNOSTIC | B（runtime seam）/ C/D（internal） |
| S12 | Interactive Runtime / iframe | UPSTREAM_EXTENSION_REQUIRED | REQUIRES_ISOLATED_DIAGNOSTIC | D |
| S13 | Agent / Tools | UPSTREAM_EXTENSION_REQUIRED | REQUIRES_ISOLATED_DIAGNOSTIC | A/C |
| S14 | Agent / Stage Streaming | UPSTREAM_EXTENSION_REQUIRED | REQUIRES_ISOLATED_DIAGNOSTIC | A/C |
| S15 | Server Actions | UPSTREAM_EXTENSION_REQUIRED | REQUIRES_ISOLATED_DIAGNOSTIC | C |
| S16 | Direct Browser Pages | NETWORK_ISOLATION_REQUIRED | REQUIRES_ISOLATED_DIAGNOSTIC | A/C |
| S17 | Public / Published | UPSTREAM_EXTENSION_REQUIRED | STATIC_CONFIRMED | D（stage-access）/ A（route） |
| S18 | Signed / Generated URLs | NETWORK_ISOLATION_REQUIRED | REQUIRES_ISOLATED_DIAGNOSTIC | B（byte-egress contract）/ A |
| S19 | Internal Server / Components / Fetch | UPSTREAM_EXTENSION_REQUIRED | REQUIRES_ISOLATED_DIAGNOSTIC | C/D |
| S20 | Provider / Platform Support | NETWORK_ISOLATION_REQUIRED | REQUIRES_ISOLATED_DIAGNOSTIC | A/C |

STATIC_CONFIRMED仅表示S10现有不安全模式的拒绝结论、S17未接线结论可由源码确认，不表示替代方案可上线。其他18组需要隔离诊断，不允许自动进入0B。

## 完整入口记录

以下每条记录自包含要求的字段。同一surface共享结论是有意的：组级判定取最严格的完整使用路径；这不会把只读health误当作Stage授权，也不会将package存在等同于live endpoint安全。

### EP-001 — GET /api/access-code/status

| Field | Evidence / finding |
|---|---|
| SURFACE | S20 Provider / Platform Support |
| ENTRY POINT | /api/access-code/status |
| SOURCE LOCATION | app/api/access-code/status/route.ts:5 |
| INVOCATION | HTTP route |
| HTTP METHOD | GET |
| RESOURCE IDENTIFIER | provider/model / usage period / config |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；deployment access code / clientIdentity / provider credential |
| CURRENT PRINCIPAL | deployment access code / clientIdentity / provider credential |
| AUTHORIZATION DECISION | status/verify在middleware豁免；verify有限速和常量时间比较，发7天HMAC cookie；不是Zhiban用户登录。 provider探测、usage、search、voices和健康/开关端点没有Zhiban RBAC。默认access code是部署门，不是租户门；health/status显式例外。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | 业务资源请求YES；health/config无资源可N/A |
| SUPPORTED PUBLIC CONTRACT | HTTP PUBLIC_BUT_UNVERSIONED；server credential策略 INTERNAL |
| INTERNAL DEPENDENCY | middleware.ts；app/api/usage/route.ts；app/api/server-providers/route.ts；app/api/access-code/verify/route.ts；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/api/access-code/status/route.ts:5；middleware.ts；app/api/usage/route.ts；app/api/server-providers/route.ts；app/api/access-code/verify/route.ts |

### EP-002 — POST /api/access-code/verify

| Field | Evidence / finding |
|---|---|
| SURFACE | S20 Provider / Platform Support |
| ENTRY POINT | /api/access-code/verify |
| SOURCE LOCATION | app/api/access-code/verify/route.ts:20 |
| INVOCATION | HTTP route |
| HTTP METHOD | POST |
| RESOURCE IDENTIFIER | provider/model / usage period / config |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；deployment access code / clientIdentity / provider credential |
| CURRENT PRINCIPAL | deployment access code / clientIdentity / provider credential |
| AUTHORIZATION DECISION | status/verify在middleware豁免；verify有限速和常量时间比较，发7天HMAC cookie；不是Zhiban用户登录。 provider探测、usage、search、voices和健康/开关端点没有Zhiban RBAC。默认access code是部署门，不是租户门；health/status显式例外。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | 业务资源请求YES；health/config无资源可N/A |
| SUPPORTED PUBLIC CONTRACT | HTTP PUBLIC_BUT_UNVERSIONED；server credential策略 INTERNAL |
| INTERNAL DEPENDENCY | middleware.ts；app/api/usage/route.ts；app/api/server-providers/route.ts；app/api/access-code/verify/route.ts；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/api/access-code/verify/route.ts:20；middleware.ts；app/api/usage/route.ts；app/api/server-providers/route.ts；app/api/access-code/verify/route.ts |

### EP-003 — GET /api/agent/owner-events

| Field | Evidence / finding |
|---|---|
| SURFACE | S14 Agent / Stage Streaming |
| ENTRY POINT | /api/agent/owner-events |
| SOURCE LOCATION | app/api/agent/owner-events/route.ts:39 |
| INVOCATION | HTTP route |
| HTTP METHOD | GET |
| RESOURCE IDENTIFIER | sessionId / event cursor / stageId |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；建立连接时owner；没有Zhiban authorizationVersion |
| CURRENT PRINCIPAL | 建立连接时owner；没有Zhiban authorizationVersion |
| AUTHORIZATION DECISION | SSE建立时读取owner/session；阶段freshness读取也是capability-by-id。轮询/断连/lease不包含Zhiban角色、Membership、Tenant撤销检查；取消stream不保证后台工具停止。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：外围能拒绝入口，但完整安全接线尚无稳定支持 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | SSE协议 PUBLIC_BUT_UNVERSIONED；runner lease/revocation INTERNAL |
| INTERNAL DEPENDENCY | app/api/agent/sessions/[id]/events/route.ts:77；app/api/agent/owner-events/route.ts:49；app/api/stages/[id]/freshness/route.ts:50；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |
| EVIDENCE | app/api/agent/owner-events/route.ts:39；app/api/agent/sessions/[id]/events/route.ts:77；app/api/agent/owner-events/route.ts:49；app/api/stages/[id]/freshness/route.ts:50 |

### EP-004 — GET /api/agent/runtime

| Field | Evidence / finding |
|---|---|
| SURFACE | S13 Agent / Tools |
| ENTRY POINT | /api/agent/runtime |
| SOURCE LOCATION | app/api/agent/runtime/route.ts:18 |
| INVOCATION | HTTP route |
| HTTP METHOD | GET |
| RESOURCE IDENTIFIER | agent sessionId / owner / stageId / skillId |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；anonymous owner → durable agent meta.ownerId |
| CURRENT PRINCIPAL | anonymous owner → durable agent meta.ownerId |
| AUTHORIZATION DECISION | 运行配置探测；不是session鉴权。 session按anonymous owner隔离；authenticatedOwnerId可选参数没有真实调用接线。runner从durable meta.ownerId绑定工具，保护外来owner写入，但不区分Teacher/Student。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：外围能拒绝入口，但完整安全接线尚无稳定支持 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | AgentSessionStore公开存储不等于runner授权；runner/tool policy INTERNAL |
| INTERNAL DEPENDENCY | lib/server/agent-runtime/owner.ts:63；lib/server/agent-runtime/with-owner.ts:17；lib/server/agent-runtime/runner.ts:1303；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |
| EVIDENCE | app/api/agent/runtime/route.ts:18；lib/server/agent-runtime/owner.ts:63；lib/server/agent-runtime/with-owner.ts:17；lib/server/agent-runtime/runner.ts:1303 |

### EP-005 — POST /api/agent/sessions

| Field | Evidence / finding |
|---|---|
| SURFACE | S13 Agent / Tools |
| ENTRY POINT | /api/agent/sessions |
| SOURCE LOCATION | app/api/agent/sessions/route.ts:38 |
| INVOCATION | HTTP route |
| HTTP METHOD | POST |
| RESOURCE IDENTIFIER | agent sessionId / owner / stageId / skillId |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；anonymous owner → durable agent meta.ownerId |
| CURRENT PRINCIPAL | anonymous owner → durable agent meta.ownerId |
| AUTHORIZATION DECISION | session按anonymous owner隔离；authenticatedOwnerId可选参数没有真实调用接线。runner从durable meta.ownerId绑定工具，保护外来owner写入，但不区分Teacher/Student。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：外围能拒绝入口，但完整安全接线尚无稳定支持 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | AgentSessionStore公开存储不等于runner授权；runner/tool policy INTERNAL |
| INTERNAL DEPENDENCY | lib/server/agent-runtime/owner.ts:63；lib/server/agent-runtime/with-owner.ts:17；lib/server/agent-runtime/runner.ts:1303；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |
| EVIDENCE | app/api/agent/sessions/route.ts:38；lib/server/agent-runtime/owner.ts:63；lib/server/agent-runtime/with-owner.ts:17；lib/server/agent-runtime/runner.ts:1303 |

### EP-006 — GET /api/agent/sessions

| Field | Evidence / finding |
|---|---|
| SURFACE | S13 Agent / Tools |
| ENTRY POINT | /api/agent/sessions |
| SOURCE LOCATION | app/api/agent/sessions/route.ts:191 |
| INVOCATION | HTTP route |
| HTTP METHOD | GET |
| RESOURCE IDENTIFIER | agent sessionId / owner / stageId / skillId |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；anonymous owner → durable agent meta.ownerId |
| CURRENT PRINCIPAL | anonymous owner → durable agent meta.ownerId |
| AUTHORIZATION DECISION | session按anonymous owner隔离；authenticatedOwnerId可选参数没有真实调用接线。runner从durable meta.ownerId绑定工具，保护外来owner写入，但不区分Teacher/Student。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：外围能拒绝入口，但完整安全接线尚无稳定支持 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | AgentSessionStore公开存储不等于runner授权；runner/tool policy INTERNAL |
| INTERNAL DEPENDENCY | lib/server/agent-runtime/owner.ts:63；lib/server/agent-runtime/with-owner.ts:17；lib/server/agent-runtime/runner.ts:1303；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |
| EVIDENCE | app/api/agent/sessions/route.ts:191；lib/server/agent-runtime/owner.ts:63；lib/server/agent-runtime/with-owner.ts:17；lib/server/agent-runtime/runner.ts:1303 |

### EP-007 — GET /api/agent/sessions/status

| Field | Evidence / finding |
|---|---|
| SURFACE | S13 Agent / Tools |
| ENTRY POINT | /api/agent/sessions/status |
| SOURCE LOCATION | app/api/agent/sessions/status/route.ts:11 |
| INVOCATION | HTTP route |
| HTTP METHOD | GET |
| RESOURCE IDENTIFIER | agent sessionId / owner / stageId / skillId |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；anonymous owner → durable agent meta.ownerId |
| CURRENT PRINCIPAL | anonymous owner → durable agent meta.ownerId |
| AUTHORIZATION DECISION | session按anonymous owner隔离；authenticatedOwnerId可选参数没有真实调用接线。runner从durable meta.ownerId绑定工具，保护外来owner写入，但不区分Teacher/Student。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：外围能拒绝入口，但完整安全接线尚无稳定支持 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | AgentSessionStore公开存储不等于runner授权；runner/tool policy INTERNAL |
| INTERNAL DEPENDENCY | lib/server/agent-runtime/owner.ts:63；lib/server/agent-runtime/with-owner.ts:17；lib/server/agent-runtime/runner.ts:1303；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |
| EVIDENCE | app/api/agent/sessions/status/route.ts:11；lib/server/agent-runtime/owner.ts:63；lib/server/agent-runtime/with-owner.ts:17；lib/server/agent-runtime/runner.ts:1303 |

### EP-008 — GET /api/agent/sessions/[id]

| Field | Evidence / finding |
|---|---|
| SURFACE | S13 Agent / Tools |
| ENTRY POINT | /api/agent/sessions/[id] |
| SOURCE LOCATION | app/api/agent/sessions/[id]/route.ts:13 |
| INVOCATION | HTTP route |
| HTTP METHOD | GET |
| RESOURCE IDENTIFIER | agent sessionId / owner / stageId / skillId |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；anonymous owner → durable agent meta.ownerId |
| CURRENT PRINCIPAL | anonymous owner → durable agent meta.ownerId |
| AUTHORIZATION DECISION | session按anonymous owner隔离；authenticatedOwnerId可选参数没有真实调用接线。runner从durable meta.ownerId绑定工具，保护外来owner写入，但不区分Teacher/Student。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：外围能拒绝入口，但完整安全接线尚无稳定支持 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | AgentSessionStore公开存储不等于runner授权；runner/tool policy INTERNAL |
| INTERNAL DEPENDENCY | lib/server/agent-runtime/owner.ts:63；lib/server/agent-runtime/with-owner.ts:17；lib/server/agent-runtime/runner.ts:1303；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |
| EVIDENCE | app/api/agent/sessions/[id]/route.ts:13；lib/server/agent-runtime/owner.ts:63；lib/server/agent-runtime/with-owner.ts:17；lib/server/agent-runtime/runner.ts:1303 |

### EP-009 — PATCH /api/agent/sessions/[id]

| Field | Evidence / finding |
|---|---|
| SURFACE | S13 Agent / Tools |
| ENTRY POINT | /api/agent/sessions/[id] |
| SOURCE LOCATION | app/api/agent/sessions/[id]/route.ts:29 |
| INVOCATION | HTTP route |
| HTTP METHOD | PATCH |
| RESOURCE IDENTIFIER | agent sessionId / owner / stageId / skillId |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；anonymous owner → durable agent meta.ownerId |
| CURRENT PRINCIPAL | anonymous owner → durable agent meta.ownerId |
| AUTHORIZATION DECISION | session按anonymous owner隔离；authenticatedOwnerId可选参数没有真实调用接线。runner从durable meta.ownerId绑定工具，保护外来owner写入，但不区分Teacher/Student。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：外围能拒绝入口，但完整安全接线尚无稳定支持 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | AgentSessionStore公开存储不等于runner授权；runner/tool policy INTERNAL |
| INTERNAL DEPENDENCY | lib/server/agent-runtime/owner.ts:63；lib/server/agent-runtime/with-owner.ts:17；lib/server/agent-runtime/runner.ts:1303；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |
| EVIDENCE | app/api/agent/sessions/[id]/route.ts:29；lib/server/agent-runtime/owner.ts:63；lib/server/agent-runtime/with-owner.ts:17；lib/server/agent-runtime/runner.ts:1303 |

### EP-010 — POST /api/agent/sessions/[id]/cancel

| Field | Evidence / finding |
|---|---|
| SURFACE | S13 Agent / Tools |
| ENTRY POINT | /api/agent/sessions/[id]/cancel |
| SOURCE LOCATION | app/api/agent/sessions/[id]/cancel/route.ts:16 |
| INVOCATION | HTTP route |
| HTTP METHOD | POST |
| RESOURCE IDENTIFIER | agent sessionId / owner / stageId / skillId |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；anonymous owner → durable agent meta.ownerId |
| CURRENT PRINCIPAL | anonymous owner → durable agent meta.ownerId |
| AUTHORIZATION DECISION | session按anonymous owner隔离；authenticatedOwnerId可选参数没有真实调用接线。runner从durable meta.ownerId绑定工具，保护外来owner写入，但不区分Teacher/Student。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：外围能拒绝入口，但完整安全接线尚无稳定支持 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | AgentSessionStore公开存储不等于runner授权；runner/tool policy INTERNAL |
| INTERNAL DEPENDENCY | lib/server/agent-runtime/owner.ts:63；lib/server/agent-runtime/with-owner.ts:17；lib/server/agent-runtime/runner.ts:1303；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |
| EVIDENCE | app/api/agent/sessions/[id]/cancel/route.ts:16；lib/server/agent-runtime/owner.ts:63；lib/server/agent-runtime/with-owner.ts:17；lib/server/agent-runtime/runner.ts:1303 |

### EP-011 — GET /api/agent/sessions/[id]/events

| Field | Evidence / finding |
|---|---|
| SURFACE | S14 Agent / Stage Streaming |
| ENTRY POINT | /api/agent/sessions/[id]/events |
| SOURCE LOCATION | app/api/agent/sessions/[id]/events/route.ts:62 |
| INVOCATION | HTTP route |
| HTTP METHOD | GET |
| RESOURCE IDENTIFIER | sessionId / event cursor / stageId |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；建立连接时owner；没有Zhiban authorizationVersion |
| CURRENT PRINCIPAL | 建立连接时owner；没有Zhiban authorizationVersion |
| AUTHORIZATION DECISION | SSE建立时读取owner/session；阶段freshness读取也是capability-by-id。轮询/断连/lease不包含Zhiban角色、Membership、Tenant撤销检查；取消stream不保证后台工具停止。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：外围能拒绝入口，但完整安全接线尚无稳定支持 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | SSE协议 PUBLIC_BUT_UNVERSIONED；runner lease/revocation INTERNAL |
| INTERNAL DEPENDENCY | app/api/agent/sessions/[id]/events/route.ts:77；app/api/agent/owner-events/route.ts:49；app/api/stages/[id]/freshness/route.ts:50；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |
| EVIDENCE | app/api/agent/sessions/[id]/events/route.ts:62；app/api/agent/sessions/[id]/events/route.ts:77；app/api/agent/owner-events/route.ts:49；app/api/stages/[id]/freshness/route.ts:50 |

### EP-012 — POST /api/agent/sessions/[id]/messages

| Field | Evidence / finding |
|---|---|
| SURFACE | S13 Agent / Tools |
| ENTRY POINT | /api/agent/sessions/[id]/messages |
| SOURCE LOCATION | app/api/agent/sessions/[id]/messages/route.ts:21 |
| INVOCATION | HTTP route |
| HTTP METHOD | POST |
| RESOURCE IDENTIFIER | agent sessionId / owner / stageId / skillId |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；anonymous owner → durable agent meta.ownerId |
| CURRENT PRINCIPAL | anonymous owner → durable agent meta.ownerId |
| AUTHORIZATION DECISION | session按anonymous owner隔离；authenticatedOwnerId可选参数没有真实调用接线。runner从durable meta.ownerId绑定工具，保护外来owner写入，但不区分Teacher/Student。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：外围能拒绝入口，但完整安全接线尚无稳定支持 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | AgentSessionStore公开存储不等于runner授权；runner/tool policy INTERNAL |
| INTERNAL DEPENDENCY | lib/server/agent-runtime/owner.ts:63；lib/server/agent-runtime/with-owner.ts:17；lib/server/agent-runtime/runner.ts:1303；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |
| EVIDENCE | app/api/agent/sessions/[id]/messages/route.ts:21；lib/server/agent-runtime/owner.ts:63；lib/server/agent-runtime/with-owner.ts:17；lib/server/agent-runtime/runner.ts:1303 |

### EP-013 — GET /api/agent/skills

| Field | Evidence / finding |
|---|---|
| SURFACE | S13 Agent / Tools |
| ENTRY POINT | /api/agent/skills |
| SOURCE LOCATION | app/api/agent/skills/route.ts:26 |
| INVOCATION | HTTP route |
| HTTP METHOD | GET |
| RESOURCE IDENTIFIER | agent sessionId / owner / stageId / skillId |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；anonymous owner → durable agent meta.ownerId |
| CURRENT PRINCIPAL | anonymous owner → durable agent meta.ownerId |
| AUTHORIZATION DECISION | session按anonymous owner隔离；authenticatedOwnerId可选参数没有真实调用接线。runner从durable meta.ownerId绑定工具，保护外来owner写入，但不区分Teacher/Student。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：外围能拒绝入口，但完整安全接线尚无稳定支持 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | AgentSessionStore公开存储不等于runner授权；runner/tool policy INTERNAL |
| INTERNAL DEPENDENCY | lib/server/agent-runtime/owner.ts:63；lib/server/agent-runtime/with-owner.ts:17；lib/server/agent-runtime/runner.ts:1303；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |
| EVIDENCE | app/api/agent/skills/route.ts:26；lib/server/agent-runtime/owner.ts:63；lib/server/agent-runtime/with-owner.ts:17；lib/server/agent-runtime/runner.ts:1303 |

### EP-014 — POST /api/agent/skills

| Field | Evidence / finding |
|---|---|
| SURFACE | S13 Agent / Tools |
| ENTRY POINT | /api/agent/skills |
| SOURCE LOCATION | app/api/agent/skills/route.ts:47 |
| INVOCATION | HTTP route |
| HTTP METHOD | POST |
| RESOURCE IDENTIFIER | agent sessionId / owner / stageId / skillId |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；anonymous owner → durable agent meta.ownerId |
| CURRENT PRINCIPAL | anonymous owner → durable agent meta.ownerId |
| AUTHORIZATION DECISION | session按anonymous owner隔离；authenticatedOwnerId可选参数没有真实调用接线。runner从durable meta.ownerId绑定工具，保护外来owner写入，但不区分Teacher/Student。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：外围能拒绝入口，但完整安全接线尚无稳定支持 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | AgentSessionStore公开存储不等于runner授权；runner/tool policy INTERNAL |
| INTERNAL DEPENDENCY | lib/server/agent-runtime/owner.ts:63；lib/server/agent-runtime/with-owner.ts:17；lib/server/agent-runtime/runner.ts:1303；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |
| EVIDENCE | app/api/agent/skills/route.ts:47；lib/server/agent-runtime/owner.ts:63；lib/server/agent-runtime/with-owner.ts:17；lib/server/agent-runtime/runner.ts:1303 |

### EP-015 — GET /api/agent/skills/[id]

| Field | Evidence / finding |
|---|---|
| SURFACE | S13 Agent / Tools |
| ENTRY POINT | /api/agent/skills/[id] |
| SOURCE LOCATION | app/api/agent/skills/[id]/route.ts:17 |
| INVOCATION | HTTP route |
| HTTP METHOD | GET |
| RESOURCE IDENTIFIER | agent sessionId / owner / stageId / skillId |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；anonymous owner → durable agent meta.ownerId |
| CURRENT PRINCIPAL | anonymous owner → durable agent meta.ownerId |
| AUTHORIZATION DECISION | session按anonymous owner隔离；authenticatedOwnerId可选参数没有真实调用接线。runner从durable meta.ownerId绑定工具，保护外来owner写入，但不区分Teacher/Student。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：外围能拒绝入口，但完整安全接线尚无稳定支持 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | AgentSessionStore公开存储不等于runner授权；runner/tool policy INTERNAL |
| INTERNAL DEPENDENCY | lib/server/agent-runtime/owner.ts:63；lib/server/agent-runtime/with-owner.ts:17；lib/server/agent-runtime/runner.ts:1303；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |
| EVIDENCE | app/api/agent/skills/[id]/route.ts:17；lib/server/agent-runtime/owner.ts:63；lib/server/agent-runtime/with-owner.ts:17；lib/server/agent-runtime/runner.ts:1303 |

### EP-016 — DELETE /api/agent/skills/[id]

| Field | Evidence / finding |
|---|---|
| SURFACE | S13 Agent / Tools |
| ENTRY POINT | /api/agent/skills/[id] |
| SOURCE LOCATION | app/api/agent/skills/[id]/route.ts:30 |
| INVOCATION | HTTP route |
| HTTP METHOD | DELETE |
| RESOURCE IDENTIFIER | agent sessionId / owner / stageId / skillId |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；anonymous owner → durable agent meta.ownerId |
| CURRENT PRINCIPAL | anonymous owner → durable agent meta.ownerId |
| AUTHORIZATION DECISION | session按anonymous owner隔离；authenticatedOwnerId可选参数没有真实调用接线。runner从durable meta.ownerId绑定工具，保护外来owner写入，但不区分Teacher/Student。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：外围能拒绝入口，但完整安全接线尚无稳定支持 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | AgentSessionStore公开存储不等于runner授权；runner/tool policy INTERNAL |
| INTERNAL DEPENDENCY | lib/server/agent-runtime/owner.ts:63；lib/server/agent-runtime/with-owner.ts:17；lib/server/agent-runtime/runner.ts:1303；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |
| EVIDENCE | app/api/agent/skills/[id]/route.ts:30；lib/server/agent-runtime/owner.ts:63；lib/server/agent-runtime/with-owner.ts:17；lib/server/agent-runtime/runner.ts:1303 |

### EP-017 — POST /api/azure-voices

| Field | Evidence / finding |
|---|---|
| SURFACE | S20 Provider / Platform Support |
| ENTRY POINT | /api/azure-voices |
| SOURCE LOCATION | app/api/azure-voices/route.ts:13 |
| INVOCATION | HTTP route |
| HTTP METHOD | POST |
| RESOURCE IDENTIFIER | provider/model / usage period / config |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；deployment access code / clientIdentity / provider credential |
| CURRENT PRINCIPAL | deployment access code / clientIdentity / provider credential |
| AUTHORIZATION DECISION | provider探测、usage、search、voices和健康/开关端点没有Zhiban RBAC。默认access code是部署门，不是租户门；health/status显式例外。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | 业务资源请求YES；health/config无资源可N/A |
| SUPPORTED PUBLIC CONTRACT | HTTP PUBLIC_BUT_UNVERSIONED；server credential策略 INTERNAL |
| INTERNAL DEPENDENCY | middleware.ts；app/api/usage/route.ts；app/api/server-providers/route.ts；app/api/access-code/verify/route.ts；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/api/azure-voices/route.ts:13；middleware.ts；app/api/usage/route.ts；app/api/server-providers/route.ts；app/api/access-code/verify/route.ts |

### EP-018 — POST /api/chat

| Field | Evidence / finding |
|---|---|
| SURFACE | S11 Quiz / PBL / Whiteboard Runtime |
| ENTRY POINT | /api/chat |
| SOURCE LOCATION | app/api/chat/route.ts:44 |
| INVOCATION | HTTP route |
| HTTP METHOD | POST |
| RESOURCE IDENTIFIER | stageId / sceneId / attempt/session / project |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；浏览器设备learner；AI服务凭据不是学习者证明 |
| CURRENT PRINCIPAL | 浏览器设备learner；AI服务凭据不是学习者证明 |
| AUTHORIZATION DECISION | quiz/PBL客户端按learnerKey记录；PBL接口接收客户端project并返回patch，quiz-grade接收问题/答案/分值。不能当可信成绩；Pi whiteboard持久化仍使用dev auth。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：外围能拒绝入口，但完整安全接线尚无稳定支持 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | 底层RuntimeStore PUBLIC_STABLE；业务runtime载荷/编排 INTERNAL |
| INTERNAL DEPENDENCY | lib/quiz/runtime.ts:373；lib/pbl/v2/runtime/learner-state.ts；app/api/chat/pi/route.ts:186；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |
| EVIDENCE | app/api/chat/route.ts:44；lib/quiz/runtime.ts:373；lib/pbl/v2/runtime/learner-state.ts；app/api/chat/pi/route.ts:186 |

### EP-019 — POST /api/chat/pi

| Field | Evidence / finding |
|---|---|
| SURFACE | S11 Quiz / PBL / Whiteboard Runtime |
| ENTRY POINT | /api/chat/pi |
| SOURCE LOCATION | app/api/chat/pi/route.ts:44 |
| INVOCATION | HTTP route |
| HTTP METHOD | POST |
| RESOURCE IDENTIFIER | stageId / sceneId / attempt/session / project |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；浏览器设备learner；AI服务凭据不是学习者证明 |
| CURRENT PRINCIPAL | 浏览器设备learner；AI服务凭据不是学习者证明 |
| AUTHORIZATION DECISION | 主chat是stateless；可选server白板runtime单独走dev principal，不能用该可选分支宣称整个chat受用户认证。 quiz/PBL客户端按learnerKey记录；PBL接口接收客户端project并返回patch，quiz-grade接收问题/答案/分值。不能当可信成绩；Pi whiteboard持久化仍使用dev auth。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：外围能拒绝入口，但完整安全接线尚无稳定支持 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | 底层RuntimeStore PUBLIC_STABLE；业务runtime载荷/编排 INTERNAL |
| INTERNAL DEPENDENCY | lib/quiz/runtime.ts:373；lib/pbl/v2/runtime/learner-state.ts；app/api/chat/pi/route.ts:186；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |
| EVIDENCE | app/api/chat/pi/route.ts:44；lib/quiz/runtime.ts:373；lib/pbl/v2/runtime/learner-state.ts；app/api/chat/pi/route.ts:186 |

### EP-020 — POST /api/chat/pi/whiteboard-visibility

| Field | Evidence / finding |
|---|---|
| SURFACE | S11 Quiz / PBL / Whiteboard Runtime |
| ENTRY POINT | /api/chat/pi/whiteboard-visibility |
| SOURCE LOCATION | app/api/chat/pi/whiteboard-visibility/route.ts:31 |
| INVOCATION | HTTP route |
| HTTP METHOD | POST |
| RESOURCE IDENTIFIER | stageId / sceneId / attempt/session / project |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；浏览器设备learner；AI服务凭据不是学习者证明 |
| CURRENT PRINCIPAL | 浏览器设备learner；AI服务凭据不是学习者证明 |
| AUTHORIZATION DECISION | authenticatePersistenceHeaders先验证开发binding，再按learnerKey匹配pending query；生产默认失败。 quiz/PBL客户端按learnerKey记录；PBL接口接收客户端project并返回patch，quiz-grade接收问题/答案/分值。不能当可信成绩；Pi whiteboard持久化仍使用dev auth。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：外围能拒绝入口，但完整安全接线尚无稳定支持 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | 底层RuntimeStore PUBLIC_STABLE；业务runtime载荷/编排 INTERNAL |
| INTERNAL DEPENDENCY | lib/quiz/runtime.ts:373；lib/pbl/v2/runtime/learner-state.ts；app/api/chat/pi/route.ts:186；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |
| EVIDENCE | app/api/chat/pi/whiteboard-visibility/route.ts:31；lib/quiz/runtime.ts:373；lib/pbl/v2/runtime/learner-state.ts；app/api/chat/pi/route.ts:186 |

### EP-021 — POST /api/classroom

| Field | Evidence / finding |
|---|---|
| SURFACE | S01 Classroom |
| ENTRY POINT | /api/classroom |
| SOURCE LOCATION | app/api/classroom/route.ts:23 |
| INVOCATION | HTTP route |
| HTTP METHOD | POST |
| RESOURCE IDENTIFIER | classroomId |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；部署 access code（可选），无逐资源 principal |
| CURRENT PRINCIPAL | 部署 access code（可选），无逐资源 principal |
| AUTHORIZATION DECISION | api/classroom GET 按 id 读取文件；POST 生成新 id、验证/清洗 DSL，但没有 User/Tenant/owner 认证。页面是 client component。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 资源读并非由public=true统一约束；publish匿名拒绝，详见S17 |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | 无公开稳定的租户授权契约；HTTP 为 PUBLIC_BUT_UNVERSIONED |
| INTERNAL DEPENDENCY | lib/server/classroom-storage.ts；lib/classroom/load-classroom.ts:166；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/api/classroom/route.ts:23；lib/server/classroom-storage.ts；lib/classroom/load-classroom.ts:166 |

### EP-022 — GET /api/classroom

| Field | Evidence / finding |
|---|---|
| SURFACE | S01 Classroom |
| ENTRY POINT | /api/classroom |
| SOURCE LOCATION | app/api/classroom/route.ts:131 |
| INVOCATION | HTTP route |
| HTTP METHOD | GET |
| RESOURCE IDENTIFIER | classroomId |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；部署 access code（可选），无逐资源 principal |
| CURRENT PRINCIPAL | 部署 access code（可选），无逐资源 principal |
| AUTHORIZATION DECISION | api/classroom GET 按 id 读取文件；POST 生成新 id、验证/清洗 DSL，但没有 User/Tenant/owner 认证。页面是 client component。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 资源读并非由public=true统一约束；publish匿名拒绝，详见S17 |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | 无公开稳定的租户授权契约；HTTP 为 PUBLIC_BUT_UNVERSIONED |
| INTERNAL DEPENDENCY | lib/server/classroom-storage.ts；lib/classroom/load-classroom.ts:166；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/api/classroom/route.ts:131；lib/server/classroom-storage.ts；lib/classroom/load-classroom.ts:166 |

### EP-023 — GET /api/classroom-media/[classroomId]/[...path]

| Field | Evidence / finding |
|---|---|
| SURFACE | S08 Media / Proxy |
| ENTRY POINT | /api/classroom-media/[classroomId]/[...path] |
| SOURCE LOCATION | app/api/classroom-media/[classroomId]/[...path]/route.ts:40 |
| INVOCATION | HTTP route |
| HTTP METHOD | GET |
| RESOURCE IDENTIFIER | classroomId / media path / external URL |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；部署 access token；URL为调用者输入或供应商产出 |
| CURRENT PRINCIPAL | 部署 access token；URL为调用者输入或供应商产出 |
| AUTHORIZATION DECISION | classroom-media只做路径/文件/Range检查，成功缓存public 86400 immutable；无Stage tombstone/owner检查。proxy-media SSRF校验和重定向校验不是资源授权。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | HTTP PUBLIC_BUT_UNVERSIONED；media resolver INTERNAL |
| INTERNAL DEPENDENCY | app/api/classroom-media/[classroomId]/[...path]/route.ts:24；app/api/proxy-media/route.ts:30；lib/server/media-origin.ts:11；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/api/classroom-media/[classroomId]/[...path]/route.ts:40；app/api/classroom-media/[classroomId]/[...path]/route.ts:24；app/api/proxy-media/route.ts:30；lib/server/media-origin.ts:11 |

### EP-024 — GET /api/comfyui-workflows

| Field | Evidence / finding |
|---|---|
| SURFACE | S20 Provider / Platform Support |
| ENTRY POINT | /api/comfyui-workflows |
| SOURCE LOCATION | app/api/comfyui-workflows/route.ts:16 |
| INVOCATION | HTTP route |
| HTTP METHOD | GET |
| RESOURCE IDENTIFIER | provider/model / usage period / config |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；deployment access code / clientIdentity / provider credential |
| CURRENT PRINCIPAL | deployment access code / clientIdentity / provider credential |
| AUTHORIZATION DECISION | provider探测、usage、search、voices和健康/开关端点没有Zhiban RBAC。默认access code是部署门，不是租户门；health/status显式例外。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | 业务资源请求YES；health/config无资源可N/A |
| SUPPORTED PUBLIC CONTRACT | HTTP PUBLIC_BUT_UNVERSIONED；server credential策略 INTERNAL |
| INTERNAL DEPENDENCY | middleware.ts；app/api/usage/route.ts；app/api/server-providers/route.ts；app/api/access-code/verify/route.ts；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/api/comfyui-workflows/route.ts:16；middleware.ts；app/api/usage/route.ts；app/api/server-providers/route.ts；app/api/access-code/verify/route.ts |

### EP-025 — GET /api/export-video/capability

| Field | Evidence / finding |
|---|---|
| SURFACE | S09 Download / Render |
| ENTRY POINT | /api/export-video/capability |
| SOURCE LOCATION | app/api/export-video/capability/route.ts:13 |
| INVOCATION | HTTP route |
| HTTP METHOD | GET |
| RESOURCE IDENTIFIER | jobId / skillId / export blob |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；clientIdentity 或 session owner（skill私有分支） |
| CURRENT PRINCIPAL | clientIdentity 或 session owner（skill私有分支） |
| AUTHORIZATION DECISION | Next代理render服务；job状态/取消/下载仅使用jobId，无逐job owner校验。render x-openmaic-client用于限制请求，不是Zhiban身份。下载可能透传对象存储302。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | HTTP PUBLIC_BUT_UNVERSIONED；内部render/proxy |
| INTERNAL DEPENDENCY | app/api/export-video/render/[jobId]/download/route.ts:24；render-service/src/main.ts:479；lib/video-export-app/package-zip.ts；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/api/export-video/capability/route.ts:13；app/api/export-video/render/[jobId]/download/route.ts:24；render-service/src/main.ts:479；lib/video-export-app/package-zip.ts |

### EP-026 — POST /api/export-video/render

| Field | Evidence / finding |
|---|---|
| SURFACE | S09 Download / Render |
| ENTRY POINT | /api/export-video/render |
| SOURCE LOCATION | app/api/export-video/render/route.ts:30 |
| INVOCATION | HTTP route |
| HTTP METHOD | POST |
| RESOURCE IDENTIFIER | jobId / skillId / export blob |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；clientIdentity 或 session owner（skill私有分支） |
| CURRENT PRINCIPAL | clientIdentity 或 session owner（skill私有分支） |
| AUTHORIZATION DECISION | Next代理render服务；job状态/取消/下载仅使用jobId，无逐job owner校验。render x-openmaic-client用于限制请求，不是Zhiban身份。下载可能透传对象存储302。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | HTTP PUBLIC_BUT_UNVERSIONED；内部render/proxy |
| INTERNAL DEPENDENCY | app/api/export-video/render/[jobId]/download/route.ts:24；render-service/src/main.ts:479；lib/video-export-app/package-zip.ts；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/api/export-video/render/route.ts:30；app/api/export-video/render/[jobId]/download/route.ts:24；render-service/src/main.ts:479；lib/video-export-app/package-zip.ts |

### EP-027 — GET /api/export-video/render/[jobId]

| Field | Evidence / finding |
|---|---|
| SURFACE | S09 Download / Render |
| ENTRY POINT | /api/export-video/render/[jobId] |
| SOURCE LOCATION | app/api/export-video/render/[jobId]/route.ts:12 |
| INVOCATION | HTTP route |
| HTTP METHOD | GET |
| RESOURCE IDENTIFIER | jobId / skillId / export blob |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；clientIdentity 或 session owner（skill私有分支） |
| CURRENT PRINCIPAL | clientIdentity 或 session owner（skill私有分支） |
| AUTHORIZATION DECISION | Next代理render服务；job状态/取消/下载仅使用jobId，无逐job owner校验。render x-openmaic-client用于限制请求，不是Zhiban身份。下载可能透传对象存储302。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | HTTP PUBLIC_BUT_UNVERSIONED；内部render/proxy |
| INTERNAL DEPENDENCY | app/api/export-video/render/[jobId]/download/route.ts:24；render-service/src/main.ts:479；lib/video-export-app/package-zip.ts；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/api/export-video/render/[jobId]/route.ts:12；app/api/export-video/render/[jobId]/download/route.ts:24；render-service/src/main.ts:479；lib/video-export-app/package-zip.ts |

### EP-028 — DELETE /api/export-video/render/[jobId]

| Field | Evidence / finding |
|---|---|
| SURFACE | S09 Download / Render |
| ENTRY POINT | /api/export-video/render/[jobId] |
| SOURCE LOCATION | app/api/export-video/render/[jobId]/route.ts:37 |
| INVOCATION | HTTP route |
| HTTP METHOD | DELETE |
| RESOURCE IDENTIFIER | jobId / skillId / export blob |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；clientIdentity 或 session owner（skill私有分支） |
| CURRENT PRINCIPAL | clientIdentity 或 session owner（skill私有分支） |
| AUTHORIZATION DECISION | Next代理render服务；job状态/取消/下载仅使用jobId，无逐job owner校验。render x-openmaic-client用于限制请求，不是Zhiban身份。下载可能透传对象存储302。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | HTTP PUBLIC_BUT_UNVERSIONED；内部render/proxy |
| INTERNAL DEPENDENCY | app/api/export-video/render/[jobId]/download/route.ts:24；render-service/src/main.ts:479；lib/video-export-app/package-zip.ts；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/api/export-video/render/[jobId]/route.ts:37；app/api/export-video/render/[jobId]/download/route.ts:24；render-service/src/main.ts:479；lib/video-export-app/package-zip.ts |

### EP-029 — GET /api/export-video/render/[jobId]/download

| Field | Evidence / finding |
|---|---|
| SURFACE | S09 Download / Render |
| ENTRY POINT | /api/export-video/render/[jobId]/download |
| SOURCE LOCATION | app/api/export-video/render/[jobId]/download/route.ts:20 |
| INVOCATION | HTTP route |
| HTTP METHOD | GET |
| RESOURCE IDENTIFIER | jobId / skillId / export blob |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；clientIdentity 或 session owner（skill私有分支） |
| CURRENT PRINCIPAL | clientIdentity 或 session owner（skill私有分支） |
| AUTHORIZATION DECISION | Next代理render服务；job状态/取消/下载仅使用jobId，无逐job owner校验。render x-openmaic-client用于限制请求，不是Zhiban身份。下载可能透传对象存储302。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | HTTP PUBLIC_BUT_UNVERSIONED；内部render/proxy |
| INTERNAL DEPENDENCY | app/api/export-video/render/[jobId]/download/route.ts:24；render-service/src/main.ts:479；lib/video-export-app/package-zip.ts；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/api/export-video/render/[jobId]/download/route.ts:20；app/api/export-video/render/[jobId]/download/route.ts:24；render-service/src/main.ts:479；lib/video-export-app/package-zip.ts |

### EP-030 — POST /api/extract-document

| Field | Evidence / finding |
|---|---|
| SURFACE | S06 Import / Materials |
| ENTRY POINT | /api/extract-document |
| SOURCE LOCATION | app/api/extract-document/route.ts:440 |
| INVOCATION | HTTP route |
| HTTP METHOD | POST |
| RESOURCE IDENTIFIER | file / assetId / materialId / sessionId |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；anonymous owner；兼容 assetId 分支 dev principal |
| CURRENT PRINCIPAL | anonymous owner；兼容 assetId 分支 dev principal |
| AUTHORIZATION DECISION | multipart提取没有用户身份；assetId JSON分支调用resolveServerAsset，依赖dev认证。 文件导入/提取无教师判定；materials检查session owner，上传owner配额。extract-document 的 assetId 分支另走开发认证。解析器不等于授权入口。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：外围能拒绝入口，但完整安全接线尚无稳定支持 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | importer公开导入API；host owner材料与安全接线 INTERNAL |
| INTERNAL DEPENDENCY | lib/import/use-import-pptx.ts:85；lib/persistence/resolve-server-asset.ts:47；lib/server/agent-runtime/session-materials.ts；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |
| EVIDENCE | app/api/extract-document/route.ts:440；lib/import/use-import-pptx.ts:85；lib/persistence/resolve-server-asset.ts:47；lib/server/agent-runtime/session-materials.ts |

### EP-031 — GET /api/folders

| Field | Evidence / finding |
|---|---|
| SURFACE | S02 Stage / Scene / Document |
| ENTRY POINT | /api/folders |
| SOURCE LOCATION | app/api/folders/route.ts:52 |
| INVOCATION | HTTP route |
| HTTP METHOD | GET |
| RESOURCE IDENTIFIER | stageId / sceneId / folderId |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；anonymous_id → anon:UUID；文档 owner_id |
| CURRENT PRINCIPAL | anonymous_id → anon:UUID；文档 owner_id |
| AUTHORIZATION DECISION | folder owner作用域；members是文件夹归属，不是Zhiban Membership。 列表和写入按 anonymous owner；读取实际是 capability-by-id，不检查 is_public 或 owner 相等。owner-bound store 在事务中仅对非 read 校验 owner，已删除拒绝。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 资源读并非由public=true统一约束；publish匿名拒绝，详见S17 |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | DocumentStore/HTTP 为 PUBLIC_STABLE；app owner包装 INTERNAL |
| INTERNAL DEPENDENCY | lib/persistence/owner-bound-document-store.ts:246；lib/persistence/document-access.ts:68；tests/persistence/stage-access-fidelity.test.ts:101；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/api/folders/route.ts:52；lib/persistence/owner-bound-document-store.ts:246；lib/persistence/document-access.ts:68；tests/persistence/stage-access-fidelity.test.ts:101 |

### EP-032 — POST /api/folders

| Field | Evidence / finding |
|---|---|
| SURFACE | S02 Stage / Scene / Document |
| ENTRY POINT | /api/folders |
| SOURCE LOCATION | app/api/folders/route.ts:76 |
| INVOCATION | HTTP route |
| HTTP METHOD | POST |
| RESOURCE IDENTIFIER | stageId / sceneId / folderId |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；anonymous_id → anon:UUID；文档 owner_id |
| CURRENT PRINCIPAL | anonymous_id → anon:UUID；文档 owner_id |
| AUTHORIZATION DECISION | folder owner作用域；members是文件夹归属，不是Zhiban Membership。 列表和写入按 anonymous owner；读取实际是 capability-by-id，不检查 is_public 或 owner 相等。owner-bound store 在事务中仅对非 read 校验 owner，已删除拒绝。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 资源读并非由public=true统一约束；publish匿名拒绝，详见S17 |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | DocumentStore/HTTP 为 PUBLIC_STABLE；app owner包装 INTERNAL |
| INTERNAL DEPENDENCY | lib/persistence/owner-bound-document-store.ts:246；lib/persistence/document-access.ts:68；tests/persistence/stage-access-fidelity.test.ts:101；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/api/folders/route.ts:76；lib/persistence/owner-bound-document-store.ts:246；lib/persistence/document-access.ts:68；tests/persistence/stage-access-fidelity.test.ts:101 |

### EP-033 — POST /api/folders/members

| Field | Evidence / finding |
|---|---|
| SURFACE | S02 Stage / Scene / Document |
| ENTRY POINT | /api/folders/members |
| SOURCE LOCATION | app/api/folders/members/route.ts:35 |
| INVOCATION | HTTP route |
| HTTP METHOD | POST |
| RESOURCE IDENTIFIER | stageId / sceneId / folderId |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；anonymous_id → anon:UUID；文档 owner_id |
| CURRENT PRINCIPAL | anonymous_id → anon:UUID；文档 owner_id |
| AUTHORIZATION DECISION | folder owner作用域；members是文件夹归属，不是Zhiban Membership。 列表和写入按 anonymous owner；读取实际是 capability-by-id，不检查 is_public 或 owner 相等。owner-bound store 在事务中仅对非 read 校验 owner，已删除拒绝。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 资源读并非由public=true统一约束；publish匿名拒绝，详见S17 |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | DocumentStore/HTTP 为 PUBLIC_STABLE；app owner包装 INTERNAL |
| INTERNAL DEPENDENCY | lib/persistence/owner-bound-document-store.ts:246；lib/persistence/document-access.ts:68；tests/persistence/stage-access-fidelity.test.ts:101；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/api/folders/members/route.ts:35；lib/persistence/owner-bound-document-store.ts:246；lib/persistence/document-access.ts:68；tests/persistence/stage-access-fidelity.test.ts:101 |

### EP-034 — PATCH /api/folders/[id]

| Field | Evidence / finding |
|---|---|
| SURFACE | S02 Stage / Scene / Document |
| ENTRY POINT | /api/folders/[id] |
| SOURCE LOCATION | app/api/folders/[id]/route.ts:40 |
| INVOCATION | HTTP route |
| HTTP METHOD | PATCH |
| RESOURCE IDENTIFIER | stageId / sceneId / folderId |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；anonymous_id → anon:UUID；文档 owner_id |
| CURRENT PRINCIPAL | anonymous_id → anon:UUID；文档 owner_id |
| AUTHORIZATION DECISION | folder owner作用域；members是文件夹归属，不是Zhiban Membership。 列表和写入按 anonymous owner；读取实际是 capability-by-id，不检查 is_public 或 owner 相等。owner-bound store 在事务中仅对非 read 校验 owner，已删除拒绝。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 资源读并非由public=true统一约束；publish匿名拒绝，详见S17 |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | DocumentStore/HTTP 为 PUBLIC_STABLE；app owner包装 INTERNAL |
| INTERNAL DEPENDENCY | lib/persistence/owner-bound-document-store.ts:246；lib/persistence/document-access.ts:68；tests/persistence/stage-access-fidelity.test.ts:101；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/api/folders/[id]/route.ts:40；lib/persistence/owner-bound-document-store.ts:246；lib/persistence/document-access.ts:68；tests/persistence/stage-access-fidelity.test.ts:101 |

### EP-035 — DELETE /api/folders/[id]

| Field | Evidence / finding |
|---|---|
| SURFACE | S02 Stage / Scene / Document |
| ENTRY POINT | /api/folders/[id] |
| SOURCE LOCATION | app/api/folders/[id]/route.ts:101 |
| INVOCATION | HTTP route |
| HTTP METHOD | DELETE |
| RESOURCE IDENTIFIER | stageId / sceneId / folderId |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；anonymous_id → anon:UUID；文档 owner_id |
| CURRENT PRINCIPAL | anonymous_id → anon:UUID；文档 owner_id |
| AUTHORIZATION DECISION | folder owner作用域；members是文件夹归属，不是Zhiban Membership。 列表和写入按 anonymous owner；读取实际是 capability-by-id，不检查 is_public 或 owner 相等。owner-bound store 在事务中仅对非 read 校验 owner，已删除拒绝。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 资源读并非由public=true统一约束；publish匿名拒绝，详见S17 |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | DocumentStore/HTTP 为 PUBLIC_STABLE；app owner包装 INTERNAL |
| INTERNAL DEPENDENCY | lib/persistence/owner-bound-document-store.ts:246；lib/persistence/document-access.ts:68；tests/persistence/stage-access-fidelity.test.ts:101；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/api/folders/[id]/route.ts:101；lib/persistence/owner-bound-document-store.ts:246；lib/persistence/document-access.ts:68；tests/persistence/stage-access-fidelity.test.ts:101 |

### EP-036 — POST /api/generate/agent-profiles

| Field | Evidence / finding |
|---|---|
| SURFACE | S04 Generation |
| ENTRY POINT | /api/generate/agent-profiles |
| SOURCE LOCATION | app/api/generate/agent-profiles/route.ts:130 |
| INVOCATION | HTTP route |
| HTTP METHOD | POST |
| RESOURCE IDENTIFIER | stageId（输入语境）/ jobId / provider |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；可选部署 access token；BYOK/服务端 provider凭据不是用户 |
| CURRENT PRINCIPAL | 可选部署 access token；BYOK/服务端 provider凭据不是用户 |
| AUTHORIZATION DECISION | 经典生成接口验证参数/模型配置，未执行教师/课程权限判断；generation job 按 jobId 查询。API key/模型开关不是教师授权。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | generation package 可复用；route JSON PUBLIC_BUT_UNVERSIONED |
| INTERNAL DEPENDENCY | app/api/generate/scene-content/route.ts:59；app/api/generate-classroom/route.ts；lib/server/classroom-job-runner.ts；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/api/generate/agent-profiles/route.ts:130；app/api/generate/scene-content/route.ts:59；app/api/generate-classroom/route.ts；lib/server/classroom-job-runner.ts |

### EP-037 — POST /api/generate/image

| Field | Evidence / finding |
|---|---|
| SURFACE | S04 Generation |
| ENTRY POINT | /api/generate/image |
| SOURCE LOCATION | app/api/generate/image/route.ts:44 |
| INVOCATION | HTTP route |
| HTTP METHOD | POST |
| RESOURCE IDENTIFIER | stageId（输入语境）/ jobId / provider |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；可选部署 access token；BYOK/服务端 provider凭据不是用户 |
| CURRENT PRINCIPAL | 可选部署 access token；BYOK/服务端 provider凭据不是用户 |
| AUTHORIZATION DECISION | 经典生成接口验证参数/模型配置，未执行教师/课程权限判断；generation job 按 jobId 查询。API key/模型开关不是教师授权。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | generation package 可复用；route JSON PUBLIC_BUT_UNVERSIONED |
| INTERNAL DEPENDENCY | app/api/generate/scene-content/route.ts:59；app/api/generate-classroom/route.ts；lib/server/classroom-job-runner.ts；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/api/generate/image/route.ts:44；app/api/generate/scene-content/route.ts:59；app/api/generate-classroom/route.ts；lib/server/classroom-job-runner.ts |

### EP-038 — POST /api/generate/scene-actions

| Field | Evidence / finding |
|---|---|
| SURFACE | S04 Generation |
| ENTRY POINT | /api/generate/scene-actions |
| SOURCE LOCATION | app/api/generate/scene-actions/route.ts:37 |
| INVOCATION | HTTP route |
| HTTP METHOD | POST |
| RESOURCE IDENTIFIER | stageId（输入语境）/ jobId / provider |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；可选部署 access token；BYOK/服务端 provider凭据不是用户 |
| CURRENT PRINCIPAL | 可选部署 access token；BYOK/服务端 provider凭据不是用户 |
| AUTHORIZATION DECISION | 经典生成接口验证参数/模型配置，未执行教师/课程权限判断；generation job 按 jobId 查询。API key/模型开关不是教师授权。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | generation package 可复用；route JSON PUBLIC_BUT_UNVERSIONED |
| INTERNAL DEPENDENCY | app/api/generate/scene-content/route.ts:59；app/api/generate-classroom/route.ts；lib/server/classroom-job-runner.ts；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/api/generate/scene-actions/route.ts:37；app/api/generate/scene-content/route.ts:59；app/api/generate-classroom/route.ts；lib/server/classroom-job-runner.ts |

### EP-039 — POST /api/generate/scene-content

| Field | Evidence / finding |
|---|---|
| SURFACE | S04 Generation |
| ENTRY POINT | /api/generate/scene-content |
| SOURCE LOCATION | app/api/generate/scene-content/route.ts:59 |
| INVOCATION | HTTP route |
| HTTP METHOD | POST |
| RESOURCE IDENTIFIER | stageId（输入语境）/ jobId / provider |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；可选部署 access token；BYOK/服务端 provider凭据不是用户 |
| CURRENT PRINCIPAL | 可选部署 access token；BYOK/服务端 provider凭据不是用户 |
| AUTHORIZATION DECISION | 经典生成接口验证参数/模型配置，未执行教师/课程权限判断；generation job 按 jobId 查询。API key/模型开关不是教师授权。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | generation package 可复用；route JSON PUBLIC_BUT_UNVERSIONED |
| INTERNAL DEPENDENCY | app/api/generate/scene-content/route.ts:59；app/api/generate-classroom/route.ts；lib/server/classroom-job-runner.ts；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/api/generate/scene-content/route.ts:59；app/api/generate/scene-content/route.ts:59；app/api/generate-classroom/route.ts；lib/server/classroom-job-runner.ts |

### EP-040 — POST /api/generate/scene-outlines-stream

| Field | Evidence / finding |
|---|---|
| SURFACE | S04 Generation |
| ENTRY POINT | /api/generate/scene-outlines-stream |
| SOURCE LOCATION | app/api/generate/scene-outlines-stream/route.ts:287 |
| INVOCATION | HTTP route |
| HTTP METHOD | POST |
| RESOURCE IDENTIFIER | stageId（输入语境）/ jobId / provider |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；可选部署 access token；BYOK/服务端 provider凭据不是用户 |
| CURRENT PRINCIPAL | 可选部署 access token；BYOK/服务端 provider凭据不是用户 |
| AUTHORIZATION DECISION | 经典生成接口验证参数/模型配置，未执行教师/课程权限判断；generation job 按 jobId 查询。API key/模型开关不是教师授权。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | generation package 可复用；route JSON PUBLIC_BUT_UNVERSIONED |
| INTERNAL DEPENDENCY | app/api/generate/scene-content/route.ts:59；app/api/generate-classroom/route.ts；lib/server/classroom-job-runner.ts；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/api/generate/scene-outlines-stream/route.ts:287；app/api/generate/scene-content/route.ts:59；app/api/generate-classroom/route.ts；lib/server/classroom-job-runner.ts |

### EP-041 — POST /api/generate/tts

| Field | Evidence / finding |
|---|---|
| SURFACE | S04 Generation |
| ENTRY POINT | /api/generate/tts |
| SOURCE LOCATION | app/api/generate/tts/route.ts:39 |
| INVOCATION | HTTP route |
| HTTP METHOD | POST |
| RESOURCE IDENTIFIER | stageId（输入语境）/ jobId / provider |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；可选部署 access token；BYOK/服务端 provider凭据不是用户 |
| CURRENT PRINCIPAL | 可选部署 access token；BYOK/服务端 provider凭据不是用户 |
| AUTHORIZATION DECISION | 经典生成接口验证参数/模型配置，未执行教师/课程权限判断；generation job 按 jobId 查询。API key/模型开关不是教师授权。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | generation package 可复用；route JSON PUBLIC_BUT_UNVERSIONED |
| INTERNAL DEPENDENCY | app/api/generate/scene-content/route.ts:59；app/api/generate-classroom/route.ts；lib/server/classroom-job-runner.ts；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/api/generate/tts/route.ts:39；app/api/generate/scene-content/route.ts:59；app/api/generate-classroom/route.ts；lib/server/classroom-job-runner.ts |

### EP-042 — POST /api/generate/video

| Field | Evidence / finding |
|---|---|
| SURFACE | S04 Generation |
| ENTRY POINT | /api/generate/video |
| SOURCE LOCATION | app/api/generate/video/route.ts:39 |
| INVOCATION | HTTP route |
| HTTP METHOD | POST |
| RESOURCE IDENTIFIER | stageId（输入语境）/ jobId / provider |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；可选部署 access token；BYOK/服务端 provider凭据不是用户 |
| CURRENT PRINCIPAL | 可选部署 access token；BYOK/服务端 provider凭据不是用户 |
| AUTHORIZATION DECISION | 经典生成接口验证参数/模型配置，未执行教师/课程权限判断；generation job 按 jobId 查询。API key/模型开关不是教师授权。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | generation package 可复用；route JSON PUBLIC_BUT_UNVERSIONED |
| INTERNAL DEPENDENCY | app/api/generate/scene-content/route.ts:59；app/api/generate-classroom/route.ts；lib/server/classroom-job-runner.ts；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/api/generate/video/route.ts:39；app/api/generate/scene-content/route.ts:59；app/api/generate-classroom/route.ts；lib/server/classroom-job-runner.ts |

### EP-043 — POST /api/generate/voice

| Field | Evidence / finding |
|---|---|
| SURFACE | S04 Generation |
| ENTRY POINT | /api/generate/voice |
| SOURCE LOCATION | app/api/generate/voice/route.ts:64 |
| INVOCATION | HTTP route |
| HTTP METHOD | POST |
| RESOURCE IDENTIFIER | stageId（输入语境）/ jobId / provider |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；可选部署 access token；BYOK/服务端 provider凭据不是用户 |
| CURRENT PRINCIPAL | 可选部署 access token；BYOK/服务端 provider凭据不是用户 |
| AUTHORIZATION DECISION | 经典生成接口验证参数/模型配置，未执行教师/课程权限判断；generation job 按 jobId 查询。API key/模型开关不是教师授权。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | generation package 可复用；route JSON PUBLIC_BUT_UNVERSIONED |
| INTERNAL DEPENDENCY | app/api/generate/scene-content/route.ts:59；app/api/generate-classroom/route.ts；lib/server/classroom-job-runner.ts；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/api/generate/voice/route.ts:64；app/api/generate/scene-content/route.ts:59；app/api/generate-classroom/route.ts；lib/server/classroom-job-runner.ts |

### EP-044 — POST /api/generate-classroom

| Field | Evidence / finding |
|---|---|
| SURFACE | S04 Generation |
| ENTRY POINT | /api/generate-classroom |
| SOURCE LOCATION | app/api/generate-classroom/route.ts:29 |
| INVOCATION | HTTP route |
| HTTP METHOD | POST |
| RESOURCE IDENTIFIER | stageId（输入语境）/ jobId / provider |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；可选部署 access token；BYOK/服务端 provider凭据不是用户 |
| CURRENT PRINCIPAL | 可选部署 access token；BYOK/服务端 provider凭据不是用户 |
| AUTHORIZATION DECISION | 经典生成接口验证参数/模型配置，未执行教师/课程权限判断；generation job 按 jobId 查询。API key/模型开关不是教师授权。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | generation package 可复用；route JSON PUBLIC_BUT_UNVERSIONED |
| INTERNAL DEPENDENCY | app/api/generate/scene-content/route.ts:59；app/api/generate-classroom/route.ts；lib/server/classroom-job-runner.ts；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/api/generate-classroom/route.ts:29；app/api/generate/scene-content/route.ts:59；app/api/generate-classroom/route.ts；lib/server/classroom-job-runner.ts |

### EP-045 — GET /api/generate-classroom/[jobId]

| Field | Evidence / finding |
|---|---|
| SURFACE | S04 Generation |
| ENTRY POINT | /api/generate-classroom/[jobId] |
| SOURCE LOCATION | app/api/generate-classroom/[jobId]/route.ts:14 |
| INVOCATION | HTTP route |
| HTTP METHOD | GET |
| RESOURCE IDENTIFIER | stageId（输入语境）/ jobId / provider |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；可选部署 access token；BYOK/服务端 provider凭据不是用户 |
| CURRENT PRINCIPAL | 可选部署 access token；BYOK/服务端 provider凭据不是用户 |
| AUTHORIZATION DECISION | 经典生成接口验证参数/模型配置，未执行教师/课程权限判断；generation job 按 jobId 查询。API key/模型开关不是教师授权。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | generation package 可复用；route JSON PUBLIC_BUT_UNVERSIONED |
| INTERNAL DEPENDENCY | app/api/generate/scene-content/route.ts:59；app/api/generate-classroom/route.ts；lib/server/classroom-job-runner.ts；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/api/generate-classroom/[jobId]/route.ts:14；app/api/generate/scene-content/route.ts:59；app/api/generate-classroom/route.ts；lib/server/classroom-job-runner.ts |

### EP-046 — GET /api/health

| Field | Evidence / finding |
|---|---|
| SURFACE | S20 Provider / Platform Support |
| ENTRY POINT | /api/health |
| SOURCE LOCATION | app/api/health/route.ts:11 |
| INVOCATION | HTTP route |
| HTTP METHOD | GET |
| RESOURCE IDENTIFIER | provider/model / usage period / config |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；deployment access code / clientIdentity / provider credential |
| CURRENT PRINCIPAL | deployment access code / clientIdentity / provider credential |
| AUTHORIZATION DECISION | middleware显式豁免；仅健康检查，不允许携带业务数据。 provider探测、usage、search、voices和健康/开关端点没有Zhiban RBAC。默认access code是部署门，不是租户门；health/status显式例外。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | 业务资源请求YES；health/config无资源可N/A |
| SUPPORTED PUBLIC CONTRACT | HTTP PUBLIC_BUT_UNVERSIONED；server credential策略 INTERNAL |
| INTERNAL DEPENDENCY | middleware.ts；app/api/usage/route.ts；app/api/server-providers/route.ts；app/api/access-code/verify/route.ts；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/api/health/route.ts:11；middleware.ts；app/api/usage/route.ts；app/api/server-providers/route.ts；app/api/access-code/verify/route.ts |

### EP-047 — GET /api/materials

| Field | Evidence / finding |
|---|---|
| SURFACE | S06 Import / Materials |
| ENTRY POINT | /api/materials |
| SOURCE LOCATION | app/api/materials/route.ts:120 |
| INVOCATION | HTTP route |
| HTTP METHOD | GET |
| RESOURCE IDENTIFIER | file / assetId / materialId / sessionId |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；anonymous owner；兼容 assetId 分支 dev principal |
| CURRENT PRINCIPAL | anonymous owner；兼容 assetId 分支 dev principal |
| AUTHORIZATION DECISION | 文件导入/提取无教师判定；materials检查session owner，上传owner配额。extract-document 的 assetId 分支另走开发认证。解析器不等于授权入口。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：外围能拒绝入口，但完整安全接线尚无稳定支持 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | importer公开导入API；host owner材料与安全接线 INTERNAL |
| INTERNAL DEPENDENCY | lib/import/use-import-pptx.ts:85；lib/persistence/resolve-server-asset.ts:47；lib/server/agent-runtime/session-materials.ts；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |
| EVIDENCE | app/api/materials/route.ts:120；lib/import/use-import-pptx.ts:85；lib/persistence/resolve-server-asset.ts:47；lib/server/agent-runtime/session-materials.ts |

### EP-048 — POST /api/materials

| Field | Evidence / finding |
|---|---|
| SURFACE | S06 Import / Materials |
| ENTRY POINT | /api/materials |
| SOURCE LOCATION | app/api/materials/route.ts:155 |
| INVOCATION | HTTP route |
| HTTP METHOD | POST |
| RESOURCE IDENTIFIER | file / assetId / materialId / sessionId |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；anonymous owner；兼容 assetId 分支 dev principal |
| CURRENT PRINCIPAL | anonymous owner；兼容 assetId 分支 dev principal |
| AUTHORIZATION DECISION | 文件导入/提取无教师判定；materials检查session owner，上传owner配额。extract-document 的 assetId 分支另走开发认证。解析器不等于授权入口。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：外围能拒绝入口，但完整安全接线尚无稳定支持 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | importer公开导入API；host owner材料与安全接线 INTERNAL |
| INTERNAL DEPENDENCY | lib/import/use-import-pptx.ts:85；lib/persistence/resolve-server-asset.ts:47；lib/server/agent-runtime/session-materials.ts；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |
| EVIDENCE | app/api/materials/route.ts:155；lib/import/use-import-pptx.ts:85；lib/persistence/resolve-server-asset.ts:47；lib/server/agent-runtime/session-materials.ts |

### EP-049 — GET /api/materials/[id]

| Field | Evidence / finding |
|---|---|
| SURFACE | S06 Import / Materials |
| ENTRY POINT | /api/materials/[id] |
| SOURCE LOCATION | app/api/materials/[id]/route.ts:30 |
| INVOCATION | HTTP route |
| HTTP METHOD | GET |
| RESOURCE IDENTIFIER | file / assetId / materialId / sessionId |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；anonymous owner；兼容 assetId 分支 dev principal |
| CURRENT PRINCIPAL | anonymous owner；兼容 assetId 分支 dev principal |
| AUTHORIZATION DECISION | 文件导入/提取无教师判定；materials检查session owner，上传owner配额。extract-document 的 assetId 分支另走开发认证。解析器不等于授权入口。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：外围能拒绝入口，但完整安全接线尚无稳定支持 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | importer公开导入API；host owner材料与安全接线 INTERNAL |
| INTERNAL DEPENDENCY | lib/import/use-import-pptx.ts:85；lib/persistence/resolve-server-asset.ts:47；lib/server/agent-runtime/session-materials.ts；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |
| EVIDENCE | app/api/materials/[id]/route.ts:30；lib/import/use-import-pptx.ts:85；lib/persistence/resolve-server-asset.ts:47；lib/server/agent-runtime/session-materials.ts |

### EP-050 — POST /api/parse-pdf

| Field | Evidence / finding |
|---|---|
| SURFACE | S06 Import / Materials |
| ENTRY POINT | /api/parse-pdf |
| SOURCE LOCATION | app/api/parse-pdf/route.ts:15 |
| INVOCATION | HTTP route |
| HTTP METHOD | POST |
| RESOURCE IDENTIFIER | file / assetId / materialId / sessionId |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；anonymous owner；兼容 assetId 分支 dev principal |
| CURRENT PRINCIPAL | anonymous owner；兼容 assetId 分支 dev principal |
| AUTHORIZATION DECISION | 文件导入/提取无教师判定；materials检查session owner，上传owner配额。extract-document 的 assetId 分支另走开发认证。解析器不等于授权入口。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：外围能拒绝入口，但完整安全接线尚无稳定支持 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | importer公开导入API；host owner材料与安全接线 INTERNAL |
| INTERNAL DEPENDENCY | lib/import/use-import-pptx.ts:85；lib/persistence/resolve-server-asset.ts:47；lib/server/agent-runtime/session-materials.ts；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |
| EVIDENCE | app/api/parse-pdf/route.ts:15；lib/import/use-import-pptx.ts:85；lib/persistence/resolve-server-asset.ts:47；lib/server/agent-runtime/session-materials.ts |

### EP-051 — POST /api/pbl/v2/evaluate

| Field | Evidence / finding |
|---|---|
| SURFACE | S11 Quiz / PBL / Whiteboard Runtime |
| ENTRY POINT | /api/pbl/v2/evaluate |
| SOURCE LOCATION | app/api/pbl/v2/evaluate/route.ts:57 |
| INVOCATION | HTTP route |
| HTTP METHOD | POST |
| RESOURCE IDENTIFIER | stageId / sceneId / attempt/session / project |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；浏览器设备learner；AI服务凭据不是学习者证明 |
| CURRENT PRINCIPAL | 浏览器设备learner；AI服务凭据不是学习者证明 |
| AUTHORIZATION DECISION | quiz/PBL客户端按learnerKey记录；PBL接口接收客户端project并返回patch，quiz-grade接收问题/答案/分值。不能当可信成绩；Pi whiteboard持久化仍使用dev auth。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：外围能拒绝入口，但完整安全接线尚无稳定支持 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | 底层RuntimeStore PUBLIC_STABLE；业务runtime载荷/编排 INTERNAL |
| INTERNAL DEPENDENCY | lib/quiz/runtime.ts:373；lib/pbl/v2/runtime/learner-state.ts；app/api/chat/pi/route.ts:186；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |
| EVIDENCE | app/api/pbl/v2/evaluate/route.ts:57；lib/quiz/runtime.ts:373；lib/pbl/v2/runtime/learner-state.ts；app/api/chat/pi/route.ts:186 |

### EP-052 — POST /api/pbl/v2/instructor

| Field | Evidence / finding |
|---|---|
| SURFACE | S11 Quiz / PBL / Whiteboard Runtime |
| ENTRY POINT | /api/pbl/v2/instructor |
| SOURCE LOCATION | app/api/pbl/v2/instructor/route.ts:38 |
| INVOCATION | HTTP route |
| HTTP METHOD | POST |
| RESOURCE IDENTIFIER | stageId / sceneId / attempt/session / project |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；浏览器设备learner；AI服务凭据不是学习者证明 |
| CURRENT PRINCIPAL | 浏览器设备learner；AI服务凭据不是学习者证明 |
| AUTHORIZATION DECISION | quiz/PBL客户端按learnerKey记录；PBL接口接收客户端project并返回patch，quiz-grade接收问题/答案/分值。不能当可信成绩；Pi whiteboard持久化仍使用dev auth。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：外围能拒绝入口，但完整安全接线尚无稳定支持 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | 底层RuntimeStore PUBLIC_STABLE；业务runtime载荷/编排 INTERNAL |
| INTERNAL DEPENDENCY | lib/quiz/runtime.ts:373；lib/pbl/v2/runtime/learner-state.ts；app/api/chat/pi/route.ts:186；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |
| EVIDENCE | app/api/pbl/v2/instructor/route.ts:38；lib/quiz/runtime.ts:373；lib/pbl/v2/runtime/learner-state.ts；app/api/chat/pi/route.ts:186 |

### EP-053 — POST /api/pbl/v2/open-task

| Field | Evidence / finding |
|---|---|
| SURFACE | S11 Quiz / PBL / Whiteboard Runtime |
| ENTRY POINT | /api/pbl/v2/open-task |
| SOURCE LOCATION | app/api/pbl/v2/open-task/route.ts:40 |
| INVOCATION | HTTP route |
| HTTP METHOD | POST |
| RESOURCE IDENTIFIER | stageId / sceneId / attempt/session / project |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；浏览器设备learner；AI服务凭据不是学习者证明 |
| CURRENT PRINCIPAL | 浏览器设备learner；AI服务凭据不是学习者证明 |
| AUTHORIZATION DECISION | quiz/PBL客户端按learnerKey记录；PBL接口接收客户端project并返回patch，quiz-grade接收问题/答案/分值。不能当可信成绩；Pi whiteboard持久化仍使用dev auth。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：外围能拒绝入口，但完整安全接线尚无稳定支持 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | 底层RuntimeStore PUBLIC_STABLE；业务runtime载荷/编排 INTERNAL |
| INTERNAL DEPENDENCY | lib/quiz/runtime.ts:373；lib/pbl/v2/runtime/learner-state.ts；app/api/chat/pi/route.ts:186；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |
| EVIDENCE | app/api/pbl/v2/open-task/route.ts:40；lib/quiz/runtime.ts:373；lib/pbl/v2/runtime/learner-state.ts；app/api/chat/pi/route.ts:186 |

### EP-054 — POST /api/pbl/v2/simulator

| Field | Evidence / finding |
|---|---|
| SURFACE | S11 Quiz / PBL / Whiteboard Runtime |
| ENTRY POINT | /api/pbl/v2/simulator |
| SOURCE LOCATION | app/api/pbl/v2/simulator/route.ts:39 |
| INVOCATION | HTTP route |
| HTTP METHOD | POST |
| RESOURCE IDENTIFIER | stageId / sceneId / attempt/session / project |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；浏览器设备learner；AI服务凭据不是学习者证明 |
| CURRENT PRINCIPAL | 浏览器设备learner；AI服务凭据不是学习者证明 |
| AUTHORIZATION DECISION | quiz/PBL客户端按learnerKey记录；PBL接口接收客户端project并返回patch，quiz-grade接收问题/答案/分值。不能当可信成绩；Pi whiteboard持久化仍使用dev auth。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：外围能拒绝入口，但完整安全接线尚无稳定支持 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | 底层RuntimeStore PUBLIC_STABLE；业务runtime载荷/编排 INTERNAL |
| INTERNAL DEPENDENCY | lib/quiz/runtime.ts:373；lib/pbl/v2/runtime/learner-state.ts；app/api/chat/pi/route.ts:186；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |
| EVIDENCE | app/api/pbl/v2/simulator/route.ts:39；lib/quiz/runtime.ts:373；lib/pbl/v2/runtime/learner-state.ts；app/api/chat/pi/route.ts:186 |

### EP-055 — POST /api/pbl/v2/task/update

| Field | Evidence / finding |
|---|---|
| SURFACE | S11 Quiz / PBL / Whiteboard Runtime |
| ENTRY POINT | /api/pbl/v2/task/update |
| SOURCE LOCATION | app/api/pbl/v2/task/update/route.ts:48 |
| INVOCATION | HTTP route |
| HTTP METHOD | POST |
| RESOURCE IDENTIFIER | stageId / sceneId / attempt/session / project |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；浏览器设备learner；AI服务凭据不是学习者证明 |
| CURRENT PRINCIPAL | 浏览器设备learner；AI服务凭据不是学习者证明 |
| AUTHORIZATION DECISION | quiz/PBL客户端按learnerKey记录；PBL接口接收客户端project并返回patch，quiz-grade接收问题/答案/分值。不能当可信成绩；Pi whiteboard持久化仍使用dev auth。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：外围能拒绝入口，但完整安全接线尚无稳定支持 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | 底层RuntimeStore PUBLIC_STABLE；业务runtime载荷/编排 INTERNAL |
| INTERNAL DEPENDENCY | lib/quiz/runtime.ts:373；lib/pbl/v2/runtime/learner-state.ts；app/api/chat/pi/route.ts:186；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |
| EVIDENCE | app/api/pbl/v2/task/update/route.ts:48；lib/quiz/runtime.ts:373；lib/pbl/v2/runtime/learner-state.ts；app/api/chat/pi/route.ts:186 |

### EP-056 — POST /api/provider/probe-models

| Field | Evidence / finding |
|---|---|
| SURFACE | S20 Provider / Platform Support |
| ENTRY POINT | /api/provider/probe-models |
| SOURCE LOCATION | app/api/provider/probe-models/route.ts:19 |
| INVOCATION | HTTP route |
| HTTP METHOD | POST |
| RESOURCE IDENTIFIER | provider/model / usage period / config |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；deployment access code / clientIdentity / provider credential |
| CURRENT PRINCIPAL | deployment access code / clientIdentity / provider credential |
| AUTHORIZATION DECISION | provider探测、usage、search、voices和健康/开关端点没有Zhiban RBAC。默认access code是部署门，不是租户门；health/status显式例外。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | 业务资源请求YES；health/config无资源可N/A |
| SUPPORTED PUBLIC CONTRACT | HTTP PUBLIC_BUT_UNVERSIONED；server credential策略 INTERNAL |
| INTERNAL DEPENDENCY | middleware.ts；app/api/usage/route.ts；app/api/server-providers/route.ts；app/api/access-code/verify/route.ts；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/api/provider/probe-models/route.ts:19；middleware.ts；app/api/usage/route.ts；app/api/server-providers/route.ts；app/api/access-code/verify/route.ts |

### EP-057 — POST /api/proxy-media

| Field | Evidence / finding |
|---|---|
| SURFACE | S08 Media / Proxy |
| ENTRY POINT | /api/proxy-media |
| SOURCE LOCATION | app/api/proxy-media/route.ts:25 |
| INVOCATION | HTTP route |
| HTTP METHOD | POST |
| RESOURCE IDENTIFIER | classroomId / media path / external URL |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；部署 access token；URL为调用者输入或供应商产出 |
| CURRENT PRINCIPAL | 部署 access token；URL为调用者输入或供应商产出 |
| AUTHORIZATION DECISION | classroom-media只做路径/文件/Range检查，成功缓存public 86400 immutable；无Stage tombstone/owner检查。proxy-media SSRF校验和重定向校验不是资源授权。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | HTTP PUBLIC_BUT_UNVERSIONED；media resolver INTERNAL |
| INTERNAL DEPENDENCY | app/api/classroom-media/[classroomId]/[...path]/route.ts:24；app/api/proxy-media/route.ts:30；lib/server/media-origin.ts:11；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/api/proxy-media/route.ts:25；app/api/classroom-media/[classroomId]/[...path]/route.ts:24；app/api/proxy-media/route.ts:30；lib/server/media-origin.ts:11 |

### EP-058 — POST /api/quiz-grade

| Field | Evidence / finding |
|---|---|
| SURFACE | S11 Quiz / PBL / Whiteboard Runtime |
| ENTRY POINT | /api/quiz-grade |
| SOURCE LOCATION | app/api/quiz-grade/route.ts:28 |
| INVOCATION | HTTP route |
| HTTP METHOD | POST |
| RESOURCE IDENTIFIER | stageId / sceneId / attempt/session / project |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；浏览器设备learner；AI服务凭据不是学习者证明 |
| CURRENT PRINCIPAL | 浏览器设备learner；AI服务凭据不是学习者证明 |
| AUTHORIZATION DECISION | quiz/PBL客户端按learnerKey记录；PBL接口接收客户端project并返回patch，quiz-grade接收问题/答案/分值。不能当可信成绩；Pi whiteboard持久化仍使用dev auth。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：外围能拒绝入口，但完整安全接线尚无稳定支持 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | 底层RuntimeStore PUBLIC_STABLE；业务runtime载荷/编排 INTERNAL |
| INTERNAL DEPENDENCY | lib/quiz/runtime.ts:373；lib/pbl/v2/runtime/learner-state.ts；app/api/chat/pi/route.ts:186；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |
| EVIDENCE | app/api/quiz-grade/route.ts:28；lib/quiz/runtime.ts:373；lib/pbl/v2/runtime/learner-state.ts；app/api/chat/pi/route.ts:186 |

### EP-059 — GET /api/server-providers

| Field | Evidence / finding |
|---|---|
| SURFACE | S20 Provider / Platform Support |
| ENTRY POINT | /api/server-providers |
| SOURCE LOCATION | app/api/server-providers/route.ts:16 |
| INVOCATION | HTTP route |
| HTTP METHOD | GET |
| RESOURCE IDENTIFIER | provider/model / usage period / config |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；deployment access code / clientIdentity / provider credential |
| CURRENT PRINCIPAL | deployment access code / clientIdentity / provider credential |
| AUTHORIZATION DECISION | provider探测、usage、search、voices和健康/开关端点没有Zhiban RBAC。默认access code是部署门，不是租户门；health/status显式例外。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | 业务资源请求YES；health/config无资源可N/A |
| SUPPORTED PUBLIC CONTRACT | HTTP PUBLIC_BUT_UNVERSIONED；server credential策略 INTERNAL |
| INTERNAL DEPENDENCY | middleware.ts；app/api/usage/route.ts；app/api/server-providers/route.ts；app/api/access-code/verify/route.ts；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/api/server-providers/route.ts:16；middleware.ts；app/api/usage/route.ts；app/api/server-providers/route.ts；app/api/access-code/verify/route.ts |

### EP-060 — GET /api/skills/[id]

| Field | Evidence / finding |
|---|---|
| SURFACE | S09 Download / Render |
| ENTRY POINT | /api/skills/[id] |
| SOURCE LOCATION | app/api/skills/[id]/route.ts:23 |
| INVOCATION | HTTP route |
| HTTP METHOD | GET |
| RESOURCE IDENTIFIER | jobId / skillId / export blob |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；clientIdentity 或 session owner（skill私有分支） |
| CURRENT PRINCIPAL | clientIdentity 或 session owner（skill私有分支） |
| AUTHORIZATION DECISION | 内置skill zip按安全id公开；user skill分支通过anonymous owner查找。 Next代理render服务；job状态/取消/下载仅使用jobId，无逐job owner校验。render x-openmaic-client用于限制请求，不是Zhiban身份。下载可能透传对象存储302。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | HTTP PUBLIC_BUT_UNVERSIONED；内部render/proxy |
| INTERNAL DEPENDENCY | app/api/export-video/render/[jobId]/download/route.ts:24；render-service/src/main.ts:479；lib/video-export-app/package-zip.ts；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/api/skills/[id]/route.ts:23；app/api/export-video/render/[jobId]/download/route.ts:24；render-service/src/main.ts:479；lib/video-export-app/package-zip.ts |

### EP-061 — GET /api/stage-meta/[stageId]

| Field | Evidence / finding |
|---|---|
| SURFACE | S17 Public / Published |
| ENTRY POINT | /api/stage-meta/[stageId] |
| SOURCE LOCATION | app/api/stage-meta/[stageId]/route.ts:38 |
| INVOCATION | HTTP route |
| HTTP METHOD | GET |
| RESOURCE IDENTIFIER | stageId / isPublic / publishedAt |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；owner / public状态（状态不是principal） |
| CURRENT PRINCIPAL | owner / public状态（状态不是principal） |
| AUTHORIZATION DECISION | 只返回存在/发布/owner布尔等metadata，不赋予Tenant授权。 publish/unpublish拒绝anon: owner；现有with-owner始终匿名，所以无真实authenticated publish接线。status/meta向知id者返回状态；文档read不要求public=true。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 资源读并非由public=true统一约束；publish匿名拒绝，详见S17 |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：外围能拒绝入口，但完整安全接线尚无稳定支持 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | stage-access、stage_meta INTERNAL；无tenant-scoped published契约 |
| INTERNAL DEPENDENCY | app/api/stages/[id]/publish/route.ts:26；app/api/stages/[id]/unpublish/route.ts:25；lib/persistence/document-access.ts:68；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | NO（当前否定结论）；替代方案另需0B |
| VERIFICATION_STATUS | STATIC_CONFIRMED |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |
| EVIDENCE | app/api/stage-meta/[stageId]/route.ts:38；app/api/stages/[id]/publish/route.ts:26；app/api/stages/[id]/unpublish/route.ts:25；lib/persistence/document-access.ts:68 |

### EP-062 — GET /api/stages

| Field | Evidence / finding |
|---|---|
| SURFACE | S02 Stage / Scene / Document |
| ENTRY POINT | /api/stages |
| SOURCE LOCATION | app/api/stages/route.ts:35 |
| INVOCATION | HTTP route |
| HTTP METHOD | GET |
| RESOURCE IDENTIFIER | stageId / sceneId / folderId |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；anonymous_id → anon:UUID；文档 owner_id |
| CURRENT PRINCIPAL | anonymous_id → anon:UUID；文档 owner_id |
| AUTHORIZATION DECISION | listStages按owner过滤。 列表和写入按 anonymous owner；读取实际是 capability-by-id，不检查 is_public 或 owner 相等。owner-bound store 在事务中仅对非 read 校验 owner，已删除拒绝。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 资源读并非由public=true统一约束；publish匿名拒绝，详见S17 |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | DocumentStore/HTTP 为 PUBLIC_STABLE；app owner包装 INTERNAL |
| INTERNAL DEPENDENCY | lib/persistence/owner-bound-document-store.ts:246；lib/persistence/document-access.ts:68；tests/persistence/stage-access-fidelity.test.ts:101；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/api/stages/route.ts:35；lib/persistence/owner-bound-document-store.ts:246；lib/persistence/document-access.ts:68；tests/persistence/stage-access-fidelity.test.ts:101 |

### EP-063 — POST /api/stages

| Field | Evidence / finding |
|---|---|
| SURFACE | S02 Stage / Scene / Document |
| ENTRY POINT | /api/stages |
| SOURCE LOCATION | app/api/stages/route.ts:50 |
| INVOCATION | HTTP route |
| HTTP METHOD | POST |
| RESOURCE IDENTIFIER | stageId / sceneId / folderId |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；anonymous_id → anon:UUID；文档 owner_id |
| CURRENT PRINCIPAL | anonymous_id → anon:UUID；文档 owner_id |
| AUTHORIZATION DECISION | create/save/delete按owner并在存储事务复核；不是Tenant/Role授权。 列表和写入按 anonymous owner；读取实际是 capability-by-id，不检查 is_public 或 owner 相等。owner-bound store 在事务中仅对非 read 校验 owner，已删除拒绝。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 资源读并非由public=true统一约束；publish匿名拒绝，详见S17 |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | DocumentStore/HTTP 为 PUBLIC_STABLE；app owner包装 INTERNAL |
| INTERNAL DEPENDENCY | lib/persistence/owner-bound-document-store.ts:246；lib/persistence/document-access.ts:68；tests/persistence/stage-access-fidelity.test.ts:101；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/api/stages/route.ts:50；lib/persistence/owner-bound-document-store.ts:246；lib/persistence/document-access.ts:68；tests/persistence/stage-access-fidelity.test.ts:101 |

### EP-064 — GET /api/stages/[id]

| Field | Evidence / finding |
|---|---|
| SURFACE | S02 Stage / Scene / Document |
| ENTRY POINT | /api/stages/[id] |
| SOURCE LOCATION | app/api/stages/[id]/route.ts:65 |
| INVOCATION | HTTP route |
| HTTP METHOD | GET |
| RESOURCE IDENTIFIER | stageId / sceneId / folderId |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；anonymous_id → anon:UUID；文档 owner_id |
| CURRENT PRINCIPAL | anonymous_id → anon:UUID；文档 owner_id |
| AUTHORIZATION DECISION | load/readFreshnessManifest走read模式，实际允许知id读取；不能采信owner-only注释。 列表和写入按 anonymous owner；读取实际是 capability-by-id，不检查 is_public 或 owner 相等。owner-bound store 在事务中仅对非 read 校验 owner，已删除拒绝。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 资源读并非由public=true统一约束；publish匿名拒绝，详见S17 |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | DocumentStore/HTTP 为 PUBLIC_STABLE；app owner包装 INTERNAL |
| INTERNAL DEPENDENCY | lib/persistence/owner-bound-document-store.ts:246；lib/persistence/document-access.ts:68；tests/persistence/stage-access-fidelity.test.ts:101；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/api/stages/[id]/route.ts:65；lib/persistence/owner-bound-document-store.ts:246；lib/persistence/document-access.ts:68；tests/persistence/stage-access-fidelity.test.ts:101 |

### EP-065 — PATCH /api/stages/[id]

| Field | Evidence / finding |
|---|---|
| SURFACE | S02 Stage / Scene / Document |
| ENTRY POINT | /api/stages/[id] |
| SOURCE LOCATION | app/api/stages/[id]/route.ts:78 |
| INVOCATION | HTTP route |
| HTTP METHOD | PATCH |
| RESOURCE IDENTIFIER | stageId / sceneId / folderId |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；anonymous_id → anon:UUID；文档 owner_id |
| CURRENT PRINCIPAL | anonymous_id → anon:UUID；文档 owner_id |
| AUTHORIZATION DECISION | create/save/delete按owner并在存储事务复核；不是Tenant/Role授权。 列表和写入按 anonymous owner；读取实际是 capability-by-id，不检查 is_public 或 owner 相等。owner-bound store 在事务中仅对非 read 校验 owner，已删除拒绝。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 资源读并非由public=true统一约束；publish匿名拒绝，详见S17 |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | DocumentStore/HTTP 为 PUBLIC_STABLE；app owner包装 INTERNAL |
| INTERNAL DEPENDENCY | lib/persistence/owner-bound-document-store.ts:246；lib/persistence/document-access.ts:68；tests/persistence/stage-access-fidelity.test.ts:101；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/api/stages/[id]/route.ts:78；lib/persistence/owner-bound-document-store.ts:246；lib/persistence/document-access.ts:68；tests/persistence/stage-access-fidelity.test.ts:101 |

### EP-066 — PUT /api/stages/[id]

| Field | Evidence / finding |
|---|---|
| SURFACE | S02 Stage / Scene / Document |
| ENTRY POINT | /api/stages/[id] |
| SOURCE LOCATION | app/api/stages/[id]/route.ts:118 |
| INVOCATION | HTTP route |
| HTTP METHOD | PUT |
| RESOURCE IDENTIFIER | stageId / sceneId / folderId |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；anonymous_id → anon:UUID；文档 owner_id |
| CURRENT PRINCIPAL | anonymous_id → anon:UUID；文档 owner_id |
| AUTHORIZATION DECISION | create/save/delete按owner并在存储事务复核；不是Tenant/Role授权。 列表和写入按 anonymous owner；读取实际是 capability-by-id，不检查 is_public 或 owner 相等。owner-bound store 在事务中仅对非 read 校验 owner，已删除拒绝。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 资源读并非由public=true统一约束；publish匿名拒绝，详见S17 |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | DocumentStore/HTTP 为 PUBLIC_STABLE；app owner包装 INTERNAL |
| INTERNAL DEPENDENCY | lib/persistence/owner-bound-document-store.ts:246；lib/persistence/document-access.ts:68；tests/persistence/stage-access-fidelity.test.ts:101；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/api/stages/[id]/route.ts:118；lib/persistence/owner-bound-document-store.ts:246；lib/persistence/document-access.ts:68；tests/persistence/stage-access-fidelity.test.ts:101 |

### EP-067 — DELETE /api/stages/[id]

| Field | Evidence / finding |
|---|---|
| SURFACE | S02 Stage / Scene / Document |
| ENTRY POINT | /api/stages/[id] |
| SOURCE LOCATION | app/api/stages/[id]/route.ts:180 |
| INVOCATION | HTTP route |
| HTTP METHOD | DELETE |
| RESOURCE IDENTIFIER | stageId / sceneId / folderId |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；anonymous_id → anon:UUID；文档 owner_id |
| CURRENT PRINCIPAL | anonymous_id → anon:UUID；文档 owner_id |
| AUTHORIZATION DECISION | create/save/delete按owner并在存储事务复核；不是Tenant/Role授权。 列表和写入按 anonymous owner；读取实际是 capability-by-id，不检查 is_public 或 owner 相等。owner-bound store 在事务中仅对非 read 校验 owner，已删除拒绝。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 资源读并非由public=true统一约束；publish匿名拒绝，详见S17 |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | DocumentStore/HTTP 为 PUBLIC_STABLE；app owner包装 INTERNAL |
| INTERNAL DEPENDENCY | lib/persistence/owner-bound-document-store.ts:246；lib/persistence/document-access.ts:68；tests/persistence/stage-access-fidelity.test.ts:101；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/api/stages/[id]/route.ts:180；lib/persistence/owner-bound-document-store.ts:246；lib/persistence/document-access.ts:68；tests/persistence/stage-access-fidelity.test.ts:101 |

### EP-068 — GET /api/stages/[id]/freshness

| Field | Evidence / finding |
|---|---|
| SURFACE | S14 Agent / Stage Streaming |
| ENTRY POINT | /api/stages/[id]/freshness |
| SOURCE LOCATION | app/api/stages/[id]/freshness/route.ts:46 |
| INVOCATION | HTTP route |
| HTTP METHOD | GET |
| RESOURCE IDENTIFIER | sessionId / event cursor / stageId |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；建立连接时owner；没有Zhiban authorizationVersion |
| CURRENT PRINCIPAL | 建立连接时owner；没有Zhiban authorizationVersion |
| AUTHORIZATION DECISION | SSE建立时读取owner/session；阶段freshness读取也是capability-by-id。轮询/断连/lease不包含Zhiban角色、Membership、Tenant撤销检查；取消stream不保证后台工具停止。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：外围能拒绝入口，但完整安全接线尚无稳定支持 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | SSE协议 PUBLIC_BUT_UNVERSIONED；runner lease/revocation INTERNAL |
| INTERNAL DEPENDENCY | app/api/agent/sessions/[id]/events/route.ts:77；app/api/agent/owner-events/route.ts:49；app/api/stages/[id]/freshness/route.ts:50；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |
| EVIDENCE | app/api/stages/[id]/freshness/route.ts:46；app/api/agent/sessions/[id]/events/route.ts:77；app/api/agent/owner-events/route.ts:49；app/api/stages/[id]/freshness/route.ts:50 |

### EP-069 — POST /api/stages/[id]/generation-complete

| Field | Evidence / finding |
|---|---|
| SURFACE | S02 Stage / Scene / Document |
| ENTRY POINT | /api/stages/[id]/generation-complete |
| SOURCE LOCATION | app/api/stages/[id]/generation-complete/route.ts:20 |
| INVOCATION | HTTP route |
| HTTP METHOD | POST |
| RESOURCE IDENTIFIER | stageId / sceneId / folderId |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；anonymous_id → anon:UUID；文档 owner_id |
| CURRENT PRINCIPAL | anonymous_id → anon:UUID；文档 owner_id |
| AUTHORIZATION DECISION | create/save/delete按owner并在存储事务复核；不是Tenant/Role授权。 列表和写入按 anonymous owner；读取实际是 capability-by-id，不检查 is_public 或 owner 相等。owner-bound store 在事务中仅对非 read 校验 owner，已删除拒绝。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 资源读并非由public=true统一约束；publish匿名拒绝，详见S17 |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | DocumentStore/HTTP 为 PUBLIC_STABLE；app owner包装 INTERNAL |
| INTERNAL DEPENDENCY | lib/persistence/owner-bound-document-store.ts:246；lib/persistence/document-access.ts:68；tests/persistence/stage-access-fidelity.test.ts:101；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/api/stages/[id]/generation-complete/route.ts:20；lib/persistence/owner-bound-document-store.ts:246；lib/persistence/document-access.ts:68；tests/persistence/stage-access-fidelity.test.ts:101 |

### EP-070 — GET /api/stages/[id]/manifest

| Field | Evidence / finding |
|---|---|
| SURFACE | S02 Stage / Scene / Document |
| ENTRY POINT | /api/stages/[id]/manifest |
| SOURCE LOCATION | app/api/stages/[id]/manifest/route.ts:28 |
| INVOCATION | HTTP route |
| HTTP METHOD | GET |
| RESOURCE IDENTIFIER | stageId / sceneId / folderId |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；anonymous_id → anon:UUID；文档 owner_id |
| CURRENT PRINCIPAL | anonymous_id → anon:UUID；文档 owner_id |
| AUTHORIZATION DECISION | load/readFreshnessManifest走read模式，实际允许知id读取；不能采信owner-only注释。 列表和写入按 anonymous owner；读取实际是 capability-by-id，不检查 is_public 或 owner 相等。owner-bound store 在事务中仅对非 read 校验 owner，已删除拒绝。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 资源读并非由public=true统一约束；publish匿名拒绝，详见S17 |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | DocumentStore/HTTP 为 PUBLIC_STABLE；app owner包装 INTERNAL |
| INTERNAL DEPENDENCY | lib/persistence/owner-bound-document-store.ts:246；lib/persistence/document-access.ts:68；tests/persistence/stage-access-fidelity.test.ts:101；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/api/stages/[id]/manifest/route.ts:28；lib/persistence/owner-bound-document-store.ts:246；lib/persistence/document-access.ts:68；tests/persistence/stage-access-fidelity.test.ts:101 |

### EP-071 — POST /api/stages/[id]/publish

| Field | Evidence / finding |
|---|---|
| SURFACE | S17 Public / Published |
| ENTRY POINT | /api/stages/[id]/publish |
| SOURCE LOCATION | app/api/stages/[id]/publish/route.ts:20 |
| INVOCATION | HTTP route |
| HTTP METHOD | POST |
| RESOURCE IDENTIFIER | stageId / isPublic / publishedAt |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；owner / public状态（状态不是principal） |
| CURRENT PRINCIPAL | owner / public状态（状态不是principal） |
| AUTHORIZATION DECISION | 先拒绝anon: owner，再比对资源owner；authenticatedOwnerId在现有调用链未接线。 publish/unpublish拒绝anon: owner；现有with-owner始终匿名，所以无真实authenticated publish接线。status/meta向知id者返回状态；文档read不要求public=true。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 资源读并非由public=true统一约束；publish匿名拒绝，详见S17 |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：外围能拒绝入口，但完整安全接线尚无稳定支持 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | stage-access、stage_meta INTERNAL；无tenant-scoped published契约 |
| INTERNAL DEPENDENCY | app/api/stages/[id]/publish/route.ts:26；app/api/stages/[id]/unpublish/route.ts:25；lib/persistence/document-access.ts:68；分类见I01–I08 |
| CORE CHANGE REQUIRED | YES（保留当前原生接线时；C/D禁止本地修改；须上游扩展或替代路径评审） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | NO（当前否定结论）；替代方案另需0B |
| VERIFICATION_STATUS | STATIC_CONFIRMED |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |
| EVIDENCE | app/api/stages/[id]/publish/route.ts:20；app/api/stages/[id]/publish/route.ts:26；app/api/stages/[id]/unpublish/route.ts:25；lib/persistence/document-access.ts:68 |

### EP-072 — GET /api/stages/[id]/scenes

| Field | Evidence / finding |
|---|---|
| SURFACE | S02 Stage / Scene / Document |
| ENTRY POINT | /api/stages/[id]/scenes |
| SOURCE LOCATION | app/api/stages/[id]/scenes/route.ts:48 |
| INVOCATION | HTTP route |
| HTTP METHOD | GET |
| RESOURCE IDENTIFIER | stageId / sceneId / folderId |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；anonymous_id → anon:UUID；文档 owner_id |
| CURRENT PRINCIPAL | anonymous_id → anon:UUID；文档 owner_id |
| AUTHORIZATION DECISION | load/readFreshnessManifest走read模式，实际允许知id读取；不能采信owner-only注释。 列表和写入按 anonymous owner；读取实际是 capability-by-id，不检查 is_public 或 owner 相等。owner-bound store 在事务中仅对非 read 校验 owner，已删除拒绝。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 资源读并非由public=true统一约束；publish匿名拒绝，详见S17 |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | DocumentStore/HTTP 为 PUBLIC_STABLE；app owner包装 INTERNAL |
| INTERNAL DEPENDENCY | lib/persistence/owner-bound-document-store.ts:246；lib/persistence/document-access.ts:68；tests/persistence/stage-access-fidelity.test.ts:101；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/api/stages/[id]/scenes/route.ts:48；lib/persistence/owner-bound-document-store.ts:246；lib/persistence/document-access.ts:68；tests/persistence/stage-access-fidelity.test.ts:101 |

### EP-073 — GET /api/stages/[id]/status

| Field | Evidence / finding |
|---|---|
| SURFACE | S17 Public / Published |
| ENTRY POINT | /api/stages/[id]/status |
| SOURCE LOCATION | app/api/stages/[id]/status/route.ts:21 |
| INVOCATION | HTTP route |
| HTTP METHOD | GET |
| RESOURCE IDENTIFIER | stageId / isPublic / publishedAt |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；owner / public状态（状态不是principal） |
| CURRENT PRINCIPAL | owner / public状态（状态不是principal） |
| AUTHORIZATION DECISION | 只返回存在/发布/owner布尔等metadata，不赋予Tenant授权。 publish/unpublish拒绝anon: owner；现有with-owner始终匿名，所以无真实authenticated publish接线。status/meta向知id者返回状态；文档read不要求public=true。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 资源读并非由public=true统一约束；publish匿名拒绝，详见S17 |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：外围能拒绝入口，但完整安全接线尚无稳定支持 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | stage-access、stage_meta INTERNAL；无tenant-scoped published契约 |
| INTERNAL DEPENDENCY | app/api/stages/[id]/publish/route.ts:26；app/api/stages/[id]/unpublish/route.ts:25；lib/persistence/document-access.ts:68；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | NO（当前否定结论）；替代方案另需0B |
| VERIFICATION_STATUS | STATIC_CONFIRMED |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |
| EVIDENCE | app/api/stages/[id]/status/route.ts:21；app/api/stages/[id]/publish/route.ts:26；app/api/stages/[id]/unpublish/route.ts:25；lib/persistence/document-access.ts:68 |

### EP-074 — POST /api/stages/[id]/unpublish

| Field | Evidence / finding |
|---|---|
| SURFACE | S17 Public / Published |
| ENTRY POINT | /api/stages/[id]/unpublish |
| SOURCE LOCATION | app/api/stages/[id]/unpublish/route.ts:19 |
| INVOCATION | HTTP route |
| HTTP METHOD | POST |
| RESOURCE IDENTIFIER | stageId / isPublic / publishedAt |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；owner / public状态（状态不是principal） |
| CURRENT PRINCIPAL | owner / public状态（状态不是principal） |
| AUTHORIZATION DECISION | 先拒绝anon: owner，再比对资源owner；authenticatedOwnerId在现有调用链未接线。 publish/unpublish拒绝anon: owner；现有with-owner始终匿名，所以无真实authenticated publish接线。status/meta向知id者返回状态；文档read不要求public=true。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 资源读并非由public=true统一约束；publish匿名拒绝，详见S17 |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：外围能拒绝入口，但完整安全接线尚无稳定支持 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | stage-access、stage_meta INTERNAL；无tenant-scoped published契约 |
| INTERNAL DEPENDENCY | app/api/stages/[id]/publish/route.ts:26；app/api/stages/[id]/unpublish/route.ts:25；lib/persistence/document-access.ts:68；分类见I01–I08 |
| CORE CHANGE REQUIRED | YES（保留当前原生接线时；C/D禁止本地修改；须上游扩展或替代路径评审） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | NO（当前否定结论）；替代方案另需0B |
| VERIFICATION_STATUS | STATIC_CONFIRMED |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |
| EVIDENCE | app/api/stages/[id]/unpublish/route.ts:19；app/api/stages/[id]/publish/route.ts:26；app/api/stages/[id]/unpublish/route.ts:25；lib/persistence/document-access.ts:68 |

### EP-075 — POST /api/transcription

| Field | Evidence / finding |
|---|---|
| SURFACE | S20 Provider / Platform Support |
| ENTRY POINT | /api/transcription |
| SOURCE LOCATION | app/api/transcription/route.ts:19 |
| INVOCATION | HTTP route |
| HTTP METHOD | POST |
| RESOURCE IDENTIFIER | provider/model / usage period / config |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；deployment access code / clientIdentity / provider credential |
| CURRENT PRINCIPAL | deployment access code / clientIdentity / provider credential |
| AUTHORIZATION DECISION | provider探测、usage、search、voices和健康/开关端点没有Zhiban RBAC。默认access code是部署门，不是租户门；health/status显式例外。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | 业务资源请求YES；health/config无资源可N/A |
| SUPPORTED PUBLIC CONTRACT | HTTP PUBLIC_BUT_UNVERSIONED；server credential策略 INTERNAL |
| INTERNAL DEPENDENCY | middleware.ts；app/api/usage/route.ts；app/api/server-providers/route.ts；app/api/access-code/verify/route.ts；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/api/transcription/route.ts:19；middleware.ts；app/api/usage/route.ts；app/api/server-providers/route.ts；app/api/access-code/verify/route.ts |

### EP-076 — GET /api/usage

| Field | Evidence / finding |
|---|---|
| SURFACE | S20 Provider / Platform Support |
| ENTRY POINT | /api/usage |
| SOURCE LOCATION | app/api/usage/route.ts:71 |
| INVOCATION | HTTP route |
| HTTP METHOD | GET |
| RESOURCE IDENTIFIER | provider/model / usage period / config |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；deployment access code / clientIdentity / provider credential |
| CURRENT PRINCIPAL | deployment access code / clientIdentity / provider credential |
| AUTHORIZATION DECISION | provider探测、usage、search、voices和健康/开关端点没有Zhiban RBAC。默认access code是部署门，不是租户门；health/status显式例外。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | 业务资源请求YES；health/config无资源可N/A |
| SUPPORTED PUBLIC CONTRACT | HTTP PUBLIC_BUT_UNVERSIONED；server credential策略 INTERNAL |
| INTERNAL DEPENDENCY | middleware.ts；app/api/usage/route.ts；app/api/server-providers/route.ts；app/api/access-code/verify/route.ts；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/api/usage/route.ts:71；middleware.ts；app/api/usage/route.ts；app/api/server-providers/route.ts；app/api/access-code/verify/route.ts |

### EP-077 — POST /api/verify-image-provider

| Field | Evidence / finding |
|---|---|
| SURFACE | S20 Provider / Platform Support |
| ENTRY POINT | /api/verify-image-provider |
| SOURCE LOCATION | app/api/verify-image-provider/route.ts:39 |
| INVOCATION | HTTP route |
| HTTP METHOD | POST |
| RESOURCE IDENTIFIER | provider/model / usage period / config |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；deployment access code / clientIdentity / provider credential |
| CURRENT PRINCIPAL | deployment access code / clientIdentity / provider credential |
| AUTHORIZATION DECISION | provider探测、usage、search、voices和健康/开关端点没有Zhiban RBAC。默认access code是部署门，不是租户门；health/status显式例外。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | 业务资源请求YES；health/config无资源可N/A |
| SUPPORTED PUBLIC CONTRACT | HTTP PUBLIC_BUT_UNVERSIONED；server credential策略 INTERNAL |
| INTERNAL DEPENDENCY | middleware.ts；app/api/usage/route.ts；app/api/server-providers/route.ts；app/api/access-code/verify/route.ts；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/api/verify-image-provider/route.ts:39；middleware.ts；app/api/usage/route.ts；app/api/server-providers/route.ts；app/api/access-code/verify/route.ts |

### EP-078 — POST /api/verify-model

| Field | Evidence / finding |
|---|---|
| SURFACE | S20 Provider / Platform Support |
| ENTRY POINT | /api/verify-model |
| SOURCE LOCATION | app/api/verify-model/route.ts:8 |
| INVOCATION | HTTP route |
| HTTP METHOD | POST |
| RESOURCE IDENTIFIER | provider/model / usage period / config |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；deployment access code / clientIdentity / provider credential |
| CURRENT PRINCIPAL | deployment access code / clientIdentity / provider credential |
| AUTHORIZATION DECISION | provider探测、usage、search、voices和健康/开关端点没有Zhiban RBAC。默认access code是部署门，不是租户门；health/status显式例外。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | 业务资源请求YES；health/config无资源可N/A |
| SUPPORTED PUBLIC CONTRACT | HTTP PUBLIC_BUT_UNVERSIONED；server credential策略 INTERNAL |
| INTERNAL DEPENDENCY | middleware.ts；app/api/usage/route.ts；app/api/server-providers/route.ts；app/api/access-code/verify/route.ts；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/api/verify-model/route.ts:8；middleware.ts；app/api/usage/route.ts；app/api/server-providers/route.ts；app/api/access-code/verify/route.ts |

### EP-079 — POST /api/verify-pdf-provider

| Field | Evidence / finding |
|---|---|
| SURFACE | S20 Provider / Platform Support |
| ENTRY POINT | /api/verify-pdf-provider |
| SOURCE LOCATION | app/api/verify-pdf-provider/route.ts:15 |
| INVOCATION | HTTP route |
| HTTP METHOD | POST |
| RESOURCE IDENTIFIER | provider/model / usage period / config |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；deployment access code / clientIdentity / provider credential |
| CURRENT PRINCIPAL | deployment access code / clientIdentity / provider credential |
| AUTHORIZATION DECISION | provider探测、usage、search、voices和健康/开关端点没有Zhiban RBAC。默认access code是部署门，不是租户门；health/status显式例外。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | 业务资源请求YES；health/config无资源可N/A |
| SUPPORTED PUBLIC CONTRACT | HTTP PUBLIC_BUT_UNVERSIONED；server credential策略 INTERNAL |
| INTERNAL DEPENDENCY | middleware.ts；app/api/usage/route.ts；app/api/server-providers/route.ts；app/api/access-code/verify/route.ts；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/api/verify-pdf-provider/route.ts:15；middleware.ts；app/api/usage/route.ts；app/api/server-providers/route.ts；app/api/access-code/verify/route.ts |

### EP-080 — POST /api/verify-video-provider

| Field | Evidence / finding |
|---|---|
| SURFACE | S20 Provider / Platform Support |
| ENTRY POINT | /api/verify-video-provider |
| SOURCE LOCATION | app/api/verify-video-provider/route.ts:34 |
| INVOCATION | HTTP route |
| HTTP METHOD | POST |
| RESOURCE IDENTIFIER | provider/model / usage period / config |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；deployment access code / clientIdentity / provider credential |
| CURRENT PRINCIPAL | deployment access code / clientIdentity / provider credential |
| AUTHORIZATION DECISION | provider探测、usage、search、voices和健康/开关端点没有Zhiban RBAC。默认access code是部署门，不是租户门；health/status显式例外。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | 业务资源请求YES；health/config无资源可N/A |
| SUPPORTED PUBLIC CONTRACT | HTTP PUBLIC_BUT_UNVERSIONED；server credential策略 INTERNAL |
| INTERNAL DEPENDENCY | middleware.ts；app/api/usage/route.ts；app/api/server-providers/route.ts；app/api/access-code/verify/route.ts；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/api/verify-video-provider/route.ts:34；middleware.ts；app/api/usage/route.ts；app/api/server-providers/route.ts；app/api/access-code/verify/route.ts |

### EP-081 — POST /api/web-search

| Field | Evidence / finding |
|---|---|
| SURFACE | S20 Provider / Platform Support |
| ENTRY POINT | /api/web-search |
| SOURCE LOCATION | app/api/web-search/route.ts:32 |
| INVOCATION | HTTP route |
| HTTP METHOD | POST |
| RESOURCE IDENTIFIER | provider/model / usage period / config |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；deployment access code / clientIdentity / provider credential |
| CURRENT PRINCIPAL | deployment access code / clientIdentity / provider credential |
| AUTHORIZATION DECISION | provider探测、usage、search、voices和健康/开关端点没有Zhiban RBAC。默认access code是部署门，不是租户门；health/status显式例外。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | 业务资源请求YES；health/config无资源可N/A |
| SUPPORTED PUBLIC CONTRACT | HTTP PUBLIC_BUT_UNVERSIONED；server credential策略 INTERNAL |
| INTERNAL DEPENDENCY | middleware.ts；app/api/usage/route.ts；app/api/server-providers/route.ts；app/api/access-code/verify/route.ts；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/api/web-search/route.ts:32；middleware.ts；app/api/usage/route.ts；app/api/server-providers/route.ts；app/api/access-code/verify/route.ts |

### EP-082 — PUT /api/persistence/documents/{stageId}

| Field | Evidence / finding |
|---|---|
| SURFACE | S02 Stage / Scene / Document |
| ENTRY POINT | /api/persistence/documents/{stageId} |
| SOURCE LOCATION | app/api/persistence/[...path]/route.ts:345 |
| INVOCATION | catch-all → storage document handler |
| HTTP METHOD | PUT |
| RESOURCE IDENTIFIER | stageId / sceneId / folderId |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；anonymous_id → anon:UUID；文档 owner_id |
| CURRENT PRINCIPAL | anonymous_id → anon:UUID；文档 owner_id |
| AUTHORIZATION DECISION | 按owner授权；create重读并发meta，store事务复核。 列表和写入按 anonymous owner；读取实际是 capability-by-id，不检查 is_public 或 owner 相等。owner-bound store 在事务中仅对非 read 校验 owner，已删除拒绝。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 资源读并非由public=true统一约束；publish匿名拒绝，详见S17 |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | DocumentStore/HTTP 为 PUBLIC_STABLE；app owner包装 INTERNAL |
| INTERNAL DEPENDENCY | lib/persistence/owner-bound-document-store.ts:246；lib/persistence/document-access.ts:68；tests/persistence/stage-access-fidelity.test.ts:101；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/api/persistence/[...path]/route.ts:345；lib/persistence/owner-bound-document-store.ts:246；lib/persistence/document-access.ts:68；tests/persistence/stage-access-fidelity.test.ts:101 |

### EP-083 — GET /api/persistence/documents/{stageId}

| Field | Evidence / finding |
|---|---|
| SURFACE | S02 Stage / Scene / Document |
| ENTRY POINT | /api/persistence/documents/{stageId} |
| SOURCE LOCATION | app/api/persistence/[...path]/route.ts:345 |
| INVOCATION | catch-all → storage document handler |
| HTTP METHOD | GET |
| RESOURCE IDENTIFIER | stageId / sceneId / folderId |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；anonymous_id → anon:UUID；文档 owner_id |
| CURRENT PRINCIPAL | anonymous_id → anon:UUID；文档 owner_id |
| AUTHORIZATION DECISION | meta存在未deleted即allow；store read也无owner相等检查。 列表和写入按 anonymous owner；读取实际是 capability-by-id，不检查 is_public 或 owner 相等。owner-bound store 在事务中仅对非 read 校验 owner，已删除拒绝。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 资源读并非由public=true统一约束；publish匿名拒绝，详见S17 |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | DocumentStore/HTTP 为 PUBLIC_STABLE；app owner包装 INTERNAL |
| INTERNAL DEPENDENCY | lib/persistence/owner-bound-document-store.ts:246；lib/persistence/document-access.ts:68；tests/persistence/stage-access-fidelity.test.ts:101；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/api/persistence/[...path]/route.ts:345；lib/persistence/owner-bound-document-store.ts:246；lib/persistence/document-access.ts:68；tests/persistence/stage-access-fidelity.test.ts:101 |

### EP-084 — GET /api/persistence/documents

| Field | Evidence / finding |
|---|---|
| SURFACE | S02 Stage / Scene / Document |
| ENTRY POINT | /api/persistence/documents |
| SOURCE LOCATION | app/api/persistence/[...path]/route.ts:345 |
| INVOCATION | catch-all → storage document handler |
| HTTP METHOD | GET |
| RESOURCE IDENTIFIER | stageId / sceneId / folderId |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；anonymous_id → anon:UUID；文档 owner_id |
| CURRENT PRINCIPAL | anonymous_id → anon:UUID；文档 owner_id |
| AUTHORIZATION DECISION | embedded拒绝list。 列表和写入按 anonymous owner；读取实际是 capability-by-id，不检查 is_public 或 owner 相等。owner-bound store 在事务中仅对非 read 校验 owner，已删除拒绝。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 资源读并非由public=true统一约束；publish匿名拒绝，详见S17 |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | DocumentStore/HTTP 为 PUBLIC_STABLE；app owner包装 INTERNAL |
| INTERNAL DEPENDENCY | lib/persistence/owner-bound-document-store.ts:246；lib/persistence/document-access.ts:68；tests/persistence/stage-access-fidelity.test.ts:101；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/api/persistence/[...path]/route.ts:345；lib/persistence/owner-bound-document-store.ts:246；lib/persistence/document-access.ts:68；tests/persistence/stage-access-fidelity.test.ts:101 |

### EP-085 — DELETE /api/persistence/documents/{stageId}

| Field | Evidence / finding |
|---|---|
| SURFACE | S02 Stage / Scene / Document |
| ENTRY POINT | /api/persistence/documents/{stageId} |
| SOURCE LOCATION | app/api/persistence/[...path]/route.ts:345 |
| INVOCATION | catch-all → storage document handler |
| HTTP METHOD | DELETE |
| RESOURCE IDENTIFIER | stageId / sceneId / folderId |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；anonymous_id → anon:UUID；文档 owner_id |
| CURRENT PRINCIPAL | anonymous_id → anon:UUID；文档 owner_id |
| AUTHORIZATION DECISION | 按owner授权；create重读并发meta，store事务复核。 列表和写入按 anonymous owner；读取实际是 capability-by-id，不检查 is_public 或 owner 相等。owner-bound store 在事务中仅对非 read 校验 owner，已删除拒绝。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 资源读并非由public=true统一约束；publish匿名拒绝，详见S17 |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | DocumentStore/HTTP 为 PUBLIC_STABLE；app owner包装 INTERNAL |
| INTERNAL DEPENDENCY | lib/persistence/owner-bound-document-store.ts:246；lib/persistence/document-access.ts:68；tests/persistence/stage-access-fidelity.test.ts:101；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/api/persistence/[...path]/route.ts:345；lib/persistence/owner-bound-document-store.ts:246；lib/persistence/document-access.ts:68；tests/persistence/stage-access-fidelity.test.ts:101 |

### EP-086 — PUT /api/persistence/documents/{stageId}/stage

| Field | Evidence / finding |
|---|---|
| SURFACE | S02 Stage / Scene / Document |
| ENTRY POINT | /api/persistence/documents/{stageId}/stage |
| SOURCE LOCATION | app/api/persistence/[...path]/route.ts:345 |
| INVOCATION | catch-all → storage document handler |
| HTTP METHOD | PUT |
| RESOURCE IDENTIFIER | stageId / sceneId / folderId |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；anonymous_id → anon:UUID；文档 owner_id |
| CURRENT PRINCIPAL | anonymous_id → anon:UUID；文档 owner_id |
| AUTHORIZATION DECISION | 按owner授权；create重读并发meta，store事务复核。 列表和写入按 anonymous owner；读取实际是 capability-by-id，不检查 is_public 或 owner 相等。owner-bound store 在事务中仅对非 read 校验 owner，已删除拒绝。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 资源读并非由public=true统一约束；publish匿名拒绝，详见S17 |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | DocumentStore/HTTP 为 PUBLIC_STABLE；app owner包装 INTERNAL |
| INTERNAL DEPENDENCY | lib/persistence/owner-bound-document-store.ts:246；lib/persistence/document-access.ts:68；tests/persistence/stage-access-fidelity.test.ts:101；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/api/persistence/[...path]/route.ts:345；lib/persistence/owner-bound-document-store.ts:246；lib/persistence/document-access.ts:68；tests/persistence/stage-access-fidelity.test.ts:101 |

### EP-087 — PUT /api/persistence/documents/{stageId}/scenes/{sceneId}

| Field | Evidence / finding |
|---|---|
| SURFACE | S02 Stage / Scene / Document |
| ENTRY POINT | /api/persistence/documents/{stageId}/scenes/{sceneId} |
| SOURCE LOCATION | app/api/persistence/[...path]/route.ts:345 |
| INVOCATION | catch-all → storage document handler |
| HTTP METHOD | PUT |
| RESOURCE IDENTIFIER | stageId / sceneId / folderId |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；anonymous_id → anon:UUID；文档 owner_id |
| CURRENT PRINCIPAL | anonymous_id → anon:UUID；文档 owner_id |
| AUTHORIZATION DECISION | 按owner授权；create重读并发meta，store事务复核。 列表和写入按 anonymous owner；读取实际是 capability-by-id，不检查 is_public 或 owner 相等。owner-bound store 在事务中仅对非 read 校验 owner，已删除拒绝。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 资源读并非由public=true统一约束；publish匿名拒绝，详见S17 |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | DocumentStore/HTTP 为 PUBLIC_STABLE；app owner包装 INTERNAL |
| INTERNAL DEPENDENCY | lib/persistence/owner-bound-document-store.ts:246；lib/persistence/document-access.ts:68；tests/persistence/stage-access-fidelity.test.ts:101；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/api/persistence/[...path]/route.ts:345；lib/persistence/owner-bound-document-store.ts:246；lib/persistence/document-access.ts:68；tests/persistence/stage-access-fidelity.test.ts:101 |

### EP-088 — GET /api/persistence/documents/{stageId}/scenes/{sceneId}

| Field | Evidence / finding |
|---|---|
| SURFACE | S02 Stage / Scene / Document |
| ENTRY POINT | /api/persistence/documents/{stageId}/scenes/{sceneId} |
| SOURCE LOCATION | app/api/persistence/[...path]/route.ts:345 |
| INVOCATION | catch-all → storage document handler |
| HTTP METHOD | GET |
| RESOURCE IDENTIFIER | stageId / sceneId / folderId |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；anonymous_id → anon:UUID；文档 owner_id |
| CURRENT PRINCIPAL | anonymous_id → anon:UUID；文档 owner_id |
| AUTHORIZATION DECISION | meta存在未deleted即allow；store read也无owner相等检查。 列表和写入按 anonymous owner；读取实际是 capability-by-id，不检查 is_public 或 owner 相等。owner-bound store 在事务中仅对非 read 校验 owner，已删除拒绝。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 资源读并非由public=true统一约束；publish匿名拒绝，详见S17 |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | DocumentStore/HTTP 为 PUBLIC_STABLE；app owner包装 INTERNAL |
| INTERNAL DEPENDENCY | lib/persistence/owner-bound-document-store.ts:246；lib/persistence/document-access.ts:68；tests/persistence/stage-access-fidelity.test.ts:101；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/api/persistence/[...path]/route.ts:345；lib/persistence/owner-bound-document-store.ts:246；lib/persistence/document-access.ts:68；tests/persistence/stage-access-fidelity.test.ts:101 |

### EP-089 — DELETE /api/persistence/documents/{stageId}/scenes/{sceneId}

| Field | Evidence / finding |
|---|---|
| SURFACE | S02 Stage / Scene / Document |
| ENTRY POINT | /api/persistence/documents/{stageId}/scenes/{sceneId} |
| SOURCE LOCATION | app/api/persistence/[...path]/route.ts:345 |
| INVOCATION | catch-all → storage document handler |
| HTTP METHOD | DELETE |
| RESOURCE IDENTIFIER | stageId / sceneId / folderId |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；anonymous_id → anon:UUID；文档 owner_id |
| CURRENT PRINCIPAL | anonymous_id → anon:UUID；文档 owner_id |
| AUTHORIZATION DECISION | 按owner授权；create重读并发meta，store事务复核。 列表和写入按 anonymous owner；读取实际是 capability-by-id，不检查 is_public 或 owner 相等。owner-bound store 在事务中仅对非 read 校验 owner，已删除拒绝。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 资源读并非由public=true统一约束；publish匿名拒绝，详见S17 |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | DocumentStore/HTTP 为 PUBLIC_STABLE；app owner包装 INTERNAL |
| INTERNAL DEPENDENCY | lib/persistence/owner-bound-document-store.ts:246；lib/persistence/document-access.ts:68；tests/persistence/stage-access-fidelity.test.ts:101；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/api/persistence/[...path]/route.ts:345；lib/persistence/owner-bound-document-store.ts:246；lib/persistence/document-access.ts:68；tests/persistence/stage-access-fidelity.test.ts:101 |

### EP-090 — POST /api/persistence/runtime/sessions

| Field | Evidence / finding |
|---|---|
| SURFACE | S10 Embedded HTTP Runtime |
| ENTRY POINT | /api/persistence/runtime/sessions |
| SOURCE LOCATION | packages/@openmaic/storage/src/server/index.ts:408 |
| INVOCATION | catch-all → storage runtime handler |
| HTTP METHOD | POST |
| RESOURCE IDENTIFIER | sessionId / stageId / learnerKey / record |
| CURRENT AUTH | development bearer；production默认拒绝；不得opt-in用于V2 |
| CURRENT PRINCIPAL | 客户端 learnerKey + 开发 bearer；不是Membership |
| AUTHORIZATION DECISION | package验证principal.learnerKey/session归属，但embedded principal来自客户端header；未验证课程Enrollment。 内嵌Runtime信任通过开发token验证后传入的x-learner-key；生产默认拒绝，insecure opt-in才能开启此路径。禁止用该模式承载V2生产学习证据。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | 当前embedded模式NO；独立package可信宿主为待评审替代 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | RuntimeStore HTTP和authenticate注入 PUBLIC_STABLE，但当前应用接线不是可信身份 |
| INTERNAL DEPENDENCY | lib/persistence/server-auth.ts:1；lib/persistence/bootstrap.ts:40；packages/@openmaic/storage/src/server/index.ts:241；分类见I01–I08 |
| CORE CHANGE REQUIRED | YES（保留当前原生接线时；C/D禁止本地修改；须上游扩展或替代路径评审） |
| POTENTIAL BYPASS | 伪造learner header取得任意已知分区（dev模式）；生产默认拒绝 |
| DYNAMIC_VERIFICATION_REQUIRED | NO（当前否定结论）；替代方案另需0B |
| VERIFICATION_STATUS | STATIC_CONFIRMED |
| VERDICT | BLOCKED |
| EVIDENCE | packages/@openmaic/storage/src/server/index.ts:408；lib/persistence/server-auth.ts:1；lib/persistence/bootstrap.ts:40；packages/@openmaic/storage/src/server/index.ts:241 |

### EP-091 — GET /api/persistence/runtime/sessions/{sessionId}

| Field | Evidence / finding |
|---|---|
| SURFACE | S10 Embedded HTTP Runtime |
| ENTRY POINT | /api/persistence/runtime/sessions/{sessionId} |
| SOURCE LOCATION | packages/@openmaic/storage/src/server/index.ts:408 |
| INVOCATION | catch-all → storage runtime handler |
| HTTP METHOD | GET |
| RESOURCE IDENTIFIER | sessionId / stageId / learnerKey / record |
| CURRENT AUTH | development bearer；production默认拒绝；不得opt-in用于V2 |
| CURRENT PRINCIPAL | 客户端 learnerKey + 开发 bearer；不是Membership |
| AUTHORIZATION DECISION | package验证principal.learnerKey/session归属，但embedded principal来自客户端header；未验证课程Enrollment。 内嵌Runtime信任通过开发token验证后传入的x-learner-key；生产默认拒绝，insecure opt-in才能开启此路径。禁止用该模式承载V2生产学习证据。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | 当前embedded模式NO；独立package可信宿主为待评审替代 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | RuntimeStore HTTP和authenticate注入 PUBLIC_STABLE，但当前应用接线不是可信身份 |
| INTERNAL DEPENDENCY | lib/persistence/server-auth.ts:1；lib/persistence/bootstrap.ts:40；packages/@openmaic/storage/src/server/index.ts:241；分类见I01–I08 |
| CORE CHANGE REQUIRED | YES（保留当前原生接线时；C/D禁止本地修改；须上游扩展或替代路径评审） |
| POTENTIAL BYPASS | 伪造learner header取得任意已知分区（dev模式）；生产默认拒绝 |
| DYNAMIC_VERIFICATION_REQUIRED | NO（当前否定结论）；替代方案另需0B |
| VERIFICATION_STATUS | STATIC_CONFIRMED |
| VERDICT | BLOCKED |
| EVIDENCE | packages/@openmaic/storage/src/server/index.ts:408；lib/persistence/server-auth.ts:1；lib/persistence/bootstrap.ts:40；packages/@openmaic/storage/src/server/index.ts:241 |

### EP-092 — PATCH /api/persistence/runtime/sessions/{sessionId}/status

| Field | Evidence / finding |
|---|---|
| SURFACE | S10 Embedded HTTP Runtime |
| ENTRY POINT | /api/persistence/runtime/sessions/{sessionId}/status |
| SOURCE LOCATION | packages/@openmaic/storage/src/server/index.ts:408 |
| INVOCATION | catch-all → storage runtime handler |
| HTTP METHOD | PATCH |
| RESOURCE IDENTIFIER | sessionId / stageId / learnerKey / record |
| CURRENT AUTH | development bearer；production默认拒绝；不得opt-in用于V2 |
| CURRENT PRINCIPAL | 客户端 learnerKey + 开发 bearer；不是Membership |
| AUTHORIZATION DECISION | package验证principal.learnerKey/session归属，但embedded principal来自客户端header；未验证课程Enrollment。 内嵌Runtime信任通过开发token验证后传入的x-learner-key；生产默认拒绝，insecure opt-in才能开启此路径。禁止用该模式承载V2生产学习证据。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | 当前embedded模式NO；独立package可信宿主为待评审替代 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | RuntimeStore HTTP和authenticate注入 PUBLIC_STABLE，但当前应用接线不是可信身份 |
| INTERNAL DEPENDENCY | lib/persistence/server-auth.ts:1；lib/persistence/bootstrap.ts:40；packages/@openmaic/storage/src/server/index.ts:241；分类见I01–I08 |
| CORE CHANGE REQUIRED | YES（保留当前原生接线时；C/D禁止本地修改；须上游扩展或替代路径评审） |
| POTENTIAL BYPASS | 伪造learner header取得任意已知分区（dev模式）；生产默认拒绝 |
| DYNAMIC_VERIFICATION_REQUIRED | NO（当前否定结论）；替代方案另需0B |
| VERIFICATION_STATUS | STATIC_CONFIRMED |
| VERDICT | BLOCKED |
| EVIDENCE | packages/@openmaic/storage/src/server/index.ts:408；lib/persistence/server-auth.ts:1；lib/persistence/bootstrap.ts:40；packages/@openmaic/storage/src/server/index.ts:241 |

### EP-093 — DELETE /api/persistence/runtime/sessions/{sessionId}

| Field | Evidence / finding |
|---|---|
| SURFACE | S10 Embedded HTTP Runtime |
| ENTRY POINT | /api/persistence/runtime/sessions/{sessionId} |
| SOURCE LOCATION | packages/@openmaic/storage/src/server/index.ts:408 |
| INVOCATION | catch-all → storage runtime handler |
| HTTP METHOD | DELETE |
| RESOURCE IDENTIFIER | sessionId / stageId / learnerKey / record |
| CURRENT AUTH | development bearer；production默认拒绝；不得opt-in用于V2 |
| CURRENT PRINCIPAL | 客户端 learnerKey + 开发 bearer；不是Membership |
| AUTHORIZATION DECISION | package验证principal.learnerKey/session归属，但embedded principal来自客户端header；未验证课程Enrollment。 内嵌Runtime信任通过开发token验证后传入的x-learner-key；生产默认拒绝，insecure opt-in才能开启此路径。禁止用该模式承载V2生产学习证据。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | 当前embedded模式NO；独立package可信宿主为待评审替代 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | RuntimeStore HTTP和authenticate注入 PUBLIC_STABLE，但当前应用接线不是可信身份 |
| INTERNAL DEPENDENCY | lib/persistence/server-auth.ts:1；lib/persistence/bootstrap.ts:40；packages/@openmaic/storage/src/server/index.ts:241；分类见I01–I08 |
| CORE CHANGE REQUIRED | YES（保留当前原生接线时；C/D禁止本地修改；须上游扩展或替代路径评审） |
| POTENTIAL BYPASS | 伪造learner header取得任意已知分区（dev模式）；生产默认拒绝 |
| DYNAMIC_VERIFICATION_REQUIRED | NO（当前否定结论）；替代方案另需0B |
| VERIFICATION_STATUS | STATIC_CONFIRMED |
| VERDICT | BLOCKED |
| EVIDENCE | packages/@openmaic/storage/src/server/index.ts:408；lib/persistence/server-auth.ts:1；lib/persistence/bootstrap.ts:40；packages/@openmaic/storage/src/server/index.ts:241 |

### EP-094 — GET /api/persistence/runtime/stages/{stageId}/learners/{learnerKey}/sessions

| Field | Evidence / finding |
|---|---|
| SURFACE | S10 Embedded HTTP Runtime |
| ENTRY POINT | /api/persistence/runtime/stages/{stageId}/learners/{learnerKey}/sessions |
| SOURCE LOCATION | packages/@openmaic/storage/src/server/index.ts:408 |
| INVOCATION | catch-all → storage runtime handler |
| HTTP METHOD | GET |
| RESOURCE IDENTIFIER | sessionId / stageId / learnerKey / record |
| CURRENT AUTH | development bearer；production默认拒绝；不得opt-in用于V2 |
| CURRENT PRINCIPAL | 客户端 learnerKey + 开发 bearer；不是Membership |
| AUTHORIZATION DECISION | package验证principal.learnerKey/session归属，但embedded principal来自客户端header；未验证课程Enrollment。 内嵌Runtime信任通过开发token验证后传入的x-learner-key；生产默认拒绝，insecure opt-in才能开启此路径。禁止用该模式承载V2生产学习证据。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | 当前embedded模式NO；独立package可信宿主为待评审替代 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | RuntimeStore HTTP和authenticate注入 PUBLIC_STABLE，但当前应用接线不是可信身份 |
| INTERNAL DEPENDENCY | lib/persistence/server-auth.ts:1；lib/persistence/bootstrap.ts:40；packages/@openmaic/storage/src/server/index.ts:241；分类见I01–I08 |
| CORE CHANGE REQUIRED | YES（保留当前原生接线时；C/D禁止本地修改；须上游扩展或替代路径评审） |
| POTENTIAL BYPASS | 伪造learner header取得任意已知分区（dev模式）；生产默认拒绝 |
| DYNAMIC_VERIFICATION_REQUIRED | NO（当前否定结论）；替代方案另需0B |
| VERIFICATION_STATUS | STATIC_CONFIRMED |
| VERDICT | BLOCKED |
| EVIDENCE | packages/@openmaic/storage/src/server/index.ts:408；lib/persistence/server-auth.ts:1；lib/persistence/bootstrap.ts:40；packages/@openmaic/storage/src/server/index.ts:241 |

### EP-095 — POST /api/persistence/runtime/sessions/{sessionId}/records

| Field | Evidence / finding |
|---|---|
| SURFACE | S10 Embedded HTTP Runtime |
| ENTRY POINT | /api/persistence/runtime/sessions/{sessionId}/records |
| SOURCE LOCATION | packages/@openmaic/storage/src/server/index.ts:408 |
| INVOCATION | catch-all → storage runtime handler |
| HTTP METHOD | POST |
| RESOURCE IDENTIFIER | sessionId / stageId / learnerKey / record |
| CURRENT AUTH | development bearer；production默认拒绝；不得opt-in用于V2 |
| CURRENT PRINCIPAL | 客户端 learnerKey + 开发 bearer；不是Membership |
| AUTHORIZATION DECISION | package验证principal.learnerKey/session归属，但embedded principal来自客户端header；未验证课程Enrollment。 内嵌Runtime信任通过开发token验证后传入的x-learner-key；生产默认拒绝，insecure opt-in才能开启此路径。禁止用该模式承载V2生产学习证据。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | 当前embedded模式NO；独立package可信宿主为待评审替代 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | RuntimeStore HTTP和authenticate注入 PUBLIC_STABLE，但当前应用接线不是可信身份 |
| INTERNAL DEPENDENCY | lib/persistence/server-auth.ts:1；lib/persistence/bootstrap.ts:40；packages/@openmaic/storage/src/server/index.ts:241；分类见I01–I08 |
| CORE CHANGE REQUIRED | YES（保留当前原生接线时；C/D禁止本地修改；须上游扩展或替代路径评审） |
| POTENTIAL BYPASS | 伪造learner header取得任意已知分区（dev模式）；生产默认拒绝 |
| DYNAMIC_VERIFICATION_REQUIRED | NO（当前否定结论）；替代方案另需0B |
| VERIFICATION_STATUS | STATIC_CONFIRMED |
| VERDICT | BLOCKED |
| EVIDENCE | packages/@openmaic/storage/src/server/index.ts:408；lib/persistence/server-auth.ts:1；lib/persistence/bootstrap.ts:40；packages/@openmaic/storage/src/server/index.ts:241 |

### EP-096 — GET /api/persistence/runtime/sessions/{sessionId}/records

| Field | Evidence / finding |
|---|---|
| SURFACE | S10 Embedded HTTP Runtime |
| ENTRY POINT | /api/persistence/runtime/sessions/{sessionId}/records |
| SOURCE LOCATION | packages/@openmaic/storage/src/server/index.ts:408 |
| INVOCATION | catch-all → storage runtime handler |
| HTTP METHOD | GET |
| RESOURCE IDENTIFIER | sessionId / stageId / learnerKey / record |
| CURRENT AUTH | development bearer；production默认拒绝；不得opt-in用于V2 |
| CURRENT PRINCIPAL | 客户端 learnerKey + 开发 bearer；不是Membership |
| AUTHORIZATION DECISION | package验证principal.learnerKey/session归属，但embedded principal来自客户端header；未验证课程Enrollment。 内嵌Runtime信任通过开发token验证后传入的x-learner-key；生产默认拒绝，insecure opt-in才能开启此路径。禁止用该模式承载V2生产学习证据。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | 当前embedded模式NO；独立package可信宿主为待评审替代 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | RuntimeStore HTTP和authenticate注入 PUBLIC_STABLE，但当前应用接线不是可信身份 |
| INTERNAL DEPENDENCY | lib/persistence/server-auth.ts:1；lib/persistence/bootstrap.ts:40；packages/@openmaic/storage/src/server/index.ts:241；分类见I01–I08 |
| CORE CHANGE REQUIRED | YES（保留当前原生接线时；C/D禁止本地修改；须上游扩展或替代路径评审） |
| POTENTIAL BYPASS | 伪造learner header取得任意已知分区（dev模式）；生产默认拒绝 |
| DYNAMIC_VERIFICATION_REQUIRED | NO（当前否定结论）；替代方案另需0B |
| VERIFICATION_STATUS | STATIC_CONFIRMED |
| VERDICT | BLOCKED |
| EVIDENCE | packages/@openmaic/storage/src/server/index.ts:408；lib/persistence/server-auth.ts:1；lib/persistence/bootstrap.ts:40；packages/@openmaic/storage/src/server/index.ts:241 |

### EP-097 — POST /api/persistence/runtime/learners/merge

| Field | Evidence / finding |
|---|---|
| SURFACE | S10 Embedded HTTP Runtime |
| ENTRY POINT | /api/persistence/runtime/learners/merge |
| SOURCE LOCATION | packages/@openmaic/storage/src/server/index.ts:408 |
| INVOCATION | catch-all → storage runtime handler |
| HTTP METHOD | POST |
| RESOURCE IDENTIFIER | sessionId / stageId / learnerKey / record |
| CURRENT AUTH | development bearer；production默认拒绝；不得opt-in用于V2 |
| CURRENT PRINCIPAL | 客户端 learnerKey + 开发 bearer；不是Membership |
| AUTHORIZATION DECISION | embedded authorizeMerge=false，拒绝。 内嵌Runtime信任通过开发token验证后传入的x-learner-key；生产默认拒绝，insecure opt-in才能开启此路径。禁止用该模式承载V2生产学习证据。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | 当前embedded模式NO；独立package可信宿主为待评审替代 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | RuntimeStore HTTP和authenticate注入 PUBLIC_STABLE，但当前应用接线不是可信身份 |
| INTERNAL DEPENDENCY | lib/persistence/server-auth.ts:1；lib/persistence/bootstrap.ts:40；packages/@openmaic/storage/src/server/index.ts:241；分类见I01–I08 |
| CORE CHANGE REQUIRED | YES（保留当前原生接线时；C/D禁止本地修改；须上游扩展或替代路径评审） |
| POTENTIAL BYPASS | 伪造learner header取得任意已知分区（dev模式）；生产默认拒绝 |
| DYNAMIC_VERIFICATION_REQUIRED | NO（当前否定结论）；替代方案另需0B |
| VERIFICATION_STATUS | STATIC_CONFIRMED |
| VERDICT | BLOCKED |
| EVIDENCE | packages/@openmaic/storage/src/server/index.ts:408；lib/persistence/server-auth.ts:1；lib/persistence/bootstrap.ts:40；packages/@openmaic/storage/src/server/index.ts:241 |

### EP-098 — DELETE /api/persistence/runtime/stages/{stageId}/learners/{learnerKey}

| Field | Evidence / finding |
|---|---|
| SURFACE | S10 Embedded HTTP Runtime |
| ENTRY POINT | /api/persistence/runtime/stages/{stageId}/learners/{learnerKey} |
| SOURCE LOCATION | packages/@openmaic/storage/src/server/index.ts:408 |
| INVOCATION | catch-all → storage runtime handler |
| HTTP METHOD | DELETE |
| RESOURCE IDENTIFIER | sessionId / stageId / learnerKey / record |
| CURRENT AUTH | development bearer；production默认拒绝；不得opt-in用于V2 |
| CURRENT PRINCIPAL | 客户端 learnerKey + 开发 bearer；不是Membership |
| AUTHORIZATION DECISION | package验证principal.learnerKey/session归属，但embedded principal来自客户端header；未验证课程Enrollment。 内嵌Runtime信任通过开发token验证后传入的x-learner-key；生产默认拒绝，insecure opt-in才能开启此路径。禁止用该模式承载V2生产学习证据。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | 当前embedded模式NO；独立package可信宿主为待评审替代 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | RuntimeStore HTTP和authenticate注入 PUBLIC_STABLE，但当前应用接线不是可信身份 |
| INTERNAL DEPENDENCY | lib/persistence/server-auth.ts:1；lib/persistence/bootstrap.ts:40；packages/@openmaic/storage/src/server/index.ts:241；分类见I01–I08 |
| CORE CHANGE REQUIRED | YES（保留当前原生接线时；C/D禁止本地修改；须上游扩展或替代路径评审） |
| POTENTIAL BYPASS | 伪造learner header取得任意已知分区（dev模式）；生产默认拒绝 |
| DYNAMIC_VERIFICATION_REQUIRED | NO（当前否定结论）；替代方案另需0B |
| VERIFICATION_STATUS | STATIC_CONFIRMED |
| VERDICT | BLOCKED |
| EVIDENCE | packages/@openmaic/storage/src/server/index.ts:408；lib/persistence/server-auth.ts:1；lib/persistence/bootstrap.ts:40；packages/@openmaic/storage/src/server/index.ts:241 |

### EP-099 — DELETE /api/persistence/runtime/stages/{stageId}

| Field | Evidence / finding |
|---|---|
| SURFACE | S10 Embedded HTTP Runtime |
| ENTRY POINT | /api/persistence/runtime/stages/{stageId} |
| SOURCE LOCATION | packages/@openmaic/storage/src/server/index.ts:408 |
| INVOCATION | catch-all → storage runtime handler |
| HTTP METHOD | DELETE |
| RESOURCE IDENTIFIER | sessionId / stageId / learnerKey / record |
| CURRENT AUTH | development bearer；production默认拒绝；不得opt-in用于V2 |
| CURRENT PRINCIPAL | 客户端 learnerKey + 开发 bearer；不是Membership |
| AUTHORIZATION DECISION | embedded authorizeAdmin=false，拒绝。 内嵌Runtime信任通过开发token验证后传入的x-learner-key；生产默认拒绝，insecure opt-in才能开启此路径。禁止用该模式承载V2生产学习证据。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | 当前embedded模式NO；独立package可信宿主为待评审替代 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | RuntimeStore HTTP和authenticate注入 PUBLIC_STABLE，但当前应用接线不是可信身份 |
| INTERNAL DEPENDENCY | lib/persistence/server-auth.ts:1；lib/persistence/bootstrap.ts:40；packages/@openmaic/storage/src/server/index.ts:241；分类见I01–I08 |
| CORE CHANGE REQUIRED | YES（保留当前原生接线时；C/D禁止本地修改；须上游扩展或替代路径评审） |
| POTENTIAL BYPASS | 伪造learner header取得任意已知分区（dev模式）；生产默认拒绝 |
| DYNAMIC_VERIFICATION_REQUIRED | NO（当前否定结论）；替代方案另需0B |
| VERIFICATION_STATUS | STATIC_CONFIRMED |
| VERDICT | BLOCKED |
| EVIDENCE | packages/@openmaic/storage/src/server/index.ts:408；lib/persistence/server-auth.ts:1；lib/persistence/bootstrap.ts:40；packages/@openmaic/storage/src/server/index.ts:241 |

### EP-100 — DELETE /api/persistence/runtime

| Field | Evidence / finding |
|---|---|
| SURFACE | S10 Embedded HTTP Runtime |
| ENTRY POINT | /api/persistence/runtime |
| SOURCE LOCATION | packages/@openmaic/storage/src/server/index.ts:408 |
| INVOCATION | catch-all → storage runtime handler |
| HTTP METHOD | DELETE |
| RESOURCE IDENTIFIER | sessionId / stageId / learnerKey / record |
| CURRENT AUTH | development bearer；production默认拒绝；不得opt-in用于V2 |
| CURRENT PRINCIPAL | 客户端 learnerKey + 开发 bearer；不是Membership |
| AUTHORIZATION DECISION | embedded authorizeAdmin=false，拒绝。 内嵌Runtime信任通过开发token验证后传入的x-learner-key；生产默认拒绝，insecure opt-in才能开启此路径。禁止用该模式承载V2生产学习证据。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | 当前embedded模式NO；独立package可信宿主为待评审替代 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | RuntimeStore HTTP和authenticate注入 PUBLIC_STABLE，但当前应用接线不是可信身份 |
| INTERNAL DEPENDENCY | lib/persistence/server-auth.ts:1；lib/persistence/bootstrap.ts:40；packages/@openmaic/storage/src/server/index.ts:241；分类见I01–I08 |
| CORE CHANGE REQUIRED | YES（保留当前原生接线时；C/D禁止本地修改；须上游扩展或替代路径评审） |
| POTENTIAL BYPASS | 伪造learner header取得任意已知分区（dev模式）；生产默认拒绝 |
| DYNAMIC_VERIFICATION_REQUIRED | NO（当前否定结论）；替代方案另需0B |
| VERIFICATION_STATUS | STATIC_CONFIRMED |
| VERDICT | BLOCKED |
| EVIDENCE | packages/@openmaic/storage/src/server/index.ts:408；lib/persistence/server-auth.ts:1；lib/persistence/bootstrap.ts:40；packages/@openmaic/storage/src/server/index.ts:241 |

### EP-101 — POST /api/persistence/assets

| Field | Evidence / finding |
|---|---|
| SURFACE | S07 Asset |
| ENTRY POINT | /api/persistence/assets |
| SOURCE LOCATION | packages/@openmaic/storage/src/server/asset.ts:575 |
| INVOCATION | catch-all → storage asset handler |
| HTTP METHOD | POST |
| RESOURCE IDENTIFIER | ast_* / content |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；shared asset principal |
| CURRENT PRINCIPAL | shared asset principal |
| AUTHORIZATION DECISION | embedded使用shared key，任意获部署准入者可以allocate/读取；GET可能redirect。 内嵌路由将所有调用者分配到 shared；读/allocate开放给部署允许者，PUT/DELETE一律拒绝。知道id可读同shared分区，非tenant-aware。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | AssetStore + HTTP + server hooks PUBLIC_STABLE；shared接线 INTERNAL |
| INTERNAL DEPENDENCY | app/api/persistence/[...path]/route.ts:160；lib/server/store-generated-asset.ts:131；packages/@openmaic/storage/src/server/asset.ts:575；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | packages/@openmaic/storage/src/server/asset.ts:575；app/api/persistence/[...path]/route.ts:160；lib/server/store-generated-asset.ts:131；packages/@openmaic/storage/src/server/asset.ts:575 |

### EP-102 — GET /api/persistence/assets/{id}/content

| Field | Evidence / finding |
|---|---|
| SURFACE | S07 Asset |
| ENTRY POINT | /api/persistence/assets/{id}/content |
| SOURCE LOCATION | packages/@openmaic/storage/src/server/asset.ts:575 |
| INVOCATION | catch-all → storage asset handler |
| HTTP METHOD | GET |
| RESOURCE IDENTIFIER | ast_* / content |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；shared asset principal |
| CURRENT PRINCIPAL | shared asset principal |
| AUTHORIZATION DECISION | embedded使用shared key，任意获部署准入者可以allocate/读取；GET可能redirect。 内嵌路由将所有调用者分配到 shared；读/allocate开放给部署允许者，PUT/DELETE一律拒绝。知道id可读同shared分区，非tenant-aware。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | AssetStore + HTTP + server hooks PUBLIC_STABLE；shared接线 INTERNAL |
| INTERNAL DEPENDENCY | app/api/persistence/[...path]/route.ts:160；lib/server/store-generated-asset.ts:131；packages/@openmaic/storage/src/server/asset.ts:575；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | packages/@openmaic/storage/src/server/asset.ts:575；app/api/persistence/[...path]/route.ts:160；lib/server/store-generated-asset.ts:131；packages/@openmaic/storage/src/server/asset.ts:575 |

### EP-103 — HEAD /api/persistence/assets/{id}/content

| Field | Evidence / finding |
|---|---|
| SURFACE | S07 Asset |
| ENTRY POINT | /api/persistence/assets/{id}/content |
| SOURCE LOCATION | packages/@openmaic/storage/src/server/asset.ts:575 |
| INVOCATION | catch-all → storage asset handler |
| HTTP METHOD | HEAD |
| RESOURCE IDENTIFIER | ast_* / content |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；shared asset principal |
| CURRENT PRINCIPAL | shared asset principal |
| AUTHORIZATION DECISION | package支持HEAD；Next文件没有显式HEAD，GET的框架隐式HEAD分派需0B确认。 内嵌路由将所有调用者分配到 shared；读/allocate开放给部署允许者，PUT/DELETE一律拒绝。知道id可读同shared分区，非tenant-aware。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | AssetStore + HTTP + server hooks PUBLIC_STABLE；shared接线 INTERNAL |
| INTERNAL DEPENDENCY | app/api/persistence/[...path]/route.ts:160；lib/server/store-generated-asset.ts:131；packages/@openmaic/storage/src/server/asset.ts:575；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | packages/@openmaic/storage/src/server/asset.ts:575；app/api/persistence/[...path]/route.ts:160；lib/server/store-generated-asset.ts:131；packages/@openmaic/storage/src/server/asset.ts:575 |

### EP-104 — PUT /api/persistence/assets/{id}/content

| Field | Evidence / finding |
|---|---|
| SURFACE | S07 Asset |
| ENTRY POINT | /api/persistence/assets/{id}/content |
| SOURCE LOCATION | packages/@openmaic/storage/src/server/asset.ts:575 |
| INVOCATION | catch-all → storage asset handler |
| HTTP METHOD | PUT |
| RESOURCE IDENTIFIER | ast_* / content |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；shared asset principal |
| CURRENT PRINCIPAL | shared asset principal |
| AUTHORIZATION DECISION | embedded authorizeAssets拒绝该方法。 内嵌路由将所有调用者分配到 shared；读/allocate开放给部署允许者，PUT/DELETE一律拒绝。知道id可读同shared分区，非tenant-aware。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | AssetStore + HTTP + server hooks PUBLIC_STABLE；shared接线 INTERNAL |
| INTERNAL DEPENDENCY | app/api/persistence/[...path]/route.ts:160；lib/server/store-generated-asset.ts:131；packages/@openmaic/storage/src/server/asset.ts:575；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | packages/@openmaic/storage/src/server/asset.ts:575；app/api/persistence/[...path]/route.ts:160；lib/server/store-generated-asset.ts:131；packages/@openmaic/storage/src/server/asset.ts:575 |

### EP-105 — DELETE /api/persistence/assets/{id}

| Field | Evidence / finding |
|---|---|
| SURFACE | S07 Asset |
| ENTRY POINT | /api/persistence/assets/{id} |
| SOURCE LOCATION | packages/@openmaic/storage/src/server/asset.ts:575 |
| INVOCATION | catch-all → storage asset handler |
| HTTP METHOD | DELETE |
| RESOURCE IDENTIFIER | ast_* / content |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；shared asset principal |
| CURRENT PRINCIPAL | shared asset principal |
| AUTHORIZATION DECISION | embedded authorizeAssets拒绝该方法。 内嵌路由将所有调用者分配到 shared；读/allocate开放给部署允许者，PUT/DELETE一律拒绝。知道id可读同shared分区，非tenant-aware。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | AssetStore + HTTP + server hooks PUBLIC_STABLE；shared接线 INTERNAL |
| INTERNAL DEPENDENCY | app/api/persistence/[...path]/route.ts:160；lib/server/store-generated-asset.ts:131；packages/@openmaic/storage/src/server/asset.ts:575；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | packages/@openmaic/storage/src/server/asset.ts:575；app/api/persistence/[...path]/route.ts:160；lib/server/store-generated-asset.ts:131；packages/@openmaic/storage/src/server/asset.ts:575 |

### EP-106 — GET /

| Field | Evidence / finding |
|---|---|
| SURFACE | S16 Direct Browser Pages |
| ENTRY POINT | / |
| SOURCE LOCATION | app/page.tsx:1 |
| INVOCATION | page/navigation |
| HTTP METHOD | GET |
| RESOURCE IDENTIFIER | URL / query / classroomId |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；浏览器cookie/本地state，无Zhiban Session |
| CURRENT PRINCIPAL | 浏览器cookie/本地state，无Zhiban Session |
| AUTHORIZATION DECISION | 页面本身没有Zhiban认证/授权；server workspace/new仅feature gate，业务加载在客户端。 6个应用页面；root/layout AccessCodeGuard是客户端交互。workspace/new feature gate不等于认证；classroom/generation-preview/eval客户端模块，不能只隐藏入口。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | Next页面 PUBLIC_BUT_UNVERSIONED |
| INTERNAL DEPENDENCY | app/layout.tsx:55；app/classroom/[id]/page.tsx；app/workspace/page.tsx；middleware.ts；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/page.tsx:1；app/layout.tsx:55；app/classroom/[id]/page.tsx；app/workspace/page.tsx；middleware.ts |

### EP-107 — GET /classroom/[id]

| Field | Evidence / finding |
|---|---|
| SURFACE | S01 Classroom |
| ENTRY POINT | /classroom/[id] |
| SOURCE LOCATION | app/classroom/[id]/page.tsx:1 |
| INVOCATION | page/navigation |
| HTTP METHOD | GET |
| RESOURCE IDENTIFIER | classroomId |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；部署 access code（可选），无逐资源 principal |
| CURRENT PRINCIPAL | 部署 access code（可选），无逐资源 principal |
| AUTHORIZATION DECISION | 页面本身没有Zhiban认证/授权；server workspace/new仅feature gate，业务加载在客户端。 api/classroom GET 按 id 读取文件；POST 生成新 id、验证/清洗 DSL，但没有 User/Tenant/owner 认证。页面是 client component。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 资源读并非由public=true统一约束；publish匿名拒绝，详见S17 |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | 无公开稳定的租户授权契约；HTTP 为 PUBLIC_BUT_UNVERSIONED |
| INTERNAL DEPENDENCY | lib/server/classroom-storage.ts；lib/classroom/load-classroom.ts:166；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/classroom/[id]/page.tsx:1；lib/server/classroom-storage.ts；lib/classroom/load-classroom.ts:166 |

### EP-108 — GET /generation-preview

| Field | Evidence / finding |
|---|---|
| SURFACE | S04 Generation |
| ENTRY POINT | /generation-preview |
| SOURCE LOCATION | app/generation-preview/page.tsx:1 |
| INVOCATION | page/navigation |
| HTTP METHOD | GET |
| RESOURCE IDENTIFIER | stageId（输入语境）/ jobId / provider |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；可选部署 access token；BYOK/服务端 provider凭据不是用户 |
| CURRENT PRINCIPAL | 可选部署 access token；BYOK/服务端 provider凭据不是用户 |
| AUTHORIZATION DECISION | 页面本身没有Zhiban认证/授权；server workspace/new仅feature gate，业务加载在客户端。 经典生成接口验证参数/模型配置，未执行教师/课程权限判断；generation job 按 jobId 查询。API key/模型开关不是教师授权。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | generation package 可复用；route JSON PUBLIC_BUT_UNVERSIONED |
| INTERNAL DEPENDENCY | app/api/generate/scene-content/route.ts:59；app/api/generate-classroom/route.ts；lib/server/classroom-job-runner.ts；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/generation-preview/page.tsx:1；app/api/generate/scene-content/route.ts:59；app/api/generate-classroom/route.ts；lib/server/classroom-job-runner.ts |

### EP-109 — GET /workspace

| Field | Evidence / finding |
|---|---|
| SURFACE | S16 Direct Browser Pages |
| ENTRY POINT | /workspace |
| SOURCE LOCATION | app/workspace/page.tsx:1 |
| INVOCATION | page/navigation |
| HTTP METHOD | GET |
| RESOURCE IDENTIFIER | URL / query / classroomId |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；浏览器cookie/本地state，无Zhiban Session |
| CURRENT PRINCIPAL | 浏览器cookie/本地state，无Zhiban Session |
| AUTHORIZATION DECISION | 页面本身没有Zhiban认证/授权；server workspace/new仅feature gate，业务加载在客户端。 6个应用页面；root/layout AccessCodeGuard是客户端交互。workspace/new feature gate不等于认证；classroom/generation-preview/eval客户端模块，不能只隐藏入口。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | Next页面 PUBLIC_BUT_UNVERSIONED |
| INTERNAL DEPENDENCY | app/layout.tsx:55；app/classroom/[id]/page.tsx；app/workspace/page.tsx；middleware.ts；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/workspace/page.tsx:1；app/layout.tsx:55；app/classroom/[id]/page.tsx；app/workspace/page.tsx；middleware.ts |

### EP-110 — GET /workbench/new

| Field | Evidence / finding |
|---|---|
| SURFACE | S16 Direct Browser Pages |
| ENTRY POINT | /workbench/new |
| SOURCE LOCATION | app/workbench/new/page.tsx:1 |
| INVOCATION | page/navigation |
| HTTP METHOD | GET |
| RESOURCE IDENTIFIER | URL / query / classroomId |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；浏览器cookie/本地state，无Zhiban Session |
| CURRENT PRINCIPAL | 浏览器cookie/本地state，无Zhiban Session |
| AUTHORIZATION DECISION | 页面本身没有Zhiban认证/授权；server workspace/new仅feature gate，业务加载在客户端。 6个应用页面；root/layout AccessCodeGuard是客户端交互。workspace/new feature gate不等于认证；classroom/generation-preview/eval客户端模块，不能只隐藏入口。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | Next页面 PUBLIC_BUT_UNVERSIONED |
| INTERNAL DEPENDENCY | app/layout.tsx:55；app/classroom/[id]/page.tsx；app/workspace/page.tsx；middleware.ts；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/workbench/new/page.tsx:1；app/layout.tsx:55；app/classroom/[id]/page.tsx；app/workspace/page.tsx；middleware.ts |

### EP-111 — GET /eval/whiteboard

| Field | Evidence / finding |
|---|---|
| SURFACE | S16 Direct Browser Pages |
| ENTRY POINT | /eval/whiteboard |
| SOURCE LOCATION | app/eval/whiteboard/page.tsx:1 |
| INVOCATION | page/navigation |
| HTTP METHOD | GET |
| RESOURCE IDENTIFIER | URL / query / classroomId |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；浏览器cookie/本地state，无Zhiban Session |
| CURRENT PRINCIPAL | 浏览器cookie/本地state，无Zhiban Session |
| AUTHORIZATION DECISION | 页面本身没有Zhiban认证/授权；server workspace/new仅feature gate，业务加载在客户端。 6个应用页面；root/layout AccessCodeGuard是客户端交互。workspace/new feature gate不等于认证；classroom/generation-preview/eval客户端模块，不能只隐藏入口。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | Next页面 PUBLIC_BUT_UNVERSIONED |
| INTERNAL DEPENDENCY | app/layout.tsx:55；app/classroom/[id]/page.tsx；app/workspace/page.tsx；middleware.ts；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/eval/whiteboard/page.tsx:1；app/layout.tsx:55；app/classroom/[id]/page.tsx；app/workspace/page.tsx；middleware.ts |

### EP-112 — POST（Next action） deleteWorkspaceSession

| Field | Evidence / finding |
|---|---|
| SURFACE | S15 Server Actions |
| ENTRY POINT | deleteWorkspaceSession |
| SOURCE LOCATION | lib/workbench/workspace-actions.ts:34 |
| INVOCATION | Server Action |
| HTTP METHOD | POST（Next action） |
| RESOURCE IDENTIFIER | sessionId（客户端） |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；服务端读取但客户端可设置的UUID cookie |
| CURRENT PRINCIPAL | 服务端读取但客户端可设置的UUID cookie |
| AUTHORIZATION DECISION | 重新解析匿名cookie，softDeleteSession(sessionId,ownerId)；没有用户/tenant/role/learner参数，但cookie仍非可信登录。 唯一use server模块导出deleteWorkspaceSession；重新读取匿名cookie并owner-scope softDelete，但无access-code/User/Tenant/Permission复核。Next页面POST不走API拒绝分支。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：外围能拒绝入口，但完整安全接线尚无稳定支持 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | Next action transport/framework生成ID不是稳定授权contract；INTERNAL |
| INTERNAL DEPENDENCY | lib/workbench/workspace-actions.ts:34；middleware.ts；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |
| EVIDENCE | lib/workbench/workspace-actions.ts:34；lib/workbench/workspace-actions.ts:34；middleware.ts |

### EP-113 — N/A Stage playback/autonomous render

| Field | Evidence / finding |
|---|---|
| SURFACE | S03 Playback |
| ENTRY POINT | Stage playback/autonomous render |
| SOURCE LOCATION | components/stage.tsx:94 |
| INVOCATION | in-process/browser callback |
| HTTP METHOD | N/A |
| RESOURCE IDENTIFIER | stageId / sceneId / assetId |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；设备 learnerKey + anonymous owner；无 Enrollment |
| CURRENT PRINCIPAL | 设备 learnerKey + anonymous owner；无 Enrollment |
| AUTHORIZATION DECISION | 入口链继承下列surface控制；非独立公开API。 独立审查播放模式：Classroom 加载后 Stage mode=playback；素材和 Runtime 分别走自己的入口。isOwner/readOnly限制编辑，不是播放访问授权。 |
| DIRECT BROWSER ACCESS | 组件/回调由页面触发；后台helper非独立URL |
| PUBLIC / PUBLISHED BEHAVIOR | 资源读并非由public=true统一约束；publish匿名拒绝，详见S17 |
| SERVER-TO-SERVER POSSIBLE | URL GET可代理；其他为进程内调用，不是公开HTTP契约 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | 依赖的原始服务YES；客户端内存本身不是网络边界 |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | renderer export 可消费；完整 playback/store链 INTERNAL |
| INTERNAL DEPENDENCY | components/stage.tsx:94；lib/classroom/load-classroom.ts:166；components/classroom/ClassroomSurface.tsx；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | components/stage.tsx:94；components/stage.tsx:94；lib/classroom/load-classroom.ts:166；components/classroom/ClassroomSurface.tsx |

### EP-114 — N/A Stage edit render

| Field | Evidence / finding |
|---|---|
| SURFACE | S05 Edit / Editor |
| ENTRY POINT | Stage edit render |
| SOURCE LOCATION | components/stage.tsx:94 |
| INVOCATION | in-process/browser callback |
| HTTP METHOD | N/A |
| RESOURCE IDENTIFIER | stageId / sceneId / elementId |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；客户端 owner signal + 服务端 anonymous owner |
| CURRENT PRINCIPAL | 客户端 owner signal + 服务端 anonymous owner |
| AUTHORIZATION DECISION | 入口链继承下列surface控制；非独立公开API。 UI canEditOwnedStage=isOwner&&!readOnly；编辑器依赖内部 Stage store；服务端文档写入另有 owner事务保护，但无稳定的宿主角色注入。 |
| DIRECT BROWSER ACCESS | 组件/回调由页面触发；后台helper非独立URL |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | URL GET可代理；其他为进程内调用，不是公开HTTP契约 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：外围能拒绝入口，但完整安全接线尚无稳定支持 |
| PRIVATE NETWORK REQUIRED | 依赖的原始服务YES；客户端内存本身不是网络边界 |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | editor exports可渲染，不提供整条应用授权链；INTERNAL |
| INTERNAL DEPENDENCY | components/stage.tsx:94；lib/store/stage.ts；lib/server/agent-runtime/course-edit/tools.ts；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |
| EVIDENCE | components/stage.tsx:94；components/stage.tsx:94；lib/store/stage.ts；lib/server/agent-runtime/course-edit/tools.ts |

### EP-115 — N/A browser importPptx(file,{upload})

| Field | Evidence / finding |
|---|---|
| SURFACE | S06 Import / Materials |
| ENTRY POINT | browser importPptx(file,{upload}) |
| SOURCE LOCATION | lib/import/use-import-pptx.ts:85 |
| INVOCATION | in-process/browser callback |
| HTTP METHOD | N/A |
| RESOURCE IDENTIFIER | file / assetId / materialId / sessionId |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；anonymous owner；兼容 assetId 分支 dev principal |
| CURRENT PRINCIPAL | anonymous owner；兼容 assetId 分支 dev principal |
| AUTHORIZATION DECISION | 入口链继承下列surface控制；非独立公开API。 文件导入/提取无教师判定；materials检查session owner，上传owner配额。extract-document 的 assetId 分支另走开发认证。解析器不等于授权入口。 |
| DIRECT BROWSER ACCESS | 组件/回调由页面触发；后台helper非独立URL |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | URL GET可代理；其他为进程内调用，不是公开HTTP契约 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：外围能拒绝入口，但完整安全接线尚无稳定支持 |
| PRIVATE NETWORK REQUIRED | 依赖的原始服务YES；客户端内存本身不是网络边界 |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | importer公开导入API；host owner材料与安全接线 INTERNAL |
| INTERNAL DEPENDENCY | lib/import/use-import-pptx.ts:85；lib/persistence/resolve-server-asset.ts:47；lib/server/agent-runtime/session-materials.ts；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |
| EVIDENCE | lib/import/use-import-pptx.ts:85；lib/import/use-import-pptx.ts:85；lib/persistence/resolve-server-asset.ts:47；lib/server/agent-runtime/session-materials.ts |

### EP-116 — N/A asset pool resolve/put + browser IndexedDB

| Field | Evidence / finding |
|---|---|
| SURFACE | S07 Asset |
| ENTRY POINT | asset pool resolve/put + browser IndexedDB |
| SOURCE LOCATION | lib/media/asset-pool.ts:1 |
| INVOCATION | in-process/browser callback |
| HTTP METHOD | N/A |
| RESOURCE IDENTIFIER | ast_* / content |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；shared asset principal |
| CURRENT PRINCIPAL | shared asset principal |
| AUTHORIZATION DECISION | 入口链继承下列surface控制；非独立公开API。 内嵌路由将所有调用者分配到 shared；读/allocate开放给部署允许者，PUT/DELETE一律拒绝。知道id可读同shared分区，非tenant-aware。 |
| DIRECT BROWSER ACCESS | 组件/回调由页面触发；后台helper非独立URL |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | URL GET可代理；其他为进程内调用，不是公开HTTP契约 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | 依赖的原始服务YES；客户端内存本身不是网络边界 |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | AssetStore + HTTP + server hooks PUBLIC_STABLE；shared接线 INTERNAL |
| INTERNAL DEPENDENCY | app/api/persistence/[...path]/route.ts:160；lib/server/store-generated-asset.ts:131；packages/@openmaic/storage/src/server/asset.ts:575；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | lib/media/asset-pool.ts:1；app/api/persistence/[...path]/route.ts:160；lib/server/store-generated-asset.ts:131；packages/@openmaic/storage/src/server/asset.ts:575 |

### EP-117 — N/A quiz attempt read/write

| Field | Evidence / finding |
|---|---|
| SURFACE | S11 Quiz / PBL / Whiteboard Runtime |
| ENTRY POINT | quiz attempt read/write |
| SOURCE LOCATION | lib/quiz/runtime.ts:373 |
| INVOCATION | in-process/browser callback |
| HTTP METHOD | N/A |
| RESOURCE IDENTIFIER | stageId / sceneId / attempt/session / project |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；浏览器设备learner；AI服务凭据不是学习者证明 |
| CURRENT PRINCIPAL | 浏览器设备learner；AI服务凭据不是学习者证明 |
| AUTHORIZATION DECISION | 入口链继承下列surface控制；非独立公开API。 quiz/PBL客户端按learnerKey记录；PBL接口接收客户端project并返回patch，quiz-grade接收问题/答案/分值。不能当可信成绩；Pi whiteboard持久化仍使用dev auth。 |
| DIRECT BROWSER ACCESS | 组件/回调由页面触发；后台helper非独立URL |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | URL GET可代理；其他为进程内调用，不是公开HTTP契约 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：外围能拒绝入口，但完整安全接线尚无稳定支持 |
| PRIVATE NETWORK REQUIRED | 依赖的原始服务YES；客户端内存本身不是网络边界 |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | 底层RuntimeStore PUBLIC_STABLE；业务runtime载荷/编排 INTERNAL |
| INTERNAL DEPENDENCY | lib/quiz/runtime.ts:373；lib/pbl/v2/runtime/learner-state.ts；app/api/chat/pi/route.ts:186；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |
| EVIDENCE | lib/quiz/runtime.ts:373；lib/quiz/runtime.ts:373；lib/pbl/v2/runtime/learner-state.ts；app/api/chat/pi/route.ts:186 |

### EP-118 — N/A PBL learner hydration

| Field | Evidence / finding |
|---|---|
| SURFACE | S11 Quiz / PBL / Whiteboard Runtime |
| ENTRY POINT | PBL learner hydration |
| SOURCE LOCATION | lib/pbl/v2/runtime/hydration.ts:1 |
| INVOCATION | in-process/browser callback |
| HTTP METHOD | N/A |
| RESOURCE IDENTIFIER | stageId / sceneId / attempt/session / project |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；浏览器设备learner；AI服务凭据不是学习者证明 |
| CURRENT PRINCIPAL | 浏览器设备learner；AI服务凭据不是学习者证明 |
| AUTHORIZATION DECISION | 入口链继承下列surface控制；非独立公开API。 quiz/PBL客户端按learnerKey记录；PBL接口接收客户端project并返回patch，quiz-grade接收问题/答案/分值。不能当可信成绩；Pi whiteboard持久化仍使用dev auth。 |
| DIRECT BROWSER ACCESS | 组件/回调由页面触发；后台helper非独立URL |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | URL GET可代理；其他为进程内调用，不是公开HTTP契约 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：外围能拒绝入口，但完整安全接线尚无稳定支持 |
| PRIVATE NETWORK REQUIRED | 依赖的原始服务YES；客户端内存本身不是网络边界 |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | 底层RuntimeStore PUBLIC_STABLE；业务runtime载荷/编排 INTERNAL |
| INTERNAL DEPENDENCY | lib/quiz/runtime.ts:373；lib/pbl/v2/runtime/learner-state.ts；app/api/chat/pi/route.ts:186；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |
| EVIDENCE | lib/pbl/v2/runtime/hydration.ts:1；lib/quiz/runtime.ts:373；lib/pbl/v2/runtime/learner-state.ts；app/api/chat/pi/route.ts:186 |

### EP-119 — N/A iframe postMessage / srcDoc / external src

| Field | Evidence / finding |
|---|---|
| SURFACE | S12 Interactive Runtime / iframe |
| ENTRY POINT | iframe postMessage / srcDoc / external src |
| SOURCE LOCATION | components/scene-renderers/InteractiveIframeHost.tsx:345 |
| INVOCATION | in-process/browser callback |
| HTTP METHOD | N/A |
| RESOURCE IDENTIFIER | sceneId / documentId / scopeId / iframe Window |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；browser-reported observation identity；不是可信principal |
| CURRENT PRINCIPAL | browser-reported observation identity；不是可信principal |
| AUTHORIZATION DECISION | 入口链继承下列surface控制；非独立公开API。 sandbox无allow-same-origin；宿主校验event.source，observation额外绑定requestId/document/scene/scope/instance。无tenant授权token；同一个恶意iframe可伪造自身观察。storage shim只是内存存储。 |
| DIRECT BROWSER ACCESS | 组件/回调由页面触发；后台helper非独立URL |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | URL GET可代理；其他为进程内调用，不是公开HTTP契约 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：外围能拒绝入口，但完整安全接线尚无稳定支持 |
| PRIVATE NETWORK REQUIRED | 依赖的原始服务YES；客户端内存本身不是网络边界 |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | postMessage/patch/pool INTERNAL，不是生产身份桥接口 |
| INTERNAL DEPENDENCY | components/scene-renderers/InteractiveIframeHost.tsx:345；lib/interactive/observation-bridge.ts:188；lib/utils/iframe.ts:24；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |
| EVIDENCE | components/scene-renderers/InteractiveIframeHost.tsx:345；components/scene-renderers/InteractiveIframeHost.tsx:345；lib/interactive/observation-bridge.ts:188；lib/utils/iframe.ts:24 |

### EP-120 — N/A interactive thumbnail iframe

| Field | Evidence / finding |
|---|---|
| SURFACE | S12 Interactive Runtime / iframe |
| ENTRY POINT | interactive thumbnail iframe |
| SOURCE LOCATION | components/slide-renderer/components/ThumbnailInteractive/index.tsx:82 |
| INVOCATION | in-process/browser callback |
| HTTP METHOD | N/A |
| RESOURCE IDENTIFIER | sceneId / documentId / scopeId / iframe Window |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；browser-reported observation identity；不是可信principal |
| CURRENT PRINCIPAL | browser-reported observation identity；不是可信principal |
| AUTHORIZATION DECISION | 入口链继承下列surface控制；非独立公开API。 sandbox无allow-same-origin；宿主校验event.source，observation额外绑定requestId/document/scene/scope/instance。无tenant授权token；同一个恶意iframe可伪造自身观察。storage shim只是内存存储。 |
| DIRECT BROWSER ACCESS | 组件/回调由页面触发；后台helper非独立URL |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | URL GET可代理；其他为进程内调用，不是公开HTTP契约 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：外围能拒绝入口，但完整安全接线尚无稳定支持 |
| PRIVATE NETWORK REQUIRED | 依赖的原始服务YES；客户端内存本身不是网络边界 |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | postMessage/patch/pool INTERNAL，不是生产身份桥接口 |
| INTERNAL DEPENDENCY | components/scene-renderers/InteractiveIframeHost.tsx:345；lib/interactive/observation-bridge.ts:188；lib/utils/iframe.ts:24；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |
| EVIDENCE | components/slide-renderer/components/ThumbnailInteractive/index.tsx:82；components/scene-renderers/InteractiveIframeHost.tsx:345；lib/interactive/observation-bridge.ts:188；lib/utils/iframe.ts:24 |

### EP-121 — N/A worker run / course tools / detached media tools

| Field | Evidence / finding |
|---|---|
| SURFACE | S13 Agent / Tools |
| ENTRY POINT | worker run / course tools / detached media tools |
| SOURCE LOCATION | lib/server/agent-runtime/runner.ts:1303 |
| INVOCATION | in-process/browser callback |
| HTTP METHOD | N/A |
| RESOURCE IDENTIFIER | agent sessionId / owner / stageId / skillId |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；anonymous owner → durable agent meta.ownerId |
| CURRENT PRINCIPAL | anonymous owner → durable agent meta.ownerId |
| AUTHORIZATION DECISION | 入口链继承下列surface控制；非独立公开API。 session按anonymous owner隔离；authenticatedOwnerId可选参数没有真实调用接线。runner从durable meta.ownerId绑定工具，保护外来owner写入，但不区分Teacher/Student。 |
| DIRECT BROWSER ACCESS | 组件/回调由页面触发；后台helper非独立URL |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | URL GET可代理；其他为进程内调用，不是公开HTTP契约 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：外围能拒绝入口，但完整安全接线尚无稳定支持 |
| PRIVATE NETWORK REQUIRED | 依赖的原始服务YES；客户端内存本身不是网络边界 |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | AgentSessionStore公开存储不等于runner授权；runner/tool policy INTERNAL |
| INTERNAL DEPENDENCY | lib/server/agent-runtime/owner.ts:63；lib/server/agent-runtime/with-owner.ts:17；lib/server/agent-runtime/runner.ts:1303；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |
| EVIDENCE | lib/server/agent-runtime/runner.ts:1303；lib/server/agent-runtime/owner.ts:63；lib/server/agent-runtime/with-owner.ts:17；lib/server/agent-runtime/runner.ts:1303 |

### EP-122 — N/A signed object byte GET

| Field | Evidence / finding |
|---|---|
| SURFACE | S18 Signed / Generated URLs |
| ENTRY POINT | signed object byte GET |
| SOURCE LOCATION | packages/@openmaic/storage/src/asset/s3-bytes.ts:367 |
| INVOCATION | in-process/browser callback |
| HTTP METHOD | N/A |
| RESOURCE IDENTIFIER | signed object URL / generated URL |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；URL bearer；对象存储signer凭据服务端持有 |
| CURRENT PRINCIPAL | URL bearer；对象存储signer凭据服务端持有 |
| AUTHORIZATION DECISION | 入口链继承下列surface控制；非独立公开API。 Asset direct默认；redirect时默认60秒、上限900秒的可转发bearer URL。签发前principal校验不等于对象GET绑定principal；provider URL可能无应用expiry。 |
| DIRECT BROWSER ACCESS | YES，URL到达后可复制 |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | URL GET可代理；其他为进程内调用，不是公开HTTP契约 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | Asset byte egress PUBLIC_STABLE；provider URL UNKNOWN |
| INTERNAL DEPENDENCY | packages/@openmaic/storage/src/server/asset.ts:73；packages/@openmaic/storage/src/asset/s3-bytes.ts:367；lib/server/media-origin.ts:11；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | packages/@openmaic/storage/src/asset/s3-bytes.ts:367；packages/@openmaic/storage/src/server/asset.ts:73；packages/@openmaic/storage/src/asset/s3-bytes.ts:367；lib/server/media-origin.ts:11 |

### EP-123 — N/A provider-generated hosted URL

| Field | Evidence / finding |
|---|---|
| SURFACE | S18 Signed / Generated URLs |
| ENTRY POINT | provider-generated hosted URL |
| SOURCE LOCATION | lib/server/media-origin.ts:11 |
| INVOCATION | in-process/browser callback |
| HTTP METHOD | N/A |
| RESOURCE IDENTIFIER | signed object URL / generated URL |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；URL bearer；对象存储signer凭据服务端持有 |
| CURRENT PRINCIPAL | URL bearer；对象存储signer凭据服务端持有 |
| AUTHORIZATION DECISION | 入口链继承下列surface控制；非独立公开API。 Asset direct默认；redirect时默认60秒、上限900秒的可转发bearer URL。签发前principal校验不等于对象GET绑定principal；provider URL可能无应用expiry。 |
| DIRECT BROWSER ACCESS | YES，URL到达后可复制 |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | URL GET可代理；其他为进程内调用，不是公开HTTP契约 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | Asset byte egress PUBLIC_STABLE；provider URL UNKNOWN |
| INTERNAL DEPENDENCY | packages/@openmaic/storage/src/server/asset.ts:73；packages/@openmaic/storage/src/asset/s3-bytes.ts:367；lib/server/media-origin.ts:11；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | lib/server/media-origin.ts:11；packages/@openmaic/storage/src/server/asset.ts:73；packages/@openmaic/storage/src/asset/s3-bytes.ts:367；lib/server/media-origin.ts:11 |

### EP-124 — N/A after() background generation

| Field | Evidence / finding |
|---|---|
| SURFACE | S19 Internal Server / Components / Fetch |
| ENTRY POINT | after() background generation |
| SOURCE LOCATION | lib/server/classroom-job-runner.ts:1 |
| INVOCATION | in-process/browser callback |
| HTTP METHOD | N/A |
| RESOURCE IDENTIFIER | stage/document/runtime/asset/job |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；job/session捕获的owner 或shared/dev principal |
| CURRENT PRINCIPAL | job/session捕获的owner 或shared/dev principal |
| AUTHORIZATION DECISION | 入口链继承下列surface控制；非独立公开API。 未发现页面server component直接读业务存储；但runner、generation job、server asset/whiteboard/helpers直接读写provider，不经过Next API gateway。internal fetch还代理render/provider。 |
| DIRECT BROWSER ACCESS | 组件/回调由页面触发；后台helper非独立URL |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | URL GET可代理；其他为进程内调用，不是公开HTTP契约 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：外围能拒绝入口，但完整安全接线尚无稳定支持 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | provider/private helper/SQL INTERNAL；不能导入充当业务Repository |
| INTERNAL DEPENDENCY | lib/server/agent-runtime/runner.ts:1303；lib/server/store-generated-asset.ts:112；app/api/chat/pi/route.ts:190；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |
| EVIDENCE | lib/server/classroom-job-runner.ts:1；lib/server/agent-runtime/runner.ts:1303；lib/server/store-generated-asset.ts:112；app/api/chat/pi/route.ts:190 |

### EP-125 — N/A server generated asset put

| Field | Evidence / finding |
|---|---|
| SURFACE | S19 Internal Server / Components / Fetch |
| ENTRY POINT | server generated asset put |
| SOURCE LOCATION | lib/server/store-generated-asset.ts:112 |
| INVOCATION | in-process/browser callback |
| HTTP METHOD | N/A |
| RESOURCE IDENTIFIER | stage/document/runtime/asset/job |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；job/session捕获的owner 或shared/dev principal |
| CURRENT PRINCIPAL | job/session捕获的owner 或shared/dev principal |
| AUTHORIZATION DECISION | 入口链继承下列surface控制；非独立公开API。 未发现页面server component直接读业务存储；但runner、generation job、server asset/whiteboard/helpers直接读写provider，不经过Next API gateway。internal fetch还代理render/provider。 |
| DIRECT BROWSER ACCESS | 组件/回调由页面触发；后台helper非独立URL |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | URL GET可代理；其他为进程内调用，不是公开HTTP契约 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：外围能拒绝入口，但完整安全接线尚无稳定支持 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | provider/private helper/SQL INTERNAL；不能导入充当业务Repository |
| INTERNAL DEPENDENCY | lib/server/agent-runtime/runner.ts:1303；lib/server/store-generated-asset.ts:112；app/api/chat/pi/route.ts:190；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |
| EVIDENCE | lib/server/store-generated-asset.ts:112；lib/server/agent-runtime/runner.ts:1303；lib/server/store-generated-asset.ts:112；app/api/chat/pi/route.ts:190 |

### EP-126 — N/A internal POST render /preview

| Field | Evidence / finding |
|---|---|
| SURFACE | S19 Internal Server / Components / Fetch |
| ENTRY POINT | internal POST render /preview |
| SOURCE LOCATION | lib/server/agent-runtime/scene-preview.ts:66 |
| INVOCATION | in-process/browser callback |
| HTTP METHOD | N/A |
| RESOURCE IDENTIFIER | stage/document/runtime/asset/job |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；job/session捕获的owner 或shared/dev principal |
| CURRENT PRINCIPAL | job/session捕获的owner 或shared/dev principal |
| AUTHORIZATION DECISION | 入口链继承下列surface控制；非独立公开API。 未发现页面server component直接读业务存储；但runner、generation job、server asset/whiteboard/helpers直接读写provider，不经过Next API gateway。internal fetch还代理render/provider。 |
| DIRECT BROWSER ACCESS | 组件/回调由页面触发；后台helper非独立URL |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | URL GET可代理；其他为进程内调用，不是公开HTTP契约 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：外围能拒绝入口，但完整安全接线尚无稳定支持 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | provider/private helper/SQL INTERNAL；不能导入充当业务Repository |
| INTERNAL DEPENDENCY | lib/server/agent-runtime/runner.ts:1303；lib/server/store-generated-asset.ts:112；app/api/chat/pi/route.ts:190；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |
| EVIDENCE | lib/server/agent-runtime/scene-preview.ts:66；lib/server/agent-runtime/runner.ts:1303；lib/server/store-generated-asset.ts:112；app/api/chat/pi/route.ts:190 |

### EP-127 — N/A RootLayout / AccessCodeGuard

| Field | Evidence / finding |
|---|---|
| SURFACE | S16 Direct Browser Pages |
| ENTRY POINT | RootLayout / AccessCodeGuard |
| SOURCE LOCATION | app/layout.tsx:55 |
| INVOCATION | in-process/browser callback |
| HTTP METHOD | N/A |
| RESOURCE IDENTIFIER | URL / query / classroomId |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；浏览器cookie/本地state，无Zhiban Session |
| CURRENT PRINCIPAL | 浏览器cookie/本地state，无Zhiban Session |
| AUTHORIZATION DECISION | 入口链继承下列surface控制；非独立公开API。 6个应用页面；root/layout AccessCodeGuard是客户端交互。workspace/new feature gate不等于认证；classroom/generation-preview/eval客户端模块，不能只隐藏入口。 |
| DIRECT BROWSER ACCESS | 组件/回调由页面触发；后台helper非独立URL |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | URL GET可代理；其他为进程内调用，不是公开HTTP契约 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | 依赖的原始服务YES；客户端内存本身不是网络边界 |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | Next页面 PUBLIC_BUT_UNVERSIONED |
| INTERNAL DEPENDENCY | app/layout.tsx:55；app/classroom/[id]/page.tsx；app/workspace/page.tsx；middleware.ts；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | app/layout.tsx:55；app/layout.tsx:55；app/classroom/[id]/page.tsx；app/workspace/page.tsx；middleware.ts |

### EP-128 — GET render-service /health

| Field | Evidence / finding |
|---|---|
| SURFACE | S09 Download / Render |
| ENTRY POINT | render-service /health |
| SOURCE LOCATION | render-service/src/main.ts:253 |
| INVOCATION | internal service HTTP |
| HTTP METHOD | GET |
| RESOURCE IDENTIFIER | jobId / skillId / export blob |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；clientIdentity 或 session owner（skill私有分支） |
| CURRENT PRINCIPAL | clientIdentity 或 session owner（skill私有分支） |
| AUTHORIZATION DECISION | 服务无Zhiban身份；submit/preview信任x-openmaic-client作额度标识，job读/取消/下载按id。 Next代理render服务；job状态/取消/下载仅使用jobId，无逐job owner校验。render x-openmaic-client用于限制请求，不是Zhiban身份。下载可能透传对象存储302。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | HTTP PUBLIC_BUT_UNVERSIONED；内部render/proxy |
| INTERNAL DEPENDENCY | app/api/export-video/render/[jobId]/download/route.ts:24；render-service/src/main.ts:479；lib/video-export-app/package-zip.ts；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | render-service/src/main.ts:253；app/api/export-video/render/[jobId]/download/route.ts:24；render-service/src/main.ts:479；lib/video-export-app/package-zip.ts |

### EP-129 — POST render-service /render

| Field | Evidence / finding |
|---|---|
| SURFACE | S09 Download / Render |
| ENTRY POINT | render-service /render |
| SOURCE LOCATION | render-service/src/main.ts:264 |
| INVOCATION | internal service HTTP |
| HTTP METHOD | POST |
| RESOURCE IDENTIFIER | jobId / skillId / export blob |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；clientIdentity 或 session owner（skill私有分支） |
| CURRENT PRINCIPAL | clientIdentity 或 session owner（skill私有分支） |
| AUTHORIZATION DECISION | 服务无Zhiban身份；submit/preview信任x-openmaic-client作额度标识，job读/取消/下载按id。 Next代理render服务；job状态/取消/下载仅使用jobId，无逐job owner校验。render x-openmaic-client用于限制请求，不是Zhiban身份。下载可能透传对象存储302。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | HTTP PUBLIC_BUT_UNVERSIONED；内部render/proxy |
| INTERNAL DEPENDENCY | app/api/export-video/render/[jobId]/download/route.ts:24；render-service/src/main.ts:479；lib/video-export-app/package-zip.ts；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | render-service/src/main.ts:264；app/api/export-video/render/[jobId]/download/route.ts:24；render-service/src/main.ts:479；lib/video-export-app/package-zip.ts |

### EP-130 — POST render-service /preview

| Field | Evidence / finding |
|---|---|
| SURFACE | S09 Download / Render |
| ENTRY POINT | render-service /preview |
| SOURCE LOCATION | render-service/src/main.ts:377 |
| INVOCATION | internal service HTTP |
| HTTP METHOD | POST |
| RESOURCE IDENTIFIER | jobId / skillId / export blob |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；clientIdentity 或 session owner（skill私有分支） |
| CURRENT PRINCIPAL | clientIdentity 或 session owner（skill私有分支） |
| AUTHORIZATION DECISION | 服务无Zhiban身份；submit/preview信任x-openmaic-client作额度标识，job读/取消/下载按id。 Next代理render服务；job状态/取消/下载仅使用jobId，无逐job owner校验。render x-openmaic-client用于限制请求，不是Zhiban身份。下载可能透传对象存储302。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | HTTP PUBLIC_BUT_UNVERSIONED；内部render/proxy |
| INTERNAL DEPENDENCY | app/api/export-video/render/[jobId]/download/route.ts:24；render-service/src/main.ts:479；lib/video-export-app/package-zip.ts；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | render-service/src/main.ts:377；app/api/export-video/render/[jobId]/download/route.ts:24；render-service/src/main.ts:479；lib/video-export-app/package-zip.ts |

### EP-131 — GET render-service /render/:jobId

| Field | Evidence / finding |
|---|---|
| SURFACE | S09 Download / Render |
| ENTRY POINT | render-service /render/:jobId |
| SOURCE LOCATION | render-service/src/main.ts:479 |
| INVOCATION | internal service HTTP |
| HTTP METHOD | GET |
| RESOURCE IDENTIFIER | jobId / skillId / export blob |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；clientIdentity 或 session owner（skill私有分支） |
| CURRENT PRINCIPAL | clientIdentity 或 session owner（skill私有分支） |
| AUTHORIZATION DECISION | 服务无Zhiban身份；submit/preview信任x-openmaic-client作额度标识，job读/取消/下载按id。 Next代理render服务；job状态/取消/下载仅使用jobId，无逐job owner校验。render x-openmaic-client用于限制请求，不是Zhiban身份。下载可能透传对象存储302。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | HTTP PUBLIC_BUT_UNVERSIONED；内部render/proxy |
| INTERNAL DEPENDENCY | app/api/export-video/render/[jobId]/download/route.ts:24；render-service/src/main.ts:479；lib/video-export-app/package-zip.ts；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | render-service/src/main.ts:479；app/api/export-video/render/[jobId]/download/route.ts:24；render-service/src/main.ts:479；lib/video-export-app/package-zip.ts |

### EP-132 — DELETE render-service /render/:jobId

| Field | Evidence / finding |
|---|---|
| SURFACE | S09 Download / Render |
| ENTRY POINT | render-service /render/:jobId |
| SOURCE LOCATION | render-service/src/main.ts:495 |
| INVOCATION | internal service HTTP |
| HTTP METHOD | DELETE |
| RESOURCE IDENTIFIER | jobId / skillId / export blob |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；clientIdentity 或 session owner（skill私有分支） |
| CURRENT PRINCIPAL | clientIdentity 或 session owner（skill私有分支） |
| AUTHORIZATION DECISION | 服务无Zhiban身份；submit/preview信任x-openmaic-client作额度标识，job读/取消/下载按id。 Next代理render服务；job状态/取消/下载仅使用jobId，无逐job owner校验。render x-openmaic-client用于限制请求，不是Zhiban身份。下载可能透传对象存储302。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | HTTP PUBLIC_BUT_UNVERSIONED；内部render/proxy |
| INTERNAL DEPENDENCY | app/api/export-video/render/[jobId]/download/route.ts:24；render-service/src/main.ts:479；lib/video-export-app/package-zip.ts；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | render-service/src/main.ts:495；app/api/export-video/render/[jobId]/download/route.ts:24；render-service/src/main.ts:479；lib/video-export-app/package-zip.ts |

### EP-133 — GET render-service /render/:jobId/download

| Field | Evidence / finding |
|---|---|
| SURFACE | S09 Download / Render |
| ENTRY POINT | render-service /render/:jobId/download |
| SOURCE LOCATION | render-service/src/main.ts:501 |
| INVOCATION | internal service HTTP |
| HTTP METHOD | GET |
| RESOURCE IDENTIFIER | jobId / skillId / export blob |
| CURRENT AUTH | middleware可选ACCESS_CODE部署门（非HTTP内部调用不经过）；clientIdentity 或 session owner（skill私有分支） |
| CURRENT PRINCIPAL | clientIdentity 或 session owner（skill私有分支） |
| AUTHORIZATION DECISION | 服务无Zhiban身份；submit/preview信任x-openmaic-client作额度标识，job读/取消/下载按id。 Next代理render服务；job状态/取消/下载仅使用jobId，无逐job owner校验。render x-openmaic-client用于限制请求，不是Zhiban身份。下载可能透传对象存储302。 |
| DIRECT BROWSER ACCESS | YES（服务监听、feature与配置满足时；真实网络未探测） |
| PUBLIC / PUBLISHED BEHAVIOR | 不增加Tenant policy；共享/URL/public缓存行为见AUTHORIZATION DECISION |
| SERVER-TO-SERVER POSSIBLE | YES，协议层可调用，不代表可信身份已接线 |
| ZHIBAN GATEWAY POSSIBLE | CONDITIONAL：逐请求policy + 全部原始入口私网 + response/URL治理 |
| PRIVATE NETWORK REQUIRED | YES（候选设计；未部署） |
| MAPPING REQUIRED | YES：Zhiban-owned + deploymentRef + opaque ids；不可只用ID证明权限 |
| SUPPORTED PUBLIC CONTRACT | HTTP PUBLIC_BUT_UNVERSIONED；内部render/proxy |
| INTERNAL DEPENDENCY | app/api/export-video/render/[jobId]/download/route.ts:24；render-service/src/main.ts:479；lib/video-export-app/package-zip.ts；分类见I01–I08 |
| CORE CHANGE REQUIRED | NO（未证明必须改core；不等于当前Bridge可实施） |
| POTENTIAL BYPASS | 原始route/URL或内部job不经过未来Zhiban policy；具体限制见本条决策和威胁矩阵 |
| DYNAMIC_VERIFICATION_REQUIRED | YES |
| VERIFICATION_STATUS | REQUIRES_ISOLATED_DIAGNOSTIC |
| VERDICT | NETWORK_ISOLATION_REQUIRED |
| EVIDENCE | render-service/src/main.ts:501；app/api/export-video/render/[jobId]/download/route.ts:24；render-service/src/main.ts:479；lib/video-export-app/package-zip.ts |
