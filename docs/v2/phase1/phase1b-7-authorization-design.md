# Phase 1B-7A Authorization Design / Security Contract

STATUS: HUMAN_APPROVED / DESIGN_FROZEN

Branch: `refactor/zhiban-v2`. Design base HEAD: `5e3280eb7dd04c0d4d6bde6022d6fd57c64e87a6`.

本轮仅文档。执行计划已获人工批准并在上述 HEAD checkpoint。2026-10-03，用户明确批准第 6、7、9 节的具体设计：A7-01 RoleCatalog/动作注册表、A7-02 delegation ceiling，以及 A7-03 单一 SECURITY DEFINER capability、两个 tenant-scoped owner SELECT policies 和未来 0007 migration 的精确设计例外。

本次批准冻结 1B-7A 设计，不自动授权 1B-7B 实现、执行 migration、修改实际数据库权限、API、部署、commit/push 或 CI。本文区分已冻结设计与尚未实施/验证的机制；没有把设计空白当作既有 ADR 冲突，也没有把未来并发测试写成 PASS。

## 1. 权威与实际资产

重新读取的权威：

- [执行计划](../zhiban-v2-execution-plan.md) 的 1B-7A/B 与 1B-8A/C；[历史实施计划](phase1b-implementation-plan.md)、[Gate Map](phase1b-gate-map.md)。旧文档的上游基线/阶段标记保留历史意义，以当前计划和已完成 closeout 解释实际状态。
- [RBAC](rbac-model.md)、[权限矩阵](permission-matrix.md)、[授权流程](authorization-flow.md)、[认证边界](auth-boundary.md)、[租户隔离](tenant-isolation.md)。
- [ADR-009](../adr/ADR-009-rbac-policy.md)、[ADR-010](../adr/ADR-010-authentication-session.md)、[ADR-011](../adr/ADR-011-tenant-isolation.md)。
- [1B-2 review](phase1b-2-review.md)、[1B-4 closeout](phase1b-4-review.md)、[1B-6 closeout](phase1b-6-review.md)。历史 pending 项只按后续已签收的对应范围关闭。
- 实际 `lib/zhiban/domain/identity/**` 的 Role、Scope、Permission、RoleGrant、Membership、User、Tenant、SystemAdminGrant；Application Identity Ports；PostgreSQL transactions、repository-support、Membership/User/Tenant repositories、role bootstrap、0001–0006 migrations。
- RoleCatalog contract/Fake、privileged capability guard、PG16 schema-security/repository-signoff tests 和现有 Identity PG16 workflow。测试里的角色权限集合不是生产批准的角色模板。

| 资产 | 状态 | 实际边界 / 缺口 |
| --- | --- | --- |
| User / Tenant / Membership / RoleGrant / Scope / Permission | EXISTS | 状态、有效期、受控角色、scope 形状与 authVersion 已实现；不是完整授权 Policy |
| SystemAdminGrant | EXISTS | 独立全局实体与控制面仓储；没有 tenant 超级权限 |
| RoleCatalogPort / snapshot / test Fake | PARTIAL | 正好三个 tenant role、version 元数据；精确 permissions/委派表设计已批准，生产 adapter 未实现，具体稳定 RoleIds 留配置准备步骤记录 |
| MembershipRepositoryPort / PG repository | EXISTS | required TenantContext、完整历史、CAS、stale-before-no-op；每次调用自行开启事务 |
| Session | EXISTS / FROZEN | 仅 authenticated UserId；Credential epoch 与 User revision 绑定；不提供 tenant Permission |
| tenant RLS / role ACL / transaction cleanup | EXISTS / FROZEN | 不证明 actor 有资格选择该 Tenant；不能混用三个 runtime pool |
| 纯 Authorization policies / Application authorize | ABSENT | 本轮只设计，不新增生产代码 |
| server resource fact loaders | DEFERRED | Identity 可基于真实 Membership；Class/Course/Enrollment/Assignment 由对应未来领域产生 |
| last-admin transaction composition | ABSENT | 单 Membership CAS 不串行化两个不同成员的撤权 |
| decision audit / HTTP adapters | DEFERRED_TO_1B8 | 不扩展 Audit union，不实现 API/401/403/404 |
| authorization real PG16 suite | ABSENT | 设计测试清单；既有 121 ×2 与 905 历史证据不是新授权能力证明 |

## 2. 分层与最小范围

Domain 在 `domain/identity/policies/**` 表达纯值运算；不导入 PG、Next、React、HTTP、cookie、OpenMAIC 或 Application Port。Application `authorize.ts` 接受服务端认证身份、动作和资源定位符，从受控 Ports 读取当前事实后调用 Policy。Infrastructure 实现 current reads、serialization、CAS 与同 client 持久化机制。

1B-7 不创建 Course/Class/Enrollment 聚合，不实现 login/logout、tenant switch、恢复渠道、UI、Bridge 或生产 bootstrap。当前 Identity 动作的 permission 与未来教学动作分开配置；没有业务资源 loader 的动作保持关闭。

Authentication、TenantContext、资源定位符和授权结果各自不能相互替代。禁止把 role、permissions、scope、activeTenant 或 authorizationVersion 写回 Session 作为授权缓存。

## 3. 纯 Policy 输入与闭集输出

冻结契约是内部契约而非 HTTP DTO；类型名称可在 BUILD 中按惯例调整，不改变以下责任：

| 输入 | 必须含有的事实 | 来源 |
| --- | --- | --- |
| actor | authenticated UserId、当前 User 状态 | Session 的 UserId + 当前 global state read |
| tenant | 当前 TenantId、状态 | 服务端读取，不是 URL/header 自报状态 |
| membership | 同 User/同 Tenant 的当前 Membership、完整 grants、authorizationVersion | scoped repository / transaction read |
| catalog | 完整三角色、精确 Permission 集、受控 version | 已批准 server configuration；不是请求体 Role 对象 |
| action rule | 非空 required Permission 集、目标 scope 类型、关系与状态规则、rule version | 服务端登记的有限动作注册表 |
| resource facts | resource tenant、owner/subject、Class/Course 关系、资源状态及必要版本 | 对应用例的 server loader |
| evaluation time | 显式 Instant | 可信 Clock；不从客户端接受时钟 |
| expected freshness | 仅复用旧 decision 时需要的版本与绑定 | 本次服务端内部记录，不接受客户端 ALLOW 声明 |

输出仅 `ALLOW` 或 `DENY`。ALLOW 包含 actorUserId、tenantId、membershipId、当前 authorizationVersion、命中的单一 grantId、catalog/rule version、action/resource binding、evaluatedAt；Application 另保存提交复核需要的 repository revisions、资源 revision 和最早 validity deadline。它们都是内部 receipt，不是可由客户端提交的授权证书。

DENY reason 采用有限内部集合：`INVALID_FACTS`、`INACTIVE_IDENTITY`、`TENANT_MISMATCH`、`NO_EFFECTIVE_GRANT`、`UNSUPPORTED_ACTION`、`CATALOG_UNAVAILABLE`、`PERMISSION_SCOPE_MISMATCH`、`RELATIONSHIP_DENIED`、`RESOURCE_STATE_DENIED`、`STALE_AUTHORIZATION`、`DELEGATION_DENIED`、`LAST_ADMIN_REQUIRED`、`STORAGE_UNAVAILABLE`。不包含 SQLSTATE、driver cause、其他 Tenant、资源存在性差异或 grant 历史。未来公开错误归一化归 1B-8。

