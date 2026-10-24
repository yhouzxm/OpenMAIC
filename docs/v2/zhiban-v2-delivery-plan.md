# 智伴 V2 功能交付计划（2026-10-08 重排）

> 当前实施与状态唯一入口为[原P1–P7统一移植计划](zhiban-v2-migration-completion-plan.md)。本文件下文保留M1–M7历史业务范围与原判断，不再提供当前“下一步”；不重做已交付基础层，也不默认重复GitHub CI。

STATUS: LOCAL_FIRST_EXECUTION_POLICY / BUSINESS_MILESTONES_PROPOSED

基线：`refactor/zhiban-v2`，HEAD `daf63afa83470d24a9ed41d171c6a17f8a80adb6`，编制前工作树 CLEAN。用户要求重排整个项目，减少以测试为中心的工作，本地能够验证时不再重复派发 GitHub CI。本文件落实该执行方式；业务里程碑是具体推进方案，尚未批准的业务规则不因列入计划而自动冻结。

## 1. 当前可以复用的成果

| 范围 | 当前事实 | 下一步如何使用 |
| --- | --- | --- |
| Identity | Domain、PG repository、Credential、Session、Authorization、成员组合、HTTP、受控人工恢复均已有实现与 closeout | 直接接本地运行配置和 UI，不再重做 Identity foundation |
| Bridge / Runtime / AI | [9B](phase1/phase1b-9b-review.md) 和 [9C](phase1/phase1b-9c-review.md) foundation 已签收；生产业务入口保持关闭，AI 为 fake-only | 在真实 Course/Activity/Attempt 出现后补业务接线；不再单独扩充合成测试 foundation |
| 本地验证环境 | Node 22、pnpm 10.28.0、独立 PG16 测试 cluster，55432 / `zhiban_pg16_test`，已有 LOCAL harness/provider receipt | 作为真实 PG 验证环境；按影响选择测试，已有两轮 runner 保留但不默认每轮调用 |
| Storage native harness | B9/C9 native 测试仍要求 GITHUB_ACTIONS 与 `/openmaic` 的独立 disposable 生命周期；现有 LOCAL runner 只覆盖 Identity/C9-I | 修改 native adapter 时才补明确 LOCAL 模式及独立资源边界；M1 不为此先建一轮测试工程，不伪造 GitHub 标记或复用 55432 cluster |
| 页面与业务 | M1、M2 及 M3 TEXT_RESPONSE/Attempt/Submission 的 UI/API/PG 已 LOCAL_VERIFIED；M4 人工评分/成绩发布/留痕更正已 LOCAL_VERIFIED | 下一步 M5 启用范围与内容/Runtime 接线 |
| HTTP 运行接线 | localhost host 用正式 `createIdentityComposition` / `createIdentityHttp` 的同一个私有 root 接 Identity 与 Academic；独立开发 PG16 与受控 HTTPS | 使用 `pnpm dev:zhiban`；实际 UI/API/PG16 已 LOCAL_VERIFIED，生产 OPS 与后续 capability 边界另验 |
| 数据库 | 已应用 migration 0001–0013；PG 测试 runner 会清理固定 fixture schemas/roles | 开发数据与 disposable 测试 cluster 分离；不把持续演示数据放入 55432 fixture 库 |

已签收的 SHA/run/count 保留各自历史意义。近期 C9 的 `438 ×2` PG16 和 `62` native PASS 是基础层完成证据，后续不为完成文档或业务无关改动再跑一次。

## 2. 交付方式调整

每个工作包交付一个能在本机使用的功能。设计说明、后端、页面、自审、必要验证和短记录放在同一个周期，普通缺陷当轮修复。默认不再把每个工作包拆成 DESIGN checkpoint → BUILD checkpoint → GitHub CI signoff → CLOSEOUT checkpoint 四次往返。

新 schema、权限目录、评分/提交规则或外部能力确实需要决定时，先提供足以实现的简短方案，集中确认相关问题；同一已批准工作包内不再为普通实现选择重复确认。现有冻结权限、Session/Credential 语义、已应用 migrations 和 OpenMAIC 公共包边界继续适用。

