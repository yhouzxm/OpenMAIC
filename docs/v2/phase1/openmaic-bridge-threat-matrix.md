# OpenMAIC Bridge Threat Matrix — 1B-0A

23项威胁，静态发现不是已成功利用的渗透报告。SOURCE固定于OpenMAIC 4d2e2bab82374ed45b95964a1f2ed03362666e1c；冻结文档HEAD 700a7673becf0518bc6f8b2861229ee985c5d063。
STATIC CONTROL中“未来/候选”不代表已经存在。DYNAMIC TEST NEEDED只是待另行授权的1B-0B需求，本次未执行。
优先级P0：T01–T11、T13–T18、T21–T23涉及数据/写入/身份/撤销边界；T12同为敏感学习证据P0；T19–T20为映射一致性P1，出现跨Tenant则升级P0。

## T01 跨Tenant Stage read

| Field | Finding |
|---|---|
| THREAT | T01 跨Tenant Stage read |
| SURFACE | S01/S02/S03 |
| CURRENT BEHAVIOR | 未deleted文档capability-by-id，classroom文件按id读取 |
| EXPECTED ZHIBAN BEHAVIOR | Enrollment/scope+Tenant双重限制 |
| STATIC CONTROL | 原始端点隔离；网关mapping+实时policy；现有源码仅tombstone |
| DYNAMIC TEST NEEDED | YES：双租户读API/播放/fallback/缓存 |
| EVIDENCE | lib/persistence/owner-bound-document-store.ts:255；tests/persistence/stage-access-fidelity.test.ts:101 |
| VERDICT | NETWORK_ISOLATION_REQUIRED |

## T02 跨Tenant Stage write

| Field | Finding |
|---|---|
| THREAT | T02 跨Tenant Stage write |
| SURFACE | S02/S05 |
| CURRENT BEHAVIOR | foreign owner写事务拒绝，但同/伪造cookie不等于Tenant合法 |
| EXPECTED ZHIBAN BEHAVIOR | ownerMembership、教师permission、resource tenant都检查 |
| STATIC CONTROL | 现有owner+锁是第二道防线；不传客户端owner |
| DYNAMIC TEST NEEDED | YES：PUT/PATCH/scene/delete并发，错tenant正确owner |
| EVIDENCE | lib/persistence/owner-bound-document-store.ts:246 |
| VERDICT | NETWORK_ISOLATION_REQUIRED |

## T03 猜document id

| Field | Finding |
|---|---|
| THREAT | T03 猜document id |
| SURFACE | S02 |
| CURRENT BEHAVIOR | GET stage/scene/manifest允许capability read；meta返回状态 |
| EXPECTED ZHIBAN BEHAVIOR | id不是capability；没有mapping/授权默认deny |
| STATIC CONTROL | 统一前门，禁原始端点 |
| DYNAMIC TEST NEEDED | YES：已知/未知id、meta存在性差异 |
| EVIDENCE | lib/persistence/document-access.ts:68；app/api/stage-meta/[stageId]/route.ts |
| VERDICT | NETWORK_ISOLATION_REQUIRED |

## T04 猜asset id

| Field | Finding |
|---|---|
| THREAT | T04 猜asset id |
| SURFACE | S07 |
| CURRENT BEHAVIOR | shared分区可读；package会校验key但所有访客同key |
| EXPECTED ZHIBAN BEHAVIOR | 逐asset活动/tenant映射，不凭id读 |
| STATIC CONTROL | 共享backend只能在私网，由gateway逐id判定 |
| DYNAMIC TEST NEEDED | YES：shared跨document/cross tenant读、HEAD |
| EVIDENCE | app/api/persistence/[...path]/route.ts:160 |
| VERDICT | NETWORK_ISOLATION_REQUIRED |

## T05 复制asset URL

| Field | Finding |
|---|---|
| THREAT | T05 复制asset URL |
| SURFACE | S07/S08 |
| CURRENT BEHAVIOR | registry及legacy媒体原始URL可复制；legacy响应public immutable |
| EXPECTED ZHIBAN BEHAVIOR | 未授权新GET必须deny，已下载bytes不承诺撤回 |
| STATIC CONTROL | 禁原始bytes；private响应/cache治理 |
| DYNAMIC TEST NEEDED | YES：浏览器profile、Range、cache、Stage删除后 |
| EVIDENCE | app/api/classroom-media/[classroomId]/[...path]/route.ts:24 |
| VERDICT | NETWORK_ISOLATION_REQUIRED |

