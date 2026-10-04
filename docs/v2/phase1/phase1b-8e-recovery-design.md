# Phase 1B-8E — Recovery Channel / Controlled Manual Recovery Decision

STATUS: HUMAN_APPROVED_DESIGN / FROZEN

Status scope: E8-S01–S08 channel/lifecycle decisions and Appendix E's E8-P01–P08 exact schema/ACL/private transport contracts are human approved and frozen. E.12 records the 2026-10-04 review corrections included in that approval. Implementation and deployment remain separate gates.

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

## Appendix E — Exact schema / ACL / private transport supplement

SUPPLEMENT_STATUS: HUMAN_APPROVED_DESIGN / FROZEN

Supplement date: 2026-10-04. Base HEAD: `1a8c706c5f5b4ddda14b8f581f1e7bf80c810a7c`, branch `refactor/zhiban-v2`, supplement preflight CLEAN. GitHub HEAD/message/parent independently verified in the preceding unit. Approval review started with only this document modified. Sections 1–10 retain the approved E8-S01–S08 channel decision; historical next-step labels yield to the current approval state below. The user explicitly requested “审阅并批准 E8-P01–P08”; all eight exact contracts are approved after the bounded review corrections in E.12. This approval does not perform or authorize BUILD/checkpoint/CI/deployment.

### E.1. Actual implementation audit and allowed delta

Re-read actual `authentication.ts`, `membership-security.ts`, `control-approval.ts`, `admission.ts`, `support.ts`, Credential/Session/SystemAdminGrant repositories, transaction wrapper, migrations 0002/0003/0004/0006/0008/0009, HTTP root/protocol, browser security policy, Argon2 provider, existing design appendices and current workflow. Inventory contains exactly 0001–0009; 0010 is available. `controlTransaction` supplies READ_COMMITTED on the supplied restricted pool, not a role elevation. Recovery uses the auth pool exclusively for completion.

Relevant audit findings and resolutions:

| Actual fact | Exact supplement resolution |
| --- | --- |
| Standalone Credential repository owns its transaction; composition audit helper fixes reason to USER_REQUEST | New recovery-specific same-client composition writes the existing closed CREDENTIAL_REPLACED payload with ACCOUNT_RECOVERY. No nested standalone repository call or generic audit reason expansion |
| Low-level SystemAdmin INSERT relies on immediate User FK; revoke locks only grant | Case-bound target User FOR UPDATE blocks FK KEY SHARE; actor grant FOR SHARE prevents concurrent revoke. Fresh privileged-history query follows User acquisition |
| Old Credential mutation is slot-first; Session INSERT trigger is slot-first before FK/barrier | Recovery uses NOWAIT row locks and shared advisory try-lock, releasing all locks on conflict; it cannot wait on a legacy slot while holding target User |
| Existing admission purpose lists are closed in SQL and TypeScript | New recovery-only policy/budget tables and helper, with distinct purpose. Existing admission_policies and old helper signatures remain unchanged |
| auth lacks SystemAdmin SELECT; audit owner is subject to FORCE RLS | Case-bound authority helper returns only eligibility/bound revisions; new narrowly scoped audit owner-read policy joins recovery outcome evidence |
| HTTP root is a sealed approved singleton, existing origin/CSRF configuration is specific | Separate recovery singleton/listener and CSRF purpose; existing root, public routes and middleware exceptions are not broadened |

Allowed future implementation delta: recovery security-specific Application interfaces, Infrastructure evidence validation/material/registry/composition/private protocol modules; proposed `0010_identity_manual_recovery.sql`; targeted tests plus existing workflow additions. No Domain recovery aggregate containing secret material; no frozen Port signature changes; no edits to migration files 0001–0009. No new provider/dependency is necessary: reuse Node crypto Ed25519 verification/CSPRNG/SHA-256, existing UUIDv7 issuer, Argon2 and screening.

### E.2. Exact approval items

| Item | Human-approved exact scope |
| --- | --- |
| E8-P01 | Eight named global tables, column families below, immutable/terminal/CAS/commit consistency constraints, 0010 inventory |
| E8-P02 | Signed original evidence manifests, three versioned source anchors, registration/revocation ordering and two-person separation |
| E8-P03 | Auth-only completion, fixed lock order/NOWAIT/try-lock, privileged-history phantom exclusion, revision/epoch and rollback proof |
| E8-P04 | Exact table/column ACL, six callable helpers, two internal trigger functions, one narrow FORCE-RLS audit owner-read exception |
| E8-P05 | Private operator/subject HTTPS protocol, transport-authenticated lane/site, exact bodies/headers/cookies and uniform failures |
| E8-P06 | Process-private submission/ceremony registry, single-use digest encoding, expiry/reissue/outcome semantics |
| E8-P07 | Durable closed provenance/outcome/notification, shared admission and finite capacity/operational manifest gates |
| E8-P08 | Required static/unit/provider/real PG16/Node HTTP proofs, implementation scope and acceptance sequence |

### E.3. E8-P01 — Table and column contract

All new tables are global security records owned by `zhiban_identity_owner`, with no tenant columns or tenant RLS. Common types: IDs are server-issued UUIDv7 with `is_uuid_v7` checks; User FK uses ON DELETE RESTRICT. Revision/source-version/credential-generation counters are positive signed int8, represented as canonical decimal strings and incremented through BigInt validation only. Exceptions: case ticket_generation starts0 before first issue, issued ticket_generation≥1, ticket attempts starts0; these are bounded nonnegative int8 counters. `security_epoch` follows the existing signed-int8 Credential contract, not Membership authorizationVersion. Time columns are int8 milliseconds within 0..8640000000000000; application checks monotonic elapsed time too. References match `[A-Za-z0-9._:-]{1,128}`, digests lowercase 64 hex. No arbitrary JSON, free text, raw request, private key, contact address, person identifier, ticket, CSRF material, password or verifier columns.

Inventory, exactly eight new tables:

