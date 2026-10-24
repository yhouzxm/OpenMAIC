# 课程学习与测验：集中精确设计

状态：IMPLEMENTED_LOCAL_CANDIDATE（2026-10-18），[实现与本地证据](zhiban-v2-course-learning-quiz-local.md)。以下“本轮”及未应用状态保留2026-10-17设计时点；本次用户授权后已实现并仅在 owned disposable 环境应用 successor migration，未启用原生 Runtime。

设计基线：DESIGN_CANDIDATE，2026-10-17。属于原 P2＋P3 的一个完整产品包；本文件没有启用能力、应用 migration 或签发运行 receipt。业务规则以下述首版建议为准，实施时不得把建议状态写成冻结合同已变更。

## 1. 基线与交付目标

工作分支 `refactor/zhiban-v2`，HEAD `daf63afa83470d24a9ed41d171c6a17f8a80adb6`；工作树已有大量未提交候选，非 CLEAN，不能仅用 HEAD 复现。官方 1.2.0 来源固定 `a9da60b3b4adb429369c0da13d5637a904ead2b0`，本地升级结果见 [升级记录](zhiban-v2-openmaic-120-upgrade.md) 与 [LOCAL closeout](evidence/zhiban-openmaic-120-closeout-local.json)。本次以当前本地实际源码核对，没有把官网介绍当已集成能力。

一次交付：教师在原课程工作区编排讲义和测验、编辑并发布 → 学生从原学习中心学习、保存答案并提交 → 服务端计算客观题结果 → 教师确认客观结果、评阅简答、发布成绩 → 学生回看本人提交及已发布成绩。保持默认 3461 入口，不为每个页面另开产品端口。

保留已有文本／PNG、文字作业、教务／Enrollment、人工成绩／更正、成绩簿／CSV、扫描附件、基础课堂和统计。自由学习，不新增强制先修、阅读完成率、课程总评。首版测验题型为新版已有 single／multiple／short_answer；不恢复旧题库引擎，不新增填空、随机组卷、监考、题目级限时或排行榜。

## 2. 已核对的复用面与真实缺口

路径相对仓库根；“待抽取”不是当前已存在的 SDK export。

| 实际源码／合同 | 事实 | 决定 |
| --- | --- | --- |
| `packages/@openmaic/dsl/src/stage.ts` | QuizQuestion 含题干、选项、answer、analysis、commentPrompt、points；三种题型。包版本 0.11.3，序列化 DSL_VERSION 为 0.3.0 | 复用题型与编解码；业务 Domain 不依赖 DSL 类型。学生不能收到完整 QuizQuestion |
| `packages/@openmaic/renderer/src/index.ts`、package.json | 公开 SlideCanvas、媒体／效果等；未导出 QuizView 或完整 Stage host | 已有讲义继续直接复用；不能宣称全课堂已可直接包接入 |
| `packages/@openmaic/editor/package.json` | 当前导出 core／react／ui，定位 slide editor | 保留现有 slide 编辑；不能把原生 QuizForm 当现有公开 editor export |
| `components/edit/surfaces/quiz/{QuizForm,QuestionCard,quiz-edit-ops,use-quiz-surface}.tsx/ts` | 新版已有题型表单、排序和撤销；use-quiz-surface 依赖私有 Stage/Zustand；选项重排会重新生成字母值并同步答案 | 抽取原实现为可注入的受控表单，保留新版 UI／操作，不复制旧表单。发布版本固定选项值，运行中不重排 |
| `components/scene-renderers/quiz-view.tsx` | 已有封面、答题、提交、回看、多选／公式；直接使用原生 runtime 和 `/api/quiz-grade`，浏览器先判选择题 | 复用可呈现部分，替换原生业务编排为 host 注入。正式模式禁用客户端判分入口和内置 retry |
| `lib/quiz/grading.ts` | 单／多选全匹配；存量 key 可精确匹配唯一 option value 或 label；无部分分 | 将纯算法抽取为受支持服务端 export，固定语义和版本；新发布只允许规范 value，不对学生答案做 label 别名转换 |
| `lib/quiz/runtime.ts`、`components/stage/scene-renderer.tsx` | 原生持久化、重试和多场景分发依赖原生 learner/store／课堂状态 | 不直接引用、不搬进 Domain、不启用原生 Runtime；由现有业务 Attempt 管理课程作答 |
| `app/api/quiz-grade/route.ts` | 接收请求提供的题目／满分／评分提示，LLM 评分，解析失败有半分回退 | 不代理为正式判分；首版不调用。简答人工评分；AI 建议另属 P6，失败不得生成正式分数 |
| `app/zhiban/local/learning-center-client.tsx` | 原课程目录、单元前后导航、正式 SlideCanvas、原文字活动入口已接 | 在此增加测验呈现，不重建学习中心或替换现有有效入口 |
| `lib/zhiban/domain/{learning,assessment,curriculum}/model.ts` 及对应 PG transaction | 已有版本／次数／截止／重交／Submission、成绩发布、更正、章节引用 | 扩展类型与结构化答案差额；沿用同一业务身份、计次和成绩实体 |

