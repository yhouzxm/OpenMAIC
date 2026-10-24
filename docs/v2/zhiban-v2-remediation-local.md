# 原 P5 补救计划、学生任务与效果回看

本包接续事实名单、人工跟进和站内提醒。教师从具体跟进制定学生可见计划，关联 1–5 项本教学班已发布正式作业／测验；学生从课程内“补救任务”进入原活动作答并逐项反馈；教师比较安排时基线与当前真实记录，记录评估、继续或结束计划，也可说明后取消。

## 产品规则

- 计划标题、目标、目标时间及任务列表在发布后固定。需要更改安排时，取消原计划并另发；同一跟进最多一份 ACTIVE 计划。不是再次开一个作业／Attempt 引擎，也不自动加尝试次数或覆盖原截止／重交限制。
- 接收者只从既有 case 的原 Enrollment／membership 确定。创建要求原跟进 OPEN、预期 revision 匹配、当前在班且 Identity 账户、成员和 STUDENT/SELF 角色有效；当前教师必须仍具本班任教及角色授权。不存在客户端指定接收者、证据、成绩或状态的入口。
- 所有计划目标、学生反馈和教师评估说明都对该学生可见，表单明确标记。私有 case 说明及依据不复制；学生看不到其他人的计划、成员 ID、Enrollment、case ID、私有说明、答案或评分草稿。
- 计划目标时间只用于安排与提示，不是新的提交截止。正式作答仍进入原活动并遵守其当前规则。计划固定活动发布版本，换版／撤回后不静默跳到新版本，也不启动新尝试；教师需另行安排。
- 学生逐项反馈“我已处理，申请教师复核”或“我需要帮助”，必须填写说明。反馈是本人自报，不是系统完成、提交或成绩事实。
- 教师评估“继续补救”使计划保持 ACTIVE；“已达到本次目标”结束为 CLOSED；取消为 CANCELLED。说明必填，每次保存实际操作者、时间、预期版本及不可变事件。教师可结合线下情况人工判断，系统不据此宣称每项作业都已完成；未提交事项仍如实展示，原事实名单／成绩／case 状态不变。
- 原跟进结案不自动结束已有计划；当前教师可查看历史 Enrollment 的计划并作终态处理。退班或学生授权失效后，学生不能读取、反馈，也不能重放成功命令继续访问。不同 Enrollment 不继承原计划。
- 发布后计划出现在学生课程任务页。若需要通知，教师通过“返回原跟进／发送站内提醒”使用现有显式公共提醒及确认回执；本包不自动发邮件、短信或复制私有联系信息。

## 效果口径

每项任务保存安排时不可变基线；当前视图及教师评估取同一原 Enrollment／membership、固定活动版本的最新 Attempt、其最新 Submission、该 Submission 的最新正式 Assessment publication。显示真实 ID／版本／时间及已发布分数；不读答案、学习草稿或 grades 草稿列，不把旧提交分数套到新提交上。

教师每次评估另外保存该时点的固定证据快照。后续换版、重新提交或成绩变化影响“当前真实记录”，不会覆盖安排基线及旧评估证据。双方都有已发布成绩时显示得分率百分点变化；不能据此证明补救措施的因果效果。不因计划、学生反馈、提醒确认或人工结论写入原完成／评分事实。

## 数据与授权并发

新增独立 `zhiban_remediation/0001_remediation.sql`，只用于新建 owned LOCAL PG16，不改任何已应用 migration：

| 数据 | 约束 |
| --- | --- |
| plans | 原教学班／case／Enrollment／接收者固定；ACTIVE／CLOSED／CANCELLED 与 revision 可更新；每个 case 最多一个 ACTIVE |
| tasks | 最多5项、位置及活动唯一；固定发布版本组合 FK、标题及不可变基线 |
| events | 每个计划 revision 唯一；发布、逐项反馈、评估及取消事件；评估快照不可修改 |
| commands | tenant＋key 唯一，实际 actor／教学班／规范载荷 SHA／原结果；重试不重复发布或写事件 |

业务表 FORCE RLS、租户策略；PUBLIC 无权限。只有 plans 的 state／revision／updated_at 有 UPDATE，task 基线／公共目标／锚点／事件／回执无 UPDATE 或 DELETE。沿用受限 Academic runtime，不增加 Identity 权限或 helper／角色继承，不启用 Native Runtime。

创建复用既有 `runForFollowupRecipient` 与 Bridge related participant 守锁，包含接收者账户／成员状态、有效学生 grant 及提交前有效期复检。普通读写复用当前角色、任教或学生 Enrollment 守卫。重复命令也重新授权。同 key 改载荷或换操作者冲突；不同 key 重复创建受 case 锁与 ACTIVE 唯一索引拦截。

