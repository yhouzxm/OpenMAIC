# 智伴 V2 后续移植执行总计划

STATUS: HUMAN_APPROVED_EXECUTION_PLAN / DOCUMENTATION_ONLY

编制日期：2026-10-03。目标：让 Codex 按有前置、有边界、有测试、有独立签收的工程单元完成迁移，而不是复制 V1 源码或一次性生成整个系统。

本计划细化现有路线，不修改已冻结 ADR，不批准生产数据访问、部署、付费 AI 调用或后续全部实现。用户须逐单元授权；实施、checkpoint、CI 签收和 closeout 是不同执行模式。本文中的未来表名、文件名和状态设计均为建议，须在对应设计单元冻结后实施。

2026-10-03 人工批准：接受此计划，授权计划文档 checkpoint，随后执行 **1B-7A DESIGN**。批准的是执行路线与逐单元门禁，不是预先批准全部业务规则、角色委派、实际 release 活动支持集或生产迁移。R1 教学闭环优先作为计划方向；具体 release manifest 与各未决业务项仍须在所属设计单元明确。1B-7B BUILD 不在本次授权范围。

## 1. 仓库事实与起点

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

### 3.1 每个单元的五个模式

| 模式 | 允许行为 | 退出条件 |
| --- | --- | --- |
| DESIGN | 读取事实，写设计/测试矩阵，报告缺口；只改文档 | 明确 ownership、状态机、权限、事务/并发、schema/ACL、DTO 和负例；待人工批准 |
| BUILD | 只实现已批准单元；测试、自审、修正常 P1/P2 | 本地 gate PASS，P0/P1=0；NO COMMIT / NO PUSH |
| CHECKPOINT | 精确 scope 核验、显式 stage、正常 commit、固定网络 push | parent/message/SHA/clean/remote match 均核验；不改实现、不补测试 |
| CI SIGNOFF | 独立确认远端后派发新精确候选，读实际日志 | 所有指定 suite/环境/两轮 PG/工具检查通过；不改文件 |
| CLOSEOUT | 文档记录冻结与证据，然后另做 docs checkpoint | deferred 清单、已关闭问题、真实 run/SHA、下一单元条件完整 |

BUILD 的自审与普通修复在同轮完成，不把每个普通 bug 拆成无限 revision phase。真实 SQL/assertion failure 不能无脑 rerun；必须先分类、修复、新 checkpoint、新 SHA、新 run。只有明确无 SQL/assertion/production failure 的 CI 基础设施瞬态，才允许按批准策略最多 rerun 一次。

每轮完成后停止。总计划不是“无人监督一直执行到上线”的授权。

### 3.2 Preflight 与变更保护

每次开始执行：

```powershell
git branch --show-current
git rev-parse HEAD
git status --short --untracked-files=all
```

- 项目必须为 V2，分支为 `refactor/zhiban-v2`，HEAD 必须等于本轮人类批准的 `EXPECTED_HEAD`。只有第一轮起点可用本文 SHA；后续使用上一个已验证 checkpoint 的实际 SHA，不重复硬编码旧 SHA。
- 新单元要求 CLEAN；checkpoint 要求只有前一 BUILD/DESIGN 确认的精确文件集合。发现额外变更立即 STOP，不清理用户改动。自身 BUILD 过程中产生的允许改动不算新前置失败。
- 读取 root/相关子目录的 AGENTS.md（如有）及适用 skill；先列 CURRENT ASSETS / GAP MATRIX，不重写可复用能力。
- V1 永远只读：不 install、不 format、不 checkout/reset、不编辑、不 merge V1 branch、不访问真实数据/凭据。
- 默认代码范围为 `lib/zhiban/{domain,application,infrastructure}/<context>/**`、`app/api/zhiban/**`、`app/zhiban/**`、`components/zhiban/**`、对应 tests/e2e 和文档。具体 allowlist 在 DESIGN 冻结；不可据此改所有目录。
- 不改 OpenMAIC core/package internals。Domain 纯 TS；Application 不导入 PG/Next/OpenMAIC/React；Infrastructure 做转换；UI 只消费用例 DTO。
- 已应用 migration 追加修复，不改 checksum。当前 0001–0006 不动；Identity 下一号只有在 inventory 核验后才可能是 0007。其他 context 的 schema、ledger、runner 所有权先 DESIGN，不把全系统表塞进 Identity runner。
- 不用 owner/migrator/superuser 给应用执行；不把 global Credential/Session 变成 tenant RLS 表；tenant-owned 业务表需明确 RLS、复合 FK、tenant predicates 和最小角色 ACL。
- CAS/revision 复用冻结 BigInt/string 规则；不能 xmin、JS Number、last-write-wins、stale-as-no-op 或自动重试陈旧授权。重试必须是用例级显式策略，撤权拒绝不重放。