完整 Stage、Interactive、PBL、Tutor／Agent、生成模型、媒体自动播放及 HTML 运行不在本包启用范围；不因拥有源码取消 U01/U02／Bridge 等相应 gate。

本包使用公开纯 UI 和智伴业务 PG，不向原生 runtime 写记录，不扩展已启用的文本／PNG Native profile 去接受 Quiz。首版教师测验草稿／快照直接存业务侧表；引用原生来源仅为可选的将来受控导入，未有对应能力授权前不可调用。新增包 export、版本和 hash 的证明与既有 Native receipt 分开，不能凭“只是 UI”越过 profile 或启用组合检查。

## 3. 唯一宿主方案：复用新版，公开受控呈现合同

遵守 [ADR-014](adr/ADR-014-openmaic-package-host-strategy.md) 和 [public surface](phase1/zhiban-openmaic-public-surface.md)。采用一个必要的 SDK 扩展候选：从原实现抽取纯呈现和纯编辑／判分逻辑，放入正式 package exports；原生页面也转用同一实现，避免长期维护两套代码。这是待实施的受支持接口扩展，不是给智伴开放 import 私有模块的例外。本轮不改六包，不改旧 ADR 的接受状态。

拟新增正式入口：`@openmaic/renderer/quiz`（受控 QuizSurface）、`@openmaic/editor/quiz`（受控 QuizAuthoringSurface／纯编辑操作）、`@openmaic/dsl/quiz`（规范化、校验、纯选择题判分）。具体包构建必须同时生成声明和 dist；实现前列出 upstream delta，新增局部包版本及 export，不冒称这些是官方 1.2.0 原样导出；当前官方版本／hash 和历史 receipt 保持原范围。

| 接口 | 输入／输出 | 约束 |
| --- | --- | --- |
| QuizSurface | `questions: PublicQuestion[]`、`answers`、`phase`、`readOnly`、`busy`、`onChange`、`onSave`、`onSubmit`、`onStartNewAttempt`、可选 `review` | 受控组件；不收 StageId／learnerKey／provider／Session；没有 fetch、原生 store、自动判分或持久化。review 缺省不显示正确答案／解析 |
| QuizAuthoringSurface | 完整教师草稿、onChange、验证错误、只读状态 | 保留新版布局／撤销／排序；状态按编辑实例隔离，不用全局 Stage store。宿主单独负责保存／发布按钮及 revision |
| normalize／validate | DSL QuizContent →规范内容或逐题错误 | 只处理数据，不访问数据库或授权；严格发布规则由 Application 增补 |
| gradeChoices | 规范题目＋key＋结构化提交 →逐题客观结果 | 服务端 adapter 消费；无网络／模型调用。浏览器可以拥有算法代码，但拿不到正式 key |

正式模式 PublicQuestion 仅 allowlist：id、type、question、options(value,label)、points。显式排除 answer／analysis／commentPrompt／hasAnswer 及未知字段；不以 object spread 后 delete 生成投影。结果 DTO 也用 allowlist。练习同样先发无 key 投影，提交后才返回准许的反馈；不需要开放原生 runtime 来实现练习。

原生全课堂 host 仍 deferred；本包只抽取测验所需界面，沿用既有课程／单元导航和 SlideCanvas，不另造 Stage 播放引擎。若抽取依赖闭包仍含原生 store／HTTP 或无法产出独立 dist，不能回退到私有 import；应在本产品包内先完成解耦再接入。

## 4. 首版业务规则（实施默认建议）