开发验收以 **LOCAL_VERIFIED** 为有效完成状态，无需等待 **CI_SIGNED_OFF**。报告记录实际代码/配置/依赖指纹、命令、结果和未覆盖范围；不把 LOCAL 写成 GITHUB_ACTIONS。允许按里程碑合并 checkpoint 与交付记录；commit/push 仍按用户授权执行，生产数据、付费调用、外部部署仍需明确授权。

### 验证的工作量与改动风险相称

| 改动 | 本地默认验收 | 扩大验证的条件 |
| --- | --- | --- |
| 文档 | 变更文档的格式、链接、事实与 diff | 不跑 PG、全仓库测试或 GitHub CI |
| 页面/样式 | 页面实际打开、受影响流程；变更文件 lint，交付前 typecheck | 改认证、数据写入或共享组件时补对应测试 |
| 业务 API/用例 | 一条真实正向旅程、相关失败/越权路径、受影响单元与依赖回归 | 新持久化/并发/权限边界用真实 PG16，不能由 mock 代替 |
| migration/ACL/事务 | 对应 PG16 schema、权限、升级/回滚/CAS/竞态测试，默认一次完整相关选择 | 改 fixture 清理/重复初始化则重复其相关流程；竞态用独立连接/明确 barrier，不能靠盲目重复全套证明 |
| OpenMAIC adapter/版本 | 受影响公共 provider 的真实本地调用、协议/provenance/ACL 检查 | 上游或 lock/build 变化时重新生成相关 artifact/receipt；未变且指纹匹配时复用已有 build |
| 里程碑交付 | 本地 UI→API→PG 旅程，受影响域回归，typecheck/lint、变更范围格式检查 | 本地 host/build 路径变化时做相应 build；首发验收跑完整启用功能旅程 |

测试只补真实行为风险，不为字段清单、逐行实现或已覆盖的同一合同再造一套重复断言。既有测试保留，日常按影响选择；改变共享 Identity/security/helper 时才扩大到其完整回归。真实失败修复原因后验证，不用重试次数掩盖失败。必需路径的 skip/缺失不是 PASS；不相关 optional suite 可明确不执行。

GitHub CI 默认 **不派发**。只有本地无法覆盖的 runner/系统差异、上游同步、协作方要求或发布复核确有需要时，说明增量价值后按用户授权运行明确选择。单纯因为已经 commit/push，不再自动全套远端重测。CI workflow 保留，本次只调整调用策略。

## 3. 新推进顺序：七个可验收里程碑

M1 → M2 → M3 → M4 是首先建设的教学闭环。M5 先接入受控 slide 内容/资源，再按门禁接 Runtime 与 authoring AI；M6 补教学治理；M7 完成高级能力。上线/迁移准备按实际 release 穿插，不必等全部高级功能才做有限试点，也不把有限试点称为全量迁移。

| 里程碑 | 用户在本机能做什么 | 复用原 UNIT | 完成标准 |
| --- | --- | --- | --- |
| M1 本地可运行的身份与工作台 | 启动、登录、看本人、选择空间、退出；看实际空工作台与拒绝/失效状态 | 1B-11、5A；1B-10/OPS-A 的本地 host 最小部分 | 新进程可启动、真实 API/PG 登录、刷新保留 Session、退出失效；不伪造业务数据 |
| M2 建课、开班、选课 | 管理员创建课程/学期/教学班并分配教师、加入学生；教师/学生看各自范围 | 2A、2B，5B–5D 的对应页面 | 操作存库、重启后可读、其他租户/非任教教师无法访问；不用仅后端无页面的交付 |
| M3 活动发布、学生提交 | 教师建活动/作业草稿并发布；已选课学生打开、开始自己的 Attempt、提交，教师看提交列表 | 2C、3A、3D，5B–5D 增量 | draft 不泄露、版本固定、提交可追溯、不串学生；真实课程资格控制读写 |
| M4 评分、成绩与教学闭环 | 任教教师评分、发布/更正；学生只看自己已发布成绩与经规则确认的进度 | 4A、4B、3C，5C/5D 终验 | 两租户的建课→发布→提交→评分→读成绩完整可用；进度/成绩来源清楚 |
| M5 内容编辑、Runtime 与受控 AI | 首批 A–C：纯文本/PNG slide 编辑、发布、预览与受控资源；D Runtime、E AI 条件交付，见 [M5 范围](zhiban-v2-m5-scope.md) | 2D、1B-9 业务接线、3B、D08/D09、1B-10 enabled Bridge | 每一种启用能力有真实业务授权与 provider 证明；unsupported 能力仍关闭 |
| M6 导入、画像、分析与干预 | 导入预览/审批、教师统计、学生画像、概念错误、干预与必要通知 | 2E、4C、6A–6D、5B–5D 增量 | 指标/规则可解释、重算和纠错可追溯、隐私权限明确；只为实际业务引入 jobs/outbox |
| M7 完整课堂与扩展能力 | 完整 Classroom/Playback、Interactive/VirtualLab、PBL，以及经单独决定的 Tutor/EMA/AI Peer | 7A–7F | U01/U02 支持契约与真实 host 完成；REVIEW 能力有明确决定；最终不丢 V1 保留需求 |

