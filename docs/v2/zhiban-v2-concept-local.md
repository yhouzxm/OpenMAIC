# 原 P5 概念错误证据与教师纠错

本包复用新版 OpenMAIC 的固定测验题目／结构化提交及智伴正式评分；新增教师明确判断和纠错生命周期，不另做自动概念诊断器，也不从聊天、客户端分数或失分率推定能力。沿原 P5 接既有补救入口，证据型画像和维度 REVIEW 仍独立待办。

## 可见闭环与证据范围

教师课程“概念纠错”提供当前正式失分作答证据、草稿和纠错记录。教师选择题目或人工评分文本，填写概念名称、给学生的纠错说明、下一步建议及独立的教师私有依据；保存为仅教师可见草稿，再明确发布。失分只是登记入口，不自动创建概念错误或学生标签。

- 测验采用原固定活动版本的公开题目字段、该次已提交答案和正式 publication 的逐题 marks；不读取答案键、analysis、评分草稿、未提交答案或私有风险审阅。简答题与客观题使用相同正式评分来源，不重算客观分数。
- 文本活动采用原固定版本、已提交文本及人工正式总分。该来源只证明作答与人工评分存在，不证明已形成概念错误。
- 入口仅列原有效 Enrollment、当前发布的正式活动版本、最新 Attempt／Submission／正式 publication 中失分的题目或文本；排除 PRACTICE、草稿、退班和旧来源。
- 教师创建时重新锁定并核验来源摘要，每个正式 publication＋题目（文本为空题号）只有一份登记；刷新、查询不创建记录。相同来源已有记录可直接打开；新正式 publication 可独立登记，不覆盖旧证据。
- 测验必须通过原命令关闭答案复核后，才能发布／更正公开纠错说明。草稿不能绕过原答案释放边界；教师可先登记草稿，待关闭后刷新发布。

学生课程“概念纠错”只显示明确发布给本人、原 Enrollment 仍有效的记录。学生提交自己的解释或问题；这是本包自报，不创建 Attempt／Submission，不改变原成绩或完成。教师核对最新学生解释和当前正式来源后，公开判断“继续澄清”或“本次已纠正”，并保留另写的私有依据。教师可更正已公开说明或撤回误判，原记录和说明历史始终保留。

页面分别展示登记时固定证据与当前来源核对。原成绩更正、重交、换版或退班使原来源不再 fresh，不回写原证据，也不能用旧来源发布／更正为当前依据。教师仍可根据当前事实和学生解释进行人工复核／撤回；确认本次已纠正不等同于系统认证概念掌握、改变正式分数或生成画像。

## 状态与命令

| 状态／命令 | 条件与结果 |
| --- | --- |
| CREATE_CORRECTION → DRAFT | 当前正式失分依据＋摘要；初始内容与私有依据不可变事件；学生不可见 |
| EDIT_DRAFT | DRAFT，预期 revision、当前来源摘要；修订原因必填，原事件保留 |
| PUBLISH_CORRECTION → OPEN | DRAFT，来源 fresh、测验原复核已关闭、原 Enrollment 有效；接收者 Identity／STUDENT 角色守锁，明确发布 |
| REVISE_FEEDBACK | OPEN，同样公开发布门槛，说明和理由作为新公开版本；私有依据另存 |
| RESPOND | 本人原有效 Enrollment、OPEN、预期 revision；学生解释新事件 |
| ASSESS → OPEN／RESOLVED | 当前任教教师、预期 revision、当前来源摘要和最新 responseRevision；公开说明、私有依据；至少有一份学生解释 |
| RETRACT → RETRACTED | OPEN／RESOLVED，预期 revision，明确公开撤回原因；学生可回看历史撤回声明 |

不支持通过修改已发布内容静默抹掉旧判断；不自动重开已结束记录。草稿没有公开发布，不假装“撤回已发布判断”；保留教师草稿不等于发给学生。学生本人页面省略 CREATE／EDIT_DRAFT 事件和 private_note，不返回其他学生记录。公共历史仍展示明确发布时的说明、回复、复核和撤回。

## 数据与授权边界

新增独立 `zhiban_concept/0001_concept.sql`，仅供新建 owned LOCAL PG16 安装，不修改任何已应用 migration：

| 表 | 作用 |
| --- | --- |
| corrections | 原 Enrollment／活动版本／Attempt／Submission／publication／题号，固定原始证据、当前状态／revision、最新公开内容 |
| events | 每 revision 唯一、不可变的动作／状态、公开内容、证据快照、单独 private_note、实际操作者与时间 |
| commands | tenant＋key，绑定 actor、教学班、规范化载荷摘要及结果；不重复写事件 |

业务表 FORCE RLS，PUBLIC 无权限；原证据、锚点、创建者、历史与回执没有 UPDATE／DELETE，header 只允许更新状态／revision／公开内容／更新时间。组合 FK 固定业务来源。loader 仅读取固定来源 SHA、ledger、catalog／ACL，独立 PG16 builder 构造可信 LOCAL expected profile；web host 不自行安装或推导可信基准。

