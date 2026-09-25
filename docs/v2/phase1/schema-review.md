# Phase 1B-3A — Identity PostgreSQL Schema / Ownership / RLS Design Review

Status: REVIEW ROUND 1 — P1 DESIGN DECISIONS CLOSED / DESIGN ONLY。
日期：2026-09-25。分支：`refactor/zhiban-v2`。
审阅 HEAD：`efaa65e1813680a539d664bc49ae36481ff9ca71`。
OpenMAIC baseline：`21d83ec51b908a4b169ee2be7498a29da213c74d`，v1.1.0。
PostgreSQL target：16。所有表、约束、角色、事务及测试均为 DESIGN ONLY；未创建数据库、migration、SQL 文件、Repository 或测试。

## 1. 结论与证据层级

推荐独立 `zhiban_identity` schema、`pg` + 版本化 raw SQL、代码拥有的 Role/Permission 目录、BIGINT epoch-ms、独立 persistence revision。Membership/RoleGrant 使用显式 tenant predicate、RLS 和复合 FK。全局身份与控制面不伪装成 tenant-owned 数据。

本稿不改变冻结契约。人工 Review Round 1 已裁决 3A-D01/D02/D03，并按真实 Domain/Ports 契约复核：P0 BLOCKERS：0；未关闭 P1 DESIGN DECISIONS：0；READY_FOR_1B3B：YES（仅表示设计准入，**本轮不实施**）。PG16 受限角色 RLS/ACL、shape、unknown tenant、跨租户与 append-only 负例是 1B-3B 的**退出验收**，不是开始 1B-3B 的前置条件；1B-4/1B-8 的同 client/事务与审计失败回滚另行验收。没有数据库测试已运行的结论。

证据优先级：本次授权范围 → 已接受 ADR/冻结设计 → 已签收 Domain/Ports 与测试 → 本文候选。历史报告开头的旧 Gate 不覆盖文末最终签收；不修改任何 ADR。

### 1.1 已读取的仓库依据

下列路径均以仓库根为基准；链接可追溯到本稿审阅的 HEAD。

| 依据 | 对本稿的约束 |
| --- | --- |
| [实施计划](phase1b-implementation-plan.md)、[Gate map](phase1b-gate-map.md) | 1B-3 独立 schema review；文件沿用计划中的 `schema-review.md`；Identity 不依赖全量 0B；资源 mapping 不在本批 |
| [1B-1 review](phase1b-1-review.md)、[1B-2 review](phase1b-2-review.md) | 使用最终签收/Revision 后契约；rehydration、Session ID、pending-origin 审批仍有延期项 |
| [Identity](identity-domain.md)、[Tenant](tenant-model.md)、[RBAC](rbac-model.md)、[权限矩阵](permission-matrix.md) | 全局 User、多 Membership、受控三个 tenant roles、独立控制面、禁用优先 |
| [Session](session-strategy.md)、[Auth boundary](auth-boundary.md)、[授权流程](authorization-flow.md) | 认证、范围与授权分离；全局会话不存最终角色/权限；事务内复核 |
| [隔离](tenant-isolation.md)、[ID](id-strategy.md)、[威胁模型](identity-threat-model.md) | 复合约束、非 owner 运行角色、UUIDv7、fail closed、安全负例 |
| [ADR-007](../adr/ADR-007-identity-model.md)、[ADR-008](../adr/ADR-008-tenant-model.md)、[ADR-009](../adr/ADR-009-rbac-policy.md)、[ADR-010](../adr/ADR-010-authentication-session.md)、[ADR-011](../adr/ADR-011-tenant-isolation.md) | ACCEPTED，不能为 schema 方便改变聚合/授权模型 |
| [ADR-012](../adr/ADR-012-openmaic-identity-bridge.md)、[ADR-013](../adr/ADR-013-openmaic-private-runtime-boundary.md)、[ADR-014](../adr/ADR-014-openmaic-package-host-strategy.md) | 012 保持 PROPOSED；013/014 已接受架构方向，不等于桥接实现授权 |
| [v1.1.0 sync review](../sync/openmaic-1.1.0-sync-review.md)、[所有权](../data-ownership.md) | Package Host PARTIAL_IMPROVED；U01/U02 未关闭；shared owner 不是租户 |

源码完整读取范围：`lib/zhiban/domain/identity/` 12 个文件；`lib/zhiban/application/identity/ports/` 13 个文件。Domain：errors、ids、time、user、tenant、membership、role、role-grant、permission、scope、system-admin-grant、index。Ports：audit、clock、credential-verifier、errors、id-generator、identity-repository、index、membership-repository、repository-types、role-catalog、session-repository、tenant-context、tenant-repository。

测试完整读取范围：Domain 的 aggregates、architecture、membership、role-grant、value-objects 五个 test files + fixtures；Contracts 的 architecture、audit、external-ports、repositories 四个 test files + fakes。已签收报告记录 94 Domain / 20 Contract PASS；本轮只读取，不重新运行，不把 fake 等同真实 DB 证据。

### 1.2 实际契约中容易误建的差异

| 源码事实 | Schema 必须遵守 |
| --- | --- |
| `ids.ts` 只接受 UUIDv7/RFC variant 并小写化 | 不接受 v4 fallback；不把 ID 当凭据 |
| `time.ts` 上限 **8640000000000000** | 不能仅检查 JS MAX_SAFE_INTEGER；不使用 DB 当前时间替换命令时间 |
| User/Tenant/Membership 有 disabledAt/disabledReason | 保存当前禁用事实；restore 清空，历史由 audit 保留 |
| Tenant.archive() 保留原 disabledAt/reason | ARCHIVED 可由 ACTIVE 或 DISABLED 到达，不能强制归档行禁用字段必空 |
| RoleGrant/SystemAdminGrant 无 updatedAt | 不机械补 Domain 字段；createdAt、有效期及首次 revokedAt 已足够 |
| Membership grant 数组有历史和顺序 | 不只存 effective grants；需要确定性装载顺序 |
| SessionId/TokenDigest 是非空 opaque string | 不能套 UUIDv7/固定十六进制格式；Session ID 不属于现有 IdGeneratorPort |
| RepositoryRevision 是 opaque 非空 string | DB 数值为 Infrastructure 编码细节；不是 authorizationVersion，也不是 xmin |
| Audit 有 18 种事件、8 种 reason、3 类 actor | 不是任意 payload；不得直接 dump command/request/Domain 对象 |

## 2. 现有数据库技术栈与迁移工具

只读检查 `package.json`、`packages/@openmaic/storage/package.json`、`lib/persistence/`、storage PostgreSQL 源码/测试、`scripts/`、`.github/workflows/storage-pg-contract.yml`、`docker-compose.yml`。用 `rg --files` 搜索 migration/schema/SQL/ORM 文件，以及这些路径中的 DDL/RLS/ORM/迁移关键词。

| 实际机制 | 证据与限制 |
| --- | --- |
| node-postgres | root `pg ^8.16.3`、`@types/pg`；无 Prisma/Drizzle/TypeORM/Sequelize/Knex 正式依赖或 migration runner 证据 |
| 内嵌 DDL + ensure | `storage/src/runtime/pg.ts` 的 `RUNTIME_PG_SCHEMA/ensureSchema`；`document/pg.ts` 的 `DOCUMENT_PG_SCHEMA/ensureDocumentSchema/splitSqlStatements`；asset/agent-session/material/skill 各自 schema |
| 原生启动自动初始化 | `lib/persistence/server-provider.ts:createServerPersistenceProvider` 创建 Pool 后执行多个 ensure；这是 OpenMAIC 惯例，不适用于受限 Identity runtime |
| 事务惯例 | `storage/src/server/reference.ts:nodePostgresTransaction`、runtime 的 WithTransaction：独占 client，BEGIN/body/COMMIT 或 ROLLBACK/release |
| schema 契约测试 | `storage/test/pg-schema-contract.test.ts` pin DDL 和 ensure 发出的语句；提醒 IF NOT EXISTS 不能检测已有结构漂移 |
| 真 PG16 | `.github/workflows/storage-pg-contract.yml` 使用 postgres:16、Node22、PG_CONTRACT_URL 和必跑检查；`pg-runtime-store.pg.test.ts` 有独立连接/barrier/冲突/aborted transaction 测试 |
| 本地/轻量测试 | storage 也支持 PGlite；它和内存 fake 都不能替代受限真实 PG16 RLS 验收 |
| CI 角色差异 | 既有 storage CI 使用 postgres 管理连接；不能据其全绿声称 Identity 的 non-owner RLS 已验证 |

MIGRATION TOOLING：现有内嵌 raw DDL/ensure；未发现可直接用于 Identity 的版本化数据库 migration runner。DSL migrate 是文档结构升级，不是 SQL migration。

RECOMMENDED 1B-3B APPROACH：继续使用已有 `pg`，未来在计划的 Identity Infrastructure migration 目录放顺序编号、不可变的 raw SQL migration，由小型专用 runner 在显式维护命令中执行。runner 是未来新增基础设施，不声称已经存在；不引入 ORM，不 import OpenMAIC private splitter/schema/provider。

runner 最小要求：独立 owner/migrator 连接；同连接 migration 锁；schema-qualified migration ledger（version、checksum、applied time）；每个可事务化 migration 与 ledger 原子提交；重复版本校验 checksum；结构漂移 fail loud；不朴素 split(';')；受控执行整个 migration 或显式 statement array；失败回滚且不记成功。角色 bootstrap 与表 migration 权限分开，runtime 不持 migrator URL。不在 Web 启动或 Repository 构造时执行 DDL。migration ledger 是工具元数据，不是第九个业务聚合。

1B-3B 仅在独立 V2 测试库实施、运行真实约束/RLS测试；Repository 行为实现仍归 1B-4。既有 OpenMAIC `DATABASE_URL`/ensure 不接入 Identity migration，也不改其表、schema、权限或 RLS。

## 3. Schema、值类型与版本

### 3.1 Schema 选择

| 候选 | 权衡 | 推荐 |
| --- | --- | --- |
| public | 易与 OpenMAIC 未限定表名混淆；迁移/默认权限边界不清 | 不采用 |
| zhiban | 与 OpenMAIC 分开，但未来 Course/Learning 共用较宽权限面 | 可用但非首选 |
| zhiban_identity | 所有租户共用一个 Identity schema；便于独立 owner、migration、授权审查 | 推荐 |

