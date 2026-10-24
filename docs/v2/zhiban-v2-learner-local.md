# 原 P5 证据型学习画像与本人纠错

本包沿原 P5 复用正式评分、已公开概念纠错和补救安排／教师评估。现有个人资料 `profile`、统计概览 `progress` 与本包 `learner` 分开：不重复建立身份或统计体系。画像是可核对的公开证据及教师明确写出的学习观察，不是自动能力评分。维度继续 **REVIEW**；不照搬旧五维／六维计算器，不生成排名、掌握认证或自动干预。

## 完整可见流程

教师在课程“学习证据画像”搜索／分页选择本班当前 Enrollment，查看证据范围、来源证据、学习观察和本人纠错记录。学生同入口只看本人的当前 Enrollment，不能选择其他学生或混入转班／重入班前的旧 Enrollment。

| 来源 | 采用范围 | 能证明什么 |
| --- | --- | --- |
| GRADE | 原 Enrollment、当前正式活动版本的最新 Attempt／Submission／正式 publication；排除 PRACTICE 与评分草稿 | 仅证明该次正式成绩；不包含答案、题目答案键或草稿，也不推断稳定能力 |
| CONCEPT | 本人已明确公开的概念判断及其版本／状态／公开说明；排除教师草稿与已撤回判断作为新引用 | 明确注明为教师判断，不当作系统诊断；原正式成绩后来更正时显示对照提示 |
| REMEDIATION | 本人明确安排的未取消补救计划、公共目标及最新教师评估 | 区分教师安排与教师评价；不把学生自报当作正式表现或系统完成 |

风险私有审阅、跟进私有说明、概念 private_note、聊天、未提交答案、评分草稿和学生自报文字均不进入画像证据。来源计数只是当前可用记录范围，不是学习能力或证据置信概率。没有记录不意味着能力不足。

教师撰写学习观察时必须明确引用 1–5 条来源，选择“证据有限”或“引用可支持本次观察”。这是教师对本条观察的充分程度声明，不由引用数量或分数自动生成。教师草稿对学生不可见；明确发布后，学生看见该条文字、固定引用、当前来源对照、教师充分程度声明及公开历史。后续修订与撤回均留痕，不静默替换旧说明。

学生可针对某条公开且未撤回的观察提出本人纠错，填写问题与期望更正；每条观察最多一份 OPEN 请求。学生可追加说明，教师可“保留当前观察并解释”“采纳并修订”“撤回并结束”。提出请求时的观察版本及固定引用不可改写；处理时同时展示当前观察和原请求。请求处理结果对本人公开，不自动发站外通知。

纠错指向本包教师学习观察。若涉及原正式成绩或概念记录，教师需先走其原更正／撤回入口，再引用当前来源修订画像；本包不直接改成绩、作答、Enrollment、概念判断或补救效果。已有先行撤回的观察仍可在请求中确认撤回并结束，避免留下无法处理的 OPEN 请求。

## 来源版本与状态

每条引用固定来源类型、实际来源ID、来源快照及摘要。正式成绩更正、概念判断变化／撤回、补救计划状态或版本变化、退班或活动换版都会使相关引用显示差异。快照不包含读取时钟或显示姓名，刷新不会制造新版本。

- CREATE_OBSERVATION → DRAFT：原有效 Enrollment、1–5 条当前来源及精确摘要。查询不创建观察或请求。
- EDIT_DRAFT：比较观察 revision，重新选择当前来源、填写修订理由；原草稿事件保留但不对学生公开。
- PUBLISH_OBSERVATION → PUBLISHED：原有效 Enrollment、接收者当前 Identity／STUDENT 授权、精确当前引用摘要；全部引用仍一致且可用。
- REVISE_PUBLIC：同样公开发布边界，新的内容与引用单独留版本，公开修订理由。
- WITHDRAW_OBSERVATION → WITHDRAWN：当前任教教师明确公开说明，保留原文字和引用；不依赖学生仍能登录，教师可撤回误判。
- OPEN_DISPUTE／APPEND_DISPUTE：原有效 Enrollment 的本人；观察／请求预期 revision；原观察已公开，追加仅限 OPEN 请求。撤回后不能新提请求，已存在请求可以补充并由教师确认结束。
- RESOLVE_DISPUTE：任教教师，比较请求 revision 与当前观察 revision。KEEP 还要求当前引用全部一致且可用；REVISE 重新验证当前来源并把观察修订与请求结案放入同一事务；WITHDRAW 可撤回或确认已先行撤回的观察，再结束请求。

