# Phase 1B 实施计划

Status: FROZEN。13 个独立小批次（1B-0 至 1B-12）；以下 Files 全部是未来建议路径，不是本阶段创建文件的授权。每批单独审阅，禁止一次铺开。
Phase 1A Final Freeze 仅修改文档；ADR-007 至 ADR-011 已 ACCEPTED，ADR-012 保持 PROPOSED。后续实施须另行授权，每批仍独立 review。1B-0 是首个技术批次，必须先于数据库 schema 实施完成。保留 Phase 0 Linux/Node22测试作为回归门槛；不得为通过测试改OpenMAIC core。

| 批次                                      | Files（拟议）                                                                                         | Dependencies                                                    | Tests                                                                                                                  | Exit Criteria                                                                  | Rollback                                                                      |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| 1B-0 OpenMAIC Authorization Surface Spike | `docs/v2/phase1/openmaic-authorization-surface-spike.md`（未来只读诊断报告）                          | Final Freeze 完成；单独授权技术诊断                             | 0A静态证据；不足标需0B隔离诊断，另行授权；本次不执行                                                                   | 原10类及扩展项逐项完整；所需0B另授且完成；必需能力无未解决阻塞；先于schema实施 | 停止诊断、保持入口关闭；0A无数据变更；0B仅按独立授权处置隔离fixture，保留证据 |
| 1B-1 Identity Domain Contracts            | `lib/zhiban/domain/identity/*.ts`；`tests/zhiban/identity/domain/*`                                   | 1B-0 完成；ADR-007/008/009 已接受；该批 review                  | 聚合不变量、多角色、纯依赖、禁用优先                                                                                   | 无框架/store依赖，概念契约评审通过                                             | 撤回独立代码批次，无持久数据                                                  |
| 1B-2 Repository / External Ports          | `lib/zhiban/application/identity/ports/*.ts`；`tests/zhiban/identity/contracts/*`                     | 1B-1                                                            | fake实现契约、缺失Tenant拒绝、错误分类                                                                                 | Port不泄漏PG/Next/OpenMAIC DTO                                                 | 撤回Port批次，保持旧应用未接入                                                |
| 1B-3 PostgreSQL Schema + RLS              | `lib/zhiban/infrastructure/identity/postgres/migrations/*`；`docs/v2/phase1/schema-review.md`         | 1B-0 完成且无未解决必需能力阻塞；1B-1/2；数据库所有权 review    | 真实 non-superuser/non-owner/non-BYPASSRLS；missing/wrong/unknown context、composite FK、unique constraints            | 只独立V2测试库；未改OpenMAIC表；备份恢复演练                                   | 未上线测试库可重建；有数据时仅经批准补偿，不自动drop                          |
| 1B-4 PostgreSQL Repositories              | `lib/zhiban/infrastructure/identity/postgres/repositories/*`；`tests/zhiban/identity/postgres/*`      | 1B-3                                                            | connection pool reuse、rollback reuse、cross tenant id、batch operations、background jobs、cache keys、复合FK/唯一约束 | tenant隔离负例全部通过                                                         | 停用新repository入口，保留数据/审计                                           |
| 1B-5 Credential Authentication            | `lib/zhiban/application/identity/authenticate.ts`；`lib/zhiban/infrastructure/identity/credentials/*` | 1B-2/4；验证hash依赖                                            | Argon2兼容fixture、限速、无用户统一错误、敏感日志                                                                      | 无真实V1 hash/明文；密钥与参数评审                                             | 禁用认证入口，不放宽验证兜底                                                  |
| 1B-6 Server Session                       | `lib/zhiban/application/identity/session/*`；`lib/zhiban/infrastructure/identity/session/*`           | 1B-5                                                            | logout/expiry/rotation/CSRF/disabled/store故障                                                                         | cookie与服务端撤销链可验证                                                     | 关闭新入口并撤销新sessions，保留旧项目原样                                    |
| 1B-7 Authorization Policies               | `lib/zhiban/domain/identity/policies/*`；`lib/zhiban/application/identity/authorize.ts`               | 1B-1/4/6                                                        | scope关系、grant ceiling、最后管理员并发、撤权                                                                         | API无关纯Policy和事务复核通过                                                  | 禁用受影响操作，默认deny                                                      |
| 1B-8 Application Use Cases + Minimal API  | `lib/zhiban/application/identity/use-cases/*`；`app/api/zhiban/identity/**`                           | 1B-7；需后续明确允许源码开发                                    | 所有入口认证/tenant/权限、DTO脱敏、幂等                                                                                | 只Identity用例，无Course业务迁移                                               | 撤入口/feature flag，保留审计与schema                                         |
| 1B-9 OpenMAIC Bridge Implementation       | `lib/zhiban/infrastructure/openmaic/identity/*`；`tests/zhiban/openmaic/identity-contract/*`          | 1B-0 证据证明可安全实施 + ADR-012 明确接受；1B-2/7；该批 review | 原始端点旁路、Stage/Asset/Runtime/stream/iframe、伪造owner                                                             | 只实现1B-0已验证可行路径；不改core/principal，不使用insecure dev auth          | 关闭launch并撤销handles，底座保持原样                                         |
| 1B-10 Security + Integration Gate         | `tests/zhiban/identity/security/*`；`e2e/zhiban-identity/*`                                           | 1B-4–9；threat model                                            | 权限矩阵负例、跨租户、迁移脱敏fixture、上游回归                                                                        | P0/P1测试通过；桥接不通过则保持关闭并阻止相关发布                              | 保留门禁失败，不跳过测试                                                      |
| 1B-11 Minimal Login / Tenant Switch UI    | `app/zhiban/login/*`；`components/zhiban/identity/*`                                                  | 1B-8/10                                                         | 登录、退出、选择Tenant、权限变化、可访问性                                                                             | UI隐藏非安全边界；不开发教学功能                                               | 移除UI入口，服务端仍deny                                                      |
| 1B-12 Review / Dry-run Handoff            | `docs/v2/phase1/phase1b-verification.md`                                                              | 1B-0–11                                                         | 全套CI与独立测试库演练、文档核对                                                                                       | 人工签收；无V1写入/真实数据迁移/部署                                           | 不批准上线；保持V1独立与V2隔离                                                |