### M1 的实际前置工作

1. 定义并实现 localhost 专用 HTTPS host/入口范围，满足现有 Secure cookie、Origin/CSRF、单进程和可信代理合同。直接运行根 `pnpm dev` 不能据此证明原生路由隔离；使用公开包的受控 host 方案须先检查 ADR-013/014，若需要新的 topology，先提出精确方案。
2. 使用独立开发数据环境，明确 cluster/port/database 与 runtime roles；端口在实施前检查，不能向受限 55432 测试 cluster 添加开发库或放宽其 guard。M1 可以使用合成身份，但实际请求必须经过正常身份/权限链。
3. 完成本地配置 loader、RoleCatalog、密码筛查、密钥/批准材料的非生产配置与启动接线；复用受控 provisioning/onboarding，不复制 test factory 成为生产默认，也不虚填 production acceptance 引用。缺失项显示可操作的启动说明。
4. 做登录、空间选择、退出与工作台壳；控制面保持独立，尚无课程时展示真实空状态。公开恢复入口继续关闭，既有人工恢复不用重做。

M1 的界面工作可与本地 host 接线在同一工作包推进，但仅有静态页面不能标 M1 可用。其本地运行验收只证明开发环境；生产 OPS 责任仍另行落实。

### M3/M4 的最小产品范围建议

为了尽快看到教学闭环，建议第一条旅程采用 **教师手工录入文字活动/作业 → 学生文字提交 → 教师人工评分**。文件上传、真实 AI、完整播放、互动实验后续逐项接入；不是复制一份模拟 Runtime 或把 transcript 当成绩。

M3 已经用户明确决定：文字活动支持教师配置截止时间、允许/禁止重交及尝试次数限制；具体生效/历史规则与 LOCAL 证据见 [M3 记录](zhiban-v2-m3-learning.md)。这**尚未成为批准的 R1 release manifest**；M4 已落实按具体 Submission 人工评分、显式满分、草稿/发布分离和带公开说明的留痕更正，见 [M4 记录](zhiban-v2-m4-assessment.md)；课程总评、及格与完成规则仍 deferred。最终 R1 若明确需要 slide/editor/generation/Runtime，则对应 M5 能力必须完成才可发布，不能用文字闭环替代其要求。

### 1B-10 与 1B-12 的新位置

1B-10 是随启用能力落实的集成门禁：M1 验身份与 host，M2–M4 验真实业务权限，M5/M7 验 enabled Bridge、资源、Runtime/stream 撤权。真实业务模型出现前，不再要求做一套假资源的“全系统集成”。最终仍按实际 release 汇总其覆盖，不能提前标 `PHASE_1B_COMPLETE`。

1B-12 的 handoff/manifest 放到启用范围明确后，合并到对应里程碑验收记录。局部身份系统可用不表示全部 Bridge/课堂完整；这些状态在同一 ledger 中记录即可。

## 4. 全项目能力追踪（原 36 项全部保留）

M 是交付顺序，原 UNIT 是职责定位；一项能力可以分多次交付。下表不更改 [V1 inventory](v1-capability-inventory.md) 的 KEEP/REWRITE/ADAPT/REVIEW/REMOVE 决定。

