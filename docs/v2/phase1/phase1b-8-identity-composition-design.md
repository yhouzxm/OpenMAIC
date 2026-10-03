# Phase 1B-8A Identity Application / API / Security Composition Design

STATUS: HUMAN_APPROVED / DESIGN_FROZEN / IMPLEMENTATION_NOT_AUTHORIZED

Date: 2026-10-03. Branch: `refactor/zhiban-v2`. Design base HEAD: `bf3f9139f28a1f87edc7e15aa3ab8d97452aaadd` (`docs(zhiban-v2): close out authorization layer`). Preflight worktree: CLEAN.

2026-10-03 用户明确批准：“批准1B-8A 设计”。本批准冻结本文已描述的 A8-01–05 设计选择与推荐方向，包括 UserId-first、注册用户邀请/consent/fresh approval、Session-at-write 与本人空间发现边界、有限 bootstrap 和闭集 provenance/幂等要求。本文中“提案/推荐”是方案形成时的称谓，审批状态以第 15 节为准；不再表示这些已描述方向尚待产品选择。

批准不扩展为实施授权。2026-10-03 用户进一步明确“批准附录 B 的 B8-S01–S06”，并要求审阅：附录 B 的精确 8B schema/ACL 契约现已人工批准并冻结；未列入附录 B 的 8C/恢复能力、部署阈值/代理配置/具名运营责任仍需独立审批。本文不实现 Application use case、HTTP、配置、数据库对象、测试或 workflow，不 commit/push/dispatch。下一步为本补充文档 checkpoint、独立远端核验，之后另行授权 8B BUILD。

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

2026-10-03 已完成 8A 文档 checkpoint，commit `01cf79b2dd337918cbff29d1e2404e88777f6d36`，parent `bf3f9139f28a1f87edc7e15aa3ab8d97452aaadd`，message `docs(zhiban-v2): freeze identity composition design`；GitHub API 独立核验三者一致。补充设计基线同该 checkpoint，开始设计时 worktree CLEAN。用户已明确批准附录 B 的 B8-S01–S06；本次审阅/批准收口开始时 worktree 仅包含本文件补充。以下是获准精确设计，不是 BUILD 授权；第 2–14 节方向不重开，旧段落的待精确审批措辞对 8B 以附录 B 为准，对 8C/恢复仍有效。

| 项 | 本轮状态 | 已批准范围 / 后续独立 Gate |
| --- | --- | --- |
| A8-01 MVP/HTTP契约 | HUMAN_APPROVED_DESIGN_CLOSED | UserId-first、公共recovery关闭、registered-userinvite→consent→freshapproval、无publicsignup/selfleave/controlHTTP、JSON/CSRF/body限值 |
| A8-02 ID/config/admission/step-up | HUMAN_APPROVED_DESIGN / CONFIG_VALUES_PENDING | uuid v7 provider方向、生产catalog准备、逐命令recentpasswordproof、PGsharedbudget、单processCSRF限制已批准；provider精确版本实施前核验，deployment阈值/代理/责任另行配置批准 |
| A8-03 同事务认证/发现能力 | HUMAN_APPROVED_8B_EXACT_DESIGN / 8C_STEP_UP_SUPPLEMENT_PENDING | 附录 B 的窄Sessionguard/anchor/discovery签名、投影、锁序及最小ownerSELECT例外已批准；无directsecretsGRANT；tenant/control写入step-up精确能力留8C |
| A8-04 durableapproval/consent/idempotency/audit | HUMAN_APPROVED_8B_EXACT_DESIGN / 8C_SCHEMA_REVIEW_PENDING | 附录 B 的global预算、bootstrap/provision绑定与audit ID关联已批准；tenant consent/approval/command ledger、pending helper及新closed audit仍须8C精确批准 |
| A8-05 operatorbootstrap/recovery | HUMAN_APPROVED_PLATFORM_BOOTSTRAP_EXACT_DESIGN / OPERATOR_RECOVERY_APPROVAL_PENDING | 附录 B 的平台引导/首次password精确设计已批准；firstTenantadmin ownerDML留8C；具名责任/独立批准/演练未配置，no-admin/password人工恢复仍分别批准 |

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

SCHEMA_ACL_SUPPLEMENT: APPENDIX_B_S01_S06_HUMAN_APPROVED_FROZEN

PRODUCTION_IMPLEMENTED: NO

TESTS_OR_CI_EXECUTED: NO_DOC_ONLY

COMMIT: NO

PUSH: NO

READY_FOR_1B8A_REVIEW: COMPLETE_HUMAN_APPROVED

READY_FOR_1B8A_DESIGN_CHECKPOINT: COMPLETE_REMOTE_VERIFIED

READY_FOR_1B8B: NO_PENDING_SUPPLEMENT_CHECKPOINT_REMOTE_VERIFICATION_AND_SEPARATE_BUILD_AUTHORIZATION

## 附录 B. 1B-8B 精确 schema / ACL 补充（人工批准，冻结，未实现）

Approval date: 2026-10-03。人类授权：“批准附录 B 的 B8-S01–S06”；随后要求审阅并批准。已完成本附录的对象数量/精确权限/锁序/消费与审计关联/跨池边界一致性审阅；批准仅覆盖下列设计及测试要求。没有批准执行生产 bootstrap、部署配置、8C/8D/8E 或实际 migration 应用，也没有开始 BUILD。

