# Phase 1B-1 — Identity Domain Contracts Review

Status: IMPLEMENTED / PASS_WITH_NOTES。
Base HEAD: 3b678c9398a39cb8c5104e9125c3a264660ae850。
Branch: refactor/zhiban-v2。仅本批次领域代码和纯单元测试；1B-2仍需独立实施授权。

## IMPLEMENTED CONTRACTS / FILES ADDED

目录：lib/zhiban/domain/identity/，12个文件。

| 文件 | 契约 |
|---|---|
| errors.ts | IdentityDomainError、稳定错误码与内部不变量辅助函数 |
| ids.ts | UserId/TenantId/MembershipId/RoleId/RoleGrantId/SystemAdminGrantId；opaque ClassId/CourseId引用；UUIDv7解析 |
| time.ts | 不可变Instant（UTC epoch毫秒）；显式时间和有效期验证，无时钟读取 |
| user.ts | 全局User聚合；ACTIVE/DISABLED、显式disable/restore |
| tenant.ts | Tenant聚合；ACTIVE/DISABLED/ARCHIVED；稳定code，不持有成员集合 |
| membership.ts | Membership聚合；固定User/Tenant关联、grant集合、恢复/重新加入、授权版本 |
| role.ts | 系统目录Role Entity；STUDENT/TEACHER/TENANT_ADMIN |
| role-grant.ts | Membership内RoleGrant Entity；scope、有效期、不可逆撤销 |
| permission.ts | 稳定resource:action语法值对象，无角色权限矩阵 |
| scope.ts | SELF/CLASS/COURSE/TENANT封闭联合；scopeId约束 |
| system-admin-grant.ts | 仅关联全局User的独立控制面grant |
| index.ts | 本领域公开导出 |

依仓库现有kebab-case、单引号、分号和typed Error风格；未发现适合直接复用的无框架通用Result/DomainError，使用可预测的IdentityDomainError.code。不新增运行依赖或测试框架。strict=true，测试沿用Vitest 4与@/别名，测试文件位于既有tests/**/*.test.ts发现范围。

## INVARIANTS IMPLEMENTED

- 聚合及Role/RoleGrant均为不可变实例，构造器私有、公开属性readonly并Object.freeze；数组防御拷贝和冻结，嵌套Scope冻结。操作返回新对象，失败不修改原状态，无public setter。
- Membership仅PENDING/ACTIVE/DISABLED/LEFT；pending/disabled/left的effectiveGrantsAt返回空集合。
- pending→active使用activatePending且必须显式提供新批准grants；pending预置记录不自动授予，保留并撤销。
- disabled→active只能reactivate并选择PRESERVE_EXISTING_VALID_GRANTS或REPLACE_GRANTS。preserve显式approvedGrantIds，逐条验证存在、未撤销、未过期且已起效；遗漏的grant撤销，包含未来grant，不能留待自动起效。无效审批整体失败，不静默过滤。
- replace、left→active、active grant replacement均要求新批准grant集合；旧grant保留撤销历史，新grant不得复用任何历史grant ID；空集合必须显式传入。LEFT无旧grant恢复路径。
- 显式新批准的未来grant可以保留其未来有效期，但不会提前生效；这不等于恢复历史future grant。User/Tenant状态、邀请有效、grant ceiling、scope同Tenant和操作者审批真实性由后续Application/Policy验证；本批次的approved参数只表达调用契约，不是审批证明。
- authorizationVersion从0开始，每次激活、授予、首次撤销、禁用、恢复、离开、重新加入和替换递增一次；不接受任意设置。所有Membership命令检查expectedAuthorizationVersion，负数/非整数/过期版本拒绝，防整数溢出。重复撤销为no-op，保留第一次revokedAt、不增加版本。
- 同一实例的版本前置能表达冲突，但不能协调两个同时加载的快照；数据库原子比较、事务、审计原子提交仍由后续Repository/Application实现，不能据单元测试宣称并发持久化安全。
- Tenant restore只返回Tenant，不能修改Membership或grant。User不包含tenantId/role/凭据；SystemAdminGrant不包含Membership/Tenant；SYSTEM_ADMIN不能作为tenant roleCode。
- Scope的SELF/TENANT要求scopeId显式null；CLASS/COURSE需要对应opaque ID；未知scope无fallback。

## Implementation conventions

ID结构验证采用UUIDv7版本与variant位检查，并规范化为小写，不生成ID。仅检查结构，不证明生成时间或唯一性；Class/Course也是不引入外部聚合的opaque引用。ID_GENERATION: DEFERRED_TO_1B2_OR_LATER。

