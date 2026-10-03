# Phase 1B-8A Identity Application / API / Security Composition Design

STATUS: A8_B8_C8_HUMAN_APPROVED_FROZEN / C8_IMPLEMENTATION_NOT_AUTHORIZED

Date: 2026-10-03. Branch: `refactor/zhiban-v2`. Design base HEAD: `bf3f9139f28a1f87edc7e15aa3ab8d97452aaadd` (`docs(zhiban-v2): close out authorization layer`). Preflight worktree: CLEAN.

2026-10-03 用户明确批准：“批准1B-8A 设计”。本批准冻结本文已描述的 A8-01–05 设计选择与推荐方向，包括 UserId-first、注册用户邀请/consent/fresh approval、Session-at-write 与本人空间发现边界、有限 bootstrap 和闭集 provenance/幂等要求。本文中“提案/推荐”是方案形成时的称谓，审批状态以第 15 节为准；不再表示这些已描述方向尚待产品选择。

批准不扩展为实施授权。2026-10-03 用户进一步明确“批准附录 B 的 B8-S01–S06”，并要求审阅：附录 B 的精确 8B schema/ACL 契约已人工批准并冻结。其后的 8B BUILD/checkpoint/CI 已分别获授权并完成；最新基线与证据见附录 C.1。正文和附录 B 的 ABSENT/尚未实施/下一步标签保留为当时设计快照，不能覆盖后来签收，也不能视为授权 8C。2026-10-03 用户明确“审阅并批准八项契约”，C8-S01–S08 经本轮审阅及限定澄清后人工批准、设计冻结，详见 C.12；不是 BUILD 授权。恢复能力、部署阈值/代理配置/具名运营责任仍需独立审批；本轮不实现或变更 Application、HTTP、配置、数据库对象、测试或 workflow，不 commit/push/dispatch。

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

## 附录 C — 1B-8C 成员命令精确 schema / ACL / Session-at-write 设计

### C.1 本轮权威、实现审计与授权状态

Date: 2026-10-03. Model: GPT-6.1 Sol / High. Design base HEAD: `989f44d272a204712a101bc542a9826f4661ffdc`，branch `refactor/zhiban-v2`，初次设计 preflight CLEAN；本次批准审阅 preflight 仅本文一项预期未提交变更，branch/HEAD 不变。初次授权是 **8C 前置设计补充**；随后用户明确“审阅并批准八项契约”，批准的是 C8-S01–S08 的精确设计，不是 BUILD、checkpoint、commit、push、CI 或部署授权。本附录只有本文一文件变更。