## T06 signed URL转发

| Field | Finding |
|---|---|
| THREAT | T06 signed URL转发 |
| SURFACE | S18 |
| CURRENT BEHAVIOR | 签发前授权；签出后bearer有效到expiry |
| EXPECTED ZHIBAN BEHAVIOR | 私有内容不泄漏可转发直链；或明确风险审批 |
| STATIC CONTROL | direct egress/gateway bytes候选；不透传Location |
| DYNAMIC TEST NEEDED | YES：转发、过期、撤权、对象endpoint |
| EVIDENCE | packages/@openmaic/storage/src/server/asset.ts:73,638 |
| VERDICT | NETWORK_ISOLATION_REQUIRED |

## T07 伪造anonymous owner

| Field | Finding |
|---|---|
| THREAT | T07 伪造anonymous owner |
| SURFACE | S13 |
| CURRENT BEHAVIOR | 接受任意格式合法UUID；知道victim值可重放；未知随机UUID不等于可猜中 |
| EXPECTED ZHIBAN BEHAVIOR | 可信session派生opaque owner，browser不指定 |
| STATIC CONTROL | 当前缺正式authOwner wiring；不patch helper |
| DYNAMIC TEST NEEDED | YES：私网cookie剥离/重建、session归属 |
| EVIDENCE | lib/server/agent-runtime/owner.ts:63 |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |

## T08 伪造learnerKey

| Field | Finding |
|---|---|
| THREAT | T08 伪造learnerKey |
| SURFACE | S10 |
| CURRENT BEHAVIOR | dev bearer通过后header变principal；生产默认拒绝 |
| EXPECTED ZHIBAN BEHAVIOR | server由Session/Membership/Attempt派生 |
| STATIC CONTROL | 保持生产deny；不得insecure opt-in |
| DYNAMIC TEST NEEDED | NO：现有模式BLOCKED已静态确定；替代宿主须另验 |
| EVIDENCE | lib/persistence/server-auth.ts:87；tests/persistence/server-auth.test.ts |
| VERDICT | BLOCKED |

## T09 跨learner Runtime

| Field | Finding |
|---|---|
| THREAT | T09 跨learner Runtime |
| SURFACE | S10/S11 |
| CURRENT BEHAVIOR | package比较session与principal；但dev principal可由客户端指定 |
| EXPECTED ZHIBAN BEHAVIOR | 每次read/write绑定learner+stage+Attempt+scope |
| STATIC CONTROL | 不能把分区比较误称认证；独立可信handler候选 |
| DYNAMIC TEST NEEDED | YES：替代路径read/write/list/delete/merge；当前不执行 |
| EVIDENCE | packages/@openmaic/storage/src/server/index.ts:241；lib/persistence/bootstrap.ts:40 |
| VERDICT | BLOCKED |

## T10 student调用editor/generation

| Field | Finding |
|---|---|
| THREAT | T10 student调用editor/generation |
| SURFACE | S04/S05 |
| CURRENT BEHAVIOR | 页面owner门不能阻止classic generate API；任何匿名owner可开自己的author session |
| EXPECTED ZHIBAN BEHAVIOR | 按业务动作授权，学生默认不得author |
| STATIC CONTROL | 网关方法/route/use-case allowlist，不只UI隐藏 |
| DYNAMIC TEST NEEDED | YES：直接POST、job poll、编辑save |
| EVIDENCE | components/stage.tsx:94；app/api/generate/scene-content/route.ts:59 |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |

## T11 agent tool privilege escalation

| Field | Finding |
|---|---|
| THREAT | T11 agent tool privilege escalation |
| SURFACE | S13 |
| CURRENT BEHAVIOR | tools用durable owner和stage probe；无Zhiban角色/Scope输入 |
| EXPECTED ZHIBAN BEHAVIOR | 每个tool使用授权scope/版本，学生不能拿教师owner |
| STATIC CONTROL | 入口限制仅第一层；稳定tool policy接口尚缺 |
| DYNAMIC TEST NEEDED | YES：prompt注入/skill切换/foreign stage/后台tools |
| EVIDENCE | lib/server/agent-runtime/runner.ts:1303,1353,1430 |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |

## T12 Tenant Admin读学习证据

