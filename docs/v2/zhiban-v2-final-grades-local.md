# P3 教学班总评、权重与成绩申诉（LOCAL）

2026-10-23，用户确认采用：正式活动权重合计100%；当前活动发布版本、最新Attempt／最新提交的已发布成绩；缺分待齐、不零填、不归一；教师显式发布总评快照，后续变更仅提示需重算；学生对本人已发布总评申诉，教师须说明，实际改分仍走原单项更正后重发总评。

## 实际产品范围

复用原成绩页、Academic有效任教／Enrollment、Identity会话／CSRF、单项评分发布与更正，新增独立finalgrade域；不改变冻结Assessment的单项成绩合同，也不把单项未加权平均改称总评。页面在现有教师／学生课程“学习成绩”下接“课程总评与成绩申诉”，全局旧成绩入口继续通向同一课程页。

教师选择最多20项当前正式发布活动，逐项配置正权重，合计100.00%；按教学班保存草稿，按revision CAS显式发布权重版本。活动版本固定，练习模式不允许发布为总评依据。界面给版本重绑操作；当前100项可选活动上限超出时拒绝，不截断冒充完整选项。学生和管理员管理身份都不能配置或发布总评。草稿保存冲突保留本地输入及旧revision，必须显式刷新核对，不能自动换revision覆盖其他教师修改。学生只收到已发布权重及本人总评快照，不收到教师草稿或尚未发布的总评预览。

教师按在班名册20人分页选择学生，预览正式依据、待齐原因和计算结果，再填写说明显式发布。来源含本次有效Enrollment窗口；每项按当前固定活动版本，取此窗口最新Attempt、其最新Submission、其最新不可变成绩Publication。PRACTICE、未发布评分草稿、旧选课窗口、旧版本或旧提交不补分。缺任一项则待齐，不写总评。各项先除以自己的满分后按权重计算；BigInt精确有理数累加，最后一次四舍五入至0.01/100，避免中间舍入误差。

总评保存权重版本、活动标题／版本／权重、Attempt／Submission／成绩Publication引用、分数／满分、Enrollment窗口、来源digest、发布人／时间和说明。已发布总评不可变；重交、新Attempt、活动换版、正式更正、新权重或选课窗口变化，使当前来源digest不一致，只标“需重算”。原总评及其权重明细保留。总评历史20条分页，重发需要当前来源digest和上一版总评ID；同来源不能反复另发新版本。

学生对自己任一历史发布版本填写申诉理由，一版只允许一件；当前有效选课仍由原访问合同复核。教师按教学班查看申诉（20条分页），可“说明处理并结案”，或在实际重新发布同一学生总评后“关联已重发总评并结案”。后者必须关联当前且来源未过期的较新总评，不能用旧版／其他学生／未发布预览替代。申诉提交或结案不会直接修改单项成绩或总评分数；更正通过原CORRECT_GRADE执行。处理说明和替代总评引用独立不可变，结案用revision CAS；重复处理拒绝。新总评版本可另提申诉，原件不会自动撤销或结案。

## 数据、来源和授权边界

新增 `zhiban_finalgrade` 及全新未在旧实例应用的 `0001_finalgrade.sql`：configs、rules、publications、appeals、responses、schema_migrations。只在本轮owned disposable重建环境安装；未改任何已应用migration，未向55432／55433或生产安装。新表FORCE tenant RLS；受限Academic runtime只获SELECT／INSERT及configs草稿／revision／当前版本、appeals状态／revision的列UPDATE，不获权重历史、总评快照或申诉回复的UPDATE／DELETE／TRUNCATE。回复的替代总评有同一成员复合外键约束。

`build-finalgrade-reference.ts`在独立新建PG16 socket cluster构建预期目录／ACL及依赖源hash；结束移除自己的cluster。`finalgrade.ts`在只读事务核对LOCAL来源、migration hash、精确ledger和live catalog/ACL；网页不自行安装或从待验实例签发可信profile。默认unified3461在其fresh installer中显式装新域，通过loader后才把FinalGradeService交给原Assessment HTTP。未安装的旧专项host不被冒充具有此能力。

API复用 `/api/zhiban/assessment/:tenant/offerings/:offering/finalgrades`，原登录、Origin、CSRF、JSON、请求上限和错误处理。GET的member／view／after均服务端验证；学生固定本人，教师不能借member参数扩大到其他教学班。发布／申诉处理走原runForRelated取得参与者Identity锁，再复用有效学生角色／状态核对和过期时间检查；正式发布另验证当前Enrollment，禁止客户端携分数、身份或评语来源替代正式事实。租户管理权不等于任教权。

总评／权重／申诉写入先取得已有教学班progress事务屏障，再做原业务访问和行／命令锁；与单项提交、评分、更正、活动换版、目录规则及课堂同序协调。读取预览也取同一屏障。发布以来源digest＋上一版ID比较，两个独立会话对同一预览的发布请求只会成功一个；评分更正在前时拒绝旧来源发布。命令key／payload／actor受原Academic持久receipt保护，丢ACK可重试同一命令。审计记录稳定引用，不拷贝学生答案和申诉正文至管理员泛操作历史。原Identity／撤权／Enrollment屏障不绕过。

## 本地验收及适用范围

定向脚本：`node scripts/zhiban-local/verify-final-grades.cjs`。只用真实三角色会话、trusted HTTPS3461、owned PG16 socket56517及原业务命令；管理连接用于只读查证、确定性锁队列及事务回滚的ACL/RLS拒绝检查，不注入评分成功事实。真实旅程覆盖60/40权重→80/100与10/20形成68总评→本人申诉→原单项更正→重发80总评→教师关联结案→学生读回。覆盖缺分、草稿、伪造身份、重复申诉／处理、来源变更、重交、换版、练习排除、撤销任教、退课再入班窗口、草稿并发覆盖及不可变表ACL等受影响边界。

三库原试用数据在私有目录备份并核验归档目录，未做restore演练。新实例为合成试用数据，验证作答与审计留作LOCAL历史；负向检查后经原作答／评分／发布恢复当前窗口的80分演示总评；不把它们当生产成绩或运营审批。结果与source hash仅认 `evidence/final-grades/final-closeout.json`；construction reference不单独等于产品验收。历史P7归档保留其原source范围。

既有成绩簿CSV仍导出单项成绩，不含总评或申诉；本轮未扩张导出权限。

本包是教学班加权总评首包，不含跨教学班课程最终学分、成绩单认证、等级／曲线／舍分／免修／缺考零填、自动通过／证书、教务仲裁／二审、附件申诉或自动提醒；这些未批准规则不猜测。无真实模型、解析／扫描调用、全课堂回归、GitHub CI、提交、推送或生产部署。高并发容量另验，不以当前正确性旅程承诺吞吐。

最终结果：真实浏览器／PG16旅程已通过，包含权重草稿冲突、发布并发、原成绩更正、本人申诉结案、不可变ACL／租户RLS、任教撤销恢复和Enrollment窗口重置；负向后以原命令恢复当前可查看的80分演示总评。规则及原单项评分定向单测、build类型、限定ESLint、格式和JS语法通过。精确source／证据hash与当前3461匹配状态见[最终记录](evidence/final-grades/final-closeout.json)。下一里程碑为原P7合并学习进度与本包更新交接，仅做交接相关核对，条件性P4／解析／运营门禁保持。
