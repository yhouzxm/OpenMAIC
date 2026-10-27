# 完整课堂与可信结果（LOCAL）

2026-10-26，沿原 P4／P6 完成普通课程宿主的课堂成果闭环。复用已交付的原生课堂、Quiz、Instructor／Simulator／Evaluator、白板、课程 Tutor、原 Learning／评分及进度规则。新页面为 `/zhiban/course-results?tenant=<空间>&offering=<教学班>`；师生课程侧栏「课堂成果与共享结果」直达，原生课堂也可返回该入口。

## 一次可见产品闭环

教师创建并发布原文字活动，启用固定发布版本的原生课堂（PBL 另须启用自主模式），选择活动版本与固定 Quiz／PBL／反思场景，发布成果要求。学生从成果页开始／恢复原 Attempt，进入原生场景，核验来源、练习结果和本人反思，明确确认后正式提交；教师从原待评分入口发布／更正成绩，学生在本页和原学习中心回看。完成判定仍使用教师已发布的 SUBMITTED 或 PUBLISHED_GRADE 阈值规则；本页只读取原 progressSnapshot，不另造完成算法。

- Quiz：固定题目、服务端重算原生客观题得分，简答留给教师；浏览器传入分数和“完成”标志不被采信为正式成绩。
- PBL：本次 Attempt 开始后须有新的、服务端产生的项目完成终态事件；固定项目报告、提交和三类评价的来源摘要。练习 AI 评价不自动变成正式分数，小组共同提交继续走原 PBL 产品。
- 反思：明确标为学习者陈述与固定课件来源，不冒充可信执行事件。
- 实验：聚合既有正式报告、DC／RC 服务端计算及原成绩，保留 SERVER_CALCULATED_SIMULATION 与 LEARNER_REPORTED 区分；不称仪器实测。
- 教师共享结果：显式发布固定课件小结及可选本人白板纯文字，支持撤回。私人对话、自测、学生自主 PBL 状态不全班公开；不是同步全班 AI 内部状态。
- Tutor：继续复用原生 Pi Agent。工具仅可读取／检索当前授权的固定课件和教师已共享小结；不含测验答案键。支持模型具备 vision 时读取最多两张当前发布的 PNG／JPEG／WebP（单张 ≤1 MiB）；不开放任意 URL、文件、成绩写入或跨课程工具。每轮最多三个工具执行／四次提供者传输，保留取消和逐次来源核验。

## 数据、授权与并发

新增私有 Native 宿主迁移 `zhiban-course-results` v1，五张表保存任务、Attempt 锚点、不可变凭据、教师共享和事件；PUBLIC ACL 关闭，四个不可变触发器及拥有者／函数来源在启动核验。未修改已应用业务 migrations、冻结 Identity／Bridge 合同或旧 Native root。

HTTP `/api/zhiban/course-results/:tenant/offerings/:offering` 使用当前真实会话、空间、任教／Enrollment；管理员不能绕过课程身份读取学生私人成果。写入须原 Origin／CSRF，命令为闭合 schema，服务端推导 owner。新任务只约束之后开始的 Attempt；原有作答不被追溯锁死。同一活动发布版本的来源不可替换，须发布新活动版本后另设来源。

服务端固定 publication、sourceDigest、场景、活动版本、Enrollment、Attempt、开始时 Native 基线和 task revision。核验要求当前资格、来源仍可用和原截止／重交条件。任务 CAS／幂等审计、PBL 状态读锁与原活动锁共同约束短写；原 Learning SUBMIT 入口也执行来源屏障，不能换回普通 API 跳过新任务要求。可信 proof 只在服务端 AsyncLocalStorage 范围注入，Native SHARE 锁保留至原业务提交结束。正式提交及 provenance 在原 Learning 事务内原子提交；原事件失败时都回滚。已生成的私有凭据可在正式提交失败后保留，但教师不可读取或据其计成绩／完成。来源撤回阻止新采集，已正式提交的历史仍保留。

界面限额：100 个任务／50 个来源、本人最近 50 个草稿、25 条正式提交游标分页、最近 25 条实验报告及 20 条共享结果；完整凭据 ≤128 KiB，原正式答案中的摘要与凭据引用 ≤19,000 字符。原始凭据不可修改；正式评分沿原发布／更正与申诉流程。

## LOCAL 验证与证据范围

- 独立 PG16／真实 Identity／受信 HTTPS：原生 Quiz 浏览器作答 → 核验 → 原正式提交／重交 → 原人工评分发布；含跨空间／管理员／旁人拒绝、直接提交绕过拒绝、旧 Attempt 保留、私有凭据隔离、幂等、任务CAS单赢家／同命令提交并发去重、事件故障原子回滚、来源撤回历史、凭据不可变、当前 Enrollment／任教撤销。见 `evidence/zhiban-course-results-local.json` 和独立 harness receipt。该旅程没有外部模型调用。
- 默认 3461 真实 GLM：自主 PBL 的 task／milestone／final 三次评价、服务端终态、固定凭据、原正式提交、教师 92/100；新增可选演示单元使用原 90% 已发布成绩规则，已验证 complete=true，不改原必修要求。Tutor 实际一次资料工具执行、两次提供者传输成功；见 `evidence/zhiban-course-results-real-local.json`。
- 最终定向 PG 旅程已包含任务 CAS 与同命令提交并发，覆盖当前完成状态只读展示、中文状态／折叠预览版本；`__proto__` 题目 ID 按普通数据处理另有单元覆盖。默认重启后只读核对及最终截图见 `evidence/zhiban-course-results-closeout.json`。没有扩大到无关全套回归。
- 验证脚本初轮的 HTTP 201 判断及旧评分字段错误已修正；真实模型旅程最后误读 Tutor 的 `turns` 字段，经持久记录的 `rows` 只读查证确认成功，没有重复付费调用。

## 集中保留边界

旧冻结 Native CREATE／APPEND／COMPLETE 和 UNKNOWN／RESERVED 维护处置仍隔离，真实仪器测量及相应可信输入未齐；本包不启用旧 root，也不把 iframe、翻页、语音或聊天当作正式完成。当前 GLM tools=true、vision=false；图片理解实际调用仍待相应模型。Office／OCR／音视频解析、图像／视频生成、TTS／ASR 仍因外部服务未配置待验。私人进度不会直接写画像／证书或正式分数；本包正式提交与原成绩可按既有批准规则供下游读取。

默认主机配置 `lock: all`、`allowUserKeys: false` 及原账号保持；仅 owned PG16 私有 socket 数据升级，未接触真实 55432／55433、生产数据、提交／推送或 CI。历史远端 run 40096542805 PASS 保留原冻结包适用范围。

下一整包为原 P7 **统一持久化交付**，一次纳入原生备课、课堂、自主 PBL、归档、多模态、服务中心及本包。普通交接建议 GPT-6.1 Sol / medium；新的跨主机／Identity 授权与恢复并发工作再用 high。