Tests 是每批交付的一部分，不延迟到 1B-10 才写。1B-0 必须先完成；1B-9 仅为经证据验证后的生产 Adapter 实现计划，不能同时承担首次可行性判定。任何必需能力依赖 Category C/D 核心修改时，输出 BLOCKED_FOR_ARCHITECTURE_REVIEW，停止后续 schema/bridge 实施，不扩权修改。

## 数据与版本保护

main 只作 OpenMAIC 上游同步，refactor/zhiban-v2 为 V2开发，feature/zhiban-mechatronics 为V1维护/参考。不merge旧V1，不复制旧身份目录。
本期及上述实施批次均不隐含生产数据迁移授权。V1身份迁移另批审批，独立测试库与非生产fixture优先。
数据库回滚不能等同删库；上线后存在关联数据时只允许版本兼容或补偿方案。Phase 1B 不包含生产部署授权。

## Review checklist

确认首个 Tenant 实际责任主体与恢复渠道；按已冻结的三个 tenant-scoped role + 独立 SystemAdminGrant 实施；OrganizationUnit 延期保持；Session 8h/30min 作为可配置初始策略；审核 UUIDv7 依赖；落实受限DB角色；1B-0 先验证 bridge 入口覆盖。未满足对应项不得启动相关批次。

## 1B-0 证据模板与裁决

本次仅冻结要求，不执行 spike。后续1B-0A只读静态审计，不创建schema、migration、API、Adapter、测试文件，不修改OpenMAIC core，不写数据库。必要的动态验证归1B-0B，未来独立授权隔离环境；不属于0A权限。

必须分别列举 Stage、Scene / Document、Asset、Runtime、Agent、Media / Download、Interactive iframe、Streaming endpoints、Server Actions、Direct URLs。每类列出全部实际入口；重叠入口标关联，不因重复而漏掉旁路。不存在的入口也须记录搜索证据。不得仅报告一个 launch 路由。

每条记录包含以下字段：

