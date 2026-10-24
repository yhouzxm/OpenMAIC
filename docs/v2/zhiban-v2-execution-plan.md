# 智伴 V2 后续移植执行总计划

> 2026-10-17 执行主线：界面恢复与剩余业务统一按[完整迁移计划](zhiban-v2-migration-completion-plan.md)推进，先交付 P1 登录／三角色壳／课程列表。旧版视觉不再作为不保证事项；新权限和生产门禁继续原边界。当前 3461 原 PID／根已不存在，本轮未重建；下面保留历史执行记录。

STATUS: LOCAL_FIRST_EXECUTION_PLAN / DELIVERY_REPLAN_2026_10_08

编制日期：2026-10-03。目标：让 Codex 按有前置、有边界、有测试、有独立签收的工程单元完成迁移，而不是复制 V1 源码或一次性生成整个系统。

2026-10-08 用户要求重新规划整个项目：以真实功能交付为主，本地能够验证时不再重复 GitHub CI。当前执行顺序、验证策略与下一任务以 [功能交付计划](zhiban-v2-delivery-plan.md) 和本文更新后的第 3/4/16 节为准；旧单元编号用于追踪职责，已完成单元不重新执行。此调整覆盖旧文档中未来工作逐单元远端 CI、固定两轮全套和独立 docs checkpoint 的流程要求，不改写历史证据或冻结业务/安全语义。

本计划不批准生产数据访问、部署、付费 AI 调用或后续全部实现。实施范围由用户任务确定；commit/push 等外部写入按授权执行。本文中的未来表名、文件名和状态设计均为建议，须在对应工作包明确后实施。

2026-10-03 人工批准：接受此计划，授权计划文档 checkpoint，随后执行 **1B-7A DESIGN**。批准的是执行路线与逐单元门禁，不是预先批准全部业务规则、角色委派、实际 release 活动支持集或生产迁移。R1 教学闭环优先作为计划方向；具体 release manifest 与各未决业务项仍须在所属设计单元明确。1B-7B BUILD 不在本次授权范围。

## 1. 仓库事实与起点