缺输入、malformed enum/scope、未知 action、未知 catalog Role、异常/存储故障都不产生 ALLOW。拒绝事实与服务不可用可内部区分，但未来 public boundary 不泄露原因详情。不能 catch error 后改用 UI/Session 或其他 Tenant fallback。

## 4. Allow predicate 与禁止拼接

所有条件必须成立：

```text
ACTIVE User AND ACTIVE Tenant AND ACTIVE Membership
AND actor/membership/resource 同一 Tenant 及正确 User 关联
AND action 已登记 AND catalog 完整且是批准的当前版本
AND EXISTS 同一条当前有效 RoleGrant g:
      catalog[g.roleCode] contains ALL required Permissions
      AND g.scope covers the action's target
AND server-established resource relationship
AND allowed resource state
AND freshness checks
```

RoleGrant 有效区间是 `validFrom <= now < validUntil`，null validUntil 无终点，revokedAt 非 null 永远无效；使用现有 `isEffectiveAt` 语义。PENDING/DISABLED/LEFT Membership 不授权；禁用 User/Tenant 优先拒绝。

只对单条 grant 求 Permission AND Scope；不能先 union 所有 permissions 再 union 所有 scopes。Grant A 有 permission 但范围错误、Grant B 范围正确但无 permission，结果仍 DENY。多个 CLASS/COURSE grant 也不能拼出 TENANT。不同 grant 可以分别合法批准不同独立动作，不能拼成一个更宽的原子动作。

## 5. Scope 与 server relationship facts

| grant scope | 匹配规则 |
| --- | --- |
| SELF / null | 真实资源 subjectUserId 或 subjectMembershipId 属于当前 actor，且 Tenant 一致；没有本人关系不授权 |
| CLASS / ClassId | 精确 ClassId 一致，server loader 证明资源归属该 Class/同 Tenant，并满足动作要求的教学/成员关系 |
| COURSE / CourseId | 精确 CourseId 一致，server loader 证明资源归属该 Course/同 Tenant，并满足动作要求的关系 |
| TENANT / null | 仅当前已验证 Tenant；动作规则显式允许 tenant 范围，资源仍须同 Tenant、关系与状态仍须满足 |

TENANT grant 不是绕过业务关系的万能 scope。动作可显式允许 TENANT 覆盖本 Tenant 的目标 CLASS/COURSE/SELF，但只能在该动作登记了此规则时；不存在通用字符串层级或自动 widening。CLASS 与 COURSE 互不包含，不能靠“它们有关联”推导另一种 scope。

SELF 的目标归属以可信事实为准，不靠 Permission 名字的 self 字样。集合/list/count/export 需在查询本身应用对应范围，不能先跨 scope 加载再前端过滤；batch 任一越界元素拒绝整个不允许部分成功的命令。

普通 HTTP/客户端输入只接受资源定位符，不能接受 owner、teacher flag、relationship=true、trustedTenant 或 Role。Application loader 必须从 tenant-scoped 数据读取 owner/assignment/enrollment/status，再投影最少 Domain 普通值。类型 brand、Object.freeze、WeakSet 或名为 serverVerified 的构造函数不证明关系真实。

生产 authorize 不提供客户端 facts 注入入口。测试可以注入 loader Fake 验证组合，但 Fake 不能成为生产默认。资源领域未建成时不注册对应可用动作，不用常量 true 的 loader。敏感写在同事务重读/锁定关系和资源 revision；只在请求开始验证的 Boolean 不是提交许可。

## 6. RoleCatalog 与最小 Identity vocabulary 冻结契约（A7-01）

现有 `permission()` 只验证小写 `resource:action` 语法，不证明该动作获批准。`roleCatalogSnapshot()` 校验三个角色的完整性，不批准权限内容。contract test 把 `tenant:manage` 放入所有角色只是接口 fixture，绝不能作为生产 catalog。

首个 Identity-only manifest 如下；这是 **HUMAN_APPROVED / FROZEN_DESIGN**，尚未成为已启用的生产配置：

| RoleCode | 本单元批准的生产 Permission 集 | 限制 |
| --- | --- | --- |
| STUDENT | 空集 | 保留角色；本人身份/Session 用独立 authentication-only 用例，教学权限等对应领域批准 |
| TEACHER | 空集 | 不因角色名获得成员管理；教学权限由 Course/Class 设计追加 |
| TENANT_ADMIN | `membership:read`, `membership:manage`, `role:assign` | 仅本 Tenant 成员管理；role:assign 独立检查 delegation；不是全局 User/密码管理 |

暂不启用 `tenant:manage`：Tenant 开户/停用/恢复是控制面；tenant 本空间设置尚无对应实体/用例。教学候选 permission 不在 1B-7 顺带开放。上述空集不否定历史权限矩阵的未来业务允许项，只说明目前没有已实现/已批准的业务入口。

manifest 必须包含稳定且合法的三个 RoleId、三个 RoleCode、精确 permissions、catalog version、动作规则版本、delegation version、审批记录与内容校验值。初始版本标签冻结为 `identity-v1`；具体 RoleIds 与最终配置内容校验值在后续配置准备/实现 review 中记录，不是尚未关闭的权限目录设计选择。不得未经新批准改变此处的 Permission 集。生产拒绝缺配置、部分 catalog、重复/未知 role、同版本不同内容和未经批准的 permission；不从 V1 动态复制模板。

RoleId 是稳定配置身份，不从 RoleCode hash 自造 UUID、不在每次启动随机重建、不拿 fixture UUID 当 production 默认。具体三个 UUIDv7 可以在获准的配置准备步骤一次生成并记录，无须现在为了文档捏造值；未配置则生产 fail closed，Domain 纯 Policy 使用独立 test fixtures。

### Identity-only 动作注册表冻结契约

此表同时属于 A7-01；不是提前实现 1B-8 use cases。成员管理目标 scope 是当前 TENANT 管理范围，与“新 grant 将授什么 scope”是两个不同输入；后者再按 A7-02 检查。

| 内部 action | 同一 actor grant 必须拥有 | 资源事实 / 状态 |
| --- | --- | --- |
| MEMBERSHIP_READ | membership:read | 当前 Tenant 的已存在 target Membership；不读 global User profile/secrets |
| MEMBERSHIP_DISABLE | membership:manage | target 当前 ACTIVE/PENDING，Domain transition 合法；last-admin guard |
| MEMBERSHIP_LEAVE_ADMIN | membership:manage | target ACTIVE；仅本 Tenant 管理命令，last-admin guard；不是学生自主退出 API |
| MEMBERSHIP_ACTIVATE / REACTIVATE / REJOIN | membership:manage AND role:assign | PENDING / DISABLED / LEFT 对应显式命令；User/Tenant ACTIVE、审批和每条 grant ceiling |
| ROLE_GRANT / ROLE_REPLACE / ROLE_REVOKE | role:assign | target 关联同 Tenant，合法 Domain 命令；new grants ceiling、admin-affecting post-state guard |

