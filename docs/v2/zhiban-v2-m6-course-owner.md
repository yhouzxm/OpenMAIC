# M6 课程负责人受限选择器

2026-10-15。基线 `refactor/zhiban-v2` / `daf63afa83470d24a9ed41d171c6a17f8a80adb6`；保留原有未提交候选，状态 `LOCAL_VERIFIED / UNCOMMITTED_CANDIDATE`。NO COMMIT/PUSH/CI。

管理员工作台 → 教务分类“课程” → 新建或编辑课程 → “选择课程负责人”。可按姓名或完整成员 ID 搜索，10/20/50 条独立游标分页，明确选择候选；编辑默认保留原负责人，支持恢复原选择及显式清除。负责人显示姓名与成员 ID。候选按需加载，切换分类／空间、销毁视图及退出后清理选择与请求；延迟结果不回填新页面。创建、编辑继续使用原命令 ACK、CAS、审计及响应丢失后的原命令号重试。

新增只读 GET `/api/zhiban/management/:tenant/owner-candidates`，公共参数 `q,state,limit,cursor`，`state` 只接受 `CURRENT`；必须指定 `purpose=CREATE_COURSE` 或 `EDIT_COURSE`。创建禁止携带 `courseId`，编辑必须指向同租户、未归档课程。游标绑定租户、当前管理员、用途、课程、搜索和条数，只代表实时位置。仅当前租户管理员可查，返回有界成员 ID、状态及 Academic 姓名，不返回账户状态或凭据。不扩展原 `teachers` 查询的教学班／行政班目标合同。

候选复用原受限教师查询：同租户 ACTIVE Membership，存在未撤销且处于有效时间内的 TEACHER grant；不要求管理员角色兼任教师。姓名扫描每次最多 201 条，取前 200 个成员作资格交集；可能出现零候选但仍有下一页，页面保持该继续入口。完整 UUID 精确查询，名单页最多 limit+1，姓名投影只读取当页有界 ID；不使用整租户 AcademicSnapshot。

**界面候选限制与原写入授权各自有明确边界。** 原 CREATE/EDIT_COURSE 仅要求非空负责人为同空间当前有效成员，本轮保留该合同。已有有效非教师负责人可继续保留；显式清除传 `null`。新选／替换教师在提交前通过同用途的完整成员 ID 再查一次，资格消失则保留表单并阻止本次界面 POST，可重选、清除或恢复原负责人。该读不是授权凭证，不构成教师角色在最终写入时仍有效的原子保证；直接调用原命令仍沿用原 ACTIVE 成员要求。预检后成员被禁用由原 Identity 参与者屏障／事务拒绝，课程归档与 revision 变化仍由原命令检查。

负责人只是课程元数据，不新增 RoleGrant／TeachingAssignment，不赋予教师访问权。编辑改动的是当前课程草稿，重新发布才复制到新的不可变 course_version；旧发布版本及已绑定该版本的教学班保持原元数据。课程列表增加同租户、有界负责人姓名投影。无 migration、helper、ACL、receipt profile 或冻结 Identity／Bridge 生产语义变更。

## LOCAL 验证与运行

`pnpm verify:zhiban:m6:owner` 复用既有受限角色／真实 Identity bootstrap，使用新建 disposable PG16 **56513**、数据库 `zhiban_m6_course_owner_disposable`、私有 Unix socket及受信 HTTPS **3457**；追加 `--serve` 保留演示。账号只在自建根下 0600 `accounts.json`，无需在聊天发送密码。浏览器不同 127.0.0.1 端口共享 Cookie，查看本模式前关闭此前其他隔离实例的自动刷新标签。

[定向验收](evidence/m6-course-owner-local.json) **13/13 PASS**，记录真实 LOCAL 运行、逐项检查、源码／bundle／migrations hash 与自建 PG 停止及根目录删除；[持续演示](evidence/m6-course-owner-demo-local.json)单列 `RUNNING_DISPOSABLE`，不得将其表述为已清理。[最终核对](evidence/m6-course-owner-checkpoint-local.json)记录相关回归、静态检查、源码一致性及既有 migration hash。其他 M1–M6、Storage／Identity CI 证据保留各自原 hash 和范围，不自动升级为本候选签收。

定时身份／空间复查时，额外通过原有有界 workspace 查询复核服务器 ADMIN 模式；身份上下文与资格不变时保留当前分类、搜索及编辑表单，复查失败则清理挂载视图。该机制不把浏览器当前选择作为权限。

实际验收覆盖 623 名有效教师及大于 200 条无资格姓名匹配的继续扫描、跨空间／角色／状态／时间过滤、用途与课程／游标负向、创建与保留／恢复／替换／清除、不可变发布版本、选择后撤权、预检后禁用、ACK 丢失重试一次写入与审计、延迟请求销毁、定时复查的保留／拒绝清理、390px 与退出。相关单元回归 31/31，定向 TypeScript／ESLint／Prettier通过；未跑全仓 build、压力基准或 GitHub CI。普通主数据与建班旧旅程也通过，证据另保留其实际源码范围，见 [catalog LOCAL](evidence/m6-catalog-local.json)。

真实 55432/55433、Native／维护 control、HBA／凭据 staging 和“保留待补”隔离均保持。本次不证明 M5 provider 或完整发布 gate 已启用，不操作真实数据或外部通知。

下一建议：管理员操作历史的分页只读入口，复用现有教务审计事实并限定管理员可见字段。建议模型 GPT-6 Sol / medium。

[内置浏览器截图](evidence/m6-course-owner-iab-local.png)确认管理员从课程入口完成搜索、选择和保存；重新展开可见已保存的负责人和同空间候选。未绕过证书，演示输入为合成数据。定向验收 13/13、相关回归 31/31、16 份既有 migration hash 不变，最终源码核对零差异。
