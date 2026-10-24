# P3 课程讨论：复用差额与接入合同

2026-10-18。状态：IMPLEMENTED_LOCAL_CANDIDATE；已按下列合同完成[本地产品包](zhiban-v2-course-discussion-local.md)，仅在默认 owned3461 启用。沿用唯一主线 P1–P7，真实库未安装。

## 实际源码结论

核对本地固定对象，不声称远端最新：旧智伴 `0fa0a15e8b12ae9e4f7a2d78e80338874599bbae`，官方 OpenMAIC 1.2.0 `a9da60b3b4adb429369c0da13d5637a904ead2b0`。

| 能力 | 实际实现 | 接入结论 |
| --- | --- | --- |
| 原生课堂聊天 | `app/api/chat/route.ts` 接收消息及场景状态，调用模型并流式生成；`lib/utils/chat-storage.ts` 将会话写入 learner RuntimeStore | 保留原生能力；不作为同班共享讨论后端，不为讨论开启 Runtime／模型 gate |
| 原生聊天持久化 | `lib/utils/chat-storage-core.ts` 的会话 ID 包含 stageId、learnerKey、chatSessionId；`lib/runtime/learner-key.ts` 使用服务器配置的 learner partition | 有持久化，但分区用途不同；不能把多名学生映射为同一个 learnerKey 来共享 |
| SDK 公共入口 | Storage 提供 document／runtime／KV／asset 原语；当前未找到教学班共享主题、回复和任教管理合同 | 这些原语不等于业务授权 API；不导入私有聊天 store，不复制 AI 编排器 |
| 旧课程讨论 | `lib/zhiban/content/service.ts` 的 create/updateDiscussionTopic、createTeacher/StudentDiscussionPost、moderateDiscussionPost、学生 topics/posts 查询；迁移 036／037 | 保留教师主题、师生回复、开关讨论与管理需求；按当前 Offering／Membership 重写边界 |
| 旧讨论成绩／完成 | 旧 service 可绑定 gradeItem，学生发帖后写 completed/100% | 不沿用“发帖即完成”；讨论评分、课程总评和完成规则留待明确，不接现有 Grade 冒充测验或作业 |

## 首个完整交付范围

教师在当前教学班创建主题草稿，填写标题及说明，显式开放；学生从同一课程导航进入讨论，发言和回复，教师回复、关闭／重新开放主题、隐藏／恢复发言并填写原因。关闭后仍可读，禁止追加；草稿／归档对学生不可见。首版主题属于教学班，暂不增加新的章节单元类型，避免改变已发布目录合同。

学生不创建主题；当前任教教师可管理当前班级主题，不按创建者独占。学生可查看当前班级公开发言，旧成员留下的公开发言继续显示；退课者本人失去整个讨论的读写权限。作者姓名使用服务端允许的展示名投影，不返回 UserId、Enrollment 清单、凭据或任意个人字段。作者退课不级联删除历史。恢复 Enrollment 的历史访问继续服从既有教务合同。

首版纯文本，标题 1–120 字、说明最多 2000 字、发言 1–4000 字；用 textContent／React 文本呈现，不允许 HTML、附件、外链自动抓取、AI 代发、匿名或通知。回复只允许同一主题中的可见父帖；展示平铺时间线及“回复某人”引用，避免无限树展开。隐藏内容对学生只投影占位状态，不返回正文或管理原因；教师可查看原文及管理记录。首版不硬删除，不修改已发送正文。

## 数据、授权及事务接线

采用独立业务 schema `zhiban_discussion` 和新 successor migration，不能修改现有已应用迁移或借 Content Native ACL 写讨论。准备 topics、posts、moderation_events、commands 四类表；每行 tenant_id，强制 RLS；所有资源使用 tenant＋offering＋id 复合约束。posts.parent_id 的复合 FK 包括 topic_id，数据库拒绝跨主题引用。moderation_events 和 commands 仅允许追加；主题状态／帖子可见性用列级 UPDATE ACL，应用角色无 DELETE／DDL／owner 权限。

