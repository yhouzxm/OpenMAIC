# 原 P5 站内提醒与学生确认回执

本包接续人工跟进，提供教师单独撰写学生可见提醒、学生课程内收件箱及显式确认、教师分页查回执。只补智伴的课程／Enrollment 与授权差额；不重造 OpenMAIC 播放、作答或评分能力。

## 使用与事实边界

教师从课程“教学分析 → 教师待跟进名单／跟进记录与结案 → 跟进详情”发送。提醒标题 120 字、正文 2000 字，均由教师明确填写；私有跟进说明、创建依据、学生答案、未发布成绩及其他接收者不进入学生 DTO。当前任教教师可协作查看该记录的投递及确认历史。

学生从课程内导航“站内提醒”查看本教学班自己的提醒，点击“我已知悉”才生成确认。GET、刷新和翻页不生成回执。“送达站内”只表示数据库投递成功，不证明阅读；确认只表示本人知悉，不代表提交、学习完成或成绩，不会自动结案。历史提醒展示原活动发布版本，不自动改绑新版本。

每个跟进最多保留一条待确认提醒；确认后教师可显式再次发送。新发送要求跟进 OPEN、预期 revision 匹配且原 Enrollment 当前有效。结案不撤销既有提醒，学生仍可确认；退班、账户／成员停用或学生角色失效后不能继续读取或确认。当前教师仍可查退班学生的历史回执。其他 Enrollment 不继承原投递。

本包不包含邮件、短信、浏览器推送、全站跨课程收件箱、定时催办或自动风险诊断；不会使用私有联系信息发送消息。

## 授权、并发和去重

发送的接收者只从服务端固定 case 锚点发现，客户端不得传 membership／actor／联系地址。发现不授予访问：随后复用冻结 Bridge `assertCurrent` 的 related participant 合同，在原锁序下守住接收者 User 与 Membership，检查其 ACTIVE 状态；经既有 Identity 连接对有效 STUDENT/SELF grant 取 SHARE 锁，并在业务提交前复检有效期。相关角色／用户／成员的锁持有至业务提交之后。没有新增 Identity helper、权限或角色继承，也没有改写冻结 SQL。

原课程、任教、学生本人守卫继续生效。发送和确认都锁原有效 Enrollment；学生必须是投递的原 membership，不能通过消息 ID、case 查询或请求字段访问别人数据。确认仍要求当下的学生授权，重放已成功命令也重新授权。收件箱只显示原 Enrollment 当前有效的本人记录；教师报告与学生视图为独立投影。

| 边界 | 行为 |
| --- | --- |
| 同命令 key 重试／并发 | 锁 tenant＋key；核对实际 actor、教学班和规范载荷 SHA，返回原结果，只投递一次 |
| 同 key 换载荷／操作者 | 冲突，不复用他人结果 |
| 换 key 重复发送 | 同 case 锚点锁；已有待确认投递则拒绝，防双击／重连绕过 |
| 重复确认／不同 key 并发 | 同 case 锚点锁及确认 PK；只保留第一次确认时间 |
| 确认与再次发送 | 同锚点序列化；确认先提交才允许下一条投递 |
| 结案与发送 | case SHARE／UPDATE 锁及预期版本；新发送不跨越已提交结案 |
| 发送／撤权 | 取得授权锁在先的业务可提交，撤权等待；撤权在先则新发送拒绝 |
| 部分写入失败 | 投递／确认与命令回执同一业务事务，任一写入失败全部回滚 |
| 不确定响应 | 教师冻结本次载荷和 key，提供“重试同一条提醒”；不生成新投递 |

学生确认不会改写投递正文；投递、确认和命令回执均无 UPDATE／DELETE 权限。教师说明的修正仍通过原跟进追加说明处理。

## 数据与接线

新增独立 `zhiban_reminder` 的 `0001_reminder.sql`，只装到新建 owned LOCAL PG16：

- `deliveries`：不可变的一名接收者投递，固定 case、原 Enrollment、教学班、接收者、序号、公共文本、实际发送者和时间。组合 FK 约束所属关系；case＋序号唯一。
- `confirmations`：每条投递至多一个不可变确认，组合 FK 绑定原接收者。
- `commands`：不可变命令摘要／操作者／教学班／结果。
- `schema_migrations`：来源 SQL SHA ledger。