最新 8B candidate 的 message 为 `test(zhiban-v2): correct identity composition pg16 fixture`，parent `eeb65cf317f8a746e0f24d7c5cf0ed9d052a8d81`。最终 [run 37105354548](https://github.com/yhouzxm/OpenMAIC/actions/runs/37105354548) 绑定此 SHA、workflow_dispatch、SUCCESS：PostgreSQL 16.15、Node v22.23.3 linux/x64、PG16 206/206 ×2（原 168 + composition 38）、Identity 1091/1091（29 + 377 + 99 + 50 + 352 + 110 + 74）、frozen install/Argon2/lint/typecheck PASS，lint 0 errors / 20 existing warnings。此前 B8-PG16 fixture 忽略 immutable User.disable/restore 的返回值；已改为保存返回对象并断言持久化 status/revision，未改生产语义。本轮不 rerun 或 dispatch。

重新核对本文 A/B、1B-7 design/closeout、执行计划 8C、Membership/RoleGrant/authorization Policy、Application audit/authorization/authentication contracts、`composition/authentication.ts` 的私有 handle/proof 与 root/operator/support、`postgres/repositories/{authorization,membership}.ts`、transactions、0002/0003/0007/0008、migration contract/PG16 authorization/composition tests 和现有 workflow。以下缺口是实际资产差距，不是更改冻结模型的理由。

| 当前资产 | 状态 | 8C 精确差距 |
| --- | --- | --- |
| 1B-7 Policy / same-client parent load/save / guard | EXISTS / FROZEN | 九动作、单 grant、ceiling、256 User 上限/双计数可复用；public execute 自有事务且不含 Session/consent/command |
| 0008 Session-at-write guard | EXISTS / FROZEN | tenant/control 可读五个安全事实；无 credential slot revision，不能代替敏感命令 re-auth proof 复核 |
| 8B authenticated handle | EXISTS / PRIVATE | 每个实例私有 WeakMap；普通 `kind` 对象不可伪造，尚无受保护成员命令桥接 |
| Admission / consent / grant approval provenance | ABSENT | 现有 `approvedGrants` 名称、RoleGrant factory、Audit factory 均不证明批准来源；1B1-F05 未实现关闭 |
| Durable safe command outcomes | ABSENT | 旧 repository CAS 不等于请求幂等；不能用结果 JSON/cache 冒充 ledger |
| New-member / self-consent transaction context | ABSENT | 0007 要求已存在 target 与 ACTIVE actor；不得借空 target、假 Membership 或新增旧函数 mode 绕过 |
| Global User/Tenant command composition / first Tenant admin | PARTIAL / ABSENT | 低层写与 closed audit 已存在；完整 Session/control approval/audit/ledger 原子用例和有限 onboarding 尚缺 |
| Migration / workflow | EXISTS | 已应用 inventory 0001–0008、一个两轮 PG16 workflow；本轮不建 migration、不改测试命令 |

C.2–C.11 是经审阅的唯一精确契约，C8-S01–S08 人工批准状态见 C.12。旧 0001–0008、Identity/Credential/Session/1B-7 九动作与 delegation 语义不变。预期未来新增 **0009_identity_membership_composition.sql**；BUILD 开始若 0009 已占用则 STOP MIGRATION_SEQUENCE_CONFLICT，不重编号绕过核验。

### C.2 逐成员用例与批准来源

三个事实不可合并：**入域资格 ≠ 本人 consent ≠ 当前管理员授权**。首版 8C 的 admission 来源唯一限定为 `OPERATOR_IMPORT`：具名 operator 的独立批准登记只引用已有 registered User 和指定 Tenant，不导入 V1 身份/密码、不做全局 User 探针。verified self-join 来源保留后续独立设计，当前不建立 producer、不接受 source string/客户端 approved boolean 作为替代。operator register 成功只建立资格，不建立成员或 grant。

| 具体命令 | 执行主体与资格 | 输入/来源与同事务效果 |
| --- | --- | --- |
| Register member admission | control：真实 Session + current SystemAdminGrant + step-up + operator purpose `MEMBER_ADMISSION` | immutable server manifest 绑定环境、Tenant/已有 User、purpose、expected versions、≤24h；只产生 admission，不表示本人同意或 manager grant approval |
| Invite / create pending | 当前 Tenant ACTIVE manager，同一有效 TENANT grant 拥有 `membership:manage`；step-up | 指定有效 admission；Tenant→sorted Users→Session→parents/source；确认 (tenant,user) 无成员后 server new MembershipId，PENDING、authVersion=0、revision=1、grants=[]；消费 admission 并记录 create event/ledger |
| Accept invitation | 该 registered User 的真实 Session，无须 ACTIVE Membership 或管理 Role；无额外 KDF | admission 的已绑定 Membership 正处 PENDING、同 User/Tenant、未过期；记录 consent + event + ledger；不 activate、不写 parent、不赋权 |
| Activate pending | 既有 MEMBERSHIP_ACTIVATE Policy + step-up +同 grant 两 permission + ceiling | 当前 target revision/authVersion + 本人有效 consent；执行时 fresh manager approval；所有 pending-origin grant 保留为 revoked 历史，新 IDs/time 才可 ACTIVE |
| Disable / admin leave | 既有 MEMBERSHIP_DISABLE / MEMBERSHIP_LEAVE_ADMIN + step-up | target CAS、双 last-admin post-state、既有 audit、ledger；不 revoke global Session；self-service leave 仍关闭 |
| Reactivate disabled | 既有 MEMBERSHIP_REACTIVATE + step-up + fresh approval + 本人对本次恢复的 consent | mode 必须显式：PRESERVE 明确当前有效且有已消费 provenance 的 IDs；REPLACE 新 IDs；未选旧 grant terminalize；不能复活 pending-origin/expired/revoked/future grant |
| Rejoin left | 既有 MEMBERSHIP_REJOIN + step-up + fresh approval + 本人本次 rejoin consent | 只能创建新 grant IDs；LEFT 历史和旧 revoked grant 仍存在 |
| Grant / revoke / replace | 既有 ROLE_GRANT/ROLE_REVOKE/ROLE_REPLACE + step-up、pre-state single-grant authority | 授予/替换记录 fresh manager approval；revoke 不需要被撤权人的 consent，不能给其否决安全撤权的权利；最多 2 targets / 每 target 16 个 proposed 或 preserved grant；完整 post-state 双 last-admin |
| Atomic administrator transfer | 同一 manager、Tenant、request/command、step-up | 最多两目标，整体 approval/CAS/audit/ledger 一次 transaction；任何一目标失败全部 rollback；不能先提升自己再用 post-state 批准另一目标 |

新 command labels `MEMBERSHIP_PENDING_CREATE` / `MEMBERSHIP_CONSENT_RECORD` 仅属于 composition 闭集，不扩展旧九动作或 RoleCatalog。前者是上述精确 `membership:manage` + TENANT Policy；后者仅本人关系确认，不能凭 SELF consent 获得管理 Permission。STUDENT/TEACHER permissions 仍为空；可授范围沿 1B-7 明确 ceiling：TENANT_ADMIN/TENANT 与 STUDENT/SELF；无真实 Class/Course relationship loader 时其他组合拒绝。没有 role 字符串排序或默认无限委派。

Consent 对 ACTIVATE/REACTIVATE/REJOIN 各绑定一个具体 target version、purpose、入域/恢复登记；它不是永久“同意所有变更”。DISABLED/LEFT 重新入域需新的 admission/consent。Role 管理不修改成员关系，不要求每次发 consent，但仍需要 fresh manager approval。旧邀请者失权后不能执行激活；另一当前合格 manager 可在完全新审批下执行，不能借旧 inviter 的 receipt。approval producer 从当前锁内 server facts 构造 approver 信息，客户端只提供 proposal/locator/expected versions。

**1B1-F05 边界**：Domain 允许历史 PENDING 带 grant；8C 新 invite 不产生 grant，activate/rejoin/replace 一律新 ID。PRESERVE 额外要求每个 ID 能关联此前已消费的 8C approval 和真实成功 grant/activation audit，且本次仍通过 current validity/ceiling。没有 provenance 的 legacy ID 默认不能 preserve，需明确 replace 新 IDs；不回填虚假批准或追认 pending-origin grant。此补充不使旧 ACTIVE grant 的普通授权突然失效、不改 Domain effectiveGrantsAt；它约束新恢复用例。F05 只有 BUILD + negative tests + real PG16 签收才可 CLOSED，当前 DESIGN_SPECIFIED / IMPLEMENTATION_PENDING。

可接受的既往 grant provenance 精确限定两条已完成链：member approval→approval_grants→真实成功 grant/activation audit→tenant command outcome，或 FIRST control approval→terminal onboarding anchor→两条首次成员 audit→control outcome。后者只证明 manifest 中那个首次 admin grant，不推广为其他 grant 的批准。PRESERVE 在任一链上都须核对同 Tenant/User/member/grant、immutable grant facts 和本次当前资格/ceiling；仅有 operator refs、consent 或一个历史 eventId 不成立。

失效 consent/admission 不自动续期：User disable/restore 的 subject revision 变化、target revision 变化或 TTL 到期均拒绝。INVITE 已建立 PENDING 后，不凭第二个 INVITE 覆盖既有成员，也不重写 append-only consent 的版本/期限；本期不提供 pending 邀请续期/重新同意的旁路 producer。需要续邀/清理此类悬置 PENDING 时另行批准精确流程，不能借 restore/rejoin/FIRST 冒充。此限制是可用性边界，不放宽失效资格。

### C.3 精确对象 inventory 与共同存储规则（C8-S01 / S02 / S03）

拟新增 **10 tables、7 callable SECURITY DEFINER helpers、1 deferred read-only SECURITY DEFINER constraint function、2 SECURITY INVOKER trigger functions**。第七个 callable 是本次审阅补齐的 control-only Tenant restore guard，不是成员读取 API；详见 C.6/C.7。owner DML只包含新admission表有限INSERT与FIRST的三处旧表DML；旧表额外变化仅C.8 closed audit与C.9两个FIRST deferred constraint triggers，不新增其他旧表权限/Policy或改普通行为。没有通用 operation/JSON SQL dispatcher、SQL callback、新 role、startup DDL、sequence（new IDs 全部 server UUIDv7）或任意 function overload。

所有新 UUID/nullable UUID 经 is_uuid_v7；Instant 是 bigint 0..8640000000000000；revision 是正 signed int8 canonical decimal / BigInt only；authVersion 0..9007199254740991，与 epoch 分离。safe refs 为 COLLATE C ASCII `[A-Za-z0-9._:-]{1,128}`，safe digest 为 64 lowercase hex；TTL 配置 0 < ttl ≤ 86400000ms（24h），到 expires_at 边界拒绝、clock 回退拒绝。nullable 字段只允许下面列出的互斥分支，CHECK 用 `IS TRUE`，不能以 SQL NULL 放过。所有 FK ON DELETE RESTRICT；跨 tenant 引用用复合 FK，不凭两个独立 UUID 假定相同 Tenant。无 JSON 请求/结果/blob、无 secret fingerprint。

列类型按以下完整约定，不由BUILD随意选型：所有subject/actor/tenant/member/grant/approval/admission/consent/command/planned IDs均uuid；audit及*_event_id是positive bigint（不是UUID）；*_revision/*_auth_version与authorization_version是bigint；Instant时间列bigint；ordinal smallint；其余闭集/refs/key/digest/code/name均text（ASCII字段COLLATE C，displayName例外）。idempotency_key是safe ref text。action_version/delegation_version固定identity-v1，after_status严格按相应User/Tenant/Member闭集分支。manager approval action的精确五值为MEMBERSHIP_ACTIVATE、MEMBERSHIP_REACTIVATE、MEMBERSHIP_REJOIN、ROLE_GRANT、ROLE_REPLACE；表中ACTIVATE等是purpose/说明简称，不建立额外alias命令。tenant command action精确为旧九动作中除MEMBERSHIP_READ的八写动作，加MEMBERSHIP_PENDING_CREATE、MEMBERSHIP_CONSENT_RECORD、MEMBERSHIP_ATOMIC_TRANSFER，未知值拒绝。

REACTIVATE 的 mode 存储/typed intent 精确使用既有 Domain 两值 `PRESERVE_EXISTING_VALID_GRANTS` / `REPLACE_GRANTS`；下表 preserve/replace 仅说明简称，不建立第三种状态或依赖隐式大小写转换。closed reason 使用既有 IdentityAuditReason 白名单及对应 action allowlist，ACCOUNT_RECOVERY 标签不授权尚未批准的恢复流程。

#### C.3.1 六个 Tenant-owned tables（全部 ENABLE + FORCE RLS）

| Table | 精确字段组（未标 ? 为 NOT NULL）与主键/唯一约束 | 状态/关系约束 |
| --- | --- | --- |
| `identity_member_admissions` | `admission_id` PK；tenant_id、user_id、subject_user_revision、purpose、source_kind、control_approval_id UNIQUE、expected_member_revision?、expected_auth_version?、issued_at、expires_at、repository_revision DEFAULT 1 CHECK IN(1,2)；consumed_at?、membership_id?、command_id?、audit_event_id? | purpose={INVITE,REACTIVATE,REJOIN}；source_kind=OPERATOR_IMPORT；INVITE 未消费时 membership_id/expected member versions NULL，其他 purpose 指向已有成员与其当前版本；一次消费 revision 1→2，四 outcome 全部非 NULL，terminal；UNIQUE(tenant_id,admission_id)、UNIQUE(tenant_id,admission_id,user_id) |
| `identity_member_consents` | consent_id PK；tenant_id、user_id、subject_user_revision、purpose、admission_id?、membership_id?、control_approval_id?、expected_member_revision?、expected_auth_version?、manifest_digest、issued_at、expires_at、request_id、command_id、audit_event_id；UNIQUE(tenant_id,consent_id) | append-only；ordinary purpose={ACTIVATE,REACTIVATE,REJOIN}：admission/member/versions 非 NULL、control approval NULL；FIRST_TENANT_ADMIN：control approval 非 NULL、其余四字段 NULL，manifest 精确绑定预分配 member/grant IDs；本人 actor 与 event subject 一致；UNIQUE(tenant_id,admission_id)（NULL 分支不靠该唯一键去重），FIRST 分支 partial UNIQUE(control_approval_id) |
| `identity_member_approvals` | approval_id PK；tenant_id、command_id、target_ordinal、target_user_id、membership_id、action、mode?、expected_member_revision、expected_auth_version、approver_user_id、approver_membership_id、approver_member_revision、approver_auth_version、approver_user_revision、authority_grant_id、tenant_revision、catalog_digest、action_version、delegation_version、intent_digest、consent_id?、approved_at、consumed_at；UNIQUE(tenant_id,approval_id)、UNIQUE(tenant_id,command_id,target_ordinal) | append-only **完成的** manager approval，approved_at=consumed_at=锁内 mutation time，无 durable pending/approve-later endpoint；只支持 ACTIVATE/REACTIVATE/REJOIN/ROLE_GRANT/ROLE_REPLACE；consent 在前三种必填；mode 只 REACTIVATE，闭集 preserve/replace；批准与 state/audit/ledger 同次 commit |
| `identity_member_approval_grants` | tenant_id、approval_id、ordinal（0..15）、grant_id、grant_mode、role_code、scope_kind、scope_id?、created_at、valid_from、valid_until?；PK(tenant_id,approval_id,ordinal)，UNIQUE(tenant_id,approval_id,grant_id) | grant_mode={NEW,PRESERVE}；FK(tenant,approval)；role/scope 结构同既有集合、runtime 可用组合仍须 ceiling；NEW 使用 server ID/time，PRESERVE 保存原 immutable grant facts；与 actual role_grants 的匹配由 C.9 检查 |
| `identity_tenant_commands` | command_id PK；tenant_id、actor_user_id、actor_membership_id?、action、idempotency_key、intent_digest、request_id、completed_at、outcome_kind；UNIQUE(tenant_id,command_id)，UNIQUE(tenant_id,actor_user_id,action,idempotency_key) | append-only COMMITTED_SAFE_OUTCOME；action 闭集为 C.2 成员写动作，atomic transfer=MEMBERSHIP_ATOMIC_TRANSFER；actor_membership_id 仅本人 consent 可 NULL；outcome_kind={APPLIED,TRUE_NO_OP}，无 token/权限 snapshot/缓存 response |
| `identity_tenant_command_effects` | tenant_id、command_id、target_ordinal（0..1）、target_user_id、membership_id?、before_revision?、after_revision?、before_auth_version?、after_auth_version?、after_status?、admission_id?、consent_id?、approval_id?、audit_event_id?；PK(tenant_id,command_id,target_ordinal) | FK(tenant,command/member/admission/consent/approval)；仅 FIRST consent 的 member/全部 member versions/status NULL、consent/audit 非NULL；其他 member/after版本/status 非NULL；new PENDING 的 before 两字段 NULL、after=1/0；ordinary mutation after=before+1 且 authVersion+1；ordinary consent和 TRUE_NO_OP after=before；mutation audit 必填，TRUE_NO_OP 无新增 audit，consent 有自己的 audit |

Tenant/User FK 指向现有主体，(tenant_id,membership_id) 复用现有 memberships_tenant_id_unique；同 member 的 user_id 一致性由 C.9 校验，不新增旧 Membership identity 规则。consent 的普通 admission 必须已绑定同 member/User/purpose；FIRST 分支只关联特定 global approval，不能伪造普通成员 consent。source/consent 的 subject_user_revision 必须仍等于 locked current User revision，disable/restore 后旧记录不能成为本次同意/资格。INVITE source在邀请时消费，ACTIVATE使用其已绑定成员/consent不再次消费；REACTIVATE/REJOIN source在相应mutation时消费。scope_id 是未来 Class/Course locator 不冒充真实资源 FK；无 loader 则执行拒绝。

completion/command/effect/approval/audit之间的 FK 全部 DEFERRABLE INITIALLY DEFERRED（含 Tenant create→onboarding.created_command_id、consent→command），支持先写 state/audit再ledger且commit时完整闭合；主体User/Tenant存在性FK可即时。控制批准的未来 command_id 在登记时仅 UNIQUE locator，不能提前强制存在尚未执行的command；consumed后由C.9要求其真实outcome。所有明确多列 nullable FK 使用默认 MATCH SIMPLE，但 CHECK 强制规定的 all-null/all-non-null branch，不能用部分NULL绕过跨tenant引用。

admission 的非 INVITE 初始 membership_id 虽非 NULL，consumed_at/command/audit 仍全 NULL；INVITE 消费才设置 member。UPDATE guard 锁定全部 approval/source/TTL/身份，不允许更换既有 member 或从 terminal 回退。UNIQUE(tenant,user) 仍由原 memberships 唯一键解决，重复 invite 不能 silently overwrite、绑定别人的已有 member 或重开 LEFT。

#### C.3.2 四个 global control tables（不使用 tenant RLS）

| Table | 精确字段与唯一键 | 闭集与结果 |
| --- | --- | --- |
| `identity_control_approvals` | approval_id PK；purpose、environment_ref、approval_ref UNIQUE、operator_ref、approver_ref、operator_user_id、expected_operator_user_revision、system_admin_grant_id、expected_admin_grant_revision、command_id UNIQUE、manifest_digest、catalog_digest、action_version、delegation_version、target_user_id?、tenant_id?、planned_user_id?、planned_tenant_id?、expected_user_revision?、expected_tenant_revision?、target_membership_id?、expected_member_revision?、expected_auth_version?、planned_membership_id?、planned_grant_id?、valid_until?、tenant_code?、tenant_display_name?、admission_purpose?、issued_at、expires_at；consumed_at? | purpose={USER_CREATE,USER_DISABLE,USER_RESTORE,TENANT_CREATE,TENANT_DISABLE,TENANT_RESTORE,MEMBER_ADMISSION,FIRST_TENANT_ADMIN}；完整 manifest 字段与 purpose 的 NULL/required shape；operator_ref≠approver_ref；immutable + consumed NULL→time 一次；User/Tenant CREATE 使用planned locator、actual target/expected revision NULL，其他要求actual当前主体/版本；无 raw 身份核验附件 |
| `identity_control_commands` | command_id PK；actor_user_id、action、idempotency_key、intent_digest、approval_id UNIQUE、request_id、completed_at、outcome_kind；UNIQUE(actor_user_id,action,idempotency_key) | action 对应八个 purpose（FIRST_TENANT_ADMIN 为完成动作）；outcome_kind={APPLIED,TRUE_NO_OP}；全局 control-safe ledger，无 tenant 教学权限或 bearer outcome |
| `identity_control_command_effects` | command_id PK/FK；target_kind、target_user_id?、tenant_id?、membership_id?、grant_id?、admission_id?、before_revision?、after_revision?、after_auth_version?、after_status?、audit_event_id?、additional_audit_event_id? | target_kind={USER,TENANT,ADMISSION,FIRST_TENANT_ADMIN}；相应互斥字段；state mutation audit 必填；ADMISSION 只登记资格不伪造成员 mutation event；FIRST 保存 PENDING 与 ACTIVE 两个 event FK、member revision=2/authVersion=1；其他 additional audit NULL |
| `identity_tenant_onboarding` | tenant_id PK/FK；repository_revision、created_command_id UNIQUE/FK、completed_at?、approval_id? UNIQUE/FK、command_id? UNIQUE/FK、consent_id?、user_id?、membership_id?、grant_id?、pending_event_id?、activation_event_id? | 新 Tenant create 同 C 插入 EMPTY anchor revision=1，完成 revision=2 +全部 outcome 非 NULL，terminal；没有 anchor 的旧 Tenant=NOT_ELIGIBLE，不 migration 回填 EMPTY；consent 通过(tenant,consent) FK，member 通过(tenant,member) FK |

control approval 中 MEMBER_ADMISSION 必须同时指定现有 target User/Tenant、对应正 revisions、admission_purpose；其中 INVITE 无已有target member/versions，REACTIVATE/REJOIN 三字段必须明确绑定。FIRST 必须同时指定 User/Tenant、正 revisions、new member/grant IDs、approved admin validity/catalog，无已有target member。USER_DISABLE/RESTORE 只 actual User；TENANT_DISABLE/RESTORE 只 actual Tenant；TENANT_CREATE 只有planned_tenant_id/code/displayName，USER_CREATE 只有planned_user_id。actual target fields有主体FK，planned_*仅UUIDv7 locator，不FK指向尚未创建的行；消费后C.9要求outcome确实创建这些IDs。tenant_code 同旧 regex，displayName 是有界非空文本（adapter 上限 256 UTF-8 bytes），不能装正文/备注；disabled reason 使用有限安全 code，不存任意输入。

new command/approval/consent/admission IDs 使用 8B issuer；SessionId 仍既有 CSPRNG，不把 UUID 当 token。control first User create 不生成默认密码，也不扩展 0008 FIRST_PASSWORD capability 到任意 User；一般 User 凭据 provisioning 与 recovery 仍独立批准，未配置时该用户尚不能 login。

control审批补UNIQUE(tenant_id,approval_id,target_user_id)，Tenant admission及FIRST consent用三列FK绑定同Tenant/目标User的actual批准；User/Tenant CREATE planned locator分支不参与该FK。operator_user_id/actualtargetUser/actualTenant/SystemAdminGrant各有真实FK，target_membership用(tenant,member) FK；operator grant属于该User与其currentrevision由锁内检查+C.9核对。expected_operator_user_revision在登记、执行与确认均需current User匹配；global disable/restore后旧operator批准不能复用。

### C.4 幂等、版本与持久化批准原子性（C8-S03）

幂等 key 是 caller/server 提供的 bounded opaque nonce，不是认证凭据。相同 scope/actor/action/key 唯一；server commandId 与 requestId 分离。intent_digest=版本化 canonical **safe intent** SHA-256：action、Tenant/target IDs、mode、排序确定的 proposed role/scope/validity 或 preserve IDs、closed reason、admission/consent refs、approved catalog/action/delegation digests。只排序定义为集合的字段，不改变双目标操作语义。排除 passwords、raw/digest bearer、CSRF、step-up proof、IP/identifier、整包 body、unknown fields，以及 expected revisions（独立并发条件）；绝不对 secret hash 后塞入 ledger。

control intent 还必须包含该 closed purpose 的所有业务字段：actual/planned target IDs、Tenant code/displayName（CREATE）、admission purpose、FIRST planned member/grant IDs 与 validity、closed disable reason，以及 immutable approval ID/manifest digest。缺失/额外字段拒绝；不能让同 key 在 Tenant 名称、批准来源或授予对象改变后仍命中旧结果。manifest 自身按独立 operator store 的完整批准内容核验，其内绑定 expected versions；它在确认时保持原值，不能为重放重新签成另一份批准。

同 Tenant anchor 在读取/创建 command row 前序列化全部 tenant writers；不存在的 key 用 UNIQUE + INSERT 解决，不只 SELECT FOR UPDATE 空集。control 在既定 Tenant/User/Session/SystemAdmin 锁之后取得固定 transaction advisory capacity/key serialization point `zhiban-identity-control-commands`，所有 control command paths 同顺序，不能某入口提前取得此锁再等待 User/Tenant。作用是 command/capacity 并发，不是新的业务授权或跨池事务。pending 未提交的 INSERT 不可被另一请求当成功读取。

顺序必须：current Session/actor qualification → 当前 target 与 actor/global/catalog versions 的 expected 检查 → key/intent 比对 → state mutation 或安全确认。**stale-before-no-op**：原请求旧 expected revision 重放仍 STALE；不能因为 key 相同返回 success。响应丢失后可显式发送同 key/同 safe intent、但 expected versions 更新为保存 outcome 的当前版本，走安全确认。当前 target/status/grant facts 必须仍等于 outcome；任何后续变更（即使曾回到相同 status，但 revision 更大）拒绝。确认只报告最小 target state/revisions，无新的 mutation/audit/approval consume/grant ID；同 key 异 intent CONFLICT。权限撤销后不得借旧 key；恢复自己已失去管理资格的请求也不豁免 current qualification。

确认路径不重复执行原 transition 的 pre-state predicate（例如 target 已 ACTIVE，不能再要求 PENDING），但必须检查当前主体、原 action 的当前权限/ceiling、被确认 grants 当前有效、outcome versions/对象精确相等；ACTIVATE 等用于执行的 consent/approval 允许识别本 command 已消费记录，不再次消费。过期 operator ticket 不能执行或确认新的业务动作；API 后续只允许经当前授权的安全查询另取状态。数据库 audit、effect、approval/source consume 与 parent/history 任一失败，整笔 rollback；COMMIT status uncertain 不返回 APPLIED，由后续合法确认解决，绝不自动 retry。

确认时，immutable approval 中原 target expected versions 只与该 outcome 的 before versions 对照，不能要求已变化的当前 target 仍等于旧 pre-state，也不能更新 approval；请求的新 expected versions 必须等于 outcome after 和当前行。未变化的 actor/global/catalog 条件仍须当前匹配。FIRST 确认核对已完成 anchor/精确产物，不重新要求 EMPTY；具体读路径采用 C.6.1 的既有 FIRST lock helper terminal-state 分支，不授 C direct Membership/RoleGrant SELECT。Tenant restore 确认仍须当前完整有效管理员 guard。未消费 approval 永远不能走这种确认例外。

最小永久 command identity/outcome 与 consumed source 保留以阻止过期 key 再用；expires_at 只控制执行，不代表删除后 key 可复用。本期不提供 runtime DELETE/prune command/approval/consent，也不存附件。每 Tenant 的记录总上限及 control 总上限为**批准的配置**，缺失关闭入口；在 Tenant anchor / control serialization point 内 bounded `LIMIT cap+1` 检查与提交，达到容量 fail closed。无需猜测生产上限；运维压缩/归档保留永久去重 tombstone 的方案另审，不能为了可用性清 ledger。HTTP/IP 非 KDF 写预算留 8D；现有 REAUTHENTICATE budget 必须在 KDF 前使用。

### C.5 Session 与 recent re-auth 在写事务中的复核（C8-S04）

不向 Application 导出 digest、SessionRecord、credential revision/verifier 或 PG client。8C 新桥接使用同一 8B security 实例私有 handle registry；普通复制 `{kind:'AUTHENTICATED_REQUEST'}`/proof DTO 不能调用。可增职责专一的 opaque RecentReauthentication handle，私有 WeakMap 绑定 requestId、server commandId、closed action、完整 target set、safe intent digest、Session binding、User revision、slot revision、epoch 与验证时间；不是跨请求可重用 receipt。typed BUILD 名称可调整，职责/不可伪造 registry 不能变。

认证准备阶段只在 auth pool 使用既有 verification snapshot/Argon2 校验；先独立短事务申请 REAUTHENTICATE 预算，随后无业务 locks 执行 KDF。只有 exact true 可生成 request-local proof；provider/error/unknown/dummy/wrong 无 proof。读取 snapshot 后密码改变等竞争由 locked freshness 拒绝。以认证准备的 DB clock timestamp 标记 proof 起点（在 KDF 前取值，不能以最后长等待完成时刷新），另用 monotonic timer 检测进程内回退/超过 5min；进入和结束写事务均核验 0≤DB now−proof_at<300000ms。没有持久化 password/proof/cache，不新增 re-auth token table。

现有CredentialVerificationSnapshot只有credential id/revision/epoch/verifier，不含User revision。因此proof准备先在独立短auth transaction用既有identity_auth_user_anchor取private User revision和DB clock，释放该client，再调用既有Credential snapshot、进行KDF；不能假定不存在的snapshot字段或扩宽其普通Port。两个读取之间的竞争只会导致final绑定失配拒绝，不拿KDF后的新User版本追认旧proof。

command identity也须精确：新命令server发行UUIDv7；重复key可在KDF前仅内部读取scope/真实actor/action/key对应的已存commandId hint，或control manifest预分配ID，然后proof绑定该ID。hint不返回HTTP、不作为资格或成功证明，锁内重读并核对UUID/key/intent/expected版本；另一个并发命令在准备之后占据该key且commandId不同，则拒绝、不换绑proof或自动retry。下一次独立请求才可生成与既存command匹配的新proof并走安全确认。

拟唯一新增 step-up SQL helper：

```text
identity_session_step_up_guard(
  p_digest text, p_expected_user_id uuid, p_expected_user_revision bigint,
  p_expected_slot_revision bigint, p_expected_epoch bigint, p_proof_at bigint
) RETURNS boolean
EXECUTE: zhiban_runtime, zhiban_control_runtime only
```

这是**freshness comparator，不是密码验证器或独立授权证据**。p_expected_* / p_proof_at 只能由已签发的私有 proof 提供，不能来自客户端、Application 传入的 approved boolean 或 Session.touch/createdAt；能直接使用 trusted runtime DB 凭据的代码仍是信任边界，SQL helper 本身无法证明 KDF 执行。正式 command facade 不暴露可跳过 proof 的 SQL 方法，call-site/forged-handle tests 必须证明。helper 只调用冻结五列 session_guard、在同 client 已持有的 slot SHARE 下比较 revision/epoch/User revision、读取 DB clock 做时间检查，匹配返回 true，不匹配统一 42501；不返回 slot revision/SessionId/verifier、不写业务数据、不改旧 guard 五列或 tenant/control secret ACL。

Tenant command 先 Tenant anchor→完整 sorted Users SHARE（含 actor）→existing session guard：shared `zhiban-session-user:<UserId>` barrier→slot SHARE→Session SHARE；然后新 step-up guard。需要密码的命令才调用 comparator。control target User 若需 UPDATE 必须在 sorted Users 阶段直接取 UPDATE，不能先 SHARE 后升级；self User disable/restore 首版关闭。tenant/control 不在持锁事务里连接 auth pool、做 KDF/外部网络；proof 只做跨池准备，state/audit/ledger 只在一个最终 business client。

规划任何User锁前，wrapper先以scoped immutable actor Membership identity核对 user_id=private authenticated handle User；control则先核对immutable manifest operator_user_id=handle User。错误actor locator立即拒绝，不先锁别人的User再让session_guard额外取得未排序的真正actor锁；锁后仍核对全部映射/当前state。既有0007 signature不变，这个preflight identity-match不是授权，无法跳过随后active chain/Session/Permission checks。first lock helper的approval hint同样不能隐含替换真实actor。

在 state/history + audit + source/provenance + ledger 写完后，**同 client 再调用 session_guard / step-up comparator**，取 fresh clock 重查 actor authority validity、consent/operator approval expiry、ceiling 和完整 post-state operational admin count，再 checked COMMIT。不把入口 authenticate/me/CSRF 的成功当以后写许可。任何 storage failure、malformed guard result、expiry、User revision变化、missing/changed epoch、Session revoke/rotation、grant/tenant/catalog失效均 rollback，closed error 不带 material/cause/SQLSTATE。

这些 locks 把其他 User/credential/session writers 序列化到本 transaction 前或后；Session revoke/rotation 在 Session SHARE 后等到 commit；logout-all 的 exclusive advisory barrier 与 shared guard 冲突；credential writer 等 slot SHARE；User disable UPDATE 等 User SHARE。若其他 writer 先胜，本命令 fresh read 拒绝。期限不被锁冻结，最后 clock check 是明确检查点，不承诺操作系统调度后的无限期 validity。tenant 命令不改变 actor 认证状态，可 final live check；8B 本人换密码/logout 的 expected-post-state special handling 完全保留，不套用此 helper 让其合法失效后永远 rollback。

### C.6 七个 callable helper 的精确边界（C8-S04 / S05 / S07）

均 owner=`zhiban_identity_owner` NOLOGIN，LANGUAGE plpgsql、SECURITY DEFINER、VOLATILE、PARALLEL UNSAFE、fixed `search_path=pg_catalog,zhiban_identity,pg_temp`、row_security=on。显式 session_user 检查；REVOKE ALL FROM PUBLIC/all runtime，再仅 GRANT 下列 exact signature；不得通过给 auth EXECUTE 旧 Session guard 改 B8 契约。无动态 SQL、DDL、set role、外部连接、caller p_now、事务控制或任意 JSON operation。参数 NULL/UUID/array bounds fail closed；错误固定安全文本，关 SQL parameter/error tracing。

| 新 callable（exact 参数类型） | EXECUTE / 固定返回 | 作用与不可扩展点 |
| --- | --- | --- |
| `identity_session_step_up_guard(text,uuid,bigint,bigint,bigint,bigint)` | tenant/control；boolean true only | C.5 的 private proof freshness；无业务 DML/secret 输出 |
| `identity_member_admission_state(uuid,uuid,uuid)` | tenant；八列与 0007 authorization_state 同名同类型 | 参数 Tenant、actor Membership、admission；Tenant UPDATE 后从 immutable admission hint 得 target User，汇总 actor/admin roster/已有 target（若恢复）+admitted User，≤256 sorted Users SHARE；只本 Tenant facts；新增 fact_kind=ADMISSION_USER，未创建 member 时 membership_id=NULL；不放宽旧 0007 modes |
| `identity_member_consent_context(text,uuid,uuid,uuid,uuid)` | tenant；membership_id uuid?、member_revision bigint?、auth_version bigint?、purpose text、expires_at bigint | digest、expected self User、Tenant、admission?、control approval?（两者 exactly one）；Tenant UPDATE→self User SHARE→existing session_guard→对应 source/已有 member scoped SELECT；outer T随后以既有T UPDATE ACL锁定ordinary member并重读；只该 Session User 的资格，返回普通/first consent 五个安全事实；不是 User/Tenant list，不产生 grant |
| `identity_member_admission_register(text,uuid,uuid,uuid)` | control；admission_id uuid | digest、actor User、control approval、admission ID；未消费批准沿原精确 MEMBER_ADMISSION producer INSERT；已消费批准仅按 C.14 只读复核原成功链和仍未消费的原 admission。保留 Tenant/sortedUsers/Session/approval/current SystemAdmin 锁与资格；不消费 approval/写 member/grant/audit，不扩 signature/返回/ACL |
| `identity_tenant_restore_guard(uuid,uuid)` | control only；void | 参数 Tenant、private authenticated actor User；Tenant UPDATE→完整 admin roster + actor 的 ≤256 sorted Users SHARE→fresh DB clock；按 C.7 重查 governance/operational counts 均≥1。仅 scoped 读取与锁，无成员/grant输出或业务 DML；不新增旧 authorization_state mode 或给 C 其 EXECUTE |
| `identity_first_tenant_admin_lock(uuid,uuid)` | control；void | Tenant、FIRST approval；Tenant UPDATE→sorted actor/target Users SHARE→anchor UPDATE 后从实际 anchor 分支：revision1 EMPTY 沿原首次建立条件；revision2 terminal 仅按 C.6.1 严格复核原成功链及当前精确产物。两分支均无业务 DML、无成员/grant输出；不得以 current admin count=0 当 empty；不扩 signature/EXECUTE/table ACL |
| `identity_first_tenant_admin_apply(uuid,uuid,uuid,bigint)` | control；membership_id uuid、member_revision bigint、authorization_version bigint、grant_id uuid | Tenant、FIRST approval、consent、locked approved time；C.7 固定首次 PENDING→ACTIVE + TENANT_ADMIN/TENANT，不收任意 role/scope/SQL；安全投影，不自己 commit，审计/ledger/anchor terminalization留 outer same-client C |

admission_state 在 Tenant 锁后先无锁读取 immutable source/roster 做锁集合规划，随后 sorted Users，再由 wrapper 验证 actor Session、锁 parents/source 并重读；hint 不是 approval，source expiry/consume/version 与 unique tenant/user 必须在写前重查。返回数据仍不能由客户端决定 actor/relationship/permission。consent_context 的 expected User 同样必须来自 private handle，不信 caller 自报；scope/版本/expiry 错误统一拒绝，不从 unknown IDs 返回全局存在性。

first apply 中 p_at 是 outer 的同 client DB clock 结果，函数另读 clock，检查不在未来/不回退/仍在全部有效期；不是客户端业务时间。apply 重新确认空 history/anchor、target ACTIVE、完整 manifest、consent 与 actor current Session/control eligibility（通过 outer 已建立并持有的 locks）；固定 IDs/validity来自 immutable FIRST approval，无普通 actor Membership receipt。helper不能单独被视为 Application授权，outer步骤由 closed facade enforce，并由 C.9 deferred consistency 拒绝孤立 partial write。

#### C.6.1 FIRST lock 的 EMPTY / terminal-state 分支（最小批准补充）

本补充只闭合 C.4 已冻结的 FIRST 安全确认读路径。沿用 `identity_first_tenant_admin_lock(p_tenant_id uuid,p_approval_id uuid) RETURNS void`：owner、SECURITY DEFINER/INVOKER 边界、固定 search_path/row_security、control-only EXECUTE 与固定安全错误完全不变。无新 callable、参数/mode、table ACL、RLS policy、owner UPDATE policy、sequence privilege 或新增输出。仍为 C8-S08 的 10表/7callables/3triggerfunctions/25policies/22triggers/5secondaryindexes；C 不获得 direct Membership/RoleGrant SELECT。terminal-state 是只读复核能力，不是恢复或第二次 FIRST 建立能力。

**分支与锁序。** wrapper 在任何 User 锁前先核对 immutable manifest 的 operator_user_id 等于 private authenticated handle User，hint 不可替换真实 actor。helper 沿 Tenant UPDATE→匹配 Tenant/approval 的 immutable FIRST hint→完整去重并排序的 operator/target Users SHARE→onboarding anchor UPDATE；随后重读实际 anchor 与批准链，再决定分支。不得由客户端 status/boolean/GUC、旧 receipt 或只看 anchor 的缓存决定。helper 自行建立 validated Tenant LOCAL context 并在成功/异常时恢复；所有查询显式绑定 Tenant/User/approval/command，不能靠 owner OR policies 或 caller GUC 扩大读取。Member、grant、append-only consent/command/effect/audit 只 scoped SELECT，不取 FOR SHARE/UPDATE；其成员写竞争由已有 Tenant serialization anchor 排序，不为行锁增授 owner UPDATE。

- revision1、完整 EMPTY anchor：保留原 ACTIVE Tenant/initial expected revision、未消费匹配 FIRST approval、全部 Tenant Membership/RoleGrant history 为空、目标 User ACTIVE 等首次建立条件；不以有效管理员 count=0 替代空历史。
- revision2、完整 terminal anchor：仅允许下列全部条件成立的原成功结果复核。只 SELECT、必要 anchor/User/Tenant locks 和 LOCAL context 设置/恢复；无 INSERT/UPDATE/DELETE、nextval、新 ID、audit、approval/source 再消费、revision/authVersion 递增、anchor 重置或 grant 复活。
- anchor 缺失、其他 revision、NULL/部分 terminal fields、异 Tenant/approval、malformed chain 均统一 fail closed。合法 terminal helper 返回 void 也不批准动作、不代表 Session/step-up/SystemAdmin qualification 已通过。

**terminal 分支必须复核实际行，不以 terminal snapshot 代替 current facts：**

1. anchor 的 approval/command/consent/User/member/grant/两 audit FK 精确指向该 FIRST 成功链；immutable approval purpose=FIRST_TENANT_ADMIN，Tenant/target/operator、planned member/grant IDs、validity 与 catalog/action/delegation/manifest 绑定一致。operator 与 target 不同，独立审批来源及本人 consent 规则不变。
2. actual control command 的 actor/action/approval/command binding 一致，outcome=APPLIED；其唯一 FIRST effect 对应同 Tenant/User/member/grant，after member revision=2、authVersion=1、status=ACTIVE，两 audit IDs 与 anchor 相同。无额外/错误 effect，consumed approval/anchor/command completion 时间按原成功链一致；原 immutable expected fields 不更新或重签。原 Tenant/两 User 的未变化 expected revisions 与当前 ACTIVE 行仍相符，disable 后 restore 的更高 revision 不被同 status 掩盖。
3. actual FIRST consent 匹配 approval/Tenant/target User/manifest digest/subject User revision，且有真实本人 command/audit provenance。检查首次完成时批准/consent有效及其消费关系；识别本 command 已消费事实，不重新要求 unconsumed/EMPTY。仍执行 C.4/C.5 规定的确认时效及当前 consent/operator approval expiry 检查，terminal 分支不续期或豁免有效期。
4. 两条 actual audit 行的 FK、TENANT scope、Tenant/User/member、SERVICE `identity_tenant_onboarding`、发生时间/request binding 与闭集 payload 正确；PENDING_CREATED before=NULL/after=0，ACTIVATED before=0/after=1、批准的初始 grant facts 匹配。consent audit 仍 USER=target、FIRST purpose、member/both authVersions=NULL。不能仅凭相同数字 event ID 或任意 SERVICE 事件假定 provenance 成立。
5. **当前** member 精确为该 Tenant/User/member、ACTIVE、repository revision=2、authorizationVersion=1，created/updated timestamps 与原完成时间一致且无 disabled metadata；**当前** initial grant 精确为该 grant ID/member/Tenant、ordinal=0、TENANT_ADMIN/TENANT/null scope ID，createdAt=validFrom=原完成时间、validUntil=原批准值、revokedAt=NULL，fresh DB clock 下仍有效。该 member 的 grant/history 集合仍恰为原初始 singleton；新增 grant/history 也拒绝旧结果确认，不能拼接其他 grant 凑当前管理员资格。

任何后续 member version/status/authVersion 变化（即使再回 ACTIVE）、grant revoke/expiry/future/字段变化/新增历史、User/Tenant disable-restore version 漂移、缺失/损坏或异主体 provenance 均 DENY；这不是禁止合法后续 mutation 的新数据库 invariant，只是在确认旧 command 时拒绝。**其他成员**后来合法加入不要求整个 Tenant 再为空：terminal 仅复核原目标及成功链，不能把 EMPTY 分支的全 Tenant 无历史条件复制过来。

**outer composition 与 apply 隔离。** helper 之后继续既有 actor Session/proof→SystemAdminGrant SHARE→control serialization→approval/key 锁序，保留 C.4 的 stale-before-no-op、same actor/action/key/command/safe intent、请求 expected=current/outcome after、原批准 expected 对原 before、current catalog/qualification 等检查。最终同 client 再调用 FIRST lock terminal 分支及 Session/step-up guard，使用锁等待后 fresh DB clock 重查期限，再 checked COMMIT；有 ledger 不得跳过 entry/final 复核，helper 不输出历史/资源存在性供 DTO。新 FIRST 在同事务写齐 audit/effect/ledger/approval consumption/terminal anchor 后，也可用该 terminal 分支完成 final 复核；缺任何产物拒绝并 rollback，不自动 retry。

`identity_first_tenant_admin_apply` 必须在任何 DML 前重新要求 **revision1 EMPTY anchor、未消费匹配 approval、全 Tenant 空 member/grant history** 及原全部建立条件。调用 lock helper 成功不能替代这项检查；terminal void success 后 apply 必须拒绝第二次建立。三项原 owner DML shape 与 C.9 isolated-partial-write deferred constraints 原样保留，不能因为确认路径放宽消费、写入或重开 anchor。所有失败仍安全闭集，无 DB details、secret 或 provenance 输出；上述是待 BUILD/真实 PG16 证明的契约，不是已实现声明。

restore guard 显式覆写/恢复 validated Tenant LOCAL context，复用 0007 已有 owner scoped SELECT policies；不需新 owner UPDATE policy，对 member/grant 只 SELECT，不取 FOR SHARE/UPDATE。普通成员 writers 被 Tenant anchor 序列化，global User writers 被 sorted Users SHARE 阻挡；锁集合按所有 ACTIVE membership 的未撤销 TENANT_ADMIN candidate 规划（包括最终计数前的 future/expired candidate），超 256 完整拒绝。仅允许 Tenant DISABLED（执行）或 ACTIVE（final/安全确认），ARCHIVED/malformed/empty/expired/future/revoked/disabled-member/admin-User-disabled 均不能凑数。governance 计数沿 1B-7；operational 计数另要求 User ACTIVE、TENANT scope 及当前已批准 identity-v1 TENANT_ADMIN 的管理 permissions。RoleCatalog 在 outer entry/final 与 approval 的 digest/版本精确核验，缺条目/漂移拒绝；SQL count 条件须测试与已冻结 Domain 双计数等价。此 boolean-free void helper 不批准 control action，必须随后通过 Session/proof、SystemAdminGrant、purpose/expected versions，再在提交前重调用。

### C.7 控制面命令、首次管理员与 ACL/RLS（C8-S05 / S07）

control 操作还需 current SystemAdminGrant + approved allowlist/purpose + step-up；SystemAdmin eligibility 不自动批准任何动作。operator evidence store 是独立不可变 manifest 核验器，须核验环境、双人批准来源/职责、命令、目标、版本/有效期及 catalog/action/delegation digest；signature/登记附件由批准的 server store 保管，DB只存安全 refs/digest。缺配置/证据关闭入口，HTTP/argv/fixture/store返回 claimed approved 值不是 proof。不借 SERVICE audit 证明批准。

批准登记与执行明确分步：control 在同样 Tenant/User/Session/SystemAdmin/proof 锁序下验证并 INSERT immutable approval；这一登记不改变 Identity state、没有伪造成功 mutation audit。approval_id/approval_ref/commandId 唯一，重复登记先 fresh qualification/expected版本、再逐字段比对，不改 expiry/target；登记容量也在同 control serialization point 检查。FIRST 登记后本人用 tenant consent_context确认 manifest；最后 control 完成 onboarding。跨这三个请求不声称一笔 ACID，失去批准/consent/期限则不执行，不补偿删除历史；最终首次成员建立本身是单笔 C。

Control Tenant create/disable/restore：existing/new Tenant anchor（new ID uniqueness）→sorted actor User SHARE→Session/proof→SystemAdminGrant SHARE→control serialization point→approval/key→Tenant CAS/audit/ledger。Tenant create 同 client 插 EMPTY onboarding anchor；Tenant restore 不恢复 grants/members/旧 Session，不允许 ARCHIVED restore。Control User disable/restore：不取得任意 Tenant lock；按 UserId 排序，actor SHARE、target直接 UPDATE→actor Session/proof→actor SystemAdminGrant SHARE→serialization→approval/key→UserCAS/audit/ledger；0006 自带 target session revocation/barrier 必须照用，无手工替代。控制 actor=target 的 disable/restore默认拒绝，避免借本命令撤自己认证绕过 final guard。紧急 global disable 不被 last-admin Policy阻止，可能使 Tenant operational count=0，只记录安全运营告警/恢复责任，不默许恢复或悄悄授新 grant。

Tenant RESTORE 对上述锁序的精确补充是：首个 Tenant 锁后由 restore guard 规划并锁定完整 admin User roster（含实际 actor），而非只锁 actor；然后才 Session/proof/SystemAdmin/control serialization/approval/key。入口与 final guard 都要求当前双计数成立，否则即使 SystemAdmin/operator 批准有效也 DENY；不把恢复 Tenant 当无管理员 recovery。CREATE 的 EMPTY bootstrap 是独立 one-time 协议，不套 restore，DISABLE 的安全停用不被零管理员阻止。未完成 onboarding 的 Tenant 若被停用且仍无有效管理员，本期 restore/FIRST 均不得绕过 ACTIVE/管理员条件，后续处理另行批准。guard 不增加 C 的 direct Membership/grant SELECT，不输出其他 Tenant/成员/权限事实。

FIRST_TENANT_ADMIN 的**首次建立 mutation**仅针对 **8C 新 Tenant create 的 EMPTY anchor**。旧 Tenant 无 anchor、有任何 membership/grant history、已完成后所有管理员过期/离开，都不 eligible 再建立。锁序：Tenant UPDATE→immutable FIRST hint确定 sorted actor/target Users SHARE +EMPTY anchor→actor Session/proof→SystemAdminGrant SHARE→serialization→approval UPDATE + append-only consent SELECT→fresh资格/时间/empty-history→固定 apply→两条 tenant audit→control outcome/approval consumed/anchor revision2→final guard/time→COMMIT。同 command 丢响应后的安全确认采用 C.6.1 terminal-state 只读分支，不属于第二次建立，不套 EMPTY pre-state，也不豁免 current qualification/version/validity。target User 与执行 operator User 不同；具名独立审批者不得是 target 的自批准。本人 consent 不能由operator代签。

control Tenant-related wrapper在首个Tenant锁确定后，以validated manifest的TenantId设置并finally恢复 LOCAL app.tenant_id；第一Tenantapply/register ownerhelper也自行覆写/恢复其内部上下文，不能只依赖调用者。普通control User命令不设置Tenant或获取Tenant锁。新增 C EXECUTE `current_tenant_id()` 仅供其限定FIRST audit policy的scope解析，函数仍是旧只读parser，不授任何Tenant授权；不能通过因permission denied而删掉policy条件解决。

FIRST 固定 create PENDING revision1/auth0、空 grant，再以 Domain-safe新 TENANT_ADMIN/TENANT grant 与批准 validity 激活为 revision2/auth1；新 member/grant IDs 来自 FIRST manifest，不改变旧 Domain状态机/普通 last-admin语义。没有 fake actor Membership、没有 SYSTEM_ADMIN RoleGrant、没有跨 Tenant教学权限。source批准消费/audit/ledger/anchor任何一步失败都回到完全未建立状态；exactly-one completion，second command不能重用已消费 anchor。no-admin recovery 与一般密码 provisioning/reset仍另审，不复用FIRST。

#### 新表精确 runtime ACL

下面 T=tenant runtime、C=control runtime、A=auth runtime。所有 new table 默认 REVOKE ALL FROM PUBLIC/T/C/A；以下未列操作禁止（含 DELETE/TRUNCATE/TRIGGER/REFERENCES、sequence privileges、新表 ALTER/ownership）。runtime 属性与 bootstrap-roles 不变。

| 对象 | T | C | A | owner / RLS |
| --- | --- | --- | --- | --- |
| member_admissions | SELECT；UPDATE(consumed_at,membership_id,command_id,audit_event_id,repository_revision) | 无 direct ACL，register helper only | NONE | FORCE RLS；T select/update 当前Tenant；owner SELECT 当前Tenant；owner INSERT 只 C helper 的匹配 MEMBER_ADMISSION/target/source 分支 |
| member_consents | SELECT, INSERT（C.3全部列） | 无 direct ACL | NONE | FORCE RLS；T select/insert 当前Tenant；owner SELECT 当前Tenant供FIRST/consistency；无 UPDATE/DELETE policy |
| member_approvals / approval_grants | SELECT, INSERT（C.3全部列） | NONE | NONE | FORCE RLS；T scoped select/insert；owner scoped SELECT；无 UPDATE/DELETE |
| tenant_commands / effects | SELECT, INSERT（C.3全部列） | NONE | NONE | FORCE RLS；T scoped select/insert；owner scoped SELECT；无 UPDATE/DELETE |
| control_approvals | NONE | SELECT, INSERT（除 consumed_at 外 C.3列），UPDATE(consumed_at) | NONE | global，无tenantRLS；owner读；consumed一次 guard |
| control_commands / effects | NONE | SELECT, INSERT（C.3全部列） | NONE | global，无tenantRLS；owner读，append-only |
| tenant_onboarding | NONE | SELECT, INSERT(tenant_id,repository_revision,created_command_id)，UPDATE(repository_revision,completed_at,approval_id,command_id,consent_id,user_id,membership_id,grant_id,pending_event_id,activation_event_id) | NONE | global control anchor；INSERT必须EMPTY，UPDATE必须完整terminal结果，禁止return EMPTY |

上述 table SELECT 只给 trusted scoped composition，用例对外只白名单结果；不表示 client 可以直接读取 Tenant整表或看到 operator refs/审批历史。RLS不验证 actor 权限，Client持有runtime DB凭据不在威胁模型的“不可信浏览器”边界内。

append-only consent/manager approval/command/effect仅普通 SELECT，不发 FOR UPDATE/SHARE，也不为取锁授 UPDATE；其稳定性来自不可UPDATE/DELETE与Tenant/control序列化。mutable admissions由T在guard之后以已获列UPDATE+当前Tenant UPDATE policy取锁；globalcontrolapproval/anchor由C取锁。owner只读helper对普通member/admission使用scoped SELECT，不需owner generic UPDATE policy；真正ordinary parent锁由T现有权限取得。PG16的row-lock SELECT也要求适用UPDATE policy，详见[CREATE POLICY](https://www.postgresql.org/docs/16/sql-createpolicy.html)；不能把SELECT-onlyACL设计写成不可执行的锁计划。

新RLS policy inventory固定25项：六Tenant表各`<table>_tenant_select`与`<table>_owner_select`（12）；除admissions外五表各`<table>_tenant_insert`（5）；admissions的`identity_member_admissions_tenant_update`及`identity_member_admissions_owner_insert`（2）；下文三个FIRST旧表policy（3）；C.8的`audit_identity_member_insert`、`audit_identity_onboarding_insert`、`audit_identity_member_provenance_owner_read`（3）。没有owner generic UPDATE/ALL policy、PUBLIC policy或更改旧ownerreadpolicies。row predicate按本节与C.8逐一展开，名字不能替代条件审查。

owner新 scoped SELECT policies只用于上述六表；所有 owner SELECT 查询再次显式 Tenant/User/approval/command predicates，旧0007/0008 owner Membership SELECT policies是 OR组合，不能借caller GUC误读。FIRST的三个旧表DML policies唯一为：`memberships_identity_onboarding_owner_insert`（PENDING空grants/rev1/auth0）、`memberships_identity_onboarding_owner_update`（同identity PENDING→ACTIVE/rev2/auth1）、`role_grants_identity_onboarding_owner_insert`（manifest grantId、TENANT_ADMIN/TENANT、validFrom=createdAt=approved time）。无 owner role_grants UPDATE/DELETE、generic Membership UPDATE、tenant教学读或普通 tenant跨域写。

这些 owner DML USING/WITH CHECK 必须限制 session_user=control、currentTenant=已锁Tenant、专用 LOCAL onboarding approval ID 关联真实 FIRST manifest/EMPTY anchor/target/consent，且全部 proposed row columns match；helper从验证过的approval重设 LOCAL tenant/approval context并finally恢复，不能沿用caller设置的context或授权boolean。Policy须查actualrecords，不仅 `current_setting(...)='true'`。runtime不能 SET ROLE owner/CREATE functions；GUC不是authorization proof。owner SELECT/INSERT交叉依赖只单向读 global approval/anchor 与 scopedconsent，避免RLS自递归；deferred检查相同关系。

Audit旧表精确例外见C.8；其他旧tableACL一律不变，尤其 tenant/control 无 credentials/credential_slots SELECT、无 Session digest SELECT；A无新Tenant表ACL，C无directmembers/rolegrants权限。新 helpers 不访问 password verifier 列，owner也不得通过输出绕过。角色安全图/schema CREATE/TEMP/PUBLIC execute检查保留。[PG16 RLS](https://www.postgresql.org/docs/16/ddl-rowsecurity.html) 与 [definer安全](https://www.postgresql.org/docs/16/sql-createfunction.html#SQL-CREATEFUNCTION-SECURITY) 是数据库机制依据，不替代本方案真实执行证据。

### C.8 Audit closed vocabulary 与 ID/ownership（C8-S06）

只新增 **MEMBERSHIP_PENDING_CREATED** 和 **MEMBERSHIP_CONSENT_RECORDED** 两个 closed events；本期不新增任意 authorization decision JSON。IDENTITY_AUTHORIZATION_DENIED 的公共 action/reason映射、容量/失败尝试audit在8D精确设计批准后才实现，旧Identity events及payload不扩展。所有成功mutation audit mandatory same-client；audit失败整笔rollback。

PENDING_CREATED：TENANT scope，subject User/Member 非NULL；before authorization version NULL（此前无member）、after=0；payload严格 `{}`。actor为邀请manager USER，FIRST路径SERVICE `identity_tenant_onboarding`。不能套旧 membershipFacts 的 strictly-increasing版本校验或冒用ACTIVATED。

CONSENT_RECORDED：TENANT scope、actor USER=subject User、payload exact `{purpose}`。ordinary目的={ACTIVATE,REACTIVATE,REJOIN}，subject Member非NULL、before=after=当前authVersion（consent不变更Domain资格）；FIRST_TENANT_ADMIN目的则 subject Member/bothversions均NULL（成员尚未建立）。source/consent/approvalID在provenance表关联，不塞payload。FIRST后来ACTIVATED仍用既有before0→after1事件。普通Role/Membershipmutation旧版本递增规则、prior/approvedgrantpayload完全保留。

0009只精确扩充 audit_events 的 event_type/ownership CHECK、audit_payload_valid 的两新type白名单；保留旧分支与拒绝extra/null的语义，不改 applied0003/0004。Application audit factory新增独立两种fact分支而非放松所有MembershipFacts；repository transaction-private writer采用有限switch，不把 support.audit 的 Record 变成通用bus。

T增加 **INSERT(event_id)** 唯一列ACL（已有sequence USAGE不变），沿8B nextval→正int8string→INSERT OVERRIDING SYSTEM VALUE，无SELECT/RETURNINGaudit；新增T audit INSERT policy仅这两type/currentTenant及以上actor/subjectshape。C只新增FIRST的tenant audit INSERT policy：SERVICE identity_tenant_onboarding，type仅PENDING_CREATED或ACTIVATED，currentTenant及精确approval/manifest/anchor/target/User/newMember均匹配；policy只查询C已有SELECT的global approval/anchor，不在C policy中读无权SELECT的tenant consent/member表，后者由ownerhelper/constraint显式核验。不授C generic tenant audit SELECT/INSERT；C只补C.7的只读current_tenant_id() EXECUTE。first consent由T本人写，C不伪造它。所有直接PUBLIC table/column/function/sequence访问仍DENIED。

owner audit新增 **SELECT** policy仅actual new command-effect/consent/onboarding FK引用的event，与精确type/scope/tenant/subject/actor匹配；原global0008provenancepolicy保持。无owner新auditINSERT/UPDATE/DELETE policy。FIRSTapply只有限member/grantDML，outer C以其上述有限audit权限写audit，deferred校验匹配；owner读auditevent用于一致性，不对runtime回传event row。

### C.9 Constraints / trigger inventory / indexes

唯一新 read-only definer `identity_membership_composition_consistency() RETURNS trigger`，PUBLIC/T/C/A无EXECUTE，只由 **DEFERRABLE INITIALLY DEFERRED** constraint triggers 调用：C.3十表各一条INSERT/UPDATE trigger，另在现有 memberships/role_grants各新增一条INSERT/UPDATE trigger（仅session_user=control的FIRST新ownerDML执行一致性分支；原T低层repository行为不变）。后两条是精确FIRST能力约束，不是改旧migration或普通Membership状态机。否则单独first_apply只改旧表、没有触发新ledger表的trigger，可能partial commit，不能仅凭outer代码宣称已堵住。

读取最终数据库行而非blind NEW snapshot，tenant表仅本行tenant；control row含Tenant时临时建立匹配LOCALctx并恢复。只 SELECT / context set+restore，不业务DML/自提交/动态SQL/返回provenance。逐FK集合有界（2 effects、16 grants），不能扫全数据库。只在创建/消费当前相关记录时核对初始state，不能每次未来无关更新重查已完成 old outcome仍current，否则会锁死合法后续mutation。FIRST旧表trigger从NEW.tenant_id定位actualanchor，要求本transaction最终有匹配consumedapproval/controloutcome/两audits/terminalanchor，不依赖已被helper恢复的GUC或存在任何旧成功command。

检查完整 command/effects/audit actor与subject/type/time/versions、admission registeredsubject/sourcepurpose、consent本人及purpose/target versions、approval current transaction target/approver/catalog/intent，grant NEW/PRESERVE与actual history；first初始Tenant+空anchor→完整ACTIVE/admin/audit/terminal结果。未配对的member/controleffect、额外effect/approval-grant、遗漏audit、单独helperpartialwrite、consumed source无command outcome全部commit拒绝。actualaudit_id有独立FK；不以同数字eventId假定就是该tenant/User/type。

两个新 INVOKER trigger functions：`identity_composition_append_only()`（consent/managerapproval+grants/两类commands+effects INSERT-only，所有UPDATE/DELETE失败）；`identity_composition_source_guard()`（admission、controlapproval、onboarding的精确一次terminal transition及immutable input，DELETE失败）。PUBLIC与runtime无显式EXECUTE；普通trigger调用，不允许手工运行。CHECK/FK/UNIQUE与triggers共同保证，单靠TypeScript品牌不是DB约束。

新trigger inventory固定：十新表各一条`<table>_immutable_guard`（7表用append_only的BEFORE UPDATE/DELETE，3source表用source_guard的BEFORE INSERT/UPDATE/DELETE），十新表各一条`<table>_consistency` deferred INSERT/UPDATE（10），旧表仅`memberships_identity_onboarding_consistency`和`role_grants_identity_onboarding_consistency` deferred INSERT/UPDATE（2），合计22条新triggers/3个新triggerfunctions。旧immutable/history/User-disable-Session triggers保留；不得因新功能删除或改名。FIRST控制old表触发分支必须在真实PG测试单独调用apply并COMMIT缺audit/ledger时失败。

索引按已知查询固定最小集合（PK/UNIQUE自动indexes不重复）：admissions(tenant_id,user_id,purpose,expires_at) partial unconsumed；consents(tenant_id,membership_id,purpose,issued_at) ordinary；approvals(tenant_id,membership_id,consumed_at)；approval_grants(tenant_id,grant_id)；control_approvals(purpose,tenant_id,target_user_id,expires_at) partial unconsumed。commands以其scope/actor/action/key唯一index查重；effects以command主键读，outcomeaudit核验使用原auditPK。不上线无依据全局搜索/listindex，不新grantsequence。

### C.10 BUILD 边界与同 client composition

未来BUILD位置沿 `application/identity/use-cases/**` / exact Ports、`infrastructure/identity/composition/**`、`postgres/repositories/**` 的 client-bound closed collaborators。复用 `loadMembershipOnClient`/`saveMembershipOnClient`、当前Policy/transition/history/lastAdmin逻辑；必要抽取private同client函数，但旧Port/public方法行为/事务/审计必须原样回归，不能把公开AuthorizationMutation.execute直接嵌套进另一个transaction或继续用独立AuditPort.append。新增 User/Tenant client-bound writer仍在repository terminal边界，不外放 privileged hydration、不改DH07 capability allowlist。

完整tenant mutation顺序固定：Tenant/完整sortedUsers（existing0007或newadmissionguard）→actor Session +step-up→sorted actor/targets parent UPDATE（直接最终mode，≤2targets）→fresh全部roster/history→sources/key locks→expectedversions→pre-state singlegrantauthorization/consent/freshapproval/ceiling→全部post-state lastadmin→parentCAS/history +audit +provenance/sourceconsume +ledger→finalSession/时间/authority/post-state→checkedCOMMIT。revoke true-no-op仍先stale/currentqualification；不能单靠 target“已经revoked”返回。Roster/User集合超过256完整拒绝，不截断count。control锁序按C.7，无通用带p_mode的User/Tenant查询器。

正式member/control entrypoints仅暴露这些closedfacades；低层repo不是批准入口，构建/架构测试检查facade不能绕过guard。Session仍User认证，不写role/tenant/permission snapshot；TenantContext仅scope；没有Course/Class实现或Client布尔relationship。safeDTO最多target IDs/status/revisions/authVersion、已批准的grant新增ID；不返回sourceoperatorrefs/完整grant历史/内部reason目录/DB error。公共HTTP normalization、CSRF/origin实际wiring、恢复/自注册/identifierUX/APIdecisionaudit/部署config均8D/8E另审。

### C.11 测试与验收门禁（设计计划，未执行）

未来 targeted unit/contracts + `pg16-membership-composition.test.ts` 加入现有workflow **two complete runs**，旧十个real suites与全部1091Identity回归保留；test count按实际执行汇总，不预设新suite数量冒充PASS。预期migration0001–0009 apply/secondNOOP/checksumdrift/rollback/advisory；0001–0008 Gitblob与ledgerchecksums保持。rootinventory/ACLallowlists精确增加本附录对象，不能通过删旧checks接通；package不需新provider。

| 验证组 | 必须证明 |
| --- | --- |
| Member paths / F05 | registeredsubject/admission/本人consent/currentmanager链；假source/consent、异Tenant/User/purpose、失权inviter、pending-origin历史、legacy无provenancepreserve、freshreplace/rejoin、revoked/expired/future拒绝 |
| Approval / key | immutablebinding、expiry/clockrollback、samekey异intent、expected旧version先stale、丢响应新expected安全确认、不重复audit/IDs/consume、权限撤销后拒绝、并发samekeyexactlyonce、后续更改不能重放旧outcome |
| Session-at-write | 初始authenticate成功后Session revoke/logout-all/rotation、credentialreplace/revoke/rehash、Userdisable+restore；两种先后顺序；entry与finalhelper都实际执行；forgedhandle/proof/跨command/target/age拒绝；KDF在锁外、outage/errorsecret-free |
| Member concurrency | two独立PGconnections+acknowledgedlockbarriers；双方invite同Userexactlyone；revoke/restore、两管理员双撤权、atomictransfer两目标任一步失败全部rollback；freshrecheck确在lockwait之后 |
| Control | currentSystemAdmin不是Tenantfallback；actionallowlist/independentoperator/evidence失败默认关闭；User/Tenant CAS+audit+ledger同client；globaldisable不复活Session、不改MembershipauthVersion；Tenantdisable/restore与成员写双向serialization；restore入口/final完整双计数、缺/过期/未来/停用管理员拒绝、read-only helper与Domain计数等价、C仍无directmember/grantSELECT |
| First Tenant mutation | 无anchor/已有任意history/terminal不eligible再建立；target本人consent/独立source/批准时限；并发onlyone；插member/grant/audit/source/ledger/COMMIT逐点faultrollback；isolatedhelperpartialcommit被constraint拒绝；terminal lock成功后apply仍在DML前拒绝；不是noadminrecovery |
| FIRST terminal confirmation | 丢响应同key/intent+当前expected确认，entry/final实际读原产物及批准链，无写入/nextval/新增audit/IDs/消费；member rev3/authVersion变化、停用/离开/再激活、grant撤销/过期/未来/额外history、User/Tenant disable-restore、损坏链/异Tenant/actor、stale/异intent/失效Session或ticket全部拒绝；其他成员合法加入不误套全Tenant空历史。独立PGconnections+acknowledged barriers证明成员writer先胜则拒绝、helper先锁Tenant则writer等待；锁等待后fresh read/time，无sleep-onlyrace，LOCALctx成功/异常均恢复，C direct member/grant SELECT仍拒绝 |
| ACL/RLS/parser | 真实restrictedsession_user而非ownerSETROLE；每newfunctionsignature/search_path/PUBLIC/temp/GUCspoof/overload；T/C无secretSELECT、A无newTenantaccess、C无directmemberDML、FIRSTowner仅三shape；PUBLIC表/列/function仍拒绝；六Tenant表FORCERLS、crossTenantFK与ownerOR过滤 |
| Records / regressions | invalid/null/extra/ID/timestamp/rev/epoch/manifestclosedshape failclosed；auditevent ownership两newtype边界且旧events unchanged；无secret/digest/prooffingerprint入Domain/DTO/ledger/audit/error；maxrevision/authversion failclosed；pool/localcontext/permitcleanup |

审阅补强的 targeted 负例必须纳入 BUILD：同 key 更改 control Tenant code/name/manifest/计划 IDs 拒绝；确认保留原批准且 original before/current after 两套版本正确分离；FIRST grant provenance 仅接受完整 terminal 成功链；失效 PENDING source/consent 不自动续期；restore 等锁后管理员 User 被停用/恢复或 grant 到期时 fresh reread/final check 拒绝。以上是测试计划，不是当前已运行结果。

所有criticalmutationfault测试断言 **真实持久化 state + revision + authVersion + history + source/approval consume + audit +ledger**，不可只断言mock回值/callcount。无sleep-onlyrace、secret/hashsnapshot、catch-and-pass/skip、降低Argon2params或删ACL检查。PG16无本地环境时不安装、不用PG18冒充，真实结果PENDING_CHECKPOINT；有真实assertion/SQL失败不自动rerun。lint0errors、root8GB命令级typecheck、diffcheck与existing regressions全部PASS且P0/P1=0才READY_FOR_8C_CI_CHECKPOINT。机制依据为[PG16 locks](https://www.postgresql.org/docs/16/explicit-locking.html)，本期文档不宣称生产/并发/parser已证明。

### C.12 逐项人工批准 / 当前交付状态 / 下一步模型

2026-10-03 用户明确要求：“审阅并批准八项契约”。审阅已对照冻结 A/B、1B-7 Policy/closeout 与实际 0007/0008、Membership、Session 私有 handle、audit/ACL、workflow；C8-S01–S08 均人工批准并冻结。批准包含本轮在原能力范围内的精确修正：补齐 Tenant restore 的控制面只读 guard（callable inventory 6→7，无成员直接 ACL 扩权）、control safe intent/确认版本映射、两条合法 grant provenance 链及失效 PENDING 的拒绝边界；没有新增第九项能力或开放恢复。八项均通过设计审阅，不代表任何新对象已经实现/通过 PG16。

| Item | 需要明确批准的精确能力 | 当前状态 |
| --- | --- | --- |
| C8-S01 | OPERATOR_IMPORT-only admission、本人分purpose consent、两Tenant source tables、pending/selfconsent两个helpers及其scopedownerread | HUMAN_APPROVED / FROZEN |
| C8-S02 | fresh inline manager approval两表、F05两条完整provenance链及legacypreserve failclosed、9动作原规则/单grant/ceiling不变 | HUMAN_APPROVED / FROZEN |
| C8-S03 | 两Tenant/两globalcommand tables、完整safeintent/expectedversion确认、永久去重与批准容量约束、control serialization point | HUMAN_APPROVED / FROZEN |
| C8-S04 | private request-bound step-up桥接、六参数只读comparator、同client入口与finalSessionguard、锁序/无secretACL扩权 | HUMAN_APPROVED / FROZEN |
| C8-S05 | controlapproval table/sourceproducer、User/Tenantclosed命令/allowlist、register helper有限owner admissionINSERT、control-only Tenant restore guard、globalstatecoordination | HUMAN_APPROVED / FROZEN |
| C8-S06 | 两newclosedauditevents及NULL/unchangedauthVersion精确例外、T event_idINSERT、C限定FIRSTtenantauditINSERT、ownerFKscopedread | HUMAN_APPROVED / FROZEN |
| C8-S07 | 新TenantEMPTYone-timeanchor、FIRST两个helpers、三旧表ownerDMLshape、目标本人consent、terminalfirstTenant与recovery分离 | HUMAN_APPROVED / FROZEN |
| C8-S08 | 0009 exactinventory（10表/7callables/3triggerfunctions/25policies/22triggers/5secondaryindexes）、旧0001–0008不变、rootinventory及现有workflow追加真实用例两轮测试 | HUMAN_APPROVED / FROZEN |

PRECISE_1B8C_SCHEMA_ACL_DESIGN: HUMAN_APPROVED / FROZEN

C8_S01_S08_HUMAN_APPROVAL: RECORDED_2026_10_03

DESIGN_REVIEW: PASS_WITH_LIMITED_DOC_FIXES

MEMBER_USE_CASES / APPROVAL_SOURCE / SAFE_IDEMPOTENCY / SESSION_AT_WRITE_BOUNDARY: SPECIFIED

SCHEMA_ACL_IMPLEMENTED_OR_REAL_PG16_PROVEN: NO

1B1_F05: DESIGN_SPECIFIED_IMPLEMENTATION_PENDING

FROZEN_CONTRACT_CONFLICT: NO_OBSERVED

P0: 0 (design review). P1: 0 (design review; restore read-path gap corrected in contract). P2: 0 (design review; future implementation/CI/config gates are not executed evidence).

DOC_FILES_MODIFIED: 1. PRODUCTION_TEST_WORKFLOW_MIGRATION_PACKAGE_FILES_MODIFIED: 0.

COMMIT: NO. PUSH: NO. CI_DISPATCH: NO.

READY_FOR_1B8C_DESIGN_CHECKPOINT: YES

READY_FOR_1B8C_BUILD: NO_PENDING_DOC_CHECKPOINT_REMOTE_VERIFICATION_AND_SEPARATE_BUILD_AUTHORIZATION

下一步：设计文档 checkpoint（GPT-6.1 Sol / Low，须单独授权）→独立 GitHub HEAD/message/parent核验（GPT-6.1 Sol / Low）→单独授权1B-8C BUILD/test/securityreview（GPT-6.1 Sol / High，NO COMMIT/PUSH/DISPATCH）→实现checkpoint（GPT-6.1 Sol / Low）→独立remote核验（GPT-6.1 Sol / Low）→独立授权新candidateCI签收（GPT-6.1 Sol / High）。任何一步不自动扩大为下一步授权。8D HTTP/8E恢复/生产配置责任仍另行批准。

### C.13 FIRST terminal-state 最小补充批准（后续状态，优先于 C.12 的历史交付记录）

2026-10-03 用户明确批准：“批准最小设计补充，为现有 FIRST lock helper 增加严格的 terminal-state 只读复核分支，不扩大表权限。”本次对 C8-S03 的安全确认与 C8-S07 的 FIRST helper 读路径作 C.6.1 精确补充；保留 EMPTY 建立、apply 写入条件、原七 helper inventory、全部 ACL/RLS 与 C8-S08 对象数量。已发现的 EMPTY-only helper 无法读取 terminal 当前产物的设计缺口在契约层闭合，不通过 C 的 direct SELECT 扩权解决。

本轮基线 HEAD=`c13bf115d9ad5af0eebf7e2046da9f98041cbcfa`，branch=`refactor/zhiban-v2`。开始时已有前轮 1B-8C BUILD 的 14 个未提交草稿文件；本轮只改本设计文档，草稿不编辑、不清理、不提交，生产/测试/migration/workflow 修改均为本轮 0。历史 C.12 的文档 checkpoint 及批准记录保留，本节不把已暂停的 BUILD 声明为完成或通过。

FIRST_TERMINAL_DESIGN_SUPPLEMENT: HUMAN_APPROVED / FROZEN

FIRST_TERMINAL_CONFIRMATION_CONTRACT: SPECIFIED

TABLE_ACL_RLS_AND_HELPER_INVENTORY: UNCHANGED

FROZEN_CONTRACT_GAP: RESOLVED_AT_DESIGN_LEVEL

IMPLEMENTATION_AND_TARGETED_TESTS: PENDING_RESUMED_BUILD

REAL_PG16_PROOF: PENDING_IMPLEMENTATION_CHECKPOINT_AND_SEPARATE_CI_AUTHORIZATION

DESIGN_REVIEW: PASS (minimal read branch; not implementation/security-test signoff)

DOC_FILES_MODIFIED_THIS_TURN: 1

PRODUCTION_TEST_MIGRATION_WORKFLOW_PACKAGE_FILES_MODIFIED_THIS_TURN: 0

COMMIT: NO. PUSH: NO. CI_DISPATCH: NO.

READY_FOR_1B8C_CI_CHECKPOINT: NO_BUILD_INCOMPLETE

下一步：单独授权恢复 **1B-8C BUILD（GPT-6.1 Sol / High）**，按本补充完成 helper/outer/apply 隔离、targeted unit/contracts、真实 PG16 测试计划、现有回归与安全自审，NO COMMIT/PUSH/CI DISPATCH。本次设计批准不自动继续实施；当前已有 BUILD 草稿，不能把整个 worktree 冒称为单文件 docs-only checkpoint。

### C.14 Admission 安全确认最小补充批准

2026-10-03 用户明确“批准”前轮提出的最小补充：现有 `identity_member_admission_register(text,uuid,uuid,uuid)` 增加严格只读确认分支，不增加 helper、overload、表/列权限或返回字段。C.4 安全确认需要当前 source 事实，而 control 无 Tenant admission SELECT；不能仅凭历史 ledger 成功，也不能换池、SET ROLE 或新增通用查询绕过同 client 边界。

分支必须来自锁内重读的实际 approval.consumed_at，而非客户端 mode。未消费批准维持原 producer 条件和唯一 INSERT；已消费批准仅接受同一个原 admission ID，并复核：原 MEMBER_ADMISSION approval、APPLIED control command、唯一 ADMISSION effect 的完整身份/manifest/时间/FK 链；原 admission 的全部 immutable fields 与 approval 精确相等，revision=1、未消费、command/audit=NULL；有效期、当前 ACTIVE Tenant/User 及其原未变化 revision、current SystemAdminGrant 仍匹配。INVITE 仍无该 Tenant/User 的 Membership；REACTIVATE/REJOIN 的原 Membership ID/revision/authVersion/status 仍精确匹配。source 已消费、已过期、目标历史/版本已变化、链不完整/错 Tenant/actor/ID 一律拒绝。C 的 independent store、catalog、Session、request expected versions 与 recent KDF proof 仍由 outer 在锁内 entry/final 核验，不以 helper UUID 输出充当授权。

terminal 分支不 INSERT/UPDATE/DELETE、不分配 ID/sequence、不消耗批准、不创建 audit，不检查新增记录容量；只返回已复核的原 admission UUID。同 client Tenant→sorted Users→Session→approval/SystemAdmin 的既定 locks 与 LOCAL context 恢复保留。outer 在同 key/intent/current expected 的确认路径读取原 effect admission ID，分别在确认入口和最后 fresh clock/Session/proof/current control qualification 后调用该 helper；任何复核失败整笔 rollback。若首次执行完成后 admission 随后被 invite/recovery 消费，旧登记成功不能再次被确认为“当前未变”。

保持 C8-S08 inventory：10 tables、7 callable helpers、1 non-callable definer、2 new invoker trigger functions、25 policies、22 triggers、5 secondary indexes；0001–0008、Identity/Credential/Session/Authorization 语义、未消费 producer 不变。仅现有未提交 0009 草稿实现本分支。测试须覆盖未变化确认成功、消费/过期/错链/变版本拒绝、entry/final 都执行、确认无写入/新 ID/audit/consume、独立连接锁等待后 fresh reread与 context cleanup；真实 PG16 仍待新 candidate CI，不把 static assertion 当 parser/runtime 证明。

ADMISSION_CONFIRMATION_SUPPLEMENT: HUMAN_APPROVED / FROZEN

READ_CAPABILITY_GAP: RESOLVED_AT_DESIGN_LEVEL

IMPLEMENTATION_AND_REAL_PG16_SIGNOFF: PENDING_BUILD_AND_CI

本轮继续已授权 1B-8C BUILD（GPT-6.1 Sol / High），NO COMMIT / NO PUSH / NO CI DISPATCH。下一步只有完整实现、回归和安全自审门禁满足后，才申请 implementation checkpoint（GPT-6.1 Sol / Low）；当前不宣称可 checkpoint。

### C.15 Resumed BUILD 本地交付记录（当前状态，优先于前述历史 pending 状态）

基线仍为 `refactor/zhiban-v2` / `c13bf115d9ad5af0eebf7e2046da9f98041cbcfa`。按已批准 C8-S01–S08、C.13 与 C.14 完成 protocol-neutral member/control composition、私有 Session/KDF step-up、source/consent/manager approval 分离、append-only command/effect/provenance、CAS 与原子 audit、FIRST/restore 精确 helper 及现有 root/workflow 接入。没有公共 HTTP adapter、恢复/自注册入口、配置默认批准或自动 retry。

当前 delta 为 38 个文件：18 production TypeScript、1 migration（`0009_identity_membership_composition.sql`）、17 tests/support、1 现有 workflow、1 本设计文档。0001–0008 的 Git blob 均与 HEAD 相同；Domain、Credential/Session production、安全 role bootstrap、package files 未改。旧 repository 的 public transaction/CAS contract 保留，仅提供同 client 内部 collaborators；opaque request/transport type 移至 sibling Port 并从原位置兼容 re-export。

本地验证：完整串行非 PG Identity 回归 **1187/1187 PASS**（原 1091 + 新增 96）；C8 targeted 四个 suite **96/96 PASS**，加 migration contract/runner 的六个 targeted suite **118/118 PASS**；root typecheck（仅命令进程 8GiB heap）PASS；root lint **0 errors / 20 existing warnings**；tracked 与 untracked 文件分别检查 whitespace，均 PASS。NODE_OPTIONS/GODEBUG 未持久化。未重写旧测试 assertion，旧 PG suites 只补 migration/definer inventory；原 workflow 命令全部保留。

High 自审在冻结契约内修正：planned CREATE locator 的 current-after CAS 确认；NEW grant 初次审批与 final existing-fact ceiling 复核的分离；consent 的实际短 TTL/final clock；closed record/array accessor 拒绝；安全确认逐字段复核 approved grant 与闭集 effect；fresh sanitized error 的 cause/custom detail 隔离；helper 在所有早期失败前捕获 LOCAL context；PUBLIC function catalog check 包含 NULL ACL 的默认 EXECUTE 语义。没有以 direct control SELECT、SET ROLE、扩充 helper inventory 或改变旧状态机解决问题。

新增 real PG16 member/control suite **50 项**，已追加到现有两轮 workflow：原 **206 项/轮** + 新 **50 项/轮**，预期 **256 项/轮 ×2**，最终以实际 CI logs 为准。涵盖 source/consent/approval、safe confirmation、stale/no-op、F05 provenance、leave/rejoin terminal history、control create/disable/restore、FIRST terminal/isolated apply、逐点 rollback、PUBLIC/role ACL、独立连接与 acknowledged lock barriers 的 invite/last-admin/FIRST races、secret-free records 及 cleanup。部分 malformed-state 负例使用仅限 disposable PG harness 的 privileged fixture writer，不代表 runtime 具备这些权限；生产 facade 并发另用 restricted runtime pools。

LOCAL_PG16: UNAVAILABLE（本机仅发现 PG18，未作为替代执行）。50 项仅收集并 SKIPPED，没有 PG16 parser/apply、ACL、trigger、concurrency 或 atomicity 的实际成功证据，不能将 static/unit 结果冒充数据库签收。

IMPLEMENTATION_LOCAL_BUILD: PASS

HIGH_SELF_REVIEW_KNOWN_P0: 0

HIGH_SELF_REVIEW_KNOWN_P1: 0

P2: 1 — real PG16 / Linux Node22 new-candidate signoff pending

REAL_PG16_SIGNOFF: PENDING_CHECKPOINT_AND_SEPARATE_CI_AUTHORIZATION

READY_FOR_1B8C_CI_CHECKPOINT: YES

PHASE_1B8C: NOT_YET_COMPLETE

COMMIT: NO. PUSH: NO. CI_DISPATCH: NO.

下一步须单独授权：**1B-8C 精确范围 implementation checkpoint（GPT-6.1 Sol / Low）** → 独立 GitHub HEAD/message/parent 核验（GPT-6.1 Sol / Low）→ 新 candidate CI 两轮签收及完整回归证据审阅（GPT-6.1 Sol / High）。本轮不自动执行上述任何一步；1B-8D HTTP/API 尚未授权。