2026-10-08 当前工作目录 `/home/zxm/openmaic/zhiban`，branch `refactor/zhiban-v2`，重排基线 `daf63afa83470d24a9ed41d171c6a17f8a80adb6`，preflight CLEAN。Identity 至 1B-8E、Bridge 9B 和 Runtime/AI 9C foundation 已有 closeout；migrations 已为 0001–0013。尚无 `app/zhiban` 页面与 Course/Learning/Assessment 业务实现。下表及原起点 CI 是 2026-10-03 历史，当前资产以 [交付计划第 1 节](zhiban-v2-delivery-plan.md#1-当前可以复用的成果) 和对应 closeout 解释，不再从旧 1B-7A 队列开始。

| 项目 | 本次核验事实 |
| --- | --- |
| V2 目录 / 分支 | `E:\openmaic\zhiban` / `refactor/zhiban-v2` |
| 本计划起点 HEAD | `6c08f4dcbd8fd84105c9823d3a5229565d96a85d` |
| 官方 OpenMAIC 基线 | `v1.1.2`，release SHA `1f05a70ac93e09c67fb4d3aafb9c2b068d14fcce` |
| V1 只读参考 | `E:\openmaic\OpenMAIC` / `feature/zhiban-mechatronics`，本次读取 HEAD `0fa0a15e8b12ae9e4f7a2d78e80338874599bbae` |
| Identity Domain / Ports / PG repositories | 1B-1 至 1B-4 已实现并有冻结 closeout |
| Credential | 1B-5 已实现 / FROZEN，global User、PASSWORD、Argon2id、CAS、securityEpoch |
| Session | 1B-6 已实现 / FROZEN；1B2-F07 CLOSED；cookie/CSRF contract 不等于 HTTP wiring |
| Authorization | 有冻结规则、Role/Grant/Scope/Permission 和 RoleCatalogPort；尚无 1B-7 production policy/composition |
| Identity public API | 尚未完成 1B-8；不得把原生 OpenMAIC API 当作智伴 API |
| OpenMAIC 集成 | ADR-013/014 架构接受；ADR-012 仍 PROPOSED；capability-specific 0B 尚未完成 |
| 后续业务域 | 当前 `lib/zhiban` 实现为 Identity，未实现 Course/Learning/Assessment/Profile/Intervention/Portal |
| 已应用 migration 文件 | Identity 0001–0006；后续不得改写其内容/checksum |

起点完整验证已在同一 SHA 上完成：

| 精确候选 CI | 实际证据 |
| --- | --- |
| [通用 CI 37077902289](https://github.com/yhouzxm/OpenMAIC/actions/runs/37077902289) | SUCCESS；根测试 9890 passed / 219 skipped；importer 271、DSL 252、generation 199；storage 无 PG 环境 1137 passed / 184 skipped；E2E 65 passed；生产 build、Render Service、Docker deps/builder PASS |
| [Storage PG16 37077906212](https://github.com/yhouzxm/OpenMAIC/actions/runs/37077906212) | SUCCESS；1314 passed / 7 skipped，四个必需真实 PG suite 32+28+8+39；12 表写入检查 PASS；app-domain PG 18 PASS |
| [Identity PG16 37077909383](https://github.com/yhouzxm/OpenMAIC/actions/runs/37077909383) | SUCCESS；PG 16.15、Node v22.23.3 linux/x64；121/121 ×2；static 28 + Domain/contracts 376 + Credential 99 + Session 50 + repositories 352 = 905/905；native Argon2 实际执行 |

这些数字是起点证据，不是未来测试数量上限。必须报告新增后的真实总数、skip 原因和实际执行 suite，不能为凑数删测试。

1.1.2 是受控的官方安全 release，不是 fork 的移动 `main`。官方行为变化见 [release notes](https://github.com/THU-MAIC/OpenMAIC/releases/tag/v1.1.2)。后续 Adapter 必须验证 provider final URL、redirect refusal、private address policy、错误脱敏和代理行为，不能降低 SSRF 防护恢复旧行为。

现有 `sync/openmaic-1.1.2-sync-review.md` 保留此前 push/CI 未完成时的历史状态；本表记录随后完成的精确候选与合入事实。DOC-01 已补充最终证据，不改写历史失败为成功。

### 权威文件与解释次序

1. 已人工接受的 ADR 与最新 closeout；实施代码和实际测试证明实现状态。
2. `phase1/identity-domain.md`、`rbac-model.md`、`permission-matrix.md`、`authorization-flow.md`、`auth-boundary.md`、`tenant-isolation.md`。
3. `phase1/phase1b-implementation-plan.md`、`phase1b-gate-map.md` 保留 1B-0 至 1B-12 编号；本文的 A/B/C 是这些阶段的执行子单元，不替代原编号。
4. `v1-capability-inventory.md`、`migration-matrix.md` 是业务追溯，不是复制授权。Phase 0 暂定 Account/RoleAssignment 模型已被 Phase 1A 的 User/Membership/RoleGrant 细化取代。
5. 历史固定 SHA/初始 NOT_IMPLEMENTED 标记不是当前状态；须关联后续 closeout。真实冻结规则冲突必须停止并报告，不自行选一条。

## 2. 推荐交付节奏和批准事项

推荐先交付教学闭环，再补齐高级能力。这是范围建议，不是自动删减需求：

- **R1 教学闭环**：管理员建课/开班/选课；教师创建发布受支持活动；学生学习与提交；教师评分发布；双租户隔离、审计与恢复。只启用已通过 capability Gate 的活动种类。
- **R2 教学治理**：完整 Portal、分析、概念错误、画像、补救、风险干预、受控 AI、导入/通知。
- **R3 完整扩展能力**：经批准的完整 Classroom/Playback、Interactive/VirtualLab、PBL、EMA、AI Peer 等。属于 V1 REVIEW 的能力在批准前不是必做实现，也不是已取消。
- **生产迁移**：按实际批准的 R1/R2/R3 release manifest 单独演练和切换。可以在 R1 时批准有限试点，不等于已完成全量 V1 迁移。

2026-10-04 首发依赖决定（用户明确授权审阅并决定）：[ADR-012 限定接受评审](adr/ADR-012-openmaic-identity-bridge.md) 接受已验证 D02–D05 的受控包宿主架构。**U01 完整 Classroom/Playback 与 U02 Interactive/VirtualLab 均非 R1 硬要求，继续 REQUIRED_LATER，默认由 R3 的 7A/7B 完成。** R1 实际活动清单和教学规则仍在 2C/3A/3B/4A 冻结；只开放通过各自 Gate 的用例。单 slide 预览不满足完整课堂或学习完成验收，相关未支持执行入口保持关闭。U01/U02 的完整迁移需求保留，后续将它们列为某 release 必需时，须显式修改 manifest 并将未关闭项作为该 release 的 P0 阻塞。该决定不批准 BUILD、实际发布或生产 cutover。

以下事项必须由人批准，Codex 可以提出选项但不能代填决定：

| 决策 | 最迟关闭位置 |
| --- | --- |
| 首发范围、必须支持的活动类型；完整课堂/Interactive 是否首发硬要求 | 2026-10-04 已决定 U01/U02 非 R1 硬要求；具体活动清单仍须对应设计批准，若后来纳入 release 必需则未满足时阻止发布 |
| role catalog 的精确 permission 集、显式 delegation ceiling、首个 Tenant/SystemAdmin 的引导与恢复责任人 | 1B-7A / 1B-8A |
| 登录 identifier、规范化/冲突策略、邀请和 pending-origin approval（1B1-F05） | 1B-8A |
| 恢复渠道、重认证证据、限速部署后端、密码语料配置责任 | 1B-8A/E；未配置时相关能力关闭，不 fail open |
| U01/U02 可用正式契约，或是否另立 ADR 自建有限宿主 | 0B-A / 1B-9A；禁止偷偷复制引擎/iframe internals |
| 自主选课、成绩规则/申诉、画像维度、风险使用范围/角色、EMA 定义、AI Peer 安全责任 | 相应领域设计单元 |
| 数据保留/匿名化、真实数据授权、迁移范围、RPO/RTO、容量/延迟目标、付费 provider 预算 | DATA-A / OPS-A / 对应 AI 单元 |

不知道的业务规则不能用看似合理的代码默认值替代；未批准的权限/类型默认拒绝，未批准的能力保持关闭。

## 3. 所有单元共用的执行契约

### 3.1 一个功能工作包的交付周期

| 模式 | 允许行为 | 退出条件 |
| --- | --- | --- |
| 功能交付 | 聚焦一条可使用的旅程；必要设计、实现、自审、相关本地验证、短记录同周期完成 | 用户可在本机使用，真实持久化/权限与必要验证 PASS，P0/P1=0，LOCAL_VERIFIED |
| DESIGN（确需决定时） | 新 schema、权限、产品规则或外部能力的短方案与缺口 | 集中关闭该工作包的真实决定项；不为普通实现细节重复审批 |
| CHECKPOINT | 精确 scope 核验、显式 stage、正常 commit、固定网络 push | parent/message/SHA/clean/remote match 均核验；不改实现、不补测试 |
| CI SIGNOFF（可选） | 仅为说明了增量价值且获授权的远端检查派发精确候选 | 指定 suite/环境实际通过；不是每个功能的必经步骤 |
| 交付记录 | 与功能合并记录本地证据、限制与下一功能 | 不再默认另开 closeout/docs checkpoint 周期 |

实现的自审与普通修复在同轮完成，不把每个普通 bug 拆成 revision phase。真实 SQL/assertion failure 先定位和修复，再本地验证，不要求为每次修复先提交并派发 GitHub。若实际 CI 暴露失败，再按其具体原因处理，不无脑 rerun。

每轮完成后停止。总计划不是“无人监督一直执行到上线”的授权。

### 3.2 Preflight 与变更保护

每次开始执行：

```powershell
git branch --show-current
git rev-parse HEAD
git status --short --untracked-files=all
```

- 项目必须为 V2，分支为 `refactor/zhiban-v2`，HEAD 必须等于本轮人类批准的 `EXPECTED_HEAD`。只有第一轮起点可用本文 SHA；后续使用上一个已验证 checkpoint 的实际 SHA，不重复硬编码旧 SHA。
- 独立新工作包以 CLEAN 为通常基线；同一授权工作包的已知 docs/实现增量可接续，不要求先提交文档才能实施。checkpoint 仍要求精确 reviewed 文件集合。发现额外变更保留并核对归属，不清理用户改动；无法安全避开重叠时再报告。
- 读取 root/相关子目录的 AGENTS.md（如有）及适用 skill；先列 CURRENT ASSETS / GAP MATRIX，不重写可复用能力。
- V1 永远只读：不 install、不 format、不 checkout/reset、不编辑、不 merge V1 branch、不访问真实数据/凭据。
- 默认代码范围为 `lib/zhiban/{domain,application,infrastructure}/<context>/**`、`app/api/zhiban/**`、`app/zhiban/**`、`components/zhiban/**`、对应 tests/e2e 和文档。具体 allowlist 在 DESIGN 冻结；不可据此改所有目录。
- 不改 OpenMAIC core/package internals。Domain 纯 TS；Application 不导入 PG/Next/OpenMAIC/React；Infrastructure 做转换；UI 只消费用例 DTO。
- 已应用 migration 追加修复，不改 checksum。当前 0001–0013 不动；Identity 下一号只有在 inventory 核验后才可能是 0014。其他 context 的 schema、ledger、runner 所有权先明确，不把全系统表塞进 Identity runner。
- 不用 owner/migrator/superuser 给应用执行；不把 global Credential/Session 变成 tenant RLS 表；tenant-owned 业务表需明确 RLS、复合 FK、tenant predicates 和最小角色 ACL。
- CAS/revision 复用冻结 BigInt/string 规则；不能 xmin、JS Number、last-write-wins、stale-as-no-op 或自动重试陈旧授权。重试必须是用例级显式策略，撤权拒绝不重放。

### 3.3 本地验收为主，按影响验证

按 [交付计划的验证表](zhiban-v2-delivery-plan.md#验证的工作量与改动风险相称) 选择本轮检查。默认是功能实际旅程、受影响测试/依赖回归和相应工具检查，不是每次改动都完整 Identity + Storage + 全仓库重复验证。

- 文档只检查变更文档的格式/链接/事实/diff；页面验证实际交互，业务写入必须走真实用例和 PG。测试只补真实行为风险，复用既有覆盖，不镜像逐行实现。
- Node 22/Linux、pnpm 10.28.0、本地 dedicated PG16 是有效真实环境。ACL/并发/rollback 用 PG16，不能以 mock/PGlite/PG18 冒充。本地不可用时记 PENDING_LOCAL_ENV，不自动转 GitHub 或安装环境。
- 默认一次完整的相关选择；只有重复初始化/清理或具体竞态风险需要时重复对应流程，不要求每个新单元全套两轮。竞态使用独立连接与 acknowledged locks/barriers，不使用 sleep-only 测试。
- 共享 Identity/security/transaction/helper 的改变才触发其完整依赖回归；无关基础层复用原精确证据。真实必需用例不能 skip；不相关 optional suite 明确不执行，不充当 PASS。
- 本地记录选择、实际 count/fail/skip、环境及候选指纹；dirty BUILD 记录代码/配置/依赖指纹，不能只用旧 HEAD 归因。未变的 source/lock/build 可复用对应 artifact；变化后更新验证。
- 里程碑前 typecheck/lint 一次，格式检查/格式化只覆盖变更文件。typecheck OOM 只对进程临时用 8GB NODE_OPTIONS；不持久化。依赖确需变化时验证 frozen lock，不顺带升级包。
- GitHub CI 默认不派发，已有 workflows/tests 保留。新功能无需为了本地验收顺带改 workflow；确有协作/环境/发布需要时才另行规划其接入和选择。

实际获授权使用 CI 时，记录所选 run 的 event/headSha/URL/环境/覆盖，不强制同时派发三个 workflow。远端候选核验仍适用；同一 SHA 的本地结果与 GitHub 结果保留各自来源。

### 3.4 Checkpoint 模板

只有收到明确 checkpoint/commit/push 授权才运行：先 `git diff --name-status`、`git diff --check`、`git status --short --untracked-files=all`，与批准 allowlist 精确比较。用 `git add -- <逐个明确路径>`，不 add-all。

stage 后核验 cached scope/stat/check、无 unstaged/unexpected untracked；正常 commit，核验 parent/message/new SHA/CLEAN。push 只执行一次：

```powershell
git -c http.version=HTTP/1.1 -c http.postBuffer=67108864 push origin refactor/zhiban-v2
git -c http.version=HTTP/1.1 ls-remote origin refs/heads/refactor/zhiban-v2
```

禁止 force、amend、reset/rebase/stash、SSH fallback、持久 git config。reset/TLS/443/timeout 时 STOP；下一次 retry 须再授权，不重 commit。push SUCCESS 而 read-back 网络不可用记 PENDING_VERIFICATION，不改判 push 失败。CI 前独立核验 HEAD/message/parent。

### 3.5 完成与严重性

- `LOCAL_VERIFIED` 是开发工作包的有效验收状态，不需要另补 `CI_SIGNED_OFF` 才能交付或开始下一已授权功能。历史 `CI_SIGNED_OFF/FROZEN` 保留；开发/本地验收不等于 `PRODUCTION_APPROVED`。
- P0：跨租户、secret 泄漏、禁用/撤销仍有效、权限伪造、数据损坏/partial commit、最后管理员并发归零等。
- P1：CAS/授权版本错误、grant stitching/ceiling 绕过、关键 suite 漏跑、审计不原子、关键负例 fail open 等。
- P2：非安全维护项、明确尚待真实环境证据。不得用 P2 掩盖 production correctness 缺陷。
- P0/P1=0、相关实际验证通过才可 LOCAL_VERIFIED/checkpoint ready；必需 PG pending 不算该功能验证完成。违反冻结业务/安全契约输出 CONTRACT_CONFLICT；用户本次授权的执行流程调整不属于这种冲突。

## 4. 执行顺序总览

当前队列改为 [功能交付计划第 3 节](zhiban-v2-delivery-plan.md#3-新推进顺序七个可验收里程碑) 的 M1–M7：

| 顺序 | 交付重点 | 原 UNIT 职责 |
| --- | --- | --- |
| M1 | 本地可运行的登录、空间导航与工作台 | 1B-11/5A + 最小 local host/配置接线 |
| M2 | 课程、开班、任教、选课及真实角色页面 | 2A/2B + 5B–5D 切片 |
| M3 | 活动发布、Attempt、学生提交 | 2C/3A/3D + 页面 |
| M4 | 评分发布、更正、本人进度/成绩；教学闭环 | 4A/4B/3C + 5C/5D 终验 |
| M5 | 受支持内容编辑、Runtime 与受控 AI | 2D/3B + 1B-9 业务接线/D08/D09 |
| M6 | 导入、画像、诊断、分析、干预与通知 | 2E/4C/6A–6D |
| M7 | 完整课堂、Interactive/VirtualLab、PBL、Tutor/EMA/AI Peer | 7A–7F |

1B-10 集成门禁跟随实际启用能力分布到这些里程碑；1B-12 汇总到对应交付记录。没有真实 Activity/Attempt 时不先做完整 enabled Bridge 合成测试工程。UI 随业务交付，不统一等 backend 全部完成后才做 Portal。

当前基础层（Identity 至 8E、0B、9A–9C）直接复用，不重启旧队列。后续第 5–15 节保留 UNIT 职责、需求和重要边界，**不再作为强制串行顺序或逐单元远端 CI 要求**。本次不新增并行 agent 授权。

M3 通用文字活动及教师配置截止/重交/次数规则已明确实施；R1 完整 manifest 和 M4 评分/发布/更正规则仍需决定，不因文字活动可用删减首发能力需求。启用能力满足后，可针对有限 release 提前做 DATA/OPS 试点；最终全量能力追踪见交付计划第 4 节，36 项保留。

## 5. DOC-01 — 计划批准与证据整理

**模式/范围**：DESIGN/DOCS ONLY，`docs/v2/**`。前置是本文起点 CLEAN；当前编制本文不自动完成此单元。

**步骤**：批准首发 release manifest；为全部 36 项能力注明 R1/R2/R3/REVIEW/REMOVE 与证据；补充 1.1.2 sync 最终 CI/合入信息；建立执行 ledger（可在本文末尾维护），记录 unit、base/candidate、scope、tests、run、deferred owner、checkpoint SHA。历史失败/旧 SHA 保留，不变造。

**Gate**：此处保留历史 DOC-01 职责。未来 release 支持集在相关业务工作包集中明确，不要求为本次计划重排先完成一个独立 docs checkpoint 才能推进 M1。

## 6. Phase 1B 原单元职责与保留边界

以下保留原单元职责及专属安全边界；当前完成状态和交付位置见新版计划，已完成单元不再执行。

### 1B-7A — Authorization contract / transaction design

- **读取**：rbac/permission/authorization/auth/tenant-isolation、1B-4/6 closeout、ADR-009/010/011、现有 Domain/Ports/repositories/transactions/PG ACL。
- **交付**：纯 policy 输入/closed decision；可信 server relationship facts 的来源/可构造边界；精确 RoleCatalog/版本 rollout、delegation ceiling；authorizationVersion 与提交复核；同 Tenant serialization point、fresh reread 和 same-client mutation composition 设计。
- **关键约束**：同一 grant 同时提供 permission+scope；只接受 SELF/CLASS/COURSE/TENANT；Session/TenantContext 不证明授权；SYSTEM_ADMIN 独立。除冻结模型外的委派默认 DENY，不能 role 字符串排序或 tenant-admin 无限权限。
- **设计 Gate**：对每条 last-admin 相关路径说明锁序/ACL/同事务。Membership disable/leave/grant revoke/replacement/recovery 均纳入；global User disable、Tenant disable、grant 自然到期的行政恢复策略明确归属，不伪称所有状态变化已受 guard 控制。现有角色无法安全支持则 ROLE/SCHEMA_BLOCKER，先批准，不新增 migration。

### 1B-7B — Authorization implementation + real concurrency proof

- **范围**：`domain/identity/policies/**`、`application/identity/authorize.ts`、最小 authorization transaction Port/PG primitive、`tests/zhiban/identity/authorization/**`、`postgres/pg16-authorization.test.ts`；最小 CI 接入。
- **步骤**：实现 default DENY 状态链/有效期/permission/scope/资源状态；Application 读当前事实；返回当前版本供敏感写复核；实现显式 ceiling/防自提权/控制面隔离/last-admin policy。Tenant row（或 DESIGN 批准的等价锚）锁后 fresh read，再 same transaction guard。不得改旧 MembershipRepositoryPort 意义或让 callback 再开另一事务。
- **Tests**：active allow；User/Tenant disabled、Membership pending/disabled/left、revoked/expired/future grant deny；scope 精确/跨租户/unknown deny；A permission+B scope 拼接 deny；旧 authorizationVersion deny；撤权立即 deny；SystemAdmin 无教学 fallback；自提权/over-ceiling deny；最后管理员移除 deny、有效 atomic replacement allow、future replacement 不算。
- **真实 PG**：至少原 AUTHZ-PG01–18 对应能力；两个独立连接同时撤各自管理员，锁内 reread 后最多一个成功，最终 ≥1；RLS/transaction/audit组合与旧 suite 无回归。默认 NO NEW MIGRATION，0001–0006 unchanged。
- **Gate**：历史 1B-7 已按当时两轮 CI 完成 closeout；未来改变按第 3 节本地验证。primitive 与实际 use-case enforcement 的差距由已完成 1B-8C 证明，不提前宣称未来所有业务入口已保护。

### 1B-8A — Identity application/API/security composition design

- **交付**：登录 identifier/resolver 不枚举策略（Credential 保持 canonical UserId）；生产 UUIDv7 ID service；controlled RoleCatalog adapter 和配置；首个平台管理员/首个 Tenant 的受控 bootstrap、恢复负责人；invite/accept 与 1B1-F05 approval provenance。
- **逐用例冻结**：登录/退出/退出全部/本人身份/可选择空间；Tenant/User 状态管理；Membership 创建/批准/disable/leave/rejoin/恢复；grant/revoke/replace；本人换密码；恢复/reset 与身份审批分开。列 actor、scope、资源事实、期望版本、事务、幂等、audit、DTO、错误码。
- **关闭事务缺口**：旧 repo 自有事务不等于跨用例 atomic audit。设计最小 same-client composition、权限最小化与锁序；不得假定跨 auth/control/tenant pools 的 ACID。无法保持冻结 contract 时 STOP；需 schema/ACL 补充先独立批准。
- **HTTP 合同**：cookie extraction/set/clear、Origin/CSRF、body bounds、401/403/防枚举404、无 hash/digest、禁止 cache；部署级限速/信任代理规则/筛查 corpus 缺配置拒绝。恢复渠道未知则关闭对应 API，不能测试假 sender 成为生产默认。

### 1B-8B — Global identity authentication/use-case composition

- **前置**：1B-8A 批准。实现 ID/catalog/resolver、Session authenticator 用例调用、login/logout/me/revoke-all/本人密码替换的 Application composition；控制面 bootstrap 只做经批准的 operator tool，禁止匿名 public endpoint。
- **Tests**：identifier normalization/collision、unknown/wrong统一边界；storage outage deny；screening 未配置拒绝；credential change/session invalidation；cookie 不序列化 secret；全局 User disable/restore 不复活 session；控制面没有 tenant 教学读取 fallback。
- **Gate**：不重写 hash/session algorithms；限速后端/配置部署责任可验证；首个管理员创建单次/幂等且审计；全局身份查询不供租户用户枚举。

### 1B-8C — Membership/grant application mutations

- **步骤**：实现受控邀请/accept（或已批准导入确认）、pending activate、disable、leave、显式 preserve/replace恢复、rejoin新审批、grant/revoke/atomic replacement；最新 authorization check、ceiling、target expectedRevision、last-admin guard、history/authVersion/mutation audit 同事务。
- **Tests**：批准未绑定目标拒绝；1B1-F05；future/revoked/expired grant 恢复不授权；两个并发不同成员撤权、restore/revoke、self elevation；审计失败 rollback；重复 command 幂等；请求初始允许但提交前撤权拒绝。
- **Gate**：真实 PG 验证具体用例，不只 primitive。明确 User/Tenant global/control 状态变化与 tenant 敏感写的 serialization；不能将 initial ALLOW 当长期写入许可证，也不为方便 overgrant DB roles。

### 1B-8D — Minimal Identity HTTP adapters

- **范围**：`app/api/zhiban/identity/**`（DESIGN 可选择等价命名）和最小 server composition root；不改原生 OpenMAIC routes。
- **步骤**：wire 1B-8B/C 到薄 handler；每入口认证/tenant candidate/authorization/CSRF；global identity/control 分开；current-user membership discovery 最小化设计，不用全局 tenant/member列表；server-only credentials、cookie与运行配置。
- **Tests**：真实 HTTP cookie flags/clear/rotation；Origin 精确匹配、缺 Origin/伪造 CSRF拒绝；cache/header/errors不漏 token/hash/digest/SQL；跨租户 path/body/batch tamper；不同入口/Server Action/worker 不绕过用例；rate limiter/store failure按批准合同fail closed。
- **Gate**：公开 login API 不能在 screening、限速和 errors 未闭合时开启；后台任务携带受限 ServiceActor，不伪造 SYSTEM_ADMIN。

### 1B-8E — Recovery / reset / re-auth channels（条件单元）

- **前置**：批准具体渠道、通知 provider、身份核验和人工审批；没有决定则 `BLOCKED_BY_RECOVERY_CHANNEL_DECISION`，不是允许空实现。
- **交付**：单次限时审批/token digest、请求非枚举、消费与新 Credential/epoch 原子关系、重放并发/expiry/取消、secret-free通知；TENANT_ADMIN 无全球改密码权。
- **Gate**：密码重置不依赖生日/手机号后四位；不导入真实凭据；不新加 MFA/OAuth/JWT。R1 若关闭自动恢复，须批准并演练明确的受控 operator recovery，不把“deferred”留成无恢复生产。

### 1B-0B-A — 1.1.2 capability re-audit / diagnostic authorization

- **模式**：只读 + DESIGN；把旧 baseline 的0A/0R与当前 1.1.2 exports/dist差异关联。检查 DSL/storage/generation/editor/renderer/importer 的正式入口，公开 export 不是稳定/安全保证。
- **交付**：D01–D10 当前必要子集、U01/U02真实状态、目标 host 是否装载原生 route、独立 DB/字节存储/网络/合成fixture/cleanup allowlist。诊断授权单独列资源；不能从本计划推断允许创建/删库。
- **Gate**：native Web/agent/tools/actions/dev auth 保持关闭目标；C/D internal修改需求报告 BLOCKED_FOR_ARCHITECTURE_REVIEW。不以 provider security release 视为桥接已安全。

### 1B-0B-B — Capability-specific isolated proof

- **前置**：诊断资源明确授权；只用合成身份/数据、fake AICallFn。
- **步骤/Tests**：D01原生路径/存储旁路不可达；D02字节读取/range/cache/撤权/active HTML；D03 runtime caller learner伪造、同tenant横向读取/跨tenant、stage-attempt绑定；D04 document/mapping pending/orphan/CAS；D05只支持的slide preview；D06/7关闭负例，正向等正式契约；D08–10只在editor/generation/import获批时验证。
- **Gate**：每能力列 version、正式契约、边界证据、支持类型、失败原因、未覆盖生产配置。未知 NOT_VERIFIED，不 SAFE。报告供人类明确接受 ADR-012（按批准资源范围），Codex不能自动把 PROPOSED 改 ACCEPTED。

当前完成证据见 [1B-0B-B closeout](phase1/phase1b-0b-b-review.md)。2026-10-04 后续显式 [ADR-012 评审](adr/ADR-012-openmaic-identity-bridge.md) 已限定接受 D02–D05 架构；生产 D01 隔离、真实授权组合和 scalar/JSON 所需完整性门禁保留。1B-9A 可在文档 checkpoint 后单独授权设计；这不是 1B-9B/C BUILD 或 deployment 授权。

### 1B-9A — Bridge/mapping/lifecycle design

- **前置**：对应0B PASS、ADR-012人工接受、1B-7/8所需边界通过。
- **交付**：Zhiban-owned mapping ownership、opaque OpenMAIC resource、version/revision、pending/active/orphan/retention；server principal、受限操作/launch、cache/range/stream撤权；DB/byte store角色与schema边界。
- **关键**：不能给 Stage/Runtime表加tenant业务列；外部副作用与Zhiban DB不是跨系统ACID。明确 recoverable pending + idempotency + reconciliation/补偿；只在业务资源确立后 active，不用虚假Course/Attempt挂接骗过约束。对应schema追加需先独立review。

### 1B-9B — Document / Asset / authorized resource gateway

- **范围**：`infrastructure/openmaic/**`、Application-owned ports、Zhiban mapping repositories、授权资源路由/tests。
- **步骤**：consume published DocumentStore/AssetStore/DSL；创建/描述/读写每次用例授权；server principal、opaque映射；受保护资源/派生背景/海报/audio/video/range都经 gateway；安全 mime/CSP/isolation、限额和broken reference状态。
- **Tests**：跨tenant/同tenant他人猜id、URL复制/缓存串tenant、上传active内容、撤权后读取、pending orphan禁止访问、大小限制、timeout、故障补偿、重放、不误删共享asset。
- **Gate**：真实store isolation/mapper malformed fail closed/host route缺席；不redirect原始signed bearer URL，不拿静态预览当完整Classroom。

### 1B-9C — Runtime / AI integration foundation

- **步骤**：实现 published RuntimeStore 候选的安全adapter与server learner/attempt binding contract；AIServicePort固定受控目的、限额、输入/输出schema、provenance/errors/cancel；暂无Learning aggregate时只验contract，不开启真实活动 launch。
- **Tests**：伪造learner/owner/attempt、read/list/append/merge/admin旁路、cancel/retry/孤儿mapping；fake provider无密钥、无通用tool权限；跨tenant缓存否认。
- **Gate**：Learning实际发行/采纳evidence归3B/3C；AI具体用途归2D/7D，不能在此开放通用agent。U01/U02未关闭时对应执行能力关闭。

### 1B-10 — Integrated Identity / enabled Bridge security gate

- **步骤**：用真实Application/HTTP/DB重复所有权限负例；从build产物/实际host访问原生路线、static/direct/asset/runtime/SSE路径；logout/revoke/disable发生在长流或副作用中验证重新授权/停止。
- **Gate**：tenant cache/后台任务/batch全部隔离，DTO/audit/log redaction，未知配置拒绝。未通过Bridge不阻塞已闭合Identity，但相关能力及Phase1B完整集成不标COMPLETE；required capability不能通过删测降级。

### 1B-11 — Minimal login / tenant navigation UI

- **交付**：`app/zhiban/login/**`、身份页、空间选择、logout、CSRF获取/操作、错误/过期/无membership状态、最小control入口（按批准权限）。
- **Tests**：真实浏览器登录/退出/切空间/撤权/禁用/多tab、无membership不默认firsttenant、可访问性；选择tenant不写Session权限。UI capability仅显示建议。
- **Gate**：不做教学Portal、不带入原生owner cookie；mock demo不作为身份安全E2E。

### 1B-12 — Phase1B handoff / freeze

- **交付**：准确的启用能力manifest、Identity+Bridge对应signoff、运行配置/密钥/roles说明、遗留deferred owner；独立非生产dry-run。
- **Gate**：1B7–11所需gate完整且人工签收；任何required0B/Bridge阻塞保留，不把Identity-only报告当全Phase1B完整。无生产部署、无V1 migration。

## 7. Phase 2 — Course / Class / Enrollment / Content

下列工程职责按 M2/M3/M5/M6 的实际功能组合交付。产品状态机、permission 词汇、schema 需要明确，设计/实现/本地验收/记录不再默认拆成独立 checkpoint/CI/closeout 周期。

### 2A — Course / Term / academic foundation

- **读取**：V1 curriculum/content/teacher-courses/academic及相关migrations只读；data-ownership/migration-matrix、1B-7/8合同。
- **设计/实现**：Course catalog与不可变发布版本、Term、所有权/负责教师/课程配置；行政组织只是已批准必要元数据，OrganizationUnit scope仍延期；tenant-owned schema/ledger/ports/CAS/审计/应用command/query。
- **Tests**：course owner非平台角色；创建/编辑/归档/发布状态、revision冲突、tenant唯一/复合FK/RLS、list/count/export漏过滤、权限撤销后写拒绝、被引用版本不硬删。
- **Gate**：Course不把Stage当aggregate；不导入旧DB服务；teacher assignment与RoleGrant作用区别冻结后才能给实际教学动作ALLOW。

### 2B — AdministrativeClass / Offering / TeachingAssignment / Enrollment

- **设计/实现**：区分行政班、学期教学班/Offering、Course；Enrollment不等于Membership；任教/班主任关系不等于拥有全tenant TEACHER权限。冻结容量、退出/转班、重复加入/重入、历史有效期、自主选课是否允许。
- **Tests**：Enrollment唯一/CAS、两个并发抢最后席位exactly-one、转班原子/状态补偿、撤销enrollment取消launch、跨tenant关系拒绝、同user多tenant不串、教师范围不能CLASS↔COURSE自动推导。
- **Gate**：为Authorization提供server-verified CourseAccess/Relationship facts，DTO的isTeacher/enrolled不能授权；班级代码只是展示不能代替tenant FK。

### 2C — ActivityDefinition / version / publication / coursework definition

- **设计/实现**：按首发批准的活动类型冻结定义、素材引用、先修条件、可用窗口、发布/撤回、作业任务；published活动版本不可被普通编辑覆盖，Attempt固定版本。OpenMAIC资源通过1B9 mapping，不copy blob。
- **Tests**：draft学生不可读、owner/任教+scope组合、发布过程中asset失败不可partial publish、被引用版本/撤回、prerequisite cycle、activity不采用新增ACTIVITY Scope、跨tenant资源不能挂接。
- **Gate**：只启用通过对应0B的type；未验证Interactive/完整Playback按钮隐藏且服务端拒绝；不能宣称已迁移全部活动。

### 2D — Teacher authoring / controlled generation（能力条件）

- **前置**：D08/D09及公开editor/generation/asset合同；真实付费调用另批准。
- **步骤**：teacher use-case→AIServicePort/公开generation；draft review→schema校验→受控保存；公开editor只在supported scene范围；model/prompt/config provenance、预算、cancel、pending job与幂等；provider凭据只server。
- **Tests**：学生发起/role revoke后save拒绝、prompt injection不能获取tools/keys、超预算/失败/重试不重复扣费/发布、partial asset orphan、malformed output不进published、1.1.2网络边界。
- **Gate**：AI输出不直接授角色、完成学习或发成绩；生成UI流不是透传原生agent/SSE。同步小任务先做，确需durable jobs再review，不提前引入复杂队列。

### 2E — Directory / import / reusable integration

- **步骤**：先明确学校外部目录 source与学生/教工号用途；实现schema模板、staging preview/validate/approve/apply、批次sourceKey/checksum/幂等、冲突隔离、审计；对Spreadsheet/PPTX输入做大小/zip膨胀/外链/恶意内容验证。
- **Tests**：重复行/sourceKey、同名不合人、batch混入外tenant、csv formula export injection、失败/重放/批准过期、非原子跨context步骤保留可恢复状态。
- **Gate**：不把V1专用OUC字段写成通用身份模型；raw phone/password不出报告；不能硬删已被业务引用记录“回滚”；Node PPTX parser不从browser-only入口推断支持。现有生产数据导入只归DATA单元授权。

## 8. Phase 3 — Learning / Classroom runtime / Evidence

### 3A — Attempt + evidence contract / persistence（必须先于真实launch）

- **设计**：tenant/user/membership/enrollment/activityVersion/attempt绑定；LearningEvent闭集schema、trusted/server evaluated与client observed分级、eventId/idempotency/occurredAt/receivedAt/sourceVersion/provenance；attempt start/submit/complete/abort语义、重试次数与并发。
- **实现**：纯Domain与ports，append-oriented evidence、attempt CAS、outbox只在确需跨域异步时按事务设计引入；worker/service actor tenant明确；事件持久化与checkpoint/projection失败可恢复。
- **Tests**：重复event同payload幂等、同key不同payload冲突；late/out-of-order/重复投递、未知event/超大payload、客户端clock/spoofedcorrectness不可信；跨tenant/learner/attempt拒绝；append和attempt变化rollback。
- **Gate**：没定义证据合同不连接真实runtime；不可把scene navigation/agent transcript直接变成完成/成绩。

### 3B — ActivityRuntime / Classroom execution / dispatch

- **前置**：3A、1B9、对应能力0B；完整课堂需U01正式方案；Interactive需U02，未满足则仅实施已批准子集。
- **实现**：Zhiban ClassroomSession/Participant/Dispatch（区别Identity SessionId）及ActivityRuntimePort；launch重新检查user/tenant/membership/grant/enrollment/publication、服务器runtime句柄关联Attempt；短时受限handle、暂停/恢复/重连/close/cancel。
- **Tests**：issue后资格撤销/凭据变化、复制handle/URL、crosslearner、Teacher dispatch范围、重复launch/并发resume、断网/幂等、stream撤权停止、Runtime保存失败不宣称完成、映射orphan恢复。
- **Gate**：不暴露原生classroom page/agent API；不import Zustand/playback internals；明确最大撤权延迟与副作用停止点，不能overall“立即”但只关UI。

### 3C — Progress / completion / projection

- **步骤**：validate/normalize runtime evidence→LearningEvent→版本化progress/completion policy；projection checkpoint、重建/replay、纠错新event、query DTO；completion只接受policy要求的证据。
- **Tests**：同一证据多次投递不翻倍、process crash/restart、投影落后可说明、历史algorithm重建、completion重复/非法跳过先修、retake与旧attempt不覆盖、浏览器自报完成无效。
- **Gate**：Runtime snapshot≠业务Completion；读模型不当授权源；新的权限检查针对当前请求，而成绩历史/evidence保持其原来源。

### 3D — Submission / files / feedback foundation

- **步骤**：Course定义任务，Learning管Attempt/Submission版本，AssetPort管字节，Assessment后续评分；冻结deadline/timezone/late/重交/撤回规则；文件授权扫描/quarantine、上传限额、authorized download。
- **Tests**：客户端文件metadata欺骗、危险mime/路径、非本人的submission、两个submit竞态、超期边界、上传失败/asset失败不partial提交、批改后重交保留历史。
- **Gate**：attachment证据权限/保留责任明确；按批准规则实施malware检查，无生产扫描配置不能默默跳过；不引入未经评审的公网文件URL。

## 9. Phase 4 — Assessment / Grade / ConceptError

### 4A — Assessment definition / scoring / review

- **设计/实现**：rubric、题目/评分规则version、Submission/evidence引用、teacher scope/assignment、deterministic scoring contract；机器/AI建议与teacher审核分开；model输出validation/provenance。
- **Tests**：分数范围/权重/精度、rubric变更不回写历史attempt、同attempt重复评分幂等、非任教教师拒绝、成绩修改CAS/audit、算法重放、恶意prompt不能发布分数。
- **Gate**：通用机制不移植PLC/25Scene公式；AI不是成绩权威；离线fixture不冒充真实provider质量。

### 4B — Gradebook / publish / correction / appeal

- **设计/实现**：草稿评分与已发布成绩不同权限/生命周期；课程权重/缺考/重修/rounding规则先批准；发布不可变snapshot、修订/申诉/导出审计与最小学生可见性。
- **Tests**：学生不能读未发布/同班他人、Admin无默认改分、两老师并发publish/correct、撤权后publish拒绝、批量partial失败、历史版本/审计与source证据对账、导出无跨tenant/公式注入。
- **Gate**：人工评分闭环足以验R1；AI diagnosis/profile不作为R1发布前置，除非release明确要求。

### 4C — ConceptError / diagnostic evidence

- **步骤**：课程concept taxonomy、诊断算法/规则版本、证据门槛、置信度/不足证据unknown、人工确认/纠错/关闭；给Intervention输出安全引用。
- **Tests**：相同输入可复现、无证据不标签、过期rubric/模型结果隔离、误判纠错保留历史、跨课程概念不会字符串碰巧匹配、学习者隐私scope。
- **Gate**：领域模型不把“AI说有错误”视为确定事实；产品概念分类及使用目的先批准。

## 10. Phase 5 — Portal / read models / R1 closed loop

### 5A — Shared Portal shell + authorized queries

- **步骤**：Zhiban layout/navigation、authenticatedUser+请求tenant候选、capability DTO、pagination/read模型、空/错误/加载/禁用/过期状态、i18n/accessibility；server查询tenant/scopes受保护，不读repositories或OpenMAICstore捷径。
- **Tests**：直接URL/API与按钮同安全、role change后的fresh导航/后端deny、缓存tenant key、logout与多tab、不能从UI快照授权限。
- **Gate**：原生OpenMAIC首页/编辑页不是业务Portal；每个功能页仅消费已签收用例；可分垂直切片演示，但仍逐角色终验。

### 5B — Admin Portal

- **功能**：当前Tenant成员/批准邀请/role委派/停用恢复；Course/Term/Class/Enrollment/import preview、审计；control-plane独立导航/授权。
- **Tests**：最后管理员/ceiling/restore审批、bulk/export跨tenant、不能读hash/digest/全球人员目录、不能用租户admin改全局密码/教学成绩、destructive confirmation/版本冲突展示。
- **Gate**：admin运营权≠所有教学详情；依赖2E的页面未完成时明确禁用，不做“成功”假接口。

### 5C — Teacher Portal

- **功能**：课程/班级/学生范围、受支持authoring/publication、dispatch、作业反馈/评分发布、基础班级progress/grade查询；高级analytics/profile/risk按6系签收逐步接入。
- **Tests**：只任教Course/Class、scope+关系、撤权后save/grade/dispatch拒绝；E2E建draft→publish→学生提交→teachergrade；真实资源gateway而非mock iframe。
- **Gate**：页面不移植V1 service/registry；不可因为TEACHER角色放开其他班级学生明细。

### 5D — Student Portal / R1 acceptance

- **功能**：已选课/已发布活动、受支持runtime、attempt/progress/submission、本人已发布成绩、账号/session与空间切换；个人profile/support后续6系接入。
- **验收旅程**：两个tenant、同tenant两个学生与两名不同授课教师；admin开课/开班/enroll→teacherpublish→studentlaunch/submit→teachergrade/publish→studentread；同时负例跨tenant/跨student/撤权/禁用/断网/retry。
- **Gate**：E2E、真实PG、build与上下游compat全部通过；R1 manifest中的必需能力不可skip；教学闭环可用不等于完整V1迁移完成或生产授权。

## 11. Phase 6 — Profile / Intervention / Analytics / Notifications

### 6A — LearnerProfile design / projection / governance

- **读取/决策**：V1 calculator实际只有 engagement/completion/achievement/collaboration/selfDirection五维，不能把UI“六维”当已定义第六维。由人批准目标维度/证据、缺失值、confidence、用途及可见范围。
- **实现**：版本化算法/evidence snapshot/window、可重建投影、人工纠错记录、本人/教师必要查询；不直接读取另域私有数据库，不回写成绩。
- **Tests**：replay一致、算法版本迁移、无证据unknown、迟到/重复event、修正审计、越权读取、PII最小化；画像不是诊断/选拔权威。
- **Gate**：先规则/确定性baseline，再批准模型增强；模型新增依赖不擅自换定义。

### 6B — Remediation / monitor / risk workflow

- **实现**：ConceptError/Profile引用→可解释RiskSignal/InterventionCase/RemediationPlan、teacher reviewed action、notification与outcome；prerequisite/活动推荐不绑定机电竞赛registry。
- **Tests**：重复触发不重复case、已关闭不自动复活、阈值版本/解释/false-positive、无人处理升级/失败通知、学习者隐私、cancel/revoke、SLA与audit。
- **Gate**：普通teacher/tenantadmin不默认获得敏感risk全部访问；Risk Reviewer/Researcher 若需要新角色，先单独ADR，不扩展Phase1冻结RoleCode假装兼容。

### 6C — Teacher analytics / dashboards / exports

- **实现**：Learning/Assessment/Profile经批准事件构建可重算read模型；指标definition/version/分母/窗口/timezone、freshness；聚合与个人明细分权限，导出job tenant绑定。
- **Tests**：同名不同tenant、small group privacy、分页计数/导出一致、迟到重建、重复事件不重复统计、下载前重新授权、临时文件expiry。
- **Gate**：统计口径冻结与数据对账后接入5C/5D；不以旧SQL报表直接为V2权威。

### 6D — Notification / durable work minimum

- **设计/实现**：只为已批准case/job需要引入outbox、consumer幂等、lease/fencing、重试上限/DLQ/取消；NotificationPort channels/用户偏好、授权、secret redaction、审计。若6B已先需要则本单元依赖提前执行，不假等编号。
- **Tests**：commit后crash消息不丢、重复消费不重复业务副作用、lease失效worker不能commit、跨tenant job拒绝、通知失败不伪称成功、敏感数据不进payload/email。
- **Gate**：exactly-once通常由幂等效果实现，不宣称跨系统消息天然exactly-once；provider/费用/渠道配置须单独批准。

## 12. Phase 7 — 扩展业务与 OpenMAIC 完整能力

这些单元在完整路线中明确保留；是否列入某次release由产品审批决定。每项必须有独立 DESIGN，不“顺手搬过去”。

### 7A — Full Classroom / Playback host（U01）

- 重新核查固定上游公开契约；若仍缺失，提出上游扩展或单独自建有限引擎ADR供人批准，不import/复制私有store/playback。
- 获批契约后重复0B D05、D07及关联Asset/Runtime；multi-scene、Action支持集、audio时序、pause/resume/cancel/reconnect/Quiz/PBL和资源授权；两版本fixture compatibility。
- Gate：每一种支持Action/Scene明确；未支持fail closed；完成该单元后才能把3B/Portal标为“完整OpenMAIC课堂”，不能把slide canvas包装称迁移完成。

### 7B — Interactive host / VirtualLab（U02）

- 先批准正式versioned host/bridge与独立origin/sandbox/CSP/resource policy；source+origin+nonce/channel+instance+document/scene/attempt绑定；浏览器消息仍是不可信观察。
- VirtualLab拥有Attempt/action/measurement/hint/evaluation及server规则，OpenMAIC只执行内容；scenario/plugin支持contract，不把MECH_*、PLC规则、单一line-stop模拟器写入核心。
- Tests：兄弟iframe/伪造origin/source/旧instance/replay、外连/parent权限/越权asset、撤销销毁、恶意HTML、断网恢复、评估与输入篡改、host版本兼容；无正式host不运行任意HTML。

### 7C — PBL / collaboration

- 先对比当前公开PBL kernel与V1项目流程，批准project/group ownership、协作参与/teacherapproval、评分分配；group不是新SYSTEM/PROJECT Scope捷径。
- 实现project attempt、事件证据、协作命令CAS/幂等与任务授权；执行UI/runtime依赖U01或批准方案，纯kernel不能当完整PBL产品。
- Tests：成员退出后的操作、交叉group数据、并发分工/提交、同一evidence不重复得分、个人与组成绩版本、peer evidence不可伪造；权限扩展先ADR。

### 7D — AI Tutor / support modes / teacher assistants

- 通过AIServicePort批准具体use-case、课程/资料权限、retrieval scope、token/预算、context minimization、provenance、structured outcomes、人类审核与safe fallback；不接原生通用agent/tool路由。
- Tests：prompt/tool injection、检索越tenant、错误引用、学生取答案边界、role revoke中断、个人消息隐私、超预算/模型故障、复制providersecret、重试任务幂等。
- Gate：真实模型eval/red-team必须另批预算，fake/unit不能证明教学质量；AI建议不直接publishGrade/风险诊断。

### 7E — EMA / model-analysis jobs

- 先批准EMA全称/产品用途、合法输入/结果、模型/算法版本、与Profile/Analytics/Intervention的归属及retention。名称或V1 endpoint不能替代规格。
- 实现经批准的analysis snapshot/job lifecycle、lease/idempotency/cancel/result validation，消费最小evidence；与6D机制复用，不建另一worker framework。
- Tests：输入版本/provenance、重复任务、stale lease结果拒绝、授权撤销、失败分类与DLQ、输出含敏感数据拒绝、algorithm可回放。定义未关闭则 BLOCKED_BY_PRODUCT_DECISION。

### 7F — AI Peer（高风险、单独批准）

- 必须先明确非临床边界、数据处理/隐私/保留、危机升级真实责任人和联络渠道、age/consent适用策略；不新增心理风险角色/自动医疗判断。
- 若批准，实施受限support conversation、最小知识上下文、人工升级、安全fallback/kill switch；真实评测由负责方制定通过阈值。
- Tests：危机场景、错误安慰/危险建议、敏感日志、跨user消息、无人接管/通知故障、滥用/成本、删除保留与申诉；没有实际升级渠道就不开放，而不是复制V1关键词规则声称安全。

## 13. V1 能力全量追踪（36项不得丢项）

| V1 # / 能力 | 当前路线 | 处理与完成判据 |
| --- | --- | --- |
| 1 身份认证 | 已有1B5/6 + 1B8 | 重新实现；HTTP/恢复/审批另验收 |
| 2 Tenant | 已有1B1–4 + 1B7/8 | 保留概念；请求授权/DB隔离不互替 |
| 3 RBAC | 1B7/8 | 重写Policy与操作；同grant scope+permission |
| 4 Student体验 | 5D | 重写UI，真实垂直journey |
| 5 Teacher体验 | 5C | 重写UI，仅任教范围 |
| 6 Admin控制台 | 5B + 1B8 | 租户/控制面分离 |
| 7 Academic organization | 2A/2B/2E | Term/必要组织元数据；复杂组织树未批准则延期 |
| 8 Course | 2A | 领域/版本/授权/CAS |
| 9 AdministrativeClass | 2B | 行政班独立于教学班 |
| 10 Offering/TeachingClass | 2B | 学期授课、任教、容量 |
| 11 Enrollment | 2B | 资格/退出/并发席位，launch撤销 |
| 12 Activity/content | 2C/2D | 定义/发布version + opaque mapping |
| 13 Scene orchestration | 2C/3B/7A | 抽取先修/教学要求；不搬25Scene registry |
| 14 Classroom | 3B/7A | 业务session/dispatch +正式execution host |
| 15 PBL | 7C | REVIEW后批准project/collaboration能力 |
| 16 Interactive HTML | 7B | ADAPT，仅通过U02 Gate后运行 |
| 17 LearningEvent | 3A/3C | 重写闭集证据/provenance/idempotency |
| 18 Attempt/progress/completion | 3A/3C | Zhiban lifecycle/policy，不等于runtime状态 |
| 19 Assessment | 4A | rubric/version/证据/人工复核 |
| 20 ConceptError | 4C | 有证据与纠错的诊断生命周期 |
| 21 LearnerProfile | 6A | 版本化投影、解释、纠错 |
| 22 Six-Dimension Profile | 6A DESIGN | REVIEW；五维事实与第六维定义先澄清 |
| 23 Remediation | 6B | 通用plan，不绑定竞赛scene |
| 24 Risk | 6B | 治理、最小隐私、人工workflow |
| 25 Grade | 4B | 发布/修订/申诉/导出 |
| 26 EMA | 7E | REVIEW；先定义后实现 |
| 27 VirtualLab | 7B | Attempt/protocol/evaluation +正式host |
| 28 AI Tutor | 7D | 受控AIServicePort+评测 |
| 29 AI Peer | 7F | REVIEW；独立安全责任/批准 |
| 30 Agent support modes | 2D/7D | 受控use-case，不开放通用agent |
| 31 Teacher analytics | 6C/5C | 版本化read模型/权限/对账 |
| 32 Student dashboard | 5D/6C | 本人数据投影，无SQL/store直读 |
| 33 Admin import/directory | 2E/5B | staging/审批/幂等/source mapping |
| 34 Monitoring/intervention | 6B/6D | case/action/SLA/notification闭环 |
| 35 Coursework/files | 2C/3D/4A/B | 定义/提交/受控文件/评分分域 |
| 36 Competition mechatronics | REMOVE_FROM_CORE | 仅档案/requirements/fixtures；若需课程包另批准，不能作为平台内置迁移 |

全量迁移完成 = 每个KEEP/REWRITE/ADAPT能力有验收证据；每个REVIEW有明确批准实现、批准延期或批准移除；REMOVE有批准归档记录。不能“有页面/有表/接口200”就标完成，不能按V1文件数量衡量覆盖率。

## 14. DATA — 真实数据迁移（单独授权）

### DATA-A — Read-only inventory / transformation design

- **前置**：明确批准数据源、字段、只读账号、脱敏方式、访问时间和负责人。开发目录schema/code不证明生产migration已应用；不读真实hash/PII进聊天。
- **输出**：实际schema版本、source计数/唯一冲突/孤立FK/状态/资源引用，字段分类DIRECT/TRANSFORM/MAP/REGENERATE/DO_NOT_MIGRATE/UNKNOWN；manifest/sourceKey/checksum/映射审批；Person去重不因姓名/手机号自动合并。
- **Identity特殊规则**：新canonical IDs，旧ID只作source mapping；STUDENT/TEACHER+scope重映射，Admin最小审批，SYSTEM_ADMIN绝不自动继承；globalUser与Membership停用语义拆分；Session/reset/accesscode/匿名owner不迁。
- **Credential**：仅经单独批准验证真实编码/参数/provider兼容；不兼容走reset/verification，不截断PHC或降低Argon2；弱初始密码不迁。手机号重新加密/索引与密钥权限另审。
- **Gate**：UNKNOWN冲突有隔离/拒绝清单，不静默改名/合人/扩权；审计原actor/source不改写成新actor；历史AI标签不自动变V2可信诊断。

### DATA-B — Synthetic/de-identified rehearsal / idempotent importer

- 先合成数据再经批准的脱敏snapshot；按Tenant/User→Membership→批准grants→Term/Course/Class/Enrollment→published activity/受控resources→attempt/evidence/submission→grade→可验证projection/审计references分批。
- OpenMAIC旧资源只有authority明确才能mapping，不能接收anonymouscookie当证据；失败资源进入quarantine/broken reference，不能学生可读。
- Tests：重复导入no duplicate、source checksum变化冲突、batch中断恢复、跨context补偿、记录数量/关系/金额或分数对账、双tenant负例、secret-free报告、restore备份实际演练。
- Gate：mapping schema/ledger在本轮前独立review；V1 migration SQL不搬到V2；部分失败不得全批绿色。

### DATA-C — Approved production extraction / cutover data plan

- **前置**：OPS readiness、approved release manifest、真实数据访问与迁移窗口、备份恢复、写入/维护或delta capture方案、人工签收；不是本文授权。
- **步骤**：版本化只读extract→checksum/signoff→V2独立import→对账→安全验证→批准入口切换。delta策略先定义，禁止未经设计的双写；同一cutover重复执行安全。
- **回退**：停用新入口/处理已产生新数据/明确同步或补偿；不能在V2已写入后直接切V1而忽略数据，不drop库、不reset代码当数据库回滚。
- **Gate**：每批source manifest、冲突清单、count/relationship/grade/resource对账通过；V1保持不修改，任何必要V1操作须单独改变隔离授权。

## 15. OPS — E2E / Staging / Production

### OPS-A — Deployable host / observability / security hardening

- 先DESIGN公开Zhiban host如何不装载原生routes：在现有仓库构建范围/批准独立host方案内实现，不靠隐藏按钮或泛型反代。ADR-013/014若需新topology，先ADR批准，不改core补权限。
- 锁定Node22/Linux/PG16/依赖与releaseSHA、owner/migrator/runtime凭据隔离、corpus/限速/session/CSRF/origin配置、object storage/cache egress、TLS/securecookie、provider final URL、APM/SQL日志redaction。
- 定义健康/就绪、request correlation（不带token）、audit完整性、job告警、备份restore、retention/孤儿清理；清理worker也需要scope/幂等，不是级联删除捷径。
- Gate：从外部实际测原生Web/route/action/字节存储不可达；private network不是业务权限替代；配置缺失相关能力fail closed。没有budget/容量/RPO/RTO批准，不编造“生产可用”。

### OPS-B — Full-system synthetic E2E / performance / resilience

- journeys覆盖Admin/Teacher/Student及全部release必需高级功能；两tenant、同tenant横向隔离、撤权/停用/恢复、密码变更、最后admin、deadline/时区、旧handle/stream、批量/export/cache。
- 按实际 release 验证 DB/byte/provider/job 失效、网络中断、部分副作用、重复消息、snapshot restore、迁移 no-op/checksum；相关竞态用真实 PG；build/browser/render/container 按启用部署范围检查，不默认无关全套两遍。
- 达到事先批准的容量/延迟/错误预算，测KDF admission与成本；不能以降低安全参数/skip降低gate。
- Gate：无未解释失败/关键skip；artifact/config/SHA完全可追溯。功能覆盖和安全覆盖分别签收。

### OPS-C — Staging / pilot / UAT

- 经授权使用隔离staging、合成/批准脱敏数据、批准付费provider及限额，演练部署/migration/备份restore/渠道/取消/故障回退；受限试点名单、支持SLA、privacy负责人。
- 人工UAT确认课程/教学规则、评分/申诉、profile/risk/AI建议边界、导入对账、accessibility；记录接受/拒绝和例外，不能仅CI绿色。
- Gate：冻结release artifact与配置manifest；批准试点不授权全量生产数据，也不表示REVIEW功能已迁移。

### OPS-D — Production switch / post-cutover freeze

- 单独批准窗口/负责人/回退阈值、完成DATA-C；部署同一signed-off artifact，migration明确operator步骤而非startupDDL；切公开入口/密钥/配置按runbook。
- 窗口内核验登录、权限/租户、发布/学习/提交/成绩、资源、监控/审计与对账；观察到触发阈值执行批准回退，不猜测修生产。
- 输出最终迁移manifest、当前upstreampin、所有单元signoff、数据/资源/权限对账、遗留批准项、后续维护/同步责任。全量完成才写FULL_MIGRATION_COMPLETE；试点写PILOT_ONLY。

## 16. 可直接交给 Codex 的任务模板

### 功能交付模板

```text
项目：/home/zxm/openmaic/zhiban
BRANCH：refactor/zhiban-v2
EXPECTED_HEAD：<当前已核验 HEAD>
WORK_PACKAGE：<M1–M7 中的一条实际功能旅程>
权威计划：docs/v2/zhiban-v2-delivery-plan.md
执行方式：必要设计、实现、相关本地验证和短记录同周期完成。
NO COMMIT / NO PUSH / NO CI DISPATCH / NO PRODUCTION DATA / NO DEPLOYMENT。
只完成本次用户授权工作包。

1. 核验 branch/HEAD/status，读取适用 AGENTS 与相关冻结设计。
   保留用户变更；同一工作包已知 docs/实现增量无需先另做 checkpoint。
2. 复用当前已实现资产，只列实际缺口和需要决定的 schema/权限/业务规则。
3. 决定项集中明确后做后端、页面、运行接线；普通缺陷当轮修复。
4. 按影响验证：真实旅程、相关测试/依赖回归；必要 ACL/事务用本地 PG16。
   不默认全套两轮、不默认 GitHub、不为改文档跑大测试。
5. 不伪造业务事实、批准材料或生产授权，不修改已应用 migrations。
6. 交付可启动/可使用的功能，记录实际 LOCAL 结果、限制与下一个功能。
```

Checkpoint 使用实际 reviewed 文件集合；获授权才 commit/push，正常核验 parent/message/SHA/CLEAN/remote。文件未改变且本地验证仍适用时不在 checkpoint 重新测试。GitHub signoff 是可选任务，不要求每个 checkpoint 后追加。

### 当前下一工作包

2026-10-14 当前覆盖：用户要求回到产品交付，已完成 [M5-C PNG 本地闭环](zhiban-v2-m5-c-png.md)：上传/选择/保存/不可变发布/学生显示及资源 gateway，真实 disposable PG16 与公开 provider/HTTPS UI 验收；新 migration 0002 使用独立 PNG ledger，真实55433未升级。A/B 历史本地成果保留，C 的新源码和证据独立绑定。维护恢复/observer 独立复评与真实输入保持待办和隔离，**不再作为 PNG 或独立 M6 产品开发的默认前置队列**。下一产品工作包为 M6 首个教师统计页面；D Runtime/E AI、完整 enabled gate 和生产 OPS 仍 deferred。以下长段落保留此前维护接续历史，不能覆盖此新产品顺序。


M1–M4 已完成本地功能，M5-A/B installer、技术 receipt issuer/loader 与文本编辑发布闭环已 `LOCAL_VERIFIED / UNCOMMITTED_CANDIDATE`，见 [M5 本地交付](zhiban-v2-m5-ab-local-closeout.md)。开发 PG16 55433 上显式安装，独立 Native DB，运行时无 DDL；原始 55432 测试 cluster 不变。文本产品 19/19、启用相关负向 25/25、撤权屏障 26/26、installer 5/5，受影响 M1–M4 回归通过；均 LOCAL，无新增 GitHub CI。

installer/receipt/enabled content composition 已完成[独立复评](zhiban-v2-m5-installer-enabled-review.md)，发现的四项 P2 均已修复，剩余 role/Membership/User/owner/Session/Credential/教学关系撤权屏障已补齐。本轮已按用户选择完成 [UNKNOWN/RESERVED 只读对账报告](zhiban-v2-m5-readonly-reconciliation.md)，LOCAL 20/20 与 host 冒烟 5/5；Native 仅公开 scoped manifest，内容摘要不冒充已证明，所有隔离保持。只读评审 R1/R2 已修复并 LOCAL 9/9；[终态授权、审计与并发屏障精确设计](zhiban-v2-m5-terminal-reconciliation-design.md)已完成 R2 修订，TR-01–03 为 ADDRESSED_IN_DESIGN，见[修订核对](zhiban-v2-m5-terminal-reconciliation-review.md)。[未应用 SQL/helper/ACL/receipt 与恢复计划候选](zhiban-v2-m5-terminal-candidate-inventory.md)已产出，静态 9 组 PASS，运行验收 NOT_RUN。[SQL/profile 初版评审](zhiban-v2-m5-terminal-sql-review.md)的三项 P2 已完成 [R3 候选修复](zhiban-v2-m5-terminal-sql-r3-fix-local.md)，静态 12 组及独立临时 PG16 26/26 PASS，证据仅覆盖定向 fixture。[R3 定向复评](zhiban-v2-m5-terminal-r3-review.md)已关闭原三项 P2，另有一项 P3 签发故障用例需补；已补该用例并完成[签名 expected / blocked installer / loader 接线](zhiban-v2-m5-terminal-installer-wiring.md)，scoped 临时 PG16 42/42、静态 13 组 PASS；已完成[签发权限/部分失败/loader 评审及真实 Native 参考准备](zhiban-v2-m5-terminal-installer-review.md)，三个 P2 OPEN，独立 PG16 11/11 定向检查包含问题复现；实际 Native 为 11 表/23 索引，未签名参考因 PUBLIC CONNECT 标记 BLOCKED，技术 broker 候选未接真实维护。已完成[TI-01–03 修复与恢复观测接线](zhiban-v2-m5-terminal-ti-fix-local.md)，候选 PG16 50/50、真实 Native 13/13、静态 13 组 PASS；参考 UNSIGNED_REVIEW_REQUIRED，新增 partial broker、受限 ACK 查询及 --install-blocked-hold 同进程连接交接，未应用到现有 cluster。已完成[维护控制执行器与增量复评](zhiban-v2-m5-terminal-maintenance-local.md)：维护锁/启动阻断、HBA/SCRAM轮换、正常/接管/恢复执行候选，独立PG16 18/18、原定向回归50/50、真实Native参考13/13、静态13组PASS；新launcher来源绑定使旧产品receipt不能签收新源码，真实库/凭据/receipt未变。已完成[维护边界复评与CLOSED ACK查证](zhiban-v2-m5-terminal-closed-ack-review.md)：三项P2修复，新增controller精确只读helper及隔离bootstrap入口；正常CLOSED也保留启动flag，凭据交付未签收。LOCAL维护30/30、回归50/50、真实Native13/13、静态14组；未应用0002 aggregate随新增helper/ACL更新，已应用migration不变。已形成[凭据/host build/receipt交付与独立清旗精确设计](zhiban-v2-m5-handoff-clear-design.md)：不可变release、精确TCP/SCRAM普通profile、独立clear批准、常驻签名gate原子切换及故障矩阵；DESIGN_ONLY / NOT_IMPLEMENTED，来源hash不变。已完成[handoff定向复评与未应用候选](zhiban-v2-m5-handoff-candidate-review.md)：R2修订依赖/原生ABI闭包、限域REGISTERED→ACTIVE读取授权、namespace覆盖与clear控制COMMIT；新zhiban_handoff独立ledger保留terminal0002/hash。临时PG16 12/12、静态7组PASS，仅局部候选；真实builder/seeders/issuer/loader/publisher未接线、模板UNISSUED。已完成[handoff SQL/profile与owner边界R3复评及控制交付执行器接线](zhiban-v2-m5-handoff-executor-review.md)：初始状态/原子控制审计、完整role inventory、最新deployment activation、固定双库owner/nonrotating bootstrap、单次permit/pointer/控制COMMIT/gate publisher/限权ACK与控制loader候选；局部LOCAL PG16执行器23/23、受影响回归12/12及静态10组PASS，精确最终来源见R3报告。真实产品builder/物理依赖闭包/validation child/兼容receipt/TCP-HBA/普通supervisor仍未接，真实模板UNISSUED。下一工作包复评新控制执行器及部分封存/发布/loader边界，再实现真实不可变builder、actual validation child和独立ordinary shadow expected；公共Native proof worker仍待接线；完整终态仍待完成；写入结算/解除隔离仍 deferred；C PNG、D Runtime、E AI、生产 OPS/DATA 保持 deferred。完整 enabled gate 模板仍 UNISSUED，技术安装 receipt 不产生生产或整期签收。不自动 commit/push/dispatch。

### 后续上游同步维护规则

固定已签收 release 作为每个开发/发布周期的 OpenMAIC pin；不因上游持续变化反复推倒已完成的业务单元。安全更新单独分支单独验收，不将 fork 的移动 main 误认为官方 release。

每次升级：核对 THU-MAIC 官方 tag/release SHA 与行为变化 → 建立受控 sync 分支 → 审计 core/package/schema/protocol/持久fixture差异 → 本地跑相关 package/Storage PG/Identity/业务回归、Adapter 新旧兼容与实际 host 负例 → 人工接受 → 合入 V2。确需远端环境/协作复核时再授权对应 CI，不机械重复本地证明。第三方 fork 独有功能、自动依赖更新和 core 修改不搭车。正式 export 的新增仍需对应能力验收。

协议/schema不兼容、fixture读写差异、主体/owner语义变化必须先ADR/补偿设计，不能为merge成功放宽授权。生产数据库回退和代码回退分开批准。

## 17. 当前执行 ledger

| Unit | 状态 | 证据 / 下一动作 |
| --- | --- | --- |
| 官方1.1.2受控同步 | MERGED / CI_SIGNED_OFF | 起点SHA及第1节三个run；DOC-01 已补充最终文档证据 |
| Identity 至 1B-8E | FOUNDATION_COMPLETE | 对应 1B-1–8E closeout；后续复用，生产运行/恢复配置仍有其门禁 |
| 0B / 1B-9B | COMPLETE_FOR_APPROVED_FOUNDATION | 对应 closeout；完整课堂与真实资源授权仍按启用能力验收 |
| 1B-9C | COMPLETE_FOR_APPROVED_CONTRACT_FOUNDATION | 实现候选 0239ef66…，closeout daf63afa…；Identity 37646908710 / Storage 37646937823；不重跑 |
| 2026-10-08 执行重排 | LOCAL_FIRST_POLICY / MILESTONES_PROPOSED | 本地验收有效；CI 可选；M1–M7 顺序及业务建议见交付计划 |
| M1 | LOCAL_VERIFIED / UNCOMMITTED_CANDIDATE | 独立开发 PG16/受信任 localhost HTTPS；18 实际场景通过；见 M1 记录 |
| M2 | LOCAL_VERIFIED / UNCOMMITTED_CANDIDATE | 管理员管理课程/班级/Enrollment，教师及学生实际页面；20 组实际场景及并发认证/受影响回归通过；见 M2 记录 |
| M3 | LOCAL_VERIFIED / UNCOMMITTED_CANDIDATE | 教师可配置文字活动/版本发布，学生 Attempt 与版本化提交；26 实际场景、重启持久化、32 定向测试及 M2 20 场景回归通过；见 M3 记录 |
| M4 | LOCAL_VERIFIED / UNCOMMITTED_CANDIDATE | 基于不可变 Submission 的人工评分、显式发布与留痕更正；LOCAL 验收及 deferred 规则见 [M4 记录](zhiban-v2-m4-assessment.md) |
| M5 | A/B_LOCAL_VERIFIED / UNCOMMITTED_CANDIDATE | 本地 installer/技术 receipt 与真实 Native 文本编辑发布；产品 19/19、安全负向 25/25、撤权屏障 26/26、installer 5/5；[独立复评](zhiban-v2-m5-installer-enabled-review.md)，M1–M4 既有回归；[交付与精确证据边界](zhiban-v2-m5-ab-local-closeout.md)。只读对账报告已 LOCAL 20/20 / host 5/5，见 [设计与证据](zhiban-v2-m5-readonly-reconciliation.md)；完整 enabled gate、终态 reconciliation / fence resolution、C PNG/D Runtime/E AI deferred |
| M5-C | LOCAL_VERIFIED_DISPOSABLE_PRODUCT / UNCOMMITTED_CANDIDATE | PNG 编辑发布与当前授权字节出口；隔离 PG16/Native/HTTPS 浏览器闭环，见 [M5-C 记录](zhiban-v2-m5-c-png.md)。真实55433安装、独立维护/清旗和全量enabled gate未签收；下一产品为M6教师统计 |
| V1真实数据 / 生产部署 | NOT_AUTHORIZED | DATA/OPS各单元单独授权 |

FOUNDATION_IMPLEMENTATION: COMPLETE_WITH_BOUNDED_CLOSEOUTS

BUSINESS_MILESTONE_IMPLEMENTATION: M1_M2_M3_M4_M5_ABC_LOCAL_VERIFIED_UNCOMMITTED

CURRENT_NEXT_WORK_PACKAGE: M6_TEACHER_ANALYTICS_PRODUCT_SLICE

DEFAULT_VALIDATION: LOCAL_AFFECTED_SCOPE

GITHUB_CI: OPTIONAL_WITH_EXPLICIT_PURPOSE_AND_AUTHORIZATION

COMMIT: NO

PUSH: NO

M5 最新接续（2026-10-13）：已接[独立同代 receipt issuer、TLS 与普通 HTTPS launcher](zhiban-v2-m5-issuer-https-local.md)，承接实际 builder/validation child。独立 reviewer、固定根单次 permit、完成组签名防部分签发消费；真实普通 child 继承共享维护锁，固定 HTTPS 入口、受信 CA 握手和撤权/漂移停机在独立56496 PG16验收。真实55432/55433、私有凭据、CA信任库及门均未操作。真实 ordinary expected/shadow/管理transport批准与凭据/HBA/CA交付、完整enabled gate仍deferred。下一工作包为本轮签发完成组、监督进程退出及实际交付输入的定向复评；不自动commit/push/CI dispatch。

M5 本次定向复评（2026-10-13）：[完成组/进程退出复评](zhiban-v2-m5-completion-exit-review.md)发现并复现R1（supervisor idle PG关闭可无限等待并持锁）与R2（master/sidecar后段写入失败的组消费和结果分类不一致），候选运行源码/inventory未改，真实交付未就绪。[真实交付输入清单](zhiban-v2-m5-real-delivery-inputs.md)仅INPUTS_PENDING，不授权真实操作；下一步先修复两项、补切点验证/更新hash，再准备实际输入与分阶段具体授权。旧25/23/15及CI证据保留原范围。

M5 R6（2026-10-13）：[完成组/退出修复与元数据](zhiban-v2-m5-completion-exit-fix-local.md)已LOCAL 22/29/23/17，canonical master统一消费、提交后ACK未知只读查证、确认child/本地PG关闭后释放fd。用户限定“先收集无凭据元数据”，已观察工具/目录/pg_control/监听：真实55433为shut down，无自动启动/连接；[清单](zhiban-v2-m5-real-delivery-inputs.md)仍待运行中SQL/凭据staging/独立authority输入。下一步定向复评修复，再明确受控启动/只读采集范围；NO COMMIT/PUSH/CI。

M5 R6 接续复评（2026-10-13）：[定向复评](zhiban-v2-m5-r6-directed-review.md)未发现新增阻断项，补实际supervisor的退出未确认持锁用例LOCAL 1/1；原R6 22/29/23/17保留原来源和范围，运行代码及inventory未改。[受控启动与只读采集方案](zhiban-v2-m5-readonly-startup-plan.md)及独立未执行附件已准备，离线静态9组PASS/11条SQL；仅计划私有管理socket、精确SCRAM/HBA、管理库READ ONLY和绑定启动/停止生命周期，不授普通流量或清旗。真实认证/config/guard/staging输入未读、未启动或连接真实cluster，执行器尚未实现。下一步实现管理观察执行器并在disposable PG16验收生命周期故障，再提出具体真实授权包；NO COMMIT/PUSH/CI。

M5 管理观察执行器（2026-10-13）：[执行器与真实授权准备](zhiban-v2-m5-management-observer-local.md)已LOCAL PG16 33/33、静态11组/11SQL，observer inventory e776806ccc2465de7d845a8525416c0f80ab49d39c9cd0d8cdf3b168cae66030；R6与migration hash保持。闭合外部签名/source/target/TTL/单次permit、同根既有锁/门、配置与认证staging、精确启动/只读采集/停止；独立custodian在SIGKILL/断IPC/审计写失败后保持锁。修复PID-file MyStartTime与SQL PgStartTime错误同值假设，以采集前后实际进程tuple绑定；真实目录/认证/HBA/config/guard均未读写或启动。[未签实际输入包](evidence/m5-management-observer-real-authorization-packet.json)绑定已知source/public binary hash，真实control/auth/authority/config摘要仍null，INCOMPLETE_UNSIGNED_PACKET，不授执行。下一步定向复评签名权限、custody/部分失败、配置闭包与真实预审输入；NO COMMIT/PUSH/CI。

M5 observer定向复评（2026-10-14）：[评审报告](zhiban-v2-m5-management-observer-review.md)为CHANGES_REQUIRED，OR-01–04四项P2已在独立56497 PG16复现：释放ACK丢失后UNKNOWN不持续持锁、audit短写误签收、pgpass消费字节漂移、include落入普通GUC使闭包不完整。四项REPRODUCED及哨兵不变，共5个局部断言检查；原33/33/静态11及CI保留原范围，不覆盖新增切点。observer/R6/migration hash未改，真实target/config/凭据/guard未操作。[未签输入更新](evidence/m5-management-observer-real-inputs-review-r1.json)记录用户“保留待补”，实际control/auth/authority/摘要仍null。下一步先定释放终态/custody，再修四项并更新局部来源/证据；NO COMMIT/PUSH/CI。

M5 observer四项修复（2026-10-14）：[终态与本地验收](zhiban-v2-m5-observer-or-fix-local.md)已ADDRESSED_LOCAL，独立PG16 51/51、静态12组/11SQL；新observer inventory447a2b38dfc4692fea08fe75c3bc191234dbfecce8771fa8c82c8285a4ec0869，精确设计另绑定。PG stop/guardian实际离开/全局release/结果ACK分离，永久hold与resident父防迟退出掉锁；完整UTF-8审计、明确私有0400认证快照/清理、include分类拒绝修复。R6/migration hash不变，旧33/11/REPRODUCED及CI各保留来源。[未签真实包](evidence/m5-management-observer-real-inputs-or-fixed.json)保持“保留待补”与null，不读取/启动真实target。下一步复评本地离开授权、永久hold/迟退出/resident、认证快照及源/清理边界；NO COMMIT/PUSH/CI。

M5-C 产品接续（2026-10-14）：[PNG 闭环](zhiban-v2-m5-c-png.md)已完成，保持 LOCAL/真实环境来源标记，未提交/推送/CI。产品主线从维护复评队列移回 M6；维护候选及用户“保留待补”输入继续单独隔离，不宣称已交付。

M6 教师统计首个页面（2026-10-15）：[口径、页面与本地证据](zhiban-v2-m6-teacher-analytics.md)。按当前 Enrollment/精确发布活动/最新 Attempt 与 Submission/最新不可变人工评分聚合，含工作台入口、活动切换和名单筛选；无需 migration/新 ACL。产品后续推进学生个人概览。维护真实输入继续“保留待补”，冻结门禁与隔离不变；NO COMMIT/PUSH/CI。

M6 学生个人概览（2026-10-15）：[页面、口径及 LOCAL 证据](zhiban-v2-m6-student-overview.md)已完成，学生工作台可查看本人当前活动、最新尝试/提交、不可变评分发布、公开反馈与版本化历史；退班/未来 Enrollment/会话退出拒绝访问。真实 PG16/HTTPS 16/16、相关回归 48/48，定向类型/ESLint 通过；无新增 migration/ACL，无 55432/55433 或维护隔离变更。下一建议管理员受控名册导入；NO COMMIT/PUSH/CI。

M6 管理员受控名册导入（2026-10-15）：[页面、约束与 LOCAL 证据](zhiban-v2-m6-roster-import.md)已完成。CSV/目录生成 → 逐行预览 → 管理员确认 → 正常 ENROLL/审计 → 逐行结果；沿用冻结 related 身份屏障，额外保持目标学生 grant 的撤权/到期屏障，无新 migration/ACL。参考候选 PG16/HTTPS 14/14、回归 51/51、定向类型/ESLint 通过；最终姓名/人数显示的唯一 JS 增量有独立内置浏览器证据，不回填旧 hash。真实 55432/55433、Native/维护输入与隔离未变。下一建议管理员学生目录搜索/分页；NO COMMIT/PUSH/CI。

M6 管理员学生目录搜索与分页（2026-10-15）：[口径、接线及 LOCAL 证据](zhiban-v2-m6-student-directory.md)已完成。管理员按姓名/完整成员 ID 查询、状态筛选与 keyset 翻页，导入页跨页选择并生成 CSV；目录和入班不再依赖整租户快照，旧快照超限时仍保留独立目录入口。PG16/HTTPS 15/15、回归 55/55，定向类型/ESLint 通过；无新 migration/ACL，不增加冻结 related participants，不访问 User 登录状态，网关编码只为新增只读目录 query 例外。55432/55433、Native/维护隔离保持。下一建议教务工作台教学班/Enrollment 大名单分页；NO COMMIT/PUSH/CI。

M6 教学班与 Enrollment 大名单分页（2026-10-15）：[接口、页面和证据边界](zhiban-v2-m6-management-pagination.md)。管理员教学班及单班 Enrollment 独立分页，支持修改、目录选人入班、退班恢复和分页转班；新增 ACK 写路径复用原事务而不读取全租户 snapshot。独立 PG16 56505/HTTPS 3449，以 623 教学班、初始 629 条 ACTIVE Enrollment 验收，PG16/HTTPS/UI 12/12；相关回归 27/27，类型/ESLint 定向通过。无 migration/ACL 或冻结语义变更，真实 55432/55433 及维护隔离不变。下一建议主数据分页与新建教学班选择器；NO COMMIT/PUSH/CI。

M6 主数据分页与建班选择器（2026-10-15）：[交付边界](zhiban-v2-m6-catalog-pagination.md)。管理员课程/学期/行政班按页查询，新建教学班按页选择已发布课程、学期和可选行政班，写入复用 ACK 及原事务；新建/课程编辑发布沿用现有命令。独立 PG16 56506/受信 HTTPS 3450，初始 621/621/620 主数据，PG16/HTTPS/UI 19/19；相关回归 28/28，定向类型/ESLint 通过。无 migration/ACL/冻结语义变更；下一建议任教/行政班成员分页，不以维护输入为产品前置。NO COMMIT/PUSH/CI。

M6 任教和行政班成员分页（2026-10-15）：[页面、权限与 LOCAL 边界](zhiban-v2-m6-relationships.md)。新增任教／班级成员分页和目标限定的教师候选查询，写入继续复用原命令、CAS、相关身份屏障和审计，不增加 migration/ACL 或 related 数量。独立 PG16 56507／受信 HTTPS 3451，621 条任教、620 名行政班成员验收 10/10，相关回归 29/29，定向类型／ESLint 通过。下一建议师生工作台课程分页；真实 55432/55433、Native/维护隔离不变，NO COMMIT/PUSH/CI。

M6 师生课程分页（2026-10-15）：[实现与证据边界](zhiban-v2-m6-member-workspace.md)。普通工作台不再调用整租户 AcademicSnapshot，课程查询在 LIMIT 前检查范围和当前关系，名单复用原 Learning 教师检查并分页；保留学习、概览、统计及内容入口，元数据精确联接绑定版本。独立 PG16 56508／HTTPS 3452，622／621 门课程及 529 人名单，验收 9/9、回归 53/53，定向类型／ESLint 通过。管理员旧启动和活动／尝试记录分页仍待接续；冻结门禁、真实 55432/55433 和维护隔离不变，NO COMMIT/PUSH/CI。

M6 管理员主入口接续（2026-10-15）：[直接分页教务工作台](zhiban-v2-m6-admin-workspace.md)已 LOCAL_VERIFIED。服务器 ADMIN bootstrap 后在原空间挂载共享管理组件，不再依赖旧 snapshot 超限和目录权限探测；读失败可重试、切换空间销毁旧请求／游标、跨标签页退出清除表单，普通师生课程页保留。独立 PG16 56509／HTTPS 3453 验收 23/23、相关回归 53/53、定向类型／ESLint／格式检查通过；无 migration／ACL／冻结语义变更，不操作真实 55432/55433 或维护输入。下一建议学习活动／提交记录分页；NO COMMIT/PUSH/CI。

M6 学习记录分页（2026-10-15）：[活动／尝试／提交及单提交评分历史](zhiban-v2-m6-learning-records.md)已 LOCAL_VERIFIED。页面按需读取四类分页，权限／固定版本／最新标记和尝试上限从服务器完整关系决定，保留原命令、审计及不可变提交／成绩；无 migration／ACL／冻结语义变更。独立 PG16 56510／HTTPS 3454 验收 12/12、相关回归 68/68，定向类型／ESLint／格式检查通过。下一建议教师待评分列表与筛选；真实输入及隔离保持，NO COMMIT/PUSH/CI。

M6 教师评分工作台（2026-10-15）：[待评分队列与筛选](zhiban-v2-m6-grading-queue.md)已 LOCAL_VERIFIED。按每次尝试最新正式提交分页、按固定发布活动／学生／评分状态筛选并直接评分，发布后移出默认待处理；当前授权、重交屏障、CAS 与更正审计不变，精确 review 仅教师返回。PG16 56511／受信 HTTPS 3455 验收 12/12、回归 72/72，定向类型／ESLint／格式通过，16 份既有 migration hash 未变。下一建议课程负责人受限选择器；真实输入及隔离保持，NO COMMIT/PUSH/CI。

M6 课程负责人选择（2026-10-15）：[受限选择器与 LOCAL 范围](zhiban-v2-m6-course-owner.md)接入原管理员课程新建／编辑；候选独立按有效教师分页并绑定用途／课程，新选提交前精确复查，旧负责人保留及 null 清除继续原写入合同。原锁／CAS／审计／不可变发布、Identity／Bridge 和 migrations 不变。PG16 56513／HTTPS 3457 定向验收及相关回归记录于证据，不重复 GitHub CI；真实输入隔离保持。下一建议管理员操作历史分页，只读、最小字段；GPT-6 Sol / medium。NO COMMIT/PUSH/CI。

M6 管理员操作历史分页（2026-10-15）：[产品与 LOCAL 证据](zhiban-v2-m6-management-history.md)新增只读教务历史，时间＋ID 倒序 keyset、关键词／类型／UTC 日期筛选、当前管理员与 RLS 检查；只投影必要对象元数据，不返回 raw facts／命令号，不变更原命令／审计／授权事务。独立 PG16 56514／HTTPS 3458 验收 10/10、回归 32/32；无 migration／ACL／冻结语义变更，真实 55432/55433 和维护输入保持隔离，NO COMMIT/PUSH/CI。下一建议可试用版本与启动入口整理，GPT-6 Luna / medium。

统一本地试用包（2026-10-15）：[范围、账号与入口](zhiban-v2-trial-guide.md)。`pnpm trial:zhiban` 自建独立 PG16 56515 与受信 HTTPS 3459，三角色同一数据集，补齐评分静态入口，内容链接明确 CLOSED；info 不输出密码，stop 校验进程／构建绑定并走自建环境清理。以三角色教学短旅程验证可试用性，不重跑全量 CI；原 migrations、生产语义与真实 55432/55433／维护隔离不变。下一步三角色试用反馈，GPT-6 Sol / medium；NO COMMIT/PUSH/CI。

三角色试用反馈（2026-10-15）：[LOCAL 手工流程](zhiban-v2-trial-uat.md)已完成并收集两项 P2（新尝试入口表达／名单审计涉及成员投影），均待修复。正常成绩发布、更正、学生提交及统计在同实例 UI核对；不改业务源码、冻结语义或 migrations，不重跑全量 CI。下一步 UAT-01 后 UAT-02 的定向修复，GPT-6 Sol / medium；真实输入隔离保持。

三角色试用两项修复（2026-10-16）：[UAT-01 / UAT-02 接续](zhiban-v2-trial-uat-fixes.md)已完成。已有尝试入口只读，新建需明确确认；操作历史增加涉及成员 ID／当前同空间姓名及缺失回退。独立 PG16／HTTPS 定向 11/11、相关单元 58/58，统一 3459 实例已刷新且五项短冒烟通过。原报告与旧证据保留原范围，本轮证据单列 LOCAL；没有 migration／冻结语义改动，NO COMMIT/PUSH/CI。下一步继续三角色试用、按实际阻碍排序；模型 GPT-6 Sol / medium。

三角色第二轮试用（2026-10-16）：[实际流程及 UAT-03 修复](zhiban-v2-trial-uat-round2.md)走通学生提交、教师发布 90 分反馈、管理员创建课程／选择负责人／查询历史和目录。修复不可重交活动仍写“与重交”的入口文案，不改原尝试规则；独立 PG16/HTTPS 定向 12/12，统一 3459 实例刷新且五项短冒烟通过。旧试用数据与新实例范围分别记录；NO COMMIT/PUSH/CI，真实环境隔离保持。下一步优先试用管理员批量导入、名单调整和转班；模型 GPT-6 Sol / medium。

管理员名册／转班试用（2026-10-16）：[实际流程与 UAT-04 修复](zhiban-v2-trial-roster-uat.md)走通文件及目录生成导入、已有跳过、退班／显式恢复、错误输入、正常转班和满员失败保留源名单。修复失败后分页按钮误启用，独立 PG16／HTTPS 定向 9/9，类型／ESLint／格式通过。原 3459 服务和数据保留，刷新加载静态补丁；启动 metadata 保持原 hash，三项源码漂移与当前静态内容证明单列，不冒充新构建零漂移。NO COMMIT/PUSH/CI，16 个既有 migration 与真实环境隔离保持。下一步核对教师／学生在名单变更后的课程访问及历史作答；模型 GPT-6 Sol / medium。

名单变更后的访问／历史核对（2026-10-16）：[手工结果](zhiban-v2-trial-access-history-uat.md)确认退班及转出后学生原班入口和旧概览拒绝、教师当前名单同步变化、仍任教教师可读原班历史作答、目标班不混入原作答／成绩、恢复及转回后原三次历史和 88 分保持。最终原班 4/20、目标王悦 1/1，容量还原，正常审计／关系留痕保留。无新增问题、无代码修改／重启／新自动化回归，NO COMMIT/PUSH/CI。下一步汇总试用范围和已知限制，转入完整教学演示；文档整理模型 GPT-6 Luna / medium。

完整教学演示（2026-10-16）：[试用范围、限制与流程](zhiban-v2-full-demo-local.md)已完成本地管理员入口／名册、学生尝试与提交、教师草稿评分和发布 92/100、学生概览、教师活动统计。原 3459 disposable 实例继续运行，启动来源 3 项漂移如实披露；演示截图及 SHA256 单列 LOCAL 证据，不运行自动化套件或 CI，NO COMMIT/PUSH。后续由用户继续试讲或停止清理实例；产品问题修复建议 GPT-6 Sol / medium。

课堂试讲接续（2026-10-16）：[实际课堂流程与阻碍](zhiban-v2-classroom-trial-local.md)新建／发布复位判断活动（不可重交、1 次尝试），学生保存／提交，教师发布 96/100，学生收到反馈。记录 CL-01 尝试筛选输入错误后表单消失且重读无法恢复、CL-02 不可重交最终提交缺少确认两项 OPEN；M5 教学材料 CLOSED 为既有范围缺口。只记录未改代码，原运行实例／三项漂移保留，无自动化回归／CI／提交／推送。下一步先修复两项并本地定向验证；GPT-6 Sol / medium。

课堂两项修复（2026-10-16）：[CL-01／CL-02 修复及本地范围](zhiban-v2-classroom-fixes-local.md)完成筛选格式校验／错误保留可编辑表单、不可重交提交确认／取消。独立 PG16 56516／受信 HTTPS 3460 定向 13/13（含 5 项准备／短冒烟），类型／ESLint／语法通过，16 migrations hash 不变，实例已清理；原 3459 只读复核已加载新静态文件，5 项启动来源漂移如实记录。NO COMMIT/PUSH/CI。下一步继续课堂试讲；GPT-6 Sol / medium。

统一讲义／图片接入边界（2026-10-16）：[具体范围和并行候选方案](zhiban-v2-unified-content-boundary.md)明确复用 M5-A/B/C 文本＋PNG 编辑／发布及学生只读，接到同 origin 的完整教务试用；Runtime／AI／真实维护输入保持隔离。当前 loader 固定端点不能直接用于 disposable，拟以独立 target-bound 本地核验组合真实双库服务；保留旧固定检查。下一步实现并行 3461／56517 候选及定向 LOCAL 旅程，保留当前 3459 数据，不以旧证据签收新接线。本轮仅设计，无新测试／构建／PG／提交／推送／CI；GPT-6 Sol / medium。

统一内容并行候选（2026-10-16）：[交付与实际旅程](zhiban-v2-unified-content-local.md)在 3461／PG16 56517 接通原 M1–M4／M6 与 M5-A/B/C 文本＋PNG，独立业务／Native 双库、固定参考、私有 receipt、受限 loader／流式 gateway。12/12 本地检查及内置浏览器解码通过，源码清单匹配；16 既有 migration 不变，无新 SQL／ACL，Runtime／AI／真实维护隔离保持。原 3459 进程／目录最后核对已缺失（本轮未停止／删除），旧数据只保留历史证据，候选新数据不冒充继承。默认入口未切换，NO COMMIT/PUSH/CI。下一步 3461 连贯课堂试讲；GPT-6 Sol / medium。

3461 连贯课堂试讲（2026-10-16）：[手工结果与实际阻碍](zhiban-v2-content-classroom-uat.md)已完成讲义／PNG → 学生保存与提交 v1 → 教师发布 94/100 v1 → 学生反馈；原 88 分保留，平均得分率 91%。新增 UCL-01 返回工作台丢失空间、UCL-02 同标签回看讲义丢失未保存输入两项 OPEN；已保存草稿回看后可恢复。仅合成数据与文档／截图写入，运行来源零漂移，无业务代码、构建、自动化测试、提交／推送／CI。3461 保留运行，真实环境隔离保持。下一步先修 UCL-02，再补 UCL-01，做本地定向验证；GPT-6 Sol / medium。

讲义回看两项修复（2026-10-16）：[UCL-02／UCL-01 接续](zhiban-v2-content-classroom-fixes-local.md)补未保存作答离开确认／取消及保留空间、当前页课程展开。原 3461 内置浏览器定向核对取消、放弃、活动／课程刷新取消、显式保存后恢复；原提交 v1 与 94／88 分保持。3 个前端文件静态响应 hash 对齐，启动来源 3 项漂移如实披露，16 migrations hash 不变；浏览器刷新／关闭原生确认未完成验收，跨页自动定位未实现。无后端语义／SQL／ACL／重启／自动化套件／提交／推送／CI。下一步继续课堂试用并补原生确认待验项；GPT-6 Sol / medium。

原生离开保护补验（2026-10-16）：[LOCAL 观察与待验步骤](zhiban-v2-native-leave-uat-local.md)记录未保存作答页 reload 超时／对话框 API 不可见，而无输入概览页刷新 227 ms、关闭 API 正常。原生刷新／关闭的提示与取消仍待用户直接操作观察，不以页面未变化冒充 PASS；当前原页保留未保存测试行，无服务端写入。无代码／构建／重启／提交／推送／CI，原 3 项漂移及隔离保持。下一步收齐原生操作结果，再签收或修复；GPT-6 Sol / medium。

原生离开重新检测（2026-10-16）：[LOCAL 实测差异](zhiban-v2-native-leave-recheck-local.md)再次确认未保存页 reload 调用超时、对话框 API 返回空；本轮 close API 实际关闭未保存标签，重开后原草稿保留、未保存测试行消失。该自动化关闭不等同用户宿主按钮；原生提示／取消仍不签收。同一工作台干净状态刷新 485 ms 通过，已恢复干净入口；无业务源码或服务器数据写入、构建／重启／提交／推送／CI。停止重复超时，原生两项作为客户端兼容性待验项保留；下一步在可靠客户端补验，课堂页面内流程可继续。GPT-6 Sol / medium。

反馈修改／重交课堂（2026-10-16）：[LOCAL 实际旅程](zhiban-v2-classroom-revision-local.md)按用户要求延期原生刷新／关闭补验（未签收），继续学生原尝试重交 v2、教师发布对应成绩 v1 96/100、学生反馈及教师统计。旧提交 v1／94 分历史保留，新提交未评分阶段不沿用旧分；最终学生平均 92%，教师该活动平均 96%。无新实际阻碍，无业务代码／构建／重启／自动化套件／提交／推送／CI；3461 运行及原三项漂移、隔离边界保持。下一步整理统一试用入口交接及默认启动替换范围；GPT-6 Sol / medium。

3461 入口交接整理（2026-10-16）：[当前入口与默认替换清单](zhiban-v2-trial-entry-handoff.md)已更新 README／TRIAL／当前指南，推荐使用现有 content 命令与 3461；package 默认仍为旧 3459，未切换。后续仅 package.json／trial-control.ts 两处接线，默认启动／info／stop／verify 成组改指 content，保留显式 content 与新增 legacy；旧模式帮助／stop 提示须同步，防止停错目标。只读核对运行、私有权限、三项静态响应 hash 和 16 migrations；保留 96 分课堂数据及原三项漂移。原生补验延期未签收，真实环境／Runtime／AI 隔离保持。无启停／重建／receipt 重签／套件／CI／提交／推送。下一步实施最小默认／legacy 接线及本地参数／目标核对；GPT-6 Sol / medium。

默认／legacy 命令接线（2026-10-16）：[本地参数与目标核对](zhiban-v2-trial-entry-wiring-local.md)已将默认启动／info／stop／verify 成组改指 3461，保留 content 兼容入口并新增显式 legacy；控制器先拒绝未知／冲突／重复参数，旧模式帮助和 stop 提示绑定 legacy。模拟文件／进程定向 24/24、独立类型／ESLint／格式检查通过；真实默认 info＝content info，仍为原 PID／根。未执行启动／验证 runner 或真实 stop，不声称新生命周期通过。原 metadata／receipt 与课堂数据保留，启动漂移增至五项，16 migrations 不变；无提交／推送／CI，真实环境隔离保持。下一步用默认 info 接续试用，仅在需要新数据时另行安排启停；GPT-6 Sol / medium。

基础课堂共享任务（2026-10-17）：[LOCAL 交付](zhiban-v2-basic-classroom-local.md)已实现独立 Classroom／Dispatch、精确版本与首次 Attempt 绑定、文本／PNG／文字活动派发、师生页面、提交查看和结束屏障。35 单测、定向类型闭包、PG16 与内置浏览器旅程通过；3462／56518 独立候选来源漂移 0，原 3461 及 88／92 分保留。无提交／推送／CI，真实 PG／Runtime／AI／维护隔离和 U01／U02 deferred gates 保持。下一步产品试用及课堂草稿／时间调整；GPT-6 Sol / medium。

课堂草稿与时间调整（2026-10-17）：[LOCAL交付](zhiban-v2-classroom-edit-local.md)补教师DRAFT元数据编辑、PUBLISHED窗口调整、版本／幂等／任教／终态屏障及取消／冲突保留输入。新增0002四列UPDATE，0001不变；4/4单测、定向类型、PG16旅程11组与内置浏览器通过。3463／56519新合成候选运行、来源漂移0；初查旧3461／3462已停止且目录缺失，本轮未清理／恢复，默认入口未改。无提交／推送／CI，真实环境及deferred gates保持。下一步3463改期至评分课堂试用；GPT-6 Sol / medium。

3463改期课堂连贯试用（2026-10-17）：[LOCAL记录](zhiban-v2-classroom-schedule-journey-local.md)完成改期／派发→学生第1次尝试提交v1→教师93分发布→学生反馈，课堂计数1／1／1，旧88分保留，平均90.5%。来源漂移0，无阻断；CEJ-01课堂评分入口未带活动筛选为轻微OPEN。仅合成业务数据、文档和截图，无业务代码／构建／重启／套件／提交／推送／CI。下一步受限评分入口筛选与上下文；GPT-6 Sol / medium。

CEJ-01评分入口修复（2026-10-17）：[LOCAL记录](zhiban-v2-classroom-grading-entry-local.md)新增活动筛选、ALL状态及原课堂返回，普通入口保持TODO。原3463浏览器验证筛选／重载／清除／返回及畸形、学生权限拒绝，93／88分保留；3个静态响应hash匹配，migrations不变，启动来源3项预期漂移且receipt不改写。无重启／构建／整套回归／提交／推送／CI。下一步课堂结束及历史回看；GPT-6 Sol / medium。

课堂结束与历史回看（2026-10-17）：[LOCAL试用](zhiban-v2-classroom-ended-local.md)正常结束版本8、教师写入控件消失、学生入口移除，原尝试／提交v1／93分反馈及88分保留、平均90.5%。无新阻断或代码修改，无重启／套件／提交／推送／CI；3项既有前端漂移如实保留。下一步汇总可用功能及剩余移植项，选择产品主线；GPT-6 Sol / medium。

产品现状与下一包（2026-10-17）：[当前汇总](zhiban-v2-product-status-next.md)区分已可用常规教学与未迁移高级能力；基础课堂编辑／改期／评分／结束／历史回看已有LOCAL旅程。下一项确定教师课程成绩簿首版：服务端有界学生／活动分页投影、当前版本最新尝试／提交／公开成绩、精确评分及返回；不自动启用总评／导出／新角色权限。此次仅文档及只读核对，3463保持3项既有漂移，无套件／CI／提交／推送。下一步同片实现查询／API／页面并本地验证；GPT-6 Sol / medium。

教师课程成绩簿（2026-10-17）：[LOCAL交付](zhiban-v2-gradebook-local.md)新增Assessment只读双轴分页投影／API、当前学生×发布活动表格、精确提交评分及保留筛选返回；复用已有表／权限，无新SQL。2/2游标单测、定向类型／ESLint、PG16八组及内置浏览器94分v2更正回表通过。3464／56520独立合成候选运行，最终gradebook.js一项静态漂移有响应hash及手工证据；原3463不重启，旧来源14项漂移如实保留，不重签receipt。无提交／推送／CI，真实环境和deferred gates不变。下一步成绩簿受限CSV导出；GPT-6 Sol / medium。

成绩簿受限CSV导出（2026-10-17）：[LOCAL交付](zhiban-v2-gradebook-csv-local.md)复用双轴查询／即时任教授权，仅当前页≤500条／2MiB，13字段、不含正文反馈草稿、缺交空分、公式防护及能力标记。4/4合同单测、定向类型／ESLint、PG16十组及普通浏览器下载读回通过；内置宿主仅确认生成，下载句柄未取得，不冒充落盘PASS。3465／56521独立候选漂移0，旧3463／3464未重启清理；无新SQL／ACL／提交／推送／CI，隔离和deferred gates保持。下一项作业附件提交首版，GPT-6 Sol / medium。

作业附件首版（2026-10-17）：[LOCAL与Gate记录](zhiban-v2-submission-files-local.md)已接单PDF／TXT≤1MiB、同事务精确Submission绑定、AssetPort、历史／授权下载和教师评分。独立learning_files 0001＋追加0002放行标记，仅owned PG应用；旧SQL不改。遵守3D：无真实扫描配置，默认拒绝未放行文件，3466仅LOCAL_SYNTHETIC_PINNED固定内容，UNVERIFIED不下载，不冒充真实扫描PASS。29/29定向单测、类型／ESLint、PG16九组及教师提交v4附件／95分旅程通过，来源漂移0。旧3463–3465收尾STOPPED且本轮未清理／恢复；无提交／推送／CI，真实环境与原有deferred gates保持。下一步接可信扫描配置和真实文件隔离／启用，GPT-6 Sol / medium。

可信扫描与真实附件（2026-10-17）：[LOCAL接线与命令](zhiban-v2-submission-scanner-local.md)使用Ubuntu ClamAV 1.5.4及官方main/daily/bytecode库，host profile＋独立pin、stdin扫描、程序／库／证书／CVD摘要、7天日库门槛、60秒超时和失败拒绝。新增0003仅ownedPG应用，服务端proof精确绑定文件与Submission，历史样例不提升。独立3467／56523，不替换3466证据；本地定向记录见该文，无提交／推送／CI，真实库和其他deferred gates保持。下一步真实课程文件试用及扫描等待体验优化；GPT-6 Sol / medium。

移植主线对账（2026-10-17）：沿用[原P1–P7计划](zhiban-v2-migration-completion-plan.md)，将课程壳／章节／课堂／成绩簿CSV／真实扫描附件回填至原批次，P1/P2和P3均不冒充全量完成；删除矩阵过时“下一片”堆叠。接续先满足同一版本教学旅程退出条件：原默认3461整合现有能力，不新建产品端口；随后通用学习中心／保留旧URL与视觉对照，再按P3/P4/P5/P6原范围推进。真实库／维护／Runtime与REVIEW边界保持，不另起计划或重复CI。对应新运行receipt和短结果由默认info核验。

上游优先去重（2026-10-17用户明确要求）：新版OpenMAIC已满足或更好时，不移植对应旧功能，采用原生／薄适配并只补智伴差额。官方稳定1.2.0已发布，当前仍pin1.1.2；本轮只读HTTP/1.1核验release和refs，未升级依赖／merge／迁库。执行按移植计划第0节，优先核验1.2.0再接原生学习课堂；旧55页矩阵是需求追踪，不要求全部复制旧实现或像素。旧receipt不扩展为1.2.0证据。

1.2.0兼容与课程入口（2026-10-17）：固定官方a9da60b3…审计六包版本／exports，SlideCanvas文件字节一致，官方storage构造探针3/3、0数据库查询确认owner-only不能原样升级；详见[兼容记录](zhiban-v2-openmaic-120-compatibility.md)。保持当前pin，P2复用公开renderer和原Learning组件接发布单元／前后导航／师生预览与原作答；不复制private播放器、不扩展Runtime／AI门禁。全栈1.2升级待ownership relation＋schema＋Native receipt／ACL兼容包，不冒签当前入口为新版升级完成；无提交／推送／CI。

2026-10-17：官方 1.2.0 全量 LOCAL 候选完成，固定 SHA a9da60b3b4adb429369c0da13d5637a904ead2b0，HEAD 仍 daf63afa83470d24a9ed41d171c6a17f8a80adb6。六包／默认整站构建、PG16 226 项、业务 SQL55、PNG23组及3461统一旅程11组通过；不提交／推送／调度CI，不操作真实库。来源、模式边界及观察项集中在 [升级记录](zhiban-v2-openmaic-120-upgrade.md)，后续复用差额设计回填 [原 P1–P7 计划](zhiban-v2-migration-completion-plan.md)。旧记录保留历史范围，不再决定当前版本和下一步。

P3个人资料与账户／目录差额（2026-10-18）：沿[原P1–P7主线](zhiban-v2-migration-completion-plan.md)完成[本地产品包](zhiban-v2-profile-directory-local.md)：本人显示资料／私有联系信息、管理员分页全成员目录／正式姓名／学号工号及原本人改密／退出全部会话接线。新业务schema与people显示名单列ACL使用独立迁移／expected profile，26个旧迁移不变；只在owned PG16默认3461启用。29项定向测试、25组统一教学旅程及受影响类型／ESLint通过，1395项来源匹配、drift=0；ACL扩权／错误ledger拒绝及恢复验证通过。头像、开户／启停／登录别名／角色变更与多类导入仍待，不绕过冻结入驻／同意／审批；原生刷新／关闭签收与Runtime／AI隔离保持。旧讨论课堂已私密备份，新账号以info为准，NO COMMIT/PUSH/CI、真实55432／55433不变。下一步复用新版上传解析，补教学资源课程归属／发布差额；GPT-6.1 Sol / medium。

P3教学资源归属与发布（2026-10-18）：完成[TXT／Markdown／PDF本地产品包](zhiban-v2-course-material-local.md)。复用官方1.2.0 MIME／plain-text／unpdf，课程任教授权上传→可信扫描→解析草稿→不可变发布→原章节编排／目录发布→学生学习与对应原件下载；新独立material schema／expected catalog，27个既有迁移不变，无Identity／Native ACL扩张。21项定向测试、30组统一旅程和额外章节UI接续通过，1448来源匹配、drift=0。修复上传区表单根节点缺失导致误触离开确认；原内容页32项既有any lint基线无新增。上一资料试用实例因本轮备份／停止顺序失误未保留，已说明；当前新资源课堂已私密备份，不能冒称恢复旧数据。仅owned56517／3461，真实55432／55433、Runtime／AI及原生刷新／关闭人工签收边界保持，NO COMMIT/PUSH/CI。下一步原生PPTX／离线HTML导出授权接线；GPT-6.1 Sol / medium。
