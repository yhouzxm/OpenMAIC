# 基础课堂共享任务：状态、授权与存储设计

2026-10-17。本片为有限 Classroom 适配；完整 OpenMAIC／Interactive／VirtualLab／AI 继续关闭。范围依据[入口清单](zhiban-v2-classroom-entry-scope.md)，沿用冻结 Identity、Bridge 和原有内容／作答授权。未修改已应用 migrations。

## 状态与操作

| 对象／操作 | 前置 | 事务内变化 |
| --- | --- | --- |
| CREATE_CLASSROOM | 当前任教、教学班 OPEN；合法标题／说明／时间区间 | 新建 DRAFT，revision=1 |
| PUBLISH_CLASSROOM | DRAFT、revision 匹配、尚未超过关闭时间 | PUBLISHED，revision+1；未来开放时间可以先发布，学生到时才可见 |
| DISPATCH_TASK | PUBLISHED 且在开放区间；目标在当前已发布目录；支持的已发布目标版本 | 结束旧 ACTIVE 派发，追加新派发，课堂 revision+1 |
| END_TASK | PUBLISHED 且在开放区间、存在 ACTIVE 派发 | 派发 ENDED，课堂 revision+1 |
| END_CLASSROOM | PUBLISHED；允许在窗口关闭后手动结束 | 课堂及当前派发 ENDED，revision+1 |
| ENTER_TASK | 当前学生 Enrollment、课堂已开放、revision 与 ACTIVE dispatchId 匹配、目标仍可用 | 幂等追加进入观察；活动同时按原规则开始／恢复精确版本 Attempt |

ENDED 为终态，首片不支持恢复或删除。标题／说明／时间在创建时设置，首片不提供草稿编辑。派发结束／课堂结束不提交、不计完成、不评分、不改变截止／重交／尝试次数规则，不删除已有内容、作答或成绩。窗口为 `[opensAt, closesAt)`，空边界表示不限。过期课堂学生不再列出，教师可查看历史并结束。

每课堂最多 100 次派发，每教学班最多 100 课堂，首片列表有明确上限而非无界加载；超过读取上限 fail closed。参与者明细读取上限 1000，超限拒绝返回。后续大规模使用另接分页，不能将截断列表当完整统计。

## 授权与并发

所有调用经 Learning HTTP 的严格路径／query／cookie／CSRF 检查。Context 的 actorMembershipId 从经过认证的服务器 spaces 取得。AcademicStore.run 持有真实 Identity／Bridge 授权屏障，并在提交前核对有效期。Learning.access 持有 Offering／Course 及当前 Assignment／Enrollment 的 SHARE 锁；课堂状态转换与学生进入持有同一课堂行的 UPDATE 锁。退班、撤任教、结束与进入按锁的先后线性化；不能仅凭列表或 URL 中的 ID 授权。

写入需要同一事务的 commands／audit_events，幂等 key 隔离到 tenant，payload digest 包含 offering、命令、classroom-v1。不同 actor／payload 重放拒绝；ENTER_TASK 即便重放也重新检查当前课堂、版本、派发和资格，终态之后不能返回新的进入许可。相同进入仅保留一条观察。首次进入审计的 result.attemptId 是 dispatch／learner 的不可变尝试绑定，同派发换用新幂等 key 再进入也返回该 Attempt，不消耗下一次尝试；教师提交和成绩查询按该绑定过滤，不将其他课堂的历史提交累计进来。审计与 entries 同事务提交，缺少有效绑定时拒绝进入。活动开始使用从进入 key 派生的独立幂等 key，和进入记录同事务提交／回滚；原 Attempt 上限、截止和恢复规则仍有效。

活动版本在 Learning 的活动行锁下核验；若已有 IN_PROGRESS Attempt 绑定其他版本，拒绝静默恢复。Content 仍经原授权 API 读取。讲义派发持有 publication_no，进入阶段检查可见版本和 quarantine；实际预览再在 Content 原资源锁内核验可选 `x-zhiban-publication-version`，因此内容更新后拒绝展示另一版本。目录和派发不是 Content capability，不能绕过 Native／Bridge／asset gateway。跨服务预检不构成 Content 与课堂的分布式 ACID；进入观察可能已经写入而后续预览失败，不能据此声称阅读完成。失效任务由教师重新派发。

学生任务面板每 5 秒同步，单次请求最多 10 秒，手动刷新可用；隐藏标签停止轮询，不承诺背景标签 5 秒刷新。轮询仅重画任务面板，不重画文字作答输入。每次后端读写均检查资格；屏幕暂时保留的文案不能延长权限，读取失败清空任务。

## 数据与 ACL

新增独立 `zhiban_classroom` schema，追加未应用候选 `0001_classroom.sql`，只由 disposable 安装器应用。sessions、dispatches、entries 以 tenant 复合主键／外键连接；独立 Classroom ID，不混用身份 SessionId／Attempt／Native Stage。每课堂至多一个 ACTIVE 派发，由部分唯一索引约束。

Owner 为既有 zhiban_identity_owner；runtime 为既有受限 zhiban_academic_runtime。三表 FORCE RLS、严格 tenant policy，只有 SELECT／INSERT 和所需状态／revision 列 UPDATE，无 DELETE／TRUNCATE／schema CREATE／Identity 读取扩权。启动只核验 ledger hash、RLS 和 ACL，不运行 DDL。没有 ledger 时课堂 API 保持关闭，普通教学能力继续可用。

审计只含操作、主体、课堂／派发／目标版本的引用和服务器时间，不复制作答正文。参与记录为客户端触发进入的观察；提交数来自原版本化 submissions，已发布成绩数来自原 assessment publications，成绩更正只计算当前发布版本。三者各自显示，不推导完成、签到、正确率或 Runtime 进度。

## 本地交付边界

新增显式 `--shared-classroom` disposable 模式：HTTPS 3462、PG16 56518、`zhiban_shared_classroom_disposable` 和专用 Native 数据库。源 hash、receipt 标记 LOCAL／githubActions=false，沿用受信 TLS、内容 profile 和受限角色核验；独立 owned 临时根负责清理。原 3461／56517 实例、凭据与 receipt 不重置、不重签；真实 55432／55433 不接触。新 host 只在显式启用课堂后注入页面模块。

验证覆盖状态、跨租户／身份／CSRF、时间窗口、重复与并发写入、结束／进入、撤权、目标版本、真实文本／PNG 页面、学生作答与教师查看；现有基础套件和 GitHub CI 不重复作为本片通行条件。结果另见本地交付记录；本文件不是验收证据。
