# P1 第五片：课程章节、单元与内容编排

2026-10-17，LOCAL 工作树候选；分支 `refactor/zhiban-v2`，基线 HEAD `daf63afa83470d24a9ed41d171c6a17f8a80adb6`。不提交、不推送、不运行 CI；真实 PG55432／55433 不在变更范围。

课程概览／学生目录采用两层结构：章节包含有序单元，单元引用当前教学班已有的文本／PNG 讲义或文字活动。教师可新增、重命名、移除章节与单元，上下排序、跨章节移动单元。移除仅改变目录引用，不删除讲义、活动、尝试、提交或成绩。教师先保存目录草稿，再发布已保存目录；未保存时拒绝发布。学生只读最后一次发布快照，不接收教师草稿、修订号或编排控件。空目录可发布，用于清空已发布结构。

目录按教学班隔离，与现有活动、讲义的粒度保持一致；同一课程不同教学班不自动共用目录。单元可重复引用内容，但章节／单元身份全目录唯一。目录节点接受浏览器生成的 UUIDv4／UUIDv7；引用的业务目标继续使用现有业务 UUID 校验，不混用节点身份与权限实体。最多 50 章、200 单元、标题 120 字符，请求体仍受既有 32KiB 上限约束。首版不新增课时计算、强制先修、完成率或章节级学习成绩语义。

新增独立 `zhiban_curriculum` schema 及 `0001_curriculum.sql`，保存草稿与发布 JSON 快照，未修改任何既有 migration。仅新建的 owned disposable cluster 自动安装；普通 launcher 只查 ledger/source hash 及 live RLS／ACL，没有该安装时目录 API 保持不可用，不自动迁移现存库。现有 Academic／Learning／Content receipt 的历史适用范围不扩大。

API 为既有 Learning 路由下的 `GET/POST /api/zhiban/learning/:tenant/offerings/:offering/outline`。POST 继续要求有效 Identity 会话、受限空间身份、Origin／CSRF、命令键及当前任教关系，重用 Academic store 的事务与撤权屏障；学生、管理员和无任教成员均无编排权限。保存和发布采用目录 revision CAS、行锁、持久命令键／payload digest 和追加审计，未知返回只能重试同一操作。审计记录引用与修订结果，不复制讲义／作答正文。

活动引用在同一数据库事务内校验 tenant／offering，发布时要求活动已发布。讲义引用通过原 Content HTTP/service 在同一进程重新鉴权和读取，不新增跨 schema SELECT 或 Bridge 权限；发布目录要求所引讲义处于 PUBLISHED 且非隔离状态。目录发布与内容发布不宣称跨上下文原子性：后续撤回或资格变化时，学生目录按当前授权过滤失效单元，实际预览／作答仍重新调用原 API。讲义与 PNG 的 CSP 和 gateway 校验沿用原范围。

单元链接携带严格 UUID hash。讲义页仅从已授权资源列表选择该讲义并请求原预览；活动页通过既有受限精确 ID 搜索进入指定活动。hash 不扩大服务器权限，不改变尝试次数、截止日期或成绩语义。

本轮本地验证：输入／路由 **12/12 PASS**；专用 PG16 160015、受信 HTTPS 三角色与章节集成旅程 **15/15 PASS**；定向 TypeScript 与变更 JS／TS ESLint 通过。Content TSX 沿用排除既有 explicit-any 债务的检查，新增一次性深链接 effect 有 1 个 exhaustive-deps warning，不宣称全仓严格 lint／类型签收。目录草稿隔离、发布快照、相同键重放、并发 CAS、拒绝非教师写入、失效目标与活动撤回隐藏均已核对。已有其他教学班资源的单独负向 fixture 未新增，不扩大成该组合的独立测试签收。

内置浏览器核对教师新增第三章、加入现有活动、章节上下移动并保存／发布；学生看到目录版本 **3** 的三章内容。1440px 桌面和 390px 手机截图均留证，师生手机页宽均 375px，无横向溢出。当前实例 `/tmp/zhiban-trial-content-dIeQuD` 保留运行，源码零漂移；旧实例已停止，UUID 回归失败临时根确认停库后删除。此前已应用 migration 的 hash 与上轮 receipt 逐项一致。

结果和截图见 [机器证据](evidence/zhiban-p1-curriculum-local.json)。旧实例已停止，重新启动产生新合成数据及密码，账号只在 `pnpm trial:zhiban:info` 指向的本机文件。

下一步：将课堂与互动页的现有活动创建、目录编排和讲义编辑入口进一步串联，减少教师往返。建议 GPT-6 Sol / medium。
