# Phase 1A Final Freeze 一致性记录

Status: FROZEN。

本次基于人工评审同步设计，范围仅 docs/v2/\*\*。未执行 Phase 1B-0，未授权生产迁移或开发。ADR-007–011 为 ACCEPTED；ADR-012 与 openmaic-identity-bridge.md 继续 PROPOSED，等待 1B-0 证据及后续评审。

## 修订计数

DOCUMENT INCONSISTENCIES FOUND: 11
DOCUMENT INCONSISTENCIES REMAINING: 0

计数按独立问题类别去重，不按文件出现次数；包含本次评审要求补全的契约歧义，不代表存在11个已实现安全漏洞。

| #   | 原问题/歧义                                             | 冻结结果                                                                    |
| --- | ------------------------------------------------------- | --------------------------------------------------------------------------- |
| 1   | SystemAdminGrant未同步到角色/ADR/矩阵                   | 三种租户角色与独立控制面记录明确分离，禁止虚假Tenant与Tenant API授予        |
| 2   | Scope只有概念枚举，缺少封闭类型及scopeId约束            | SELF/CLASS/COURSE/TENANT，未知/非法组合DENY，不回退                         |
| 3   | Session导航空间与身份的统一字段语义不够显式             | Session.userId是身份；activeTenant只是候选；逐请求完整验证                  |
| 4   | Session 8h/30min还写为待评审，配置与领域不变量未区分    | 已接受初始可配置策略，保留轮换/撤销/版本失效                                |
| 5   | RLS缺失上下文已有拒绝，但wrong/unknown及测试要求不完整  | 三类DENY；受限运行角色与migration owner分离；完整负例清单                   |
| 6   | bridge feasibility与后部实现混为同一批                  | 1B-0首批且schema前置；1B-9仅安全证据通过后实现                              |
| 7   | 人工接受后ADR/主文档仍PROPOSED、存在“未经接受”旧文字    | ADR007–011 ACCEPTED、主文档FROZEN；bridge/ADR012保持PROPOSED                |
| 8   | 延期/迁移限制散落且标签不统一                           | 六项DEFERRED；生产V1 Identity迁移NOT AUTHORIZED                             |
| 9   | 实施计划路径通配符被Markdown解释为斜体/下划线           | 路径改用代码样式，恢复真实拟议通配符，仅作未来计划                          |
| 10  | 1B-0 static audit 与 dynamic verification语义冲突       | 冻结0A静态/0B另授隔离诊断；证据不足不SAFE，独立验证状态字段                 |
| 11  | Membership reactivation / RoleGrant lifecycle未完全冻结 | 显式preserve/replace，left新审批，不复活revoked/expired，版本/审计/并发门禁 |

## 术语检查

User/Tenant/Membership 聚合边界不变；Role为目录定义，tenant RoleGrant归Membership，SystemAdminGrant独立。
Permission是resource:action，ScopeType封闭，ScopeId与类型匹配；TenantContext为服务端验证上下文，Session与导航候选不是业务授权。
OpenMAICResourceAccessPort属于Application；OpenMAIC access code/token不等于Zhiban Session。
V1审计中的旧scope/账户绑定/回退是历史证据，不视为V2契约，不改写历史。
独立身份入口/平台控制面不伪造Tenant；其显式Policy不是tenant-owned数据的unscoped fallback。

## 未决但不阻止文档冻结

ADR-012是否可接受必须待1B-0验证。本次不能声称OpenMAIC所有入口已安全，也不以文档冻结代替源码、安全或运行测试。

## Cross-ADR优先级与状态核验

上位架构约束：ADR-001（固定基线）、ADR-002（Adapter/Port）、ADR-004（数据所有权）、ADR-005（V1隔离）、ADR-006（同步流程）。Phase 1A的ADR-007–011仅细化Identity相关设计，不能覆盖这些上位约束。ADR-003仍为整体领域划分提案，ADR-012仍为待验证桥接提案；FROZEN是文档状态，不自动接受提案或部署。