所有这些初始管理动作均要求 actor 的同一条有效 TENANT grant；CLASS/COURSE/SELF 管理 grant 不自动升格。复合动作要求同一条 grant 同时具备全部 required permissions 和范围，不能让 A 提供 membership:manage、B 提供 role:assign 再绕过单 grant 规则。

未列动作 DENY，包括 profile 更新、学生自主离开/加入/空间发现、tenant settings、global User 状态管理。对应 1B-8 或未来领域可独立批准追加，不临时映射到最相似的已有 Permission。role revoke 只检查当前合法撤权资格，不要求被撤 grant 的目标 role 仍在可新增委派表中；撤销不应因历史授权组合不再允许新增而无法执行，但仍受 last-admin 和版本保护。

纯 Policy 使用一次完整 snapshot，不在每条 grant 中分别调用 findByCode 读出混合版本。受控 adapter 的严格输入校验不放宽现有 Domain/Port，不把 instanceof 或 brand 当配置可信来源。

### Catalog rollout / invalidation

Membership authorizationVersion 不随静态 catalog 配置自动变化，所以不能独自防止旧模板继续授权。每次 receipt 同时绑定 catalog/action/delegation version。改变其中任一版本拒绝复用旧 receipt，即使 Membership version 未变。

首个实现不做在线热更新：审批完整 immutable manifest → 暂停受影响受保护入口 → drain 已开始的授权/写事务 → 所有 worker/instance 切换到同一批准 manifest → 验证无旧版本 → 恢复入口。权限缩减也不能 rolling 时容忍旧实例继续 ALLOW。失败保持关闭；不宣称零停机或跨进程原子配置更新。以后需要热更新/全局 policy epoch 时独立设计，不能用进程内版本相等证明集群 freshness。

## 7. 显式 delegation ceiling 冻结契约（A7-02）

任何 grant/replace/restore 都先基于 actor **mutation 前最新状态** 授权 `role:assign`，同一条 actor grant 满足该 Permission 与操作范围，再按受控 delegation 表检查目标。`membership:manage` 不能代替它。恢复 preserve 模式也要逐条重新批准保留的角色/scope/validity。

已获人工批准的初始受控表如下；**缺配置、未知或未经批准的版本仍使所有委派 DENY**：

| actor 的单条有效 grant | 可批准目标 | 条件 |
| --- | --- | --- |
| TENANT_ADMIN + TENANT | STUDENT + SELF / CLASS / COURSE | SELF 指目标成员本人，不是 actor；CLASS/COURSE 需真实同 Tenant 资源与 approved relationship；无 loader 时对应授予关闭 |
| TENANT_ADMIN + TENANT | TEACHER + CLASS / COURSE | 需真实 assignment 与同 Tenant 资源；不批准 TEACHER + TENANT / SELF 的宽泛教学权 |
| TENANT_ADMIN + TENANT | TENANT_ADMIN + TENANT | 仅授予另一 ACTIVE User 的已批准成员资格；支持正常任命及同事务交接，不允许给自己新增/恢复 admin grant |
| 其他 actor role/scope、未列 target 组合 | 无 | DENY；包括 SYSTEM_ADMIN 作为 Membership RoleGrant |

目标授予必须绑定目标 User/Membership/Tenant、scope、validity、批准依据和旧 expectedRevision。目标有效期不得超出该 actor grant 的 validUntil（null 按无上限处理）；新 grant 的 validFrom 不得早于当前批准时间，后台预约起效需未来明确批准且当前权限有效期覆盖预约。preserve 恢复保留已有不可变 validFrom，不要求将历史起始时间改成 now，但必须当前 effective，剩余有效期也在本次 actor ceiling 内；不满足时只能按新审批 replace，不能改旧 grant。与其他 actor grant 的时效/范围不能拼接。

SELF 委派与 SELF 使用不是同一比较：TENANT admin 可以按显式表批准其他成员的 SELF grant；只有 SELF scope 的 actor 不能借该事实扩大自己范围。自我提权不以“操作后我就是 admin”通过；每个新 grant 在操作前 ceiling 下逐条检查。

冻结禁止所有给自己新增/恢复的管理 grant，另一个当前有效管理员可显式审批；首个管理员 bootstrap 和无管理员 recovery 归独立 1B-8A/C 受控流程，不借 SystemAdmin tenant fallback。该批准关闭此前未决业务选择，不改变已冻结 Domain 生命周期。

## 8. Freshness 与撤权

每次 authorize 重读当前 User/Tenant/Membership 和有效 grants，不缓存最终 Permission。Role revoke、Membership disable/leave、User/Tenant disable 的已提交状态使下一次授权 DENY；Session 可以仍代表身份，但不能保留旧租户权利。

Membership.authorizationVersion 是 `0..9007199254740991` 的安全整数；RepositoryRevision 是正 signed-int8 canonical decimal string，BigInt 校验，绝不 Number/parseInt/xmin。二者不可互代。敏感命令 receipt 绑定 actor membership 的 authorizationVersion 与 repository revision，target aggregate 另有 expectedRevision；actor 和 target 不一定同一个 Membership。

敏感写必须在 serialization lock 后重读当前事实，比较 receipt 绑定、catalog/rule versions、actor/target 身份以及有效期。任何变化导致 DENY/stale；不自动重试旧决定。不接受 stale-before-no-op 绕过，真正 no-op 保持 revision/version；Membership 真 mutation 使用已有 Domain 增 authVersion、数据库 CAS 增 revision 一次。

检查时间须在锁等待结束后取得可信 now，不能用排队前 timestamp 把过期 grant 算有效。receipt 不能跨资源、动作、Tenant、actor、请求或事务重放。授权有明确线性化点，不承诺已发送的数据可在未来撤权后收回；长流/后台副作用的周期复核归实际用例设计。

## 9. 真实 ACL 缺口与已批准窄例外（A7-03）

`0003_identity_audit_and_rls.sql` 与后续 0004–0006 的实际权限：

| runtime | User | Tenant | Membership / grants | secrets |
| --- | --- | --- | --- | --- |
| zhiban_runtime | 无 SELECT | 无 SELECT / row-lock 所需权限 | tenant RLS 下读写 | Credential/Session 不可访问 |
| zhiban_auth_runtime | SELECT | 无 SELECT | 无权限/RLS policy | Credential/Session 的认证专属权限 |
| zhiban_control_runtime | 受控读写 | 受控读写 | 无权限/RLS policy | 无 verifier/digest 读取权限 |

bootstrap 禁止 runtime 角色继承/SET ROLE 路径、owner/superuser/BYPASSRLS。现有真实 `pg16-schema-security.test.ts` 明确断言 tenant runtime 不能读取 users/tenants，control 不能读 memberships/grants，所有 Identity functions 是 SECURITY INVOKER。

