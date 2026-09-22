# OpenMAIC Bridge Spike Result — Phase 1B-0A

Status: STATIC AUDIT COMPLETE。
PHASE 1B-0A VERDICT: **BLOCKED_FOR_ARCHITECTURE_REVIEW**（完整生产Bridge需要架构评审，不是否定纯Identity Domain，也不表示本轮审计未完成）。

## 基线与执行范围

CURRENT BRANCH: refactor/zhiban-v2
HEAD SHA: 700a7673becf0518bc6f8b2861229ee985c5d063
OPENMAIC BASE SHA: 4d2e2bab82374ed45b95964a1f2ed03362666e1c
开始WORKTREE: CLEAN。文档之外禁止修改；最终只新增本轮5份docs/v2/phase1报告。
本阶段仅源码、配置、route定义、package contract、现有测试和冻结文档静态阅读；未启动程序/HTTP诊断/DB/部署，未执行1B-0B，未修改/读取V1业务数据。
主报告的133个记录逐条包含授权字段；不把目录扫描命中数当真实入口数。

## 结论清单与计数

SURFACES AUDITED: 20
ENTRY POINTS AUDITED: 133
PUBLIC_STABLE CONTRACTS: 5（DSL；DocumentStore/HTTP；RuntimeStore/HTTP；AssetStore/HTTP/byte-egress；storage/server authentication/authorization hooks）
INTERNAL-ONLY DEPENDENCIES: 8（主报告I01–I08，按家族）
SAFE_ADAPTER: 0 — NONE
NETWORK_ISOLATION_REQUIRED: 10 — S01 Classroom；S02 Stage / Scene / Document；S03 Playback；S04 Generation；S07 Asset；S08 Media / Proxy；S09 Download / Render；S16 Direct Browser Pages；S18 Signed / Generated URLs；S20 Provider / Platform Support
UPSTREAM_EXTENSION_REQUIRED: 9 — S05 Edit / Editor；S06 Import / Materials；S11 Quiz / PBL / Whiteboard Runtime；S12 Interactive Runtime / iframe；S13 Agent / Tools；S14 Agent / Stage Streaming；S15 Server Actions；S17 Public / Published；S19 Internal Server / Components / Fetch
BLOCKED: 1 — S10 Embedded HTTP Runtime
REQUIRES_ISOLATED_DIAGNOSTIC: 18 — S01 Classroom；S02 Stage / Scene / Document；S03 Playback；S04 Generation；S05 Edit / Editor；S06 Import / Materials；S07 Asset；S08 Media / Proxy；S09 Download / Render；S11 Quiz / PBL / Whiteboard Runtime；S12 Interactive Runtime / iframe；S13 Agent / Tools；S14 Agent / Stage Streaming；S15 Server Actions；S16 Direct Browser Pages；S18 Signed / Generated URLs；S19 Internal Server / Components / Fetch；S20 Provider / Platform Support

S10/S17的当前否定结论为STATIC_CONFIRMED；二者的任何替代宿主/接线仍须新评审与诊断，不得利用这个状态跳过0B。23项威胁、18类principal来源另有专表。

## 十个必须回答的问题

1. **Zhiban Gateway能否成为统一授权入口？** 有条件的候选，不是现状事实。必须网络禁止浏览器访问所有原始业务入口；每次请求从可信Zhiban Session推导Tenant/Membership/Scope、检查mapping、构造内部上下文。后台agent/job、SSE撤权和iframe资源仍缺充分证据，所以完整路径不能宣告可实施。
2. **原始routes是否必须对浏览器不可达？** YES，对V2非公开业务资源。只限制Zhiban页面无效；原始Stage、classroom fallback、shared Asset、media、download、Server Action和独立render服务都要覆盖。public静态JS字体不是敏感资源入口。
3. **SAFE_ADAPTER有哪些？** NONE。公开storage接口为适配提供素材，不自动证明现有整条应用链安全。
4. **NETWORK_ISOLATION_REQUIRED有哪些？** S01/S02/S03/S04/S07/S08/S09/S16/S18/S20，共10组。存在可代理协议/公开基础contract，但仍须0B确认隔离、URL/cache/Range等。
5. **UPSTREAM_EXTENSION_REQUIRED有哪些？** S05/S06/S11/S12/S13/S14/S15/S17/S19，共9组。当前完整安全路径依赖内部应用接线，需上游受支持扩展点或人工认可的公开package替代宿主方案；不是要求立刻fork/改core。
6. **BLOCKED有哪些？** S10：现有内嵌HTTP Runtime生产身份路径。不得用PERSISTENCE_ALLOW_INSECURE_DEV_AUTH解除阻塞。package独立可信认证宿主是不同候选，不可冒充现有路径修复。
7. **哪些需1B-0B？** 18组如上；后续如果替换S10/S17还需验证新路径。关键用例见threat matrix：raw route/action旁路、asset复制/签名、跨learner、工具权限、撤权stream/worker、iframe与缓存、mapping并发。没有执行或隐含授权0B。
8. **是否发现C/D修改需求？** YES，限定为“保留当前原生接线并要求可信身份”路径：embedded server-auth/route属D，authenticated owner注入及native publish需要owner/stage-access相关C/D接线。不能在本地修改。并非已证明所有替代设计都必须修改core；公开package host有可能避免，但完整应用集成尚未验证。
9. **private OpenMAIC是否为必要条件？** YES（固定底座、V2受限业务资源的候选架构）。必要但不充分；不能把私网说成认证实现，更不能以私网为理由开启insecure生产runtime。
10. **ADR-012建议？** KEEP_PROPOSED。没有修改ADR-012或ADR-007–011。需要人工选择可信宿主/上游扩展路径及网络边界；这不推翻User/Tenant/Membership模型。