### 3.3 测试与 CI 共用 gate

BUILD 最低测试：新单元 targeted + 共享 contract + 完整既有 Identity 串行回归 + 依赖域回归 + migration/static + architecture boundaries + root typecheck/lint/format + diff check。不能仅跑新增测试。

当前 905 Identity 回归命令组（不把无本地 PG 的 skipped 测试算通过）：

```powershell
pnpm exec vitest run tests/zhiban/identity/postgres/bootstrap-role-contract.test.ts tests/zhiban/identity/postgres/migration-contract.test.ts tests/zhiban/identity/postgres/migrate-runner.test.ts
pnpm exec vitest run tests/zhiban/identity/domain tests/zhiban/identity/contracts
pnpm exec vitest run tests/zhiban/identity/credentials tests/zhiban/identity/postgres/credential-repository.test.ts tests/zhiban/identity/postgres/credential-schema.test.ts
pnpm exec vitest run tests/zhiban/identity/sessions tests/zhiban/identity/postgres/session-repository.test.ts tests/zhiban/identity/postgres/session-schema.test.ts
pnpm exec vitest run tests/zhiban/identity/postgres/global-repositories.test.ts tests/zhiban/identity/postgres/membership-repository.test.ts tests/zhiban/identity/postgres/mappers.test.ts tests/zhiban/identity/postgres/transactions.test.ts tests/zhiban/identity/postgres/persistence-authenticity.test.ts
pnpm lint
pnpm check
pnpm exec tsc --noEmit
git diff --check
```

如果 typecheck OOM，只对当前进程临时设置 8GB NODE_OPTIONS，执行后恢复之前的值；不 setx、不持久化配置。实现单元只格式化本单元文件，不能 `pnpm format` 全仓库。依赖变更要单独说明必要性，并用 frozen install 验证 lockfile，不能顺带升级包。

- Node 22/Linux 是 CI parity；Windows/Node24 不是替代。无本地 PG16 不安装、不用 PG18/PGlite 冒充；真实 ACL/并发/rollback 标 PENDING_CHECKPOINT。
- 既有 Identity PG16 两轮 **121** 不减少；以后新增 suite 追加两轮，真实计数按日志。独立连接 + acknowledged locks/barriers，禁止 sleep-only concurrency test。
- 复用现有 `zhiban-identity-pg16-security.yml`，不建第二套重复 Identity workflow；新业务 PG suite 可在明确批准的 context job 中扩展，保留两轮及原 suite。Storage PG contract 不删除、不改为 mock。
- 每个 BUILD 交付 `TEST_INVENTORY`：suite、命令、unit/static/real PG、expected cases、是否已纳入 CI。CI 明确运行新增 suite；根 vitest 默认发现或 job 绿色都不是 coverage 证明。
- 通用 CI 的 Prettier/lint/typecheck/i18n、root/package tests、生产 build、E2E、Render/Docker 不削弱。允许已有 warnings/有依据的环境 skip；关键安全 suite 不允许 skip。

CI dispatch 模板（只有单独授权后执行）：

```powershell
gh workflow run ci.yml --ref refactor/zhiban-v2 --repo yhouzxm/OpenMAIC
gh workflow run storage-pg-contract.yml --ref refactor/zhiban-v2 --repo yhouzxm/OpenMAIC
gh workflow run zhiban-identity-pg16-security.yml --ref refactor/zhiban-v2 --repo yhouzxm/OpenMAIC
gh run list --repo yhouzxm/OpenMAIC --branch refactor/zhiban-v2 --limit 20 --json databaseId,event,headSha,status,conclusion,url,workflowName
```

必须核验三个 run 的 event、headSha、run URL；候选未成功 push/远端 read-back 不一致，不 dispatch。gh transport 失败不是 CI 失败；允许的 fallback 只为进程临时 GODEBUG、一次重试并恢复环境，不给 gh 传 git 的 `-c`。

### 3.4 Checkpoint 模板