| Field | Finding |
|---|---|
| THREAT | T12 Tenant Admin读学习证据 |
| SURFACE | S10/S11 |
| CURRENT BEHAVIOR | OpenMAIC无Tenant Admin语义；不能由管理角色推导learner access |
| EXPECTED ZHIBAN BEHAVIOR | 遵守冻结SELF/CLASS/COURSE scope；管理不自动读学习证据 |
| STATIC CONTROL | 未来policy deny-by-default；不能用admin/merge hook绕过 |
| DYNAMIC TEST NEEDED | YES：Admin无教学scope、错误course/learner |
| EVIDENCE | docs/v2/phase1/auth-boundary.md；packages/@openmaic/storage/src/server/index.ts:660 |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |

## T13 role revoke后的stream

| Field | Finding |
|---|---|
| THREAT | T13 role revoke后的stream |
| SURFACE | S14 |
| CURRENT BEHAVIOR | 只建立时owner绑定，无Zhiban role version复核 |
| EXPECTED ZHIBAN BEHAVIOR | 及时停止新帧和权限相关任务；定义撤权时限 |
| STATIC CONTROL | 网关终止转发候选；worker cancel需证明 |
| DYNAMIC TEST NEEDED | YES：长流/reconnect/已经派发工具/背景媒体 |
| EVIDENCE | app/api/agent/sessions/[id]/events/route.ts:77；lib/server/agent-runtime/runner.ts:1317 |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |

## T14 Tenant disable后的stream

| Field | Finding |
|---|---|
| THREAT | T14 Tenant disable后的stream |
| SURFACE | S14 |
| CURRENT BEHAVIOR | 没有Tenant状态概念 |
| EXPECTED ZHIBAN BEHAVIOR | 全Tenant新访问deny，旧连接/任务按撤销门处理 |
| STATIC CONTROL | 不能把abort连接等同取消后台写 |
| DYNAMIC TEST NEEDED | YES：多stream、多worker、断连后继续运行 |
| EVIDENCE | app/api/agent/owner-events/route.ts:49；lib/server/agent-runtime/runner.ts |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |

## T15 iframe postMessage spoofing

| Field | Finding |
|---|---|
| THREAT | T15 iframe postMessage spoofing |
| SURFACE | S12 |
| CURRENT BEHAVIOR | source校验阻止其他Window；request/document/scene/scope/instance关联；当前恶意iframe仍能自报 |
| EXPECTED ZHIBAN BEHAVIOR | 不把browser observation当授权或最终评估 |
| STATIC CONTROL | 保留sandbox/source checks；无allow-same-origin；不下发身份secret |
| DYNAMIC TEST NEEDED | YES：sibling window、navigation reuse、恶意当前frame、外链请求 |
| EVIDENCE | lib/interactive/observation-bridge.ts:188；components/scene-renderers/InteractiveIframeHost.tsx:345 |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |

## T16 direct route bypass

| Field | Finding |
|---|---|
| THREAT | T16 direct route bypass |
| SURFACE | S15/S16 |
| CURRENT BEHAVIOR | 直接page/API/action无Zhiban gate；页面middleware放行 |
| EXPECTED ZHIBAN BEHAVIOR | 仅业务入口公开且每次重新授权 |
| STATIC CONTROL | deny原始paths+Next action；action id不是授权 |
| DYNAMIC TEST NEEDED | YES：POST action、raw API、备用域名/IP |
| EVIDENCE | middleware.ts；lib/workbench/workspace-actions.ts:34 |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |

## T17 public/published bypass

| Field | Finding |
|---|---|
| THREAT | T17 public/published bypass |
| SURFACE | S17 |
| CURRENT BEHAVIOR | read不看public；publish拒anon且没有接线auth owner |
| EXPECTED ZHIBAN BEHAVIOR | Zhiban published仍可Tenant scoped；不依赖public字段保护 |
| STATIC CONTROL | 保持native publish关闭；上游可信extension/替代发布语义评审 |
| DYNAMIC TEST NEEDED | NO：当前read/publish逻辑可静态确认；候选发布流程另验 |
| EVIDENCE | app/api/stages/[id]/publish/route.ts:26；lib/persistence/document-access.ts:68 |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |

## T18 cache/resource mapping串Tenant

| Field | Finding |
|---|---|
| THREAT | T18 cache/resource mapping串Tenant |
| SURFACE | S03/S07/S11 |
| CURRENT BEHAVIOR | client singleton/缓存key主要ref/stage；runtime learner memo在会话保留 |
| EXPECTED ZHIBAN BEHAVIOR | tenant切换隔离cache，server keys含deployment+tenant+subject+resource |
| STATIC CONTROL | server policy每次复核，客户端缓存不作授权 |
| DYNAMIC TEST NEEDED | YES：logout、同浏览器tenant切换、相同opaque id不同部署 |
| EVIDENCE | lib/media/use-asset-url.ts:27；lib/runtime/config.ts:19 |
| VERDICT | NETWORK_ISOLATION_REQUIRED |