业务表 FORCE RLS＋租户策略，PUBLIC 无权限；沿用受限 Academic runtime，仅 SELECT／INSERT。独立 builder 用另一 owned Unix-socket PG16 构造预期 catalog／ACL，退出时清理；loader 仅校验 LOCAL reference、SQL hash、ledger、实时指纹。参考构建不等于产品验收；web host 不现场生成自己的信任基准。旧 followup migration 和旧 reference 不改。

统一 LOCAL 主机显式安装并校验后才启用；缺失该能力不放宽旧授权。默认启动与专项验证保持分离。

## API

- `GET /api/zhiban/reminders/:tenant/offerings/:offering`：学生本人收件箱。
- `GET ...?case=:caseId&cursor=`：当前任教教师查看指定跟进的投递／确认；学生不能借此读取私有记录。
- `POST ...`：`SEND_REMINDER {caseId, revision, title, body}` 或 `CONFIRM_REMINDER {id}`。闭合 DTO、Origin、CSRF、命令 key。

每页 20 条，id 降序；HMAC 游标绑定当前 actor、租户、教学班与 case，不能跨用，重启失效；跨页不承诺冻结快照。

## 本地验收与证据

专项入口 `pnpm verify:zhiban:reminders`。结果以 [LOCAL receipt](evidence/zhiban-reminders-local.json) 与 [旅程](evidence/reminders/journey.json) 为准；日志为 [运行](evidence/reminders/directed.log)、[类型](evidence/reminders/typecheck.log)、[ESLint](evidence/reminders/lint.log)、[增量 ESLint](evidence/reminders/final-increment-lint.log)、[DTO／路由](evidence/reminders/unit.log) 和 [独立目录参考](evidence/reminders/reference-build.log)。页面见 [学生待确认](evidence/reminders/student-pending.png)、[教师回执](evidence/reminders/teacher-receipts.png)。

范围只涵盖本包接收者／去重／事务边界及受影响页面；不宣称全项目、Native Runtime、真实运营数据或生产迁移通过。没有 GitHub CI、commit 或 push；真实 55432／55433 不访问。此前 LOCAL／CI 证据继续只适用于其固定来源和范围。

切换前已对旧3461的三库和受限控制输入建立私有备份，[备份索引](evidence/reminders/before-backup.json)只证明 dump 与目录可读，未做恢复演练。新默认实例是新合成数据，不能冒称恢复旧课堂。


## 最终交付记录（2026-10-21）

本包定向 PG16／HTTPS 旅程 PASS，DTO／路由、TypeScript、ESLint 通过。首轮脚本误用卡片定位实际表格行，第二轮故障转发器的独立 CA 信任失败；修正为原 pinned-CA HTTPS 客户端转发后，包含丢弃成功响应的重试旅程通过，没有关闭 TLS 校验。异常退出残留的 owned fixture 已逐项核对 owner／PID／Unix socket 后清理，[清理记录](evidence/reminders/fault-harness-cleanup.json)不涉及真实 cluster。

之后只增加提醒区域间距、空状态隐藏及 CSS 路由／来源绑定，不改业务来源；[外观接线差异](evidence/reminders/style-increment.json)与最终默认浏览器旅程共同覆盖该增量，旧专项 receipt 不伪装为改后全部文件的证明。

当前默认3461为新合成课堂，内置浏览器实际完成教师公共提醒发送 → 学生显式确认 → 教师同记录查回执；[最终浏览器及持久化结果](evidence/reminders/default-browser-journey.json)、[教师页面](evidence/reminders/default-teacher-receipt.png)、[学生页面](evidence/reminders/default-student-confirmed.png)。仅一条投递／确认，私有说明未进入学生结果；case 仍 OPEN／revision1、仅原一条创建事件，待跟进学习事实仍5项。[当前运行](evidence/reminders/default-info.log) sourceMatches=true，[来源检查](evidence/reminders/source-check.json)漂移0，[既有冻结 SQL／migration](evidence/reminders/frozen-source-check.json)漂移0。当前三库另有[私有备份索引](evidence/reminders/default-backup.json)，只检查 dump／目录，未做恢复演练。

保留原 P5 待办：概念错误／证据型画像、风险与补救方案，维度 REVIEW 仍未决；本包不宣称 P5 全部完成。下一完整功能建议为“教师补救计划与学生任务／效果回看”，复用原活动与已发布成绩事实，建议 GPT-6.1 Sol / medium；若引入新的跨 Identity 并发授权，再用 high。
