# 原 P5 可解释风险规则与教师审阅

本包接已有事实名单、人工跟进、站内提醒和补救计划。教师选择启用教学班规则，实时查看命中依据并私有审阅，再显式登记／复用跟进和发布补救。规则命中是待核查事项，不是学生能力、心理状态或系统处分结论。

## 规则与事实口径

规则仅由具有当前教师角色及本班任教关系的教师配置；同班教师共享规则。默认全部关闭，24小时／60%／24小时仅为初始待选值，不自动生效。

| 规则 | 命中条件 | 可配阈值 |
| --- | --- | --- |
| OVERDUE 逾期未交 | 当前在班、当前发布的正式活动版本，最新原 Enrollment Attempt 的最新提交仍为空；达到截止后的宽限时间 | 0–720整数小时；0表示截止后立即 |
| LOW_SCORE 正式发布得分率低于阈值 | 同一原 Enrollment／当前正式活动版本的最新 Attempt、最新 Submission，已有正式成绩且 score/max 严格低于阈值 | 1–100整数百分比；等于阈值不命中 |
| PLAN_OVERDUE 补救计划超过目标时间 | 原 Enrollment 仍有效，计划 ACTIVE 且目标时间已过并达到宽限时长 | 0–720整数小时 |

不使用答案、学习草稿、评分草稿、私有联系信息、聊天或客户端分数；不将“教师尚未发布成绩”当作学生低分。练习、未发布草稿、撤回活动、旧活动版本、退班记录不进入当前队列。补救目标逾期只提醒教师核查安排，不据此证明学生没有学习。

每次配置产生不可变规则版本，记实际操作者与时间。阈值或启停变化不改写旧审阅。命中显示规则版本／阈值、截止或目标时间、原 Attempt／Submission／正式 publication／plan 引用；教师可追溯来源。

## 审阅与后续支持

- 队列是实时只读查询，刷新不创建审阅、case、Attempt、通知或学生标签。支持规则／判断筛选、姓名／成员ID／活动或计划标题搜索、每页20条。
- 教师首次选择“确认需要支持”或“暂不处置”，说明必填且仅任教教师可见。原规则与证据固定保存，不是公开的学生画像。
- 后续可追加修订为“确认需要支持／暂不处置／解除或结束审阅”，必须比较预期 revision 并留下新说明与当时事实。解除不改变原作答、成绩、跟进状态或学习完成。
- 事实已变化、规则关闭／换版、学生退班时，详情仍保留历史与当前对照；不允许把旧来源继续确认为当前支持依据。改变的正式 publication 或计划 revision 是新来源，可重新进入待审阅；旧记录不覆盖。
- 每个规则版本＋原 Enrollment＋固定活动版本／计划＋来源键只保留一份首次审阅。不同 key 重复审阅被拦截，同 key 重试返回原结果，不写重复事件。采样时间、显示姓名、逾期时长增长不用于去重，避免刷新产生重复事项。
- 需要支持后，教师才能显式“登记跟进并接补救入口”。已有同 Enrollment／活动版本的 case 或计划所属 case 直接复用；已结案的 case 不自动重开。缺少 case 的正式低分事项通过新增的受控人工审阅入口创建 private case，并保留 risk review 来源；原 CREATE_CASE 的“待处理学习事实”规则不变。
- 跟进、提醒及补救仍通过原入口操作。没有自动发消息、自动公开私有判断、自动更改成绩／Enrollment／尝试上限或自动发放新权限。

学生和普通管理员不能读取规则、命中队列、私有审阅和历史，也不能通过猜 id／修改请求字段获得访问。学生只看到教师另外明确撰写发布的计划／公共提醒；本包不把私有审阅复制进去。当前名单来自 Academic Enrollment 事实，不冒称已逐个验证学生登录能力；后续发布计划／提醒仍使用其既有接收者 Identity 守卫。

## 数据、授权与并发

新增独立 `zhiban_risk/0001_risk.sql`，只安装至新建 owned LOCAL PG16，不改任何旧 migration：

| 表 | 作用 |
| --- | --- |
| rules | 当前教学班配置与乐观 revision；只允许更新 enabled／threshold／revision |
| rule_versions | 不可变配置、实际教师和时间；历史审阅 FK 固定该版本 |
| reviews | 原 Enrollment、活动版本或计划的组合 FK、稳定来源、不可变初始证据；只允许更新判断／revision／关联case／更新时间 |
| events | 每份审阅每个 revision 唯一；私有说明、实际教师与当时规则／事实快照不可改写 |
| commands | tenant＋key 的实际 actor／教学班／载荷 SHA／结果；不可改写 |

业务表 FORCE RLS、租户策略，PUBLIC 无权限，沿用受限 Academic runtime。不可变数据无 UPDATE／DELETE，初始证据和锚点无可写列权限；没有新增 Identity 权限、SECURITY DEFINER、角色继承或 Native 写权限。

所有读写沿原 Academic／Learning 当前会话、教师角色、任教、课程和教学班守卫。规则变更取教学班配置排他锁，观察取共享锁；保存规则比较预期版本。审阅写入锁具体活动／计划、Enrollment 及选中的最新 Attempt，重新计算当前事实并比较证据摘要，防止换版、提交／更正、退班、关闭规则与旧判断交错。审阅修订使用行锁和预期 revision；同版本竞争只允许一方成功。原成绩发布／重交路径不变。

