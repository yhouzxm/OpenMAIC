# Phase 1B-8E — Recovery Channel / Controlled Manual Recovery Decision

STATUS: HUMAN_APPROVED_DESIGN / FROZEN

Date: 2026-10-04. Branch: `refactor/zhiban-v2`. Audited HEAD: `95e96b64a53e772eff0c65f739dac7573513681e` (`docs(zhiban-v2): close out identity http api layer`), parent `a82f101becebd26343a53224ab61a5274d597b3f`. Preflight worktree: CLEAN.

本单元按用户“单独决定 1B-8E 恢复渠道与受控人工恢复方案”形成方案。2026-10-04 用户随后明确要求“审阅并批准 E8-S01–S08”；八项经实际契约审阅与第 10 节限定澄清后 HUMAN_APPROVED_DESIGN / FROZEN。原有公共找回关闭继续生效，具体现场人工恢复方向已获本次设计批准。此前“推荐/提案”描述方案形成过程，不代表以下八项仍待选择；精确 schema/ACL/私有 transport、具名运营配置和实施验收仍是独立 gate。本文不建立渠道、数据库对象、HTTP 接口或生产恢复能力，不 commit/push/dispatch。

## 1. Authority and actual assets

权威为 [执行计划 1B-8E](../zhiban-v2-execution-plan.md)、[已批准的 A8/B8/C8 设计](phase1b-8-identity-composition-design.md)、[1B-8D 设计](phase1b-8d-http-api-design.md)与[closeout](phase1b-8d-review.md)、[Credential 设计](phase1b-5-credential-design.md)、[认证边界](auth-boundary.md)、[Session 策略](session-strategy.md)、[ADR-010](../adr/ADR-010-authentication-session.md)。它们冻结 global User/Credential/Session、独立 control-plane、CAS/epoch、approval/audit 和 tenant authorization，不能把 Tenant 管理员权限当全局密码恢复权。

代码事实包括 [Credential Port](../../../lib/zhiban/application/identity/ports/credential-repository.ts)、[Credential repository](../../../lib/zhiban/infrastructure/identity/postgres/repositories/credential.ts)、[authentication composition](../../../lib/zhiban/infrastructure/identity/composition/authentication.ts)、[operator provisioning](../../../lib/zhiban/infrastructure/identity/composition/operator.ts)、[control approval](../../../lib/zhiban/infrastructure/identity/composition/control-approval.ts)、[closed audit](../../../lib/zhiban/application/identity/ports/audit.ts)、[HTTP root](../../../lib/zhiban/infrastructure/identity/http/root.ts)和现有 0001–0009 migration/workflow。

| Actual asset | State / recovery implication |
| --- | --- |
| Argon2id、mandatory screening、Credential slot/history/revision/epoch | EXISTS / FROZEN，可复用安全计算和状态语义 |
| 已登录本人换密码 | EXISTS，要求本人当前密码，不能作为忘记密码旁路 |
| Credential `replacePassword` | EXISTS，可针对当前 ACTIVE 或明确批准的 revoked slot 建新 generation；公开 standalone 方法自有事务，不能组合多个 client 宣称 reset atomic |
| Session expiry、epoch/User revision binding | EXISTS；reset epoch 变化即时使旧 Session 失效，不须在持 slot 锁时调用 revoke-all |
| Operator `FIRST_PLATFORM_ADMIN` / `FIRST_PASSWORD` | EXISTS，限定 one-time bootstrap/从无 slot 首次配置；不能拿旧 provision record 重置已有 Credential |
| Existing `ACCOUNT_RECOVERY` audit reason / `CREDENTIAL_REPLACED` | EXISTS，是审计词汇，不是恢复审批或执行能力 |
| 原始全局 person ↔ UserId 身份登记、具名恢复负责人、独立通知渠道 | ABSENT / NOT_CONFIGURED；没有从 UserId、Membership、support ticket 推导身份的能力 |
| 恢复 case、审批消费、限时 digest、撤销与通知 outbox | ABSENT，需要另行精确 schema/ACL 设计 |
| 普通 auth runtime 同事务复核 SystemAdminGrant | GAP；现有 SystemAdminGrant SELECT 属 control runtime，不能为方便授 auth 整表 SELECT |
| Public recovery/reset/email/SMS API | CLOSED，8D 无这些路由 |