### B.1 单元边界、实际审计与迁移 inventory

本附录重新读取 0001–0007、bootstrap-roles.pg16.sql、migrate.ts、transactions.ts、repository-support.ts、User/SystemAdminGrant/Credential/Session repositories、session-records、Audit Port、ApprovedIdentityCatalog、migration/ACL/authorization static 与 PG16 tests、PG16 harness 和 workflow。事实：auth 可 SELECT users，但没有任何 users UPDATE；audit runtime 可 INSERT 固定列并有 sequence USAGE，却没有 audit SELECT；0007 的 owner Membership SELECT policy 仅 current Tenant；现有 PG16 catalog test **只允许一个 definer**，不能增加函数后原样声称旧断言仍适用。

范围只覆盖 8B：global authentication/use-case composition、首个平台管理员及其首次 Credential provisioning、共享 admission、为未来 tenant/control 写入准备的 Session guard、本人空间查询。**不提前实现** 8C 的 consent/tenant approval/command ledger、pending helper、first Tenant admin owner DML、新 Membership/decision audit events、control User/Tenant 状态管理用例；它们仍须独立 8C 精确补充。人工 password/no-admin recovery 保持单独审批且默认关闭。平台 bootstrap 不替代 Tenant onboarding。

获准设计的唯一新 migration：`0008_identity_authentication_composition.sql`。BUILD 开始重新查 inventory，0008 已占用则 STOP。旧 0001–0007 **byte/checksum 不变**；不修改 bootstrap role 属性/graph，不新增 role、extension、schema、startup DDL 或第二套 runner/workflow。空库 0001→0008，与已应用 0007 只追加 0008 的最终定义一致；runner 同事务写 ledger，second-run NO-OP/checksum drift/失败 rollback/advisory serialization 继续适用。本轮不创建该 SQL 文件。

| 新对象集合（均在 zhiban_identity） | 数量 | 精确职责 |
| --- | --- | --- |
| admission_policies / admission_gate / admission_buckets | 3 tables | 固定生产 policy、永久容量锚、短生命周期 HMAC 预算计数 |
| identity_platform_bootstrap / identity_credential_provisions | 2 tables | 永久 one-time outcome、仅首次 password 的批准消费记录 |
| identity_auth_user_anchor / identity_session_guard / identity_session_spaces / identity_platform_bootstrap_lock | 4 definer functions | 只锁定/读固定安全投影，无业务 DML；bootstrap helper只锁精确一个表 |
| identity_admission_reserve / identity_admission_prune | 2 definer functions | 仅 budget/gate 有限 DML，不触及 User/Session/Credential |
| identity_bootstrap_guard / identity_provision_guard / identity_admission_policy_immutable | 3 invoker trigger functions | 生命周期/不可变性/配置不可变约束，不是 runtime-callable API |
| identity_bootstrap_consistency / identity_provision_consistency | 2 definer constraint-trigger functions | deferred 审计/批准/结果关联校验，只读且无 runtime EXECUTE |
| memberships_identity_discovery_owner_read / audit_identity_provenance_owner_read | 2 SELECT policies | owner 的精确读取例外；无 owner INSERT/UPDATE tenant policy |
| memberships_identity_discovery_idx / admission_buckets_expiry_idx | 2 indexes | 本人 bounded discovery、预算 bounded cleanup |

因此 0008 精确新增 **8 个 definer（6 个入口 + 2 个不可直接调用的 constraint trigger）**；加上原 authorization_state，总数 9。不新增 generic audit helper/任意 SQL dispatcher。实现若需额外 definer、table、policy 或业务 DML能力，先回到 DESIGN，不临时扩大 allowlist。

### B.2 统一列/输入/错误契约

所有 uuid ID（含 approvalId/commandId/CredentialId）以 `is_uuid_v7` CHECK；FK `ON DELETE RESTRICT`。时间 bigint Unix ms，0..8640000000000000，跨列严格时序；revision/epoch/generation 均正 signed int8，node-pg string + BigInt，不 Number；epoch 采用实际 1B-5 int8 契约，不改成 JS safe number。非空 bounded refs 用 ASCII `^[A-Za-z0-9._:-]{1,128}$`、`COLLATE "C"`；digest/fingerprint 为 lowercase hex64 + octet_length=64。不以这些 refs/digest 当 bearer authentication。

新 JSON 不存 request body、任意 metadata 或 grant/secret 快照；budget keys 只有 Infrastructure 从已验证配置/transport facts 生成的 HMAC，不能接客户端 key。Admission/guard 函数不得 RAISE 参数值/SQL DETAIL；应用 boundary 构造新的闭集 sanitized error，不保留 cause/code/driver row。函数里不吞 SQL error 然后允许写入；guard 拒绝使用固定 `42501` 内部错误，storage/malformed/time overflow 一律 fail closed。budget 正常拒绝为 false，backend failure 不是成功。HTTP 分类仍第 10 节，不直接暴露 SQLSTATE。

全部新 definer：owner `zhiban_identity_owner`（NOLOGIN）；`LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER`；`SET search_path = pg_catalog, zhiban_identity, pg_temp`；`SET row_security = on`；schema-qualified relations/sequence/functions，无 dynamic SQL；校验 `session_user` 精确 role。迁移内先创建并 REVOKE 全部 PUBLIC/runtime EXECUTE，再仅 GRANT 下表精确 signatures；默认 PUBLIC EXECUTE 撤销继续保持。没有 overload/default args，禁止 runtime CREATE/SET ROLE。constraint trigger 不以可设置 GUC 作批准证据。