同 key 重试绑定 tenant／offering／实际 actor／规范化载荷，只写一次；异载荷复用 key 冲突。学生本人操作与公开发布的成功回执不能绕过当前本人关系、教师授权或接收者授权。保留／修订等公开发布还要重新验证接收者当前角色与原 Enrollment；教师私有草稿回执及历史撤回仍以当前任教授权为准。

## 数据与授权

新增独立 `zhiban_learner/0001_learner.sql`，只安装至新建 owned LOCAL PG16。既有已应用 migrations 不改动。

| 表 | 保存内容 |
| --- | --- |
| observations | 原 Enrollment／member／教学班、当前状态、观察 revision、内容版本、公开内容与教师声明 |
| events | 每观察每 revision 唯一的不可变内容、引用与操作快照；草稿事件仅教师可见 |
| citations | 每内容版本 1–5 个不可变来源快照；GRADE／CONCEPT／REMEDIATION 各有实际来源FK，并引用对应观察事件 |
| disputes | 原观察版本与不可变快照、原 Enrollment、请求状态和 revision；每条观察最多一份 OPEN |
| dispute_events | 本人问题／期望、追加、教师处理与当时观察快照，实际操作者与时间；不可变 |
| commands | tenant＋key，绑定 actor／offering／载荷摘要与已完成结果；不可变 |

业务表 FORCE RLS，PUBLIC 无权限；仅受限 Academic runtime 可以 SELECT／INSERT，只有观察当前内容／状态／revision 与请求状态／revision 可更新。引用、来源锚点、原请求快照、事件和回执没有 UPDATE／DELETE；组合FK把请求绑定到同一观察／原 Enrollment／member／教学班。新增SQL没有 SECURITY DEFINER、Identity角色继承或额外冻结权限。

所有操作复用原 Identity 会话与 Learning 课程／任教／Enrollment 守卫。新增 `runForLearnerRecipient` 只按不可变观察或请求查接收者，复用原 related Identity 守锁、当前 STUDENT 角色与有效期；请求不能指定操作者或接收者。来源核验使用活动／原与最新 Attempt、概念头部或补救计划共享锁；原成绩／提交及相应来源写入继续使用其既有 UPDATE 屏障。学生原 Enrollment 共享锁保护退班／重入班隔离。

详情按请求→观察的稳定顺序共享锁；写入按对应头部 UPDATE 锁与预期版本比较。学生补充和教师处理同请求版本竞争仅一方成功；来源变更需要重新核对，不能保留过期依据为当前有效。观察修订／新引用／观察事件／请求结案／请求事件／命令回执在同一事务；事件失败全部回滚，不能形成“已修订但请求未结案”的半份结果。

独立 PG16 builder 从固定 SQL 构造 LOCAL catalog／ACL 参考并清理；loader 只校验来源SHA、ledger及实时fingerprint，不由web host推导自己的可信基准。参考构造本身不代表产品验收。

## API 与界面

`GET /api/zhiban/learner/:tenant/offerings/:offering`：

- `mode=TEACHER&view=ROSTER&q=&cursor=`：当前本班名册，每页20条。
- `mode=TEACHER|STUDENT&view=OVERVIEW|EVIDENCE|NOTES|DISPUTES`：教师需选 `enrollment=`，学生由当前本人关系导出，拒绝自选 enrollment。
- EVIDENCE 支持 `kind=ALL|GRADE|CONCEPT|REMEDIATION&q=&cursor=`；NOTES 支持状态／标题；DISPUTES 支持 OPEN／RESOLVED；均每页20条。
- `view=NOTE|DISPUTE&id=&cursor=`：仅该记录允许的本人／当前教师可见，固定证据、当前对照和每页20条历史。

同地址 POST 接闭合命令、可信 Origin、CSRF 和 command key；32KiB请求边界。游标 HMAC 绑定实际 actor／tenant／offering／view／Enrollment／id／查询／筛选，不能跨用；实时列表不承诺跨页冻结全部来源。页面复用原课程壳、离开保护、纯文本渲染和不确定提交同命令重试。来源选择器支持筛选／翻页，保留已选择引用；旧引用不会在编辑器自动替换为新来源。

