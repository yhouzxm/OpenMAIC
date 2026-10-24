# P3 课程讨论：本地产品包

2026-10-18。LOCAL 未提交候选，沿用原 P1–P7 主线。基线 `refactor/zhiban-v2` / `daf63afa83470d24a9ed41d171c6a17f8a80adb6`，须连同既有 dirty 工作树及本轮收据使用。当前验证结果以[讨论旅程收据](evidence/zhiban-discussion-journey-local.json)和[最终交付收据](evidence/zhiban-course-discussion-local.json)为准。

## 可使用的完整流程

默认3461教师／学生课程导航均有“课程讨论”。教师保存主题草稿、编辑后显式开放；师生发言并回复同主题中的可见发言。教师可填写原因后隐藏／恢复发言，并分页查看管理记录；关闭后师生只读，重新开放后继续。归档对学生隐藏且不可重新开放。教学班关闭时整个讨论只读，课程归档沿原授权规则拒绝访问。

主题按教学班隔离，不引入新的目录单元类型。首版纯文本、平铺回复时间线；标题120字、说明2000字、发言4000字，页面按文本呈现，未发送内容保留并受离开保护。主题、发言和管理记录分别分页。讨论不产生 Grade、Submission、学习完成率或课程总评。

## 复用和安全边界

[源码差额设计](zhiban-v2-course-discussion-gap.md)核对了固定旧分支和官方1.2.0。原生聊天具有 learner Runtime 持久化及 AI 编排，当前没有教学班共享主题／回复／任教管理公共合同。本包复用既有课程壳、Identity、AcademicStore 和 Learning.access，只补业务讨论；不修改 SDK，不启用 Runtime／AI，也不共享 learnerKey 或导入原生私有聊天 store。

每次读写检查当前 Session、Tenant、Membership、任教／Enrollment；管理员不能代任教或代发言。展示服务端允许的姓名，不返回 UserId 或名册。退课者本人失去读写权限，其已公开发言仍保留。学生读取隐藏发言时只得到占位，不返回原文、姓名、管理原因；教师仍可查看原文及管理记录。

独立新增 `zhiban_discussion` schema 的 `0001_discussion.sql`，仅在 owned disposable PG16 安装；旧迁移字节不改。主题、发言、管理事件和命令账本强制租户 RLS；父帖使用 tenant／offering／topic／post 复合 FK。发言正文、身份和命令／管理记录不可 UPDATE／DELETE，主题及可见性仅授权必要列更新，无 SECURITY DEFINER helper、Native ACL 扩张或真实库安装。

写入复用原身份与课程关系锁，随后命令锁 → 主题锁 → 帖子锁；关闭与发言、隐藏与回复按同一主题串行化。状态变更带 revision CAS；发帖取得锁后检查 OPEN。正文写入、审计和幂等结果同事务，未知结果保留原命令号；不同 actor／offering／payload 不能重用。日志不复制发言正文。

分页使用服务端 HMAC key，绑定租户、Membership、教学班、主题、列表类型、过滤条件和页大小；keyset 为服务端 created_at/id。启动重置 key 会使旧 cursor 失效，需要刷新第一页；cursor 不承担资源授权。

## 安装与启用

`build-discussion-reference.ts` 在全新私有 PG16 cluster 从固定 Identity／Academic 依赖和新迁移构建独立 expected catalog／ACL，随后停止并删除 cluster；[参考](evidence/zhiban-discussion-profile-reference-local.json)只证明构造，不替代产品测试。

默认统一试用安装新 schema 后调用只读 `loadDiscussion`，核验来源 hash、唯一迁移账本、完整 schema catalog、列 ACL、RLS、owner、运行角色属性及继承边；缺安装保持关闭，错来源或扩权拒绝启动。检查在独立一致性只读事务内完成。网站请求不安装迁移或从运行目标自签 expected profile。

Content／PNG 参考保持原范围；讨论有独立 schema 和 independently-built expected profile。新组合收据同时绑定原 PNG 参考与新讨论参考，两个 loader 均通过后才启用；原 Native／Bridge ACL 与旧预期值未放宽。Classroom／Curriculum 继续保留各自现有检查范围。

只在默认 `trial:zhiban` 的 owned3461组合启用讨论 API；旧3443及其他未安装 host 保持关闭。API沿现有 Learning HTTP 认证、CSRF、Origin、大小上限和 request-target 白名单，含主题列表、主题发言、教师管理事件和严格命令。接口数据不会授权客户端自行指定作者或角色。

## 验证及保留范围

定向验证包含完整双角色浏览器旅程、取消离开保留输入、分页和课程返回；服务端覆盖草稿／归档保密、跨角色／租户／班级／父帖隔离、撤课及任教撤销、关闭班级只读、关闭与发帖／隐藏与回复排队、事务故障无半写、同号重试／payload冲突，以及实际 ACL 扩张拒绝。检查讨论不会改变 Attempt／Submission／学习事件／Grade 数量。

结果：2个定向测试文件19项通过；统一教学20组旅程通过，其中5组为讨论的页面、授权、并发、故障、分页／撤权／ACL。受影响依赖闭包 TypeScript、新增及受影响源文件 ESLint通过。25个既有 migration hash 不变；当前1381个运行来源 hash匹配，`sourceMatches=true / drift=0`。内置浏览器随后以学生身份从课程导航进入讨论，真实回复周老师并看到“课堂试讲：已理解隔离与验电顺序，准备按讲义复核。”，末页无 warning/error。

没有讨论评分、匿名、学生创建主题、正文编辑／硬删除、附件、通知、AI 发言、实时推送或章节讨论类型；用户通过“读取最新讨论状态”获取其他人的更新。未知结果期间暂停其他写入，原生脏页刷新／关闭人工签收仍沿此前 deferred 范围，不因新增 beforeunload 代码而冒签。

启动／查看／停止仍为 `pnpm trial:zhiban`、`:info`、`:stop`。旧课堂重建前已将双库 dump 与账号备份到本机私有目录 `/home/zxm/.local/state/zhiban-trial-backups/discussion-20261018-190550`（目录0700、文件0600）；不自动恢复到新课堂。新账号路径以 info 为准，不在文档中写密码。无 commit／push／CI dispatch，未访问真实55432／55433。

本次新账号文件为 `/tmp/zhiban-trial-content-ufZnB3/accounts.json`；停止会删除本实例，重启生成新账号。下一步沿原P3补个人资料与账户／目录的实际差额，建议模型 GPT-6.1 Sol / medium。