Instant使用非负、可表示的整数UTC毫秒，避免可变Date对象穿透冻结。validFrom inclusive；validUntil exclusive；有限validUntil必须严格晚于validFrom。新grant构造要求validFrom不早于createdAt；不提供回溯授予命令。时间由调用方传入，领域无Date.now/new Date/ClockPort。修改操作不接受早于updatedAt的时间。RoleGrant撤销不可逆，isEffectiveAt不是回溯审计查询；已撤销记录即使询问过去时间也不恢复有效。

Tenant code当前构造约定为小写字母开头、最多64字符，后续字母/数字/下划线/连字符；displayName和禁用原因trim后非空。code不充当凭据；全局唯一及实际首个Tenant配置留后续review。ARCHIVED没有自动恢复操作；冻结设计未定义归档恢复用例。

Permission仅验证小写resource:action结构（词间可下划线、不接受动态数字/额外冒号/路径），并不能凭语法证明某个词属于已批准词汇。Role permissions由受控调用方传入，未来RoleCatalog管理词汇/版本与模板变更；不会从客户端任意字符串自动赋权。本批次不复制未来Course/Learning权限矩阵。

无JSON/DB/HTTP serializer、无rehydrate/fromSnapshot。历史状态当前由合法操作产生且保留，未提供绕过不变量的装载入口；未来持久化恢复须独立设计并覆盖disabled/left/revoked及非法结构验证。

## Audit boundary

AUDIT PERSISTENCE: DEFERRED_TO_APPLICATION。
不新增事件总线或AuditRepository。调用方持有操作名/命令（now、mode、审批ID集合、reason、expected version）、不可变before与返回after（状态、updatedAt、授权版本、历史grant及revokedAt），足以形成状态变化事实；actor/requestId/审批依据和原子审计保存属于后续Application。User/Tenant恢复清除当前禁用字段，原对象仍保留旧值，但不是持久审计替代物。

## TESTS ADDED

目录tests/zhiban/identity/domain/：5个测试文件和1个fixture辅助文件。

| 文件 | 覆盖 |
|---|---|
| value-objects.test.ts | UUIDv7、品牌类型、permission、role code、所有scope组合、非法时间 |
| aggregates.test.ts | User生命周期、Tenant状态/独立性、Role集合、SystemAdminGrant有效期/撤销 |
| role-grant.test.ts | validFrom==now、validUntil==now、不可逆撤销、重复撤销、时间和冻结scope |
| membership.test.ts | pending/disabled、显式恢复审批、三类历史grant拒绝、replace/history、left/rejoin、版本与防御拷贝 |
| architecture.test.ts | AST验证领域只导入本目录、无框架/底座/环境依赖、无隐式时钟、无any/抑制指令 |
| fixtures.ts | 固定2026-09-22T12:00:00.000Z与显式前后毫秒，构造合成ID/grant |

测试不使用真实当前时间，不访问数据库、凭据、网络或V1。未执行E2E或1B-0B。

## Validation

本地Node v24.18.1、pnpm 10.28.0；满足engine >=22.19.0。正式Phase0运行基线仍为Linux/Node22，本轮本地检查不替代后续CI。

- Identity tests（初版）: 92 passed，5 files passed；子目录/inline type import边界增强后复跑仍通过。Revision Round 1结果见下节。
- 新增文件lint: PASS。
- Domain独立strict TypeScript: PASS（tsc --noEmit --strict --target ES2017 --module esnext --moduleResolution bundler --skipLibCheck --types node lib/zhiban/domain/identity/index.ts）。
- root lint: PASS（0 errors、18个既有目录warning，与runtime baseline数量一致；新增路径无warning）。首次并行root lint因本机可用内存降至约115MB主动停止，串行重跑通过；没有绕过检查。
- root TypeScript: PASS（2026-09-24，node --max-old-space-size=8192 node_modules/typescript/bin/tsc --noEmit --incremental false，exit 0，无诊断）。首次默认约2GB V8堆OOM（LOCAL_ENVIRONMENT_ONLY，与既有runtime baseline记录一致）；跨会话的首次8GB运行结果不可取回，因此重新执行并确认通过。仅调整进程级堆上限，未修改项目或全局配置。
- root TypeScript使用已有CI的tsc --noEmit，增加--incremental false以避免写入缓存；未修改tsconfig。

## Deferred

DEFERRED TO 1B-2：Repository/External Ports、IdGeneratorPort、RoleCatalogPort、ClockPort、CredentialVerifierPort等；本批次未创建interface。
DEFERRED TO 1B-3：Identity schema/RLS、唯一性/关系约束；无migration或数据库操作。
DEFERRED TO 1B-5/6/7：凭据与密码、Session/cookie、完整Authorization Policy、grant ceiling、资源关系和最后管理员事务保护。
后续持久化批次：rehydration、映射、乐观版本比较与原子audit。无权限修改其他阶段Gate。