| Table | Required columns and keys |
| --- | --- |
| `identity_recovery_policy` | `environment_ref` PK; immutable `policy_digest`, `approval_ref`, `created_at`; operational `enabled`, `repository_revision`, `updated_at`; finite `window_ms`, `global_limit`, `site_limit`, `subject_limit`, `max_buckets`, `max_live_cases`, `max_registered_per_subject`, `max_total_cases`, `max_pending_notifications`, `max_notification_age_ms`, `registered_ttl_ms`, `submission_ttl_ms`, `ceremony_ttl_ms`, `max_submissions`, `max_attempts_per_ticket`, `max_process_requests`, `body_timeout_ms`, `statement_timeout_ms`. Values form the approved canonical policy manifest |
| `identity_recovery_sources` | `source_id` PK; `environment_ref`, `source_kind` in ENROLLMENT/APPOINTMENT/CONTACT, `source_ref`, `bound_user_id`, `source_version`, `manifest_digest`, `issuer_ref`, `key_ref`, `attested_at`, `valid_until`, `state` CURRENT/BLOCKED, `repository_revision`, `created_at`, `updated_at`, `blocked_at`. Unique(environment_ref,source_kind,source_ref,source_version); immutable identity binding; BLOCKED terminal |
| `identity_recovery_cases` | `case_id` PK; `environment_ref`, `site_ref`, `subject_user_id`, `verifier_user_id`, `actor_user_id`; three `*_source_id`/`expected_*_source_revision` pairs; immutable `registration_manifest_digest`, `registration_key_ref`; `approval_ref` unique per environment, `approval_manifest_digest`, `approval_key_ref` nullable until APPROVED; `intent` REPLACE_ACTIVE_PASSWORD/REESTABLISH_REVOKED_PASSWORD, nullable `security_clearance_ref` only required for revoked reestablishment; `expected_subject_user_revision`, `expected_verifier_user_revision`, `expected_slot_revision`, `expected_security_epoch`, nullable `expected_credential_id`, `expected_generation`; actor `expected_actor_user_revision`, `expected_actor_slot_revision`, `expected_actor_security_epoch`, `actor_admin_grant_id`, `expected_admin_grant_revision`; `state`, `repository_revision`, `ticket_generation`, `created_at`, `registered_expires_at`, nullable `verified_at`, `approved_at`, `expires_at`, `completed_at`, `terminal_at`, closed `terminal_reason`; `pre_notice_receipt_ref`, `delivery_receipt_ref` nullable until required. No bearer/Session digest field |
| `identity_recovery_tickets` | `ticket_id` PK; `(case_id,ticket_generation)` unique; `ticket_digest` unique; `state` ACTIVE/CANCELLED/CONSUMED/EXPIRED; `attempts`, `created_at`, `expires_at`, `terminal_at`; positive `repository_revision`. Case FK and composite binding to case/site/environment through case ownership; partial unique(case_id) WHERE state=ACTIVE |
| `identity_recovery_events` | `(case_id,case_revision)` PK; `event_id` UUIDv7 unique; `event_type`, `occurred_at`, `actor_user_id` nullable only for approved service maintenance, `service_code` nullable, `request_id`, optional `ticket_id`, `source_id`, `receipt_ref`. Closed mutually exclusive actor/service shape; event rows append-only |
| `identity_recovery_outcomes` | `case_id` PK; `command_id` UUIDv7 unique; `ticket_id` unique; `completed_case_revision`, `ticket_generation`, `actor_user_id`, `subject_user_id`, nullable `prior_credential_id`, `credential_id`, `generation_before/after`, `slot_revision_before/after`, `security_epoch_before/after`, `credential_event_id` unique FK to audit_events, `completed_at`. Safe success evidence; append-only, no request fingerprint/password hash |
| `identity_recovery_notifications` | `(case_id,notice_kind)` PK, notice_kind PRE_RESET/COMPLETED; `route_source_id`, `route_source_revision`, `verifier_user_id`, `state` PENDING/ACKNOWLEDGED, `created_at`, `due_at`, nullable `acknowledged_at`, `receipt_ref`; `repository_revision`. PRE_RESET inserted acknowledged by trusted receipt before ticket issue; COMPLETED inserted pending in reset transaction |
| `identity_recovery_admission_buckets` | `(environment_ref,phase,dimension,key_hmac,window_start)` PK; phase REGISTER/ISSUE/SUBMIT/COMPLETE/READ/ACK; dimension GLOBAL/SITE/SUBJECT; `key_hmac` 64 hex, `used`, `expires_at`. Bounded shared counters, helper-only; no secret fingerprint or plain IP/subject locator |

Constraints must name and enforce all of the following. Three people differ; sources bind respectively subject, verifier and subject; source kind/environment match using composite unique/FKs, not solely application tests. Sources have UNIQUE(source_id,environment_ref,source_kind,bound_user_id) in addition to their PK, with case kind-discriminator columns fixed by CHECK for the three composite FKs. Case environment and source environment reference the policy PK. Case subject/actor/verifier IDs reference users; grant FK references existing grant_id PK DEFERRABLE INITIALLY DEFERRED, with deferred owner check requiring grant.user_id=case.actor_user_id; no unsupported composite FK or change to existing table unique keys. Tickets/events/outcomes/notifications reference case_id; outcomes/events with ticket_id reference UNIQUE(case_id,ticket_id) on new tickets. Outcome credential IDs use existing UNIQUE(user_id,credential_id); contact notice FK/owner check binds route source to the same case subject. All use ON DELETE RESTRICT; nullable refs only where the closed state permits. Cases/outcomes never refer to mutable current case ticket_generation through a historical FK.

Expected subject/actor/verifier User revisions, source/slot versions and intent are fixed at REGISTERED; later signed evidence cannot replace them. Registration imports a signed registration manifest with no future receipt/verified timestamp requirement. VERIFIED validates its signed independent evidence receipt, then records DB verified_at and expires_at=verified_at+1800000. APPROVED imports a separately signed final approval matching those actual times, original registration digest/expected versions and signed pre-notice receipt, and fills approval_manifest_digest/key once. Ticket expiry=min(created_at+600000,case.expires_at). REGISTERED uses a separate finite deadline; no later approval or reissue refreshes either deadline. This order avoids requiring a signature over not-yet-created notification/verification facts.

State machine: REGISTERED→VERIFIED→APPROVED→TICKET_ISSUED→COMPLETED; incomplete states can become REJECTED/CANCELLED/EXPIRED, never reopen. Ticket reissue is TICKET_ISSUED→TICKET_ISSUED with different ticket_id, generation+1 and case revision+1, old ACTIVE→CANCELLED. Consume ACTIVE→CONSUMED only on matching completed outcome. Case state/receipt/ticket mutation advances case revision exactly once; each ticket attempts/state mutation advances ticket revision once. Stale expected revisions reject before terminal/no-op checks; maxima fail closed. Notifications have their own revision: ACK of already acknowledged notice is true no-op only with current revision and exact same receipt; stale ACK rejects.

Indexes: cases(environment_ref,state,expires_at), cases(subject_user_id,state), cases by each source_id/state, tickets(case_id,ticket_generation), unique live ticket, events(event_id), notifications(state,due_at,case_id), buckets(expires_at). Notification environment filtering joins its case using indexed case_id; no cross-table index expression. No sequence except existing audit sequence; UUID issuer supplies all new IDs. New migration is forward, single transaction, no startup DDL or CREATE INDEX CONCURRENTLY. It seeds no enabled policy, staff, identity binding, real contact, evidence or default recovery account.

Two new internal functions: `identity_recovery_transition_guard() RETURNS trigger` checks OLD/NEW closed immutable/lifecycle/CAS/monotonic shapes and rejects DELETE on source/case/ticket/provenance/outcome/notification; `identity_recovery_consistency() RETURNS trigger` is a deferred commit validator for the case aggregate. Its checks require state/provenance revision coverage, bound source kinds, actor/subject separation, unique live generation, matching notice/receipts and exactly one outcome for COMPLETED. `RETURN NULL` on successful deferred validation; no SQL alias named `old`/`new` competing with PL/pgSQL trigger variables.

For a newly COMPLETED case, commit checks exact current Credential post-state, terminal prior record/new record, case/ticket consumption, audit and pending notification. For later notification ACK or case-outcome reads, the immutable outcome/audit keeps exact completion before/after versions, while Credential identity/User/generation/created_at proves historical linkage. The recovered credential's current slot_revision may be ≥ recorded completion revision, updated_at may be later, and its state may have changed legally through rehash/replacement/revoke; do not permanently require equality, ACTIVE, original verifier or current pointer/epoch. A subsequent normal password change/rehash/revoke must remain legal. Deferred checks must not require a consumed ticket still ACTIVE or the target's old epoch still current. Source BLOCKED may coexist with historical COMPLETED cases; it cancels only incomplete cases.

### E.4. E8-P02 — Evidence registry and revocation

Approved evidence store signs bounded canonical manifests with Ed25519; server uses `node:crypto.verify` against explicitly approved public-key references, no signing key in recovery browser/service DB. Canonical input is UTF-8 JSON of a versioned ordered field-pair array, exact field set, explicit null values, no duplicate keys/accessors/unknown fields. Maximum 16 KiB; signature exactly 64 decoded bytes, unpadded canonical base64url. Digest is SHA-256 of this safe manifest, never a digest of identity document contents, password or person identifier. Node's standard key parser/algorithm is used; no custom signature algorithm.

