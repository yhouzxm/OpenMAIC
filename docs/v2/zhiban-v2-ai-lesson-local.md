# 教师 AI 备课：生成 → 采用 → 发布

> 2026-10-20 后续：已完成[真实 GLM-5.3 三页生成与发布旅程](zhiban-v2-ai-lesson-real-local.md)。下文“未配置”及夹具记录保留当时范围，不代表当前仍无模型；未随之启用完整 Runtime。

2026-10-20：随后已同步 [v1.2.1 补丁](zhiban-v2-openmaic-121-upgrade.md)，Generation 为 0.3.21；本页既有旅程 receipt 仍只证明其签发时源码，不重标版本。

2026-10-20，沿原 P6 教师 AI 优先复用包接线。状态：产品接线已实现，定向本地验证结果见本页末及 receipt。用户确认尚未配置模型，因此不签收真实模型生成。

## 可见产品与复用

教师课程内“讲义与图片”提供 AI 备课面板：输入要求 → 原生持久化生成任务 → 教师确认大纲 → 正文生成／失败重试／取消 → 审核文字投影 → 采用为可编辑讲义草稿 → 原有编辑器保存及显式发布 → 已选课学生读取已发布版本。

直接调用新版 `startGenerationRun`、generation runner／engine／store、默认生成 services、原生确认／重试／取消与 owner-bound document store；不建立第二套生成调度器或浏览器生成引擎。暂不增加课程资源 picker：首包输入备课要求，原有资源上传／解析功能继续独立使用。

采用范围为**纯文字讲义投影**：只接受完成且无待处理媒体的 slide 文档，列明未采用的图片／形状等元素；不复制原生资产、动作、动画、音视频或 Interactive／Quiz／PBL。HTML转纯文本，比较符号及 & 转为全角，页面和总大小受既有草稿限制；不能表示的场景或过长页面明确拒绝。教师在采用前看到逐页文字及遗漏说明，再到原有编辑器审核／调整。此包不代表完整原生课堂播放器或 Tutor 已启用。

## 授权与状态

- 路由 `/api/zhiban/content/{tenant}/offerings/{offering}/ai` 复用原 content HTTP 的真实 session、空间成员、同源 headers、CSRF、限长 body 及错误投影。GET同样仅允许当前任教教师；学生和管理员角色不能借此获得教师能力。
- 生成 owner 由 tenant／offering／membership 的服务端 SHA256 映射；所有任务读／确认／重试／取消／预览／采用必须在此映射内，不接受浏览器提供 Native owner、数据库地址、模型、密钥或 endpoint。
- 启动／命令通过现有 content authoring 的 Identity与实际任教关系事务屏障；执行器通过原生 hooks 及每个服务调用边界重新查验。凭据只保留为进程内 opaque handle，不把 session token 持久化到任务。无有效handle的接管执行会拒绝并暂停，需当前教师重新认证后重试。本LOCAL launcher每次新建cluster，本包不宣称已交付旧cluster跨启动恢复。
- 撤权后下一服务调用及任何采用／发布均拒绝。已发出的模型请求可能完成并产生费用，其结果只进入私有 staging；不承诺撤销外部已发生的调用。
- 开始任务的来源绑定与原生 run 创建在同一 Native 事务中；命令键及意图 hash 防重放串改。原生任务并发／等待上限与检查点规则保留。
- 采用的键由 source run 和当前精确归属稳定派生，草稿及审计在既有 content 事务内落库。同键创建在首次查询前串行化，避免并发重放生成两份草稿。不会覆盖已有讲义，不自动发布；采用后草稿可正常编辑。取消仅处理私有生成源，已采用／发布的内容仍由原有内容生命周期管理。

## 本地安装边界

只在 `--unified-trial` 的受控 disposable cluster（私有 `/tmp/zhiban-trial-content-*` Unix socket、PG16、56517）创建第三数据库 `zhiban_trial_lesson_native` 和专用无超级权限的 `zhiban_lesson_runtime`。其 DDL仅包含原生 provider自身schema及来源映射；不赋予 Identity／Academic／Bridge 数据权限，不给旧Native runtime扩权。普通模型 run API、Native原始文档API及模型设置API仍未在3461开放。

原 Bridge／文本／PNG发布继续使用各自既有安装和ACL校验。新增私有 staging 不继承它们的 receipt，也不代表维护恢复、UNKNOWN／RESERVED处置、完整Runtime已启用。没有修改已应用 migrations 或冻结身份策略。

默认 `pnpm trial:zhiban` 仅启动和种合成数据；专项 `pnpm verify:zhiban:ai-lesson` 使用独立一次性实例验证受影响路径，不跑全课堂／扫描／导出回归。停止该实例会停止并清理其全部三个数据库；保留数据前必须备份三库及私有输入。不可继续沿用旧“双库备份已覆盖全部数据”的说法。

## 真实模型配置

当前用户明确“未配置”。不写入虚构密钥，不自动选择付费模型，不调用真实供应商。

可复用仓库 `openmaic.example.yml`：在私有绝对路径保存模型配置，通过 `OPENMAIC_CONFIG=/绝对路径/openmaic.yml pnpm trial:zhiban` 启动。密钥通过该启动进程的受限环境注入，YAML使用 `${变量名}`；此LOCAL launcher不会自动读取 `.env.local`。至少配置 `course.outline`、`course.content.slide`、`course.actions` 或其 `llm` 父slot的可用模型，并提供供应商允许模型列表。建议首轮关闭 `webSearch`、`image`、`video`、`tts`，限定为文字生成。用户不需要在聊天中发送密码或API key。

配置检查只代表模型可解析，不代表网络、额度和真实生成成功。配置后仅需跑一次真实“生成→确认→采用→发布→学生查看”，不重复无关回归；错误／额度／重试沿原生状态呈现。

## 证据边界

定向验证的预置 Native 完成结果始终标为 `FIXTURE`，只证明授权、投影、采用、防重放与原有发布链；不代表模型生成。真实生成、大纲等待／确认后的模型执行及网络错误恢复，在无模型配置时保持未验收。


## 本轮本地结果

- [定向旅程](evidence/zhiban-ai-lesson-local.json)：PASS，4组必要启动／种数检查＋5组本包检查；含缺模型零任务、CSRF／封闭输入、角色拒绝、并发采用唯一草稿、显式发布及学生读取、任教结束屏障、取消和第三库隔离。Native完成结果为显式夹具，非模型输出。
- [教师页面](evidence/lesson/teacher.png)与[390px页面](evidence/lesson/teacher-mobile.png)：实际浏览器审核／采用链接通过，修正面板导致原编辑器挤窄的问题；无脚本错误或横向溢出。
- 文字投影4项单测、定向类型检查和lint通过；旧content service的既有explicit-any规则单独保留例外，没有关闭新模块规则。
- 原生generation包源码、prompt assets与固定v1.2.0 pin核对并本地构建；最终默认实例绑定其源码及dist，原生run/engine/store不改写。
- 默认实例不含结果夹具，保持“模型尚未配置”；启动只做必要安装与合成教务种数，不执行本包或完整课堂回归。
- 没有提交、推送、CI调度、真实55432／55433访问；28项原迁移和冻结Identity策略hash沿既有基线核对。

最终实例／源码／三库备份边界见[交付receipt](evidence/zhiban-ai-lesson-delivery-local.json)。下一步为配置真实模型后仅验一次“生成→确认大纲→采用→编辑／发布→学生查看”；建议GPT-6.1 Sol / medium。其后沿原P4推进原生课堂／Interactive差额。
