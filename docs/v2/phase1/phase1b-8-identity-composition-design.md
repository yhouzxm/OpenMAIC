# Phase 1B-8A Identity Application / API / Security Composition Design

STATUS: HUMAN_APPROVED / DESIGN_FROZEN / IMPLEMENTATION_NOT_AUTHORIZED

Date: 2026-10-03. Branch: `refactor/zhiban-v2`. Design base HEAD: `bf3f9139f28a1f87edc7e15aa3ab8d97452aaadd` (`docs(zhiban-v2): close out authorization layer`). Preflight worktree: CLEAN.

2026-10-03 用户明确批准：“批准1B-8A 设计”。本批准冻结本文已描述的 A8-01–05 设计选择与推荐方向，包括 UserId-first、注册用户邀请/consent/fresh approval、Session-at-write 与本人空间发现边界、有限 bootstrap 和闭集 provenance/幂等要求。本文中“提案/推荐”是方案形成时的称谓，审批状态以第 15 节为准；不再表示这些已描述方向尚待产品选择。

批准不扩展为实施授权，不批准本文尚未给出的逐字段 schema/完整 ACL/RLS SQL、部署阈值/代理配置/具名运营责任，也不批准受控人工恢复的具体能力。精确 schema/ACL 补充与人工恢复仍保留独立审批 Gate。本文不实现 Application use case、HTTP、配置、数据库对象、测试或 workflow，不 commit/push/dispatch。下一步为文档 checkpoint、独立远端核验；随后补充精确 schema/ACL 设计并另行授权 BUILD。

## 1. 权威、实际资产与设计缺口

实际读取：[执行计划](../zhiban-v2-execution-plan.md) 的 1B-8A–E；[实施计划](phase1b-implementation-plan.md)、[Gate Map](phase1b-gate-map.md)、[认证边界](auth-boundary.md)、[Session 策略](session-strategy.md)、[RBAC](rbac-model.md)、[权限矩阵](permission-matrix.md)、[授权流程](authorization-flow.md)、[租户隔离](tenant-isolation.md)、[ADR-009](../adr/ADR-009-rbac-policy.md)、[ADR-010](../adr/ADR-010-authentication-session.md)、[ADR-011](../adr/ADR-011-tenant-isolation.md)。

完成范围以 [1B-2 review](phase1b-2-review.md)、[1B-4 closeout](phase1b-4-review.md)、[1B-5 closeout](phase1b-5-review.md)、[1B-6 closeout](phase1b-6-review.md)、[1B-7 design](phase1b-7-authorization-design.md)、[1B-7 closeout](phase1b-7-review.md) 解释，历史 NOT_IMPLEMENTED 标记不重新开启已关闭问题。

代码审计依据是 `lib/zhiban/application/identity/ports/**`、`authorize.ts`、Identity Domain、`infrastructure/identity/credentials/**`、`sessions/**`、`authorization/identity-catalog.ts`、PostgreSQL repositories/transactions/bootstrap/0001–0007，以及当前 Identity tests 和现有 `zhiban-identity-pg16-security.yml`。特别读取 Session validate/rotate/revoke、Credential mutation、User/Tenant/SystemAdmin 自有事务、Authorization guarded mutation 与 0006/0007 锁序。没有把聊天摘要、测试 fixture、对象 brand 或 repository 名称当作实现证明。

| 资产 | 状态 | 可复用能力 / 尚缺内容 |
| --- | --- | --- |
| Identity Domain / repositories | EXISTS / FROZEN | global User、Tenant、Membership/history、SystemAdmin；UUIDv7 类型不是生产发行服务 |
| Credential | EXISTS / FROZEN | PASSWORD、canonical UserId、private verifier、Argon2id、screening、CAS/epoch/audit；无友好登录标识 |
| Session | EXISTS / FROZEN | opaque token/digest、User revision/epoch、expiry/touch/revoke/rotation、cookie/CSRF policy；无 HTTP wiring |
| Authorization | EXISTS / FROZEN | fresh facts、同 grant permission+scope、ceiling、last-admin 同事务 primitive；尚无完整受保护用例 |
| Catalog | PARTIAL | approved adapter 已实现；稳定生产 RoleIds/approvalRecord/contentDigest 未配置，禁止 fixture 默认 |
| UUIDv7 issuer / login resolver | ABSENT | 当前直接 dependencies 无 UUIDv7 provider；nanoid 不能替代 UUIDv7 |
| User/Tenant/control 命令审计 | PARTIAL | closed events 存在；普通 create/save 自有事务不保证 Application append 原子性 |
| Session-at-write freshness | ABSENT | 1B-7 receipt 不含 Session；入口 validate 后的 logout/epoch/disable+restore 必须提交前防护 |
| Member admission / approval / durable idempotency | ABSENT | 1B1-F05 仍未关闭；`approvedGrants` 字段不证明批准来源 |
| Current-user space discovery | ABSENT | scoped findByUser 不是全局空间列表；auth 无 Membership SELECT，tenant 无 Tenant SELECT |
| Deployment admission / proxy trust | DEFERRED / ABSENT | KDF cap=2 与局部 locator budget 不能替代跨实例/IP 控制 |
| Public API / operator bootstrap / recovery | ABSENT / DEFERRED | 不存在 `app/api/zhiban/identity/**`；不能使用上游 owner/access-code/dev-auth 替代 |