| 项目 | 规则 |
| --- | --- |
| 模式 | PRACTICE／ASSESSED 创建时确定，后续版本不可互换；换模式需新活动。练习产生本人练习记录，不创建 Grade／成绩簿项；正式测验产生提交及客观判分结果，经教师确认后发布成绩 |
| 题数／文本边界 | 1–100 题；题目 id 在版本内唯一；选择题 2–26 个选项，value 唯一且非空，label 非空；题干≤2000字，解析／评分提示各≤2000字；简答≤4000字。草稿允许未完成，发布必须全部合法 |
| 分值 | 每题明确正数、最多两位小数，转为整数百分位；总分≤1000分，与现 Assessment 上限一致。旧内容缺省 points=1 在发布时显式固化。禁止 NaN／Infinity、负值、隐式四舍五入 |
| key | 单选恰好一个有效 value，多选至少一个且无重复、均存在于选项；规范新发布不接受 label key。导入旧 key 可用新版唯一精确解析预填，但歧义／缺 key 必须由教师修正后才能发布 |
| 提交值 | 单选 value 或未答；多选不重复 value 集合，按固定序规范化；简答原文本。未知题／选项／重复 questionId 拒绝；缺题按未答，不靠题目顺序匹配。不接受客户端 score、correct、key、points 或身份字段 |
| 计分 | 单选／多选与 key 集合完全相同得全分，其余包括未答得0；不对学生答案做大小写／label／模糊匹配，无多选部分分。简答没有自动分数，状态 PENDING_MANUAL；未答简答标为未答，教师仍明确确认分数 |
| 截止／次数／重交 | 沿用 EXCLUSIVE_SERVER_TIME；服务端 now≥deadline 拒绝写。次数跨活动版本累计；恢复同一 Attempt 和同 Attempt 重交不增次数；另开 Attempt 才加1；仅最新 Attempt 可写。规则绑定启动时版本，编辑新版本不追改旧 Attempt |
| 活动状态 | DRAFT→PUBLISHED→WITHDRAWN；编辑已发布活动形成待发布草稿，历史发布不可变。撤回即停止新开／草稿／提交，历史记录按既有权限保留；重新发布不能修改旧提交绑定版本 |
| 正式反馈 | 提交先显示收据和“待教师发布”；学生不能看客观分项、总分草稿、key 或解析。教师发布 Grade 后可看正式分数／评语；自动逐题正确答案仍等待封卷 |
| 封卷 | 新增 Quiz 专用 CLOSE_QUIZ_REVIEW，教师明确确认后不可逆；同活动所有版本停止新开／写答案／重交／再发布，保留评分、更正及历史读取。不能只以当前版本截止时间推断封卷。需再次使用时复制为新活动 |
| 答案释放 | PRACTICE 本人成功提交后即时反馈；ASSESSED 必须已封卷且该精确 Submission 有已发布成绩，才给本人正确答案／解析及已发布分项。成绩可先于封卷发布，但不会自动泄露 key；教师手写评语属于显式教师内容 |
| 课程完成 | 阅读、练习、提交及得分均不自动声明课程完成／获得学分；不引入总评、取最好／最近成绩或及格线 |

这些是集中首版规则，不是已实现能力。既有 TEXT_RESPONSE 的状态、原命令及冻结权限保持不变；新模式／封卷规则只作用 QUIZ。

## 5. 数据模型：沿用原链，不增加平行成绩系统

业务事实全部落在智伴同一 PG 事务边界。Native 文档只作为作者内容来源，不作为学生正式答案与成绩权威；从 Native 读取、校验后把发布快照存入智伴，再在单个业务事务激活。不能把跨库写入称为原子提交。

以下均为未生成、未应用的后续 migration 设计；实际编号在实施时检查 ledger 后分配，不修改已有 SQL 字节。使用 `zhiban_learning` 的候选侧表，复合 FK 必须包括 tenant 和所属父链，不只检查 UUID 存在。

