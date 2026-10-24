# M2 课程、班级与 Enrollment

范围授权：2026-10-08 用户要求完成 M2，并选择“管理员管理方式”。基线 HEAD `daf63afa83470d24a9ed41d171c6a17f8a80adb6`，承接未提交的 M1 与规划改动。本轮不 commit/push/CI dispatch，不修改已应用 Identity/Bridge migrations。

## 本轮规则与 V1 对照

V1 参考固定 `feature/zhiban-mechatronics` / `0fa0a15e8b12ae9e4f7a2d78e80338874599bbae` 的 academic、course-roster、teacher-courses 类型和服务；保留课程、学期、行政班、教学班、负责教师、任教和名册概念，不复制其服务或数据库。

- 管理员创建课程/学期/行政班/教学班，指定任教教师，添加/移出学生并受控转班；不开放学生自主选课。导入与复杂组织目录仍属 M6。
- Course 的 code 不变，名称/说明/负责教师可编辑；编辑形成 DRAFT。发布生成不可变版本，TeachingClass/Offering 固定该版本。再次编辑/发布不覆盖既有教学班版本。ARCHIVED 为终态，不硬删引用或历史。
- Term 的 code/name/起止日期为首轮必要元数据；起止日包含端点，结束不得早于开始。本轮不把日期自动等同于选课开放窗口。
- 行政班是稳定组织信息与班主任/班成员关系；TeachingClass 是某 Course 发布版本在 Term 中的授课组，行政班挂接只作元数据，不自动产生 Enrollment 或教学权限。
- Offering 容量显式输入，范围 1–1000（首轮运行上限）；OPEN 可加人，CLOSED 停止加入，不隐式退出现有学生。容量不得小于 ACTIVE Enrollment 数。失效 Membership 不自动腾出席位，管理员显式移出。
- Enrollment 唯一 `(tenant,offering,membership)`，ACTIVE → WITHDRAWN；重入复用记录并要求当前 revision，历史窗口与命令留在不可变审计中。重复加入不重复占位，同一 command key 和 payload 可幂等读取结果；不同 payload 复用 key 拒绝。转班按 UUID 排序锁定两班，先核对目标席位/加入状态，再同事务退出原班；失败全部回滚。
- TeachingAssignment 是任教关系，ACTIVE/ENDED 和显式再任教 revision；并不创建 RoleGrant。班主任、Course owner 也不自动给予教学权限。
- 独立 `academic-v1` 业务权限映射：TENANT_ADMIN 的 TENANT grant 可管理；TEACHER 需当前有效 grant **并且** ACTIVE 任教关系，scope 为同 tenant 的 TENANT、精确 Course 或精确 Offering/CLASS；CLASS 与 COURSE 不互相推导。STUDENT 需 SELF grant 与本人 ACTIVE Enrollment，只见本人课程/记录。既有 `identity-v1` catalog 和冻结权限不扩写。
- 公开 DTO 的 mode/roles/enrolled/space 仅控制展示；每次服务端从同一个真实 Identity Session registry 取 opaque handle，锁定 Session/User/Tenant/Membership/actor grants 后重新授权。相关目标成员需当前 ACTIVE。外租户、非任教教师、零 grant 成员拒绝业务数据/写操作。

## 持久化与接线

新增独立 academic schema/ledger/migration、专用无 DDL/无继承/无 bypass 的 runtime role；不可变版本、命令和审计只有 SELECT/INSERT，无业务 DELETE。tenant 复合 FK 与 FORCE RLS 双重限制。Identity/Bridge 表和原 migrations 0001–0013 不变，不给 Bridge role 增加 academic 权限。

复用既有 `BridgeSessionSecurity` 的**身份锁定功能**，不启用资源 Bridge：现有 bridge role 连接只持身份锁，academic role 事务负责业务写入；提交前重验时限，完成后释放身份锁。单个业务事务原子提交业务、命令及审计，不在两连接之间分拆业务写；提交响应未知由 command key 查证，不能把报错当回滚。无 OpenMAIC mapping/provider/Runtime/AI 调用或 enabled Bridge signoff。

M1 localhost host 的显式 loader 配置与私有文件/hash 限制保留；host 改为直接构造同一正式 `createIdentityComposition` 和 `createIdentityHttp`，Identity 与 Academic 共用 private root。原 `installApprovedIdentityHttp` 的默认 CLOSED/global registry 不变，不复制 Session 或信任 public UserId。新本地维护命令离线准备 schema/受限角色与普通合成 admin/teacher/student 数据；不声称满足 FIRST 或生产审批/入驻流程。

## 使用与本地验收

STATUS: LOCAL_VERIFIED / UNCOMMITTED_CANDIDATE。