只有收到明确 checkpoint/commit/push 授权才运行：先 `git diff --name-status`、`git diff --check`、`git status --short --untracked-files=all`，与批准 allowlist 精确比较。用 `git add -- <逐个明确路径>`，不 add-all。

stage 后核验 cached scope/stat/check、无 unstaged/unexpected untracked；正常 commit，核验 parent/message/new SHA/CLEAN。push 只执行一次：

```powershell
git -c http.version=HTTP/1.1 -c http.postBuffer=67108864 push origin refactor/zhiban-v2
git -c http.version=HTTP/1.1 ls-remote origin refs/heads/refactor/zhiban-v2
```

禁止 force、amend、reset/rebase/stash、SSH fallback、持久 git config。reset/TLS/443/timeout 时 STOP；下一次 retry 须再授权，不重 commit。push SUCCESS 而 read-back 网络不可用记 PENDING_VERIFICATION，不改判 push 失败。CI 前独立核验 HEAD/message/parent。

### 3.5 完成与严重性

- `IMPLEMENTED_LOCALLY` 不等于 `CI_SIGNED_OFF`，`CI_SIGNED_OFF` 不等于 `CLOSED/FROZEN`，`CLOSED` 不等于 `PRODUCTION_APPROVED`。
- P0：跨租户、secret 泄漏、禁用/撤销仍有效、权限伪造、数据损坏/partial commit、最后管理员并发归零等。
- P1：CAS/授权版本错误、grant stitching/ceiling 绕过、关键 suite 漏跑、审计不原子、关键负例 fail open 等。
- P2：非安全维护项、明确尚待真实环境证据。单元 CI signoff 前不得用 P2 掩盖 production correctness 缺陷。
- P0/P1=0 才可 checkpoint ready；真实 PG pending 可以报告本地 ready，但不能 phase complete。违反冻结契约输出 CONTRACT_CONFLICT，停止相关单元并给证据；不影响无该依赖的后续单元，但不得偷偷跳过门槛。

## 4. 执行顺序总览

```text
DOC-01 → 1B-7A/B → 1B-8A/B/C/D（E按批准渠道）
                 → 0B-A/B → 1B-9A/B/C → 1B-10 → 1B-11 → 1B-12
                 → 2A → 2B → 2C → 3A
                      2D/E按能力Gate    3B → 3C/D → 4A/B
                                             ↓
                                   5A/B/C/D 教学闭环与Portal
                                             ↓
                             4C → 6A/B/C/D 治理与分析
                                             ↓
                        7A/B/C/D/E/F 高级能力（按各自前置）
                                             ↓
                     DATA-A/B/C → OPS-A/B/C/D → 最终全量迁移签收
```

推荐 Codex 串行执行默认队列；图中可解耦依赖不代表已授权并行工作。0B/1B-9 若阻塞，Course 等纯业务 Domain/持久化可以在自身 gate 通过后推进，但任何真实 OpenMAIC launch、相关 Portal 发布和集成 complete 必须等待。

Portal 可提前做薄的已授权垂直切片，不在 backend 未验收时造假 DTO 或复制 V1 pages。最终三种 Portal 验收仍按 5B–5D 完成。

### 默认串行队列（每次只取一个 UNIT）

以下是推荐执行队列，遇到条件单元先核验其批准状态。本文 Phase 2–7 是后续执行分组，不改写旧 migration-matrix 中历史 Phase 2/3/4 的解释；稳定定位以 UNIT ID 为准。