## T19 mapping orphan

| Field | Finding |
|---|---|
| THREAT | T19 mapping orphan |
| SURFACE | S19 |
| CURRENT BEHAVIOR | OpenMAIC原始资源没有Zhiban mapping生命周期 |
| EXPECTED ZHIBAN BEHAVIOR | 缺mapping默认deny，孤儿保留隔离并对账 |
| STATIC CONTROL | Zhiban独立状态机/审计；不自动删除 |
| DYNAMIC TEST NEEDED | YES：创建成功映射失败、删除失败、过期任务返回 |
| EVIDENCE | lib/server/store-generated-asset.ts:95；packages/@openmaic/storage/docs/asset-http-contract.md:357 |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |

## T20 mapping race

| Field | Finding |
|---|---|
| THREAT | T20 mapping race |
| SURFACE | S19 |
| CURRENT BEHAVIOR | 跨系统没有原子提交；asset allocate POST非幂等 |
| EXPECTED ZHIBAN BEHAVIOR | pending/active/version一致性；不让并发租户抢关联 |
| STATIC CONTROL | 唯一部署资源关联、CAS、重试授权复核（设计非schema） |
| DYNAMIC TEST NEEDED | YES：并发create/publish/retry/reconcile |
| EVIDENCE | packages/@openmaic/storage/docs/asset-http-contract.md:357；lib/persistence/owner-bound-document-store.ts:246 |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |

## T21 ownership transfer race

| Field | Finding |
|---|---|
| THREAT | T21 ownership transfer race |
| SURFACE | S19/S17 |
| CURRENT BEHAVIOR | 内部owner事务不等于跨系统ownership transfer协议 |
| EXPECTED ZHIBAN BEHAVIOR | 转移时旧新权限都受版本控制；过期worker不得继续写 |
| STATIC CONTROL | 无稳定transfer contract；不直接SQL改owner |
| DYNAMIC TEST NEEDED | YES：转移与编辑/删除/后台job/revoke并发 |
| EVIDENCE | lib/server/agent-runtime/runner.ts:1317；lib/persistence/owner-bound-document-store.ts:255 |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |

## T22 render/download job id

| Field | Finding |
|---|---|
| THREAT | T22 render/download job id |
| SURFACE | S09 |
| CURRENT BEHAVIOR | 服务job读取/取消/下载不验证owner；header只作quota身份 |
| EXPECTED ZHIBAN BEHAVIOR | job归属逐操作授权；原服务私网 |
| STATIC CONTROL | 映射job并限制download/proxy，拒公开service |
| DYNAMIC TEST NEEDED | YES：foreign job status/delete/download及redirect |
| EVIDENCE | render-service/src/main.ts:479,495,501 |
| VERDICT | NETWORK_ISOLATION_REQUIRED |

## T23 credential/handle leakage

| Field | Finding |
|---|---|
| THREAT | T23 credential/handle leakage |
| SURFACE | S13/S18/S20 |
| CURRENT BEHAVIOR | anonymous cookie、provider URL、public dev token有不同信任级别 |
| EXPECTED ZHIBAN BEHAVIOR | 不把内部句柄/密码/token写日志或回前端 |
| STATIC CONTROL | 私网secret隔离、响应过滤；不认为HttpOnly防所有客户端重放 |
| DYNAMIC TEST NEEDED | YES：headers/Location/error/logs/SSE payload脱敏 |
| EVIDENCE | lib/persistence/bootstrap.ts:40；lib/server/agent-runtime/owner.ts:63 |
| VERDICT | UPSTREAM_EXTENSION_REQUIRED |

## 隔离诊断退出标准（仅计划）

用两个隔离Tenant、多个Membership/roles和人工fixture，不用V1/生产数据；所有正例与拒绝负例都要记录入口、身份、资源、状态/错误、side effects。不得启用insecure dev auth来构造“通过”的生产桥。
每项分离请求拒绝、bytes是否外泄、后台write是否停止；SSE断开和UI隐藏不算授权成功。原始URL/alternate origin仍可达时不能关闭T01/T04/T16。
必须覆盖header伪造、跨owner和跨learner、tenant/member/role撤销、签名URL、缓存/iframe、失败重试/并发/孤儿。只有明确新授权后才能创建测试/fixture或运行诊断。