PG16 行锁需要至少一列 UPDATE privilege；`INSERT ... RETURNING event_id` 也需要 SELECT，而现有角色没有此权限。本设计不通过 grants 补齐这两项广泛能力，采用 B.3 的 read-only anchor 和 B.8 的预分配 audit ID。依据 [SELECT privilege / row locks](https://www.postgresql.org/docs/16/sql-select.html)、[INSERT RETURNING / identity override](https://www.postgresql.org/docs/16/sql-insert.html)、[definer search_path / PUBLIC](https://www.postgresql.org/docs/16/sql-createfunction.html#SQL-CREATEFUNCTION-SECURITY)。这些是语义依据，不是本轮已执行 PG16 证明。

### B.3 Session-at-write 与 auth User 行锁

精确签名/返回：

```text
identity_auth_user_anchor(p_user_id uuid)
  RETURNS TABLE(user_id uuid, user_status text, user_revision bigint)
  EXECUTE: zhiban_auth_runtime only

identity_session_guard(p_digest text, p_expected_user_id uuid)
  RETURNS TABLE(user_id uuid, user_revision bigint, security_epoch bigint,
                absolute_expires_at bigint, idle_expires_at bigint)
  EXECUTE: zhiban_runtime, zhiban_control_runtime only
```

anchor 只对 canonical p_user_id 的 users 行 `FOR SHARE`，校验完整 persisted User lifecycle/timestamps/revision 后返回三列；缺失/非 ACTIVE 拒绝，无列表、无 INSERT/UPDATE、无 Credential/Session读写。auth 原本已能读 User，这不是新增枚举 API。它补第 6.4 节 auth command 无权执行 User FOR SHARE 的实际缺口；不给 auth 任意 users UPDATE。这里只锁 User，**不先锁 Session/slot/barrier**，避免密码 command slot SHARE→UPDATE 或 logout-all shared→exclusive 升级。

Session guard 按第 6.2 节：hint 只来自 canonical digest，实际 expected User 是 authenticated request-private binding。User SHARE→shared User advisory barrier→slot SHARE→Session SHARE；fresh re-read 匹配 digest/User，User ACTIVE + session.user_revision=current user revision + session.security_epoch=current slot epoch；slot active pointer非空且对应该 User、ACTIVE 同 generation 的 Credential 元数据（不 SELECT verifier_material）；Session 未 revoked/binding非NULL。全部 positive revisions、ses_格式、时间链由 mapper 等价规则校验。函数仅输出上列，不返回 SessionId/digest/verifier、slot revision 或 grant。tenant/control使用私有step-up proof时，以同client再次读取当前slot revision校验不能从这个五列投影取得；**不得因此临时加列或SELECTslot**。该复核由后续8C精确step-up helper设计提供，8B只实现有既有slot ACL的auth命令step-up；tenant/control写用例在该Gate关闭前不开启。

可信 DB 时间使用锁后 `floor(extract(epoch from pg_catalog.clock_timestamp()) * 1000)`，校验 bigint/Instant 范围；不是事务固定 CURRENT_TIMESTAMP，不接受 caller `p_now`。要求 now≥last_seen_at 且 now<idle/absolute deadline；guard 不 touch。tenant/control command final check 可再次调用同 guard，仍同 client/transaction，不能释放锁换池。known locks重入不引入新 User/Tenant。auth 自己经 anchor +既有权限执行相同内部 read；自身换密码/logout的 final check按批准 post-state，不错误要求已合法失效的旧 Session 仍有效。

auth password：anchor→shared barrier→slot直接UPDATE→Session直接UPDATE→proof/CAS→旧状态终态化/新generation/audit→final expected post-state。auth logout-all：anchor→exclusive barrier→slot SHARE→Session locks→fresh authentication→revoke/audit；不得先 shared guard 再升级 barrier。锁外完成 hash/screening/current password proof；proof绑定旧 User/slot revisions、epoch、本 request/command/action，锁后复核。保持 standalone旧 repositories/issuance协议不变；新 composition不可在 private collaborator 内重新 connect。

### B.4 本人空间查询与精确 RLS

```text
identity_session_spaces(p_digest text, p_after_membership_id uuid, p_limit integer)
  RETURNS TABLE(tenant_id uuid, tenant_code text,
                tenant_display_name text, membership_id uuid)
  EXECUTE: zhiban_auth_runtime only
```

只有上述 signature；cursor nullable UUIDv7，limit nonNULL 1..50，返回≤limit。内部按 B.3 等价 owner-safe读锁验证完整 Session、User/slot/expiry（不能调用只允许 tenant/control 的 guard偷换role）；不接受 UserId/TenantId/role参数，不更新 Session。查询 `(user_id, membership_id)` 有序，cursor严格 `membership_id > cursor`。先 bounded读取该 User **全部状态**候选最多1001，>1000统一拒绝，不只检查当前page；不执行无限 count/materialize。仅返回 ACTIVE Membership + ACTIVE Tenant。导航不是授权，下一写入仍 fresh-check。

index `memberships_identity_discovery_idx ON memberships(user_id, membership_id)`，不改变已有 unique/FK。函数保存 prior `app.identity_discovery_user`，覆盖为有效 Session导出的 UserId，`set_config(..., true)`；成功/可捕获异常均恢复prior，缺prior恢复空字串。调用异常必须使外层事务 rollback，不能 catch-and-continue。pool reuse测试检查无上下文残留。

唯一新增 Membership policy：`memberships_identity_discovery_owner_read FOR SELECT TO zhiban_identity_owner`；USING 严格等价 `user_id = CASE WHEN octet_length(current_setting('app.identity_discovery_user',true))=36 AND canonical UUIDv7 regex THEN current_setting(...)::uuid ELSE NULL::uuid END`。表达式内 cast须 CASE 保护，不靠 AND求值顺序。无 runtime/auth/control policy变化，无 RoleGrant policy、无 owner DML。owner旧 tenant SELECT policy继续存在，所以函数查询还必须显式 `m.user_id=validated_user_id`，不能依赖 policy OR组合自动过滤。恶意 current Tenant/discovery GUC从不授caller认证；新旧 definer各自所有SQL显式 subject/Tenant绑定。owner tenant policy的范围不扩大，原 authorization_state仍逐参数校验。

最终取得 fresh clock并验证 Session仍live才返回，不承诺结果导航在未来不变。不给 auth Membership/Tenant SELECT，不给 tenant/control digest读取；没有 global list、permission目录或资源 loader。

### B.5 共享 admission 的逐字段 schema 与容量上限

以下三表 global，无 tenant RLS；**所有 runtime 禁止直接读写 buckets、禁止直接读/UPDATE/DELETE gate**；唯一 gate直接权限为control配置事务的INSERT(purpose)，见B.9。owner仅作为有限函数执行主体，migrator只维护schema，不充当应用连接。

`admission_policies`：`purpose text PRIMARY KEY` 闭集 LOGIN/REAUTHENTICATE/PASSWORD_CHANGE/INITIAL_PROVISION；`policy_digest text UNIQUE NOT NULL` hex64；`approval_ref text NOT NULL` bounded ref；`environment_ref text NOT NULL` bounded ref；`created_at bigint NOT NULL` Instant；`window_ms bigint NOT NULL CHECK 1..3600000`；`global_limit bigint NOT NULL CHECK 1..1000000`；`ip_limit/locator_limit/pair_limit/user_limit bigint NULL` 同正范围；`max_buckets bigint NOT NULL CHECK 1..1000000`。CHECK分支 IS TRUE：LOGIN必须ip/locator/pair且user=NULL；REAUTHENTICATE/PASSWORD_CHANGE必须ip/locator/pair/user全部非NULL；INITIAL_PROVISION必须user且ip/locator/pair=NULL。这些是 schema硬上界而非默认生产限速值；初始 thresholds/window/capacity必须批准负载配置，没有默认policy seed。

control runtime仅 `SELECT, INSERT` 固定上述列；不得 UPDATE/DELETE/多版本旁路。`identity_admission_policy_immutable()` BEFORE UPDATE OR DELETE invoker trigger统一拒绝；policy PK每purpose最多一行，不接受config热更新。生产配置改变需要 close/drain 后另行批准维护步骤，不能新增第二purpose alias避限速。批准配置由 operator工具校验获准 manifest/environment/digest再插入；HTTP不接收policy配置。缺policy/manifest不一致启动或admissionfailclosed；CI用显式fixturepolicy并标非production。auth仅 via reserve函数核对digest，不 SELECT approval配置。

`admission_gate`：`purpose text PRIMARY KEY FK admission_policies(purpose)`；`bucket_count bigint NOT NULL DEFAULT 0 CHECK 0..1000000`；`repository_revision bigint NOT NULL DEFAULT 1 CHECK >0`。policy插入后的operator事务 INSERT匹配gate（control只授 INSERT(purpose)，defaults无callercount）。auth无directACL；新增gate失败与policy一起rollback。gate永久、禁止runtime删除。函数每次锁gate FOR UPDATE再fresh核验policy/capacity；计数变更revision+1，maxint8拒绝，不应用repository CAS到每条短期counter。

`admission_buckets`：`purpose text NOT NULL FK gate(purpose)`；`dimension text NOT NULL` 闭集 GLOBAL/IP/LOCATOR/IP_LOCATOR/USER；`key_hmac text NOT NULL` hex64；`window_start bigint NOT NULL` Instant；`expires_at bigint NOT NULL CHECK window_start<expires_at≤InstantMax`；`used_count bigint NOT NULL CHECK 1..1000000`；PK `(purpose,dimension,key_hmac,window_start)`；index `admission_buckets_expiry_idx(purpose,expires_at,dimension,key_hmac,window_start)`。无 raw IP/locator、UserId、token/password、body或secret hash；HMAC secret不入DB。purpose/维度/window/计数值只能函数从已批准policy生成。

```text
identity_admission_reserve(p_purpose text, p_policy_digest text, p_keys text[])
  RETURNS boolean; EXECUTE auth_runtime only
identity_admission_prune(p_purpose text, p_policy_digest text, p_limit integer)
  RETURNS integer; EXECUTE auth_runtime only
```

keys数组必须1维、lower bound=1、非NULL元素hex64：LOGIN固定序 GLOBAL/IP/LOCATOR/IP_LOCATOR（4）；REAUTHENTICATE/PASSWORD_CHANGE加USER（5）；INITIAL_PROVISION固定GLOBAL/USER（2）。不能靠选择少数维度、重复purpose/NULL降低预算。keys由 server HMAC(namespace/environment/purpose/dimension/canonicalfact)构成，GLOBAL为固定批准environment的常量输入；DB验证格式和policy绑定，不能验证HMAC secret，可信 composition负责禁止caller影响key。INITIAL_PROVISION是operator限定，不走public HTTP或伪造clientIP。

reserve独立短auth事务，在任何User/slot/business锁/KDF前完成并checked COMMIT后才开始昂贵工作。gate锁→核验配置/digest→锁后DB clock→`window_start=floor(now/window_ms)*window_ms`→读取全部required bucket→计算全部计数/新增容量→全部通过才写。任一超限/capacity/maxrevision/时间边界：不留下部分维度更新；正常限速false，结构/异常sanitizedfailure。拒绝时不延长expiry，不把跨窗口旧row当新budget。counter最多exactly+1，newbucket初始化1，gate count只加实际新row数量，多个独立连接由同purpose永久锚序列化。此首版稳定串行锚限制吞吐，不宣称高并发无限扩容。

prune只允许limit 1..500；同gate锁下，只删除 `expires_at <= fresh now`，按expiry/PK稳定序取至多limit，更新bucket_count减少真实deleted数、gate revision+1；0行TRUE NO-OP保持revision。不会删User/Session/audit/history或未过期bucket。无自动无界循环，受控worker重复调用需要部署cleanup责任；capacity满时拒绝而非未授权prune活跃budget。新policy/gate最多4行；buckets全量最大4×批准max_buckets且有schema上界；permit cap=2和Argon2参数不变，无plaintext队列。budget消费不因后续认证失败退款，防止wrongpassword绕预算。

### B.6 首个平台管理员：永久锚与独立审批

`identity_platform_bootstrap` global table，migration仅 seed `singleton_key='PLATFORM', repository_revision=1` 的 **EMPTY** row，无用户、密码、RoleId、approval或已完成状态。PK text CHECK唯一PLATFORM；`repository_revision bigint >0`；以下 nullable列：`approval_id uuid UNIQUE`、`command_id uuid UNIQUE`、`environment_ref/approval_ref/operator_ref/approver_ref/request_id text` bounded；`manifest_digest text` hex64；`target_user_id uuid FK users`；`user_revision bigint >0`；`system_admin_grant_id uuid UNIQUE FK system_admin_grants`；`issued_at/expires_at/completed_at bigint` Instant；`created_user boolean`；`user_created_event_id bigint UNIQUE FK audit_events(event_id)`；`grant_created_event_id bigint UNIQUE FK audit_events(event_id)`；`credential_provision_id uuid UNIQUE FK identity_credential_provisions(approval_id) DEFERRABLE INITIALLY DEFERRED`。operator_ref与approver_ref必须不同；0<expires-issued≤86400000且issued≤completed<expires。bootstrap EMPTY要求除revision/key外全部NULL；COMPLETED要求上述列全部非NULL，唯`user_created_event_id`按created_user分支：true必须有event，false必须NULL（核验既有User）；CHECK整个逻辑 IS TRUE。

control有 SELECT全列、UPDATE仅上述nullable结果列+repository_revision；无 INSERT（seed由migration）、DELETE/TRUNCATE。`identity_bootstrap_guard()` BEFORE UPDATE/DELETE invoker：EMPTY→COMPLETED且revision1→2仅一次；COMPLETED所有UPDATE或DELETE拒绝（TRUE NO-OP由Application不发SQL）；不得重置锚/改target/ticket/grant/outcome。所有id/manifest不可在已消费后改变。bootstrap读取不作为Web授权；秘密不存任何列。

Operator流程：明确工具defaultclosed、当前environment/manifest/corpus/admission配置通过；纸面/组织审批形成purpose=FIRST_PLATFORM_ADMIN、targetUser/newGrant/provisionApproval/commandID/environment/expiry的不可变manifest，operator和独立approver具名ref，工具通过受控存储读取核验approval，不接受命令行一个`approved=true`替代。生产approval ref、保管责任和独立核验人尚待用户配置，不自动生成“批准记录”。DB schema只约束绑定和不可逆消费，不声称FK能证明human consent或抗DB凭据泄漏。

control同事务先锁PLATFORM anchor FOR UPDATE；已完成仅可在匹配同ticket/command/target、当前outcome仍一致及独立审批允许确认时返回安全IDs，不能重发grant。EMPTY时先以B.10精确锁helper冻结SystemAdmin历史表写入（下段）并检查**任何历史SystemAdminGrant都不存在**，不只count有效grant；再目标User必要FOR UPDATE/创建ACTIVE User；新grantId+Domain合法validity；USER_CREATED（仅新User）和SYSTEM_ADMIN_GRANT_GRANTED按原shape追加；插入对应credential provision批准记录；一次绑定anchor全部outcome，final clock/manifest expiry，COMMIT。无Credential还不能登录，不能假称跨control/auth已经完成一个ACID用例。EMPTY seed须在附加consistency trigger之前创建，不能给migrator应用身份检查例外。

bootstrap唯一例外表锁由 B.10 的 `identity_platform_bootstrap_lock()` 在任何grant/User写入**之前**取得。不得在已INSERTgrant的deferred trigger中才申请表锁，也不得把RETURNS trigger函数当普通入口。永久锚串行化两个获准bootstrap；精确表锁排除不遵守新锚的旧grant writer，使fresh历史检查与首次grant写入同事务。无锁count或应用mutex不能代替，不依赖control列级UPDATE能否LOCK的假设。表锁粒度只用于一次operatorbootstrap，不用于正常tenant/Session写入。[PG16 LOCK permissions / order](https://www.postgresql.org/docs/16/sql-lock.html)

### B.7 首次 Credential provisioning 的逐字段与跨池边界

`identity_credential_provisions` global table：`approval_id uuid PRIMARY KEY`；`command_id uuid UNIQUE NOT NULL`；`user_id uuid UNIQUE NOT NULL FK users`；`expected_user_revision bigint NOT NULL >0`；`purpose text NOT NULL CHECK ='FIRST_PASSWORD'`；`environment_ref/approval_ref/operator_ref/approver_ref/request_id text NOT NULL` bounded且operator≠approver；`manifest_digest text NOT NULL` hex64；`issued_at/expires_at bigint NOT NULL` Instant且0<expires-issued≤86400000（24h硬上限）；`consumed_at bigint NULL`；`credential_id uuid NULL UNIQUE`；`credential_event_id bigint NULL UNIQUE FK audit_events(event_id) DEFERRABLE INITIALLY DEFERRED`。CHECK消费三列全NULL，或全非NULL且issued≤consumed<expires，整式IS TRUE。同User只能一条首次批准，失败不改target或新发ticket覆盖；过期后未消费重新审批策略必须另行设计，不通过删除记录绕过。没有resetpurpose、rawsecret/material或client批准boolean。

control仅 SELECT与INSERT不含后三个消费列；auth SELECT与UPDATE `(consumed_at,credential_id,credential_event_id)`；tenant/PUBLIC全部deny，control不得consumption，auth不得INSERT/批准字段UPDATE。无需tenant RLS。`identity_provision_guard()` BEFORE INSERT/UPDATE/DELETE invoker：INSERT消费列全NULL；UPDATE只允许一次全NULL→全非NULL，批准字段全等，issued≤consumed<expires；terminal不可变；DELETE拒绝。normal-noop不发SQL。FK `(user_id,credential_id)`→credentials(user_id,credential_id) **DEFERRABLE INITIALLY DEFERRED**，而不仅单CredentialId FK。

当前8B仅消费platform anchor精确绑定的provisionApproval/User；auth不能创建或替换自己的批准。future一般User初始provision须单独批准operator途径，不把schema FIRST_PASSWORD自动开放为tenantadmin全球设密码。expiry/manifest/ref只由trustedoperator读取，秘密来自关闭echo且非argv/log的短生命周期输入；screening/hash在DB锁外。

auth同事务：anchor helper锁目标User SHARE并核验ACTIVE/revision→shared User barrier→provision行FOR UPDATE→freshmanifest/time/绑定核验→检查**slot从未存在**（revoked空pointer仍存在，拒绝）；INSERT credential slot/credential（各generation/revision/epoch1，旧trigger保持）→CREDENTIAL_CREATED按原shape/auditID→填唯一consumption→deferred FK/consistency→COMMIT。并发同ticket一胜，loser不能重新hash覆盖或清历史；并发旧createPassword仍由slot PK约束导致至多一胜，若另一路胜出则审批不消费且保留安全人工处理，不自动把未知credential当ticket的成功。corruption/auditfail整笔rollback。

User/grant/control audit先提交、Credential/auth audit后提交；中断安全resume必须同immutableticket/target且未消费未过期，不能补偿DELETE grant/slot/history。consumed安全outcome确认检查User/revision、对应Credential仍当前有效并匹配原outcome，不返回hash/token；后来替换/撤销不能旧ticket复活。最终login为新的正常认证，不cache/replaybearer。

### B.8 audit ID与跨记录一致性：不授runtime审计读取

保留现有AuditEvent union/payload/ownership/event_shape_version=1，0008不添加8C新事件，不改audit_payload_valid链。所有audit仍同client/transaction。仅 auth/control追加 `GRANT INSERT(event_id)`；现有sequence USAGE保持，不增加sequence UPDATE/SELECT、audit SELECT/UPDATE/DELETE/新runtime SELECT policy。Infrastructure在同client以nextval分配int8 eventId，作为安全内部string，再 `INSERT ... (event_id,...已批准列) OVERRIDING SYSTEM VALUE VALUES (...)`；不使用RETURNING/SELECTaudit。耗掉sequence编号但rollback的gap合法，不能用连续ID判断完整审计；序列最大值失败整笔rollback。

该column INSERT允许显式ID但不允许覆写既有event；正常用例只能使用现场nextval值，不允许client传eventId、setval或改audit历史。所有新ledger FK记录实际eventId；runtime能读provisionoutcome的安全ID不等于能读eventpayload。

新增 owner policy `audit_identity_provenance_owner_read FOR SELECT TO zhiban_identity_owner`，USING仅 `event_scope='GLOBAL' AND tenant_id IS NULL` 且以下关联之一：event_id等于PLATFORM anchor的user_created_event_id并subject_user_id等于target且type USER_CREATED；或等于grant_created_event_id且同target且type SYSTEM_ADMIN_GRANT_GRANTED；或等于 provision的credential_event_id且同user且type CREDENTIAL_CREATED。全都显式exclude其他events/tenants，不依赖 caller GUC；table引用无RLS（globalledgers），避免recursiveauditpolicy。**不加 owner INSERT policy**；审计仍由实际auth/controlruntime现有INSERTpolicy执行。

`identity_bootstrap_consistency()`、`identity_provision_consistency()` 精确为 `RETURNS trigger` definer，**仅 DEFERRABLE INITIALLY DEFERRED AFTER UPDATE/INSERT constraint trigger**；runtime EXECUTE全部deny，无输入signature普通调用，无DML。检查最终row而非中间 NEW旧快照：bootstrap已完成时User/grant User FK/createdAt/manifest target、matching USER_CREATED或允许existingUser分支、grant event payload精确grantId/subject/reason/request一致、matchingprovisionexpected revision等；provision批准或消费均核验其approvalId/user/manifest等绑定已完成的PLATFORM anchor，消费时还匹配Credential user/newid/generation1、初始slot/revision/epoch1、matching CREDENTIAL_CREATED payload/subject/时间/request。关联读取由owner constraint trigger完成，不能为auth增加PLATFORM表SELECT。任何缺event/其他User事件/错grant/错eventtype/falsepayload关联/批准消费无业务完成不能commit。provision未消费没有Credentialoutcome不代表可以假装成功。

这些trigger是新增ledger一致性约束，不改旧Credential状态机；只在审批/消费commit时要求初始状态，未来Credential替换不重新触发已terminalapproval从而错误禁止正常更换。bootstrap consistency不把未来Userdisable/grantrevoke误认为历史审计非法。无对旧tables新增会重检首次outcome的trigger。operatorbootstrap审计actor固定SERVICE/`identity_bootstrap`，provision固定SERVICE/`identity_provision`，reason ADMIN_REQUEST、绑定serverrequestId；这两个servicecode仅描述已核验的operator操作，不作为授权证据。event occurredAt分别与completed_at/consumed_at一致且final DB时钟仍未越批准expiry。

### B.9 精确 ACL 总表与验收例外

| 对象/能力 | auth | tenant runtime | control | PUBLIC |
| --- | --- | --- | --- | --- |
| identity_auth_user_anchor(uuid) | EXECUTE | deny | deny | deny |
| identity_session_guard(text,uuid) | deny（内部等价检查） | EXECUTE | EXECUTE | deny |
| identity_session_spaces(text,uuid,integer) | EXECUTE | deny | deny | deny |
| identity_platform_bootstrap_lock() | deny | deny | EXECUTE | deny |
| identity_admission_reserve(text,text,text[]) / prune(text,text,integer) | EXECUTE | deny | deny | deny |
| 两个consistency / 三个invoker trigger functions | 无直接EXECUTE | 无直接EXECUTE | 无直接EXECUTE | deny |
| admission_policies | 无directACL | deny | SELECT / fixed-column INSERT | deny |
| admission_gate | 无directACL | deny | INSERT(purpose) only | deny |
| admission_buckets | 无directACL | deny | deny | deny |
| identity_platform_bootstrap | deny | deny | SELECT / fixed-column UPDATE | deny |
| identity_credential_provisions | SELECT / consume三列UPDATE | deny | SELECT / approve固定列INSERT | deny |
| audit_events新delta | INSERT(event_id) | 无delta | INSERT(event_id) | deny |

新表全部owner-owned、不使用identity sequence（UUID在Infrastructure发行），5个新globaltable均无tenant RLS且精确ACLdeny其他角色；原Member/Grant/audit FORCE RLS保持。owner读取例外只两项，tenant/control仍不能SELECTtoken_digest/verifier、auth仍不能UPDATEusers或SELECTmemberships/tenants。catalog真实RoleIds/配置/approval签署不会在migration里制造fixture默认值。

未来tests只准精确更新：migrationinventory0001–0008、失败probe改当前next序号0009、CLIsecondNOOP/checksum/rollback并发expectedcount；PG16 definer allowlist用**完整regprocedure signatures**列原authorization_state+上表6入口+2triggers，断言实际集合完全相等、owner/path/RLS/roleACL各自精确，而非`anydefinerapproved`；保留旧0007文件专属1function/2policy断言与无secret查询；不能把旧断言删除。新index/policies按exact集合验证，public columnACL用aclexplode(nonNULL attacl)，不得空数组fallback。

BUILD targeted unit/SQL/securitytests覆盖五类入口、budgetmulti维原子、capacity/prune/maxfailclosed、operatorpermission/provenance、exactcolumnGRANT、sameclient/auditID/rollback/failedCOMMIT、secretserialization、形状错误和生产config缺失。真实suite建议 `pg16-identity-composition.test.ts`，追加既有两轮：受限authanchor成功且auth直接UserFORSHARE/UPDATE仍denied；guard各caller/输入/缺epoch/expiry/max时间/freshrollback；discoveryforeignGUC/cursor/cap1000/上下文恢复；budget并发超限/不退款/capacitycleanup；twooperatorbootstrap/oldgrantwriter竞争/历史grant阻止再bootstrap；provision两连接一胜/错User/auditevent伪关联拒绝/每故障点整笔rollback；任意runtime/PUBLIC不能读秘密或调用trigger；pool/clientrelease。竞争用independentclients+acknowledgedlocks，no sleep-only。

保留全部旧168 PG16每轮与1017 Identity回归；新增suite actualcount单独汇总，不能用旧CI签收新objects。Node22/Linux、frozeninstall/Argon2、lint0errors/typecheck、HTTP以后真实验证仍必需。当前docs-only不运行这些测试/PG16/typecheck，不把设计检查写成ACL/concurrency实际PASS。

### B.10 自审收口：bootstrap表锁最小能力

为让精确审批不依赖未经验证的control列权限，本补充固定采用以下 **已人工批准的read-only锁helper设计**，不提供实施时任择两种方案：

```text
identity_platform_bootstrap_lock()
  RETURNS void; SECURITY DEFINER（同B.2所有属性）
  EXECUTE zhiban_control_runtime only
```

只执行精确 `LOCK TABLE zhiban_identity.system_admin_grants IN SHARE ROW EXCLUSIVE MODE`，无SQL参数、无rows返回、无业务DML，无User/tenant/secrets查询；调用者核验session_user=control。锁只持到当前transaction末尾，不自己BEGIN/COMMIT。不授control新tableUPDATE/owner能力。control先PLATFORM anchor UPDATE→该锁helper→fresh全部历史grants查询→User必要锁→newgrant/audit/provision→consumeanchor。明确firstbootstrap没有credential证明，依赖上述独立operatorapproval；工具不能暴露helper或bootstrap为HTTPendpoint。

该精确helper已获 **B8-S06** 人工批准，计入 B.1/B.9 的inventory与ACL；constraint函数始终只deferredread，不承担BEFORE/表锁或普通调用。实施时若该边界无法安全成立，回到精确设计，不临时增加tableUPDATE或其他helper。这是无UserUPDATE/新role的最小能力补充，不是重开SystemAdmin业务授权。

设计审阅已核对：auth User锁窄能力、audit ID路径、ownerTenantpolicy OR下的显式subject过滤、可信时间、bootstrap历史检查/表锁、跨池分步、预算容量/cleanup、terminal审批、旧Credential后续mutation不重新检查初始outcome。收口明确gate列级INSERT例外、EMPTY seed先于trigger、platform/provision关联由已有owner trigger核验；不新增对象或权限。该设计审阅不代替真实PG16/SQL/parser/并发签收。B8-S01–S06已人工批准；remaining审批仅生产配置/具名operator证据及范围外8C/恢复，不批准fakeproductioncorpus。

| 审批项 | 精确范围 | 当前状态 |
| --- | --- | --- |
| B8-S01 | anchor/guard/spaces三函数、Member owner SELECT policy/index，固定锁序与投影 | HUMAN_APPROVED / FROZEN |
| B8-S02 | 三budget表/两函数、policy immutable trigger、capacity/cleanup、精确operatorconfigACL | HUMAN_APPROVED / FROZEN |
| B8-S03 | PLATFORM永久锚、控制面one-time流程/guard/consistency、provision关联 | HUMAN_APPROVED / FROZEN |
| B8-S04 | FIRST_PASSWORD专用批准表/guard/consistency、auth/control精确ACL、跨池显式resume | HUMAN_APPROVED / FROZEN |
| B8-S05 | audit事件ID INSERT仅auth/control、owner关联SELECT policy、exactsignatures测试allowlist | HUMAN_APPROVED / FROZEN |
| B8-S06 | bootstrap只锁一个表的zero-argument definer，无业务DML或tableUPDATE扩权 | HUMAN_APPROVED / FROZEN |

仅配置准备/运营内容待部署：policy实际threshold/window/capacity、HMACkey/rotation、proxy/sourceIP、environment/approvalrefs及独立审批人、catalog/corpus/backup；其缺失只允许运行显式fixturetests、不开放入口或productionbootstrap。8C精确schema/ACL/firstTenantadmin、8D HTTPwiring、8E人工恢复另行授权，本补充不一次批准它们。

### B.11 当前结果与下一步

PRECISE_SCHEMA_ACL_DESIGN: HUMAN_APPROVED_FROZEN

SUPPLEMENT_HUMAN_APPROVAL_DATE: 2026-10-03

APPROVED_ITEMS: B8-S01_B8-S06

SUPPLEMENT_BASE_HEAD: 01cf79b2dd337918cbff29d1e2404e88777f6d36

OLD_MIGRATIONS_0001_0007: UNCHANGED

MIGRATION_CREATED: NO

PRODUCTION_FILES_MODIFIED: 0

TEST_WORKFLOW_PACKAGE_FILES_MODIFIED: 0

SCHEMA_ACL_IMPLEMENTED_OR_REAL_PG16_PROVEN: NO

FROZEN_CONTRACT_CONFLICT: NO_OBSERVED

READY_FOR_SUPPLEMENT_HUMAN_REVIEW: COMPLETE_APPROVAL_RECORDED

READY_FOR_SUPPLEMENT_DOC_CHECKPOINT: YES

READY_FOR_1B8B_BUILD: NO_PENDING_SUPPLEMENT_CHECKPOINT_REMOTE_VERIFICATION_AND_SEPARATE_BUILD_AUTHORIZATION

下一步：补充文档checkpoint（GPT-6.1 Sol / Low）→独立remoteHEAD/message/parent（Low）→单独授权8B BUILD与同轮安全自审（High，NOcommit/push/dispatch）。当前不执行后续步骤。生产参数/具名operator配置未批准时相应入口关闭，8C/8D/8E不随8B自动授权。