| 顺序 | UNIT 队列 | 依赖与停止点 |
| --- | --- | --- |
| 1 | DOC-01 | 批准计划与首发 manifest，独立 docs checkpoint |
| 2 | 1B-7A → 1B-7B | 先冻结空白，实施/CI/closeout 后再开始 1B8 |
| 3 | 1B-8A → 1B-8B → 1B-8C → 1B-8D → 1B-8E | E 需渠道批准；不实施时记录 release 的恢复替代方案与批准人 |
| 4 | 1B-0B-A → 1B-0B-B | 按首发能力诊断；U01/U02 若为首发必需，提前推进 7A/7B 的契约与诊断部分，否则相关 release 阻塞 |
| 5 | 1B-9A → 1B-9B → 1B-9C → 1B-10 → 1B-11 → 1B-12 | 只有对应 Bridge Gate 满足才执行/签收；不要跳过 ADR-012 人工接受 |
| 6 | 2A → 2B → 2C → 2D → 2E | D/E 是否为 R1 必需由 manifest 决定；未批准能力保持关闭。纯 Course 可在 Bridge 阻塞时独立获批推进 |
| 7 | 3A → 3B → 3C → 3D | 先可信证据合同；完整播放/Interactive 先过 7A/7B 对应 Gate，不硬跨阻塞 |
| 8 | 4A → 4B → 5A → 5B → 5C → 5D | 验收人工评分的 R1 教学闭环；每个 UI 只调用已有真实用例 |
| 9 | 4C → 6A → 6D → 6B → 6C | durable work/notification 在使用它的干预单元之前闭合，不能因编号而倒置依赖 |
| 10 | 7A → 7B → 7C → 7D → 7E → 7F | 只做批准的完整能力；已提前完成的部分复用，不重复实现。各 REVIEW 决策先关闭 |
| 11 | DATA-A → DATA-B → OPS-A → OPS-B → OPS-C → DATA-C → OPS-D | DATA-C 必须等 staging/UAT/回退批准，再进行真实数据切换 |

R1 可以在第 8 行完成后，针对 **R1 manifest** 另行批准第 11 行试点交付，不必等待全部高级能力；R2/R3 用各自 manifest 重走相关增量测试与 staging/data gate。最终“完整迁移”仍须完成或人工处置所有 36 项。不能因为未来流程列在队列里就默认获得真实数据或部署权限。

## 5. DOC-01 — 计划批准与证据整理

**模式/范围**：DESIGN/DOCS ONLY，`docs/v2/**`。前置是本文起点 CLEAN；当前编制本文不自动完成此单元。

**步骤**：批准首发 release manifest；为全部 36 项能力注明 R1/R2/R3/REVIEW/REMOVE 与证据；补充 1.1.2 sync 最终 CI/合入信息；建立执行 ledger（可在本文末尾维护），记录 unit、base/candidate、scope、tests、run、deferred owner、checkpoint SHA。历史失败/旧 SHA 保留，不变造。

**Gate**：无 production/test/workflow/schema 变更；本计划明确 PROPOSED 与已冻结规则不同；首发决策和需人工批准项明确。docs checkpoint 后才开始下一 DESIGN。

## 6. Phase 1B 剩余单元

所有单元都遵守第 3 节，以下列出增量工作和专属验收。

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
- **Gate**：P0/P1=0；unit/static/typecheck/lint PASS；真实 PG 在 CI 两轮通过后才能 1B-7 closeout。关闭 guard 只提供未接线的 primitive 与实际 use-case enforcement 的差距，由 1B-8C 证明，不提前宣称所有入口已保护。

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

每个下列工程单元先 DESIGN，再批准 BUILD，并走独立 checkpoint/CI/closeout。产品状态机、permission词汇、schema不是本文提前冻结。

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
- 故障注入DB/byte/provider/job失效、网络中断、部分副作用、重复消息、snapshotrestore、迁移no-op/checksum；并发真实PG两遍；Node22 native/hash、build/browser/render/container。
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

### DESIGN / BUILD 共用模板

复制以下模板，填入本文中一个 UNIT，不能同时填“所有剩余阶段”：

```text
项目：E:\openmaic\zhiban
BRANCH：refactor/zhiban-v2
EXPECTED_HEAD：<上一个独立核验的checkpoint SHA>
UNIT：<例如1B-7A>
MODE：<DESIGN 或 BUILD>
权威计划：docs/v2/zhiban-v2-execution-plan.md
只执行该UNIT，不自动开始下一UNIT。
NO COMMIT / NO PUSH / NO CI DISPATCH / NO PRODUCTION DATA / NO DEPLOYMENT。

1. 执行branch/HEAD/status preflight；不匹配或新单元worktree不CLEAN则STOP。
2. 读取AGENTS、适用skills、该UNIT规定资料、已批准设计与真实代码/tests。
3. 输出CURRENT ASSETS / GAP MATRIX /精确允许修改scope；只补真正缺项。
4. DESIGN只改docs，列需人工决定项；不实施schema/provider/API。
   BUILD实现已批准范围、targeted/shared-contract/negative/real-PG tests、CI最小接入。
5. 普通P1/P2本轮自审修复；冻结冲突/新权限/新产品定义/付费或数据授权不足则STOP报告。
6. 按总计划第3节与该UNIT gate验证；无本地PG16不安装，不用PG18冒充。
7. git diff --name-status / --check / status核验scope；阶段末停止。
输出UNIT/MODE/BASE_HEAD/READ_SOURCES/ASSETS_GAPS/FILES_CHANGED/MIGRATIONS/
CONTRACTS/TEST_COMMANDS_COUNTS_SKIPS/REAL_PG/WORKFLOW_COVERAGE/
TYPECHECK/LINT/FORMAT/DIFF_CHECK/CONFLICTS/P0/P1/P2/DEFERRED_OWNER/
READY_FOR_CHECKPOINT/PHASE_COMPLETE/COMMIT_NO/PUSH_NO/NEXT_UNIT。
```

