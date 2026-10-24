# P6 课程 AI Tutor 本地产品包

2026-10-22；沿原 P1–P7 的 P6 AI Tutor（矩阵 #28 REWRITE）实施。PBL、EMA、AI Peer、画像维度仍 REVIEW。本页最终验收状态以文末 receipt 为准。

## 复用与范围

直接复用当前 OpenMAIC 1.2.1 的 `resolveModel(stage: chat-adapter)` → `createCallLlmStreamFn` → `runNativeChild` → Pi `buildAgent`，包含服务端模型路由、历史消息、流协议适配、取消和执行预算。没有新建模型 SDK、供应商代理或第二套 Agent 引擎。使用原 `classroom` 模型槽，部署配置保留既有管理权；请求不接受模型、密钥、owner、system、history、tool 或权限事实。

智伴增加教学班教师开关／公开学习提示、师生本人私有会话、明确固定已发布讲义、授权与交付屏障、审计／幂等命令和课程工作区页面。默认关闭。只有当前有效任教关系且具有相应 TEACHER 作用域的教师可启停；ADMIN 不自动成为任教教师。教师可用自己的私人对话预演，不能读取学生私人对话。

不把聊天变成正式作答、成绩、通知、风险、画像或可信 Runtime 事件。没有课程编辑、原生文档写入、白板、外部检索、shell、文件和其他工具，`tools=[]`、允许工具名为空、每次最多一个原生 Agent adapter transport。教学治理靠实际能力限制和当前授权，提示词不被视为权限屏障。

## 完整可见流程

课程工作区 → **AI 学习辅导**。教师明确启用并设置学习提示 → 学生新建私人主题，可选本人有权访问的已发布讲义 → 发送问题／查看生成状态／停止 → 刷新后继续本人的历史对话 → 结束对话。历史和新提问有明确区分；关闭辅导后本人仍可看原历史，不能新建或继续提问。

讲义可不选；未选时只进行概念辅导，不编造课程资料。选讲义时从现有 Content 授权发布 API 读取固定发布 ID／版本，只抽取文字，保留源标题与摘要 hash。图片不做视觉理解，互动 HTML 不进入上下文；无文字或超过 12000 字会明确拒绝，不静默截断。教师草稿、测验答案／答案键、他人作答、私人跟进、画像和其他课程资料不自动供给模型。学生自行输入的文字会发给配置的模型，页面明确提示避免不必要个人信息。

AI 回答标明建议用途和模型来源；页面使用 `textContent` 展示纯文字，不执行模型 HTML、链接或脚本。本包不提供 Markdown／公式排版、图片／音频、教师查看学生对话、跨课程聊天或自动教学处置。

## 数据与 API

新独立 `zhiban_tutor`：

- `policies`：每教学班启用状态、教师提示和递增 revision。
- `sessions`：不可变 tenant／offering／member／mode／原 Enrollment／标题／固定讲义快照；只允许更新 OPEN／CLOSED、revision、时间。
- `turns`：不可变本人问题、会话和策略版本；RUNNING → COMPLETED／FAILED／CANCELLED／BLOCKED／EXPIRED。只有 COMPLETED 可有回答；限 30 次提问／会话。
- `events`：追加的教师设置、会话／提问／取消／关闭／过期／完成审计。
- `commands`：tenant＋命令键的规范化 payload digest、actor、offering 和结果；相同键同 payload 不再次调模型，不同 payload 冲突。
- `schema_migrations`：来源 hash；独立 owned PG16 builder 构造 catalog／ACL expected profile，loader 只读取验证，不自签／安装。

`/api/zhiban/tutor/:tenant/offerings/:offering`：

- GET `mode=TEACHER|STUDENT`，本人的会话列表每页 20，签名 cursor 绑定 tenant／actor／offering／mode。
- GET `mode=...&id=...`，本人会话与完整的至多 30 次交互。不能选择别人的 membership 或 Enrollment。
- POST `SET_POLICY`、`CREATE_SESSION`、`ASK`、`CANCEL`、`CLOSE_SESSION`；闭合 DTO；已有 Identity Session／Origin／CSRF；命令键格式、32KiB body、并发入口限制沿用原 HTTP protocol。

新迁移只应用于本包独占的 disposable PG16。FORCE tenant RLS、PUBLIC 撤权、受限 runtime 列 ACL。没有修改已应用 Identity／Academic／Learning／Bridge／Native migration 或生产配置，没有写入原成绩／Submission／Attempt。

## 并发、撤权与失败

业务事务复用 `PostgresAcademicStore.run` 的当前 Identity、Session、Membership、角色及有效期屏障，再复用 `LearningPgTransaction.access` 的课程／教学班／任教／Enrollment 锁。学生会话绑定创建时的入班关系；即使退课再加入复用同一 Enrollment 行，新 valid_from 晚于会话创建时间也不会重新接回旧会话。

模型 I/O 不持有 Identity／课程数据库锁。ASK 先原子预约 turn、更新会话 revision、追加审计和命令结果；提交后才调原生 Agent。教学班 Tutor 命令短时串行，session revision 乐观并发，每人每教学班最多一个 RUNNING；全宿主最多 4 个预约／执行。单次问题 2000 字、教师提示 2000 字、历史最近 8 个成功交互且最多 24000 字、回答最多 16000 字，原生输出预算最多 2048 token、90 秒，持久预约期限 120 秒。没有无限历史或宿主自动重发。原生 SDK／部署 fallback 可能在一个 adapter transport 内重试；本包不把 adapter 次数冒充供应商 HTTP 次数或计费上限。显示的 provider／model 是配置的主模型，不作为 fallback 实际执行模型的证明。