2026-10-08 已逐页核对只读 V1 branch `feature/zhiban-mechatronics`（55 个 `app/zhiban/**/page.tsx` 路由，HEAD `0fa0a15e8b12ae9e4f7a2d78e80338874599bbae`）；页面组件职责、V2 保留阶段和 M3 实施前规则见[页面保留审计](zhiban-v2-v1-page-retention-audit.md)。完整旧业务需求均按阶段保留；这是逐步重写，不承诺旧 URL/实现兼容。

| V1 # | 能力 | 推进位置 / 当前状态 |
| --- | --- | --- |
| 1 | 身份认证 | foundation 已完成；M1 接运行配置/UI；生产恢复/OPS 独立 |
| 2 | Tenant | foundation 已完成；M1 空间导航，M2 实际业务租户边界 |
| 3 | RBAC | foundation 已完成；各 M 的新增业务 permission/catalog 先明确后接入 |
| 4 | Student 体验 | M1 壳、M2–M4 真实旅程、M5–M7 增量 |
| 5 | Teacher 体验 | M1 壳、M2–M4 真实旅程、M5–M7 增量 |
| 6 | Admin 控制台 | M1 控制面分离、M2 运营、M6 导入/治理 |
| 7 | Academic organization | M2 学期/必要元数据；M6 目录；复杂组织树待决定 |
| 8 | Course | M2 |
| 9 | AdministrativeClass | M2，与 TeachingClass 分开 |
| 10 | Offering/TeachingClass | M2 |
| 11 | Enrollment | M2；M3–M5 资格撤销接线 |
| 12 | Activity/content | M3 定义/版本/发布；M5 受支持内容/AI |
| 13 | Scene orchestration | M5 合同内子集；M7 完整公开 host |
| 14 | Classroom | M5 业务 dispatch；M7 U01 完整能力 |
| 15 | PBL | M7，REVIEW 决策先关闭 |
| 16 | Interactive HTML | M7，U02 与 sandbox gate |
| 17 | LearningEvent | M3 合同/持久化；M4 进度；M5/M7 可信 Runtime 证据 |
| 18 | Attempt/progress/completion | M3 Attempt；M4 approved completion；M5/M7 执行证据 |
| 19 | Assessment | M4 人工评分；需要时再补 approved engine |
| 20 | ConceptError | M6 |
| 21 | LearnerProfile | M6 |
| 22 | Six-Dimension Profile | M6 前先决定维度/证据；不把 V1 五维 UI 当六维规范 |
| 23 | Remediation | M6 |
| 24 | Risk | M6，规则/权限/隐私/责任先明确 |
| 25 | Grade | M4，未定申诉/权重规则集中决定 |
| 26 | EMA | M7，REVIEW 产品定义先关闭 |
| 27 | VirtualLab | M7，保留 REQUIRED_LATER 依赖 |
| 28 | AI Tutor | M7，具体受控用途和评测 |
| 29 | AI Peer | M7，REVIEW 与安全责任独立决定 |
| 30 | Agent support modes | M5 authoring、M7 tutor/support；不接通用原生 agent |
| 31 | Teacher analytics | M6 首个本地可用页面已交付：当前活动提交/已发布人工成绩汇总与学生明细；[口径与证据](zhiban-v2-m6-teacher-analytics.md) |
| 32 | Student dashboard | M6 学生个人概览已本地可用：本人当前活动、提交/已发布成绩汇总、公开反馈、更正说明与历史尝试；[口径与证据](zhiban-v2-m6-student-overview.md) |
| 33 | Admin import/directory | M6 已本地交付已有学生名册导入及[管理员学生目录搜索/分页](zhiban-v2-m6-student-directory.md)，支持跨页选择生成 CSV；账户/角色批量开通与其他教务大名单分页未交付 |
| 34 | Monitoring/intervention | M6，并按实际使用顺序先完成必要 notification/work |
| 35 | Coursework/files | M3 文字提交；文件单独补 Asset/扫描/下载条件；M4 反馈评分 |
| 36 | Competition mechatronics | 原 REMOVE_FROM_CORE 决定保留，不移入平台核心 |

## 5. 发布与真实数据迁移

开发、本地教学闭环、试点上线、全量迁移分别记录。M4 后可针对已批准的最小 release 做 OPS/DATA 试点；如果 release 必需能力位于 M5/M7，先完成对应能力。