每次查询及写入都通过现有 AcademicStore.run 校验真实 Session／Tenant／Membership，复用 Learning.access 的任教／Enrollment 检查与 FOR SHARE 屏障；管理员没有代任教或代发言权限。客户端 author／role 字段无效且应被严格输入校验拒绝。班级关闭时拒绝新主题／发言与重新开放，历史只读；课程归档仍按既有 access 拒绝。不能只在页面加载时授权。

写入顺序：既有身份／任教或 Enrollment 锁 → 租户及命令号 advisory lock → 主题 FOR UPDATE → 可选父帖／目标帖锁 → 业务变更＋审计＋命令结果同事务提交。所有主题写入都先锁同一主题；关闭与发帖、隐藏与回复因此有确定先后。教师状态变更带 revision CAS；发帖不携带过时主题 revision，而在取得锁后再次验证 OPEN。撤权以现有授权锁／提交检查为线性化边界，不新增旁路身份快照。

命令号绑定 tenant、actor Membership、offering、规范化完整 payload hash；未知结果保留原命令号并锁住表单，重试只返回原结果；相同号不同 actor／payload 拒绝。重放前仍检查当前授权。主题 revision、created_at 由服务器产生；事件含操作者、主题／帖子、前后状态、原因和服务端时间，不在常规日志复制发言正文。

只在 owned disposable PG16 安装验证；独立核对新 schema／表／函数／ACL hash，receipt 对旧安装必须 fail closed，不改旧 receipt 冒充支持新增表。扩展业务 catalog 后需要重新构建组合 expected profile；原生 Bridge／Content 权限本身不扩张。真实库安装不包含在本设计中。

## API 与页面合同

在现有 Learning HTTP 认证／CSRF／Origin 和 request-target 白名单内扩展有界路由：

- `GET .../offerings/:offering/discussions`：主题列表，limit 默认20、最大50；学生仅 OPEN/CLOSED，教师可按状态过滤。
- `GET .../discussions/:topic/posts`：同主题发言分页，教师可显式读取管理记录；学生没有该投影。
- `POST .../discussions`：CREATE_TOPIC、EDIT_TOPIC、OPEN_TOPIC、CLOSE_TOPIC、ARCHIVE_TOPIC、POST_MESSAGE、HIDE_POST、RESTORE_POST。严格字段、命令号、主题 revision、原因及资源归属校验。

主题按 created_at/id 倒序、发言按 created_at/id 正序，稳定 keyset；cursor 使用本包服务端 HMAC key，绑定 tenant／actor／offering／topic／过滤器／limit，不能跨人或跨班重用，不用可猜 offset 充当授权。

教师／学生课程内导航各增加“课程讨论”，沿现有课程壳、分页组件与未保存离开保护；页面保留 offering／tenant／role 上下文。失败保留输入，未知结果按原命令查询／重试，冲突显示最新状态。关闭时明确提示只读。表单和日志不显示底层 Native handle。讨论页无需打开原生 AI 课堂。

## 一次性交付与验收

按“教师开放主题 → 学生发言及同主题回复 → 教师回复／隐藏／恢复 → 关闭后学生只读 → 重新开放后可继续”交付一个本地产品包，同时检查分页和返回上下文。定向负向覆盖：学生管理拒绝、管理员代任教拒绝、跨租户／跨班／跨主题父帖拒绝、隐藏正文不泄露、退课及任教撤销立即拒绝、关闭与发帖串行化、隐藏与回复串行化、事务故障无半写、同号重试无重复、payload 冲突拒绝、无 Grade／完成率副作用。

本文件保留源码差额和接入合同；实现、局部调整与验收见[本地产品包](zhiban-v2-course-discussion-local.md)。当前没有 discussion 生产入口；旧 CI 及早先 Quiz 课堂试用证据不能证明讨论已通过，讨论使用独立 LOCAL 旅程及交付收据，不追加 GitHub 测试。