计划行锁及预期 revision 串行化反馈／评估／取消；并发同版本只允许一方成功。读取详情持有 plan SHARE，头部与事件不跨越计划更新。证据按活动 ID 的固定顺序取 SHARE，再锁选中的最新 Attempt，阻止原发布／新尝试／重交／评分与采样交错；无新 Learning 写入口。计划、任务、事件及命令回执在同一业务事务，审计失败全部回滚。

独立 builder 在另一 owned Unix-socket PG16 从固定来源构造 catalog／ACL 参考并清理，loader 仅读取校验 LOCAL reference、SQL hash、ledger、live fingerprint；web host 不生成自己的预期信任基准。缺安装或校验失败不放宽权限。默认启动与专项验证分离。

## API 与页面

`GET /api/zhiban/remediation/:tenant/offerings/:offering?mode=TEACHER|STUDENT`：按当前授权返回计划，每页20条。

- 教师可用 `case` 过滤跟进；`id` 读取详情及任务、当前真实记录和分页历史。
- 教师 `options=1&q=&cursor=` 为已发布正式活动分页选择器；草稿、撤回、练习及其他教学班活动不返回。
- 学生始终按服务端 membership 和原有效 Enrollment 限定，不能用 mode 或 id 越权。
- HMAC 游标绑定 actor、租户、教学班、用途、case／id 和搜索；不能跨用，主机重启后失效。跨页不宣称冻结快照。

同地址 `POST` 使用闭合 DTO、可信 Origin、CSRF 与命令号：ASSIGN_PLAN、REPORT_TASK、REVIEW_PLAN、CANCEL_PLAN。表单保留冲突输入，对不确定结果冻结原载荷并重试同一命令；未保存内容接课程离开保护。

教师课程内新增“补救计划”，从跟进详情“制定／查看补救计划”保留精确学生上下文；可精确返回原跟进及提醒。学生课程内新增“补救任务”。复用原课程布局、Learning 作答及 Assessment 评分。

## 本地验证与证据范围

专项命令 `pnpm verify:zhiban:remediation`。结果以 [LOCAL receipt](evidence/zhiban-remediation-local.json)、[产品旅程](evidence/remediation/journey.json) 为准。验证只覆盖本包新增数据／授权／并发及页面，不重复扫描、导出、完整课堂或 GitHub CI。

[运行日志](evidence/remediation/directed.log)、[类型](evidence/remediation/typecheck.log)、[ESLint](evidence/remediation/lint.log)、[DTO／路由](evidence/remediation/unit.log)、[独立参考](evidence/remediation/reference-build.log)；页面：[教师计划](evidence/remediation/teacher-plan.png)、[教师评估](evidence/remediation/teacher-effect.png)、[学生回看](evidence/remediation/student-review.png)。

不包含自动风险模型、概念诊断、维度画像、AI 补救推荐或 Native Runtime；也不代表生产数据迁移／部署。没有 commit／push／CI；真实55432／55433不操作。旧证据继续仅适用于自身来源。

切换前已有三库与受限控制输入的[私有备份索引](evidence/remediation/before-backup.json)，只验证 dump 与目录，未演练恢复。默认新实例是新的合成课堂，不冒称恢复旧课堂。

## 最终交付记录（2026-10-21）

本包专项 PG16／HTTPS 产品旅程 PASS：教师从精确跟进进入并发布双任务；学生请求帮助、在原活动真实重交；评分草稿不可见，正式发布后由50分变85分；逐项申请复核、教师继续／结束、另一个学生计划取消均通过。还覆盖首次并发同 key 及重放、ACTIVE 去重、反馈／评估同版本竞争、审计失败回滚、他人／角色访问、接收者学生角色撤销、退班及固定版本换版隔离。首轮发现新页面缺课程壳 `.local` 标记导致入口失败，补齐后本包旅程通过；未改原课程授权逻辑。

默认3461是新的合成课堂，通过真实受控命令准备50分基线与后续85分正式成绩、学生申请复核。内置浏览器实际保存“继续补救”及固定85分证据，计划 ACTIVE／revision3，case 仍 OPEN／revision1。学生可读取公共评估，私有 case 说明被排除；见[当前浏览器／持久化结果](evidence/remediation/default-browser-journey.json)与[实际效果对照](evidence/remediation/default-comparison.png)。当前[启动信息](evidence/remediation/default-info.log) sourceMatches=true，[默认来源](evidence/remediation/default-source-check.json)及[专项来源](evidence/remediation/source-check.json)持久文件漂移0，[旧SQL／migration](evidence/remediation/frozen-source-check.json)漂移0。当前三库另有[备份](evidence/remediation/default-backup.json)，只验证归档及目录，未测试恢复。

本包完成原 P5 的人工补救差额，未宣布 P5 全部完成。下一完整功能为可解释风险规则与教师审阅；概念诊断／证据型画像和维度 REVIEW 仍待，不能从聊天或未提交记录直接推断能力。建议 GPT-6.1 Sol / high。