## 分类风险摘要

- CLASSROOM：client page不做服务端业务授权，fallback文件API按id读取。isOwner控制authoring但不是read gate。
- PLAYBACK：不是独立route；Stage playback仍消费共享读取、asset和runtime。知道未删除Stage id可能足够加载；public=false不是租户隔离，公开发布更不能代替Enrollment。
- GENERATION/EDIT：classic generation API未验Teacher，学生可绕过UI调用；owner事务保护外来写，不保护角色权限/AI额度。编辑器内部store不作为业务仓储。
- ASSET/MEDIA：shared registry；复制URL和legacy public缓存；Stage tombstone不是所有媒体撤销；asset GC grace/多文档共享；签名默认60秒、上限900秒仍是bearer。
- RUNTIME IDENTITY：设备learnerKey及client header不是身份，PG的stage/learner索引不是租户授权。生产默认deny是正确保护，禁insecure方案。
- AGENT AUTHORIZATION：owner匿名cookie、auth override未接线；工具stage owner probe存在，不能说没有任何防护，但无Teacher/Student/Membership/Tenant撤权。
- IFRAME：sandbox无same-origin、source+correlation检查有效；不是租户/资源网络边界。当前恶意frame可自报观察，外链src/资源可脱离gateway；不可把postMessage token当身份。
- SERVER ACTION BYPASS: YES（源码中的未来gateway旁路候选）。仅一个deleteWorkspaceSession action；有owner-scope delete，无Zhiban和access-code复核。未动态证明Next action transport可利用，需隔离验证。
- INTERNAL SERVER：页面server component直接读目标业务存储NOT_PRESENT；runner、jobs、server asset、Pi白板等直接访问provider确实存在。公网API gate不自动覆盖这些调用。

## Core边界处理

| 位置 | 冻结类别 | 处理 |
|---|---|---|
| app/api/classroom、stages | A PREFER_ADAPTER | 只围栏/候选代理；不改源码 |
| storage exported contracts、runtime config seam | B EXTENSION_POINT | 候选可信package host；config singleton不是SSR身份注入 |
| components/stage、agent runner | C MODIFY_ONLY_IF_REQUIRED（部分agent A） | 内部角色/生命周期接线缺失，只提上游需求 |
| lib/store、iframe内部、persistence、access-token/stage-access | D DO_NOT_CUSTOMIZE | 禁止本地patch；避免SQL直写owner/tenant |
| renderer/editor | D DO_NOT_CUSTOMIZE（公开API可消费） | 不改内部store、serializer或安全协议 |

CORE CHANGE REQUIRED: YES（当前原生身份接线路径；上游候选需求，不授权修改）。
CATEGORY C/D REQUIRED: YES（同上）。
ZHIBAN MAPPING ALONE SUFFICIENT: NO。
ARCHITECTURE_REVIEW_REQUIRED: YES。

人工评审项：R1可信principal注入/独立package host选择；R2是否放弃原生public publish而使用Zhiban tenant-scoped发布；R3流与后台任务撤权控制及可接受时限；R4全部资源/签名URL/iframe网络出口；R5owner transfer与跨系统生命周期。
这些是Spike新证据，不直接修订冻结设计；没有新增数据库表/Port源码/测试。

## 后续Gate

| Gate | 当前判断 | 边界 |
|---|---|---|
| IDENTITY_DOMAIN_1B1 | ALLOWED | 按本任务明确区分规则：纯Identity Domain contracts未被本审计推翻；仅未来另行授权的小批次，仍遵守已接受ADR-007/008/009，不接OpenMAIC、不含schema/API/session实现 |
| SCHEMA_1B3 | BLOCKED | 冻结implementation-plan第11行要求1B-0完成且必需能力无未解决阻塞，并先1B-1/2；目前必要Bridge能力/0B未闭环，不能越过该Gate |
| OPENMAIC_BRIDGE_1B9 | BLOCKED | 冻结计划要求安全路径证据 + ADR-012明确接受 + 1B-2/7；本次均不能宣称满足 |
| 1B-0B | NOT EXECUTED | 必须单独授权隔离诊断范围/fixture，禁止V1和生产数据/不安全生产认证 |

纯Domain ALLOWED是架构可行性判断，不是本次启动开发；本轮到文档停止。没有改变冻结实施计划的文件。
B/C为preferred candidates，不是ACCEPTED DEPLOYMENT。不能将baseline Linux CI PASS解释为已覆盖本报告新威胁。

## 交付与不变项

仅创建：
- openmaic-authorization-surface-spike.md
- openmaic-principal-map.md
- openmaic-network-boundary.md
- openmaic-bridge-threat-matrix.md
- openmaic-bridge-spike-result.md

SOURCE MODIFIED: NO
TESTS MODIFIED: NO
DATABASE MODIFIED: NO
OPENMAIC CORE MODIFIED: NO
V1 MODIFIED: NO
COMMIT: NO
PUSH: NO
DEPLOYMENT: NO

等待人工审核；本阶段没有git add、commit、push，也没有开始1B-0B、1B-1或Bridge实现。
