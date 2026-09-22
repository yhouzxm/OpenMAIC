# OpenMAIC Identity Bridge

Status: PROPOSED。现有固定底座 4d2e2bab82374ed45b95964a1f2ed03362666e1c；这是设计，不是已具备租户隔离的声明。

## 实现证据与缺口

| 当前实现                                                  | 已提供                                                                             | 不能推导出的保证                                                         |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| lib/server/access-token.ts                                | access code 派生时间戳 HMAC 验证                                                   | 没有 User、Membership、RBAC                                              |
| lib/server/stage-access.ts                                | owner/public/published/deleted metadata 解析                                       | 不是完整授权服务                                                         |
| lib/persistence/document-access.ts / decideDocumentAccess | 写/删需 owner；读主要检查存在与未删除                                              | read 不自行检查 Tenant/Enrollment，也不能靠 isPublic 自动替代业务授权    |
| lib/server/agent-runtime/owner.ts                         | 匿名 UUID cookie；函数支持显式 authenticatedOwnerId                                | with-owner.ts 当前未传认证身份，浏览器 cookie 不应成为 Zhiban 可信 owner |
| app/api/persistence/[...path]/route.ts                    | documents learnerKey=ownerId；assets shared principal；禁止部分共享 asset 破坏操作 | 不提供多租户 asset 隔离                                                  |
| lib/persistence/server-auth.ts                            | 开发 token，production 默认拒绝开发认证（除非显式 opt-in）                         | 不可信客户端 x-learner-key；不能启用不安全选项作为桥接                   |

上述是代码分支审计，未开展渗透测试。不能以 OpenMAIC CI PASS 推导业务授权安全 PASS。

## 目标链路与数据所有权

Zhiban User + active Tenant/Membership + Permission/Policy → Application → OpenMAICResourceAccessPort → Infrastructure Adapter → OpenMAIC 可接受的访问上下文。
Port 接受已验证 ActorRef、ActivityRef、action、requestId；输出受限 LaunchHandle 或资源 DTO，不返回内部 credential。OpenMAICResourceAccessPort是supplementary application port，补充ADR-002初始Port集合（包括ClassroomPort/ScenePort/AssetPort/ActivityRuntimePort），不是否定ADR-002或修改其历史决策。

Zhiban-owned mapping 概念字段：TenantId、ActivityId、opaque StageRef、deploymentRef、ownerMembershipId、opaque ownerHandle、版本/状态；Runtime 映射另加 AttemptId、learner Membership、runtimeHandle；asset mapping 记录 tenant、用途和引用关系。唯一约束与生命周期由 Zhiban 管理，OpenMAIC id 仅作为 opaque foreign reference，不跨库强行添加 FK。
禁止给 Stage 增 tenantId/userRole/teacherId/studentId，禁止给 OpenMAIC 表加 tenant_id，禁止改 persistence principal 逻辑。ownerHandle 不能等于暴露的 V1 用户编号，禁止客户端指定/覆盖。

| 用例                      | 智伴授权事实                                          | Adapter 允许动作                                              |
| ------------------------- | ----------------------------------------------------- | ------------------------------------------------------------- |
| teacher owns activity     | 本 Tenant、有效任教/owner assignment、activity:author | 通过受控映射编辑指定 Stage，不能枚举或编辑他人活动            |
| student consumes activity | 本 Tenant、有效选课、发布/时间状态、activity:consume  | 读取指定活动并使用本人 Runtime；不能获得教师编辑 owner 凭据   |
| admin manages metadata    | 本 Tenant、activity:manage_metadata                   | 修改 Zhiban 元数据；不自动获得 Stage 编辑/学习证据/素材删除权 |

## 集成候选与硬门槛

PREFERRED CANDIDATE：独立的 Zhiban server-side Adapter/gateway + private OpenMAIC instance（私有实例），不是ACCEPTED DEPLOYMENT；优先评估此方案，保留上游 route/principal 原样。网关从已授权映射选择服务器保管的 OpenMAIC owner context；绝不透传浏览器 anonymous_id、x-learner-key 或 access token。分配/保存 context 必须走已存在且验证过的契约；没有可靠注入路径就判定该用例不可接通，不能假造 owner 或改核心补洞。