OPENMAIC DEPENDENCY: NONE。
DATABASE DEPENDENCY: NONE。
FRAMEWORK DEPENDENCY: NONE。

## KNOWN QUESTIONS

1. 人工review确认UUIDv7结构约束、Tenant code词法、时间区间半开边界与归档恢复未开放的实现约定。
2. 恢复/授予的approved参数必须由可信Application生成；此批不承担审批真实性、User/Tenant活跃与跨Tenant资源关系验证。
3. 未来Repository装载契约须维护当前不可变边界，并增加非法历史数据测试，不能用Object.assign跳过验证。

初版Review时READY_FOR_1B2: NO。以下保留当时的状态与证据，最终人工签收结论见文末。

## Final scope check

HEAD仍为上述Base HEAD，当前分支不变。新增19个文件：12个Domain文件、5个测试文件、1个fixture、本文档。全部在本批允许路径内；无已有跟踪文件修改、无暂存变更。git diff --stat为空是因为新增文件尚未暂存，不表示未产生文件；通过git status --short --untracked-files=all核验完整清单。OpenMAIC core、V1、数据库、配置均未修改。

## REVISION ROUND 1

- F-01: FIXED。可信TypeScript调用改用selfScope()/tenantScope()/classScope(ClassId)/courseScope(CourseId)；原始输入走单独的parseScope(type, scopeId)。类型测试验证ClassId与CourseId不能交叉传给可信工厂。parseScope只验证封闭ScopeType、scopeId组合与UUID结构，不证明UUID实际指向Class或Course。
- F-03: FIXED。轻量architecture guard递归枚举Identity Domain目录的全部文件，非.ts文件直接失败；现有AST静态/type-only/dynamic import及越界相对路径检查保持。它仍不是完整静态分析器。
- F-04: FIXED。root index改为显式稳定导出；invariant、nonBlank、atOrAfter、validateValidity均非公开入口。测试同时验证主要稳定导出仍存在。
- F-02: DEFERRED HARDENING。TypeScript private constructor的运行时限制不在本轮结构性重写；未来Repository rehydration/persistence boundary review必须提供经验证的装载入口并复核运行时绕过。当前正常factory仍执行领域不变量校验。
- F-05: DEFERRED TO APPLICATION APPROVAL DESIGN。PENDING_GRANT_RECOVERY_SEMANTICS: DEFERRED_TO_APPLICATION_APPROVAL_DESIGN。PRESERVE目前只接受Membership已有、当前有效且显式approved的grant ID，不会自动恢复；未来1B-8显式命令设计时决定pending-origin grant是否可通过该模式获批。

Scope typed factory != runtime resource existence proof。未来Application / CourseAccessPort / Authorization Policy仍必须验证CLASS引用真实Class、COURSE引用真实Course，资源属于当前TenantContext，且实际资源关系成立。UUIDv7策略不变，未加入资源前缀、数据库查询或Course Aggregate依赖。

Revision验证：Identity Domain tests 94 passed（5个test files）；root lint PASS（0 errors，18个既有非本批warning）；默认root typecheck在约2GB V8 heap处OOM，无类型诊断；只为重跑进程临时设置NODE_OPTIONS=--max-old-space-size=8192后，root typecheck PASS（无诊断，未修改配置或永久环境变量）。TS_IGNORE: 0；TS_EXPECT_ERROR: 0；未使用as any。PRESERVE、未来grant、REPLACE历史、LEFT重新加入、RoleGrant ID唯一性和authorizationVersion测试继续通过。

Revision Round 1完成时仅本批允许路径内的未提交文件发生变化；未创建Repository Port、rehydration、schema、Session、Credential、OpenMAIC Adapter或UI。当时READY_FOR_1B2: NO，等待人工Review。

## FINAL HUMAN REVIEW SIGNOFF

Status: IMPLEMENTED / PASS_WITH_NOTES。
1B-1 REVIEW VERDICT: PASS_WITH_NOTES。
P0 BLOCKERS: 0。
P1 MUST_FIX: 0。
P2 DEFERRED: F-02 runtime constructor hardening，留待Repository rehydration / persistence boundary review。
P3 NOTE: F-05 pending-origin grant approval semantics，留待1B-8 Application approval design；PRESERVE仍要求显式批准既有、当前有效grant，不会自动恢复。
F-01、F-03、F-04已在Revision Round 1修复，历史修订记录保留。
READY_FOR_1B2: YES_AFTER_1B1_COMMIT。此签收不启动1B-2，不授权Repository Port、数据库、Session、Credential、OpenMAIC Adapter或部署。