- OPS-A 的本地启动部分在 M1 提前，生产 TLS/网络/密钥/备份/恢复/容量/日志责任在试点前完成；M5/M7 按启用能力补 host 隔离。
- OPS-B 的真实 UI/API/PG 旅程随 M1–M7 累积，到 release 候选本地集中验收一次；目标环境差异到隔离 staging 验证，无需机械地再跑 GitHub 同一套。
- DATA-A/B 先按批准范围做来源盘点、合成/脱敏演练、幂等导入与关系/成绩/资源对账。真实数据提取和 cutover 只在 DATA-C 明确授权后做。
- OPS-C 人工 UAT 和回退演练、OPS-D 生产窗口与签收按原职责保留。证据可以来自本地或目标 staging，必须记录真实环境；不得用 CI 的有无代替上线验收。
- U01/U02 等全量需求和所有 REVIEW 项有明确处置前，不能写 `FULL_MIGRATION_COMPLETE`。有限试点记 `PILOT_ONLY`。

## 6. 后续任务与短记录

2026-10-14 产品主线更新：[M5-C PNG 完整本地闭环](zhiban-v2-m5-c-png.md)完成 disposable LOCAL 验收，沿用 A/B 文本空白与公开 provider，新增受控图片编辑和资源 gateway。A–C 已有本地功能；真实55433的当前源码安装及完整启用签收另列，D/E未完成。维护恢复候选、独立复评和真实输入待补保持隔离，停止作为每轮产品推进的串行前置。下一功能为 M6 教师统计首个可用页面，按当前教学数据的实际证据和权限交付，不从 Runtime 聊天推断成绩或完成。以下维护候选描述保留其历史范围。


M1、M2、M3、M4 均为 `LOCAL_VERIFIED / UNCOMMITTED_CANDIDATE`，启动、证据与边界见 [M1 本地工作台记录](zhiban-v2-m1-local-workspace.md)、[M2 课程与班级交付](zhiban-v2-m2-academic.md)及 [M3 活动与提交记录](zhiban-v2-m3-learning.md)。M3 基于真实任教与 Enrollment 完成可配置文字活动发布、个人 Attempt 和版本化提交；M4 人工评分、成绩发布与留痕更正见 [M4 记录](zhiban-v2-m4-assessment.md)；[M5-A/B 精确设计与 D08 包/纯文本 host 检查](zhiban-v2-m5-ab-design.md)已产出；M5-A/B 已完成本地 installer、技术 receipt 与文本编辑发布，产品 19/19、相关安全负向 25/25、撤权屏障 26/26、installer 5/5，见 [实际交付与证据边界](zhiban-v2-m5-ab-local-closeout.md)。[installer/receipt/enabled composition 独立复评](zhiban-v2-m5-installer-enabled-review.md)和剩余撤权屏障已完成。**UNKNOWN/RESERVED 只读对账报告已完成**（用户选择保持全部隔离），LOCAL 20/20、host 冒烟 5/5，见 [精确设计与证据](zhiban-v2-m5-readonly-reconciliation.md)。公开 Native manifest 只能证明 scoped refs/顺序，内容摘要及终态未证明；只读评审 R1/R2 已修复并 LOCAL 9/9；[终态处置精确设计](zhiban-v2-m5-terminal-reconciliation-design.md)已完成 R2 修订（TR-01–03 ADDRESSED_IN_DESIGN），见[修订核对](zhiban-v2-m5-terminal-reconciliation-review.md)。[未应用 SQL/helper/ACL/receipt 与恢复计划候选](zhiban-v2-m5-terminal-candidate-inventory.md)已产出，静态 9 组 PASS、运行 NOT_RUN；下一步定向评审候选，再实现 installer/loader、proof worker 与维护执行器；写入结算/解除隔离保持待办；C PNG/D Runtime/E AI 与生产门禁继续 deferred，无需重新安排 C9 或同内容 GitHub CI。

每次交付只需记录：基线与变更范围、用户如何启动/使用、实际本地验证、权限/持久化限制、尚待决定项、下一个功能。未来新交付状态可用 `IN_PROGRESS` / `LOCAL_VERIFIED` / `RELEASE_ACCEPTED`；历史 CI/FROZEN 状态继续保留。