这不是“每租户一个 schema”，不改变 ADR-011 的行级 tenant_id 策略。未来 Course/Learning 自有 schema 可另审，不现在创建。默认独立 V2 测试 database；未来与底座同实例/同库不自动共享凭据或权限。

### 3.2 ID

推荐 Domain IDs 用 PostgreSQL `uuid`；应用 IdGeneratorPort 生成 UUIDv7，再经现有 factory 验证。DB 不设 UUID 自动生成 default；Role 的稳定 UUIDv7 常量在代码目录版本中固定，不每次启动随机生成。

PG16 uuid 可以保存不同 UUID 版本，不自行限制为 v7。[PG16 UUID](https://www.postgresql.org/docs/16/datatype-uuid.html)。三种策略：只应用验证最少 DDL 但不能挡直写；**应用验证 + DB CHECK 推荐**；新增扩展不必要。

DB CHECK 候选：对 uuid 的规范文本检查第 15 位为 `7`、第 20 位为 `8/9/a/b`，或等价完整正则；这些是无扩展结构检查，不证明生成时间/唯一性/权限。所有 Identity 主键和 Class/Course 引用一致；nullable 引用另写 NULL 分支。以现有 `ids.ts` 正则为测试 oracle。SessionId 和审计内部序号例外，不滥用该约束。

### 3.3 时间

| 类型 | round-trip / 精度 | 查询/运维 | 裁决 |
| --- | --- | --- | --- |
| bigint epoch-ms | 与 Instant 整数一一对应；无时区、无微秒舍入 | 范围比较直接；显示/日期函数需显式转换 | 推荐 |
| timestamptz | UTC 时刻可表达，但默认微秒精度、驱动 Date 转换和小数毫秒需要额外规则 | 日期函数方便，输出受 session timezone 影响 | 不作 Domain 时间权威列 |

PG16 日期类型支持微秒，驱动 Date 会损失微秒；不是说 timestamptz 不能存毫秒，而是本项目无需承担两套时间语义。[PG16 时间类型](https://www.postgresql.org/docs/16/datatype-datetime.html)、[node-postgres 类型转换](https://node-postgres.com/features/types)。bigint 是精确整数类型。[PG16 numeric](https://www.postgresql.org/docs/16/datatype-numeric.html)。

后文 `ms` 表示 **bigint + CHECK 0 <= value <= 8640000000000000**，nullable 字段允许 NULL。禁止 NaN、Infinity、小数、负数、静默截断、秒/毫秒混淆；不存 ISO 文本为第二权威。driver int8 按十进制 string/BigInt 解析并验证范围，最后转换 number 交 `instant()`；写入先验证，再用十进制参数。禁止全局 int8 parser 无条件 Number 化。

createdAt/updatedAt/occurredAt 等由可信命令 ClockPort 提供；不使用 DEFAULT now() 改写领域事实。DB migration ledger 的 applied time 可单独用 timestamptz，不混淆业务时钟。有限有效期必须 `valid_until > valid_from`，起点 inclusive、终点 exclusive；不允许空区间。SQL 时间函数只用于观察投影，不写回权威字段。

### 3.4 文本状态与版本

推荐 `text + CHECK` 而非 PG ENUM：封闭当前集合，后续显式 migration 调整约束，避免 enum 值回退/删除操作；不可在不兼容旧 reader 时偷偷扩枚举。

| 值 | DB representation |
| --- | --- |
| User status | ACTIVE / DISABLED |
| Tenant status | ACTIVE / DISABLED / ARCHIVED |
| Membership status | PENDING / ACTIVE / DISABLED / LEFT |
| role_code | STUDENT / TEACHER / TENANT_ADMIN |
| scope_kind | SELF / CLASS / COURSE / TENANT |

`authorization_version`：bigint，0..9007199254740991，Membership 新建 0；每个领域有效变化按 Domain +1；失败/no-op 不变，不用触发器每次 UPDATE 无条件 +1。

`repository_revision`：内部 bigint，初始 1，每次成功 create/save/touch/首次 revoke 后返回当前/新 opaque token，UPDATE 在 DB 内 +1，达 bigint 上限拒绝不 wrap。通过 Infrastructure 十进制编码变为 RepositoryRevision，Application 不解码/比较大小。它不受 Domain number 上限限制，不转换成 JS number，不使用 xmin，不与 authorization_version 相加/换算/比大小。RoleGrant child 不独立 revision；audit append-only 不设 revision。

## 4. Ownership Matrix

全部候选由 Zhiban Identity 拥有。表名均在 `zhiban_identity` 下。YES 表示设计要求，非已创建/验证。Credential 已裁决排除 1B-3B DDL，留待 1B-5 冻结契约与补充 schema review。

| Table | Aggregate / owner type | GLOBAL/TENANT；tenant_id | RLS | PK / important unique | FK | Revision | Retention/delete |
| --- | --- | --- | --- | --- | --- | --- | --- |
| users | User，全局自然人 | GLOBAL；无 | 无 tenant RLS | user_id | 无 | 独立 repo revision | disable/restore；无 runtime DELETE |
| tenants | Tenant，控制面目录 | GLOBAL control plane；tenant_id 是自身 PK | NO；不授普通 tenant runtime 直接访问 | tenant_id；code 全局唯一 | 无 | 独立 repo revision | disable/archive，非 hard delete |
| memberships | Membership | TENANT；必填 | YES + FORCE | membership_id；(tenant_id,user_id)；(tenant_id,membership_id) | user、tenant | repo + authorization 两列 | LEFT 保留；不可转 User/Tenant |
| role_grants | Membership child | TENANT；必填 | YES + FORCE | grant_id；(tenant_id,membership_id,grant_ordinal) | (tenant_id,membership_id) 复合 FK | parent revision | append/revoke，历史不删不覆盖 |
| system_admin_grants | 独立控制面 grant | GLOBAL；无 | 无 tenant RLS | grant_id | user | 独立 repo revision | revoke/history |
| credentials（1B-3B 不建表） | Authentication material，延期候选 | GLOBAL；无 | 1B-5 再审 | PK/identifier unique 尚待 1B-5 | user 候选 | 尚未冻结 | 1B-5 独立裁决，不级联删人 |
| sessions | Application session | GLOBAL；无 | 无 tenant RLS | session_id text；token_digest unique | user | 独立 repo revision | revoke/expiry，受控清理延期 |
| audit_events | append-only security evidence | MIXED；Membership事件 tenant-owned；控制面 GLOBAL | YES + FORCE；按封闭事件类别分支 | 内部 event_id bigint identity | 非空 tenant_id → tenants ON DELETE RESTRICT；其余 actor/subject weak refs | 无 repo revision | 不可 runtime 修改/删除，无 cascade |

RoleCatalog / Permission：CODE_OWNED，不建表、role_permissions join table 或 tenant 自定义目录。只有三个受控 Role，一次一个非空版本，RoleId 固定；role_grants 用 role_code CHECK，不加不存在的目录 FK。Permission 来自经过 review 的目录，语法验证不能证明授予权限。目录版本不放 Session、TenantContext；未来目录扩大权限仍需授权版本失效与审计（1B-7/8），不是静态目录就可无审核发布。

## 5. Relational Model（DESIGN ONLY）

通用：N = NOT NULL，Y = nullable。`uuid7` 是前述 uuid + CHECK 的描述，不是本轮创建的 SQL DOMAIN。`revision` 是前述 bigint。所有 CHECK 必须明确 NULL 语义，不能依赖 UNKNOWN 隐式通过来满足必填条件。

### 5.1 users

目的：受限全局身份，匹配 User；不加入 email/phone/profile/avatar/tenant/role/password。

| Column | Type | Nullable | Constraint / mapping |
| --- | --- | --- | --- |
| user_id | uuid7 | N | PK；User.id；不可 UPDATE |
| status | text | N | ACTIVE / DISABLED |
| created_at | ms | N | 不可 UPDATE |
| updated_at | ms | N | >= created_at；更新不倒退 |
| disabled_at | ms | Y | DISABLED 必填且 created_at <= value <= updated_at；ACTIVE 必 NULL |
| disabled_reason | text | Y | DISABLED trim 后非空；ACTIVE 必 NULL；不是 AuditReason code |
| repository_revision | revision | N | 1 起；CAS |

只有 PK 必需索引；不为不存在的 profile 查询加索引。无 tenant RLS；仅受限 Identity 用例连接可访问。禁用 User 与撤销 sessions/audit 必须事务配合；每请求仍检查 User 状态。恢复不能复活已撤销 session。Domain restore 清空禁用字段；当前 AuditPort 只能保留有限 reason code，不能完整保存 disabledReason 自由文本。不声称已保存该文本历史；如业务要求精确保留，须在后续 Application/audit contract review 单独批准脱敏字段，不能直接 dump 文本或扩任意 payload。

### 5.2 tenants

| Column | Type | Nullable | Constraint / mapping |
| --- | --- | --- | --- |
| tenant_id | uuid7 | N | PK，不可 UPDATE |
| code | text | N | UNIQUE；`^[a-z][a-z0-9_-]{0,63}$`；稳定，不是 credential |
| display_name | text | N | 经 Domain trim 后非空，不自行加 255 字符限制 |
| status | text | N | ACTIVE / DISABLED / ARCHIVED |
| created_at / updated_at | ms | N | created 不变；updated >= created 且不倒退 |
| disabled_at / disabled_reason | ms / text | Y | 成对 NULL/非 NULL；非 NULL reason 非空、时间在 created..updated |
| repository_revision | revision | N | CAS |

ACTIVE 禁用对必空；DISABLED 对必非空；ARCHIVED 允许两者，符合 `.archive()` 从 ACTIVE/DISABLED 进入的实际行为。不得新增 archived_at、deleted_at 或自动归档恢复流程作为 Domain 事实。

code 已在 Domain 拒绝大写；不在 DB 默默 lower/trim 接受另一值。建议用确定性字节比较语义保证 ASCII code unique；创建同 code 冲突统一处理。PK + code UNIQUE 为 REQUIRED，不额外为 status 建索引。

TenantRepositoryPort 没有 TenantContext 参数且承担开户/停用/恢复。**已裁决** tenants 为 GLOBAL CONTROL-PLANE，不做 tenant RLS；仅受限控制面实现 TenantRepository，普通 `zhiban_runtime` 无 tenants 直接 SELECT/INSERT/UPDATE/DELETE，也不能继承/SET ROLE 到控制面、owner 或 migrator。Tenant resolution 由受限端点按单 ID/code 查，不返回全目录。备选“tenant RLS + control-plane例外”因引导/恢复循环及旁路风险不进入 1B-3B；不修改 Port。

### 5.3 memberships

| Column | Type | Nullable | Constraint / mapping |
| --- | --- | --- | --- |
| membership_id | uuid7 | N | PK，永久身份 |
| tenant_id | uuid7 | N | FK tenants；不可 UPDATE |
| user_id | uuid7 | N | FK users；不可 UPDATE |
| status | text | N | PENDING / ACTIVE / DISABLED / LEFT |
| authorization_version | bigint | N | 0..9007199254740991；新建 0 |
| repository_revision | revision | N | 独立 CAS |
| created_at / updated_at | ms | N | created 不变、updated 不倒退 |
| disabled_at / disabled_reason | ms / text | Y | DISABLED 成对必填，时间合法；其他状态成对 NULL |

REQUIRED：UNIQUE(tenant_id,user_id)，覆盖 findByUser；UNIQUE(tenant_id,membership_id)，给复合 FK 引用并覆盖 scoped findById。User 与 Tenant FK 均 RESTRICT；不创建同人同租户新资格来代替 rejoin。user_id、tenant_id、id、created_at 不在 runtime UPDATE 授权列内，并以行历史 guard 拒绝变更；即使构造了同 id 的不同 User，也不能被 save 重绑。

RoleGrants 规范化装入 child 表；不存第二份 JSON grant authority。授权版本回退由 Repository 锁内比较 + DB OLD/NEW guard 拒绝；正确 repo token 不能覆盖旧授权快照。相等版本允许 metadata/no-op save，但 status 和完整有序 grant facts 必须相等，不能单凭版本相等接受任意 child writes。这个跨行等价判断由 1B-4 锁内 aggregate save 负责；CHECK/RLS 不证明它。失败不推进任何版本、不写 audit。

### 5.4 role_grants

| Column | Type | Nullable | Constraint / mapping |
| --- | --- | --- | --- |
| grant_id | uuid7 | N | PK，fresh grants 不复用历史 id；全局重复分配也拒绝 |
| tenant_id / membership_id | uuid7 | N | FK (tenant_id,membership_id) → memberships 同列顺序的 UNIQUE |
| grant_ordinal | bigint | N | >=0，parent 内唯一；Infrastructure 顺序元数据，不是领域序号 |
| role_code | text | N | 严格三个 tenant roles，无 SYSTEM_ADMIN |
| scope_kind | text | N | 严格 SELF / TENANT / CLASS / COURSE |
| scope_id | uuid7 | Y | SELF/TENANT 必 NULL；CLASS/COURSE 必非 NULL |
| created_at | ms | N | Domain.createdAt，不要求晚于 Membership.createdAt（现有 fixture 可更早） |
| valid_from | ms | N | >= created_at；使用实际 validFrom，不另建 effective_from 权威列 |
| valid_until | ms | Y | NULL 或严格 > valid_from |
| revoked_at | ms | Y | NULL 或 >= created_at；可早于 future valid_from |

复合 FK REQUIRED 且 RESTRICT：A Membership 不能挂 B RoleGrant，即使 RLS 被维护角色绕过也应失败。RLS USING/WITH CHECK 同时限定 tenant_id。scope_id 只表达 opaque ClassId/CourseId；本期没有业务表，不能伪造 FK、Class/Course entity 或证明资源同租户；交 1B-7/未来 CourseAccessPort。

每次 parent save 先锁 Membership，再处理 child。grant_ordinal 初次按数组顺序赋值，历史不重排，新记录尾部追加；装载 ORDER BY ordinal，才能保留现有 fake 的按索引等价比较。Domain 只要求 Membership 内 grant id 唯一；推荐全局 grant_id PK 是 ID 分配的额外防碰撞，不授予跨租户查找 API。

历史不可变：role/scope/validity/identity/created/ordinal 不可更新；唯一生命周期更新为 revoked_at NULL→首次时间。非 NULL→NULL 或另一时间必须拒绝，重复相同值可 no-op；列权限 + OLD/NEW guard 双保险。不授 runtime DELETE/TRUNCATE。不能删除再插入“同 id 新授权”。无独立 updated_at/revision，parent CAS 保护全数组。有效性仍要 Membership ACTIVE、User/Tenant active；SQL `revoked_at IS NULL` 不等于完整授权。

REQUIRED 索引：PK、(tenant_id,membership_id,grant_ordinal) UNIQUE。OPTIONAL：同 parent 的 revoked_at IS NULL 部分索引，仅在测量有效 grant 读取成本后增加。不得创建依赖 now() 的“当前有效”部分索引；时间在查询参数中判断。全局 tenant 单列索引暂不需要，parent 索引前缀已覆盖。

### 5.5 system_admin_grants

| Column | Type | Nullable | Constraint / mapping |
| --- | --- | --- | --- |
| grant_id | uuid7 | N | PK |
| user_id | uuid7 | N | users FK RESTRICT；不可重绑 |
| created_at / valid_from | ms | N | valid_from >= created_at |
| valid_until | ms | Y | NULL 或 > valid_from |
| revoked_at | ms | Y | NULL 或 >= created_at；首次撤销不可改 |
| repository_revision | revision | N | 独立 CAS，不用 Membership revision |

无 tenant_id、membership_id、scope、role_code、额外 status 或 updated_at。REQUIRED PK；user_id 索引便于引用检查，未来当前控制面授予查询需单独 Port/用例审阅。独立控制面 DB 权限；tenant runtime 无 SELECT/INSERT/UPDATE。SYSTEM_ADMIN 不是数据库 superuser，不获得 BYPASSRLS 或所有 tenant data read。

### 5.6 credentials — EXCLUDED_FROM_1B3B / DEFERRED_TO_1B5（D01 CLOSED）

现有 CredentialVerifierPort 仅 `identifier:string + secret:string → VERIFIED(UserId) / REJECTED`，没有 credential ID、identifier kind、normalization、CRUD、状态或 hash 算法 contract。不能据此冻结一个可执行 credentials schema。

| 候选列 | 候选类型/空值 | 目前裁决 |
| --- | --- | --- |
| credential_id | uuid7 或内部 key，N | ID 所有者/生成 Port 未定，不假装已有 IdGenerator 方法 |
| user_id | uuid7，N，FK RESTRICT | 全局 User 关联明确；不是 Tenant 下登录账户 |
| credential_type / identifier_kind | 受控 text，N | 枚举与种类在 1B-5 确认；不预设 email/phone/username |
| normalized_identifier | text，N | 规范化/大小写/国际化规则未定；UNIQUE(kind,value) 仅候选 |
| verifier_material | text，N（密码型候选） | opaque、自描述 encoded hash；不可 plaintext；不重复拆 PHC 已包含的 salt/参数 |
| status | 受控 text，N（候选） | 不复用 User status 猜测凭据生命周期 |
| created_at / updated_at | ms，N（候选） | 生命周期待认证 contract 明确 |
| repository_revision | revision（候选） | 如存在更换/revoke 写接口才落实 CAS |

不建一个“以后再填字段”的空壳表，也不混进 users。**已裁决** 1B-3B 不建 credentials 表、占位列或猜测的 identifier UNIQUE。顺序为 1B-5 冻结 Credential 契约 → 补充 schema review → 单独 migration → 实现；不得反过来用表形状决定认证模型。没有 credentials 表不影响本批 Identity 聚合持久化，但禁止声称登录可用或凭据持久化完成。

只存 verifier/hash，不记录明文、secret、重置 raw token。PHC/具体 Argon2 实现与参数、pepper/key 管理、identifier unique、凭据撤销/删除由 1B-5 评审；本轮不读取 V1，也不推断生产 hash 可迁移。

### 5.7 sessions

| Column | Type | Nullable | Constraint / mapping |
| --- | --- | --- | --- |
| session_id | text（精确 opaque value） | N | PK；非空/非全空白，不 trim 成另一 id；非 UUID 强制 |
| user_id | uuid7 | N | users FK RESTRICT；不可重绑 |
| token_digest | text（精确 opaque value） | N | UNIQUE；非空/非全空白；不存 raw token |
| created_at | ms | N | 不可改 |
| last_seen_at | ms | N | touch 唯一可改时间之一 |
| absolute_expires_at | ms | N | touch 不可延长，create 后不可改 |
| idle_expires_at | ms | N | touch 另一可改时间 |
| revoked_at | ms | Y | 首次 revoke，后续不覆盖/清空 |
| repository_revision | revision | N | CAS touch；首次 revoke/revokeAll 更新 |

选择 text 而非 bytea：Port 没有固定 digest 算法/编码，bytea 解码会提前假设 hex/base64；以后确定二进制格式再单独 review。DB 类型本身不能鉴别一个 string 是否 raw token；1B-6 必须证明 token→digest 的可信生成边界，禁止 raw token 到 Repository/log/audit。

不建 tenant_id、activeTenant、Membership snapshot、roles、permissions、refresh token 或第二种 access token。8h/30min 属于可配置策略，不做写死 CHECK。当前 Port/fake 未验证 lastSeen/expiry 时间排序：首批 DB 只强制各时间为有效 Instant，不擅加 `idle <= absolute`（实际有效期可取二者最早）、不修改既有契约。未来 Session 服务必须拒绝过期/倒退/恶意延长，新增结构性时间规则须在 1B-6 contract review 明示。

REQUIRED：PK、digest UNIQUE、(user_id) WHERE revoked_at IS NULL 支持 revokeAll。OPTIONAL：absolute_expires_at、idle_expires_at 两条清理索引，待保留窗口和清理任务确定。没有普通 runtime hard delete；维护角色按未来批准的 expiry/retention 清理，Audit weak refs 保留证据。

## 6. Audit 持久化（D02 CLOSED）

### 6.1 物理方案裁决

| 方案 | 复杂度/查询 | 安全/演进 | 推荐 |
| --- | --- | --- | --- |
| common columns + **sanitized event-specific JSONB** | 一表/一条 append，公共索引；事件专有查询需受控提取 | 必须封闭 type/keys/嵌套结构验证；新事件显式升级 shape version | 推荐，匹配 18 类型有限 union |
| fully normalized event-specific child tables | FK/类型约束强，但众多事件表、数组 child 和多表事务 | 仍需 whitelist；不会因正规化自动无敏感数据 | 保留备选，当前成本偏高 |

JSONB 只存 factory 投影后的**事件专有 facts**，绝非任意 JSON dump。**裁决采用一张** mixed-ownership `audit_events`：`event_scope` + event_type 固定映射 + 按角色分支的 INSERT policy；不是由 nullable tenant_id 单独决定归属。拆成 global/tenant 两表仅为已评估备选，不进入 1B-3B。DB 形状/权限约束属于 1B-3B 退出验收；业务写入与 audit 同事务属于 1B-4/1B-8，不冒称已由单表自动保障。

### 6.2 columns

| Column | Type | Nullable | 来源/约束 |
| --- | --- | --- | --- |
| event_id | bigint identity | N | 内部 PK/游标，不是 Domain ID，不新增 IdGenerator 方法；非提交顺序证明 |
| event_shape_version | integer | N | 初版 1；Infrastructure serializer 版本，非 RoleCatalog version |
| event_type | text | N | 当前 18 项 CHECK，无任意 type |
| event_scope | text | N | GLOBAL / TENANT；由 event_type 确定，不接受调用者自由选择 |
| occurred_at | ms | N | event.occurredAt |
| actor_type | text | N | USER / SERVICE / SYSTEM |
| actor_user_id | uuid7 | Y | 仅 USER 必填，其余 NULL |
| actor_service_code | text | Y | 仅 SERVICE 必填；`^[a-z][a-z0-9_-]{0,63}$` |
| request_id | text | Y | NULL 或 `[A-Za-z0-9._:-]{1,128}`；可信 correlation，不作为幂等唯一 key |
| reason | text | N | 当前 8 reason codes，非任意字符串/object |
| tenant_id | uuid7 | Y | TENANT 事件必填；TENANT_* 控制面事件也必填 subject Tenant；其他 GLOBAL 事件 NULL；非 NULL 时 FK → tenants(tenant_id) ON DELETE RESTRICT |
| subject_user_id | uuid7 | Y | 含 userId 的事件必填；TENANT_*、AUTHENTICATION_REJECTED 为 NULL |
| subject_membership_id | uuid7 | Y | 仅 MembershipFacts 类事件必填 |
| authorization_version_before / after | bigint | Y | MembershipFacts 两列同时必填，0<=before<after<=9007199254740991；其他 NULL |
| event_payload | jsonb | N | 精确事件专有 object；无专有 facts 时 `{}`；封闭 shape 校验 |

不额外放 generic target_type/target_id 或 actor JSON；已有 subject 列 + type 足够定位。Grant/session subject 在受控 event_payload 中；不为 JSON 任意键加 GIN 索引。不设 updated_at/repository_revision；event_id 是 append 游标，不是发生顺序、业务版本或 exactly-once key。

### 6.3 type/ownership/payload 封闭映射

| event_type（完整 18 项分组） | event_scope | 必需 subject / 专有 payload |
| --- | --- | --- |
| USER_CREATED、USER_DISABLED、USER_RESTORED | GLOBAL | subject_user_id；payload={} |
| TENANT_CREATED、TENANT_DISABLED、TENANT_RESTORED | GLOBAL | tenant_id 是控制面目标；payload={}；不能因有 tenant_id 自动给 tenant reader |
| MEMBERSHIP_DISABLED、MEMBERSHIP_LEFT | TENANT | tenant/member/user/versions；payload={} |
| MEMBERSHIP_REACTIVATED | TENANT | 同上；payload 精确 mode、priorGrantIds、approvedGrants |
| MEMBERSHIP_ACTIVATED、MEMBERSHIP_REJOINED、ROLE_GRANTS_REPLACED | TENANT | 同上；payload 精确 priorGrantIds、approvedGrants |
| ROLE_GRANT_GRANTED、ROLE_GRANT_REVOKED | TENANT | 同上；payload 精确 grant |
| SYSTEM_ADMIN_GRANT_GRANTED、SYSTEM_ADMIN_GRANT_REVOKED | GLOBAL | subject_user_id；payload 精确 grantId |
| SESSION_REVOKED | GLOBAL | subject_user_id；payload 精确 sessionId（opaque text） |
| AUTHENTICATION_REJECTED | GLOBAL | 无 subject identifier；payload={}；不能加入提交的 identifier |

grant fact 精确为 id、roleCode、scope(type,scopeId)、validFrom、validUntil；不增加整个 RoleGrant 的其他字段。priorGrantIds/approvedGrants 必为数组、无重复，明确空数组合法；activation/rejoin/replace 新批准 ID 与 prior 不相交。reactivation mode 仅两个冻结值；审批真实来源和 Domain before/after 一致性在同事务校验，factory brand 不证明权限。

reason 精确为 ADMIN_REQUEST、USER_REQUEST、ACCESS_REVIEW、SECURITY_POLICY、INVITATION_EXPIRED、ACCOUNT_RECOVERY、CREDENTIAL_REJECTED、SYSTEM_MAINTENANCE。Domain.disabledReason 的自由文本不能直接 cast 为 reason；Application 选择已批准 reason code，不能在 requestId/服务代码偷塞敏感正文。

### 6.4 写入与防泄漏

`AuditPort.append` 先要求实际 `requireIdentityAuditEvent` 通过；Infrastructure 再逐字段序列化（包括嵌套 scope/grant），不 object spread 未知输入，不 JSON.stringify(request/command/aggregate)。WeakSet issuance 不能跨进程/JSON 保留；未来持久读取需验证 event shape 并重走 factory，不 cast DB row。

DB 对 event_type、event_scope、actor shape、必填 subject、reason、version、payload 精确允许 keys/type/嵌套 grant shape 作拒绝式校验；设计不采用“去掉几个 secret key 后其余任意保存”。可用专用纯校验 helper/约束完成，不能引入泛型 JSON schema 平台或只查顶层。恶意直写未知 key 应失败；合法路径的多余输入由 factory 投影丢弃。审计字段的合法语法不证明字符串内容无 secret，requestId 必须来自可信生成/验证边界。

SENSITIVE DATA DENYLIST：raw password、password hash、secret/verifier material、raw session token、token digest、API key、provider credential、browser cookie、Authorization header、CSRF/reset token、Credential request/任意 HTTP body。禁止 DB query 参数、异常 detail、pool URL 被日志输出。

Audit 的**非空 tenant_id 强 FK** 指向 tenants，`ON DELETE RESTRICT`，包含 TENANT 事件及 `TENANT_*` 控制面事件；创建 Tenant 的事务应先写 Tenant 行，再写 TENANT_CREATED audit。actor_user_id、subject_user_id、subject_membership_id 保留 weak references，不因人员/资格后续受控删除而抹去历史，亦支持 authentication failure 和系统事件。所有 ID 结构照样验证；实时成功 mutation 的 audit subject 必须与锁定 aggregate 一致，不能把 weak ref 当作不验证理由。retention/purge 另审，runtime append-only、无 UPDATE/DELETE/TRUNCATE。追加失败使业务事务回滚；不能 fire-and-forget。

REQUIRED 索引：event_id PK；tenant-owned 的 (tenant_id,occurred_at,event_id) 部分索引。OPTIONAL：actor_user_id/time；subject_membership_id/time、subject_user_id/time。SERVICE actor、grant/session JSON表达式索引等到明确审计查询再加。未批准任何审计浏览 API，TENANT_ADMIN 不自动获得本租户所有安全事件。

当前 union 无 TENANT_ARCHIVED、SESSION_CREATED 或 MEMBER_CREATED。本文不新增事件、伪装成 RESTORED/CHANGED；对应未来用例若需要审计，1B-8/相关批次先补 contract review。不妨碍 schema 表达 ARCHIVED 历史状态。revokeAll 可为每个首次撤销 session 生成现有 SESSION_REVOKED；不能把一个不存在的模糊“全部更改”事件写入。

## 7. RLS Contract

### 7.1 四层隔离及其威胁边界

Application scoping + Repository 显式 tenant predicate + PostgreSQL RLS + composite constraints，四层都必须存在。TenantContext 公开工厂只有范围形状验证，不是 authentication/Membership/authorization proof。Application 先验证 Session/User、Tenant、Membership、当前 grant/Policy；高风险写在提交事务中复核，禁止只检查 UI。

RLS 防漏 WHERE、错对象 ID、错 scope 的行读写；**不能识别持有 DB runtime 凭据的攻击者是否有权把 GUC 改成另一个合法 Tenant**。客户端不能执行 SQL/set_config，不接受请求直接透传 GUC；SQL 注入、runtime 凭据泄露仍是严重风险，由参数化查询/权限隔离/凭据保护处理。不宣称 RLS 可替代授权、抵御 superuser 或任意恶意 DB client。

对于“Tenant A ID + Tenant B context”：A 行不可见/不可写；对于“用户属于 A，但提交 B 候选”：Application 在进入 B transaction 前拒绝。两种测试都必须覆盖；不能把第二种错误寄希望于数据库从 UUID 自动推断用户资格。

### 7.2 Transaction-local context

候选流程（文字协议，不是可执行 migration）：

1. Application 完成候选校验，构建固定 TenantContext；无/非法 context 不借连接执行业务 SQL。
2. 从 **Identity tenant runtime pool** 借独占 client，确认不存在活跃旧 transaction；禁止共享一个 client 并发事务。
3. BEGIN；参数化 `set_config('app.tenant_id', canonicalTenantId, true)`；读回校验本次 context。不是连接级 SET，不使用 `false`；不在自动提交单语句外设置后另取连接查询。
4. 在同 client 中执行所有 scoped SQL；显式 `tenant_id = 当前可信TenantId`，与 GUC 一致。BEGIN、scope 设置、查询和 COMMIT 不能分别用 pool.query。
5. 成功 COMMIT；任何错误 ROLLBACK。finally 仅在已结束 transaction 后 release；连接/rollback 状态不确定则销毁，不把污染连接归还。
6. 下一次借用不继承请求的 tenant；成功/失败/rollback 后检查上下文是 NULL 或空（视 GUC 生命周期），必须按无 context 拒绝。若存在非空会话级默认/残留，销毁并报配置问题；禁止用残留作 fallback。每次业务事务都显式设定，不仅首次连接初始化时设。

`set_config(...,true)` 只在当前事务有效，`current_setting(...,true)` 在缺失时返回 NULL；这是选用它而非 session setting 的原因。[PG16 configuration functions](https://www.postgresql.org/docs/16/functions-admin.html#FUNCTIONS-ADMIN-SET)。node-postgres 事务必须使用同一 client。[node-postgres transactions](https://node-postgres.com/features/transactions)。

### 7.3 Pure context resolver（D03 CLOSED）

策略表达式只调用专用 `zhiban_identity.current_tenant_id()` 候选：**SECURITY INVOKER 的纯解析器**，仅读取 `current_setting('app.tenant_id',true)`；NULL/空/非法 UUIDv7（含 v4）返回 NULL；先结构验证再 cast，不依赖 SQL AND 的求值顺序。合法 UUIDv7 返回规范 UUID，**即使 tenants 中不存在**，也不查询表。NULL 的策略表达式不能得到 TRUE；合法但不存在的 UUID 与现有行不匹配，也不会变成全表 fallback。不得以 `IMMUTABLE` 或跨事务缓存上下文；按 statement 读取的 `STABLE` 候选须由真实 PG16 测试验证。

该解析器不是 Identity Port，不做认证、Tenant 存在/状态、Membership 或角色权限判断；不具 `SECURITY DEFINER` 的提权能力。普通 `zhiban_runtime` 不取得 tenants 的直接 SELECT/INSERT/UPDATE/DELETE，也不使用租户存在性 helper。Tenant FK、Membership→RoleGrant 复合 FK 与审计 tenant FK 分别保证相应写入引用的物理完整性。

未知但格式合法的 TenantId：Membership/RoleGrant 读取零行，Membership 插入由 tenants FK 拒绝，RoleGrant 插入由 parent/复合 FK 拒绝，非空 tenant_id 的审计插入由 tenants FK 拒绝；UPDATE/DELETE 不触及其他 tenant 行。FK 错误不得把存在性细节返回给调用者。以上是待 1B-3B 真实受限角色测试证明的设计，不是当前已验证结果。

Tenant disabled/archived、User disabled、Membership disabled 的**业务拒绝**由 Application/Policy 执行；RLS 只负责租户隔离，不过滤掉必须供管理员审核的 disabled/left 历史。Tenant 恢复也不暗中恢复 Membership。涉及全局 User/Tenant 状态与 tenant 写入的同事务新鲜度/锁协议保留为 1B-4/1B-7 用例级设计与测试，**不在 1B-3B 建通用提权 helper**。

### 7.4 Policies 与 privileges

Membership、RoleGrant 启用 ENABLE + FORCE ROW LEVEL SECURITY，runtime 永不 owner。行级策略只对明确 runtime role 生效，不对 PUBLIC 随意开放；避免另加 `USING(true)` 的 permissive policy 通过 OR 扩大权限。

| 操作 | 行条件（USING） | 新行条件（WITH CHECK） | 额外限制 |
| --- | --- | --- | --- |
| SELECT | row.tenant_id = resolved context，必须 TRUE | 不适用 | Repository 同样带 tenant predicate；跨租户 find 返回 null |
| INSERT | 不适用 | new.tenant_id = context | parent FK/unique/closed values 全部通过 |
| UPDATE | old.tenant_id = context | new.tenant_id = context | immutable id/user/tenant 另挡；列权限和 CAS，不能只检查旧行 |
| DELETE | old.tenant_id = context 是任何未来获批删除的最低要求 | 不适用 | 本期无 DELETE grant、无允许 DELETE policy；同租户也不能 hard delete |

既限制可见旧行，也限制写入的新行；NULL 不代表开放。[PG16 CREATE POLICY](https://www.postgresql.org/docs/16/sql-createpolicy.html)。RLS 并不保护 TRUNCATE，runtime 不授该权限；table owner通常绕过，FORCE 不能限制 superuser/BYPASSRLS。[PG16 row security](https://www.postgresql.org/docs/16/ddl-rowsecurity.html)。FORCE 为 defense-in-depth，不是 owner 可以当 runtime 的理由。

### 7.5 Mixed audit RLS（D02 CLOSED）

策略必须从**事件类别**判断归属，不能写成 `tenant_id IS NULL OR tenant_id = currentTenant`。

| DB capability | audit policy / privilege |
| --- | --- |
| tenant mutation runtime | 仅 INSERT TENANT 事件，tenant_id = resolver 且 type 属于八个 MembershipFacts 类事件；无 audit SELECT/UPDATE/DELETE |
| global identity/auth/control runtime | 仅 INSERT GLOBAL 且只允许其职责事件；TENANT_* 中的 tenant_id 是控制面目标，不因此变为 tenant audit |
| 未来 tenant audit reader | 当前不创建/授予；若另批批准，只能 SELECT TENANT + 显式 context + Application Policy |
| 未来 global security audit reader | 当前不创建/授予；仅 GLOBAL。读取 tenant security evidence 必须另行显式 tenant use case，不给全表 bypass |
| migration owner | 只维护结构/隔离测试 setup；不作为日常审计读写服务 |

八个 TENANT event types：MEMBERSHIP_DISABLED、MEMBERSHIP_LEFT、MEMBERSHIP_REACTIVATED、MEMBERSHIP_ACTIVATED、MEMBERSHIP_REJOINED、ROLE_GRANTS_REPLACED、ROLE_GRANT_GRANTED、ROLE_GRANT_REVOKED。其他十个 GLOBAL。shape CHECK 同时固定 event_scope/subject/payload，防伪装 GLOBAL 绕过租户策略。global写入角色不具 Membership/RoleGrant table grant，不与 tenant role 互相继承；审阅实际角色 closure，不能只看单个 policy。

### 7.6 Background jobs / SystemAdmin

Background job = 受控 ServiceActor + 明确 Tenant + 同样授权/transaction-local scope；一个事务只处理一个 tenant，不走 unscoped batch fallback。SYSTEM_ADMIN 的控制面 grant 不映射 DB BYPASSRLS；若未来允许某控制面操作访问 tenant 数据，仍显式 tenant context/permission/use case，不能获得所有教学证据。

## 8. Database Role / Privilege Model（D03 CLOSED）

PostgreSQL DB roles 不等于 STUDENT/TEACHER 等业务角色；浏览器永远拿不到数据库连接。目标所有 runtime identities 都是 NON_SUPERUSER、NON_OWNER、NOBYPASSRLS、NOCREATEDB、NOCREATEROLE；不属于 owner/migrator，不获得 SET ROLE 到它们的能力。单独写 NOINHERIT 不足以排除 SET ROLE，须检查 role membership/options。

| 角色候选 | 权限目标 | 禁止 |
| --- | --- | --- |
| zhiban_identity_owner（NOLOGIN） | 拥有本 schema/tables/受审 helper | 无日常应用登录 |
| zhiban_migrator | 经维护授权切 owner 执行 migration；凭据仅维护环境 | 不进 Web pool；不是生产用例 principal |
| zhiban_runtime | Membership/RoleGrant scoped SELECT/INSERT、最小列 UPDATE；tenant audit INSERT；纯 SECURITY INVOKER context resolver EXECUTE | 无 tenants/users/credentials/sessions/system-admin 表直接 SELECT/INSERT/UPDATE/DELETE、无 audit SELECT、无 DDL/DELETE/TRUNCATE |
| zhiban_auth_runtime | 身份验证所需 User 读、Session create/find/touch/revoke、有限 GLOBAL audit INSERT | 无 tenant tables/控制面授予；Credential 权限等待 1B-5 |
| zhiban_control_runtime | User/Tenant/SystemAdminGrant 受控方法、全局管理 audit；User disable 时 Session 撤销所需最小列权限 | 无 tenant data blanket read；不读 token_digest、不改 Session identity/expiry |

各 runtime 只 CONNECT 到隔离 V2 库、USAGE 本 schema、明确对象/列权限、必要 identity sequence 权限，不授 `ALL TABLES/ALL SEQUENCES` blanket grant。未来对象 default privileges 明确 owner，PUBLIC 不自动 EXECUTE 新 helper。禁止 runtime CREATE schema/table/function、ALTER、DROP、DISABLE RLS、TRUNCATE、REFERENCES/触发器安装、owner role membership。

读全局 User/Tenant 状态与 tenant 高风险写的同事务复核不能靠两个 pool 的独立快照冒充原子性。具体用例所需的最小状态读取、锁顺序与权限机制在 1B-4/1B-7 审阅和测试；**1B-3B 不建立通用 global-status 或 tenant-existence SECURITY DEFINER helper**，也不因此把整个全局表 SELECT 授给 tenant runtime。这一延期不解除 Application 在执行业务写入前校验 User/Tenant/Membership/授权状态的责任。

若部署把多个 pool 凭据都放在一个进程，DB privilege 拆分不等于抵御该进程全失陷；它主要约束误接线/误查询。生产机密隔离是后续部署 Gate，不在本轮执行。

search_path 推荐只可信 `pg_catalog, zhiban_identity, pg_temp`，所有业务表/helper 仍显式 schema-qualified；public/用户可写 schema 不加入路径，不依赖环境默认。runtime 无 CREATE/TEMP（检查 PUBLIC 继承），固定 helper search_path 与 owner、撤 PUBLIC EXECUTE。可写 schema 出现在 search_path 就引入对象替换风险。[PG16 schemas](https://www.postgresql.org/docs/16/ddl-schemas.html#DDL-SCHEMAS-PATH)。这些权限只在独立 V2 库未来设定，不改变 OpenMAIC/生产库的 PUBLIC ACL。

## 9. 外键、索引与保留

| 关系 | FK / ON DELETE 推荐 | 理由 |
| --- | --- | --- |
| User → Membership | user_id / RESTRICT | 不因删人抹去资格历史 |
| Tenant → Membership | tenant_id / RESTRICT | archive 不是删除 |
| Membership → RoleGrant | (tenant_id,membership_id) / RESTRICT | DB 独立防跨租户挂接、保留撤销记录 |
| User → SystemAdminGrant | user_id / RESTRICT | 控制面授权历史 |
| User → Session | user_id / RESTRICT | 禁用/撤销分离；未来按政策清理 session |
| User → Credential | 若未来建表则 user_id / RESTRICT 候选 | 撤销/替换 verifier 不级联 User；1B-5 决定 |
| Tenant → Audit | 非空 tenant_id FK / RESTRICT | unknown Tenant 审计写入拒绝；已有审计时不能 hard delete Tenant |
| Audit → subject/actor | 结构验证 + weak refs，无 hard FK/cascade | 人员/资格历史不随后续匿名化/删除消失，失败认证无 subject |
| Scope → Course/Class | 无 FK | 外域尚未实现；现在不能证明存在/同租户关系 |

不默认全表 deleted_at。disabled 是禁止使用且保留 identity；LEFT/ARCHIVED/revoked 分别属于既有生命周期。hard delete/匿名化/清理必须独立保留政策审批；不创建自动 cascade 或删库回滚。弱引用 audit 仍包含人员关联 ID，应受严格读取/保留保护，不把它称为匿名数据。

PK/UNIQUE 自动提供的索引不重复建；FK referencing 侧按需要显式索引。Membership tenant-first unique 已服务 scoped lookup；全局 user_id FK 维护索引可作为 OPTIONAL；大量数据后按执行计划添加，不现在建立学习数据查询索引。所有全局 unique/FK 的异常经脱敏映射，不能返回“该 ID 属于 Tenant B”。约束检查可跨过 RLS 检查完整性，存在侧信道，不能把错误 detail 透出。[PG16 row security / referential integrity](https://www.postgresql.org/docs/16/ddl-rowsecurity.html)。

## 10. Concurrency / Transaction Matrix

### 10.1 写协议与两种版本

User/Tenant/Membership/SystemAdminGrant save：先在同事务加载/锁当前行，校验 immutable identity、expected RepositoryRevision 和领域 snapshot；再 CAS update。成功 repo revision 加一。不存在/跨租户不能用无 scope 查询“确认到底在哪”。Membership 要独立校验 auth version 不下降、updatedAt 不倒退、相等版本时完整授权状态不变；grant历史不得丢失/改写。

不强制 `incoming authVersion = old+1`：当前 Port 允许调用方在内存连续多个合法 Domain 操作后 save 较高版本；是否允许应用合并命令由 1B-8 定义。Domain 单命令仍 +1。对高版本也不能跳过历史不可逆校验。每次已执行的 save 都产生 fresh repo revision，即便 auth version 相同；应用看到 Domain no-op 时应不发多余 save/audit。

全部 child 改动锁 parent，固定顺序（global 状态锁 → tenant/操作者资格 → 目标 memberships 按 ID → grants 按 ordinal/ID → sessions 按 ID → audit append）；跨聚合锁协议在 1B-4/7 验证。复核 operator grant ceiling/最后管理员不能只锁目标；同 tenant 高风险管理员变化需一致序列化点。默认 READ COMMITTED + 显式行锁/CAS；不靠“先查后写”自动安全。PG 并发 UPDATE 会等待并重新检查条件，真实两连接测试仍必需。[PG16 transaction isolation](https://www.postgresql.org/docs/16/transaction-iso.html)。

### 10.2 Matrix

| Operation | Tables touched | Version/lock checked | Audit event | 原子性要求 |
| --- | --- | --- | --- | --- |
| activate pending | memberships、role_grants、audit | parent repo + expected auth；User/Tenant/审批复核 | MEMBERSHIP_ACTIVATED | revoke 所有预置 grant，append fresh approved；保留历史；状态/version/audit 一次提交 |
| disable Membership | memberships、audit | parent 两版本 | MEMBERSHIP_DISABLED | grants 保留但不授权，状态/disabled facts/version/audit 原子 |
| reactivate preserve | memberships、role_grants、audit | parent 两版本 + 当前有效/显式审批 | MEMBERSHIP_REACTIVATED，PRESERVE 模式 | 仅批准的现存当前有效 ID；未选的包括 future 全撤销，不能日后自动生效 |
| reactivate replace | 同上 | parent 两版本，新 ID、fresh approval | MEMBERSHIP_REACTIVATED，REPLACE 模式 | 旧 grants 不覆盖/不删除，新批准 grants append；未来新批准的有效期可保留 |
| leave | 同上 | ACTIVE、parent 两版本 | MEMBERSHIP_LEFT | 撤销尚未撤销项；原 revokedAt 不动；LEFT/version/audit 原子 |
| rejoin | 同上 | LEFT、parent 两版本，新的 approved list | MEMBERSHIP_REJOINED | 复用 MembershipId；不可复用旧 grant ID；空新集合须显式 |
| grant role | 同上 | parent两版本、grant ceiling/scope facts | ROLE_GRANT_GRANTED | append new ID，不“更新角色”覆盖旧条 |
| revoke role | 同上 | parent两版本 | ROLE_GRANT_REVOKED | 首次撤销 + authVersion；重复撤销 no-op，不改变旧时间 |
| replace active grants | 同上 | parent两版本 | ROLE_GRANTS_REPLACED | 与 replacement 历史规则一致 |
| revoke session | sessions、audit | 原子 current-row 更新，不依赖旧 expectedRevision | SESSION_REVOKED | 首次撤销增加 repo revision；只撤销，不更新活动状态；audit 同事务 |
| revokeAll user sessions | sessions、audit；需要时锁 users | 锁/更新符合 user 的未撤销行，统一协议 | 每条首次撤销 SESSION_REVOKED | 不能逐个独立 commit；任一 audit 失败回滚整批 |
| revoke SystemAdminGrant | system_admin_grants、audit | 自身 repo revision，可信 actor | SYSTEM_ADMIN_GRANT_REVOKED | 首次时间不可覆写，审计原子 |
| User disable | users、sessions、audit | User repo revision + user/session 锁 | USER_DISABLED + 实际首次 SESSION_REVOKED | User状态、会话撤销、audit 原子；后续请求重查 User |
| Tenant restore | tenants、audit | Tenant repo revision | TENANT_RESTORED | 不更新 Membership/grants/session |

pending-origin grant 能否通过 disabled PRESERVE 重新批准，仍是 **1B1-F05 deferred to 1B-8**：数据库保留足够历史，不自行加入 hidden approval policy。pending→ACTIVE 的 activatePending 已明确 fresh replacement；与上述延期不是同一条路径。

### 10.3 Session revoke 优先

touch 仅原子修改 last_seen_at、idle_expires_at 和 repo revision，必须匹配 id + expectedRevision + revoked_at IS NULL；永不更新 revoked_at/user/digest/absolute expiry。匹配失败在同事务当前行锁/读取下区分：不存在 null；revision 不同 STALE_WRITE（先于 revoked 判断）；相同 revision 但已撤销 null 且不更新 lastSeen。

revoke(id,at) 不携带旧 snapshot，不受普通 touch revision 变化永久阻挡；当前未撤销行设置首次 revokedAt、递增 revision。重复 revoke 无变动、不覆盖首次时间。顺序① revoke → old touch 必失败；顺序② touch → revoke 最终撤销。revokeAll 给每个首次撤销行递增 revision，使所有旧 touch token 失败。

revokeAll 和新 session create 的线性化需明确：候选使用相同 User 行锁，将 issuance 与撤销事务排序；全局 User disable 在锁内复核状态，不能被并发登录绕过。撤销之后的**新有效登录**不等于旧 session 复活；“撤销所有会话”不永久禁用 User。具体 issuance/重认证策略留 1B-6，不能只靠当前 fake 宣称所有登录竞态已解决。

### 10.4 Audit 与事务装配

现有 AuditPort 没有 transaction 参数，append 独立签名不提供原子性。未来 Infrastructure composition 必须给一次用例的 Repository 与 Audit adapter 绑定**同一个 client/transaction**；Audit adapter 不自己 commit，也不能另取 pool connection。Application 调用依旧是已有 Ports，不新增通用 UnitOfWork、不把 pg.Client 泄露到 Domain/Ports。

revokeAll 的 Port 返回 void，当前不提供 changed IDs。未来可由同事务的 Infrastructure 装配记录 `RETURNING` 的已变化 session IDs，结合可信 Application actor/reason 产生逐条现有事件；不能查询另一个快照猜测、不能由 DB trigger 伪造 USER actor。mixed audit 物理布局已在 D02 裁决；上述装配及同 client/事务证明延期 1B-4/1B-8，不宣称当前契约已实现原子 append。

Schema可支持原子提交，但不靠表结构证明业务必写 audit。1B-4/8 验收注入 audit 失败必须证明 state/grants/revision 全回滚；未满足不得启用写用例。不要为此现在建 outbox/event bus。

requestId 可空且可对应多事件，不设 request_id UNIQUE。已提交但客户端收不到结果不能盲目重放；按最新 state/revision 判断，避免重复 grant。command idempotency/审计 exactly-once 需要 1B-8 独立契约，当前不凭 event_id 或 nullable requestId 假造该保证。

## 11. 不变量责任矩阵

| Invariant | Domain | Application | Database | RLS | Transaction |
| --- | --- | --- | --- | --- | --- |
| UUIDv7 / Instant / closed enum | factory 校验 | 输入/ID来源 | 类型+CHECK | context形状 | 装载失败整体拒绝 |
| User/Tenant/Membership禁用语义 | 局部状态机 | 跨聚合状态/当前授权 | 合法静态组合；非完整转换证明 | 不代替active检查 | 写前复核/锁 |
| unique(user,tenant) | 无DB查询 | 接受邀请资格 | UNIQUE | 禁止外租户行 | 并发冲突统一失败 |
| Membership身份不可重绑 | readonly/操作 | 不提供transfer捷径 | 列权限+OLD/NEW guard | old/new tenant一致 | save比较stored IDs |
| grant与Membership同tenant | 引用契约 | 不信任客户端tenant | **composite FK** | tenant谓词 | 原子parent/child |
| SYSTEM_ADMIN非tenant role | RoleCode拒绝 | 控制面单独审批 | CHECK | 无role绕过policy | 控制面grant单独save |
| Scope ID合法/业务关系 | 类型与组合 | Course/Class存在/归属/关系 | uuid+组合CHECK，无跨域FK | 不证明Class关系 | 敏感写复核 |
| preserve/replace/rejoin | 显式模式/批准集合、历史 | 审批真实性/grant ceiling | 历史不可改；不能只靠CHECK证明审批 | 同tenant | before/after/grants/audit原子 |
| 授权版本不退/相等不改授权 | command expected version | 新鲜facts | 范围+不回退guard | 非版本锁 | parent锁+独立CAS+grant比较 |
| Session撤销不可被touch恢复 | 不属Domain | expiry/User/会话策略 | 首次revoke不可改、revision列 | 不伪tenant隔离 | touch/revoke/revokeAll原子 |
| audit不泄漏/不丢事实 | before/after事实 | 可信actor/reason/事件 | closed shape + append-only | 归属限制 | audit失败整个业务回滚 |
| operator ceiling/最后管理员 | 后续纯Policy | 1B-7/8 | 不发明静态CHECK求解跨行授权 | 只隔离tenant | operator/tenant一致锁/重试 |

CHECK 只描述单行允许值，不能使用当前时间动态决定 grant effective、证明操作者审批或代替跨行事务。DB保护足够字段和局部历史；从正确 schema 到安全系统仍需要后续 Repository/Policy/Session Gate。

## 12. DB 错误映射（设计，不实现）

依据 Ports 的五个实际 code，不新增 SQL/HTTP 错误到公开 contract。

| 情形 | Port结果 | 说明 |
| --- | --- | --- |
| find 缺失/外租户/RLS不可见 | null | 不分辨外租户是否存在 |
| 缺失/非法 context；输入tenant与context不同；已确认scope错误 | TENANT_SCOPE_VIOLATION | 不泄露真正tenant；不跑无scope query找owner |
| create PK/approved UNIQUE 冲突 | CONFLICT | 23505按已知约束名分类，公开不输出detail |
| save找不到本scope aggregate | CONFLICT 或 scope拒绝 | 与现有fake的absence语义一致；不能通过unscoped lookup细分外租户 |
| 已有行 expected repo revision不匹配 | STALE_WRITE | 不与authVersion错误混淆；失败不写半个aggregate |
| 正确repo token但authVersion回退/身份改绑/历史篡改 | INTEGRITY_FAILURE（tenant不匹配为scope错误） | 与fake行为一致 |
| FK、CHECK、坏历史行/无损映射失败 | INTEGRITY_FAILURE | 23503/23514为内部分类依据；先验证scope再处理完整性 |
| UPDATE零行 | 不是自动STALE_WRITE | scoped锁内判定absent/stale/revoked；Session遵守null/STALE次序 |
| RLS拒绝写 | TENANT_SCOPE_VIOLATION（确认策略原因时） | 权限配置缺失不能一律误称用户越权；不依赖本地化错误字符串 |
| 网络/DB不可用、超时、死锁、序列化重试耗尽、权限接线错误 | UNAVAILABLE | fail closed，脱敏诊断；有限重试整个transaction，不重放半段 |

SQLSTATE、constraint名字只在 Infrastructure 分类；日志仅允许安全 code/request correlation，不写驱动 error.detail、连接 URL 或敏感参数。缓存 key、批量任务同样包含 TenantId；一个批次混入不同 tenant 全部拒绝且回滚，不部分成功。

## 13. Safe Rehydration / PG16 验证计划

### 13.1 Rehydration Gate（1B-4）

当前没有 fromRow/fromSnapshot；1B1-F02 仍延期。未来 Repository 不可 Object.assign、反射 private constructor、cast row as Membership 或通过 replay 命令重造历史时间/版本。必须独立受审的 validated rehydration boundary：

- 验证全部 ID/status/scope/role/Instant/版本、安全整数；历史 disabled/left/revoked/expired 可以恢复，非法旧行 fail closed。
- Membership/child 同一 snapshot：单查询装配或事务锁/一致快照，不能读 parent 后另一连接读新 grants 拼出不存在的状态。
- 校验完整 grant 集合、ordinal、无重复ID、child同tenant/member、未丢历史；实体冻结、防御拷贝。
- 保留 createdAt/updatedAt/disabled facts、首次revokedAt、授权版本；不自动激活expired/future/revoked，不纠错成默认角色。
- PG driver类型在 Infrastructure 转换；失真字符串/NUL/非法Unicode、越界int8拒绝，不截断/替换。

这些要求不是本轮授权改 Domain。未来造装载入口必须同时处理 TS private runtime hardening，再运行 Domain + Contract + PG tests。

### 13.2 分批验证与环境

1B-3B **退出验收**：真实 PG16 受限角色的 migration/role/ACL/constraint/RLS/shape/unknown-tenant/cross-tenant/append-only/rollback 测试；这些测试随 1B-3B 实施，不是进入该批之前已通过的条件，不需要先实现生产 Repository。1B-4/1B-8：Repository/Application 同 client/同 transaction 的 mutation+audit 原子性及 audit 失败回滚；1B-6/7：Session/授权策略。不能将后续测试写成 1B-3B 已通过。

只用新独立 V2 disposable test database + 合成 UUID/时间；不得连接 V1/现有 OpenMAIC DB。测试 bootstrap 可以用管理角色创建 owner/runtime，但**测试请求必须新建真正 restricted runtime connection**，不能用表owner冒充运行角色。显式检查 current_user/session_user、rolsuper=false、rolbypassrls=false、tableowner不同、无继承/SET ROLE owner能力。

沿用 Vitest/node-postgres/PG16 CI惯例，新增 Identity 专用 suite和独立连接变量应在后续批次授权。模仿现有 REQUIRED guard：CI缺DB/未收集/skip整个suite必须失败；PGlite/fake通过不能替代。环境URL、凭据不写入报告。下列均 **NOT RUN IN 1B-3A**。

### 13.3 最低安全测试矩阵

| ID | 场景 | 期待 | 归属 |
| --- | --- | --- | --- |
| R01 | Tenant A context读A / 读B（find/list/count/批量） | A允许；B不可见，不泄露数量 | 3B SQL；4 Repo |
| R02 | A记录ID+B context；用户A伪造B候选 | DB拒绝A行；Application拒绝未授权B context | 3B/4；7/8 |
| R03 | missing、空、非法UUID、v4 context | SELECT不可见；INSERT失败；无公共tenant fallback | 3B |
| R04 | 合法UUIDv7但不存在Tenant；直接调用纯 resolver | resolver 返回该规范UUID、无表查询；Membership/RoleGrant SELECT 零行，不把返回UUID当授权 | 3B |
| R04a | unknown Tenant context下插入Membership、RoleGrant、非空tenant_id的audit | Membership tenant FK、RoleGrant parent/复合 FK、audit tenant FK 分别拒绝；UPDATE/DELETE 不触及其他行；错误不泄露存在性 | 3B |
| R05 | cross-tenant INSERT/UPDATE、把A行tenant改B | WITH CHECK/immutable guard拒绝 | 3B |
| R06 | cross-tenant DELETE；同tenant hard delete/TRUNCATE | ACL/policy拒绝，行不变 | 3B |
| R07 | missing context UPDATE/DELETE | 不能改行；即使零行也不声称成功 | 3B/4 |
| R08 | pool max=1，A成功→无scope→B；A rollback→B | 无残留；无scope拒绝，B只见B | 3B/4 |
| R09 | rollback失败/连接断开/事务取消后复用 | 污染client丢弃，无跨租户泄漏 | 4 |
| R10 | 两并发client A/B，prepared query重复使用 | 上下文不缓存成首次Tenant | 3B/4 |
| R11 | runtime ALTER/DROP/CREATE、SET ROLE owner、RLS关闭 | 全部拒绝；BYPASSRLS=false/nonowner | 3B |
| R12 | migration setup临时绕RLS：A Membership+B grant | 复合FK仍拒绝；事务后policy恢复并检查 | 3B |
| R13 | 同user同tenant并发create；同user不同tenant | 前者唯一冲突；后者允许 | 3B/4 |
| R14 | SYSTEM_ADMIN、未知role/status/scope、不合法scopeId组合 | CHECK拒绝，合法四scope通过 | 3B |
| R15 | UUIDv4、Instant负/小数/超上限、validUntil<=validFrom | 拒绝；边界0/max、半开区间完整roundtrip | 3B/4 |
| R16 | User DISABLED字段缺失；Tenant ARCHIVED保留disabled事实 | 前者拒绝；后者允许 | 3B/4 |
| R17 | 同MembershipId换user/tenant/createdAt | 拒绝且stored/revision/audit无变动 | 3B guard；4 |
| R18 | roleGrant覆写scope/有效期/首次revoke、删除历史 | 拒绝；重复同一revoke保留时间 | 3B/4 |
| R19 | global User/Tenant/Session/SystemAdmin由tenant runtime直接读写 | table privilege拒绝；不借TenantContext获得控制面访问；Credential表本批不存在 | 3B |
| R20 | TENANT_ADMIN/SYSTEM_ADMIN/ServiceActor企图无scope读tenant数据 | 仍拒绝；业务角色不映射BYPASSRLS | 3B/7/8 |
| R21 | audit tenant A事件写B；伪造GLOBAL；global事件泄露给tenant reader；TENANT_*目标不存在 | policy+shape拒绝，tenant FK拒绝不存在目标；无NULL万能分支 | 3B/4 |
| R22 | audit actor USER/SERVICE/SYSTEM、18种事件 | 合法全可表达；缺字段/错组合拒绝 | 3B/4 |
| R23 | secret/token/hash/digest在顶层、actor、scope、approvedGrants嵌入 | factory路径不保存；直SQL未知key拒绝 | 3B/4 |
| R24 | audit UPDATE/DELETE/TRUNCATE；subject后续受控删除 | runtime拒绝；历史不cascade | 3B |
| R25 | 跨tenant unique/FK错误与不存在错误 | 公开信息不暴露owner、identifier或SQL细节 | 4/8 |
| R26 | hostile search_path/public同名对象；不安全默认ACL | 不劫持qualified表/helper，DDL/EXECUTE拒绝 | 3B |
| R27 | batch/job/cache相同resource id不同tenant | 不串租户，mixed批次整体失败 | 4/7/8 |

### 13.4 并发与原子性测试

| ID | 实验（使用两独立连接/barrier，不仅顺序fake） | 期待 |
| --- | --- | --- |
| C01 | 两个相同repo revision保存Membership | 仅一个成功，另一STALE_WRITE；没有半个grant集合 |
| C02 | 正确最新repo revision + 较低authVersion | INTEGRITY_FAILURE，撤销状态保持 |
| C03 | 相等authVersion但status/grants不同；纯metadata save | 前者拒绝；后者可成功且repo token更新 |
| C04 | stale expectedAuthorizationVersion command | Domain拒绝，不触发DB写或audit |
| C05 | restore/preserve/replace vs revoke两种提交顺序 | loser重读重新审批；旧revoked grant不复活 |
| C06 | Session load R1→revoke→touch R1 | STALE_WRITE，revokedAt/lastSeen不改变 |
| C07 | touch先提交→revoke；重复revoke；current rev touch已revoked | 最终revoked；第一次时间不改；touch null不写 |
| C08 | revokeAll多个active sessions→全部旧touch | 全失败，batch无半提交；后续新合法登录另算 |
| C09 | User disable/revokeAll vs session issuance | 锁序明确；disabled user不能新发有效Session |
| C10 | 注入audit失败 / 第n个grant写失败 / commit连接失败 | state+grants+versions无部分提交；未知commit结果不盲目重放 |
| C11 | pending预置grant→激活；LEFT历史admin→rejoin | 老条留历史，只fresh批准生效 |
| C12 | preserve存在future/expired/revoked/未批准grant，跨过future时间 | 未批准future已撤销，以后也不能生效 |
| C13 | parent/child并发读写、含合法历史与恶意坏行rehydrate | 无拼接快照；坏行INTEGRITY_FAILURE，无自动纠正 |
| C14 | revision/int8上限、duplicate grant ID/ordinal | 溢出拒绝、不回退；唯一性正确 |
| C15 | migration并发/重复/半失败/checksum不一致 | 无重复执行或半版本；不触及底座schema |

未来维护演练：新测试库先备份/恢复后比对 row count、FK、RLS/ACL、history/audit、migration ledger及角色；不是只确认SQL能执行。测试清理仅对明确隔离的临时库授权，不能照抄既有storage suite的TRUNCATE运行在共享库。

## 14. Deferred Matrix / Rollback

| 项目 | 后续阶段 / 本轮结论 |
| --- | --- |
| UUIDv7实际generator、Role稳定ID配置 | Infrastructure另授实现/验证，无v4 fallback |
| verified rehydration、1B1-F02 runtime constructor hardening | 1B-4前必须关闭；本稿仅定义持久化完整性 |
| password verification、Argon2、identifier规范化、Credential schema | 1B-5；D01确认首批排除，不建猜测表 |
| SessionId/digest生成、cookie、CSRF、rotation、expiry策略 | 1B-6；保留1B2-F07延期；不添加generator到现有Port |
| 完整authorization policy、grant ceiling、最后管理员 | 1B-7；schema/RLS不是业务Policy |
| pending-origin恢复审批、邀请、跨tenant membership发现、idempotency、缺失audit事件 | 1B-8；不偷塞审批表或泛型event payload |
| Course/Class资源关系、组织目录 | 后续领域；本期opaque uuid引用不建跨域表 |
| OpenMAIC Bridge/资源mapping、V1 legacy identity迁移 | 1B-9或独立授权；本稿零mapping schema、零V1读取/迁移 |

1B-3B 若批准，先独立V2测试库实施可重建方案；不默认为已有业务库可删。未来有数据后使用向前兼容或批准的补偿 migration，回滚不能简单 DROP schema。Role/permission code不复用旧含义；Grant和Audit历史不能靠清空表“修复”。备份需要同数据库事务一致快照，单tenant恢复需独立设计 global User关联及audit完整性。

`PERSISTENCE_SHARED_OWNER_ID != TenantId / MembershipId / TenantContext / RoleGrant`。原生 OpenMAIC persistence auth 不复用为 Zhiban auth；其 owner 不写入 Identity 核心表。ADR-013/014 UNCHANGED、ADR-012 PROPOSED；Native Web DISABLED_TARGET，U01/U02仍open。本批未设计 Stage/Scene/Activity/Asset/Agent/runtime/owner/deployment/bridge credential mapping。已读旧材料中的资源mapping属于未来集成范围，不是1B-3的表清单；未发现本次权威1B-3范围允许夹带它的证据。

## 15. Findings / Review Gate

这里分级是**schema design decision**，不是重开已签收1B-1/2代码审计，不把已延期功能当已有安全漏洞。

| ID | Severity | 证据/问题 | 推荐决定与关闭条件 |
| --- | --- | --- | --- |
| 3A-D01 | CLOSED / ACCEPTED | CredentialVerifier只冻结opaque请求/结果，不冻结identifier/type/ID/lifecycle；现在建密码登录表会锁错模型 | 1B-3B **EXCLUDE CREDENTIALS**；1B-5按契约冻结→补充schema review→migration→实现，不能声称本批完成凭据持久化 |
| 3A-D02 | CLOSED / ACCEPTED_WITH_REFINEMENT | Audit跨global/tenant，不能由tenant_id可空自动分类；append与Repo签名本身无事务保证 | 一张 mixed audit_events、封闭shape、角色分支INSERT；非空tenant_id强FK RESTRICT、其他actor/subject weak refs；PG16 DB负例是1B-3B退出验收，同client/事务与失败回滚是1B-4/1B-8验收 |
| 3A-D03 | CLOSED / ACCEPTED | TenantRepository是global控制面Port；盲加tenant RLS阻碍引导，盲放全局SELECT又会扩大tenant runtime权限 | tenants无tenant RLS，普通tenant runtime无直接Tenant表权限；纯SECURITY INVOKER解析器不查表；unknown Tenant由零行+FK fail closed；同事务全局状态机制按实际用例延期1B-4/1B-7，不在1B-3B建特权存在性helper |
| 3A-N01 | P2 NOTE | text/opaque string契约未限制NUL、Unicode有效性或索引字节长度；PG text/btree不能保证接受任意JS string | 1B-4拒绝不可无损存储值，不截断/替换；1B-5/6确定identifier/digest合理生成长度，索引超限脱敏失败；必要contract收紧另审 |
| 3A-N02 | P2 NOTE | grant数组顺序及相等authVersion语义必须roundtrip；目录code-owned也有升级授权影响 | 保留grant_ordinal；等版本完整比较；代码catalog版本/稳定RoleId锁定，权限扩张在1B-7/8做失效与审计 |
| 3A-N03 | P2 NOTE | 既有ensure不是版本化runner，storage CI的postgres连接不证明RLS；Session跨时间排序也未冻结 | 3B独立ledger/checksum/权限与受限PG16测试；不复制启动DDL或owner测试；不硬编码8h/30min，策略验收归1B-6 |

P3 DEFERRED：8组，逐项见第14节（ID生成、rehydration、credentials实现、Session实现、Policy、Application审批/审计补全、Course/Class、Bridge/V1）。D01 批次范围已经关闭；凭据实现仍是后续工作，1B-3B 不可宣称完成登录。

对抗性一致性复核：Ownership Matrix、Relational Model、Audit、RLS、DB Roles、FK、Transaction Matrix、PG16 test plan 与上述三项裁决一致。未发现新的 P0/P1 schema blocker；未把 SYSTEM_ADMIN 映射为 BYPASSRLS，未引入 raw token/credential 持久化或 OpenMAIC mapping。静态复核不能替代 1B-3B 的受限角色负例与 1B-4/1B-8 的端到端原子性测试。

P0 BLOCKERS：0。P1 DESIGN DECISIONS：0（D01–D03 均关闭）。P2 NOTES：3。P3 DEFERRED：8组。NEW FINDINGS：0 个新增 P0/P1；原 P2/P3 保留。

SCHEMA NAME RECOMMENDATION：zhiban_identity。
ROLE CATALOG STORAGE：CODE_OWNED（推荐）。PERMISSION STORAGE：CODE_OWNED（推荐）。INSTANT STORAGE：BIGINT_EPOCH_MS（推荐）。
TENANT TABLE RLS：NO。普通 tenant runtime 直接 Tenant SELECT：NO。MEMBERSHIP RLS：YES；ROLE_GRANT RLS：YES；均是设计要求，未执行。
TENANT CONTEXT RESOLVER：PURE_SECURITY_INVOKER；SECURITY_DEFINER_TENANT_EXISTENCE_HELPER：NO；UNKNOWN TENANT：FAIL_CLOSED（设计，运行验证 NOT RUN）。AUDIT TENANT FK：YES；其余 actor/subject：WEAK。COMPOSITE TENANT FK：YES。SAME_TRANSACTION_GLOBAL_STATUS_HELPER：DEFERRED。
AUTHORIZATION_VERSION SEPARATE FROM REPOSITORY_REVISION：YES。
SESSION RAW TOKEN STORED：NO。CREDENTIAL PLAINTEXT STORED：NO。AUDIT ARBITRARY UNSANITIZED JSON：NO。
OPENMAIC MAPPINGS INCLUDED：NO。

READY_FOR_1B3B：**YES**，仅表示 D01–D03 设计已闭环，可在**下一轮单独授权**开始 Schema/RLS migration 与真实 PG16 受限角色测试；不是本轮执行许可，也不授权 Repository、Credential auth、Session service、Authorization Policy、API 或部署。1B-3B 未通过上述真实 PG16 退出验收前，不得宣称 1B-3B COMPLETE。

## 16. 本轮验证范围

本轮 preflight：branch/HEAD符合要求，除本文件（untracked）外工作树无变化；未fetch/push、未切分支。重新读取真实25个 Domain/Port 文件及本文全文；沿用原稿已记录的签收结果，不重跑测试、CI、Docker或任何数据库命令。数据库实现和运行证据仍为 NOT RUN。

Review Round 1 唯一改动：修订 `docs/v2/phase1/schema-review.md`。没有修改源码、测试、配置、ADR、OpenMAIC core或V1。没有创建 .sql、migration 或连接数据库；1B-3B NOT STARTED。以下最终签收仅为设计结论，不代表 1B-3B 已开始。

Review Round 1 结束时检查：git status仅该untracked文档；git diff --check/--stat/--name-only和cached name-only为空（未跟踪文档不出现在普通diff中）。另以no-index --check核验新文档空白，并检查相对链接目标存在。

## 17. Final Human Review Signoff

STATUS：**FINAL HUMAN REVIEW SIGNOFF**。
1B-3A REVIEW VERDICT：**PASS_WITH_NOTES**。
3A-D01 / 3A-D02 / 3A-D03：**CLOSED**。
P0 BLOCKERS：**0**。P1 MUST_FIX：**0**。P2 NOTES：**3**。P3 DEFERRED：**8**。
READY_FOR_1B3B：**YES_AFTER_1B3A_COMMIT**（并须完成远端 checkpoint；不等于本轮已授权或已开始 1B-3B）。

1B-3B 只能在后续单独授权中实施 Schema/RLS migration 与真实 PG16 受限运行角色负例测试；无实际测试通过，不得宣称该批完成。Credential、Repository、Session、Authorization Policy、OpenMAIC Bridge、V1 迁移与部署不在此签收范围。