开始调用前、生成期间约每 3 秒、完成交付前重查当前权限与 policy revision；生成期间的轮询是尽力取消，最后事务才是交付屏障。选择了讲义时，开始和交付都复用 Content 当前发布／Bridge slot／generation 授权；交付的短事务持有资源和 slot 锁直至 Academic 完成提交，重新发布或撤回不能把旧上下文生成当成新发布讲义的回答。任何策略 revision 变化都使旧生成失效，包括关闭后再次开启。取消／结束状态优先，迟到供应商结果不得覆盖。

供应商已经收到的问题不能撤回，也不承诺停止后不计费。失败、被取消、超时、来源改变的部分输出不交付；不会把推理内容当答案。Identity 已撤销时完成事务自身拒绝写入，turn 保留到租期过期且没有回答；本人有权回来时显示 EXPIRED，并在下一次提问时持久化过期。重启不自动恢复／重发，避免不确定调用重复计费。新问题是明确的新调用；HTTP 不确定结果重试原命令键。

ASK 审计失败会回滚预约，不调模型；FINISH 审计失败会回滚回答，后续按租期处理。数据库提交结果不确定也不自动重调供应商。原完整 Native Runtime／Bridge 生产启用门禁保持独立，没有开启现有工具型 Agent 服务、PBL 或画像维度。

## 验证与证据约束

- [独立 PG16 reference](evidence/zhiban-tutor-profile-reference-local.json) 仅证明新 Tutor 来源／catalog／ACL 的预期值，不是功能签收。
- 定向故障 provider 只用于授权、持久化、取消和失败切点，明确标记 `CONTROLLED_FAULT_PROVIDER / NO_REAL_MODEL`；不能作为真实生成成功。
- 真实模型使用现有受限本地配置及服务端 classroom 槽，不在仓库／receipt 中保存密钥。真实模型旅程独立记录，不与故障证据混称。
- 本轮保留既有大量 dirty 候选；基线 HEAD 本身不含全部实现，不能仅 checkout HEAD 声称可复现。没有 commit／push／CI dispatch，没有访问真实 PG55432／55433。

## 本轮最终结果

**LOCAL PASS**。分支 `refactor/zhiban-v2`，基线 HEAD `daf63afa83470d24a9ed41d171c6a17f8a80adb6`，开始时1480项 dirty／untracked，全部保留。基线SHA没有包含这些候选，不把SHA本身当成完整交付版本。

- [定向PG16 receipt](evidence/zhiban-tutor-local.json)、[故障边界旅程](evidence/tutor/directed-journey.json)、[详细日志](evidence/tutor/directed.log)：新独立PG16／受限角色／真实Session，教师默认关闭／启用／设置冲突与重新载入、私人会话／跨人拒绝、规范化幂等／并发预约、取消／结束、策略revision和来源撤回屏障、预约及完成审计回滚、过期不自动重发、原Enrollment退课重入、教师撤权、tenant RLS／列ACL与cursor绑定。故障provider不是实际AI验收。fixture停止／删除见receipt lifecycle。
- [影响依赖闭包类型检查](evidence/tutor/typecheck.log)、[影响文件lint](evidence/tutor/lint.log)通过；[DTO／规范化用例](evidence/tutor/unit.log)通过。类型检查包含现有 `types/web-extraction-vendors.d.ts`，未修改上游类型或运行全仓类型／课堂回归。
- [当前3461真实浏览器旅程](evidence/tutor/default-browser-journey.json) **PASS**：教师在IAB启用 → 学生引用真实已发布的合成电路讲义 → GLM-5.3两轮辅导，第二轮沿用前轮自检题 → 原生刷新后两轮仍可见。两个成功COMPLETED来自真实native Tutor engine；教师自己的列表为空、读取该学生会话404。真实输出是AI建议，不作为学科正确性、成绩、掌握或课程完成认证。
- [教师设置截图](evidence/tutor/default-teacher-policy.png)、[学生对话截图](evidence/tutor/default-student-conversation.png)。当前入口为3461的课程“AI 学习辅导”；准确课程及会话URL见真实旅程receipt。
- [定向来源核对](evidence/tutor/source-check.json)现存source drift0；[当前宿主核对](evidence/tutor/default-source-check.json)单列；既有迁移未改写。旧C9／Storage／Identity等证据保持原适用范围，不继承成本包功能证明。
- [切换前新鲜三库归档](evidence/tutor/before-backup.json)与[当前合成课堂三库归档](evidence/tutor/default-backup.json)：hash及TOC已验证，均 **restoreTested=false**。当前root是新建模拟数据，未恢复前一实例；已有归档可另行受控恢复。

普通 `pnpm trial:zhiban` 不自动读取聊天密钥，缺配置时页面会显示模型不可用，仍可使用无依赖业务。本机已有GLM `.env.local` 的私有启动入口是 `node /home/zxm/.local/state/zhiban-model-trial/start-tutor.cjs`：从现有本地环境配置生成0600的 `openmaic-tutor.yml`，复用原GLM，给classroom槽低思考预算；不开放agent／检索／解析等其他槽，密钥不入库或receipt。这是本机模型交付输入，不是可移植生产部署合同。停止会删除当前owned集群；不运行第二个同端口实例。

剩余边界：纯文字呈现、无工具型自主行动、无多模态／Markdown富渲染、无教师窥视学生私人对话。真实供应商取消和计费不可回溯，SDK／部署fallback策略仍按原生配置。正式生产安装、持久部署、数据保留／删除与成本配额策略仍需对应上线合同；本包只签收LOCAL disposable。

下一完整功能建议：返回原P3的**普通账户开通与首次登录交付包**，集中覆盖global开户／首密交付的明确授权和本人首次登录，继续保留相关入驻门禁；不是再做一轮无关课堂试用。涉及跨Identity授权，建议 **GPT-6.1 Sol / high**。