Key trust configuration pins issuer, purpose MANUAL_PASSWORD_RECOVERY, environment, allowed source kind, validity/revocation and verifier appointment. Signed enrollment/source manifest binds the original enrollment approval/version and UserId with opaque refs. The signed registration fixes all three expected User revisions, actor grant, source/slot versions, site/intent/case; final approval additionally binds registration digest, actual verified_at/expires_at and pre-notice receipt. Registration key must match its approved enrollment-source key; verification/approval/delivery/notice receipt key must match the appointment-source key and approved store issuer/purpose. The evidence service attests which independently appointed verifier performed each act; signature does not itself prove physical presence. This explicit key-to-source binding allows key revocation to block every affected source/case before external revocation is published. A valid signature alone is insufficient: approved issuer and current DB source anchors are also required. For Ed25519 use standard Node `crypto.verify(null, canonicalBytes, approvedKey, signature)` and require key type ed25519, not inferred caller algorithm/key types. [Node 22 verify contract](https://nodejs.org/docs/latest-v22.x/api/crypto.html#cryptoverifyalgorithm-data-key-signature-callback)

Control runtime may register policy/source records only through a dedicated approved provisioning command loaded from the trusted evidence store. No HTTP body, CLI boolean or fixture store becomes evidence. A source starts CURRENT revision1; later BLOCKED terminal revision+1. Replacement source is a new ID/version, with old source blocked first. Controlled source/key/appointment/contact revocation calls the blocking helper on all affected anchors; it atomically blocks new execution and cancels logically-live incomplete cases/tickets before the external change becomes effective. Already-expired rows remain permanently ineligible by DB deadline checks even if maintenance has not written EXPIRED; they need not be scanned/cancelled as a prerequisite to blocking. Cancel batch includes all still-executable states including REGISTERED and is bounded by the approved global live-case cap; no partially completed blocking batch. Losing contact after completion does not erase a durable completion notification; route resolution is held for independently approved contact remediation.

If the external store permits uncontrolled revocation, lacks synchronization acknowledgement, reports an uncertain key/source state, or provisioning fails, disable the recovery service at admission. No remote evidence call under PG critical locks. No cross-store atomicity claim: production configuration must prove that external authority changes follow this acknowledged order. Original source data absent in today's repository remains a deployment prerequisite; BUILD may supply interface/validator plus synthetic fixtures, never a guessed production record or V1 mapping.

### E.5. E8-P03 — Exact same-client write protocol

All recovery SQL commands start READ_COMMITTED on one restricted auth client. No recovery callback/raw client escapes Infrastructure. No auto retry; 55P03/try-lock=false means closed `RECOVERY_BUSY`, 40001/40P01 and transport failures sanitize and roll back. Statement/idle transaction timeouts are finite approved manifest values, connection failures return generic unavailable. Table-level/implicit waits are bounded by statement timeout; NOWAIT addresses explicit row conflicts, not an overall guarantee that PostgreSQL never waits.

For issue/reissue and complete, read a safe case hint only to identify fixed bindings, then use this order:

1. `identity_recovery_gate(environment,policyDigest)` locks the singleton recovery policy row FOR UPDATE NOWAIT, checks enable/config/time/capacity. It serializes new recovery-only writers and source revocation; it is not a lock used by old Credential writers.
2. Case-bound helper acquires the complete three User set in canonical UUID order: subject FOR UPDATE NOWAIT, actor/verifier FOR SHARE NOWAIT, no upgrades or extra Users afterward. ACTIVE/User revisions checked. A new statement after target lock checks absence of **all** SystemAdminGrant history. This is stronger than FOR NO KEY UPDATE and conflicts with immediate FK KEY SHARE of an old grant INSERT. Existing grant insert that already holds FK lock causes recovery BUSY; insert starting after recovery's target lock waits and linearizes after reset.
3. Try shared `zhiban-session-user:<actor>` transaction advisory barrier with `pg_try_advisory_xact_lock_shared`. False aborts. No subject barrier and no exclusive barrier/revoke-all nesting: subject epoch change invalidates its sessions. The strong subject User lock already serializes disable/restore/FK-bound issuance.
4. Actor/subject slots in UserId order: actor FOR SHARE NOWAIT, subject **direct FOR UPDATE NOWAIT**. Load security-specific history and fail-closed mapper; compare exact approved slot revision/epoch/pointer/generation. Verifier's credentials/Session are not authorization facts.
5. Actor's bound Session FOR SHARE NOWAIT, then case-bound actor SystemAdminGrant FOR SHARE NOWAIT through helper. Check digest, expected authenticated identity, current User revision/epoch, terminal/expiry, grant owner/revision/validity and exact intent-bound request step-up, under DB and monotonic clocks.
6. Source anchors sorted by source_id FOR SHARE NOWAIT, case FOR UPDATE NOWAIT, current ticket FOR UPDATE NOWAIT. Recheck all expected source/case/ticket revisions, signed safe manifest/site/ceremony/submission generation, expiry/notice receipts and no privileged target; helpers never return grant history or target secrets.
7. One transaction: slot CAS pointer/generation/revision/epoch exactly+1; prior ACTIVE terminalize REPLACED and clear verifier (skip when pointer null with approved clearance); insert new ACTIVE CredentialId; ticket consume and case COMPLETED CAS once; existing audit CREDENTIAL_REPLACED/ACCOUNT_RECOVERY with actual actor; append outcome/provenance and COMPLETED pending notice.
8. Validate exact new credential aggregate/post-state; fresh DB clock plus monotonic elapsed checks for actor Session/grant/step-up, case/ticket/submission, source deadline. `SET CONSTRAINTS ALL IMMEDIATE` runs deferred case/credential checks before final time check; propagate failure without catch-and-continue. COMMIT tag must be COMMIT. Hold all locks until transaction ends.

KDF/screening/operator step-up happens before step1. Neither a real password nor a verifier is passed to a SQL helper. New verifier is only an Infrastructure SQL INSERT parameter; query diagnostics cannot serialize params. Recovery-specific audit writer takes only the exact six existing payload fields, ACCOUNT_RECOVERY fixed reason and safe IDs/versions; do not broaden generic `support.audit` or mutate IdentityAuditEvent union.

Legacy cycle proof obligation: if a legacy writer holds subject slot and later wants User FK while recovery holds target User, recovery's slot NOWAIT aborts and releases User immediately; it never waits for that writer. If a grant/Session insert already holds target FK, target NOWAIT aborts before taking slots. Actor logout-all holding exclusive barrier causes try-lock failure. Actor revoke holding grant/session causes NOWAIT failure. If recovery owns all required locks first, competitors wait or reject stale after its commit; two completions share gate/case/slot CAS and cannot both commit. Unexpected deadlock detection still rolls back; no success claim based on tolerated deadlocks. Real independent-connection PG16 proofs below must establish these cases before signoff.

REGISTER/VERIFY/APPROVE/CANCEL/READ/ACK commands use only the subset needed but acquire the gate first for all mutations. LIVE mutations collect the complete sorted User set before actor authentication locks, source before case/ticket. Register uses the source-bound form of user_locks below **before** any case/User FK INSERT; it does not need direct auth User UPDATE capability or a case row already present. The actor grant FK is deferred so the case can be staged, then the case-bound grant NOWAIT check runs before constraints/commit without an earlier implicit FK wait on that grant. Target slot/source/registration-proof checks remain within this one transaction. Cancellation, source blocking and expiry maintenance do not require target ACTIVE and do not mutate Credential.

Outcome query is a separate authenticated **safe read**, requiring current actor Session/SystemAdmin/step-up and case actor binding, never old target revisions, ticket liveness or unchanged source versions. It may read terminal or incomplete status to resolve uncertainty, but cannot resume/issue/complete. Acquire policy gate NOWAIT first (disabled permitted for this read), actor-only authentication locks, then case FOR SHARE NOWAIT and a fresh outcome SELECT. If original transaction is still holding the gate/case, return OUTCOME_UNKNOWN/BUSY, never infer rollback from an unlocked snapshot. Once locks are acquired after rollback, an incomplete case reports NOT_COMPLETED; after commit, immutable outcome reports COMPLETED. Neither response authorizes automatic replay or reconstructs ticket/submission; unknown issue delivery likewise requires an explicitly authorized new reissue with fresh revision. This bounded read clarification adds no write permission or public endpoint.

### E.6. E8-P04 — Exact privileges and helper capabilities

No role attributes change, no runtime ownership/SUPERUSER/BYPASSRLS/CREATEROLE or SET ROLE. REVOKE PUBLIC and all runtime grants on each new object in the same migration before exact grants. Existing Credential/session auth privileges are reused. No auth SELECT on system_admin_grants, no auth generic User UPDATE, no new control Credential verifier/session digest access.

| Object | auth_runtime | control_runtime | tenant runtime / PUBLIC |
| --- | --- | --- | --- |
| policy | SELECT only; lock/reserve through helper | SELECT; INSERT exact immutable policy/config columns; UPDATE(enabled,repository_revision,updated_at) with transition guard and current revision | NONE |
| sources | SELECT safe references/versions | SELECT; INSERT listed source columns excluding mutable terminal fields; BLOCK through helper only | NONE |
| cases | SELECT; INSERT listed registration/binding columns with state=REGISTERED, revision1; UPDATE(state,repository_revision,ticket_generation,verified_at,approved_at,expires_at,completed_at,terminal_at,terminal_reason,pre_notice_receipt_ref,delivery_receipt_ref,approval_manifest_digest,approval_key_ref) guarded | no direct SELECT/DML | NONE |
| tickets | SELECT including security-only ticket_digest; INSERT listed columns initial ACTIVE; UPDATE(state,attempts,terminal_at,repository_revision) guarded | NONE | NONE |
| events / outcomes | SELECT safe fields; INSERT listed closed columns, no UPDATE/DELETE | NONE | NONE |
| notifications | SELECT; INSERT listed closed columns; UPDATE(state,acknowledged_at,receipt_ref,repository_revision) guarded | NONE | NONE |
| admission_buckets | no direct SELECT/DML | NONE | NONE |
| existing users/grants/audit | no additional direct grants | existing frozen privileges only | existing frozen privileges only |

TABLE SELECT is granted only where all columns are appropriate for that role; no secrets appear in ordinary query return mapping. Locking functions run as existing non-login `zhiban_identity_owner`. Own new tables do not need RLS owner exceptions; audit_events FORCE RLS does. Exactly one new owner SELECT policy on audit_events permits a row only when referenced by a recovery outcome and event_scope=GLOBAL, event_type=CREDENTIAL_REPLACED, reason=ACCOUNT_RECOVERY, actor_type=USER and actor/subject/occurredAt match case outcome. No runtime audit SELECT policy, no general owner allow-all, no grant to read other audit events.

Six externally callable fixed-signature helpers, all `LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER`, `SET search_path=pg_catalog,zhiban_identity,pg_temp`, `SET row_security=on`, owner `zhiban_identity_owner`; fully qualified relations, no dynamic SQL, parameterized mode allowlists, no default args/overloads. Validate session_user explicitly, not only inherited EXECUTE; invalid/null/malformed params raise static sanitized rejection.

| Signature | Caller / exact behavior and return |
| --- | --- |
| `identity_recovery_gate(p_environment text,p_policy_digest text)` | auth/control; exactly one permanent policy row FOR UPDATE NOWAIT, matching environment/config digest; returns `(policy_revision bigint,enabled boolean,checked_at bigint)`. LIVE command adapter/DB transition guards require enabled and finite capacity. Maintenance may lock disabled policy but cannot issue/complete; no caller boolean bypass |
| `identity_recovery_user_locks(p_case_id uuid,p_session_digest text,p_source_ids uuid[])` | auth only; exactly3 ordered ENROLLMENT/APPOINTMENT/CONTACT IDs, canonical64hex security-only Session digest. Existing LIVE case: source IDs/session-hint actor must match case. Absent case: registration-only, derive subject/verifier from the three approved CURRENT source rows in one environment, actor from own Session hint; no arbitrary UserId parameter. Lock bound policy first, then exactly three distinct ACTIVE Users sorted, target UPDATE / others SHARE NOWAIT, fresh no target grant history; return `(user_id uuid,user_revision bigint)` exactly3 rows. Caller signed registration/expected versions and later actor guard must match before commit. Safe-read/CANCEL use actor guard instead |
| `identity_recovery_actor_guard(p_case_id uuid,p_session_digest text,p_mode text)` | auth only; closed modes LIVE/OUTCOME/CANCEL; internally acquire bound policy gate first and required sorted User lock subset, actor shared try-barrier, slots/Session/grant NOWAIT, exact current ACTIVE/revision/epoch/liveness/grant eligibility. LIVE acquires both actor SHARE and subject direct UPDATE slots in UserId order before Session/grant, or re-acquires exactly those already held locks; it never grants actor slot SHARE first then upgrades the subject slot later. User locks precede slots; source IDs derive from immutable case. OUTCOME locks actor only for safe read of terminal/incomplete case, no target version checks, no write authorization. CANCEL locks actor only for an incomplete case, ignores target/source staleness/expiry, authorizes only cancellation. OUTCOME/CANCEL use fresh actor versions and one currently effective grant for the same bound actor (deterministic grant_id order, LIMIT1, SHARE NOWAIT), not obsolete case versions/grant; LIVE requires its originally bound grant/expected versions. Returns `(actor_user_id uuid,actor_user_revision bigint,actor_slot_revision bigint,actor_security_epoch bigint,admin_grant_revision bigint,absolute_expires_at bigint,idle_expires_at bigint,grant_valid_until bigint)`; last column nullable, no verifier/token digest/history |
| `identity_recovery_source_block(p_source_id uuid,p_expected_revision bigint,p_request_id text,p_event_ids uuid[])` | control only; gate first, current source CAS; BLOCK source and all logically-live incomplete dependent cases/tickets, provenance same client, already-dead rows remain ineligible without cleanup; returns void, no Credential mutation/secret SELECT. Expected source revision precedes already-BLOCKED no-op; no delete. Reject true live-capacity violation rather than partially cancel a batch. Server supplies a bounded UUIDv7 array from the existing issuer; after fresh locked reread, consume IDs in case_id order, validate sufficient capacity/UUIDv7/distinctness and roll back the whole operation on failure |
| `identity_recovery_reserve(p_environment text,p_policy_digest text,p_phase text,p_keys text[])` | auth only; exactly three GLOBAL/SITE/SUBJECT purpose-HMAC keys in that order, closed phase; gate NOWAIT; DB-time finite window/bucket count/caps, reserve all dimensions atomically or false with no partial increment; returns boolean, no bucket rows |
| `identity_recovery_prune(p_environment text,p_policy_digest text,p_limit integer)` | auth only; gate NOWAIT, delete expired buckets only, limit1..500; returns integer. No recovery history/case/outcome deletion capability |

Gate helper's returned policy projection is not a transferable permit; command adapter must enforce enable before LIVE actions, and transition/consistency guard rechecks enabled/matching case environment for newly issued/completed rows. Source-block function locks the gate directly in maintenance mode; browser has no mode to invoke it. Policy enable/disable command obtains the same gate before UPDATE; CREATE/registration provisioning follows gate→sources, with bounded NOWAIT locks. Definer helpers are fixed capabilities and also enforce their own prerequisite lock order when directly invoked; no GUC, passed permit or claim about prior locks bypasses it. Policy enable mutation cannot enable missing/expired config/evidence service. Direct SQL login is a trusted server capability, not an HTTP caller; a browser cannot obtain these roles or construct server handles.

Two trigger functions from E.3 also use owner SECURITY DEFINER/fixed path/row_security and are not externally callable: REVOKE EXECUTE from PUBLIC and all runtimes; trigger firing still works. They receive only NEW/OLD closed table rows. The only owner read exception beyond existing capabilities is the scoped audit policy. Do not modify existing functions to add recovery purpose; existing admission, Session guard, FIRST and control allowlists remain frozen.

### E.7. E8-P05 — Private transport and exact operations

Deployment mode `SINGLE_PROCESS_ATTENDED_HTTPS_V1`. One dedicated recovery service process owns both lane registries and auth pool; independent private HTTPS listener/backend, not Next.js route registration or public Identity namespace. Approved reverse proxy mounts the private listener at the **same exact configured HTTPS origin** as staff's existing Identity Session but exposes recovery paths only to authenticated approved terminal certificates/private network. Public proxy must return a fixed 404 for the recovery prefix; no wildcard forwarding. Staff log in using the existing normal login flow; private recovery adds no public/private login endpoint or identifier resolver.

Two dedicated managed browsers/terminals have distinct proxy-verified client certificates assigned OPERATOR vs SUBJECT. Proxy overwrites lane/site/environment identity headers, strips all caller copies, backend reachable only from that proxy over approved authenticated link; Node adapter constructs a registry-backed TransportHandle from actual peer/proxy evidence. A caller header, shared certificate, same device/browser profile or body `lane/site/actor` cannot establish authority. Physical procedure gives only the SUBJECT browser to the person setting the password; staff cannot access its page/recording. Concrete DNS/cert/proxy/network/personnel values remain deploy-approved configuration; no implicit local fixture/default install.

All endpoints POST under private `/_zhiban_recovery/v1/`, same-origin JSON, X-Zhiban-Request=`manual-recovery-v1`, exact Origin, Sec-Fetch-Site compatible with same-origin, no Authorization/URL query/fragment/token redirects; duplicate/ambiguous security headers reject. Body≤8192 bytes, headers≤8192 bytes, finite body timeout, unexpected keys reject, no content encoding/CORS/third-party scripts. Existing generic Request/Node header parsing may be reused without changing public 8D protocol. Request IDs server-created safe refs, no request/body/token logging.

| Operation | Lane / exact input and output |
| --- | --- |
| `operator/context` | OPERATOR; body `{}` plus current Session cookie. Returns private CSRF proof plus safe current actor metadata; no role/grant roster |
| `operator/register` | OPERATOR; `{enrollmentRef,appointmentRef,contactRef,approvalRef,currentPassword}`; refs resolve trusted signed store. CaseId/expected versions/people are server bound; returns `{caseId,revision,state}` |
| `operator/verify` / `operator/approve` | OPERATOR; `{caseId,expectedRevision,evidenceReceiptRef,currentPassword}` / `{caseId,expectedRevision,preNoticeReceiptRef,currentPassword}`. Trusted store independently validates fixed receipt and manifest; no `verified:true`. Returns safe case state/revision |
| `operator/pair` | OPERATOR; `{caseId,expectedRevision,currentPassword}` after APPROVED. Trusted deployment maps this operator station to one distinct SUBJECT terminal. Returns process-private pairingCode through secret response boundary plus safe case reference; the code is a pairing locator, not recovery ticket/normal Session. Display transiently for the assigned subject terminal; no persistence/URL/log |
| `operator/issue` | OPERATOR; `{caseId,expectedRevision,deliveryReceiptRef,currentPassword}`. Initial/reissue distinguished by persisted state, fixed approved intent; raw ticket goes only through the Infrastructure delivery boundary to paired SUBJECT context, never operator response. Returns safe state/revision/generation |
| `subject/context` | SUBJECT; `{pairingCode}` in body, exact Origin/custom header. One-use process-local pairing locator typed `mpair1_`+32 random bytes, generated after case approval, transferred transiently without secret URL. Returns subject-only ceremony CSRF proof, sets separate ceremony cookie; no subject User metadata |
| `subject/ticket` | SUBJECT; body `{}` plus ceremony cookie/CSRF after successful issue. Exactly-once Infrastructure response `{ticket}` for this paired terminal; generation registry marks delivery before sending. Lost response requires authorized reissue; pending/foreign/already-delivered has fixed no-ticket response, no account facts |
| `subject/submit` | SUBJECT; `{ticket,newPassword}` plus subject ceremony/CSRF. Hashing occurs within receiver security boundary; returns `{status:'READY'}` only. Server delivers a safe submission locator to the paired operator's case view; no verifier or target password in response |
| `operator/ready` | OPERATOR; `{caseId,currentPassword}`; current authentication/approval read returns safe `{state,submissionRef,caseRevision,ticketGeneration}`, submissionRef nullable when not ready; no secret/verifier. Reading never grants completion permission |
| `operator/complete` | OPERATOR; `{caseId,expectedRevision,submissionRef,currentPassword}`. New step-up binds exact server submission/approved intent and current request. Returns `{status:'COMPLETED',caseId,commandRef,notification:'PENDING'}` on confirmed commit; no Session issue |
| `operator/cancel` | OPERATOR; `{caseId,expectedRevision,currentPassword}`; current authorized executor only, CAS terminalizes active tickets. No user-disable/credential-revoke side effect |
| `operator/outcome` | OPERATOR; `{caseId,currentPassword}`; current actor/step-up safe-read branch, reports COMPLETED/NOT_COMPLETED/OUTCOME_UNKNOWN plus safe case revision/state/command/notification as available. Locks resolve incomplete as well as terminal status; COMMIT uncertainty is queried here, never auto replayed |
| `operator/ack` | OPERATOR; `{caseId,noticeKind,expectedRevision,receiptRef,currentPassword}`; store proves independently appointed verifier's manual delivery receipt, exact case/route/version. Executor cannot fabricate delivery boolean |

The register step imports the fixed independent appointment/enrollment/contact records; VERIFIED/APPROVED receipts come from the separately signed evidence store. Because all case bindings/expected target versions are fixed at registration, any later change requires a new case, no registration-time default source substitution. Pairing is completed through operator/pair→subject/context before issue, under trusted terminal assignment, not arbitrary URL/body endpoint. Issue commits ticket digest first and holds raw ticket only in this bounded paired delivery registry until subject/ticket reads it once; a process crash loses that value and requires reissue. Pairing and raw ticket cannot be queried from a successful outcome. Delivery failure after ticket commit cancels ticket through fresh authorized mutation; never replays a retained response.

`deliveryReceiptRef` proves the verified person's physical handover to the assigned private terminal and readiness for this planned ticket generation, independently attested before issue; it does not claim a future network response was received. Actual subject ticket possession is additionally checked at submit/completion. Every reissue requires a new generation-bound handover receipt. Disable/backlog closes REGISTER/VERIFY/APPROVE/PAIR/ISSUE/SUBMIT/COMPLETE; authorized CANCEL/OUTCOME/ACK and source blocking remain available through their explicit closed branches, with admission still bounded. Cancel does not require target ACTIVE or source freshness, so an abandoned case can safely terminate after those facts change.

Staff cookie remains existing `__Host-zhiban_session`, HttpOnly/Secure/Lax/Path=/, no Domain. Separate `__Host-zhiban_recovery` cookie contains a CSPRNG ceremony locator (no normal Session authority), HttpOnly/Secure/Strict/Path=/, no Domain, expiry min(case deadline,ceremony TTL). SUBJECT receiver ignores any normal Session cookie as authority. Only subject context response sets it; cancel/expiry/completion clears it and registry state. OPERATOR requests use a recovery-purpose Session-bound synchronizer proof; SUBJECT requests use ceremony/site/lane-bound synchronizer proof. Keys are per service process; process restart invalidates them. SameSite alone is insufficient; exact Origin and custom proof are required, including cancellation/reads carrying sensitive refs.

Explicit bootstrap exceptions: operator/context has no preexisting recovery CSRF proof, so requires approved OPERATOR transport, exact Origin/custom header and current staff Session; it is a safe read issuing a new proof, not a case mutation. subject/context likewise requires approved assigned SUBJECT transport, exact Origin/custom header and one-use pairingCode; it can only create its bound ceremony and initial proof. Every other operation requires the respective synchronizer proof in `X-Zhiban-CSRF`. Fresh step-up binds request identity, case/target/site, operation and exact expected revision/submission/receipt intent; successful prior context/ready is not permission for completion.

All responses Cache-Control:no-store, Referrer-Policy:no-referrer, CSP default-src 'none' with only explicitly approved self UI script/style/connect sources, frame-ancestors 'none', form-action 'self', base-uri 'none'; no inline untrusted code/APM/session replay/service worker. Subject UI clears input immediately after submit/expiry/cancel, disables clipboard/persistence/debug capture according to managed-terminal policy, never asserts reliable JS memory erasure. No localStorage/sessionStorage/URL bearer. Minimal private terminal interface is confined to recovery ceremony, not a Portal or OpenMAIC UI.

Unknown/wrong/foreign/expired/cancelled ticket, missing pairing or malformed security state all map to fixed `RECOVERY_REJECTED` without target existence/version details; oversized/method/origin requests use generic protocol status. Busy/admission/storage outage returns fixed `RECOVERY_UNAVAILABLE`; current actor auth failure returns normalized rejection. Completion transport loss returns `OUTCOME_UNKNOWN` internally; operator asks outcome with fresh authentication. No error cause/provider text/SQLSTATE/params in HTTP/log/audit. Status/error timing is not claimed overall constant-time; random ticket strength, limited admission and no existence metadata are the first-line controls.

### E.8. E8-P06 — Material and single-process registries

Ticket encoding `mrec1_` followed by canonical unpadded base64url of exactly32 random bytes (43 chars). Strict decode→reencode equality, no Unicode/whitespace/truncation/alternate prefix. Digest preimage is UTF-8 fixed label `zhiban-manual-recovery-ticket-v1`, a NUL separator, fixed environment/site/case UUID/generation with NUL separators, and decoded random32 bytes. Hash SHA-256; digest/PHC material stays security-specific Infrastructure. Separate contexts/keys for pairing, ceremony, submission locators and CSRF; never accept Session/CSRF token as ticket. Input digest can be derived only after case-bound ceremony identifies generation; querying arbitrary supplied target IDs is disallowed.

Process maps keyed by unguessable server locators hold ceremony binding and submission: caseId, actor/subject/site/lane, ticketId/generation, expected case/source/User/slot versions, manifest/intent digest, request/command refs, DB-issued deadline and monotonic start, one valid PasswordVerifierHandle. Ordinary Application receives an opaque handle or safe locator only; registry lookup and ownership authenticate it. No durable submission verifier, no generic queue/Redis/file/session DTO. The independent signed approval remains immutable; the final request-scoped step-up safe intent additionally binds submissionRef, case revision, ticket generation and original approval digest. It is not a digest/fingerprint of password/verifier and does not rewrite the signed approval.

Create a dedicated `RecoverySecurity` registry/bridge with its own request handles and step-up proof allowlist. It resolves current staff bearer in Infrastructure, validates existing Session/credential state, issues request-bound proof for the exact recovery action/intent and consumes it once. Reuse existing pure material validators and provider, not the MembershipSecurity action union, FIRST proof purpose or fabricated existing AuthenticatedRequestHandle. Existing public Ports/private binding registries remain unchanged; new composition accepts only handles issued by its own actual registry.

Subject ticket remains ACTIVE while hashing; after hash, a short validation transaction rechecks ceremony/case/ticket/source/version bindings and attempt budget before publishing the in-memory submission. Hashing may fail or race cancellation; discard result, never consume ticket on screening/hash failure. Admission/attempt reservation happens **before** KDF in its own short transaction, so rollback of reset cannot erase guesses from budget. Ticket attempts CAS does not advance case revision; issue-generation/case binding is unchanged. Reissue/cancel makes every old submission unusable immediately by DB checks, even if a process map has not been pruned.

Exactly one latest submission per live ticket; new successful subject submission invalidates prior one and its intent-bound step-up. Completion atomically claims registry entry before SQL so concurrent operator requests cannot share it. Confirmed rollback discards verifier/handle and allows bounded fresh subject submission while ticket live; uncertain COMMIT quarantines/discards handle, outcome query only. No retry reuses the handle. Raw password exists only during input/hash; no permit-wait queue. Restart loses ticket-delivery/ceremony/submission material; DB cases stay coherent but resumption requires authorized reissue or new case, not secret reconstruction.

Case lifetime30min/ticket10min fixed. Approved ceilings: ceremonyTTL≤10min, submissionTTL≤5min and never beyond case/ticket deadline, registry maximum≤256 and finite request cap≤64; concrete smaller values pinned in deployment manifest. Step-up remains ≤5min and checked both wall/monotonic. If elapsed negative, database time backwards relative to locked state, source/Session deadline exhausted, registry missing or deployment changed, reject. Hash time does not extend ticket lifetime.

### E.9. E8-P07 — Provenance, notifications, bounded configuration

Provenance event closed vocabulary: REGISTERED, VERIFIED, APPROVED, TICKET_ISSUED, TICKET_REISSUED, COMPLETED, REJECTED, CANCELLED, EXPIRED. Exactly one case event per changed case revision; attempt counters and notice ACK are distinct ticket/notification mutations. Source-block cancellation emits CANCELLED with closed reason SOURCE_BLOCKED and approved service actor. Other terminal reasons USER_REQUEST/VERIFICATION_REJECTED/DEADLINE_REACHED/DELIVERY_FAILED/SECURITY_POLICY; no free-text evidence. Outcome uses existing audit payload unchanged (priorCredentialId nullable, credentialId, revision before/after, epoch before/after); deferred validator requires correct actual actor/subject/time/reason and corresponding Credential history.

Notification fixed PRE_RESET/COMPLETED payload is reconstructed from safe case/event fields and routeRef, never stored arbitrary text. PRE_RESET trusted ACK is prerequisite to issue; COMPLETED PENDING created in reset transaction, dueAt from policy. Manual verifier delivers and evidence store signs closed receipt binding case/kind/source version/verifier/delivery time; operator records ACK with own fresh authority and step-up. Failure keeps PENDING, disables new issuance at backlog/age thresholds, preserves success outcome. No automatic repeated reset or secret resend; contact remedy uses independent approved registry process.

Canonical approved deployment record supplies policy fields from E.3 plus fixed origin/environment/site/certificate allowlist, single-process topology, staff trust/key references, evidence/receipt backchannel, private proxy acceptance, auth-only DSN secret reference, production corpus, process capacity/timeouts and responsibility/retention approvals. Defaults do not enable recovery. Safe policy digest excludes secrets and includes all numeric budgets; configure once, immutable digest. This first implementation permits only enable/disable CAS on the permanent environment row, no runtime config replacement/delete. A later policy-value change requires disabling recovery and a separately reviewed migration/configuration change with incomplete-case cancellation; it cannot create a second independent gate for the same environment or renew old deadlines.

Approved finite validation ceilings: registeredTTL≤24h, windows≤1h, limits/maxBuckets/maxTotalCases≤1,000,000, maxLiveCases≤256, per-subject registered≤4, attempts/ticket≤5, maxPending≤256, pendingAge/delivery interval≤24h, SQL/body timeouts≤30s. All positive and internally compatible, no zero/unlimited sentinel. Live-case capacity counts REGISTERED before its deadline plus VERIFIED/APPROVED/TICKET_ISSUED before case deadline, so source blocking never relies on an unbounded executable batch. Activation requires Node22/production Argon2 capacity and terminal drill to choose actual values; these upper bounds are not performance claims. Enrollment/appointment/contact validity is independently finite and cannot exceed their actual approved records.

Shared reserve uses purpose-specific HMAC-SHA256 keys with approved server secret, environment/phase/dimension separation; actual site and canonical subject come from trusted transport/case, not request IP/user claims. Unknown pairing attempts have one approved site-scoped unknown bucket; invalid bodies are admission-bounded before parse/KDF. Bucket expiry/prune is bounded and concurrency-safe under gate. Case/source/provenance history has no runtime deletion/archive capability: finite maxTotalCases yields explicit unavailable before exhaustion, registered/live count and notice backlog are checked using DB time independent of cleanup. Long-term archive/delete/privacy retention is separate operations approval; BUILD cannot silently purge history or claim unbounded production longevity.

### E.10. E8-P08 — Verification matrix and delivery gates

No tests or migrations executed in this design-only unit. BUILD must add targeted unit/contracts and a real `pg16-manual-recovery.test.ts` to existing two complete PG16 runs; retain all twelve old suites and 282 per-run baseline tests, current 1331 non-PG Identity tests, lint/typecheck/frozen install and production Argon2 policy. Report actual new counts, not a guessed final number. No CI dispatch before approved BUILD/checkpoint/remote verification.

| Proof group | Mandatory concrete assertions |
| --- | --- |
| Schema/migration | 0001–0009 Git blobs and ledger checksums unchanged; 0010 parser/apply/second-run NO-OP/drift/rollback/advisory lock; UUID/int8/time/shape/FK/terminal guards, wrong owner/role/overloads fail |
| Evidence | Real Node Ed25519 signed fixture valid; exact ed25519/null-algorithm API; wrong issuer/key/purpose/environment/case/version/appointment/revoked source reject; register→verified DB deadline→signed final approval chronology; forged boolean/body store reject; source BLOCK cancels live incomplete cases atomically before new external version, already-dead rows cannot block revocation; completed history preserved |
| People/authority | Subject/verifier/actor separation; tenant admin alone deny; all target SystemAdmin histories deny; verifier disable/restore revision and appointment revocation invalidate old approval; actor revoked/expired/future grant, disabled/restore, logout/slot change invalidate proof; no whole grant-table SELECT |
| Material/provider | Actual production Argon2 screening false-only; nonboolean/throw fail closed; dummy initialization and salt behaviors retain old coverage; fake/foreign registry handles reject; ticket decode canonical/purpose isolation/32byteCSPRNG; exception/log/audit/DB assertions contain no raw material |
| Lifecycle/time | Case VERIFIED deadline, registered deadline, approval/reissue no renewal; attempts before KDF; stale-before-no-op; repeated ACK exact idempotence; ticket/submission/ceremony/step-up/Session/grant/source expiry boundaries and clock rollback; max revision/epoch/generation fail closed |
| Atomicity | Fault at each slot/history/audit/case/ticket/event/outcome/notice write rolls all mutations back; same password still +1; revoked reestablishment requires clearance/new generation; COMMIT tag/uncertain disconnect never returns confirmed success or auto replays |
| Concurrency | Independent connections and acknowledged locks for dual consume, source-block/reset, reset/change/revoke/rehash, actor logout/logout-all/grant revoke, User disable/restore, Session INSERT both orders, grant INSERT both orders including uncommitted FK holder; old slot-first writer must induce immediate recovery rejection, not a User↔slot wait cycle |
| ACL/RLS | Actual auth SQL roles execute only exact helpers; tenant/control/PUBLIC table/column/function secret access denied; helper caller/NULL/foreign case/closed mode tests; source-bound pre-case registration without generic User UPDATE; direct helper invocation retains gate/User/slot order; narrow owner audit policy does not expose unrelated audit; no tenant context leakage or altered policies |
| Private Node HTTP | Actual Node incoming requests/proxy fixture, overwritten lane headers and approved distinct terminal certificates; public prefix inaccessible; explicit context bootstrap proof acquisition and all subsequent proof requirements; omitted/duplicate Cookie/header/origin/CSRF/body timeout/encoding/oversize tests; SUBJECT cannot use operator cookie as proof; OPERATOR cannot send/read newPassword/verifier/raw ticket |
| Registry/outcome/notice | Cancellation/reissue/restart clears or DB-invalidates old handles; competing completion one registry claim and at most one committed outcome; old Session denied; safe outcome read works after target epoch/source changes, returns unknown while original commit unresolved and NOT_COMPLETED after confirmed rollback; later normal change/rehash/revoke plus notification ACK succeeds with immutable outcome; pending notice survives process loss and blocks new issuance when overdue |

Synthetic PG fixtures need current consistent DB clocks and real production provider dummy initialization; never lower cost, alter encoding to skip screening, use fixture-only authority in production default, or assert old Session rejection by weakening verification. Parallel tests must acknowledge barriers/locks; no sleep-only race. Every lock helper is exercised at restricted runtime, superuser only for isolated seed/catalog/cleanup. Any parser/SQL/assertion failure has ordinary fix in the authorized build scope; frozen semantics conflict stops implementation.

Implementation sequence after precise approval: 0010/ACL/constraint and contract tests → evidence/material/registry/admission → same-client issue/complete/outcome/notice → private protocol/synthetic terminal harness → targeted/full Identity/typecheck/lint → High review/normal fixes → separately authorized exact checkpoint/remote check → new CI two-run signoff → closeout → separate real operational acceptance. Actual enrollment/contact/personnel/private HTTPS/certificates/signing issuer/corpus are not created from this design. Special platform administrator recovery remains CLOSED; production release must state that limitation and satisfy the separately approved governance gate.

### E.11. Design review and final supplement state

High design review corrected lock-cycle avoidance, evidence revocation state, safe outcome reads independent of stale target epoch and unresolved commit, historical consistency after later credential mutation, source-bound pre-case lock acquisition, signed approval chronology, bootstrap CSRF and subject-only raw ticket/password lanes. E.12 records all approval-review closures. No observed need to change frozen Domain/Credential/Session semantics, role model, old migration content or public route allowlist. These are design conclusions, not real PG16 or deployment evidence.

Reference support: [PostgreSQL 16 locking](https://www.postgresql.org/docs/16/explicit-locking.html) describes UPDATE versus KEY SHARE and conflict behavior; [function security](https://www.postgresql.org/docs/16/sql-createfunction.html) supports fixed trusted search paths; [column privileges](https://www.postgresql.org/docs/16/ddl-priv.html) informs exact grants; [OWASP CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html) supports origin/proof checks beyond SameSite. Project-specific composition and race outcomes still require the tests above.

E8_S01_S08: HUMAN_APPROVED_AND_FROZEN

EXACT_SUPPLEMENT: HUMAN_APPROVED_AND_FROZEN

EXACT_APPROVAL_ITEMS: E8-P01–P08

EXACT_APPROVAL_STATUS: ALL_EIGHT_HUMAN_APPROVED

EXACT_REVIEW_VERDICT: PASS

APPROVED_MIGRATION: 0010_identity_manual_recovery.sql

APPROVED_NEW_TABLES: 8

APPROVED_CALLABLE_HELPERS: 6

APPROVED_INTERNAL_TRIGGER_FUNCTIONS: 2

APPROVED_OWNER_AUDIT_RLS_EXCEPTION: RECOVERY_OUTCOME_LINKED_READ_ONLY

PUBLIC_RECOVERY: CLOSED

PRIVATE_TRANSPORT: PRECISE_DESIGN_FROZEN / NOT_INSTALLED

PRODUCTION_CONFIGURATION: NOT_APPROVED_OR_INSTALLED

APPLIED_MIGRATIONS_0001_0009: UNCHANGED

FROZEN_CONTRACT_CONFLICT: NO_OBSERVED

SCHEMA_BLOCKER: NONE_OBSERVED_AT_DESIGN_STAGE

CURRENT_SUPPLEMENT_DESIGN_P0: 0

CURRENT_SUPPLEMENT_DESIGN_P1: 0

CURRENT_SUPPLEMENT_DESIGN_P2: 0

IMPLEMENTATION: NOT_STARTED

TEST_EXECUTION: NONE_DOC_ONLY

COMMIT: NO

PUSH: NO

CI_DISPATCH: NO

### E.13. BUILD prerequisite signature closure

The human explicitly approved the minimal source-block signature supplement during BUILD: add `p_event_ids uuid[]` to the existing helper, retaining exactly six callable helpers and every existing role/table privilege. The trusted provisioning service generates at most the approved max_live_cases (never more than 256) UUIDv7 event IDs with the existing Node issuer before calling SQL. The helper validates a one-dimensional, non-null, distinct UUIDv7 array; after the gate/source CAS and fresh live-case reread, it requires sufficient IDs and assigns them in canonical case_id order. Empty arrays are allowed only when no live case needs cancellation. Unused IDs convey no additional capability. Insufficient/invalid/colliding IDs abort the entire transaction. No SQL UUID algorithm, event-ID reuse or partial batch is permitted. This approved clarification supersedes the former three-argument signature; recovery lifecycle, table ACL, audit vocabulary and frozen migrations remain unchanged.

SOURCE_BLOCK_EVENT_ID_SUPPLEMENT: HUMAN_APPROVED_AND_FROZEN

READY_FOR_EXACT_SUPPLEMENT_REVIEW: COMPLETED

READY_FOR_1B8E_SUPPLEMENT_CHECKPOINT: YES

READY_FOR_1B8E_BUILD: NO_PENDING_SUPPLEMENT_CHECKPOINT_REMOTE_VERIFICATION_AND_BUILD_AUTHORIZATION

Next task: approved single-document exact supplement checkpoint and independent GitHub HEAD/message/parent verification (GPT-6.1 Sol / Low), followed by separately authorized BUILD (GPT-6.1 Sol / High). Deployment values and special administrator recovery retain separate approval/acceptance gates.

### E.12. Human approval review closure

Approval date: 2026-10-04. Human request: **“审阅并批准 E8-P01–P08”**. Review baseline `1a8c706c5f5b4ddda14b8f581f1e7bf80c810a7c`; worktree before review contained only this design supplement. Review re-read the actual existing grants/ACL, Credential mutation/history, User and Session FK/barriers, transaction wrapper, public HTTP proof handling and Appendix E, and checked official PostgreSQL16/Node22 semantics. No production/test/migration/workflow/package edit or test/CI execution.

| Item | Final result |
| --- | --- |
| E8-P01 | PASS / APPROVED; eight-table inventory with explicit historical FKs, initial counter/null shapes and subsequent Credential mutation-safe consistency |
| E8-P02 | PASS / APPROVED; signed registration/verification/final-approval chronology, key-to-source revocation binding, all three User revisions |
| E8-P03 | PASS / APPROVED; one-client CAS/epoch/audit/notice, gate/User/slot non-waiting lock order, no unresolved-COMMIT replay |
| E8-P04 | PASS / APPROVED; six exact helpers including source-bound registration before case FK, closed safe-read/cancel modes and narrow owner audit-read exception |
| E8-P05 | PASS / APPROVED; fixed private operations, two transport-verified terminals, explicit CSRF bootstrap and proof requirements |
| E8-P06 | PASS / APPROVED; ticket/delivery/submission single-use registries, bounded lifetimes, uncertain commit queries without secret reconstruction |
| E8-P07 | PASS / APPROVED; immutable provenance/outcome, durable notification and finite live/history/admission limits, bounded source revocation |
| E8-P08 | PASS / APPROVED; restricted-role migration/ACL/real races/provider/Node HTTP proofs plus all old regression suites retained |

| Review finding | Resolution included in this approval |
| --- | --- |
| Later Credential mutation changes recovered row slot_revision/status | Keep completion versions in immutable outcome/audit; historical linkage uses immutable ID/User/generation/created_at and allows legal later revision/state |
| Terminal-only read cannot distinguish a rolled-back unknown completion | OUTCOME is an actor-authenticated safe read of incomplete or terminal state, serialized by gate/case locks; busy remains unknown, never auto retry |
| Pre-case registration cannot call a case-only User helper | Six-helper inventory retained; user_locks has exact source-ID/Session-digest form, derives only registered people, locks before User FK INSERT; no generic User UPDATE grant |
| Missing verifier revision / initial counter shape / exact FKs | Add expected_verifier_user_revision, case generation0 and attempts0, new-table composite constraints and deferred existing grant PK association check |
| Approval signature references future notification/verified time | Separate immutable registration and signed final approval after actual DB verification time/pre-notice receipt; approval fields fill once at APPROVED |
| No CSRF proof exists at first context request | Only two explicit context bootstrap operations may create proof after exact Origin/custom header and real lane/Session or pairing; every other operation requires proof |
| Historical expired case backlog can prevent source blocking | Block source and cancel bounded logically-live set atomically; deadline alone keeps old rows dead, without cleanup prerequisite |

The user approval freezes these review-corrected exact contracts. This E.12 approval state supersedes earlier historical labels saying exact schema/ACL/transport approval is still pending, while the S01–S08 channel decisions remain unchanged. Approval does not configure real evidence/personnel/certificates/contacts, permit privileged administrator recovery, claim PG16 execution or authorize implementation. Current design P0=0, P1=0, P2=0; BUILD/operational findings remain for their actual acceptance stages.

E8_P01_P08: HUMAN_APPROVED_AND_FROZEN

APPROVAL_REVIEW: COMPLETE / PASS

READY_FOR_1B8E_SUPPLEMENT_CHECKPOINT: YES

IMPLEMENTATION: NOT_STARTED

COMMIT: NO

PUSH: NO

CI_DISPATCH: NO