| 实体／增量 | 关键字段／约束 |
| --- | --- |
| 原 activities | 新 migration 扩展 activity_type 允许 QUIZ；原 TEXT_RESPONSE 字节／解析语义不变。QUIZ 必有一对一 quiz_definitions；旧文字命令不得用于 QUIZ 写入 |
| quiz_definitions | `(tenant_id,activity_id)` PK/FK，immutable mode、完整 draft JSON、draft hash、`review_closed_at/by`。revision 统一用父 activity，不另建竞争 revision。关联相同 offering；封卷字段只允许 NULL→终值 |
| quiz_versions | `(tenant_id,activity_id,version)` PK/FK 到 activity_versions；完整规范题目（含 key，服务端私有）、公共投影、两者 hash、规范化版本、grading algorithm版本、mode、max_points、原生来源 pin／可选 opaque mapping及来源 revision。版本与父快照同事务 append-only |
| quiz_attempt_answers | `(tenant_id,attempt_id)` PK/FK，结构化 draft、hash；更新必须同时 CAS 父 Attempt revision。绑定的 Activity/version 由父链取出，客户端不能重绑 |
| quiz_submission_answers | `(tenant_id,submission_id)` PK/FK，精确 Attempt／发布版本锚点、规范 answers、answers hash、quiz hash。随父 Submission 同事务 append-only |
| quiz_evaluations | `(tenant_id,submission_id)` 唯一；quiz hash／answer hash／算法版本、逐题客观结果、objective_points、manual_pending。SUBMIT 同事务计算和插入，不设学生可调用“改分／重新判分”API |
| quiz_grade_details | 绑定精确 Grade revision 的不可变分项（系统客观分、教师人工分、偏离自动值原因）；发布时复制一份绑定 assessment publication id，不从可变草稿反查历史分项。更正同样 append-only |

沿用现有 attempts、submissions 和 assessment Grade/publications；为兼容原 submissions.answer 非空且≤4000字的约束，QUIZ 的父 answer 写固定服务端摘要“测验提交（结构化答案）”，实际答案仅在侧表。禁止把 JSON 塞入文字 answer，也不扩大旧文字答案限制。所有读取／列表必须带 activity_type，QUIZ 用结构化渲染；缺侧表视为数据错误，不能降级成文字作业。

发布事务写父 activity_version＋quiz_version 并更新 published_version；Attempt 精确绑定该版本，旧发布不回写。目录仍是 LECTURE／ACTIVITY，QUIZ 为 ACTIVITY 的子类型，target 仍指业务 Activity，避免增加一套课程目录实体。目录发布号固定编排；活动新发布只影响新开 Attempt，已有 Attempt 永远用原版本。学习页清楚区分“目录版本”“当前测验版本”“本人作答版本”；版本已变时提示并刷新，不能偷偷换题。

QUIZ 的结构化答案 canonical UTF-8 JSON≤64KiB，完整发布 JSON≤1MiB，HTTP 写请求≤128KiB（作者保存≤2MiB），超限413；按解析后规范字节与题数双限额。拒绝未知字段、畸形 Unicode、重复 JSON 属性及非有限数字，hash 用版本固定的 canonical JSON SHA-256，不能用不稳定对象序列化碰运气。hash 是一致性标记，不代替授权或伪装签名。

ACL/RLS：沿用可信租户上下文、tenant RLS／FORCE RLS；父链 FK；仅所需 SELECT／INSERT、草稿列 UPDATE，不给 runtime DELETE、版本／答案／发布 UPDATE。key 表不经原生 document API 或通用 JSON 路由暴露；只能由教师编辑读和服务端发布／判分适配器选列使用。浏览器没有数据库凭据。安装失败不得签成功 receipt；安装／回滚候选仅在 owned disposable PG16 演练，不能用本设计授权真实数据库迁移。

## 6. API 与命令合同

沿用 `/api/zhiban/learning/:tenant/offerings/:offering`、已有 Session／Origin／CSRF／请求协议和 academic command 幂等账本；以下是新增明确用例，不提供任意 Native 路径代理。Assessment 的新命令接既有 assessment 用例入口。API 具体 parser 新增测试，不能放宽原严格字段校验。