基线证据是 [run 37156652308](https://github.com/yhouzxm/OpenMAIC/actions/runs/37156652308)：`a82f101...` 上 PG16 282/282 ×2、非 PG Identity 1331/1331、lint/typecheck PASS。当前 HEAD 仅增加 8D closeout；这些结果不证明任何新恢复机制。本单元不重跑测试。

## 2. Approved decisions — E8-S01–S08

已批准首版选择 `ATTENDED_MANUAL_RECOVERY_V1`：平台认可的原始身份记录为依据，现场本人重新核验，由独立人员批准，在专用受控 HTTPS 恢复终端上完成新密码设置。邮件/SMS/聊天、远程视频、客服知识问答、通用临时密码和公共自助入口保持关闭。

| Contract | Human-approved decision |
| --- | --- |
| E8-S01 — 渠道与范围 | 只处理已有全局 User 的现场人工 PASSWORD 恢复；public forgot/reset CLOSED，无 email/SMS provider；普通 User 可有 tenant 管理角色，存在任何 SystemAdminGrant 历史的账号及平台自救另审 |
| E8-S02 — 身份来源 | 必须有事先批准、绑定 canonical UserId 的平台原始身份登记；现场重核验与该记录一致，Tenant roster 只作佐证；缺绑定拒绝 |
| E8-S03 — 人员与审批 | 本人、独立身份核验员、执行/批准的当前 SystemAdmin 三者不同；至少两名工作人员，核验员独立于执行者；当前 Session＋每次敏感操作 step-up＋明确恢复 manifest |
| E8-S04 — 单次票据 | Case/审批 30min、票据 10min、单次有效；256-bit CSPRNG opaque ticket，DB 只存 purpose-bound SHA-256 digest；绑定 subject、case、环境、原版本、站点和交付记录 |
| E8-S05 — 原子完成 | 同一个 auth client/transaction 复核主体、操作者、批准、票据和 CAS，consume＋新 Credential/history＋epoch/revision＋audit＋safe outcome＋通知记录全提交或全回滚 |
| E8-S06 — 审计与独立通知 | 现有 `CREDENTIAL_REPLACED`/`ACCOUNT_RECOVERY`＋closed case provenance；完成事务记录无 secret 通知待办，独立核验员通过事前登记渠道通知本人并登记回执 |
| E8-S07 — Secret / transport / ACL | 本人设置密码、工作人员不索取/传达密码；私有恢复终端与现有公共 namespace 分离；tenant/control 无 Credential verifier 新权限，精确最小 helper/列权限另审 |
| E8-S08 — 验收与例外 | replay、expiry、cancel、并发、旧 Session、审批撤销、审计/通知回滚、真实角色 PG16 与受控演练均必验；平台管理员/无独立执行者/无原始绑定不能 fallback |

30min/10min 为本次已批准的首版安全参数，不声称是标准规定；调整需设计变更审阅，不允许运行时延长旧 case/ticket。名册、人员、场所、证据库与通知渠道的真实值属于另行批准的部署 manifest，不写猜测值或真实个人证据到 Git。

## 3. E8-S01 / S02 — Identity and channel

目标属于 GLOBAL User。Membership/tenantId/RoleGrant 既不选择另一份密码，也不证明自然人的身份；单个 Tenant 的管理员、任教关系、学号、姓名、手机号尾号、生日或知道 UserId 都不能授权恢复跨 Tenant 的 global 账号。恢复不改变任何 Membership、RoleGrant、authorizationVersion 或 User 状态。

允许的恢复依据是平台在原始开户时已核验的 external enrollment identity record，明确绑定 canonical UserId、issuer、原开户批准/版本与 person reference。核验员从已批准独立记录系统读取，不接受申请人上传的 JSON、截图或临时拼出的 UserId 映射。现场本人持原核验方案认可的身份材料，核验员按同一批准流程确认与原始登记是同一人；不新增未经评估的生物识别或自动识别 provider。跨机构账号须基于平台级绑定，不能只由其中一个机构重新指认所有者。

现有 User aggregate 没有这种登记契约；FIRST/bootstrap approval 也不能自动当作人员证件核验记录。因此 `MISSING_ORIGINAL_IDENTITY_BINDING` 必须拒绝，不能事后把“姓名相同”补成历史 proof。新增登记、历史 V1 对应关系或更换通知联系人需要独立设计与批准，不能借恢复顺带迁入 V1 数据或创建另一个拥有相同权限的新 User。

工作人员检查实体证据时按批准的隐私流程处理。数据库/审计只保存不可泄露的证据引用、核验方法版本、批准人、时间与 verdict，不存证件影像、证件号码、住址、聊天正文或对这类低熵内容直接 SHA-256 后当匿名 proof。证据保管期限/访问责任另属具名运营配置。

首版申请由现场服务台登记安全 case reference。公开站点既不查询某 User 是否存在也不发行票据；人员接到邮件/聊天只能邀请本人到场，不能据此执行 reset。只有完成 proof、独立批准后才生成 ticket。申请、登记或核验失败本身不 disable User、不撤 Session、不改 Credential，避免将 support 流程变成恶意锁号工具。疑似泄露时安全停用/撤销仍走已有独立批准的 incident/control 流程。

## 4. E8-S03 — Authority and approval

角色必须明确分工：subject 为被恢复本人；identityVerifier 为平台事前授权的身份登记负责人；executingApprover 为不同的 ACTIVE 全局 User，具当前有效 SystemAdminGrant，并持当前真实 Session。核验员不得以目标 Tenant 的管理权限替代平台任命。执行者和核验员均不得是 subject，也不得互相使用相同账号/证据签署凭据冒充两人。

信任来源是 approved RecoveryEvidenceStore 对独立人类核验/审批、不可变 manifest、当前任命/撤销和环境的实际校验；不接受 `approved:true`、argv/body 的 operatorRef、签了名但来源不受信的字符串或测试默认 store。现有 FIRST/Control stores 可借鉴信任接口，但不能扩宽旧 purpose allowlist。恢复有专用 purpose `MANUAL_PASSWORD_RECOVERY` 和专用闭集命令，不修改旧 control commands。

Manifest 至少绑定 caseId/approvalRef、target UserId、expected User revision、expected slot revision/epoch/current CredentialId（可以明确 null）、executing UserId、其 User/slot/epoch/SystemAdminGrant expected versions、核验员任命与证据引用、source/enrollment version、环境/恢复站点、issuedAt/expiresAt 和通知 route reference。批准不能包含 new password、hash/verifier、ticket digest 或 secret fingerprint。真实签名/证据传递方式与验证 key 生命周期必须在配置设计中精确选择并验收；没有批准 store 时整个功能关闭。

执行者在发行票据和完成 reset 时各自使用当前 Session 并做当前密码 step-up，沿用既有请求内 action/target/intent-bound proof，最长 5min；ticket 不替代工作人员的最新 authority。遗失的目标密码不是必需输入。任何 actor authority、target version、原始记录或 approval validity 变化均使旧批准失效，要求重新核验/批准，不能自动更新 expected versions。

外部 evidence store 返回的已核验 manifest 是不可变证据，不能凭一次读取将随后外部撤销忽略到 case 过期。任命、enrollment/contact 版本和 approval 的可执行状态须落实为同库可锁定的版本/撤销锚点；受控变更流程先阻止发行并取消相关 live case，再发布新的外部版本。完成只复核同 client 的有效锚点与原 manifest 绑定，不在持 PG 锁时调用远程证据/通知服务，不宣称 PG 与外部系统具有跨系统 ACID。外部 store 若允许绕开该变更流程、状态不确定或同步失败，恢复入口关闭；具体同步责任、登记/撤销协议与 SQL anchor 在精确补充中审阅。

存在任何 SystemAdminGrant 历史（含 revoked、expired、future）的目标不 eligible 普通恢复；已知正在平台管理员治理/安全调查中的主体也保持关闭。这个保守首版选择避免凭当前恰好无有效 grant 绕过 privileged recovery。提交事务必须从可信记录复核 privileged eligibility，不能由浏览器声明“普通用户”。唯一或所有平台管理员失去认证、执行者想恢复自己的密码、独立核验员缺席等情况均拒绝；需要另行批准的 offline custodian quorum / break-glass 设计，不能复用 FIRST 或 owner/migrator 连接。

## 5. E8-S04 — Ceremony, lifecycle and ticket

流程：登记 → 原始绑定确认/现场核验 → 独立批准 → 当前执行者 step-up → 现场交付票据 → 本人私密输入新密码 → 当前执行者再次 step-up 与确认 → 原子完成 → 独立通知/回执 → 本人重新正常登录。身份核验、批准、票据 possession、用户新密码和工作人员当前权限是不同事实。

Case 状态采用闭集：`REGISTERED → VERIFIED → APPROVED → TICKET_ISSUED → COMPLETED`；未完成状态可 terminalize 为 `REJECTED`、`CANCELLED` 或 `EXPIRED`。终态不能重开。30min case validity 从 VERIFIED 计起，批准不能刷新它；票据期限为 `min(issuedAt+10min,caseExpiresAt)`。数据库时钟在取得锁之后和 COMMIT 前检查，边界 `at >= expiresAt` 拒绝；非单调时间异常拒绝。

Ticket 使用 server CSPRNG 32 random bytes，独立 `mrec1_` 类型前缀与严格编码；数据库仅保存 purpose-separated SHA-256 canonical digest 和安全绑定。它不兼容 Session/CSRF/FIRST/onboarding token，不得作为正常登录凭据。持有票据只允许本 case 的密码替换，不能读用户资料、grant/Session 列表或签发正常 Session。普通 Application DTO 只有安全 metadata/private handle；原 ticket 的一次交付限定在 Infrastructure secret boundary。

交付为核验完成现场的私有 HTTPS 恢复终端，向本人临时展示/传入受控客户端；不使用 email/SMS/聊天、URL query/path/fragment、持久二维码截图、剪贴板、localStorage、argv、环境变量或日志。若需要扫码，只允许编码票据本身的瞬时屏幕 QR，无 secret URL，离场清除；具体终端 UX/跨客户端绑定在私有 transport 设计中精化。本人在私密输入界面设置密码，工作人员不得索取、代填、读出或设置共享/临时密码；终端、APM、录屏及浏览器调试抓取必须满足后述验收。

一个 case 同时最多一个 ACTIVE ticket。重复发行须取消前一个并留 closed provenance；只能由当前执行者明确重新批准交付，在原 case 截止时间内进行，不自动 replay raw ticket。取消/过期/消费不可恢复。未知、错票据、取消、过期、错站点/环境/主体均统一拒绝，不返回目标或当前版本。申请与完成均需有界 admission/尝试预算，不因猜测 ticket 永久停用正常账号。

重发是明确 case mutation：先比较 caller expected case revision，再取消旧 ticket、发行新 ticket、将 case revision exactly +1 并记录闭集 provenance，全部在一个事务；不刷新 VERIFIED 起算时间、case 截止或原 target expected versions。旧票据即使未过 10min 也失效。REGISTERED 等候期也需容量/到期/retention 上界，由精确补充及批准 manifest 明确，不能形成永久无界队列。过期判定直接用当前时钟生效，不依赖清理 job 先把行写成 EXPIRED。

失去响应时不自动重试 reset、不再次展示 raw ticket、不猜测事务是否提交。工作人员通过新的认证/step-up 查询安全 case outcome；COMPLETED 只报告成功标记与安全 command reference，不再产生密码 mutation、epoch、audit 或新 Session。需要另一个密码时重新建 case。失败的 password screening 在票据仍 live 时可经有限预算重新输入，不能储存或 replay 原 secret。

本人密码提交与工作人员确认是不同私有 lane。operator endpoint 不接受目标 newPassword/verifier；subject lane 的输入只在受控 Infrastructure 内 screening/hash，形成限时、一次的 process-private submission handle，绑定 case/ticket generation、subject、站点/ceremony、原 target versions 和最终 reset intent。普通 DTO 不能携带 verifier，该 handle不能用 caller object brand 冒充。工作人员新的 step-up只确认同一 safe intent，服务端复核两 lane 的精确绑定，不能替换或复用其他人的 submission。原密码字串不排队/持久化，提交 handle只在批准的有界容量与期限内存在，异常、取消、过期及完成均失效；不声称 JavaScript 字串已被可靠内存擦除。具体跨lane协议、私有上下文与传输在下一设计精化，不能退化成把本人秘密转发到operator请求。

## 6. E8-S05 — Persistence and concurrency requirements

已有 permanent slot 是恢复锚点。首版只允许 existing slot；never-provisioned User 使用其独立首次 provisioning 契约。ACTIVE 密码恢复产生新 CredentialId/generation，旧 ACTIVE → REPLACED；对于 prior pointer=null 的 revoked slot，必须有明确批准的 `REESTABLISH_REVOKED_PASSWORD` intent 和安全解除记录，同样产生新 ID/generation，不恢复 terminal Credential。DISABLED User 不能通过 reset restore；目标 disable/restore 的 revision 变化使批准 stale。

所有 screening/Argon2 和执行者 step-up KDF 在 critical DB locks 之外完成；生产 Argon2id m=32768/t=3/p=1、KDF cap=2、创建长度和 exact-false screening 保持冻结。真实 corpus、admission 和 provider 缺失/异常均 fail closed。相同 plaintext 不作为 TRUE NO-OP，批准的 reset 每次都是 security mutation。

完成使用同一个 auth runtime client / transaction。需以已有 lock order 为约束，在精确设计阶段闭合完整 sorted User set（actor/subject）、Session-user advisory barriers、actor/target Credential slots、actor Session、SystemAdmin authority 和 case/ticket locks；target slot 一开始 FOR UPDATE，不先 SHARE 后升级。入口及 final checks 复核 operator 当前 Session/step-up/grant、target ACTIVE/User revision、slot revision/epoch/current ID、独立 proof/case/ticket/环境/站点和时间。不能在 control client 检查后换 auth client 写入并宣称原子性，也不能用 detached ALLOW。恢复的独立 purpose/policy 不加入冻结的 Membership permission 或旧 control action allowlist。

事务内完成 ticket/case CAS consume、新 Credential、旧 record terminalization、slot pointer/generation/revision/epoch、既有 CREDENTIAL_REPLACED audit、safe outcome 与 closed 通知待办。slot RepositoryRevision 和 securityEpoch 各 exactly +1，BigInt/canonical signed-int8 string、stale-before-no-op、max fail closed、不 auto retry。验证自身预期 post-state而非继续要求旧 target epoch 有效；不会制造新正常 Session。

epoch advance 与 slot锁保证旧 Session逻辑即时失效；以后正常登录才产生新 Session。不能在持 slot UPDATE 时嵌套 revokeAll 申请 exclusive barrier，避免冻结锁序中的死锁。是否额外物理 terminalize session rows不是首版必需，不以跨事务 cleanup 成功证明 reset 原子性。

approval/case cancel、两次 consume、reset vs change/revoke/issue、target disable/restore、actor logout/credential change/SystemAdmin revoke 均需同事务线性化：一方先完成则另一方基于 fresh state拒绝或安全排列，旧 intent 不能覆盖新版本。

特别注意实际低层 `PostgresSystemAdminGrantRepository`：INSERT 依赖 User FK，save 只锁 grant row；不能假定全部旧 writer 先显式锁 User。目标无历史 grant 的查询存在 absent-row/phantom 问题，单纯 COUNT、空结果 FOR SHARE 或未被旧 writer共同取得的 advisory lock不够。精确设计必须提供一次就取得的稳定 target User 强锁（例如由窄 helper FOR UPDATE，与 FK KEY SHARE 相冲突）及 grant eligibility 复核，同时锁定 actor 当前 grant阻止撤销；不授 auth通用 User UPDATE权限，不改旧 Repository行为。该候选锁序还须逐一检查 slot-first 旧 Credential writer、Session INSERT FK/trigger、User disable 和所有 grant insert/save 的等待关系；可能的 40P01/40001 必须全 rollback/sanitize，不 auto retry，不以允许死锁来替代 phantom 防护证明。具体 helper/排序/事务隔离与真实 race proof在下一精确设计单元闭合；若必须破坏冻结协议则报告冲突，不开始 BUILD。

取得稳定锁后再进行 fresh eligibility 查询，不能使用等待前的 grant/无 grant snapshot。沿用现有 READ_COMMITTED 写事务；精确 helper 需证明取得锁后的后续查询使用新 snapshot，不能把 READ_ONLY REPEATABLE_READ 或一个预先读出的 CTE 作为当前复核。参考 [PG16 row lock conflict](https://www.postgresql.org/docs/16/explicit-locking.html) 与 [READ COMMITTED snapshots](https://www.postgresql.org/docs/16/transaction-iso.html)，引用说明候选机制，不代表该新 helper 已实现或通过真实 PG。

任何 insert/CAS/audit/provenance/outbox失败全部 rollback，旧密码/epoch仍处一致 prior state，票据也没有被独立提前消费。COMMIT 不确定时记录未知 outcome并查询，不 replay。不可通过先 consume再调用 standalone `replacePassword` 实现，也不改 frozen Repository Port 的事务语义。

## 7. E8-S06 / S07 — Audit, notification, transport and ACL

成功复用 closed `CREDENTIAL_REPLACED`、reason `ACCOUNT_RECOVERY`，真实执行者为 actor。case approved/issued/cancelled/consumed 的记录是闭集 append-only provenance，与 credential event、安全 command/结果建立数据库可验证关系；不要把 arbitrary JSON 或 free-text note加进现有 IdentityAuditEvent。精确 schema 阶段须选择这些记录的形状/immutability/consistency和读权限，本文不冒称已有case审计。

已批准通知渠道 `HUMAN_REGISTERED_CONTACT_V1`：独立核验员通过原始登记中已经批准且验证的本人/指定联系人渠道（首版受控人工回拨）发送固定批准/完成通知，确认由合法接收人接收。号码/地址存 approved external evidence store，DB只存 routeRef，不从此次申请接收新联系人。渠道未存在或未验证则恢复不可发行票据；联系人变更必须先走独立证据流程。现有目录数据不足不能用 request.phone/email 补洞。无需安装 automated email/SMS provider；也不把回拨独立通知当作新的正常登录因子或凭它替代现场重核验。

通知只有固定事件、case reference、批准时间、结果与已批准争议联系方法；无 ticket、密码、verifier、digest或账号权限。预通知须有回执才交付票据。完成事务原子追加 durable notification pending；之后人工 deliver/ack。完成通知暂时失败不回滚已提交 reset、不返回“可重试换密码”，安全 outcome显示通知 pending，并触发具名工作人员处理。交付时限、积压阈值、责任轮值和新增 case暂停售票由部署 manifest批准并演练；不能把事后 best-effort console输出当 durable通知。

私有 recovery client/receiver 使用固定已批准 HTTPS origin、private网络与专用一次 ceremony上下文。它不注册 `/api/zhiban/identity/forgot|reset`，不扩大 8D middleware例外，不添加公共 control接口。浏览器lane使用 exact Origin/custom header/CSRF、no-store、frame禁止、无第三方脚本/APM；operator Session与subject ticket角色分离、不可把 raw材料塞进普通DTO或透传 OpenMAIC。上线前须有实际终端/浏览器、代理和清屏/记录脱敏测试；生产依然关闭直到完成专用transport设计与验收。

Credential写入只能在 approved auth服务；tenant runtime没有case/ticket或Credential权限，control runtime不获得verifier/digest或Credential DML，PUBLIC无表/列/helper能力。现有 auth缺跨角色当前SystemAdminGrant核验，且存量表仅允许 FIRST_PASSWORD，没有可复用的恢复表。下一单元必须先设计窄的auth可调用只读/锁定eligibility helper或受限批准投影、case/票据/outbox的列权限与可靠绑定，不给整表SystemAdmin SELECT、owner pool、SET ROLE、genericdefiner/SQL callback。User/systemadmin roster的helper不能变成任意用户查询API。

## 8. E8-S08 — Tests, deployment and exceptional cases

本次方向已批准；下一设计单元先做精确 schema/ACL与私有transport设计。预计需下一 migration `0010`，必须重新核验 inventory，不修改已应用0001–0009。本文尚未批准SQL对象数量、helper签名或ACL例外，不能直接按它写DDL。新 admission purpose、case/outbox、安全eligibilityhelper、closed event链接须逐项审阅，不能挪用 INITIAL_PROVISION预算/表purpose。

BUILD必须新增有意义的targeted unit/contract、安全与真实PG16用例，至少证明：

- trusted original enrollment vs临时fake mapping、跨机构错误指认、缺证据/未登记联系渠道均拒绝；tenant管理员与fakeSystemAdmin不能发票据。
- 两工作人员/subject分离、执行者失去Session/权限/step-up、证据任命/审批撤销、目标Userdisable-restore、privileged目标拒绝；每次事务fresh检查。
- 外部证据变更/case撤销同库锚点顺序、未同步状态fail closed；不能依赖持锁网络请求或不可线性化的外部布尔值。
- 256-bit随机票据/digest/purpose隔离、raw材料无DB/Domain/DTO/audit/log/URL、expiry精确边界、cancel/replace票据、不重开终态、错误统一与bounded admission。
- 两lane提交/确认的case、ticket generation、站点、subject、版本绑定；工作人员请求无newPassword、foreign/forged/expired submission拒绝；重发stale先拒绝并使旧票据立即失效。
- screening true/nonboolean/exception failclosed、production Argon2实际运行、KDF锁外与permit释放，无fixture默认值。
- ACTIVE replace与经批准revokedslot新generation、同密码仍mutation、revision/epoch各+1/max边界、独立连接双consume/双reset只有一winner、stale-before-no-op。
- reset vs change/revoke/issue、Userdisable与SystemAdminrevoke/logout并发，用acknowledgedlocks/barriers；旧session失效且restore不复活。
- case/ticket/credential/audit/safeoutcome/outbox各步fault注入全rollback、COMMIT不确定不auto retry、查询成功outcome不新增mutation、通知失败不重复reset。
- actualauth/tenant/control/PUBLIC最小ACL、helper不可越权查询或写业务状态、malformed persisted数据拒绝，pool/client/context清理。

复用现有PG16 workflow两轮，不新增第二套、不删旧12 suites。执行新增与原Identity regression、lint/typecheck；本地无PG16时不安装或用PG18替代，真实结果待checkpoint后新candidateCI。本期只设计不运行这些测试，数量在BUILD以实际inventory报告。

生产恢复启用另需具名platform责任人、身份登记核验员和替班、独立SystemAdmin执行者、证据store/签名验证与撤销责任、现场privateHTTPS场所、原始联系渠道、通知delivery/ack、容量/清理/retention、事件争议处理及合成身份演练。不得填写真实凭据或个人证据到Git。目标User证据不足、无independent执行者、无通知渠道或平台管理员锁号等不支持场景明确拒绝并升级人类治理，不用DB管理员直接改hash兜底。

首版普通User恢复并不覆盖“唯一平台管理员遗失密码”。在该例外的quorum恢复单独批准/实现/演练前，生产release不能声称全平台有完整恢复能力；治理方必须明确关闭相关release或另行通过该gate。此事实是有限方案的范围，不是更改已冻结Identity/Session契约。

## 9. External guidance and review result

[OWASP Forgot Password guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)支持随机、安全存储、单次限时的恢复token、失败限速以及重置后通过正常登录重新认证。本文沿用这些原则，不引入公开URLtoken或临时密码。

[NIST SP 800-63B-4 account recovery](https://pages.nist.gov/800-63-4/sp800-63b.html#account-recovery)区分重核验、预设恢复渠道和联系人；重核验须能对应事先已确立的身份，恢复需要独立通知。本文借其原则提出原始绑定与通知门槛；不声称获得某个IAL/AAL认证或完整NIST符合性。上述现场、两人、30min/10min、手工回拨和privileged关闭是本次已批准的项目风险选择。

自审结果：原授权的公共恢复关闭被保留；global恢复与tenant成员恢复、FIRST、User restore明确分开；没有以UserId/role/旧Session作为personproof；没有新标准弱密码、提前票据消费、跨client原子性或通知失败自动reset；没有直接扩宽旧schema/ACL。真正的实现缺口与具名运营值均标为待设计/配置，不将空白报成frozencontract冲突。

## 10. Human approval and design review closure

Approval date: 2026-10-04. Human authorization: **“审阅并批准 E8-S01–S08”**。审阅对照实际 Credential/Session/Control/audit Ports、0002/0006/0008 外键/锁/ACL、低层 SystemAdminGrant writer、frozen 8A/8D 与当前 transaction isolation。结果为八项 PASS / HUMAN_APPROVED_DESIGN，并包含本文的有限澄清；未运行新实现、PG16 或人类恢复演练。

| Contract | Review / approval result |
| --- | --- |
| E8-S01 | PASS / APPROVED；现场普通 global User，任何 SystemAdmin 历史及公共恢复关闭 |
| E8-S02 | PASS / APPROVED；原始绑定必需，缺证据/临时映射无fallback |
| E8-S03 | PASS / APPROVED；subject/两工作人员分离、current step-up、不可变manifest与同库撤销锚点 |
| E8-S04 | PASS / APPROVED；30min/10min、单次digest、重发case CAS、两lane submission绑定 |
| E8-S05 | PASS / APPROVED；同auth client原子reset，slot/epoch旧Session失效，phantom/lock snapshot精确设计gate |
| E8-S06 | PASS / APPROVED；existing credential audit＋closed provenance/outbox、独立登记回拨，不误报通知失败为reset rollback |
| E8-S07 | PASS / APPROVED；secret只在受控lane/Infrastructure，private transport和窄ACL后续精确批准 |
| E8-S08 | PASS / APPROVED；真实并发/rollback/ACL/终端演练、privileged例外和生产gate保留 |

| Resolved review ambiguity | Closure |
| --- | --- |
| 外部证据撤销如何与PG transaction一致 | 不变manifest＋同库版本/撤销锚点、先cancel后发布变更；无跨系统ACID/持锁network承诺 |
| 工作人员是否会收到本人新密码或任意verifier | 两私有lane、一次submission registry和精确safe intent绑定；operator输入不含目标secret |
| Ticket重发是否绕过stale或续期 | expected case revision先检、取消旧票据与新发行原子、revision+1，原expiry/目标versions不刷新 |
| 无grant计数在等待锁后是否仍fresh | 稳定target锁与FK writer配合，之后fresh查询；SQL/helper签名未批准不提前宣称实现安全 |

冻结的是首版渠道、身份/审批、安全生命周期与验收要求。schema/ACL/私有协议的具体能力仍需下一单元精确设计；这不会将具名人员/联系方式/证据store自动配置为有效，也不将特殊平台管理员恢复改为开放。

DESIGN_SCOPE: RECOVERY_CHANNEL_AND_CONTROLLED_MANUAL_RECOVERY

RECOVERY_MODE: ATTENDED_MANUAL_RECOVERY_V1

PUBLIC_RECOVERY: CLOSED

AUTOMATED_EMAIL_SMS: CLOSED

SYSTEM_ADMIN_SELF_OR_LOCKOUT_RECOVERY: CLOSED_PENDING_SEPARATE_DESIGN

APPROVAL_ITEMS: E8-S01–S08

APPROVAL_STATUS: ALL_EIGHT_HUMAN_APPROVED

DESIGN: HUMAN_APPROVED_AND_FROZEN

REVIEW_VERDICT: PASS

IMPLEMENTATION: NOT_STARTED

SCHEMA_ACL_TRANSPORT: PRECISE_SUPPLEMENT_REQUIRED_BEFORE_BUILD

APPLIED_MIGRATIONS_0001_0009: UNCHANGED

FROZEN_CONTRACT_CONFLICT: NO

CURRENT_DESIGN_REVIEW_P0: 0

CURRENT_DESIGN_REVIEW_P1: 0

CURRENT_DESIGN_REVIEW_P2: 0

IMPLEMENTATION_AND_DEPLOYMENT_SIGNOFF: NOT_CLAIMED

COMMIT: NO

PUSH: NO

CI_DISPATCH: NO

READY_FOR_1B8E_DECISION_REVIEW: COMPLETED

READY_FOR_1B8E_DESIGN_CHECKPOINT: YES

READY_FOR_1B8E_BUILD: NO_PENDING_PRECISE_SCHEMA_ACL_TRANSPORT_DESIGN_AND_BUILD_AUTHORIZATION

下一步：1B-8E已批准设计单文档checkpoint与独立GitHubHEAD/message/parent核验（GPT-6.1 Sol / Low），然后单独开展1B-8E精确schema/ACL/私有transport补充（GPT-6.1 Sol / High）。恢复生产配置、特殊管理员恢复及BUILD均有各自明确gate；本次批准只记录八项设计与审阅澄清，不执行checkpoint或实施。