已完成基线证据：1B-7 [run 37093587008](https://github.com/yhouzxm/OpenMAIC/actions/runs/37093587008)，implementation candidate `b0fb6b2d442cd7b51c75ad1c32527d3d69332526`；PG16 168/168 ×2、Identity 1017/1017、Node22/Linux、lint/typecheck PASS。这是前置证据，不是 1B-8 测试结果。本轮不 rerun。

## 2. 不可变边界与最小产品提案（A8-01）

GLOBAL User/Credential/Session 与 tenant Membership 分离。Session 只证明身份，TenantContext 只限定持久化范围。每次授权读取当前有效链；SYSTEM_ADMIN 不变成 tenant RoleGrant/教学超级用户。保持 1B-7 `identity-v1` 三角色精确 permissions、九个动作、delegation/self/validity 规则、last-admin 两种计数与 MAX_GUARD_USERS=256；不顺带开放 Course/Class grants 的无 loader 路径。

**已批准首版**：canonical UserId 登录；先有经批准的全局 User，再做 registered-user Membership 邀请/接受；不公开注册、不识别邮箱/手机号/用户名、不自动迁入 V1 身份。2026-10-03 用户明确选择“关闭公共找回，受控人工恢复另行批准”，随后批准完整 1B-8A 设计；UserId-first 与本首版产品范围为 HUMAN_APPROVED。人工恢复的具体能力/责任/核验仍未批准。

登录 resolver 只接受 bounded string，经明确 ASCII 外围空白去除与大小写规范化后得到 canonical lowercase UUIDv7；不接受 UUID 的花括号、URN、无连字符形态或 tenant prefix。仅 identifier 规范化，password 不 trim/normalize/truncate。合法但未知 ID 仍进入既有 dummy KDF；无效 identifier 使用 verifier 的无效 locator 路径，不伪造一个可能属于真实 User 的 fallback ID。credential Port 签名和内部 canonical locator 不改变。已是 canonical 的两个等价输入定位同 User；不存在 alias collision 或 tenant-password 复制。

未来用户名/邮箱方案要单独设计唯一映射、case/Unicode/collision、验证/变更历史及 privacy；不能往 User aggregate 临时加字段。首版关闭自主退出 Membership：既有 `MEMBERSHIP_LEAVE_ADMIN` 是管理动作，不冒充学生 self-service leave。没有产品审批时，邀请/恢复/控制面功能保持关闭而非返回虚假成功。

## 3. 运行配置与 ID 服务（A8-02）

生产 composition root 为 server-only，校验三个独立 runtime pool 的实际 session_user、安全属性与 migration inventory；拒绝 owner/migrator/superuser/BYPASSRLS、可 SET ROLE 的 runtime、跨数据库误配。Domain/Application 不 import pg/Next/crypto provider；Infrastructure 实现具体 typed security/composition Ports。不建立 generic UnitOfWork 或任意 SQL callback API。

UUIDv7 提案使用成熟 `uuid` provider 的 `v7()`，不自行位拼接、用 Math.random、把 uuid v4 改 version nibble、从 RoleCode hash 生成 ID。实施时再核验并精确锁定一个兼容 Node22/Windows/Linux 的版本，允许新增仅这一直接 dependency 的审批范围，不在本轮变更 package。使用 provider 默认安全随机源；生产不接受 caller msecs/random/seq。Port 六种 Domain ID 方法继续原签名；Credential/command ID 使用安全层专用发行方法，不将 SessionId 塞进 Domain IdGenerator。[Provider 官方契约](https://github.com/uuidjs/uuid)

发行服务验证 UUIDv7 的 48-bit Unix-millisecond 时钟范围（不能只用更宽的 Domain Instant 上限）；同毫秒支持多 ID；本 issuer 检测到 wall clock 回退则拒绝发行，待时钟追平/运维修复，不谎称重启前后/集群全局单调、永久去重或 UUID 本身是 bearer secret。数据库 unique constraint 是最后碰撞防线，冲突不自动重试敏感命令。时间戳范围与 UUIDv7 版本/variant 依 [RFC 9562](https://www.rfc-editor.org/rfc/rfc9562.html#section-5.7)，严格通过现有 validators。

三个 RoleId 在获准配置准备步骤一次生成，连同 approvalRecord 和 ApprovedIdentityCatalog 实际 canonical digest 记录到批准 manifest；不在文档捏造 ID，不每次启动重生成。审批内容固定 STUDENT/TEACHER 空 permissions、TENANT_ADMIN 的三项管理 permissions。拒绝缺失/不同内容/不同版本；采用已冻结 close/drain/switch-all/verify/reopen，而非配置热更新。

启动/入口开关还要求：明确 public HTTPS origin、Session policy、批准 local password corpus、部署 admission backend/阈值/可信代理、控制操作审批登记与责任人。没有 corpus 不允许创建/替换密码；只有 exact false screening 放行，错误/non-boolean fail closed。secret/header/body tracing 默认禁用。配置验证失败不能退回测试 Fake、dev auth、宽角色连接或无 limiter。

## 4. Application contracts 与身份/资源事实

建议 `application/identity/use-cases/**` 与职责专一的 Ports，`infrastructure/identity/composition/**` 实现；薄 HTTP 在 `app/api/zhiban/identity/**`。命名可在 BUILD 精化，但责任不能改变。

| 契约 | 只允许的责任 |
| --- | --- |
| LoginIdentifierResolver | bounded identifier → canonical locator/统一无效；不产生 VERIFIED/权限 |
| BrowserAuthentication | 使用既有 SessionAuthenticator / Session validation，返回内部 authenticated identity；普通 DTO 无 token/digest |
| AuthenticatedRequestHandle | security-private request-local Session binding，不能复制成 HTTP DTO 或长期授权证书；原 material 留 Infrastructure |
| RecentReauthentication | 当前密码验证 → 仅本次 command/action/target 的 private proof，绑定 User/credential revisions/epoch/Session；绝不返回 verifier |
| IdentityCommandPersistence | 具体 closed use-case intent → 同 client freshness/CAS/state/audit/idempotency；不接受任意 Domain 对象或已允许布尔值 |
| MembershipAdmission / Approval | 持久化可信 consent/approval binding，锁内消费；客户端 proposal 不是 approved fact |
| OwnSpaceQuery | 已验证 Session 的本人最小空间投影，不能输入任意 UserId 查询别人 |
| AdmissionPort | 在 identifier resolution/KDF 前原子申请全部署预算；无 plaintext queue |

Recent re-auth 推荐逐敏感命令验证当前密码，不凭 Session.createdAt/最近 touch/rotation 判断“最近重新认证”。proof 生命周期仅本请求、最多 5 分钟，跨 request/action/target/command 内容拒绝；锁等待后检查期限及全部绑定。tenant 管理激活/恢复/grant/撤权/disable/leave、logout-all、control state mutation、本人换密码均需相应批准的 step-up；普通 me/discovery/read 不强制 KDF。unknown/wrong/error 不能签发 proof。KDF、screening、网络渠道均在数据库 critical locks 之外。

请求 actorUserId 来自真实认证，MembershipId/target/TenantId 只是 locator。Application 从 scoped current data 构建 facts；客户端 owner/isTeacher/relationship/role/ALLOW/catalog/version/approval actor/time 均不得作为可信输入。客户端 expected revision 是并发条件，不是授权。内部 receipt 仍同时绑定 actor/target/global/catalog versions，不导出给浏览器作为许可证。

## 5. 逐用例设计矩阵

以下是已批准的 Application 用例设计契约，非已实现接口；涉及新增数据库对象或人工恢复的用例仍须通过第 12/15 节精确审批 Gate。T=tenant runtime 单事务；A=auth runtime 单事务；C=control runtime 单事务；P=批准的专用 operator protocol。所有 mutation 有 server requestId、safe command ID、closed reason；预期版本一律 stale-before-no-op，不自动 retry。与 bearer/password 相关的操作不持久化正文或 secret fingerprint。

| 用例 | actor / scope / trusted facts | 版本、事务与幂等 | Audit / 最小结果 / 拒绝 |
| --- | --- | --- | --- |
| Login | 匿名；canonical locator + real/dummy Credential verification | 既有 issuance 的 User/slot/revision/epoch recheck；A；不 replay 已发 bearer | rejected 用既有 AUTHENTICATION_REJECTED；success 仅 cookie，安全 UserId/expiry 投影；所有 credential rejection 同一 401 |
| Logout | cookie 对应本人 Session；Origin/CSRF | 同 A 验证+revoke；missing/revoked 可统一 idempotent 完成，不凭请求 SessionId 撤他人 | SESSION_REVOKED 同事务；204+clear cookie；数据库失败不宣称 server revoke 成功 |
| Logout all | ACTIVE 本人 + recent re-auth | 单 A，在锁内验证本次 Session 后撤本人全部；重复已撤不再 audit；无另一 client | SESSION_REVOKED 每条一次；204+clear；不能撤 Tenant 全部成员 |
| Me / CSRF bootstrap | validated Session User；无 Tenant 假设 | 既有 validate+touch 后最小投影；不缓存权限；无 command replay | UserId 和期限/CSRF proof，非 SessionRecord；无效 401，outage fail closed |
| Selectable spaces | validated User 本人的 ACTIVE memberships + ACTIVE Tenants | 受控 query（第 7 节）；分页不提供 membership/grant 全局列表 | TenantId/code/displayName/MembershipId 最小导航候选；无角色/教学许可；无资格空集 |
| Select space | 同上，仅 request navigation candidate | 每请求 fresh membership/tenant；不写 Session.activeTenant、不自动选择首个 Tenant | 非枚举 404；返回候选不等于业务授权 |
| Own password change | ACTIVE 本人 Session + 当前密码 proof + approved screening/new hash handle | 单 A，User/slot/Session 锁内 proof/CAS，new CredentialId，epoch+1；不持久化 password/idempotency fingerprint | CREDENTIAL_REPLACED 同事务；清旧 cookie、要求新密码登录；失败整个 mutation rollback |
| Create global User | 经批准 operator/control action；无 tenant 管理员全局创建权限 | C：User create+USER_CREATED+command ledger；new UserId；无匿名注册 | 安全 UserId；不带默认/生日密码；后续凭据 provisioning 独立受控步骤 |
| User disable / restore | current SystemAdminGrant + step-up + action allowlist | C：sorted User locks，Session guard，target CAS；disable trigger 原子 Session revoke；restore 不复活旧 Session | USER_DISABLED/RESTORED 同 C；safe state；不隐藏跨 Tenant 教学数据读取 |
| Tenant create / disable / restore | current control eligibility + step-up + explicit allowlist | C：Tenant anchor→sorted Users→认证 guard→SystemAdminGrant lock→target CAS/audit/ledger；restore 不恢复 disabled members/grants | TENANT_CREATED/DISABLED/RESTORED；safe state；ARCHIVED 仍遵守 Domain 无恢复命令 |
| Invite / create Pending | 当前 tenant manager；已批准 admission 引用绑定现有 User/Tenant，不允许 global ID probe | T：新成员专用 guard、unique(tenant,user)、PENDING 空 grants、consent/command provenance；需新增 closed create event | 本 Tenant 安全 Membership projection；unknown/foreign/无 admission 同类拒绝 |
| Accept invitation | 同目标 registered User 的 validated Session；不是 admin role | T：绑定 invitation/target/expiry/revision，记录一次 consent；不直接激活，不赋权 | closed consent event 提案；safe PENDING；随后管理员 fresh 审批，不能用旧 inviter 权限 |
| Activate pending | existing 1B-7 MEMBERSHIP_ACTIVATE；same grant 两 permissions + ceiling + consent | T：第 6 节 freshness +审批/ledger+1B-7 guarded mutation；pending-origin grants 全部进入历史，新 RoleGrantIds | MEMBERSHIP_ACTIVATED，闭集 prior/new snapshots；最小 status/version，非 grant 全历史 |
| Disable / admin leave | MEMBERSHIP_DISABLE / MEMBERSHIP_LEAVE_ADMIN，最新 actor/state | T：same guard、last-admin 两计数、target CAS、ledger；disable 不 revoke global Session | MEMBERSHIP_DISABLED/LEFT；revoke/expired 不复活；自主 leave 关闭 |
| Reactivate / rejoin | 两 permissions + ceiling；显式 preserve IDs 或 replace specs | T：绑定当前 target/history/revision 的新 approval；preserve 逐条当前有效，rejoin 只新 grant；同 guard/audit | MEM_REACTIVATED/REJOINED；客户端 mode 外不可提供 approval proof |
| Grant / revoke / replace | ROLE_GRANT/REVOKE/REPLACE；pre-state role:assign、single grant scope、ceiling | T：最多两个 targets 原子交接、完整 post-state/last-admin/CAS；每条 new grant server ID/time；ledger 同事务 | 既有 ROLE_* closed events；无自我管理提权，无 CLASS/COURSE loader 则拒绝 |
| First platform admin / first Tenant admin | 独立 P，不因 SYSTEM_ADMIN 自动有 tenant 权利 | 第 9 节 approved ticket+稳定 serialization+one-time ledger；精确新 capability 审批前不实现 | 多个已批准 closed audit +provenance；不成为匿名 HTTP endpoint |
| No-admin recovery / password reset | 专用审批/identity evidence；两个流程不互相授予能力 | 第 9/12 节；批准渠道/具体 capability 前 BLOCKED，不以普通 save/replacePassword 绕过 | ACCOUNT_RECOVERY reason 不证明审批；安全结果，统一 public error |

普通 Membership 阅读沿用 MEMBERSHIP_READ；query 本身按 Tenant/授权 scope 限定，不先加载全局数据再过滤。后台任务/Server Action 必须进入同一用例；未定义 ServiceActor capability 一律拒绝，不假扮 SYSTEM。

## 6. Same-client composition、Session freshness 与锁序提案（A8-03）

### 6.1 已有能力不能混淆

普通 User/Tenant/Credential/Session repository 方法自行 connect/BEGIN/COMMIT；外层调用它们再 AuditPort.append 不是一个原子事务。1B-7 `PostgresAuthorizationMutations.execute` 已证明 state/history/CAS/audit 同 client，但不读取本次 Session。不得持一个 auth client 的 lock，再在 tenant client 写入后宣称跨池 ACID。

保留旧公开 Ports 与行为。后续最小抽取/复用 repository-private client-bound collaborators，由新职责专一的 command adapter 组合；保留 privileged mapper terminal 边界与 DH07 allowlist，不 export raw client 到 Application，不让 adapter接受任意 SQL/任意 callback。1B-7 旧 primitive 仍是可信底层机制；所有受保护 1B-8 入口须用带认证复核的组合版本，无旁路。

### 6.2 提议的窄 Session-at-write capability

设计签名为 `zhiban_identity.identity_session_guard(p_digest text, p_expected_user_id uuid)`；**窄能力方向、签名/投影/锁序已获设计批准；完整 schema/ACL SQL 尚须精确审阅，未实现**。只能 `zhiban_runtime`、`zhiban_control_runtime` 调用；auth command 自己在同 client 复用等价内部检查。参数由 security boundary 从 raw cookie 临时计算，digest 不进入普通 Application DTO、command ledger、audit/log。DB runtime 本就属于可信基础设施，不把 DB 登录当浏览器认证。

函数 owner 为现有 NOLOGIN `zhiban_identity_owner`，SECURITY DEFINER、VOLATILE、PARALLEL UNSAFE、固定 `pg_catalog,zhiban_identity,pg_temp`、row_security=on，全部对象 schema-qualified，PUBLIC EXECUTE revoked；无 dynamic SQL、业务 DML、touch/revoke、Session/verifier/grants/profile 列表。canonical digest + UUIDv7 全检；缺行/null bindings/任意异常统一拒绝。输出固定最小投影：userId、userRevision、securityEpoch、absoluteExpiresAt、idleExpiresAt；**不返回 digest、SessionId、hash 或完整 row**。

内部先用 digest 找 hint，锁 expected User FOR SHARE，再取既有 `zhiban-session-user:<UserId>` shared transaction advisory barrier，再锁 credential slot FOR SHARE，再锁对应 Session FOR SHARE，最后重新读取并比对 digest/User/ACTIVE/current epoch/User revision/revoked/strict期限。hint 不授权，缺失及变更拒绝；不按猜测 UserId 返回存在性事实。取锁后可信时钟，并在 mutation/audit/ledger 完成、COMMIT 前同 client 再检期限。读取函数成功只证明该线性化点身份有效，不证明 tenant Permission。

仅 tenant/control command 的 security-private collaborator消费该投影；Application 只有不含材料的 handle/结果。不能公开“校验任意 digest”API，也不能把存在 guard 当作允许直接查 sessions。

### 6.3 Tenant 管理命令顺序

```text
tenantTransaction + LOCAL TenantContext
→ existing authorization_state(GUARD_MEMBERSHIP): Tenant UPDATE → sorted Users SHARE
→ identity_session_guard: actor identity binding → shared User barrier → slot SHARE → Session SHARE
→ sorted Membership parent UPDATE → fresh grants/association/roster
→ scoped command/consent/approval locks + stale checks
→ fresh single-grant authorization / recent proof / ceiling / complete post-state last-admin
→ existing Membership CAS/history + closed audit + provenance/idempotency
→ final time / Session / authorization validity check → checked COMMIT
```

guard 不能锁后再申请另一 Tenant 或新未排序 User；未来 create-member guard 须把已批准 target User 纳入 Tenant 后的 sorted Users 集合，不能借 0007 放开 null/不存在 targets。它是另一个待精确审批的有限 admission capability，不修改 0007 签名/modes。最多两个实际 mutation targets与256 guard users保持；超界整笔拒绝。

revoke 获得 Session row 写锁后，本命令才拿 guard 将看到 revoked 并拒绝；本命令先获 SHARE 并通过，则在其提交前 revoke 的 row mutation 等待，命令线性化在 revoke 之前。logout-all exclusive User barrier 与 shared guard互斥。Credential slot SHARE 阻止 epoch writer；User SHARE 阻止 disable/restore writer。验证后无 lock 的普通再次 SELECT 不能替代这个机制。时间不可被锁住，提交前取 fresh Clock 检查，不能承诺物理提交后的永恒身份有效。

### 6.4 Auth / control command 顺序与禁止升级死锁

Auth own-password command：KDF/旧密码 proof/新 screening/hash 在锁外；User SHARE → shared User barrier → slot **直接 FOR UPDATE** →当前 Session FOR UPDATE →fresh proof/version/live →Credential replace/audit/ledger →final checks→commit。不能先 slot SHARE 再升级；不能在持 slot UPDATE 时另调用 revokeAllForUser 申请 exclusive barrier。既有 Session INSERT trigger 在 barrier 前取 slot SHARE，倒置为 exclusive barrier→slot UPDATE 会形成等待环。换密码原子增加 epoch 已立即逻辑失效所有旧 Session；commit 后 clear cookie，再经新密码正常 login，不能在另一事务发行失败时回滚已成功密码变更。

logout-all：先 User SHARE，再 **exclusive** User barrier，再 slot SHARE 与目标 Session locks，当前 authenticated Session在这个 barrier 内复核，然后撤全部。不先锁一个 Session 再要 exclusive barrier；保留既有 revoke-all 身份和 audit 语义，旧 Port standalone 方法仍原行为。

Control Tenant mutation：Tenant UPDATE → sorted actor/target Users（必要模式在首次就取）→shared actor barrier→slot/Session SHARE→current SystemAdminGrant SHARE→fresh allowlist/step-up→Tenant CAS/audit/ledger。Control User mutation不再申请 Tenant：sorted Users，target 直接 FOR UPDATE、actor必要 SHARE（actor=target 一次 UPDATE）→actor Session guard→SystemAdminGrant SHARE→User CAS；0006 trigger 需要 exclusive target barrier。**自我 disable/restore 默认关闭**，避免 actor shared barrier升级与安全归属问题；多 User操作先收集完整集合按序，不能锁后增加 User。紧急 disable仍可使某 Tenant 暂无 operational admin，不能为了 last-admin 阻止安全停用。

所有新控制 grant writer也先相应 User锁再 grant锁，不能 grant→User。现有冻结 User/Tenant/Session/Credential低层协议不改；新组合路径须与旧 writer逐一 real PG16 验证。锁冲突/40001/40P01 sanitized、fail closed、不自动 retry。依据 [PG16 row/advisory lock 冲突规则](https://www.postgresql.org/docs/16/explicit-locking.html)；上述是本项目待验证协议，不是引用即已证明安全。

提交前检查须区分其他 writer 的变更与本命令批准的 post-state：own password change 必须验证锁内批准的旧 credential/proof，并验证新 epoch 正好 +1、旧 Session 已失效；logout/all 验证授权 pre-state 后自己的 terminal revoke。不能在这些命令完成自己的合法失效后，再套要求“旧 Session 仍匹配新 epoch/未 revoked”的通用 final guard，导致合法命令永远 rollback。锁和 CAS 防其他 writer，最终校验的是本命令明确预期的 post-state；tenant mutation 不更改认证状态，仍须 final live check。

## 7. 本人空间发现与最小 ACL 提案（A8-03）

auth/runtime/control 不增加 Membership/Tenant/Session secret直接表权限。不把现有 scoped findByUser变成可省 Tenant 的 global repository。

推荐完整空间发现能力 `identity_session_spaces(p_digest text,p_after_membership_id uuid,p_limit integer)`，仅 auth runtime EXECUTE、固定小结果，limit 1..50、stable cursor、最多1000本人候选再拒绝/要求受控处理，不无限加载后过滤。根据当前已验证 Session解析 User，返回仅本人 ACTIVE Membership 与 ACTIVE Tenant 的 id/code/displayName/memberId，不含其他用户、grants、permission、Credential/Session材料。导航投影非授权快照，后续请求再次检查当前状态。

因为 FORCE RLS且 owner现仅当前 Tenant SELECT，完整跨空间发现确需额外 scoped owner SELECT policy。提案只在这个 definer函数内设置专用 LOCAL discovery User上下文（来源为有效 Session，不接受 caller UserId），完成后恢复 prior值；新 policy仅 Membership owner SELECT `user_id = validated discovery context`，不涉及 RoleGrant、DML 或新增 runtime direct SELECT。DB caller可伪造 GUC不是认证：auth 对 Membership 的直接读取仍 denied；tenant 对 Session/Tenant 的直接读取仍 denied，原有 tenant-scoped Membership SELECT 保持而非误称禁止。每个definer必须自己验证/覆盖上下文且SQL显式限定subject。既有 authorization_state 所有显式Tenant/actor/target验证保持。

完整本人空间发现及上述最小 owner SELECT 例外方向已纳入 A8-03 设计批准；具体 policy/function SQL 仍须独立精确审阅，并执行恶意 GUC/临时对象/错误回滚/池复用测试。若精确审阅不能安全满足此边界，STOP 请求设计变更，不静默改为候选查验或扩大 SELECT。这里没有给 RLS设置 trusted-client 例外。

## 8. Approval provenance / 1B1-F05 / 幂等（A8-04）

### 8.1 已批准的审批模型

首版仅邀请已注册 global User，默认无 grant 的 PENDING Membership。待批准 admission依据来自经核验的本人加入请求或受控导入/运营登记，必须 target绑定；tenant管理员不能搜索全局User、以密码身份替别人 consent。邀请提交与本人 consent分离，accept仅确认本人，不直接授权；管理员在 **consent 后** 重新验证当前权限，原子激活并逐条批准权限。邀请发起人已失权不能靠旧邀请自动授予。

1B1-F05：允许保留历史 pending-origin grant，但 activate/rejoin/replace仅使用本次新批准 RoleGrantIds，旧 pending grant转 revoked/history而不是原样生效。disabled preserve仅显式选中的当前有效 grants，仍逐条ceiling/current approval；future/revoked/expired一律不能复活。pending审批与 global身份/password recovery是不同能力。

server-produced immutable approval事实至少绑定：approvalId、TenantId、target UserId/MembershipId、action/mode、target expected revision/authVersion、逐条role/scope/validUntil或preserve IDs、catalog/action/delegation digest、approver真实User/Membership及其versions、consent/admission reference、issuedAt/expiresAt、commandId。只允许闭集 shape，invalid/foreign/expired/replayed/stale拒绝。时间初版proposal最长24h，但 sensitive approval执行仍在锁内 fresh re-authorize；纸面审批时间不能延长grant authority。行政高权限新grant仍不能self-approved。HTTP只能提交proposal或opaque locator，不能提交“已批准”的actor/boolean/事实。

### 8.2 持久化补充要求，尚未批准 schema

完整用例不可能仅靠现有 tables证明 durable consent、批准来源与跨进程重复command。建议独立下一migration设计包含：tenant-owned admission/consent/approval记录，按tenant scope的 command outcome/provenance ledger；control-owned operator approvals/one-time bootstrap/command ledger；auth-owned bounded admission预算及安全命令 outcome。每类职责分开，不能做任意JSON事件/万能 command dispatcher。

同 client锁approval/command，再执行业务CAS/audit，记录safe outcome和audit event关联并消费approval，一起commit。必须有唯一(ownerScope,actor,action,key)，目标与内容binding、时限/状态闭集、UUIDv7/FK、正int8 revision、不可逆消费、only-needed operationsACL。tenant tables启用FORCE RLS，composite tenantFK，runtime仅scoped需要权限；auth/control ledger不通过 tenant runtime读取。拒绝删audit/历史或把raw request保存为幂等记录。

幂等 key是受限格式client nonce（不是authentication），server生成不同requestId；保存对**安全白名单字段**canonical fingerprint和safe outcome。password/raw token/token digest/CSRF proof、它们的散列或KDF结果都不得进ledger；password命令不提供body-fingerprint replay，成功后旧Session失效，lost-response须新认证后核验安全状态，不能replay secret。登录/rotation不缓存/重放bearer。

同key同safe intent：先验证当前actor资格和预期version，再允许在ledger当前outcome revision仍匹配时无写返回；版本变化仍拒绝，不能借幂等结果 bypass stale-before-no-op或恢复旧授权。同key不同target/content冲突；并发同key单次mutation/audit；rollback无committed outcome；过期ledger不允许重放旧审批，key retention/expiry由批准policy指定。请求处理不自动重试旧授权。

因此原 mutation 的旧 expectedRevision 原样重发仍是 stale，不承诺旧正文自动成功。可重取当前状态后以同 key/同安全意图、当前 expectedRevision 查询已完成 outcome；concurrency preconditions 单独保存/校验，不与业务意图 fingerprint 混为一谈。不重新消费已消费审批、生成新的 grant 或增加版本/audit；后续他人 mutation 导致 outcome revision 不再 current 时拒绝旧 key。该确认协议不是放宽 repository TRUE NO-OP 规则。

### 8.3 Audit闭集补充

既有USER/TENANT/ROLE/MEMBERSHIP/CREDENTIAL/SESSION事件完全复用其已冻结shape，相关 mutation与audit同事务。Member creation/consent目前无合法closed event；不能把PENDING创建伪装MEMBERSHIP_ACTIVATED（该事件需要版本提升及实际activation）。提案新增有限 `MEMBERSHIP_PENDING_CREATED`、`MEMBERSHIP_CONSENT_RECORDED` 和有限 `IDENTITY_AUTHORIZATION_DENIED` 事件设计，需逐字段、ownership/version0语义、SQLCHECK/RLS/actor/request验证独立批准；不在本轮修改union或audit_payload_valid。

批准来源通过专用provenance表与实际audit event ID关联，现有payload不夹带approvalId。decision拒绝audit仅安全actor/known本scope target或无resource、closed action/reason/requestId；不保存raw identifier/IP/body/SQLerror/grant历史。成功命令event必须mandatory rollback-on-audit-failure；失败尝试无成功业务mutation，独立audit失败返回sanitized unavailable，不伪造成功审计。系统容量/预算拒绝可用受控aggregate telemetry，不无限逐请求写audit形成DoS；此策略必须在新closed audit审批中确认。

## 9. Bootstrap / control-plane / recovery责任（A8-05）

### 9.1 First platform admin

operator-only、无public route、默认关闭。具名运营负责人+独立批准人记录审批来源、环境、目标UserId、有限操作、expiry和nonce；凭DB连接不等于业务SystemAdmin，`SERVICE` audit actor也不证明审批。不得在source/env保存默认密码；password通过关闭echo且不进argv/history/log的短生命周期输入或本人受控设置流程。corpus/admission缺失停止。

推荐一时一次稳定bootstrap anchor和ledger：在control client中同事务创建/核验User、首个SystemAdminGrant、对应closed audit和消费approved bootstrapticket。检查“从未bootstrap”而非“现在admin count=0”（所有grant过期不允许重开匿名bootstrap）。并发 exactly-one completion、same审批可恢复安全outcome、不新发grant。User+globalgrant+audit可C原子；Credential provisioning不能在另一auth事务假装同C原子。

因此拆显式受控步骤：C完成identity/grant（无Credential尚不能login）→A消费绑定该User且slot从未创建的一次provision approval、hash/slot/audit提交→本人真实login验证；部分完成可安全resume、拒绝错User/换审批覆盖、不得删除slot/history补偿。auth审批数据路径/consumption必须先独立schema/ACL批准。首次设置密码能力不得退化成任何管理员的通用reset权限。

### 9.2 First Tenant / first Tenant admin

Tenant create+audit+controlledger为C；首个Membership/admin建立是**单独显式operator onboarding capability**，不是SYSTEM_ADMIN自动映射TENANT_ADMIN，也不是给control直接Membership写权限。审批绑定Tenant/User/consent/NEWadmin RoleGrantId/validity/catalog/nonce。Tenant anchor内检查初始/预期Tenant revision、现有完整roster、允许的一次onboardingstate，再同事务create pending→activate新admin、authVersion/CAS、closed mutation audit、approval consumption。no-admin已有Tenant不得伪装fresh tenant重用onboarding。

需要执行跨控制/tenant审批数据的精确definer operation及owner DML RLS政策，必须在A8-05给出逐对象许可并先批准；本稿不授予任意owner INSERT/UPDATE政策、不实施generic bootstrap SQL。capability只做明确onboarding，不能任意set role/scope、跨Tenant、读取学习/credential/session材料。没有实际tenant管理者时不能调用要求ACTIVE actor的0007并使用虚假member通过。

### 9.3 Recovery与全局状态

User/Tenant disable/restore仅经current SystemAdminGrant+approvedcontrol action；globalUser停用可能影响多个Tenant admin资格，必须运营告警/受控transfer，不阻止urgentdisable。Tenant恢复不隐式恢复members/grants/session。自然grant expiry后的零admin同样需要明确负责者，不谎称last-admin保证永久存在。

no-admin recovery：单独purpose/target/期限/双人审批+identity核验与受控工具；具体有限授权与owner policy需要后续精确批准，不能用普通role:assign或SYSTEM_ADMIN超级fallback。原冻结last-admin/self/ceiling规则保持，recovery属于批准的例外用例，不改Domain普通transition。负责人姓名、核验材料保管/保留、演练方式未指定则 BLOCKED_BY_OPERATOR_RECOVERY_DECISION，禁止productioncutover。

公共password reset/recovery 已获用户明确决定关闭；1B-8E标 PUBLIC_RECOVERY_DISABLED_BY_APPROVED_MVP，而非一个必须实现邮件渠道才能完成首版的阻塞。未来重新开放需独立渠道决策。仅把email provider Fake装进生产或操作者说“approved”不成立。上线前仍需批准并演练人工恢复；本文不选服务商、不发邮件、不实现resettoken。近期密码re-auth（第4节）不是通过外部渠道重置，不因8E关闭而跳过管理员step-up。

## 10. HTTP / cookie / CSRF contracts（A8-01/02）

首版仅same-originbrowser JSON API。路径提案：`/api/zhiban/identity/login`, `logout`, `logout-all`, `me`, `csrf`, `spaces`, `password`；scoped admin路径含固定Tenant候选和Membership定位。控制面HTTP先关闭，以approved operator工具实现；不混入OpenMAIC原生route。具体DTO是whitelist，不spread Domain/Loaded、内部receipt或driverrow。

unsafe请求一律POST/限定命令，无GET mutation。严格JSON content-type、no simple form/text/plain、不接收任意redirect/return URL；login 8KiB、password 16KiB、identity管理32KiB body上限；header 8KiB、batch最多2/grants最多16，语法与深度/未知字段检查，超界在KDF/DB前拒绝。这些初始限值已纳入A8-01设计批准，不能改Credential已有password bounds。

生产 cookie完全复用 `sessionCookiePolicy(true)`：`__Host-zhiban_session`, HttpOnly, Secure, SameSite=Lax, Path=/, 无Domain；生产不能因untrusted forwarded-proto切devcookie。只有cookieadapter调用`bearerForCookie`，Set-Cookie是raw token唯一允许的HTTP输出；JSON/URL/localStorage/Authorization fallback无token。clear同name/path/secure等属性，Max-Age=0/Expires past。post-commit才能set新cookie，不日志header。登录freshsession代替旧cookie，拒绝客户端SessionId fixation；旧cookie有效时的明确换账号login需先安全revoke旧session，不静默在JSON回显原token。

已认证unsafe：exact configured Origin AND既有 `SessionCsrfPolicy` proof（由当前validatedSessionId导出）；拒绝missing/null/other scheme/host/port/subdomain，不信Host/X-Forwarded-Host决定trustedorigin。GET csrf仅在有效Session后返回proof且no-store，不返回SessionId；proof不授identity/role，rotation后旧proof无效。adapter需新增私有authenticated Session binding读取，不改普通Session返回UserId contract。

未认证login：无Session可绑定，不能调用虚假SessionId的CSRF policy。推荐精确Origin+`application/json`+强制自定义请求header `X-Zhiban-Request: identity-v1`，拒绝所有跨域CORS凭据/预检许可和simple request；missingOrigin不放行。此为明确login-CSRF合同，不声称header是登录凭据。[OWASP custom-header/CORS guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html#employing-custom-request-headers-for-ajaxapi)

实际SessionCsrfPolicy密钥每instance随机，尚无跨实例共享key contract。推荐第一HTTP验收限制单serverprocess、固定lifetimepolicy；重启后旧CSRFproof失效，客户端重新取proof。多实例上线必须单独设计server-sidekey管理/统一验证或明确可靠routing，不能按request新建policy、用常量key、跳过CSRF或把publicorigin当key。分布式limiter仍必须统一后端；CI单进程不证明生产集群已接入。

所有response含 `Cache-Control: no-store`；关闭Next/CDN/sharedcache和敏感路由body/response/APM采集，禁止redirect把secret带URL。认证失败归一401，资源absent/foreign/无读取资格统一404，已知自身合法资源的动作拒绝可403，version/key冲突409仅在完成身份/资源可见性检查后；input400/size413不回显body，budget429不透露存在性，系统503不带cause/SQLSTATE/provider code。不得用跨Tenantunique错误泄露其他资源。

login unknown/missing/wrong/disabled均同401body/header；各路径执行既有real/dummyKDF（超budget/语法size拒绝例外）。per-locatorcorruption/provider/admission错误不输出账户特异detail；需要系统503时由统一health/admissiongate在identifier解析前决定，避免仅“存在User”收到特殊故障响应。总体constant-time不作承诺。

## 11. Admission / proxy / operational security（A8-02/04）

推荐复用PG16作为首版共享预算后端（不是在当前schema已存在），auth-only新记录由明确Migration设计审批；atomic fixed-window多维计数、counter上限/expiry/清理/总容量，所有申请在同事务判定，不用各instance Map冒充分布式budget。用户/IP/locator预算key以独立serverHMACkey派生并限制保留；不保存raw password、rawtoken、Cookie、raw identifier/IP或任意body；预算散列只用于限速，不能当identityproof。随机invalididentifier攻击仍受IP/global总预算。

初始阈值、窗口、最大bucket容量与超时必须经Node22 Argon2负载测试及部署批准记录；缺任何配置/后端outage failclosed，不能给某次请求默认unlimited。分别全局KDF admission、可信IP/locator/IP+locator、认证后User敏感命令budget；不持久禁用User、不因budget调用User.disable，不制造永久恶意锁号。超过预算直接拒绝、不队列保存plaintext；KDF cap=2保持生产测试参数一致，never lower costs。限速请求不得开启长DB业务锁。

真实clientIP只由已配置可信reverseproxy覆盖/清除的header与已验证network topology获取；没有可信proxy/直连transport能力则不开publicendpoint。忽略任意外部X-Forwarded-For/Forwarded混合链，不按客户端自报URL/host推断。配置必须记录proxyCIDR/链长度/IPv4IPv6标准化/缺header规则、secret store、cleanup责任与告警。本文不猜测用户部署平台，也不修改全局环境/生产网络。

错误freshclosed分类，schema/corpus/limiter/provider故障不把cause、customcode、body、grant历史带进log。日志仅serverrequestId、finiteaction/reason、已批准安全ID/聚合计数；验证APM自动SQLparams、cookieheader与exception capture关闭/脱敏。DBdump/backup仍需部署访问/加密/保留/restore演练，ephemeralCI不认证生产。

## 12. Migration / role approval gates 与恢复渠道

0001–0007全部byte/checksum保持；本轮不建0008。上述功能需要真正新增结构/窄权限，并非现有contract冲突；必须先补精确schema/ACL设计审批，然后另行BUILD新序号（开始前查inventory，已占用STOP）。不把所有提案塞进一个可接受任意operation/JSON的definer。

| 提案对象 / 批准项 | 最小用途 | 不允许的扩展 |
| --- | --- | --- |
| A8-03 Session guard | tenant/control同client认证freshness，固定secret-free投影；确切definer/EXECUTE例外 | no direct sessions/credentials GRANT，no business DML，no bypassRLS |
| A8-03 own-space discovery | auth-only本人最小跨空间投影；精确ownerSELECTpolicy/LOCALcontext例外 | no global list/别User参数/no grants或teaching读取 |
| A8-04 ledgers / admission budgets | immutableclosedprovenance、same-client幂等、bounded跨实例admission | no arbitrarypayload/rawsecretfingerprint/无限retention，no DDLstartup |
| A8-04 pending/admission helper + closedaudit | 创建尚无Membership的资格核验/consent；逐表RLS/role操作审查 | no改0007mode/no租户全局User探针/no假activationevent |
| A8-05 operator bootstrap/recovery | 已批准有限one-time流程，明确exacthelper与ownerDMLpolicy | noownerpool/noSystemAdmin教学fallback/no通用reset/grant能力 |
| 1B-8E recovery token schema/provider | 仅经channel/evidence/identity核验批准后digest/one-use消费+Credential变更原子 | no生日密码/nofakeproduction/no匿名凭据覆盖/no自动通知partialcommit |

各新函数须fixedsignature/role/owner/path/row_security、closed参数与return、REVOKEPUBLIC含overloads/defaultprivileges、finitebounds、审计/事务/异常/lockorder证明，owner受FORCERLS必须逐policy确认。新grant不能让runtimeowner/super/BYPASSRLS/CREATEROLE/可SETROLE，也不新增秘密SELECT扩权。[PG16 SECURITY DEFINER guidance](https://www.postgresql.org/docs/16/sql-createfunction.html#SQL-CREATEFUNCTION-SECURITY)

1B-8E不随8B/C/D默许启动。获准之后还需独立具体方案：渠道ownership、非枚举请求/通知、token高熵digest-only、一次性expiry/cancel/replay、consume与credentialnewgeneration/epoch/audit同client、outboxsafe通知、并发reset/issuance、humanapprovalstaleness。reset不等于Membership审批，tenantadmin不能设置global密码。未知时API不注册、featuregateclosed，operatorfallback缺责任或演练阻止生产发布。[OWASP reauthentication guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html#reauthentication-after-risk-events)

## 13. 验收与威胁模型（计划，尚未执行）

| 威胁 / 用例缺口 | 实施层 mitigation | 必须执行的测试 |
| --- | --- | --- |
| 登录枚举 / 标识collision | resolver有限规范化、unifiedreject、real/dummyKDF | canonical等价、unknown/wrong/disabled、invalidlocator、故障status/body/header；不snapshotsecret |
| rawsecret/hash/digest泄漏 | server-onlyprivate材料、DTO/audit/ledger/log白名单 | provider/customcause/SQLparams/JSON/HTTPheaders/APMcapture负例；cookie是rawtoken唯一输出 |
| login/sessionCSRF / origin伪造 | loginJSON+exactorigin+customheader；已认证Session-boundproof | missing/null/wrongorigin、跨子域/CORS/simpleform、rotatedproof、policy重建/restart |
| limiter绕过/内存DoS | 可信proxy+共享atomicbudget+cap2+boundedrecords | 多processbudget、invalidrandomlocator、伪XFF、backenddown、permitrelease与cleanup |
| initialSession被当长期写permit | same-clientguard+User/barrier/slot/Session locks | HTTP验证后logout/logout-all/epoch/disable+restore两种先后顺序；旧Session不能提交mutation |
| last-adminTOCTOU/跨Tenant/stitching | existing7guard＋全入口接线，fresh单grant/roster/CAS | 两连接锁barrier，双撤权至多一胜、atomictransfer、wrongcontext/batch/服务入口绕过 |
| pending-origin/approval伪造与replay | target/catalog/version/consent绑定+锁内批准消费 | 1B1-F05、foreign/wrongtarget、失权inviter、future/expired/revoked、rollback后未consume |
| 幂等重放复活权限 | scopedledger、safecontent、freshactor/version、noautretry | samekey双提交仅一次audit、key改target、revoke后旧key/stale-noop拒绝、lostresponse |
| 跨poolpartialcommit被误报成功 | 具体one-client命令；operator provisioning显式分步 | 每个write/audit/ledger/COMMIT故障整体rollback；分步中断安全resume、不重发grant |
| bootstrap/recovery成为后门 | purpose-boundoperatorapproval、one-timeanchor、defaultclosed | 双bootstrap仅一成功、曾bootstrap后zeroadmin不能再引导、wrongenvironment/expiry/self审批 |
| discovery/helper旁路 | 有效Session导出本人、tinyprojection、scopedownerpolicy | PUBLIC/tenant/control/noSession、恶意GUC/tempobject、page/cursor/foreignUser、poolreuse |
| 控制面权限漂移/教学超级读 | 独立allowlist+SystemAdminGrant/currentSession、noRolefallback | User/TenantstateCAS、grantrevocationrace、authrole/owner登录错误、无globalteachingquery |

unit/contract加入 `tests/zhiban/identity/use-cases/**`、protocol-neutralHTTP/securitytests和相应SQLunittests，Fake不得变production默认或弱化CAS/epoch/approval。具体用例 real PG16新增到**现有workflow的两轮**；所有SQL/ACL/concurrency assertions用真实restrictedrole，admin仅seed/catalog/cleanup。锁竞争用independentconnections+acknowledgedbarriers，不用sleep-only、不把mockcallcount当原子性证明。

CI保留完整168/168既有PG16每轮（53 repository/security+35Credential+33Session+47Authorization）并追加各8B/C用例；保留1017既有Identity回归的六组，包含五个repositorysuite，新增测试按actualsuitecounts列出，不硬编码“新的总数”。Node22/Linux/frozeninstall、Argon2真实hash/verify、rootlint0errors/typecheck8GB临时heap、现有通用CI/StoragePG门禁保留。实际测试失败不自动rerun，真实PG16不可用标PENDING_CHECKPOINT，不安装、不用PG18/PGlite替代。

HTTP验收真实request/response/cookie，不只调用policy函数。每个受保护API/ServerAction/worker必须证明不能直接调用低层repository绕过用例。没有新ServerAction/worker时明确不存在入口，不新增仅为测试的公开旁路。全部普通P1/P2在对应BUILD同轮修复；冻结冲突STOP。对外开启/部署、migration应用真实环境另需明确批准。

## 14. 可执行顺序、模型与停机门槛

模型/推理为每项建议设置，不表示文档自动切换当前聊天模型。模型ID遵循届时可用设置；每个任务开头报告所用设置，不能从上一任务默认继承。

| 顺序 / 单元 | 建议模型 / 推理 | 范围与交付 | 进入 / 完成 gate |
| --- | --- | --- | --- |
| 1B-8A设计审阅/决策收口 | GPT-6.1 Sol / High | 已完成：记录2026-10-03人工设计批准，冻结A8-01–05已描述方向 | 精确schema/ACL、部署值与人工恢复审批仍独立；不算可BUILD |
| 8A文档checkpoint | GPT-6.1 Sol / Low | exactDOCscope stage/commit/push，独立remoteHEAD/message/parent | 另行授权；本轮不执行 |
| 8B前置schema/ACL精确设计补充 | GPT-6.1 Sol / High | 只设计nextmigration的Sessionguard/所需ledger/provision能力与精确测试例外 | 单独批准；不借Implementation授权扩大objects |
| 1B-8B全局认证/use-case BUILD | GPT-6.1 Sol / High | IDs/manifest/resolver/login/logout/all/me/password、approvedoperatorbootstrap、sharedadmission契约 | 保留Credential/Session冻结；unit/static/security自审P0/P1=0；NOcommit/push |
| 8Bcheckpoint→独立remoteverify→新CI | GPT-6.1 Sol / Low（checkpoint）；High（证据签收） | scope精确candidate；真实PG16两轮、fullregression/tooling | 每步单独授权；不把greenjob代替logs；失败不自动rerun |
| 1B-8C成员用例BUILD及同轮review | GPT-6.1 Sol / High | 已批准admission/consent/provenance/幂等、全入口7guard+Sessionfreshness、globalcontrol状态coordination | 真实用例并发与audit/approvalrollback、1B1-F05关闭；未知bootstrap/recovery保持closed |
| 8Ccheckpoint / CI签收 | GPT-6.1 Sol / Low / High | 与8B同candidate/evidence规则；保留所有旧suite | 通过后才进入HTTP |
| 1B-8D HTTP BUILD / security review | GPT-6.1 Sol / High | 薄handlers、真实cookie/CSRF/Origin/DTO/limiter/proxy/cache | 无upstreamroute改动；真实HTTP负例；部署缺配置failclosed |
| 8Dcheckpoint / CI签收 | GPT-6.1 Sol / Low / High | 既有workflow追加而不删减安全回归 | 同样独立授权/核验；不开production |
| 1B-8E条件恢复设计/BUILD | GPT-6.1 Sol / High | 首版公共恢复关闭；未来重新开放须批准channel/evidence/provider；人工恢复单独批准 | PUBLIC_RECOVERY_DISABLED_BY_APPROVED_MVP；operator细节未批准则保持closed，不能作为空实现complete |
| 1B-8 closeout / checkpoint | GPT-6.1 Sol / Medium / Low | reconciliation、已完成scope/closedfeatures、实际evidence、恢复与部署责任 | P0/P1=0、精确deferred；不会自动解锁Bridge/上线 |

8B/C设计补充可以复用本文件审批附录，不创建第二套文档体系；如具体SQL不可在本批准范围安全表达，停在design而不是悄悄做通用definer。1B-8实现顺序不等于一次授权全部B–E。

## 15. 审批清单、Frozen / Deferred 与最终状态

| 项 | 本轮状态 | 已批准范围 / 后续独立 Gate |
| --- | --- | --- |
| A8-01 MVP/HTTP契约 | HUMAN_APPROVED_DESIGN_CLOSED | UserId-first、公共recovery关闭、registered-userinvite→consent→freshapproval、无publicsignup/selfleave/controlHTTP、JSON/CSRF/body限值 |
| A8-02 ID/config/admission/step-up | HUMAN_APPROVED_DESIGN / CONFIG_VALUES_PENDING | uuid v7 provider方向、生产catalog准备、逐命令recentpasswordproof、PGsharedbudget、单processCSRF限制已批准；provider精确版本实施前核验，deployment阈值/代理/责任另行配置批准 |
| A8-03 同事务认证/发现能力 | HUMAN_APPROVED_DESIGN_DIRECTION / EXACT_SCHEMA_ACL_REVIEW_PENDING | 窄Sessionguard签名/投影/锁序、本人spacequery与最小ownerSELECT例外方向已批准；完整SQL/对象许可须精确审阅；无directsecretsGRANT |
| A8-04 durableapproval/consent/idempotency/audit | HUMAN_APPROVED_DESIGN_DIRECTION / EXACT_SCHEMA_REVIEW_PENDING | provenance/consent/幂等/有限新closedaudit及same-client消费要求已批准；专用tables逐字段/约束/ACL、helper/event shape、retention/expiry需精确设计批准 |
| A8-05 operatorbootstrap/recovery | HUMAN_APPROVED_BOOTSTRAP_DESIGN_DIRECTION / OPERATOR_RECOVERY_APPROVAL_PENDING | firstadmin/onboarding有限one-time方向已批准；exacthelper/ownerDML须精确审阅，具名责任/独立批准/演练尚未配置；no-admin与password人工恢复仍分别批准 |

FROZEN_EXISTING / PRESERVED：GLOBALownership、opaque/digest/privatecrypto、Sessionepoch/Userrevision/terminalexpiry、单grantauthorization/closedscope、approvedcatalog/ceiling、lastadminguard、CAS/BigInt/stale-before-no-op/noautoretry、Domain/mapper/role边界、0001–0007不可改、OpenMAIC资源机制非Zhibanauth。

FROZEN_IN_1B8A / HUMAN_APPROVED：上列A8已描述设计范围、逐用例actor/facts/versions/atomicity/audit/DTO、Session-at-writefreshness、approvalprovenance/F05、durable幂等、最小HTTP与deploymentfailclosed、明确BUILD/CI/checkpoint顺序。设计冻结不等于批准未描述的精确数据库对象或授权实施。

DEFERRED_TO_1B8_IMPLEMENTATION：已获准8A具体usecases/配置/安全机制及真实PG16/HTTP验收；批准前不开始。PUBLIC_RECOVERY_DISABLED_BY_APPROVED_MVP：首版不启用公共recovery渠道/resetproof/通知；未来独立重新设计/批准，不假装已实现。DEFERRED_TO_OPERATOR_RECOVERY_APPROVAL：operatorfallback的具体能力、责任、身份核验与演练，上线必备但本轮不实现。DEFERRED_TO_RESOURCE_PHASES：Class/Course/Enrollment/Assignment loaders/permissions；DEFERRED_TO_DEPLOYMENT：真实配置/secret/proxy/limiter/corpus/backup/cutover；OpenMAIC Bridge依0B/ADR-012独立gate。

OUT_OF_SCOPE：UI/Portal、MFA、OAuth/OIDC、JWT、V1数据/真实凭据迁移、Course/Class完整Domain、OpenMAIC底座route/schema修改、productiondeployment。不把1.1.2原生ownercookie/dev-auth/access-code升级为Zhiban身份。

本轮未发现冻结ADR真实相互矛盾；缺Session-at-writeguard/审批ledger/发现privilege是已延期的composition设计缺口，不伪称既有productionbug，也不自行选一个冲突契约。发现需要改冻结Domain/生命周期/role模型或改旧migration才能继续时必须STOP。

PHASE_1B8A: COMPLETE_DESIGN_ONLY

EXISTING_FROZEN_CONTRACTS: PRESERVED

IDENTITY_COMPOSITION_DESIGN: FROZEN

NEW_COMPOSITION_CONTRACT: FROZEN_AT_DESIGN_SCOPE

HUMAN_DESIGN_APPROVAL: 2026-10-03

FROZEN_CONTRACT_CONFLICT: NO_OBSERVED

SCHEMA_ACL_SUPPLEMENT: REQUIRED_PRECISE_DESIGN_REVIEW_BEFORE_BUILD

PRODUCTION_IMPLEMENTED: NO

TESTS_OR_CI_EXECUTED: NO_DOC_ONLY

COMMIT: NO

PUSH: NO

READY_FOR_1B8A_REVIEW: COMPLETE_HUMAN_APPROVED

READY_FOR_1B8A_DESIGN_CHECKPOINT: YES

READY_FOR_1B8B: NO_PENDING_CHECKPOINT_SCHEMA_ACL_REVIEW_AND_SEPARATE_BUILD_AUTHORIZATION