| 请求／命令（候选） | 最小输入 | 服务端结果 |
| --- | --- | --- |
| GET `.../quizzes?activity=:id` | 业务 Activity id | 教师可得草稿及 revision；学生只能得当前发布公共题目／mode／规则／版本，不能得教师草稿 |
| GET `.../quizzes?attempt=:id` | 本人／可评阅 Attempt id | 固定版本题目、本人草稿／状态、revision；教师不读学生未提交草稿 |
| GET `.../quiz-submissions?submission=:id` | 精确 Submission id | 本人已交答案／可公开结果，或任教教师的评分视图；答案释放按第4节；不接受 member 参数代读 |
| CREATE_QUIZ | title、mode、content、deadlineAt、allowResubmit、maxAttempts | 业务 Activity id、revision；服务端创建，不接受 stage／owner／tenant 内嵌字段 |
| EDIT_QUIZ | id、revision、title、content、上述三项规则 | 更新草稿及父 revision；不改变 mode |
| PUBLISH_QUIZ／WITHDRAW_QUIZ／CLOSE_QUIZ_REVIEW | id、revision | 发布精确版本／撤回／不可逆封卷；均有审计与幂等结果 |
| START_QUIZ_ATTEMPT | activityId、expectedVersion | 启动或恢复同一 Attempt、revision、固定版本；旧版本冲突409，不能自动以新版本重试开题 |
| SAVE_QUIZ_DRAFT／SUBMIT_QUIZ | attemptId、revision、answers | 新 revision；SUBMIT 另返回 submissionId／version／收据，练习可得反馈，正式不返回评分草稿 |
| SAVE_QUIZ_GRADE | submissionId、gradeRevision或null、manualMarks、feedback | 服务端载入可信客观结果＋逐题人工分，汇总并保存同一 Assessment Grade；全客观题也须教师确认，学生提交不创建已发布 Grade |
| PUBLISH_GRADE | 原命令不变 | 校验最新 Submission／Grade revision，追加原发布＋分项快照 |
| CORRECT_QUIZ_GRADE | submissionId、revision、逐题分、feedback、reason | 任教教师公开理由、更正原 Grade/publication并追加分项；客观分覆盖需逐题记录偏离原因；不改原 key 或判分证据 |

待评分队列、成绩簿、CSV及统计的正式提交口径须显式排除 PRACTICE，同时保留本人练习历史；不能只靠“不创建 Grade”来避免练习挤入待评分列表。QUIZ 首版不接受 Submission 附件，不调用原文字附件授权入口；原文字扫描附件能力保留。

练习不得调用正式评分命令；普通 SAVE_GRADE／CORRECT_GRADE 对 QUIZ 拒绝，防止跳过分项一致性；TEXT_RESPONSE 原命令继续原样工作。QUIZ 的总分由固定题目总分决定，不接受请求中的 maxScore；manualMarks 仅含所有简答题及合法范围的分数，缺项不能发布。特殊客观改分仅在有原因的更正命令中允许。

写命令 envelope 沿用现有 idempotency key／payload hash：同 key 同 payload 返回原结果，同 key 异 payload 冲突；响应未知保留原 key，不能自动换 key 或创建新 Attempt。服务端重查当前身份与访问资格后返回原结果，幂等不能绕过撤权。GET 游标绑定 actor／tenant／offering／过滤条件，默认20、最大50；提交及成绩历史沿用现有分页，禁止为了测验重回全量列表。

错误：400 格式、401失效登录、403无课程资格、404未找到的已授权范围对象、409 revision／版本／状态／次数／截止冲突、413超限、503依赖不可用；错误码在智伴协议内映射，不含 key／Native id／SQL／凭据。返回的 authoring／learning／review DTO 分开构造，缓存 private,no-store。

## 7. 授权、锁、并发与审计

每个请求由真实 Session 解析 User／Membership／Tenant；教师必须当前任教该 offering，学生必须当前 Enrollment；管理员身份本身不授予任教编辑或代学生答题。offering、course 状态以及可写条件沿用现有用例。所有 UUID 只是选择提示。

移出／转班停止原班新访问与写入；新班不能继承旧班 Attempt、次数或成绩。记录保留给当前获授权教师历史评阅，学生历史回看遵守已有资格规则，本包不增加离班豁免。已交付字节无法远程收回；已打开标签页下一次保存／读取会重新授权。

锁顺序先复用现有 Identity／academic guard 与 offering／course／assignment／Enrollment 的事务屏障，再 activity `FOR UPDATE`、最新 Attempt、Submission、Grade；测验侧表随父锁，不反向加锁。复用现有 START 的活动锁和唯一索引，两个标签页同时开题最多得到同一未交 Attempt或一个明确冲突，不消耗两次。实施时沿现有事务访问顺序核对，不创建另一条绕开 Membership 撤权的连接。

截止时间沿现有实现，在获得父活动锁后用 PG `clock_timestamp()` 读取权威毫秒时间，不用浏览器时间或锁等待前的请求时间。