Checkpoint 提示词必须由上一轮实际 diff 生成，不提前固定未来文件数：`EXPECTED_HEAD`、完整显式 `EXPECTED_FILES`、精确commit message、预期parent、网络命令与stop规则。checkpoint不重新review/编辑。CI提示词填实际candidate、workflow、expected suites/counts、两轮PG、environment、failure policy，禁止用旧SHA成功run。

### 建议立即下一任务

先批准/检查 **DOC-01** 并做 docs checkpoint，再给 Codex：

```text
严格按 docs/v2/zhiban-v2-execution-plan.md 执行 1B-7A。
模式 DESIGN / CONTRACT FREEZE，NO IMPLEMENTATION，NO COMMIT，NO PUSH。
EXPECTED_HEAD 使用DOC-01完成后的已独立核验SHA。
重点冻结RoleCatalog/显式delegation ceiling、可信resource facts、
authorizationVersion、last-admin same-client transaction composition与lock order。
未确定的业务委派与权限目录不能擅自授予；旧Domain/Ports/migrations不改。
完成后输出设计gate与是否可批准1B-7B，并停止。
```

1B-7A是为现有冻结规则补充执行空白与并发接线方案，不重新发明Identity/RBAC。

### 后续上游同步维护规则

固定已签收 release 作为每个开发/发布周期的 OpenMAIC pin；不因上游持续变化反复推倒已完成的业务单元。安全更新单独分支单独验收，不将 fork 的移动 main 误认为官方 release。

每次升级：核对 THU-MAIC 官方 tag/release SHA 与行为变化 → 建立受控 sync 分支 → 审计 core/package/schema/protocol/持久fixture差异 → 跑通用 CI、Storage PG、既有 Identity/业务 suite、Adapter 新旧兼容与实际 host 负例 → 人工接受 → 合入 V2。第三方 fork 独有功能、自动依赖更新和 core 修改不搭车。正式 export 的新增也必须重新做对应 capability Gate，不代表可自动公开。

协议/schema不兼容、fixture读写差异、主体/owner语义变化必须先ADR/补偿设计，不能为merge成功放宽授权。生产数据库回退和代码回退分开批准。

## 17. 执行 ledger（本次只是计划）

| Unit | 状态 | 证据 / 下一动作 |
| --- | --- | --- |
| 官方1.1.2受控同步 | MERGED / CI_SIGNED_OFF | 起点SHA及第1节三个run；DOC-01 已补充最终文档证据 |
| 1B-1至1B-6 | CLOSED / FROZEN | 对应review与起点回归；不能认为1B8 HTTP已完成 |
| DOC-01 | PLAN_APPROVED / CHECKPOINT_PENDING | 本次仅计划批准与同步证据整理；具体 release 支持集仍需所属设计批准 |
| 1B-7A | DESIGN_AUTHORIZED_AFTER_DOC_CHECKPOINT | 计划文档 checkpoint / 远端核验后开始，NO IMPLEMENTATION |
| 1B-7B及其后 | NOT_STARTED / NOT_AUTHORIZED | 按前置与逐单元授权执行 |
| 0B / ADR-012具体桥接 | NOT_APPROVED_FOR_IMPLEMENTATION | 按当前release能力诊断/明确人工接受 |
| V1真实数据 / 生产部署 | NOT_AUTHORIZED | DATA/OPS各单元单独授权 |

PLAN_IMPLEMENTATION_STARTED: NO

CURRENT_NEXT_UNIT: DOC-01_CHECKPOINT_THEN_1B-7A_DESIGN

NEXT_ENGINEERING_DESIGN: 1B-7A

COMMIT: NO

PUSH: NO
