# P5 六维证据画像与 EMA 教师审阅

本包沿原 P5／P6，直接复用 Learner 的公开证据白名单、来源守锁、学习观察草稿／发布／修订／撤回、本人纠错和接收者 Identity 守卫。新增独立 `zhiban_ema/0001_ema.sql`，不改既有已应用 migration 或冻结 Bridge 合同。当前为 LOCAL 合成教学环境，最终结果以 `evidence/ema/closeout.json` 与本包 journey 的来源为准。

## 师生流程

课程“六维证据与 EMA”提供知识理解、技能应用、问题解决、自主调节、沟通协作、反思迁移的明确定义。教师选择当前 Enrollment，为某维登记具体观察并引用1–5条白名单公开来源；保存为原 Learner 草稿，审核后显式发布。六维分类不可静默改写；若分类错误，撤回旧观察并新建正确分类，保留学生纠错和历史。

学生只能看本人原 Enrollment 已发布或已撤回的观察。每条展示文字、教师充分程度声明、来源是否仍一致，并可进入原观察页核对固定来源、公开历史与本人纠错。学生纠错的教师处理会直接反映在六维页面，不新建一套成绩或申诉体系。

六维不产生能力分、掌握概率、排名、认证或心理健康推断。同一成绩不换算成六个分数；没有观察或证据不足不表示能力不足。当前证据采用现有 GRADE／CONCEPT／REMEDIATION 白名单，排除未提交答案、答案键、评分草稿、教师私有风险／跟进／概念备注、Tutor／Peer 私聊和学生自报结论。PBL 小组评价不自动归为个人协作能力，本包没有把它偷偷并入个人画像。

## EMA 范围与作业

EMA 是固定证据的模型分析作业，不是情绪问卷。教师选定 Enrollment、1–5条来源、明确目的及可选预约时间（最多30天），生成不可变的来源快照／digest和 `ema-six-v1` 提示词版本。预约到期后由当前任教教师显式运行；不保存教师会话凭据，不以离线定时器代行 Identity 授权。无人值守的受限 ServiceActor 调度不在本包启用范围。

运行复用 OpenMAIC 的 `resolveModel` 和 `callLLM`，没有新建模型代理或读取私聊。最多2个当前主机作业、单次90秒超时、关闭模型自动重试及备用模型切换；未由部署明确配置推理时，本任务默认低推理强度，输出上限6144 token，每维要求简洁说明；每次只发送选定公开快照及目的。模型输出必须恰好包含六维，闭合字段只有维度、INSUFFICIENT／LIMITED、说明和已选证据位置；未知字段、分数、缺维／重复维、越界或无引用的有效建议均拒绝。失败不会生成合成报告。

实际模型结果还固定 provider／model、提示词SHA256、推理配置及输出上限，避免不同提示或模型结果混同。模型结果仅教师可见。教师逐维采用／拒绝并填写理由；INSUFFICIENT 不能直接采用。采用只生成原 Learner 的维度观察草稿；教师可修改文字并明确选择证据充分程度，但引用只能来自该建议实际引用的固定来源。正式发布仍走原流程，包含接收者当前身份／STUDENT 授权和来源最终检查。学生不会看到私有分析、被拒绝建议或拒绝理由。

## 状态、授权与并发

| 操作 | 事务边界 |
| --- | --- |
| QUEUE | 当前任教授权、有效原 Enrollment、来源锁与精确digest；保存固定快照及命令回执 |
| RUN | 到期、QUEUED、预期revision及当前来源；提交RUNNING＋内部lease后释放数据库锁再调用模型 |
| FINISH | 只接受进程内部结果；重新通过真实教师会话／任教授权、原来源核验、RUNNING＋lease及120秒写回时限；来源变化存STALE，失败存FAILED |
| ADOPT | 当前任教、有效原Enrollment、READY＋revision、该维未审阅、固定来源仍一致；分类、原Learner草稿、两组回执与审计同事务提交 |
| REJECT | 当前任教、原范围、READY＋revision及该维未审阅；不可变决定与公开草稿分开 |
| CANCEL／EXPIRE | 当前任教、原范围；取消QUEUED／RUNNING或关闭超过120秒的RUNNING；清除lease，迟到结果不能覆盖 |

教师可读取已退班学生的固定作业并取消、拒绝或关闭过期作业；退班后不能继续运行或采用。学生仍须原课程访问。撤权期间模型结果不会借旧教师凭据写回；若无法以当前授权记录终态，保留明确RUNNING供当前有权教师关闭，不伪造成功或悄悄续跑。

每个命令绑定tenant／offering／真实actor／规范化payload。同key重试不重跑模型或重复采用；新key并发采用由job行锁、revision和每作业每维唯一审阅屏障保证只写一次。采用记录、分类、命令与事件不可UPDATE／DELETE；作业只授予状态／lease／结果等限定列UPDATE，范围、来源、目的、创建者不能改。所有业务表FORCE tenant RLS，PUBLIC无权限。loader对照独立新建PG16参考的migration hash、ledger、catalog及ACL，web host不自推导可信expected profile。

后续更正成绩、变更来源或退班时，既有观察仍保留原固定快照并显示差异；旧EMA结果不能继续采用。教师须重新选当前证据建作业；画像修订、撤回与本人纠错沿原Learner留痕。模型结果不改成绩、总评、学分或证书，不触发自动干预。

## 验证与交付

定向命令 `pnpm verify:zhiban:ema` 使用新建owned PG16、受限角色、真实Identity和3468 HTTPS，不访问真实55432／55433。真实模型journey与 `CONTROLLED_FAULT_ONLY` 取消、失败、迟到结果及撤权切点分列，受控provider结果不充当真实AI成功。只有受影响页面与新增授权／并发检查，无全课堂或GitHub CI。

默认持久3461通过受控停止／备份、`start-persistent.ts --upgrade-local` 安装新schema并重绑来源；保留已有账户、教务、学习、评分、课堂编排及PBL记录。账户仍在原owner-only accounts文件；密码不写进本报告。

实际LOCAL结果、默认入口、既有记录保持及备份位置记录在本包closeout。P7归档仍保留原来源范围，本包不重复打包。

下一完整包沿原 P3：校内课程证书、受控跨班学分，以及受限服务身份的自动正式AI评分；后者不能借用本包教师会话或把人工采用建议改名。建议 GPT-6.1 Sol / high。真实Native Runtime、Office／OCR／音视频服务与跨主机运营输入继续集中保留，不阻塞这些无依赖教学功能。

默认入口首轮遇到真实GLM推理耗尽输出预算。只读合成输入诊断记录 `finishReason=length`、5000 output token中4996 reasoning token、正文长度0；这次FAILED保留，没有生成或发布观察。收敛本任务默认推理与输出、关闭隐式fallback后，最终默认页面旅程与来源范围分别见本包closeout和 `accepted-source.json`。该诊断不充当产品结果。