备选是通过已公开 package handler 的受支持宿主接口构建独立端点，但接口可否完整覆盖须 spike 验证，不将内部函数签名当稳定公开 API。本阶段没有选定可生产运行的接线方式。
所有 document、scene、asset、runtime、agent stream、media/download、Server Action 入口都必须纳入同一受控网络边界；浏览器和未授权服务不能直连原始端点。iframe/动态资源/流也必须验证，不是只保护 launch API。assets shared 分区意味着仅加 mapping 不够：需证明所有读写均被门控，否则使用更强实例隔离或关闭该功能。
禁止 production 开启 insecure dev auth 来获得 runtime 存储；若 runtime 可用路径依赖此开关，桥接该部分 BLOCKED，先提出独立架构评审，而不是绕过限制。

## 生命周期与升级

mapping 创建失败/远程创建成功时记录待对账状态，重试幂等；未完成 mapping 不可发布。所有权转移需审计并更新映射/远端受支持接口，无法原子时冻结编辑直至对账完成。删除业务记录不自动删除共享资产。
权限撤销下一请求生效，短时 launch 绑定 action/resource/actor/expiry/version；长连接主动重查/终止；不颁发可永久直连底座的 bearer URL。
升级走 upstream → main → sync/openmaic-\* → compatibility tests → refactor/zhiban-v2，禁止自动合入。

Phase 1B-0A先静态审计这些安全行为：原始端点旁路、跨Tenant Stage读写/Asset ID guessing、学生写入、owner/learnerKey伪造、Agent编辑、Runtime跨用户访问、撤权后stream、signed/download URL转发、iframe消息伪造。不能用静态证据充分证明时标需1B-0B；实际调用/写入型诊断仅未来另授隔离环境后执行，不能作为0A“必测”擅自运行。新增Adapter的运行与回归测试归未来1B-9/10，不能在未实现时声称已通过。安全门禁未解决不得开放真实多租户，但不妨碍本次文档READY_TO_FREEZE。

## 未决授权表面验证

Awaiting Phase 1B-0 authorization surface validation.
保持 PROPOSED，直到 Phase 1B-0 完成且证据证明需要开放的全部 OpenMAIC 资源入口处于统一授权边界内，再进行明确接受评审；完成 spike 不自动改为 ACCEPTED。
Phase 1B-0 是首个技术批次，必须在数据库 schema 实施之前完成，不是生产 Adapter 实现。逐项清单与证据字段见 [实施计划](phase1b-implementation-plan.md)。任何必需能力若只能通过 Category C/D 核心修改实现，禁止修改，输出 BLOCKED_FOR_ARCHITECTURE_REVIEW。OpenMAICResourceAccessPort 仍为 Application Port；该命名不表示已有安全接线实现。

## Phase 1B-0 内部验证层次（冻结）

1B-0A — STATIC AUTHORIZATION SURFACE AUDIT：只读源码/配置、枚举 route 和 server action、追踪调用、分析 principal/cookie/header/token/network exposure/public contract/adapter feasibility/direct browser bypass。读取配置应脱敏，不读取或泄露真实用户凭据。禁止写数据库、创建Stage/Runtime、写Asset、调用可能持久化的Agent、修改OpenMAIC、启用insecure dev auth、创建production Adapter或Identity实现。
1B-0B — ISOLATED DIAGNOSTIC VERIFICATION：仅在确有需要且未来独立授权时，用隔离非生产环境与合成身份/数据验证动态行为。不得访问生产数据、修改V1、使用真实用户凭据、启用insecure production auth或修改OpenMAIC core。动态写入也只能在另行批准的隔离范围内；本次不执行。
0A/0B只是Phase 1B-0内部两个验证层次，不增加正式Phase或把13个批次改成14个。

| 字段                          | 允许值与规则                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------ |
| VERDICT                       | 仅 SAFE_ADAPTER / NETWORK_ISOLATION_REQUIRED / UPSTREAM_EXTENSION_REQUIRED / BLOCKED |
| DYNAMIC_VERIFICATION_REQUIRED | YES / NO；静态证据不足时必须YES                                                      |
| VERIFICATION_STATUS           | STATIC_CONFIRMED / REQUIRES_ISOLATED_DIAGNOSTIC                                      |
| DIAGNOSTIC_BLOCKER            | 无隔离环境时 DYNAMIC_VERIFICATION_BLOCKED_BY_ENVIRONMENT，绝不能写PASS               |
| CONTRACT_CLASSIFICATION       | PUBLIC/STABLE CONTRACT / INTERNAL/UPGRADE-SENSITIVE IMPLEMENTATION                   |