| ADR | 核验状态                                                   | Cross-document结论                                                                                                          |
| --- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 001 | Accepted for Phase 0                                       | 固定底座4d2e2bab82374ed45b95964a1f2ed03362666e1c；未回退tag、未引入V1分支                                                   |
| 002 | Accepted for architecture; implementation deferred         | UI→Application→Domain，Infrastructure实现Port；OpenMAICResourceAccessPort是supplementary application port，原始决策含义不变 |
| 003 | PROPOSED                                                   | Phase 1A freeze does not accept ADR-003 globally. Identity细化不表示其他七个bounded context已验证                           |
| 004 | Accepted for architecture; storage implementation deferred | 存储详细设计仍待后续；仅Zhiban mapping引用opaque OpenMAIC id，无上游业务列                                                  |
| 005 | ACCEPTED                                                   | V1只读；不edit/format/install/checkout/reset/commit/migration或整目录复制                                                   |
| 006 | ACCEPTED                                                   | upstream → main → sync/openmaic-\* → compatibility tests → refactor/zhiban-v2                                               |
| 007 | ACCEPTED                                                   | 全局User/Tenant/Membership与独立SystemAdminGrant；明确恢复生命周期                                                          |
| 008 | ACCEPTED                                                   | Tenant不同于班级；OrganizationUnit延期不变                                                                                  |
| 009 | ACCEPTED                                                   | 三种tenant角色，四种ScopeType，未知deny；恢复授权受grant ceiling约束                                                        |
| 010 | ACCEPTED                                                   | Session身份不等于Tenant授权；恢复需授权版本失效，不复活旧Session                                                            |
| 011 | ACCEPTED                                                   | fail closed与受限运行角色；RLS不保护OpenMAIC原生表                                                                          |
| 012 | PROPOSED                                                   | 0A/必要0B证据与明确评审前不接受；私网网关仅PREFERRED CANDIDATE                                                              |

PHASE 0 ARCHITECTURE VIOLATIONS FOUND: 0
PHASE 0 ARCHITECTURE VIOLATIONS REMAINING: 0
NEW INCONSISTENCIES FIXED: 2

ADR-003状态文本规范为PROPOSED并保留分领域验证说明；ADR-004明确storage implementation deferred且详细设计仍延期；ADR-005/006仅规范状态大小写，不改变历史决策含义。ADR-001/002历史决策未改。
main是上游同步线，refactor/zhiban-v2是开发线，feature/zhiban-mechatronics仅V1参考/维护。禁止V1 merge/整块复制、Identity依赖V1技术结构或upstream/main直接自动merge到V2。

## Data ownership复核

OpenMAIC owns Stage、Scene、Document、Runtime payload、Asset、Agent Session、execution internals。
Zhiban owns Tenant、User、Membership、Role、Permission、SystemAdminGrant、Course/Class/Enrollment、Learning Evidence、Assessment、Profile、Intervention、VirtualLab attempts、resource mappings。
不向OpenMAIC表加tenant_id，不向Stage加teacherId/studentId/userRole，不把Membership写进OpenMAIC storage，不将runtime schema变成智伴业务schema。
跨系统仅Zhiban-owned mapping + opaque OpenMAIC identifier，无跨库强FK；mapping所有权、生命周期和恢复权限分离。

## COVERAGE ENHANCEMENT

Classroom/ClassroomSurface、Generation/Edit/tools、Playback、Importer、Asset resolver/signed/generated/download/public URLs、API/Server Actions/server component直接加载/internal server fetch/background tasks均要求在1B-0逐项列举；NOT_PRESENT也须搜索证据。
这属于覆盖增强，不新增架构矛盾计数。保留正式四值VERDICT，新增DYNAMIC_VERIFICATION_REQUIRED、VERIFICATION_STATUS；不把PENDING_DYNAMIC_VERIFICATION作为第五值。

## 延期与执行边界

OrganizationUnit、Tenant Custom Role、OAuth/OIDC Platform、JWT access/refresh、Risk Reviewer、Researcher均DEFERRED；production V1 Identity migration为NOT AUTHORIZED。
本次只修改文档，未运行0A/0B，未创建测试、schema、migration、API、Adapter或Session，未安装依赖、部署、暂存、commit或push。动态验证无隔离环境须记录DYNAMIC_VERIFICATION_BLOCKED_BY_ENVIRONMENT而不是PASS。