| 字段                      | 必需内容                                           |
| ------------------------- | -------------------------------------------------- |
| ENTRY POINT               | 实际路由/函数/直接URL模式、方法、源码位置、底座SHA |
| CURRENT AUTH              | 实际验证机制、失败行为；无认证明确标明             |
| CURRENT PRINCIPAL         | 主体来源、可伪造性、是否浏览器可控                 |
| DIRECT BROWSER ACCESS     | 可否直达/旁路、访问路径证据                        |
| ZHIBAN GATEWAY POSSIBLE   | YES/NO/UNKNOWN + 接线证据，不以假设代替            |
| PRIVATE NETWORK REQUIRED  | YES/NO + 网络边界、下载/流等旁路约束               |
| MAPPING REQUIRED          | 需要的Zhiban-owned映射及生命周期                   |
| SUPPORTED PUBLIC CONTRACT | 公开契约出处与版本；仅内部函数不算稳定公开接口     |
| CORE CHANGE REQUIRED      | NONE 或具体修改点及保护分类；不得执行              |
| VERDICT                   | 下列四值之一 + 理由、证据和未解决条件              |

VERDICT 有限值：SAFE_ADAPTER、NETWORK_ISOLATION_REQUIRED、UPSTREAM_EXTENSION_REQUIRED、BLOCKED。
SAFE_ADAPTER需要充分静态证据和受支持公开契约。证据不足时增加DYNAMIC_VERIFICATION_REQUIRED与VERIFICATION_STATUS字段，按下文规则选择非SAFE的VERDICT，不默认安全；NETWORK_ISOLATION_REQUIRED和UPSTREAM_EXTENSION_REQUIRED不是已安全上线结论，也不授权修改上游。
额外标明能力是否本阶段必需及批准人，不能为绕过阻塞偷偷将必需能力改为非必需。
若必需能力只能通过 Category C（MODIFY_ONLY_IF_REQUIRED）或 D（DO_NOT_CUSTOMIZE）核心修改实现，总结输出 BLOCKED_FOR_ARCHITECTURE_REVIEW。即使 Category C 名称包含 required，本次仍不授权修改。ADR-012 保持 PROPOSED，直至所有需开放入口的统一授权边界得到证据支持并经评审。

## 保留的延期与禁止项

OrganizationUnit、Tenant Custom Role、OAuth/OIDC Platform、JWT access/refresh architecture、Risk Reviewer、Researcher：DEFERRED。
生产 V1 Identity 迁移：NOT AUTHORIZED。

## Membership 恢复与 RoleGrant 生命周期（冻结）

Membership 状态仍仅 pending、active、disabled、left。pending 不授权；disabled 使所有 RoleGrant 在授权计算中失效，记录可以保留但不能授权。
disabled → active 必须显式选择 `PRESERVE_EXISTING_VALID_GRANTS` 或 `REPLACE_GRANTS`，禁止只写 membership.status = active 隐式恢复权限。前者仅保留重新审核且当前有效（未 revoked、未 expired、已到有效起始时间）的 grant；后者以新审批的角色/scope 集合替换，旧记录转为 revoked/history 并保留，不覆盖删除。revoked/expired grant 永不自动复活，未来起效 grant 不因恢复提前生效，亦不得未经显式审批留待后续自动授权。
left 表示已离开 Tenant 业务资格；历史 Membership 保留供审计、业务引用与迁移追踪。left → active 可复用同一 (userId, tenantId) MembershipId，但必须重新审批角色和 scope，旧 RoleGrant 绝不自动恢复，保留 revoked/expired/history 记录。
每种恢复/重新加入必须增加 authorizationVersion 并记录 audit event；重新检查 User/Tenant active、操作者权限、目标 scope 和 grant ceiling，尤其高权限 grant。Tenant disabled → active 不恢复单独 disabled Membership，不复活 revoked/expired grant，不扩大权限；仍 active 的成员也仅按当前有效 grants 重新判定。
恢复、撤权、grant替换与 authorizationVersion 更新须以同一原子命令处理，审计随事务提交；锁定或乐观版本冲突必须重读最新状态，禁止 stale snapshot 覆盖并发 revoke。幂等重放不重复授予；重试不撤销已生效的拒绝决定。