因此 **没有现成 runtime client 同时能锁 Tenant、读取当前 User/Tenant 和 RLS Membership 并写成员变更**。不能把 controlTransaction + tenantTransaction 两条连接拼成同一事务；也不能用迁移 owner 执行业务。仅增加 SELECT 也不是 Tenant row-lock 方案：[PG16 SELECT](https://www.postgresql.org/docs/16/sql-select.html) 规定 locking clause 还需至少一列 UPDATE privilege。

这是 1B-4 closeout 已明确延期的跨控制面/租户组合缺口，不是已签收 repository 的实现错误。第 9.1–9.4 节的精确设计例外现已批准；实际角色/权限仍未改变，本轮不执行 migration 或扩权。

此前评估的路径如下；本次批准只选择路径 1 的第 9.1–9.4 节具体契约，路径 2/3 不成为获准实施方案：

1. **优先评估窄数据库 operation/capability**：只返回目标授权所需 User/Tenant 状态/版本并完成相应 global serialization，不暴露 global 列表或 secrets；明确调用角色、参数与 Tenant 绑定、owner、fixed search_path、PUBLIC execute revoke、RLS行为、锁序。若需 SECURITY DEFINER，这是对现有 invoker-only 安全契约的显式例外，必须先批准并精确更新测试，不得 blanket 放开 definer。
2. 独立受限 authorization runtime / 最小 ACL + RLS 扩展：也是角色契约调整，不能在 BUILD 中悄悄新增 role、继承或宽表 GRANT；必须先证明最小权限及原角色不扩权。
3. 保持现有权限且只做分池初始读取：可用于设计/纯 Policy，但**不能**作为敏感写 global 状态同事务复核的最终实现，不满足完整 1B-7/1B-8 gate。

路径 1 的函数签名、owner、ACL/lock 协议与精确 allowlist 已在下文冻结，但尚无实现或真实 PG16 proof，不标运行 PASS。未来经独立 BUILD 授权后使用新的下一 migration 0007（开始前核验库存），0001–0006 字节/checksum 不变。

SCHEMA_STRUCTURAL_BLOCKER: 未发现缺少 Tenant 稳定主键、Membership/grants 或 revision 字段。ROLE_CONTRACT_GAP: RESOLVED_IN_DESIGN_IMPLEMENTATION_PENDING。SCHEMA_CHANGE_DESIGN_APPROVED: YES_A7_03_ONLY。SCHEMA_CHANGE_IMPLEMENTED: NO。

### 9.1 A7-03 冻结方案：单一授权状态 capability

路径 1 的已批准窄例外只允许以下单一函数契约；它**不是**现有角色已能完成的工作，也不是本轮迁移实施许可：

```text
zhiban_identity.authorization_state(
  p_tenant_id uuid,
  p_actor_membership_id uuid,
  p_target_membership_ids uuid[],
  p_mode text
)
```

`p_mode` 仅 `READ_CONTEXT | GUARD_MEMBERSHIP`。普通授权读取用 READ_CONTEXT；敏感成员 mutation 用 GUARD_MEMBERSHIP。最多两个不同 target MembershipId，足以表达现有成员之间的 admin atomic transfer；不建立任意 batch/global user query 能力。actor 与 target 可以重合，内部去重；null、非 canonical identifier、未知 mode、重复 targets、超过上限、foreign target 都 fail closed。

函数只输出以下最小投影，不返回完整 User/Tenant Domain Entity，不由 privileged rehydration mapper 重建不完整实体：

| 输出 | 允许字段 |
| --- | --- |
| Tenant header | tenantId、status、repositoryRevision |
| actor / targets 关联 | membershipId、关联 userId、User status、User repositoryRevision |
| admin User state facts（guard mode） | 同 Tenant 当前 ACTIVE Membership 中持未撤销 TENANT_ADMIN grant 的 membershipId/userId、User status/revision |

Membership status/authVersion/grant history 仍由 caller 的 tenant-scoped client-bound repository 读取。返回的关联必须与该读取逐一一致，否则拒绝；所有 revision 按原 canonical decimal string 验证，不能 Number 化。

SQL return 冻结为固定 TABLE 投影（不是可扩展 JSON）：`fact_kind, tenant_id, tenant_status, tenant_revision, membership_id, user_id, user_status, user_revision`。`fact_kind` 仅 `TENANT | USER`；成功恰有一条 TENANT header，USER 行按真实 Membership 关联去重，nullable 字段按 kind 严格检查。guard mode 须包含所有 required users，缺行、多行冲突、未知 kind 或超上限均拒绝；没有“缺一位 admin 就当不存在”的容错。SQL bigint 由 driver 保持 decimal string，现有 safe-value validator 逐项验证；不复用普通 Loaded<User> 传播这种 partial security projection。

函数不接受任意 UserId、Role、Permission、SQL、JSON 条件或客户端关系 Boolean。它从同 Tenant 的真实 Membership 解析 UserId，防止变成任意全局 User 状态探针。无 actor 资格、缺 Tenant 或任一 target 不在当前 Tenant 统一返回内部拒绝结果，不返回被猜测 User 的状态。

actorUserId 必须在 Application 以本次 authenticated UserId 与返回 actor membership 的 userId 比较。DB 函数并不知道浏览器 Session 身份，不能因为它成功就认证调用者；其 session_user/runtime 检查只认证数据库连接。Tenant GUC 仍不是 actor 权限证明。

Guard 需收集 actor、targets 与 admin candidate 的 User 集合，并按 UserId 排序取 `FOR SHARE`，保持到 outer transaction 结束。admin candidate 包括尚未到期/起效计算前所有未撤销 grant 对应 ACTIVE Membership，不能只锁一个“随便找到”的管理员，也不能遗漏稍后到 validFrom 的管理员。完整集合超过受控 `MAX_GUARD_USERS` 则拒绝整个操作，不截断后继续 count；批准的初始上限为 256，后续调整须独立 review/批准。失效/到期 grant 在 Domain 最终计数时仍不算管理员。

READ_CONTEXT 不锁整个 admin roster，不返回 roster；只投影 actor 与本次有限 targets 的 User/Tenant 状态。它的结果只能用于初始 decision，不是跨事务敏感写许可。actor Membership 必须已 ACTIVE；target 可以是同 Tenant PENDING/DISABLED/LEFT，供合法审批/恢复用例读取，但不据此让 target 授权。

首个函数不支持查询尚无 Membership 的 global User。首次 Membership 创建、首次 admin 引导、无管理员 recovery 的关系证明和 global identity eligibility 由 1B-8A 独立设计；不能用 null target 或放开 UserId 查询临时绕过。1B-7 的 atomic replacement 范围是已有 Membership 的原子状态/角色替换，跨创建的复杂 bootstrap 不提前声称支持。

### 9.2 精确 privilege / RLS 变更 allowlist（已批准）

后续独立 BUILD 授权允许的新 migration 只能包含：该函数、两个 owner scoped SELECT policies，以及函数精确 EXECUTE ACL；不新增表、runtime role、role membership 或 global 直接表 GRANT。

| 对象 / 主体 | 批准的设计改变（未实施） | 必须保持 |
| --- | --- | --- |
| 新函数 | LANGUAGE plpgsql、SECURITY DEFINER、VOLATILE、PARALLEL UNSAFE；owner `zhiban_identity_owner` | 不更新任何业务表，不写 audit，不发凭据，不产生 ALLOW 决定 |
| memberships SELECT policy | 新增仅 TO `zhiban_identity_owner`，USING `tenant_id = current_tenant_id()` | FORCE RLS 与原 runtime policies 不变；无 owner INSERT/UPDATE/DELETE policy 扩展 |
| role_grants SELECT policy | 同上，仅 SELECT，用于解析 scoped admin candidate | 不读取另一 Tenant，不修改 grants/history |
| 函数 EXECUTE | 仅 `zhiban_runtime`；撤 PUBLIC/auth/control 对该函数的 execute | 无 GRANT OPTION，无 runtime→owner/migrator membership/SET ROLE |
| users / tenants | runtime 直接权限不变 | tenant runtime 的直接 SELECT/UPDATE 仍 denied |
| credentials / slots / sessions / system_admin_grants / audit_events | 无新 privilege / policy | helper 不引用 secrets、不调用认证/revoke/control mutation helper |

Owner 无 LOGIN；应用 pool 仍使用 `zhiban_runtime`，不能连接/SET ROLE 到 owner。仅函数体执行有所有者权限，这本身是显式的 security exception；不能把“应用连接不是 owner”当作无需 review 的理由。未来函数修改也必须按精确 capability review，不能扩成通用 GlobalStatusRepository。

固定函数 `search_path = pg_catalog, zhiban_identity, pg_temp`，内部表/helper 全部 schema-qualified；`row_security = on`。不使用 dynamic SQL、row_security=off、BYPASSRLS、临时 schema、用户可写 schema、重载签名或任意 operation dispatch。检查显式参数 TenantId 与 LOCAL `current_tenant_id()` 精确一致；missing/malformed context 拒绝；实际调用连接必须是批准的 tenant runtime。

**为什么需要两个新 policy：**Owner 在 FORCE RLS 下也受 policy 限制，现有 SELECT policy 仅给 zhiban_runtime，SECURITY DEFINER 改变执行身份后不能假设“表是它的”就自然看得到 Membership/grants。因此明确 scoped owner SELECT，而不是关闭 FORCE RLS 或把 owner设为 BYPASSRLS。该权限为维护 owner 新增了有 context 的可见性，是 A7-03 批准范围的一部分。[PG16 RLS](https://www.postgresql.org/docs/16/ddl-rowsecurity.html)

新的 function CREATE / REVOKE PUBLIC / GRANT / policy 必须在 migration transaction 内完成，避免默认 EXECUTE 窗口；固定 search_path 与最小调用权限依据 [PG16 SECURITY DEFINER guidance](https://www.postgresql.org/docs/16/sql-createfunction.html#SQL-CREATEFUNCTION-SECURITY)。本轮只记录要求，不创建 SQL 文件。

### 9.3 函数执行协议与现有 writer 锁序

Guard mode 的完整步骤冻结如下；输入和返回 runtime validation 均不可省略：

1. outer tenantTransaction 开始并设置 LOCAL TenantContext，函数拒绝不符 scope。
2. helper 以 owner 在目标 Tenant 行取 `FOR UPDATE`。无行/非 ACTIVE 则拒绝，无 unscoped fallback；锁后返回/读取当前 Tenant 状态与 revision。
3. helper 在 scoped SELECT policies 下验证 actor Membership ACTIVE、targets 关联，收集全部相关 User，包括未撤销 admin candidates；不能先按 User status 过滤再锁。
4. 对完整 UserId 去重排序，逐行 `FOR SHARE`，直接取被锁定行的当前 status/revision。缺 User 或 malformed 投影拒绝。只投影，不 UPDATE global User，不取得 0006 Session advisory lock。
5. outer client 按 MembershipId 有序锁 actor/targets parent `FOR UPDATE`，fresh-read parent/grants；重新核验 helper 关联与 admin candidate 集合，锁后取得可信 now；集合变化/无法匹配拒绝。
6. Application/Domain 在此 pre-state 做动作、单 grant、ceiling、两种管理员计数与完整 post-state 判断。caller 从本次受控 manifest 取 catalog，不能让 DB 函数解析客户端 permission。
7. 同 client 执行已有 CAS/history semantics 与 closed audit，复核时间界限，checked COMMIT。任一步失败 outer transaction rollback；函数不自行 COMMIT，不发可持久化 capability。

批准的锁序为 **Tenant row → sorted User FOR SHARE → sorted Membership parents → child writes / audit**。global User 的现有控制仓储是 User FOR UPDATE → 0006 exclusive Session advisory → Session revoke/audit；Tenant 控制仓储是 Tenant FOR UPDATE → Tenant CAS。现有这些路径不反过来等待 tenant Membership/authorization anchor，所以无需修改 User/Tenant frozen repository semantics。

| 对手 writer / operation | serializing point | 两种顺序的预期 |
| --- | --- | --- |
| Tenant disable/archive | 同一 Tenant 行锁 | 先禁用则 guard 读到 disabled 拒绝；先 guard 则其写提交后 disable，后续动作拒绝 |
| actor/target/admin User disable/restore | 同一 User 行：FOR SHARE 与 UPDATE 不兼容 | disable 先提交则 guard 拒绝无效 actor/不能用它当接班人；guard 先锁则 disable 等到 guard commit，之后 Session 仍按旧机制 revoke |
| 两个正式成员管理 mutation | 同一 Tenant anchor | 等锁事务必须 fresh-read，不可都按旧 roster 撤权 |
| Session issue/validate/rotate/revoke | helper 不拿 Session advisory、slot 或 Session 行锁 | 不建立 Session lock → Tenant lock 的依赖；1B-8 不能在 auth pool 长事务内等待此 guard |
| Credential replace/revoke | helper 不拿 credential slot 锁 | 无 credential→membership 组合；Session epoch 验证继续由认证边界完成 |

由于 FOR SHARE 也阻止实际 User UPDATE，而不只是键删除，普通状态修改被覆盖；不能换成仅 `FOR KEY SHARE` 后仍声称阻止 disable。[PG16 row locks](https://www.postgresql.org/docs/16/explicit-locking.html#LOCKING-ROWS)

该 wait-for 分析是对已读实际路径的设计推理，不是 real PG16 PASS。未来控制面 multi-User/Membership/bootstrap 操作必须遵循完整锁序或重新 review；不能将未来 `User FOR UPDATE → Tenant lock` 路径接入后沿用今天的无环结论。真实 unexpected deadlock fail closed，按 40P01 分类但不自动重试。

1B-7 当前 pre-state mutation guard 不持有跨 pool Session transaction。1B-8A 必须决定敏感写对“Session 在 initial authentication 后被撤销/用户 disable+restore”的执行点与复核策略；current User ACTIVE 不能代替 Session 未撤销。不得从已认证过的 UserId 持久化一张未来可用的票据，也不得更改 Session Port 塞 role/tenant。该认证 race 与 RoleGrant/authVersion freshness 分开验收。

### 9.4 对旧测试契约的精确处理与新增负例

A7-03 已获批；后续 BUILD 必须更新现有全函数 `!prosecdef` 断言：0001–0006 的函数仍全部 owner 正确且 SECURITY INVOKER；只允许 `authorization_state(uuid,uuid,uuid[],text)` 一个精确 signature 为 DEFINER；检查它的 owner、search_path、row_security、mode/targets 约束、ACL 与函数体禁止表引用。新/未知 DEFINER、重载签名、PUBLIC capability 都失败，不改成简单“存在 definer 就算通过”。

保持原 tenant runtime 直接 users/tenants SELECT denied、control runtime memberships/grants denied、Credential/Session secret denied。两个 scoped owner SELECT policies 作为精确预期增量；其他 RLS enabled/FORCE、role attributes、membership graph 与 TABLE/column/function ACL 负例保留。

新增必测：正确 context、missing/malformed/wrong context；foreign actor/target、不属于当前 Tenant 的 global User 探测、同 Tenant inactive actor；targets 超限/重复/未知 mode；admin candidate 超限整体拒绝；owner FORCE RLS 下 scoped 可见但跨 Tenant 不可见；函数不能被 auth/control/PUBLIC 执行；malformed返回 fail closed；失败/rollback 后池复用无 GUC/权限泄漏。Function 没有认证/permission proof 的 Application binding 用伪造 actorUserId 测试验证。

并发必须观察 Tenant/User 行锁的实际等待，验证 Tenant disable 和 User disable 在 guard 前后两个顺序；已有 Session/Credential 真实 suites 原样继续两轮，不能因新 helper 通过就删除旧 advisory race 测试。

批准的未来 SQL 文件名：`0007_identity_authorization_state.sql`。独立 BUILD 授权后先检查是否已有0007；存在则报告 MIGRATION_SEQUENCE_CONFLICT，不重编号、不改已应用文件。Migration inventory/runner/checksum 与 PG harness 届时按真实0001–0007测试；本轮 actual inventory 仍0001–0006。

## 10. Serialization anchor 与 same-client composition

稳定 Tenant 行作为管理资格 mutation 的 serialization anchor，其窄能力设计已按 A7-03 批准，实现与真实验证仍待后续 BUILD。不能默认 tenant runtime 已有 `SELECT ... FOR UPDATE` 权限。

等价的 transaction-level tenant advisory key 可只用于多个 tenant mutation 的串行化，必须规范唯一命名域/一致 derivation；hash collision 只允许造成额外阻塞，不得带来授权。它不授予 Tenant/User 状态读取能力，也不自动阻止未使用同协议的 Tenant/global writer，因而不是 A7-03 的完整替代。transaction-level lock 随事务结束释放；session-level lock 禁止。[PG16 locking](https://www.postgresql.org/docs/16/explicit-locking.html)

冻结的最小边界是 authorization-specific typed mutation composition，不建立通用 UnitOfWork。Application 提供有限 Identity 命令意图、已认证 actor、target identifiers、expected versions、批准的动作/委派配置和闭集 audit context；Infrastructure 在一条专属 client 上锁、读、复核、构造/验证 post-state、CAS 保存历史、插入已有 mutation audit、检查 COMMIT 后才返回结果。

内部 collaborator 只能暴露本次受限的 Membership load/save 与 closed audit operation；不把 raw PG client/query/commit、任意 SQL callback 或可跨事务持有的授权 capability 交给 UI/Application。未完成 save/audit 的 guard 不得先 commit 返回“稍后可写”的票据。

现有 `PostgresMembershipRepository.save/create/find*` 自行开启 tenantTransaction；直接调用它们会产生第二事务，禁止这样组合。BUILD 应在既有 repository 目录内部抽取必要的 client-bound persistence mechanics，保留原 public Port、CAS、authVersion、history、no-op、authenticity 语义不变，并跑旧共享 contracts。

现有 terminal mappers 的 production consumer 只允许 repository boundary。新的 `postgres/authorization/**` 不直接 import/re-export privileged mapper 或 rehydration。client-bound collaborator 留在 `postgres/repositories/**`，仅传已验证 Domain 值；不能为实现方便扩大 DH07 allowlist。若安全复用需要改变冻结能力边界，先另行 review。

### 冻结事务时序（实现与真实验证待 BUILD）

```text
exclusive client → BEGIN READ COMMITTED → LOCAL TenantContext
→ acquire approved global status barriers / Tenant serialization anchor
→ lock affected Membership parents in deterministic ID order
→ fresh-read actor + target + complete relevant grants + current global states
→ validate expected revisions / authorizationVersion / catalog & resource facts
→ authorize under pre-state; delegation check every proposed grant
→ evaluate last-admin on complete proposed post-state
→ parent CAS + append/first-revoke child history + closed audit on same client
→ revalidate time-sensitive/global bindings under approved protocol
→ checked COMMIT → release
```

以上是责任顺序；第 9.3 节的具体锁序和现有 writer 等待分析已获 A7-03 设计批准，真实执行验证仍未进行。BUILD 必须按具体协议核验 SQL，不以概念顺序代替锁证明。不能在 guard 内 hash密码、调用网络、等待人工审批或启动另一仓储事务。

Tenant-local parent/child 部分的锁序为 Tenant anchor → affected MembershipId 有序 parent locks → grants；完整 global User 锁步骤仍按第 9.3 节执行。所有正式成员管理写路径一致参与，锁后 READ COMMITTED fresh statement 读，不能依赖锁等待前旧 repeatable-read snapshot。任意失败 rollback，安全分类 40001/40P01 可沿用但无自动重试。成功返回必须实际 COMMIT command tag，不接受 aborted ROLLBACK。

## 11. Last effective TENANT_ADMIN Policy

Policy 基于当前 Tenant 的完整相关成员集合和 proposed post-state，不能只看 actor/target 的两个请求快照。计数单位是 distinct Membership（同一 (Tenant,User) 唯一），不是 admin grant 条数。

基础治理计数按现有冻结定义：Membership ACTIVE，至少一个 `TENANT_ADMIN` grant 未撤销、未到期、已到 validFrom。PENDING/DISABLED/LEFT、revoked/expired/future grant 不计。当前 admin scope 的治理计数不偷偷改成另一种角色或 scope 层级。

另外区分“可实际执行管理的管理员”：User 也须 ACTIVE，且有已批准的管理 scope/permission。不能把全局已 DISABLED User 当作可用接班人。A7-03 必须支持相关 User 的状态事实；实际 operational count 与仅 grant governance count 的差异需显式报告。已批准 A7-02 新 admin 仅 TENANT scope，但不改写历史 grants。

任何受控成员操作使 proposed post-state 不再有当前有效、可用管理员，DENY。atomic replacement 不是先删除再靠未来补救：同事务新的合法 ACTIVE 成员/有效 admin grant 已成立，旧 grant terminal revoke、history 和 audit 一起提交；否则 rollback。

| 路径 | guard 要求 / 责任 |
| --- | --- |
| Membership disable / leave | 锁后重读完整 relevant current state，移除目标管理资格后仍至少一位有效可用管理员 |
| revoke 单条 admin grant | 判断目标是否还有另一当前有效 admin grant，不按 revoked 行数直接减人数 |
| replace grants / admin transfer | 校验全部新 grant 与 ceiling，在完整 post-state 计数；future/revoked/expired successor 不算 |
| activate / reactivate / rejoin | 使用现有显式审批模式，不恢复历史撤销/过期 grant；新审批也要 ceiling、authVersion、同事务 audit |
| global User disable | 属于控制面安全动作；不能因最后管理员而禁止紧急账户停用。需 1B-8A/C 定义受影响 Tenant 的受控接管/恢复与 lock 协调，当前 guard 不声称覆盖 |
| Tenant disable / archive | 属于控制面；业务整体拒绝，恢复前重新核验管理员和成员/grant 状态，不自动复活权限 |
| grant 自然到期 | 无 write transaction 可加 guard；需到期预警/受控交接与无管理员 recovery 设计，不能宣称 count≥1 永久不变量 |

时间也不受行锁冻结：两个管理员先后撤权时，guard 在锁后可信 now 重判。有效期限必须在本次授权/持久化安全边界内复核；1B-8 的恢复/运维负责人必须对到期后的行政可用性负责。不擅自禁止现有 Domain 合法的有限 admin grant。

### 并发证明目标

两个不同管理员撤各自权限，持相同请求时刻快照：第一事务取 Tenant anchor、fresh read 两人、合法移除一人并 commit；第二等锁后重新读，发现只剩自己，移除将归零，因此 DENY，无 state/audit partial commit。不能以它们是不同 Membership revision 就各自成功。

每个能减少管理员的正式命令必须参与同一 anchor 协议。原仓储低层写方法与持有 runtime 凭据的任意 trusted SQL 不自动获得这一 guard；1B-8C 必须接线所有受保护入口并用 call-site/集成测试证明不能绕过。1B-7 primitive 的 PG 测试不等于现有全系统入口已安全。

## 12. SYSTEM_ADMIN 与 audit

独立控制面 eligibility 仅是 ACTIVE global User + 同 User 的当前有效 SystemAdminGrant。它不是 tenant authorize fallback，也不默认允许任何控制面动作：实际动作另需受控 control-plane action allowlist/审批，bootstrap/recovery 属于 1B-8 设计。

SYSTEM_ADMIN 不能进入 Membership RoleCode，不新增 SYSTEM Scope，不创建虚假 Tenant，不把 control DB 登录凭据等同业务 SystemAdminGrant。ServiceActor 必须有独立有限动作/明确 Tenant；未设计则拒绝，不冒充 SystemAdmin。

1B-7 不扩展 IdentityAuditEvent union。Role/Membership mutation 复用已有 closed events 与 approved snapshots，state、authVersion 和 audit 必须同 client/transaction。Audit factory 能投影白名单，不证明 actor 或 approval 合法；独立 AuditPort.append 不证明原子性。decision audit 与 HTTP code 映射由 1B-8 实现，不用 arbitrary JSON 先搭通用审计。

不持有/返回/记录 password、verifier、bearer、digest、原始 request body、SQL/error cause、完整 grant 历史。对不存在/跨 Tenant 资源不得在未来 public error 中暴露差异。

## 13. BUILD / CI 可执行验收清单（未执行）

A7-01/A7-02 与 A7-03 窄权限/锁序设计均已获人工批准。下一步先做设计文档 checkpoint，再独立授权 1B-7B BUILD；本次批准不启动实现。每个新增文件进入 BUILD allowlist；migration 仅允许已批准的 A7-03 精确例外，只追加 0007，不改 0001–0006。

### Unit / contract

新 `tests/zhiban/identity/authorization/**` 至少覆盖：

- 完整 active chain 单 grant ALLOW；User/Tenant disabled、Tenant archived、Membership PENDING/DISABLED/LEFT DENY。
- revoked/expired/future grant，validFrom inclusive / validUntil exclusive 边界；unknown Role/action/permission/catalog、malformed persisted facts 与存储故障 fail closed。
- SELF 本人/他人，CLASS/COURSE 精确/错 id，TENANT 同 Tenant/跨 Tenant；extra/missing scopeId、unknown scope 拒绝；TENANT 不能忽略动作关系。
- permission/scope stitching、两个无关 scope 拼接拒绝；无 server loader、客户端 relationship/owner 注入拒绝；resource 不可操作状态拒绝。
- actor/target version 分离、stale-before-no-op、revoke 下一次立即 DENY、禁用/离开与显式恢复不复活 terminal grants。
- catalog 同 version 不同内容拒绝，缺配置拒绝，配置改变 receipt 失效；旧实例 drain/reopen 测试不伪称 online rollout。
- role:assign 缺失、每个 delegation allow/deny 组合、超 scope/有效期、给自己新增/恢复管理 grant 拒绝；不用新 post-state 授权旧命令。
- SystemAdmin/control credential 不作为 tenant teaching fallback。
- distinct-member last-admin 计数；两 admin 移一人、最后一人拒绝、有效 atomic successor、future/revoked/expired/disabled successor 拒绝。
- same-client SQL ordering/params、锁后读取、parent CAS/history/audit rollback、COMMIT tag/cleanup、无跨 pool/repository 自开事务；保留 DH07 与原 mapper guard。

### Real PG16 Authorization

| ID | 真实证明 |
| --- | --- |
| AUTHZ-PG01 | restricted role 下实际 active chain / catalog / 单 grant ALLOW |
| AUTHZ-PG02 | User disabled DENY；不是 admin connection 伪装生产 role |
| AUTHZ-PG03 | Tenant disabled/archived DENY |
| AUTHZ-PG04 | Membership PENDING/DISABLED/LEFT DENY |
| AUTHZ-PG05 | revoked / expired / future 及时间边界 DENY |
| AUTHZ-PG06 | 缺 required Permission / catalog entry DENY |
| AUTHZ-PG07 | SELF/CLASS/COURSE/TENANT 精确 scope 与真实可信事实加载 |
| AUTHZ-PG08 | wrong/cross Tenant DENY，无 existence 泄露 |
| AUTHZ-PG09 | Permission + Scope 无 grant stitching |
| AUTHZ-PG10 | authVersion/CAS 变化使旧 receipt 失效 |
| AUTHZ-PG11 | 已 commit revoke 后下一次 authorization DENY |
| AUTHZ-PG12 | 最后有效 admin 移除拒绝且无写入 |
| AUTHZ-PG13 | 两 admin 移一人，剩余至少一人 |
| AUTHZ-PG14 | independent connections + acknowledged Tenant lock wait；双撤权最多一个 commit；锁后 fresh read |
| AUTHZ-PG15 | 有效 atomic admin replacement + history/audit；注入失败全部 rollback |
| AUTHZ-PG16 | future/revoked/expired/non-ACTIVE successor 不满足 guard |
| AUTHZ-PG17 | TenantContext/RLS、missing context、pool/rollback reuse 无泄漏 |
| AUTHZ-PG18 | SystemAdminGrant 无 tenant teaching fallback |
| AUTHZ-PG19 | A7-03 批准 capability 的 ACL、PUBLIC denied、不能 global enumerate/越 Tenant/访问 Credential/Session secrets |
| AUTHZ-PG20 | actor/User/Tenant 状态 mutation 与敏感成员写的批准 serialization 两种顺序 |
| AUTHZ-PG21 | 所有成员管理 mutation 类型共享 anchor；audit failure rollback、max revision/authVersion fail closed |

ID 是覆盖要求，不是为了数字重复测试；parametrized cases 以实际 count 汇总。尚无本地/远端执行证据，不能将此表标 PASS。

测试 barrier 必须由 PG 确认持锁/阻塞，例如现有 harness 的 pg_blocking_pids 观察与 gate；不使用 sleep-only race。admin 仅 setup/seed/catalog/cleanup；权限与行为断言使用实际生产 restricted roles。

复用现有 `zhiban-identity-pg16-security.yml` 两轮，追加 `pg16-authorization.test.ts`，不删除原八 suite / 121 tests。静态 steps 追加 Authorization unit/contract，保留原 905 个回归项目（实际 count 自然变化需逐 suite 解释），不可再次遗漏五个 repository suites。Node22/Linux、frozen install、root lint/typecheck/format、通用 CI 与 Storage PG 不削弱。

本轮不跑大测试、不 dispatch。BUILD 时 local PG16 不可用记 PENDING_CHECKPOINT，不安装、不用 PG18/PGlite 冒充。Checkpoint、候选独立远端核验、两轮 CI signoff 和 closeout 各需独立步骤。

## 14. Threat model / 自审边界

| 威胁 | mitigation / 层 | 验证 |
| --- | --- | --- |
| client relationship/owner 伪造 | Application 只接受 locator，server loader；Domain 无 provenance 魔法 | tampered DTO / 无 loader 负例 |
| cross Tenant / Context 被当 proof | actor/membership/resource 同 Tenant + scoped repository/RLS | AUTHZ-PG08/17，batch 混入负例 |
| grant stitching / unknown fallback | 单 grant existential predicate、finite action/scope registry | unit + PG09 |
| stale decision / catalog drift | actor/target versions 分离、catalog binding、锁后重读、配置 drain | PG10/11/20 + rollout tests |
| self elevation / role 字符串层级 | explicit approved delegation、pre-state authorization | delegation matrix 全组合 |
| 最后管理员 TOCTOU / 双撤权 | Tenant anchor + fresh distinct-member post-state + 同事务 save/audit | PG12–16/21 |
| global state race / 跨 pool partial guarantee | 按已批准 A7-03 capability/锁序实施，完成 lock proof 后才启用敏感写 | PG19/20，两种先后顺序 |
| revoked history revival | 复用 Domain / immutable历史 / existing CAS，无授权层修复坏数据 | 恢复/revoke 并发与旧回归 |
| SYSTEM_ADMIN tenant fallback | 单独 control eligibility，无 tenant超级读 | PG18 |
| SQL/error/audit secret leakage | closed reasons/events、显式最小字段、sanitized boundary | error/audit/serialization负例 |
| 自然 expiry / 全局 emergency disable 后无管理员 | 不谎称事务永久保证；1B-8 恢复/运营责任独立审批 | expiry/recovery设计及以后演练 |

自审已排除的设计捷径：control + tenant 两个 auto-transactions 冒充 ACID；Tenant 行锁权限假设；WeakSet 当 relationship proof；将测试 Role permissions 当生产 catalog；permission union；用请求时间跨锁等待；按 grant 行数而非成员数计数；只保护 revoke 忽略 disable/leave/replace；靠 future successor 满足当前 last-admin；扩大 mapper allowlist；把 catalog 更新误等同 authVersion 更新。

## 15. Frozen / Implementation Pending / Deferred 与下一步

FROZEN_EXISTING: GLOBAL User / tenant Membership 分离；三 tenant roles + 独立 SystemAdminGrant；四 Scope；默认 DENY；单 grant Permission AND Scope；active chain + 当前有效期/关系/资源状态；Session/TenantContext 非授权证明；RepositoryRevision 与 authVersion 独立、stale-before-no-op、history/terminal 规则、无自动 retry；0001–0006 不修改。

FROZEN_IN_1B7A: 内部闭集 decision 与 receipt；server fact loader 边界；版本和 catalog freshness；初始 Identity RoleCatalog/动作注册表；显式 delegation/self/有效期规则；A7-03 精确 capability、ACL/RLS 例外及锁序；last-admin post-state/同事务要求；client-bound collaborator 必须保留 repository/mapper 能力边界；测试/CI inventory。尚未实施或证明真实 PG 并发。

| Approval item | 当前结果 | 已批准范围 |
| --- | --- | --- |
| A7-01 controlled Identity RoleCatalog | HUMAN_APPROVED / DESIGN_CLOSED | 第 6 节 Permission 集、identity-v1、稳定 RoleIds 配置要求、动作表与 rollout；具体配置值后续记录 |
| A7-02 delegation ceiling | HUMAN_APPROVED / DESIGN_CLOSED | 第 7 节目标角色/scope/self/时效与 preserve 规则；未列组合 DENY |
| A7-03 global/tenant same-client role boundary | HUMAN_APPROVED / DESIGN_CLOSED | 第 9.1–9.4 节单一 capability、精确 ACL/两个 scoped policies、0007 设计、锁序与 security assertions 精确例外 |

以上三个设计批准项已关闭，Authorization contract 正式 FROZEN。设计批准解决角色边界的契约缺口，不表示实际数据库权限已可用或并发已验证。下一步是单独的 1B-7A 文档 checkpoint，之后另行授权 1B-7B BUILD；本轮不 commit/push、不创建 0007、不改生产/测试/workflow，也不 dispatch CI。后续实现与 signoff 必须满足第 13 节全量 gate，不能用设计批准替代执行证据。

DEFERRED_TO_1B8: approval provenance / 1B1-F05、首个管理员与 control recovery、Identity 命令及幂等、所有入口同事务 guard 接线、全局 disable/restore 与 Tenant 敏感写协调、到期行政恢复责任、public API/DTO/error normalization、cookie/CSRF/origin HTTP wiring、distributed/IP admission、application decision audit。

DEFERRED_TO_RESOURCE_PHASES: Course/Class/Enrollment/TeachingAssignment 的真实事实 loaders、动作 Permission 增量审批、resource mutation locks/relationships 与 adapter/long-stream 使用复核。OUT_OF_SCOPE: JWT、MFA、OAuth、OpenMAIC Bridge 实现、V1 数据迁移、Portal 和生产 cutover。

PHASE_1B7A: COMPLETE_DESIGN_ONLY

AUTHORIZATION_SECURITY_RULES: PRESERVED

AUTHORIZATION_CONTRACT: FROZEN

A7_01: HUMAN_APPROVED

A7_02: HUMAN_APPROVED

A7_03: HUMAN_APPROVED

FROZEN_CONTRACT_CONFLICT: NO_OBSERVED_CONTRADICTORY_ADRS

ROLE_CONTRACT_GAP: RESOLVED_IN_DESIGN_IMPLEMENTATION_PENDING

SCHEMA_STRUCTURAL_BLOCKER: NO_IDENTIFIED

SCHEMA_CHANGE_DESIGN: APPROVED_A7_03_ONLY

IMPLEMENTATION_AUTHORIZED: NO

PRODUCTION_IMPLEMENTED: NO

REAL_PG16_AUTHORIZATION: NOT_RUN

READY_FOR_1B7A_DOCUMENT_CHECKPOINT: YES

READY_FOR_1B7B: NO_PENDING_DESIGN_CHECKPOINT_AND_SEPARATE_BUILD_AUTHORIZATION

READY_FOR_1B8: NO

DESIGN_DOCUMENT_COMMIT: NO

DESIGN_DOCUMENT_PUSH: NO