只有源码、正式契约、配置、已存在测试证据足够支持所述安全结论时，才可标STATIC_CONFIRMED；“已有测试”须注明版本、覆盖和实际证据，不能凭文件名或CI整体绿灯推定。静态确认配置不能代替目标部署连通性证据。
证据不足时：DYNAMIC_VERIFICATION_REQUIRED=YES、VERIFICATION_STATUS=REQUIRES_ISOLATED_DIAGNOSTIC；VERDICT按事实选NETWORK_ISOLATION_REQUIRED、UPSTREAM_EXTENSION_REQUIRED或BLOCKED，不得SAFE_ADAPTER。PENDING_DYNAMIC_VERIFICATION不是正式VERDICT值，不增加第五值。
未来0B结果以证据/结果记录另行评审；不得冒称STATIC_CONFIRMED来表示动态通过，也不在本次扩展状态枚举。0A报告写完不等于所有安全门禁通过；必需能力尚需0B而未完成时，1B-0不能算已满足schema/bridge前置门槛。

优先核查 @openmaic/dsl、@openmaic/storage published interfaces、published package entry points、明确导出的supported contracts。导出本身不是稳定性承诺，须给正式支持证据。
`lib/store/**`、`lib/server/agent-runtime/**`、`lib/utils/iframe*`、Next route内部JSON、private helper、internal Zustand action、Postgres internal schema均不得自动当作稳定契约。安全桥接若只能依赖内部实现，禁止SAFE_ADAPTER；至少UPSTREAM_EXTENSION_REQUIRED或NETWORK_ISOLATION_REQUIRED并解释风险，不能证明可隔离则BLOCKED。
任何必需能力只能通过Category C/D核心修改实现：不修改，输出BLOCKED_FOR_ARCHITECTURE_REVIEW。ADR-012仍PROPOSED，静态/动态诊断都不自动接受部署。

授权面逐项清单与A/B/C网络比较见[Phase 1B计划](phase1b-implementation-plan.md)，Classroom/ClassroomSurface、Playback、Generation/Edit、Importer、所有派生URL、服务端直读/内部fetch/后台任务都不能省略。本次只规定覆盖，不报告这些入口已完成spike。

## Mapping 生命周期与所有权（ADR-004）

所有TenantId、ActivityId、opaque StageRef、deploymentRef、ownerMembershipId、opaque ownerHandle、AttemptId、runtimeHandle和asset mapping均为Zhiban-owned记录。OpenMAIC标识仅作opaque foreign reference：不得跨库强FK、从ID反推Tenant、把Stage owner当Zhiban身份、anonymous cookie当User、learnerKey当Membership。服务端必须通过已授权映射解析，不从资源返回值推导业务权力。

| 阶段        | 设计要求                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------ |
| create      | 幂等业务命令先记录待关联意图；远端成功而本地失败可对账，未完成mapping不能授权              |
| publish     | 检查mapping完整、资源可用和当前业务授权；OpenMAIC public/published不自动等于智伴可读       |
| transfer    | 重新核验原/新ownerMembership与grant ceiling，冻结编辑直至远端受支持操作和映射对账完成      |
| disable     | 停用mapping即拒绝新访问并失效launch/缓存/流，不依赖删除远端资源；身份恢复不自动启用mapping |
| reconcile   | 只在独立授权工作流核对两端版本/存在性；差异隔离，绝不按未知owner自动认领                   |
| delete      | 保留必要历史引用和审计；确认引用/保留策略后才考虑远端支持的删除，不删除共享资产兜底        |
| orphan      | 远端孤儿或悬空mapping标待处理并deny；人工/受控对账决定修复，不靠扫描ID猜租户               |
| retry       | 重试重新验证当前授权与版本，不沿用已撤权快照；失败保持不可发布                             |
| idempotency | key包含Tenant/业务操作/资源意图；唯一映射及操作结果防重复创建，冲突返回明确状态            |

此表仅设计，未创建mapping表、Adapter或对账任务。

## RLS不覆盖底座原生资源

ADR-011的PostgreSQL RLS只保护Zhiban-owned tenant tables，不能保护OpenMAIC原生Stage、Asset、Runtime、Agent Session；“Zhiban RLS通过”不等于“OpenMAIC bridge已安全”。
OpenMAIC资源授权仍需要Application authorization + Zhiban-owned mapping + Infrastructure Adapter + 必要的network isolation；0A/0B分别提供相应证据，不能互相替代。