## Membership 生命周期测试关卡（未来，不创建测试）

1. pending membership cannot authorize
2. disabled membership cannot authorize
3. disabled → active does not revive revoked grant
4. disabled → active does not revive expired grant
5. disabled → active preserve grants requires explicit command
6. disabled → active replace grants requires explicit command
7. left → active never auto-restores old grants
8. Tenant restore does not restore disabled membership
9. Tenant restore does not revive grants
10. authorizationVersion increments on membership recovery
11. grant ceiling checked on privileged restore
12. concurrent restore/revoke cannot create privilege escalation

1B-1覆盖状态机/Policy；1B-4覆盖真实事务和并发；1B-6/7覆盖Session版本与恢复授权；1B-8覆盖显式命令及幂等；1B-10汇总门禁。任一恢复负例失败不得签收相关批次。

## Phase 1B-0 内部验证层次（冻结）

1B-0A — STATIC AUTHORIZATION SURFACE AUDIT：只读源码/配置、枚举 route 和 server action、追踪调用、分析 principal/cookie/header/token/network exposure/public contract/adapter feasibility/direct browser bypass。读取配置应脱敏，不读取或泄露真实用户凭据。禁止写数据库、创建Stage/Runtime、写Asset、调用可能持久化的Agent、修改OpenMAIC、启用insecure dev auth、创建production Adapter或Identity实现。
1B-0B — ISOLATED DIAGNOSTIC VERIFICATION：仅在确有需要且未来独立授权时，用隔离非生产环境与合成身份/数据验证动态行为。不得访问生产数据、修改V1、使用真实用户凭据、启用insecure production auth或修改OpenMAIC core。动态写入也只能在另行批准的隔离范围内；本次不执行。
0A/0B只是Phase 1B-0内部两个验证层次，不增加正式Phase或把13个批次改成14个。

| 字段                          | 允许值与规则                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------ |
| VERDICT                       | 仅 SAFE_ADAPTER / NETWORK_ISOLATION_REQUIRED / UPSTREAM_EXTENSION_REQUIRED / BLOCKED |
| DYNAMIC_VERIFICATION_REQUIRED | YES / NO；静态证据不足时必须YES                                                      |
| VERIFICATION_STATUS           | STATIC_CONFIRMED / REQUIRES_ISOLATED_DIAGNOSTIC                                      |
| DIAGNOSTIC_BLOCKER            | 无隔离环境时 DYNAMIC_VERIFICATION_BLOCKED_BY_ENVIRONMENT，绝不能写PASS               |
| CONTRACT_CLASSIFICATION       | PUBLIC/STABLE CONTRACT / INTERNAL/UPGRADE-SENSITIVE IMPLEMENTATION                   |

只有源码、正式契约、配置、已存在测试证据足够支持所述安全结论时，才可标STATIC_CONFIRMED；“已有测试”须注明版本、覆盖和实际证据，不能凭文件名或CI整体绿灯推定。静态确认配置不能代替目标部署连通性证据。
证据不足时：DYNAMIC_VERIFICATION_REQUIRED=YES、VERIFICATION_STATUS=REQUIRES_ISOLATED_DIAGNOSTIC；VERDICT按事实选NETWORK_ISOLATION_REQUIRED、UPSTREAM_EXTENSION_REQUIRED或BLOCKED，不得SAFE_ADAPTER。PENDING_DYNAMIC_VERIFICATION不是正式VERDICT值，不增加第五值。
未来0B结果以证据/结果记录另行评审；不得冒称STATIC_CONFIRMED来表示动态通过，也不在本次扩展状态枚举。0A报告写完不等于所有安全门禁通过；必需能力尚需0B而未完成时，1B-0不能算已满足schema/bridge前置门槛。

优先核查 @openmaic/dsl、@openmaic/storage published interfaces、published package entry points、明确导出的supported contracts。导出本身不是稳定性承诺，须给正式支持证据。
`lib/store/**`、`lib/server/agent-runtime/**`、`lib/utils/iframe*`、Next route内部JSON、private helper、internal Zustand action、Postgres internal schema均不得自动当作稳定契约。安全桥接若只能依赖内部实现，禁止SAFE_ADAPTER；至少UPSTREAM_EXTENSION_REQUIRED或NETWORK_ISOLATION_REQUIRED并解释风险，不能证明可隔离则BLOCKED。
任何必需能力只能通过Category C/D核心修改实现：不修改，输出BLOCKED_FOR_ARCHITECTURE_REVIEW。ADR-012仍PROPOSED，静态/动态诊断都不自动接受部署。