SUBMIT 在同一业务事务完成：验证当下授权／未封卷／活动可写／版本规则／截止／最新 Attempt及 revision → 规范答案 → 插入父 Submission与侧表 → 确定性客观判分 → 更新 Attempt与事件／命令结果 → commit。任何一步失败全部回滚，不能返回“已提交”后再丢答案。没有跨 Native 分布式事务或后台静默补分。

| 竞争／故障 | 必须结果 |
| --- | --- |
| 自动保存和提交乱序 | 提交带完整当前答案和 revision；宿主先 flush，服务端 CAS；旧保存不能覆盖已提交版本。冲突保留浏览器文字并供对比，不自动覆盖服务器 |
| 两标签同时提交／提交超时 | 同 key 可重放同收据；不同 key 同 revision 至多一个成功，另一冲突。客户端按原 key 查证／重试，不报告未经确认的成功 |
| 发布新版本与已有 Attempt | 已有绑定不变；新开 expectedVersion 冲突刷新确认；不得清空本人原稿 |
| 撤权／退班／撤回／封卷和提交 | 通过共同 guard／父行锁序列化；先提交的事务保留合法历史，撤权／封卷成功后新事务不得写。不得承诺撤权追溯抹掉已完成提交 |
| 重交与教师发布 | 锁同 Attempt／最新 Submission 后发布；旧提交已不是最新则拒绝新发布；重交不继承旧分。已发布旧分仍作为带版本的历史，不显示成新提交成绩 |
| 封卷与编辑／重试 | 同 activity 锁序列化；封卷后所有版本新写／新发布拒绝；成绩发布／更正不受阻。幂等重放不重复封卷 |
| Native 读取／发布中失败 | 发布前私有候选无学生可见性；业务快照提交后可读取已验证快照，Native 后续草稿改动不改旧题；不激活残缺引用 |

审计复用 command／audit 链，增加 QUIZ_CREATED／EDITED／PUBLISHED／WITHDRAWN／REVIEW_CLOSED、ATTEMPT_STARTED、SUBMISSION_RECORDED、QUIZ_GRADE_SAVED／PUBLISHED／CORRECTED 对应用例事实；actor、tenant／offering、目标业务 id、前后 revision、发布号、submission、payload／snapshot hash、算法版本及更正理由。答案和 key 不进入普通日志／审计摘要；它们保存在受控侧表。只记服务端完成事实，不把客户端点击或 runtime.reviewed 当学习完成证据；不新增受限 ServiceActor 写成绩例外。

## 8. 页面和完整角色旅程

教师：原“课程→章节编排”保留添加讲义／文字活动，新增“测验”。编辑区用新版题卡／排序／正确答案／解析／分值；侧栏显示练习／正式模式及截止／重交／次数。保存草稿／预览／发布同页，发布前展示题数、总分、规则与校验。预览明确“教师预览，不记 Attempt／成绩”，使用隔离的本地演示状态，不调用学生 START。发布后可“加入当前章节”并返回原章／单元。

学生：沿用 `/zhiban/student/courses/:offering/learning-center/:unit`（现有路由 course 参数实际承载 offering 上下文），保留课程壳、目录、上一／下一单元。测验入口标注模式、版本、截止、剩余次数、本人状态；“继续作答”恢复原 Attempt，“新一次尝试”明确计次。提交确认显示题数／未答数／版本／是否允许重交；成功后用服务端收据替换待提交状态。

作答区有“已保存／保存中／保存失败”、显式保存和未保存离开保护；SPA 返回、切单元、关闭评分／课程页都复用既有保护。原生刷新／关闭保护仍是待人工实测项，不能拿脚本断言冒充已签收；刷新恢复只承诺最后确认保存的答案。取消离开必须保留内存文字。

教师：原待评分列表加入测验类型／“待简答评分、待发布、已发布”筛选，评阅页同时显示固定题目、学生已交答案、服务端客观分和简答输入；确认后用原 Grade 发布。学生原“我的提交／成绩”按精确 Submission 回看；新提交与旧已发布分分开标明。返回链接只保留 allowlist 的 course／chapter／unit／activity／submission 和分页条件，不接任意 return URL。