登记跟进复用原自然锚点锁与唯一约束。风险审阅、case、case创建事件、风险事件及命令回执同一业务事务；风险审计失败时，刚创建的 case 及其事件也全部回滚。只读详情持有审阅头部 SHARE，避免头部与事件跨越并发更新。教师撤销任教后，读写及成功命令重放均重新授权拒绝。

独立 builder 在另一个 owned Unix-socket PG16 从固定 SQL 来源构造 catalog／ACL 参考并清理；loader 仅读取校验 LOCAL reference、SQL SHA、ledger、live fingerprint，不由 web host 自行签发预期基准。独立参考构建不代表产品签收。

## API 与页面

教师课程导航“风险规则与审阅”：规则命中待审、审阅记录、规则设置。审阅详情可进入精确 followup case，再接原提醒与补救页。

`GET /api/zhiban/risk/:tenant/offerings/:offering`：

- `view=RULES` 当前规则；`view=QUEUE&code=ALL|OVERDUE|LOW_SCORE|PLAN_OVERDUE&decision=PENDING|SUPPORT|ALL&q=&cursor=` 实时命中。
- `view=HISTORY&decision=ALL|SUPPORT|NO_ACTION|RESOLVED` 私有审阅记录；`view=DETAIL&id=&cursor=` 固定证据、当前事实及分页事件。
- 游标 HMAC 绑定 actor、租户、教学班、视图、记录、规则及筛选；不能跨用，主机重启失效。队列翻页另绑定配置指纹，规则变更后须重查；跨页不承诺冻结事实快照。

同地址 `POST`：SAVE_RULE、REVIEW_SIGNAL、AMEND_REVIEW、LINK_FOLLOWUP，闭合 DTO、可信 Origin、CSRF 及命令号。客户端不能提供操作者、分数或证据快照。未保存说明接课程离开保护；审阅弹窗 ESC 不丢字；不确定提交冻结载荷并重试同命令。

## 本地验证与边界

`pnpm verify:zhiban:risk` 仅运行本包授权／数据／并发及受影响页面，复用已安装原生包，不重复扫描／导出／完整课堂／GitHub CI。

结果以[LOCAL receipt](evidence/zhiban-risk-local.json)、[产品旅程](evidence/risk/journey.json)为准。[运行](evidence/risk/directed.log)、[DTO／公式／路由](evidence/risk/unit.log)、[类型](evidence/risk/typecheck.log)、[ESLint](evidence/risk/lint.log)、[独立参考构建](evidence/risk/reference-build.log)；页面：[支持交接](evidence/risk/support-handoff.png)、[事实变化后解除](evidence/risk/resolved.png)。

本包不包含概念诊断、证据型画像、未决维度、AI风险预测、心理／健康判断、自动处分、外部通知或 Native Runtime。没有 commit／push／CI；不访问真实55432／55433，历史证据仍只适用于其自身来源。

上轮3461已停止且临时目录不存在，未声称取得新的切换前备份；已重新核验[昨晚保留的三库归档 SHA 与目录](evidence/risk/before-backup.json)，其时间范围仍为上一包，未做恢复演练。新默认实例使用新合成数据，不冒称恢复旧课堂。


## 2026-10-22 交付记录

本包的最终定向 PG16／页面旅程、单元检查、ESLint 和受影响依赖闭包 TypeScript 检查通过。全仓 TypeScript 检查因本机内存／交换压力主动中止，**不计为通过**；分别保留[中止状态](evidence/risk/full-typecheck-status.json)、[闭包配置](evidence/risk/tsconfig-scoped.json)和[最终检查日志](evidence/risk/typecheck.log)。本包结论不扩大到全仓类型检查或全部 P5 功能。

默认3461已用新合成课堂走通：教师明确启用60%规则，正式50/100进入待审；在内置浏览器保存“确认需要支持”并登记跟进，审阅版本2、不可变事件2、case创建事件1。学生读取私有风险详情返回403；另行明确撰写和发布的公共补救计划可读，未混入私有审阅说明，未自动发提醒，也未修改作答或成绩。[默认旅程](evidence/risk/default-browser-journey.json)、[教师审阅截图](evidence/risk/default-review.png)。

[默认实例来源核验](evidence/risk/default-source-check.json)零漂移；[冻结SQL来源核验](evidence/risk/frozen-source-check.json)零漂移，仅新增独立risk迁移。[当前三库归档](evidence/risk/default-backup.json)已核验SHA和归档目录，未进行恢复演练。停止默认实例仍会清理其专用临时cluster，归档不会自动恢复。未提交、推送或触发CI，未访问真实55432／55433。

[候选来源差额](evidence/risk/candidate-sources.json)只表示本包绑定来源相对上包receipt的变化，不替代包含既有dirty内容的Git差异。[本包签收范围](evidence/risk/closeout.json)。下一完整功能沿原P5推进“概念错误证据与教师纠错”，优先复用正式测验／题目和人工证据；证据型画像及未决维度仍保留待办。建议GPT-6.1 Sol / high，处理证据归属和授权接线。