## 1B-0 授权面逐项覆盖（不可省略）

原10个类别保留为分组，Scene/Document及Media/Download分别逐项审计。以下每项都必须有入口记录，不能以“已包含在其他类别”替代证据；每个实际路由/函数/直接URL需映射到适用条目：

- Stage
- Scene
- Document
- Asset
- Runtime
- Agent
- Media
- Download
- Interactive iframe
- Streaming endpoints
- Server Actions
- Direct URLs
- Classroom page
- ClassroomSurface entry
- Playback page / playback entry
- Generation routes
- Generation tools
- Edit routes
- Editor-related entry points
- Import-related entry points
- Asset resolver URLs
- signed URLs
- generated/download URLs
- public/published URLs
- API routes
- server component direct data loading
- internal server fetch
- background tasks touching OpenMAIC resources

每项同时记录ENTRY POINT、CURRENT AUTH、CURRENT PRINCIPAL、DIRECT BROWSER ACCESS、ZHIBAN GATEWAY POSSIBLE、PRIVATE NETWORK REQUIRED、MAPPING REQUIRED、SUPPORTED PUBLIC CONTRACT、CORE CHANGE REQUIRED、VERDICT，以及上述三个验证字段和CONTRACT_CLASSIFICATION。同一路径可关联多类但不可遗漏调用链。
不存在则标NOT_PRESENT并给出搜索路径/模式、基线SHA、搜索结果和调用链证据；未查到但证据不足不能声称不存在。NOT_PRESENT是存在性标记，不是新增VERDICT；适用性说明须独立保留。

## Network Boundary 候选对比任务

Zhiban server-side gateway + private OpenMAIC instance = PREFERRED CANDIDATE，不是ACCEPTED DEPLOYMENT。本阶段不修改部署；下表是1B-0需验证的比较问题，不是验证结果。

| 维度                   | A 同一Next应用、原始route浏览器可达 | B 公开Zhiban Gateway、OpenMAIC route私网不可达 | C 独立OpenMAIC服务、仅server-to-server |
| ---------------------- | ----------------------------------- | ---------------------------------------------- | -------------------------------------- |
| Browser bypass         | 原始路由绕过风险，需证明统一门控    | 须证明私网限制实际覆盖所有入口                 | 须证明服务仅接受受控调用及网络限制     |
| Asset bypass           | 检查直链/公开字节与resolver旁路     | gateway必须覆盖asset读写和URL派生              | 服务资源不能另开公共旁路               |
| Runtime identity       | 浏览器principal不能当身份           | 受控mapping选择上下文，验证可行契约            | 验证服务契约与learner隔离              |
| Agent                  | 检查工具间接编辑及调用链            | 工具/流也要在私网与授权范围                    | 限制服务凭据/agent能力与副作用         |
| iframe                 | 消息来源与嵌套请求审计              | 验证资源代理、origin和消息协议                 | 验证跨域/受限launch，不暴露后端凭据    |
| download               | 枚举原始/派生下载和signed URL       | 防转发与绕过gateway的派生URL                   | 验证短期受限下载交付机制               |
| stream                 | 原始SSE/流可能绕过应用门禁          | 验证代理、撤权和重连                           | 验证身份映射、服务流撤销/重连          |
| operational complexity | 同进程但安全覆盖可能复杂            | 网关与私网运行配置、代理成本                   | 服务版本/网络/运维协调成本             |
| upstream compatibility | 不允许修改核心补门禁                | 验证现有公开契约能否完整代理                   | 验证已支持服务契约，不假定存在         |

1B-0必须为各格补证据、可行性、限制和所需动态验证；不以“私网”二字代替完整授权。B为优先候选，C需明确服务契约，A若不能防浏览器旁路不得作为安全桥接方案。