本机已准备 M2，无需重复初始化。启动 `pnpm dev:zhiban`，访问 `https://127.0.0.1:3443/zhiban`。私有 `~/.local/share/zhiban-m1/accounts.json`（0600）包含本地教务管理员、任教教师、学生甲/乙、非任教教师、其他空间管理员；保留原无空间账号。选择“本地学习空间”进入教务管理或本人课程。管理员依次建学期、建课并发布、开教学班、指定教师、添加学生；行政班与教学班分别管理。

新机器先按 M1 记录准备独立开发 cluster/受信任证书，再离线运行 `pnpm setup:zhiban:m2`。该命令只允许固定的 owned PG16 `55433/zhiban_m1_dev`；已有完成配置或已 seed 成员时拒绝重建。首次初始化曾在首个角色授权前因同一操作多次读取时钟导致“Time cannot move backwards”；已统一操作时间，在核对原 academic ledger/source checksum 和零 profile 后接续，没有改已应用 SQL 或重置 M1 数据。失败保留数据供诊断，不自动删除或跨库清理。重复验证会保留明确命名的合成课程、学期及历史关系；不代表 V1 真实数据迁移。

`pnpm verify:zhiban:m2`：20 组真实 HTTPS/PG16/隔离 Chromium 场景 PASS，覆盖管理员完整建课/发布/开班/任教/入班/刷新旅程、教师及学生页面、容量竞争、转班原子成功与满班回滚、版本不变、CAS、幂等命令/审计、跨租户、RLS/FK/ACL、CSRF/Origin、匹配角色资格、退课/结束任教/撤销 RoleGrant 后当前 Session 的访问变化、退出后旧 Cookie 的 Academic 401 拒绝、移动端及无凭据存储。认证拒绝只接受正式 Identity 的私有 refusal 观察结果，不相信公开错误码。教师 RoleGrant 的撤销验证仅作用于专用合成账号，finally 通过正常领域授权恢复新 grant；不伪造生产审批。无自主选课入口。

另有 16 项 academic 领域/认证并发边界及受影响 Identity HTTP 的 95 项回归，分别通过；M1 实际 18 场景回归 PASS。ESLint、Prettier、全项目 TypeScript（8 GiB heap）通过。Host 重启仍读取同一持久库，启动核验实际 PG16、ledger/hash、角色限制、FORCE RLS、精确 tenant policy、列级 UPDATE 和不可变表/审计的 ACL，不只信任文件 receipt。

最终复核曾出现间歇并发 503。定向只读复现 4 轮、每轮 8 个同 Session 请求，32 个请求中 23 个在 20–113ms 因认证 `STALE_WRITE` 失败；PG 没有 statement timeout，属于 Session hint revision 与锁后 revision 的更新竞争。Academic HTTP 按 Session 的 digest 排队**仅认证/touch 步骤**，每次仍发起正式认证并获取新的 private handle，不缓存授权；与其他 Identity 入口的竞争仅对真实 `IdentityPortError('STALE_WRITE')` 最多尝试三次。业务命令和提交不重试；并发上限八个请求不变，队列完成即释放。冻结 Identity 实现和迁移未改动。修复后同样 32 个只读请求全部 200（最终复核 31–288ms），没有业务写入；独立日志只含阶段、错误码、耗时，不含凭据/DSN/SQL/用户标识。

定向命令 `pnpm exec tsx scripts/zhiban-local/verify-concurrency.ts`，证据 `~/.local/share/zhiban-m1/m2-concurrency-verification.json` 标 LOCAL，包含结果、耗时和候选源文件 hash；不代表负载/容量或多进程生产验收。

证据仅标 LOCAL：私有 `m2-verification.json` 含基线 HEAD、验证时刻、逐源文件 hash、academic migration/policy hash 与保留体验教学班 ID；`m2-admin.png`、`m2-teacher.png`、`m2-student.png` 为隔离浏览器截图。真实 Codex 内置浏览器另直接登录并展示教务数据，使用已信任开发 CA，截图 `m2-iab.png`。HTTPS 检查严格验证 pinned CA/IP；隔离 Chromium 的 leaf SPKI pin 不能替代内置浏览器证书证明。

证据不覆盖生产 OPS/TLS、FIRST/审批/恢复、真实数据迁移、enabled Bridge/Runtime/AI 或全量 V1 功能，不标 PHASE_1B_COMPLETE。未提交、未推送、未运行 CI；历史 CI 证据只保留原 SHA/范围。首轮列表每张表最多 500 条（超过时拒绝返回），批量目录/导入与大规模分页属后续 M6；课程活动/提交/成绩尚未交付。

下一步 M3：Activity、Attempt/Submission 的教师发布与学生提交闭环，复用真实 Enrollment/任教查询及撤权事实。常规实现建议 GPT-6.1 Sol / medium；新授权和提交并发边界的集中评审用 high。
