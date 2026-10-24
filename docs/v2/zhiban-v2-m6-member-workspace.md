# M6 教师／学生工作台课程分页

2026-10-15。基线 `refactor/zhiban-v2` / `daf63afa83470d24a9ed41d171c6a17f8a80adb6`；保留既有未提交候选，NO COMMIT/PUSH/CI。

## 产品行为

教师和学生登录、选择空间后，“我的课程”直接使用有界查询，不读取旧 `/academic/:tenant` 整租户快照。支持课程／教学班名称、编号、学期或完整教学班 ID 搜索，开放／关闭筛选，10/20/50 条 keyset 翻页；搜索重置页位置，刷新重新核验当前关系，不虚构总页数。

卡片继续显示教学班名称、课程固定发布版本、学期、容量人数及内容入口。教师保留教师统计、学习活动／提交和学生名单；学生保留自己的学习概览、活动／提交和当前选课提示。教师学生名单独立按姓名／完整成员 ID 搜索、分页，默认每页 20 人，不因大班重新读取整个租户名单。学生没有其他学生名单接口或入口。

双重身份按每个教学班决定卡片模式：有匹配教师授权和有效任教关系时优先教师模式，否则有效选课为学生模式，不把全局 TEACHER 身份套用于所有课程。学习／评分的姓名回调只使用已加载的当前名单页，其他记录回退显示成员 ID，不为了补姓名加载整租户 people。

课程分页刷新失败时清空旧列表并显示可重试错误；空间切换、会话变化或离开页面清理名单、游标、请求和监听，响应只写入仍连接的当前 root。卡片是一次读取结果，不是后续操作的授权凭据。

## 查询与授权

新增 GET `/api/zhiban/workspace/:tenant/courses|roster`，同源 cookie／协议、Origin、会话和空间成员仍通过原 Identity 组合验证。仅允许明确的查询参数和 10/20/50 条数；roster 必须提供 offering，学生、无匹配授权或无当前任教关系均不能读名单。

课程查询在 LIMIT 前完成租户、当前角色范围和关系过滤：TEACHER 只接受 TENANT/null、精确 COURSE/course_id、精确 CLASS/offering_id；STUDENT 仍需 SELF/null。关系采用既有 Learning.access 的 `ACTIVE AND valid_from<=now AND valid_until IS NULL` 口径；未来及已结束／已退班关系不提供入口，已关闭教学班仍可读取，已归档课程不展示。教师名单直接复用 Learning.access 的教师检查和锁，再读取当前有效 Enrollment 页。

角色事实来自受锁的服务器 actor，不能由 query、模式或成员 ID 提供。SQL 按 UUID keyset 返回最多 limit+1 行；游标绑定租户、当前成员、列表种类、目标、筛选和条数，只是实时位置，不保证跨页不变。普通卡片只投影必要字段，不带整租户成员／Enrollment。学生即使知道其他教学班 ID，也不能通过名单接口扩大权限。

课程名称／简介联接精确 `course_versions.version=offering.course_version`，不会在编辑转草稿或重新发布后暴露当前未绑定内容。人数沿用原容量 `status=ACTIVE` 计数；名单只列当前有效关系，两者在预置未来关系时可能不同。后续内容、活动、统计、评分及提交 API 继续独立核验，不修改其规则。

管理员 bootstrap 返回 ADMIN，继续走原管理员入口与分页教务链接；本轮不更改旧 AcademicSnapshot 的响应、上限或原管理员编辑能力。没有新增 migration／helper／ACL／receipt profile，不修改冻结 Identity/Bridge 或已应用 migrations，也不增加相关身份数量。

## LOCAL 验收及范围

`pnpm verify:zhiban:m6:workspace` 自建 PG16 56508，Unix socket 专用数据库 `zhiban_m6_workspace_disposable`；使用受信开发证书并核验 hash，在 HTTPS 3452 完成真实 Identity 会话、受限角色和页面旅程。追加 `--serve` 可在验收后保留演示；不读取真实数据库 DSN，不绕过 TLS。

[清理完成的本地验收](evidence/m6-workspace-local.json) **9/9 PASS**，自己的 PG 已停止、目录已删除。覆盖 622 门教师课程、621 门学生课程和 529 人名单完整遍历，权限／游标／参数拒绝、时间窗口、CLASS／COURSE 范围、混合身份、固定课程版本、结束任教／退班／归档／撤权后的重新读取、浏览器搜索／翻页／名单、学习和概览入口、390px 及退出。

[持续演示记录](evidence/m6-workspace-demo-local.json) 绑定本轮源码、依赖、执行 bundle 指纹及实际 Node／PG16、PID、账号文件位置。演示保持 `RUNNING_DISPOSABLE`，不声称已清理；正常退出才产生 close 记录。相关单元／依赖回归 **53/53**，定向 TypeScript、ESLint 和格式检查通过，不宣称全仓 build、压力基准或 CI signoff。

内置浏览器已正常登录教师账号、进入分页课程并从 529 人名单搜索到末尾学生，见[实际访问截图](evidence/m6-workspace-iab-local.png)，未绕过证书校验。

[教师课程／名单截图](evidence/m6-workspace-teacher-local.png)、[学生移动端截图](evidence/m6-workspace-student-local.png) 记录真实隔离浏览器旅程。旧管理员、目录、统计、内容及 CI 证据保留其原 hash 与范围，不回填为本轮共享 store／网关／入口来源。

学习活动、Attempt／Submission／评分记录自身的 500 条上限仍在；本轮只解除课程和教师名单的旧整租户快照依赖。演示验证学习与学生概览 API，内容入口链接保留，但该 fixture 未启用 M5 Native/Bridge 内容 provider，不能当作内容发布启用证据。

55432/55433、真实 Native／维护 control、HBA、凭据 staging 及“保留待补”输入继续隔离，本轮未操作。

下一建议：管理员工作台直接使用分页教务管理，移除其剩余旧快照启动依赖。课程负责人选择器、操作历史和学习记录分页继续单列。建议模型 GPT-6.1 Sol / medium。