默认任务约束：本地实现与必要验证；不自动 commit/push、dispatch GitHub CI、访问真实数据、调用付费 provider 或部署。用户明确授权过的同一范围无需重复确认。

M6 教师统计首个页面（2026-10-15）已形成可访问的 LOCAL 产品闭环，见[交付记录](zhiban-v2-m6-teacher-analytics.md)。下一产品包为学生个人概览；不将画像/风险/维护复评作为统计页面前置。无提交、推送或 CI dispatch。

M6 学生个人概览（2026-10-15）已完成[本地产品闭环](zhiban-v2-m6-student-overview.md)，真实 PG16/HTTPS 16/16、相关回归 48/48。下一建议为管理员受控名册导入最小闭环，未自动实施；画像/风险与维护输入继续独立待办。NO COMMIT/PUSH/CI。

M6 管理员受控名册导入（2026-10-15）已完成[本地闭环](zhiban-v2-m6-roster-import.md)，参考候选真实 PG16/HTTPS 14/14、相关回归 51/51；最终显示增量由内置浏览器单独绑定验证。文件只接受已有学生 Membership ID，不创建身份/角色或恢复已退班关系；逐行原子，部分失败与 UNKNOWN 明确报告。下一建议为管理员学生目录搜索与分页。NO COMMIT/PUSH/CI。

M6 管理员学生目录（2026-10-15）已完成[LOCAL 交付](zhiban-v2-m6-student-directory.md)：姓名/完整 ID 查询、当前/历史筛选、10/20/50 人游标分页和名册导入跨页选择。真实 PG16/HTTPS 15/15、相关回归 55/55、定向类型/ESLint 通过；620 条姓名匹配及大于 500 的目录完整遍历，未读取整租户 AcademicSnapshot。其他教务快照上限未变，下一建议教学班/Enrollment 分页。NO COMMIT/PUSH/CI。

M6 教学班与 Enrollment 大名单分页（2026-10-15）：[管理员产品闭环](zhiban-v2-m6-management-pagination.md)增加独立教学班/单班 Enrollment 搜索、状态和 10/20/50 游标分页、分页转班目标，以及无整租户快照的命令 ACK。沿用原容量/CAS/审计/转班事务；课程/学期/行政班/任教及师生旧快照仍待改造。下一建议为主数据分页及新建教学班有界选择器；本地验收和演示来源见对应记录，NO COMMIT/PUSH/CI。

M6 课程/学期/行政班分页及新建教学班选择器（2026-10-15）：[产品范围与来源](zhiban-v2-m6-catalog-pagination.md)扩展管理员分页入口，支持主数据分页/搜索、原命令支持的新建及课程编辑发布归档、三个独立有界选择器建班；原课程版本/容量/授权事务不变。下一建议任教关系和行政班成员分页及教师受限搜索。真实环境与维护输入保持隔离，NO COMMIT/PUSH/CI。

M6 任教关系／行政班成员分页及教师受限搜索（2026-10-15）：[管理员产品闭环](zhiban-v2-m6-relationships.md)实现两类关系搜索、状态与 keyset 分页，指定／结束／恢复任教、学生目录添加／移出／恢复班级成员、班主任设置／清除。教师搜索限定当前租户和指定目标及当前教师身份，仍由原授权范围决定课程访问，不授角色。PG16/HTTPS/UI 10/10、回归 29/29；下一建议教师／学生工作台课程分页。NO COMMIT/PUSH/CI，真实维护输入隔离不变。

M6 师生工作台课程分页（2026-10-15）：[可用行为与 LOCAL 范围](zhiban-v2-m6-member-workspace.md)完成教师／学生入口独立课程搜索、状态和 10/20/50 keyset 分页，教师名单独立分页，按每门课的真实角色／关系显示入口，课程元数据保持固定发布版本。真实 PG16/HTTPS/UI 9/9，相关回归 53/53；下一建议管理员入口直接接分页教务管理。学习记录自身分页及 M5 实际启用不在此证据范围，NO COMMIT/PUSH/CI。

