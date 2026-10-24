# P4 Attempt 绑定与服务端可信事件（LOCAL）

2026-10-21，沿原 P4 接离线 HTML 互动的作答关联与查证。此包使用现有真实 Learning Attempt；未启用冻结的 Native chat Runtime，也不把 HTML 消息解释为可信完成或成绩。

## 产品范围

- 原只读互动入口保持可用，打开页面不会自动创建 Attempt。父宿主新增“作答关联与可信记录”：学生选择同教学班的已发布文字活动或测验，显式开始／续接并关联，随后到现有活动页作答；也可关联本人已有、仍可写的最新尝试。
- 关联固定 `tenant / resource / offering / publication / Bridge slot + generation / Attempt / learner Membership / Enrollment`。真实 Attempt 固定的活动版本随记录查证；Native 文档先由原 public provider 校验，再在持有发布／Bridge 锁的事务中复核同一代。
- 一个 Attempt 对一个资源仅有一个不可变绑定。并发重复请求返回同一记录；新发布不能重绑旧 Attempt，新 Attempt 可关联新发布。学生选择的辅助关联不构成教师强制完成规则。
- 可信来源只有数据库中的绑定事实，以及原 `zhiban_learning.events` 的 `ATTEMPT_STARTED`、`SUBMISSION_RECORDED`。后者关联真实 submission ID／version，文字与测验共用原提交事务，重交保留各版本；不复制答案、标准答案、内部 Native 定位符或聊天。
- 教师与学生可查证状态、活动／互动版本、开始及提交时间。课程资源新增“查看作答关联记录”；资源撤回后，有既有绑定的学生仍能找到这个只读入口。查证页不提供撤回内容，也不允许新建关联。
- 仅显示最近 50 条学习事实，截断会明确提示。绑定时间和作答开始时间分别显示，先开始后关联不会被解释为已经执行了互动。`completion`、`score` 均为空；既有评分／成绩发布流程保持原职责。

## 授权、并发与数据

继续使用真实认证会话、CSRF、当前 Identity grant/scope 与课程任教／Enrollment。`ContentService` 在同一 Bridge 客户端持有私有 Identity 守卫和业务锁，提交前再次核对授权版本。新关联强制走学生资格，教师不能代学生关联；查证按当前教师／本人学生资格投影。

新增 [0004 候选](candidates/p4-attempt-runtime/0004-attempt-runtime.sql) 只用于新建的 owned disposable PG16，包含独立版本账本、追加式绑定表、组合 FK 和一个固定签名 helper。helper 为当前业务 owner 的 `SECURITY DEFINER`：固定 search_path、强制 RLS、限制 session_user/current tenant；调用方必须先在同一事务持有原 Identity 守卫并检查角色作用域。它只新增一条受约束绑定，读取／锁定学习事实，不更改 Attempt、提交、事件或成绩。Bridge 无绑定 INSERT/UPDATE/DELETE、Learning 原始表 DML、角色继承或 owner 接管权限；新 owner 学习策略只允许限定读取／锁，实际 UPDATE 被拒绝。

锁顺序沿原 Identity／课程／关系，再锁资源和 Bridge slot；学习活动及 Attempt 以 SHARE 锁保护，学习提交原有活动 UPDATE 锁与其互斥。资源行锁及唯一键串行化重复绑定，组合 FK 防止跨学生、Enrollment、教学班、资源与发布代次拼接。新绑定须活动仍发布、教学班 OPEN、原 Enrollment 有效、Attempt 最新且 IN_PROGRESS、尚未到截止时间。已成功绑定的重放只确认原事实，不新增尝试或事实。

API：

- `POST .../resources/:resource/runtime`，闭合 DTO：`{type:"BIND_ATTEMPT",attemptId,publicationId}`，需要 CSRF；绑定 UUID／时间均由服务端产生。没有客户端事件／分数／完成接收接口。
- `GET .../resources/:resource/runtime?attempt=:attempt`，教师可查本教学班，学生仅本人；资源替换／撤回后仍可查历史，当前资格撤销则拒绝。
- `GET .../resources/:resource/records`，只读查证页面；`player?publication=` 继续要求当前启用版本。

iframe 继续使用原 OpenMAIC InteractiveScene、`sandbox=allow-scripts` 和 `connect-src 'none'`。父宿主不注册成绩或完成 message handler。绑定不放宽 CSP，不给 iframe Cookie、CSRF 或数据库能力；宿主原有周期授权核对仍会在撤权时卸载。

## 验证与证据

常规命令：`pnpm verify:zhiban:attempt-runtime`。仅运行该受影响旅程和对应授权／数据边界，真实 PG16 与受信 HTTPS，所有参与者均为合成账号。独立 reference 命令为 `pnpm exec tsx scripts/zhiban-local/run-m5-png.ts --attempt-runtime-reference-only`，只建新集群、核对目录／ACL，不声称产品旅程。

定向证据：[主 receipt](evidence/zhiban-attempt-runtime-local.json)、[旅程](evidence/attempt-runtime/journey.json)、[定向日志](evidence/attempt-runtime/directed.log)、[独立 profile](evidence/p4-attempt-runtime-profile-reference-local.json)、[构建 receipt](evidence/p4-attempt-runtime-profile-build-local.json)。本轮新输出使用独立路径，未替换既有历史 provider / Storage 证据。

覆盖：文字与测验的真实 Attempt、续接不多扣次数、并发关联幂等、提交／重交来源、师生页面、匿名／管理员／非任教／其他学生／未知 Attempt、CSRF、闭合 DTO、错误发布版本、已提交尝试事后关联、新旧发布与新尝试、撤权及 iframe 卸载、撤回后只读历史、组合 FK、数据库 ACL、伪造完成消息。本轮定向旅程 PASS；持久源码 hash 0 漂移，三个已清理的临时输入单列于 closeout。默认 3461 内置浏览器已实见真实绑定与开始事实，见[交付记录](evidence/attempt-runtime/closeout.json)、[演示入口](evidence/attempt-runtime/default-demo.json)。类型检查 PASS，受影响播放器边界测试 PASS，新／受影响文件定向 lint PASS；ContentService 原存量 any 规则在单独检查中排除。

本地类型检查使用 Node 4 GiB heap；首次默认 2 GiB heap OOM 不算通过。新／修改 UI、HTTP、投影与验证脚本运行定向 ESLint；历史 `ContentService` 存在的 `no-explicit-any` 存量单列于 `lint.log`，未借本轮扩大重构。冻结源对照见 [检查](evidence/attempt-runtime/frozen-source-check.json)。

## 边界与下一完整功能

这是 **LOCAL 服务端学习来源绑定包**。Native Runtime CREATE/APPEND/COMPLETE、运行重连／取消、虚拟实验评价、可信互动完成规则仍未启用；不把此证据外推到生产、维护 UNKNOWN/RESERVED 处置、真实 55432/55433、CI 或新模型生成。

下一完整功能为“教师配置互动与作答的课堂联合派发”：教师明确配对后，学生一次进入关联的固定互动与活动，复用本轮绑定／事件回看，继续使用原评分发布。复杂授权与跨事务接线建议 GPT-6.1 Sol / high。

默认环境目前是新合成数据；此前 `interactive-current-20261020-230640` 三库备份仍保留，未自动恢复。新默认三库已另存于 `attempt-runtime-20261021-200513`，TOC 已检查，未作恢复演练。停止默认启动仍会按原边界删除该 owned cluster。