管理员：原创建课程／班级、分配教师／Enrollment 流程不变；不新增测验专用后台。不把管理员授权当课程教师授权。课堂结束仅沿用现有会话行为，不自动封卷课程测验；测验封卷必须由任教教师显式操作。

## 9. LOCAL 验收矩阵与退出条件

只跑受影响合同和一次完整角色旅程，不重复 GitHub CI。使用 Node22／pnpm10.28.0、owned disposable PG16、独立数据库／socket端口；不连接真实55432／55433，不改真实数据。LOCAL receipt 固定来源 pin、dirty源码清单/hash、包版本／dist hash、migration校验、ACL、启动组合与清理范围；新包 hash 变化不能沿用旧 receipt 宣称兼容。

| 场景组 | 必须覆盖的结果 |
| --- | --- |
| 公开宿主 | 三个新 export 真正从 dist 消费；无私有 Stage／store／runtime／server import；原生与智伴共用抽取后组件；受控实例互不串状态，SSR／browser build正常 |
| 学生投影 | 草稿／发布／Attempt／Submission／错误／DOM／网络／缓存均不含未准许 key、analysis、commentPrompt 或教师草稿；不能通过 Native URL取完整文档 |
| 题型与算法 | 单选／多选全对、错选、漏选、重复／未知选项、空答；旧label key唯一解析和歧义阻断；分值边界、恶意 Unicode／JSON／超限；简答不发生半分回退 |
| 精确版本 | 发布v1→启动→教师v2→旧Attempt仍v1；新Attempt用v2；目录版本／题目版本／答案hash不混；改 key 必须新版本，不能覆盖旧判分 |
| 状态与权限 | 草稿不可学生读；跨租户／别班／其他学生／无任教拒绝；移出／转班／撤回／关闭班级后保存和新开拒绝；当前教师可按原规则评阅历史提交 |
| 次数／截止／封卷 | 截止恰等拒绝、恢复不计次、重交不计次、新开计次且跨版本；双标签只消费一次；封卷后全部版本禁写、不可再发布，仍可评分和历史读 |
| 并发及故障 | 保存／提交乱序、两个提交、退班／封卷并发、评分／重交并发、响应丢失同key查证、事务中断不留半提交；安装部分失败无成功receipt |
| 成绩与答案释放 | 正式客户端伪造分拒绝；全客观需教师确认；简答未评完禁发布；练习不进成绩簿；重交不继承分；发布前／封卷前不自动给key；封卷后仅本人已发布精确提交可读；更正须理由并保留历史 |
| 既有兼容 | 文字作业／文本PNG、原章节、人工Grade／CSV仍工作；新旧命令不能跨类型写；旧版本字段不被改写，历史receipt仅认原范围 |
| 浏览器旅程 | 管理员建班／分配→教师讲义＋三题测验发布→学生从目录学习、保存／返回恢复、提交→教师人工简答＋发布→学生读成绩→教师封卷／更正→学生读对应历史；取消离开不丢字，原生刷新／关闭另标实际人工结果 |

本包退出：新版 UI 真正通过受支持 export 消费，以上一条三角色旅程在默认3461贯通，所有相关负向合同通过，实际未验项清楚列出；不以单元测试数量代替页面可用性，不宣布 P1–P7 全项目完成。真实上游模型、Interactive/PBL、原生 Runtime、生产维护输入和强制完成规则不属于本包通过条件。

## 10. 下一次实施顺序与证据边界

同一个产品包内部顺序：先抽取并验证公开 Quiz 呈现／编辑／纯算法 → 新增未应用业务 migration 和类型化用例 → 同事务发布／作答／评阅 API → 原课程页面接线 → 默认3461完整旅程与相关负向验证。不是每一项另开审批／复评循环；只有发现影响冻结边界的设计冲突才回报具体阻碍。

本轮仅交付设计和主计划对齐；源码核对证明“能力存在及缺口”，不证明新 host／表／API 已实现或测验已本地可用。没有应用 migration、改运行代码、重启默认入口、提交、推送或 CI dispatch。现有升级 LOCAL 证据继续限于升级和原教学旅程；本设计不扩张其适用范围。

证据核对补充：升级 closeout 的4715文件清单包含主计划。本轮修改主计划，故该历史清单出现1项文档 hash 差异；其运行代码／包／脚本闭包未变。新增本设计不在旧清单内。不改写旧 receipt 来抹平差异，也不声称当前整个工作树与旧清单完全一致。