## 本地验收与证据边界

本包只做受影响课程页面及新增授权／数据／并发负向检查：`pnpm verify:zhiban:learner`。复用原生构建，不重跑无关扫描、导出、完整课堂或 GitHub CI；不调用模型。验收以 [LOCAL receipt](evidence/zhiban-learner-local.json) 与 [本包旅程](evidence/learner/journey.json) 为准。最终默认实例、来源核验与备份范围在 closeout 单列。

维度 REVIEW 保持未决。证据型画像首包不包含自动维度计算、跨课程／跨租户画像、排名、自动概念诊断、心理／健康判断、录取／处分决定、认证掌握或自动改分。历史风险、概念和补救证据仍只覆盖各自来源与当时范围。


## 2026-10-22 最终本地交付

最终[定向PG16／页面旅程](evidence/learner/directed.log)、[单元边界检查](evidence/learner/unit.log)、[受影响依赖闭包TypeScript](evidence/learner/typecheck.log)与[受影响文件ESLint](evidence/learner/lint.log)通过。[类型检查范围](evidence/learner/tsconfig-scoped.json)包含新领域／API／PG、Academic接线、loader／builder及定向脚本；本轮没有执行全仓类型检查，也不借用旧全仓结果。本包不以构造参考或测试数量代替产品交付。

[旅程结果](evidence/learner/journey.json)覆盖三类来源、教师草稿隔离、私有说明／原答案／自报排除、固定引用与来源变更、同key去重／异载荷冲突、学生本人隔离、教师公开发布、本人提出／追加、保留说明／修订／撤回及先行撤回后确认结束。多来源草稿在正式成绩更正后不能继续使用旧引用发布。学生补充与教师处理同请求revision竞争只允许一方成功；观察事件失败不留下公开header，请求审计失败会连同新观察revision／引用一起回滚。接收者角色撤销、退班后成功发布回执重放、任教撤销、RLS与不可变ACL均已定向检查。深链接切换接课程离开保护，并可正确加载新请求详情。

默认3461已在内置浏览器用两角色走通：教师发布引用40分正式记录的观察；学生提出本人纠错；教师通过**原Assessment更正命令**将40分正式更正为80分（这一步不是画像命令改分）；旧画像引用显示变化；教师在页面移除旧引用、选用80分新publication，采纳请求并原子发布观察revision3／请求revision2；学生回看处理结果。原观察version2、40分固定引用、原请求和原成绩publication均保留。[默认浏览器旅程与受限HTTP回读](evidence/learner/default-browser-journey.json)、[教师新旧依据截图](evidence/learner/default-teacher.png)、[本人回看截图](evidence/learner/default-student.png)。维度仍为REVIEW，没有模型请求、自动能力分、自动掌握结论或自动提醒。

[最终验证来源](evidence/learner/source-check.json)、[当前默认来源](evidence/learner/default-source-check.json)及[既有SQL来源](evidence/learner/frozen-source-check.json)零漂移。仅新增独立learner迁移，保留既有dirty候选及冻结语义。已在停止旧试用前取得并核验[切换前三库归档](evidence/learner/before-backup.json)，也已取得并核验[当前三库归档](evidence/learner/default-backup.json)；仅校验SHA和归档目录，**未做恢复演练**。当前默认是新合成课堂，不声称恢复旧数据；停止仍会清理其owned临时cluster，归档不会自动恢复。

默认入口继续为`https://127.0.0.1:3461/zhiban`，从教师／学生课程“学习证据画像”进入。运行状态以`pnpm trial:zhiban:info`为准。[候选来源差额](evidence/learner/candidate-sources.json)不替代包含既有dirty内容的Git差异；[本包签收范围](evidence/learner/closeout.json)不扩大为全仓或生产签收。未提交、推送或触发CI，未访问真实55432／55433。下一完整功能沿原P6推进AI Tutor课程接入：先核对原生课堂聊天／Agent覆盖，再补课程授权和教学治理差额；PBL／EMA／AI Peer和画像维度继续保持各自REVIEW。建议GPT-6.1 Sol / high，处理跨Identity与原生AI边界。