M6 管理员工作台直接接分页教务（2026-10-15）：[交付与 LOCAL 边界](zhiban-v2-m6-admin-workspace.md)。管理员由服务器 bootstrap 选择并在原工作台直接挂载分页管理，独立页面共用组件；移除管理员主路径的旧快照和目录权限探测依赖，保留原管理写入及全部分页入口。独立 PG16 56509／受信 HTTPS 3453 验收 23/23、相关回归 53/53、定向类型／ESLint／格式检查通过。真实环境／M5 维护隔离未变，NO COMMIT/PUSH/CI。下一建议学习活动及提交记录分页，模型 GPT-6.1 Sol / medium。

M6 学习活动与提交记录分页（2026-10-15）：[可用页面与 LOCAL 范围](zhiban-v2-m6-learning-records.md)。活动／单活动尝试／单尝试提交分别分页，评分按精确提交读取并分页更正历史；服务器完整历史决定最新标记与次数，写入规则不变。PG16 56510／受信 HTTPS 3454 验收 12/12、相关回归 68/68，定向类型／ESLint／格式检查通过。旧聚合接口及其他概览／统计范围保持，维护隔离不变，NO COMMIT/PUSH/CI。下一建议教师待评分列表与筛选，模型 GPT-6.1 Sol / medium。

M6 教师待评分与筛选（2026-10-15）：[直接评分页面与 LOCAL 范围](zhiban-v2-m6-grading-queue.md)。任教班工作台进入按活动／学生／状态查询的分页最新正式提交队列，支持直接保存、发布及更正；默认未评分＋待发布，历史更正仍从学习记录进入，写入合同不变。独立 PG16 56511／HTTPS 3455 验收 12/12、相关回归 72/72，定向类型／ESLint／格式检查通过，无 migration／ACL／冻结语义变更。下一建议课程负责人受限选择器，模型 GPT-6.1 Sol / medium；NO COMMIT/PUSH/CI，真实环境隔离保持。

M6 课程负责人受限选择器（2026-10-15）：[产品与证据范围](zhiban-v2-m6-course-owner.md)补齐管理员新建／编辑课程的有效教师搜索、10/20/50 分页、选择／保留／清除及提交前候选复查；负责人仍是元数据，原 ACTIVE 成员写入合同与不可变发布版本不变，不增任教／角色。独立 PG16 56513／受信 HTTPS 3457、本地回归与负向验证；不触发 CI 或真实维护输入。下一建议管理员操作历史分页只读入口，模型 GPT-6 Sol / medium；NO COMMIT/PUSH/CI。

M6 管理员操作历史（2026-10-15）：[只读分页入口与范围](zhiban-v2-m6-management-history.md)展示已提交教务审计的最小字段，支持关键词／类型／UTC 日期、10/20/50 及时间＋ID 游标分页；原始 facts／命令号不返回，不汇聚其他模块／失败日志。PG16 56514／受信 HTTPS 3458，本地验收 10/10、相关回归 32/32；当前管理员检查、租户 RLS 与原审计事务不变，无 migration／ACL 变更。下一建议整理可试用版本、演示账号角色和启动入口，模型 GPT-6 Luna / medium；真实维护输入继续隔离，NO COMMIT/PUSH/CI。

本地试用候选（2026-10-15）：[统一试用指南](zhiban-v2-trial-guide.md)收拢 M1–M4／M6 到独立 3459／PG16 56515，提供管理员／教师／学生本机私有账号、同一教学班数据、启动／info／受限停止命令和十分钟试用顺序。使用五项短冒烟，不重复全套功能 CI；M5 内容／PNG／Runtime 仍按原隔离边界，不冒充统一实例已启用。下一步收集三角色真实使用阻碍并修复，GPT-6 Sol / medium；NO COMMIT/PUSH/CI。

三角色手工试用（2026-10-15）：[流程与问题清单](zhiban-v2-trial-uat.md)记录同一内置浏览器的管理员／教师／学生实际操作；评分发布、学生提交、更正与统计闭环走通，发现 UAT-01 新尝试入口含糊、UAT-02 名单历史缺少涉及成员，两项 P2 均 OPEN。本轮只记录不修复、只改合成试用数据；实例已推进到 94 分更正及巡检尝试 2 草稿。下一步依次修复两项并局部验证，GPT-6 Sol / medium；NO COMMIT/PUSH/CI。

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