所有读写复用原 Identity 会话及 Learning 课程、角色、任教／Enrollment 守卫。公开发布与公开更正新增 `runForConceptRecipient`：只按不可变 correction 记录发现接收者，使用既有 related Identity 守锁和 STUDENT 授权；接收者不可由请求字段提供。不新增 Identity 权限或绕过原撤权／有效期屏障。其他教师私有整理／复核／撤回仍使用当前教师授权，不把停用学生登录当成不能撤回教师误判的理由。

来源重验按活动 SHARE、测验定义 SHARE、原 Enrollment SHARE、原与同版本最新 Attempt 的稳定ID顺序 SHARE。原活动／提交／评分写入继续使用其既有 UPDATE 锁。纠错头部写入 UPDATE，详情 SHARE，避免头部与事件跨版本；学生解释与教师复核同 revision 竞争只允许一方成功。审阅变更、事件和命令回执在同一事务；审计失败不能留下半份公开内容。成功命令重放先重新授权，不用旧回执绕过教师撤权或学生退班。

## API 与页面

`GET /api/zhiban/concept/:tenant/offerings/:offering`：

- `mode=TEACHER&view=SOURCES&q=&cursor=`：每页20条当前正式失分来源。
- `mode=TEACHER|STUDENT&view=LIST&state=ALL|DRAFT|OPEN|RESOLVED|RETRACTED&q=&cursor=`：每页20条；学生无 DRAFT。
- `mode=TEACHER|STUDENT&view=DETAIL&id=&cursor=`：固定证据、当前来源、最新学生解释版本和每页20条不可变事件。

同地址 POST 接上述闭合 DTO、可信 Origin、CSRF 和 command key。游标 HMAC 绑定实际 actor／租户／教学班／视图／id／状态／查询，不可跨用。实时列表不承诺跨页冻结业务事实。教师和学生课程导航接同一页面；仅使用 textContent 构造文本，接原课程离开保护及不确定提交同命令重试。

## 本地验收

`pnpm verify:zhiban:concept` 仅运行本包正式证据、教师发布、学生解释、复核／撤回、授权和并发检查及受影响页面；复用已安装原生构建，不触发外部模型、扫描、导出、完整课堂或 GitHub CI。

最终状态见 [LOCAL receipt](evidence/zhiban-concept-local.json) 和 [产品旅程](evidence/concept/journey.json)。不把构造参考、单元检查或页面截图单独作为完整产品签收。默认实例、备份和最终来源核验在本轮 closeout 中单列。


## 2026-10-22 最终本地交付

最终[定向运行](evidence/concept/directed.log)、[单元检查](evidence/concept/unit.log)、[受影响依赖闭包类型检查](evidence/concept/typecheck.log)及[受影响文件ESLint](evidence/concept/lint.log)通过。[类型检查范围](evidence/concept/tsconfig-scoped.json)包含新领域／API／PG实现、Academic接线、loader／builder和验证脚本；本轮未执行全仓类型检查，不借用上轮全仓中止状态冒称已通过。

PG16验证覆盖正式测验题目与人工文本、评分草稿／练习排除、原答案复核关闭前拒绝公开、固定原始证据、正式成绩更正后的旧依据拒绝、教师公开更正／撤回、学生本人隔离、私有历史／依据不外泄、同key重放／异载荷冲突、学生解释与教师复核并发冲突、审计失败回滚、接收者STUDENT角色撤销阻断发布、退班后旧发布回执拒绝、教师任教撤销后拒绝，以及RLS／不可变ACL。另验证中文字段各自达到2000字符时可在32KiB请求边界内保存，不被旧16KiB上限截断。只在owned disposable使用受控负向故障，不改真实数据。[旅程结果](evidence/concept/journey.json)。

默认3461已在内置浏览器用两角色走通教师登记草稿→明确发布→学生补充解释→教师复核结束，记录revision4，教师事件4／学生公开事件3，原正式成绩仍0/10、publication1、原提交与Attempt不变；未自动发提醒、安排补救或请求模型。[默认浏览器旅程与受限HTTP回读](evidence/concept/default-browser-journey.json)、[教师截图](evidence/concept/default-teacher.png)、[学生截图](evidence/concept/default-student.png)。默认入口仍为`https://127.0.0.1:3461/zhiban`；登录后从教师／学生课程导航“概念纠错”进入。

[默认实例来源](evidence/concept/default-source-check.json)、[最终验证来源](evidence/concept/source-check.json)和[冻结SQL来源](evidence/concept/frozen-source-check.json)零漂移。仅增加独立concept迁移，不改已应用SQL或冻结授权语义。旧默认实例在本轮开始时已停止且目录不存在，只重新核验[上包三库归档](evidence/concept/before-backup.json)；当前默认用新合成课堂，不声称恢复了旧课堂。已取得[当前三库归档并核验SHA／归档目录](evidence/concept/default-backup.json)，**未做恢复演练**。停止默认实例仍会清理专用临时cluster，归档不会自动恢复。

[最终候选来源差额](evidence/concept/candidate-sources.json)不是全部dirty工作的Git差异；[本包签收范围](evidence/concept/closeout.json)限定本次可见功能。未提交、推送、CI或真实55432／55433访问。概念判断仍由教师明确作出，不包含自动诊断、认证掌握、证据型画像或未决维度。下一完整功能沿原P5推进证据型学习画像及本人纠错入口；画像维度REVIEW保持待决定，不照搬旧计算器。建议GPT-6.1 Sol / high，集中处理证据归属与本人／教师授权。
