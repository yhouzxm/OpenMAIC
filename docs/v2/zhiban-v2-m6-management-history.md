# M6 管理员操作历史分页

2026-10-15。基线 `refactor/zhiban-v2` / `daf63afa83470d24a9ed41d171c6a17f8a80adb6`，保留已有未提交候选；`LOCAL_VERIFIED / UNCOMMITTED_CANDIDATE`。NO COMMIT/PUSH/CI。

管理员工作台 → 教务分类 → **操作历史**。共享组件也用于独立教务页。提供关键词、操作类型、开始／结束日期（UTC）及 10/20/50 条分页；按发生时间倒序，同毫秒按记录 ID 倒序。搜索或筛选后重置第一页，支持前后翻页、刷新及空结果；没有总页数或跨页冻结快照。定时身份／空间／管理员资格复查不变，资格相同时保留当前筛选；视图销毁、切换空间及退出清理请求和数据。读取失败移除旧历史列表，保留筛选并提供“重试操作历史”，不回退整租户 snapshot。

每条显示操作类型、UTC 时间、操作人当前目录姓名／成员 ID、可用的对象名称／编号／ID、记录 ID及“已完成”。关键词匹配操作人当前姓名／完整成员 ID、对象名称／编号／记录内已有的完整对象 ID、完整记录 ID；姓名／名称按字面子串匹配，`%` 和 `_` 不作通配符，完整 UUID 可大写输入。操作人姓名是当前目录标签，不声称是操作发生时姓名。

## 数据与授权边界

只读 GET `/api/zhiban/management/:tenant/history`，允许 `q,event,from,through,limit,cursor`；为兼容共享过滤器，`state` 仅可为默认 `ALL`。event 仅 ALL 或现有 15 类 Academic 命令；日期严格为真实的 `YYYY-MM-DD`，从 1970 年起，结束日期包含整日，以 UTC 次日零点作为排他上界；反向范围拒绝。游标绑定当前成员、租户、种类、全部筛选和条数，通过同租户不可变审计记录定位 `(occurred_at,id)`，limit+1 keyset 读取；锚点缺失拒绝，不静默重启第一页。旧种类的 query/cursor 形状不变。

查询复用原 Academic 事务、当前 Identity／Bridge guard 与 `academicAdmin` 检查，并受既有租户 RLS 限定。匿名、普通教师／学生、跨空间和撤去管理员授权后的读取均拒绝；游标只是位置，不能赋权。POST history 拒绝；本页无写入、删除、修改、恢复或导出操作，不因读取追加审计。

范围只包括原 `zhiban_academic.audit_events` 中已提交的 15 类教务命令：课程／学期／行政班／教学班、任教、行政班成员／班主任、Enrollment／转班。原命令与审计同事务写入；原键重试不追加第二条，失败／回滚操作不进入该历史。登录／安全拒绝、学习提交、评分、内容发布、Bridge、维护服务及其他模块日志均不汇聚到本页；“全部”指本页支持的教务类型。

响应只含 `id,actor_id,actor_name,event_type,occurred_at,target_id,object_code,object_name` 八个字段，名称／编号有明确长度上限。按事件白名单从 facts 投影必要元数据，不返回原始 `facts`、before、完整 command、description、命令号、payload digest、账户／凭据或会话数据。对象 ID 使用原记录真正保存的 ID：编辑／发布／归档指课程，修改教学班指教学班，CLASS_MEMBER 指行政班，ENROLL／ASSIGN 指教学班，WITHDRAW／TRANSFER／END_TEACHER 指对应关系记录；新建命令当年没有记录生成的对象 ID时仅显示其保存的名称／编号，不推断或回填当前对象。不会提供恢复旧值能力。

无 migration、helper、ACL、receipt profile 及原命令审计格式变更，不修改冻结 Identity／Bridge 生产语义。不将本地记录伪装为 GitHub Actions；真实 55432/55433、Native／维护 control、HBA／凭据 staging 与“保留待补”隔离保持。

## LOCAL 验证与演示

`pnpm verify:zhiban:m6:history` 使用自建 disposable PG16 **56514**，数据库 `zhiban_m6_history_disposable`、私有 Unix socket和受信 HTTPS **3458**；追加 `--serve` 保留演示。账号仅写自建根下 0600 `accounts.json`。不同 127.0.0.1 端口共享 Cookie，使用本模式前关闭其他隔离演示的自动刷新标签。

[清理完成的验收](evidence/m6-management-history-local.json) **10/10 PASS**：620 条明确标记的合成历史与配套合成 command 记录用于分页／同毫秒／时间和 UUID 逆序测试，并在另一租户种植相同 ID 的记录验证隔离；它们不是 620 次真实命令执行证据。另外通过真实 HTTPS CREATE／EDIT 命令、同键 replay 和重复编号失败验证 COMMIT 后入史与不重复、不记录回滚。全程确认返回字段不含原始事实敏感标记、读取不增加审计。

其他覆盖包括完整遍历／无重复、日期边界、类型／字面关键词／空结果、游标和请求负向、当前管理员撤权、主入口只读控件与筛选重置、定时复查、读取失败清理／重试、延迟请求销毁、390px 与退出；相关单元回归 **32/32 PASS**，定向 TypeScript／ESLint／Prettier 通过。未运行全仓 build、性能压力基准或 CI signoff；没有声称大规模排序／搜索性能已验收。

[持续演示](evidence/m6-management-history-demo-local.json)单列 `RUNNING_DISPOSABLE`，不是清理成功记录；[最终核对](evidence/m6-management-history-checkpoint-local.json)绑定实际源码／bundle、相关测试、内置浏览器截图和既有 migration hash。其他 M1–M6 及历史 CI 证据保留各自原来源、hash 与适用范围。

下一建议：整理可试用版本、演示账号角色和启动入口，停止继续扩展零散分页功能；建议模型 GPT-6 Luna / medium。

[内置浏览器截图](evidence/m6-management-history-iab-local.png)确认真实管理员入口、下一页，以及关键词＋操作类型＋UTC 日期组合查询后回到第一页。10/10 定向旅程、32/32 回归、16 份既有 migration hash 不变；最终正常／持续演示源码核对均零差异。内置浏览器使用受信证书，无安全警告绕过。

## 2026-10-16 试用修复接续

[UAT-02 修复及证据](zhiban-v2-trial-uat-fixes.md)在原八字段上增加涉及成员 ID／当前同空间目录姓名，现响应为十字段；支持涉及成员搜索和缺失姓名的 ID 回退。原写入、审计和权限不变。上文 10/10 与旧 checkpoint 仍只适用于原八字段版本；新投影及刷新后的统一实例以本轮定向证据为准。
