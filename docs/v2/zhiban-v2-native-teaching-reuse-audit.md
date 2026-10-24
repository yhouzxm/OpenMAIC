# OpenMAIC 原生教学功能完整复用核查

2026-10-24。用户要求原有 OpenMAIC 教学能力完整复用到智伴。本次基线为工作区 `package.json` 的 OpenMAIC 1.2.1 和当前实际源码；Git 控制 checkpoint 为 `c709c7815506ed7532d174ba899e76884bb3a98f`，大量业务候选仍为 dirty，不能用该HEAD代表完整产品。沿原 P1–P7，不另建迁移主线。

**结论：常规教学业务已交付；本轮已接原生工作台、完整编辑／文档与资产采用发布，不能签收“全部原生教学功能已复用”。完整 AI 课堂执行、自主 PBL、全格式交付及服务依赖仍有差额。** 原36项是旧分支能力分类，55条是旧入口统计，均不足以覆盖新版原生工作台的功能。页面布局统一也不改变此结论。

## 1. 原生能力与当前接线

| 能力面 | 当前实际状态 | 仍缺什么／如何复用 | 关键源码依据 |
| --- | --- | --- | --- |
| 原生 Workspace／Workbench | 本轮 LOCAL：课程内直接复用 WorkspaceShell、会话、资料、技能、原生编辑及 Agent | 完整证据与默认入口见[原生备课包](zhiban-v2-native-authoring-local.md)；owner 由当前任教推导，不开放原生匿名身份 | `app/zhiban/local/native-workbench.tsx`、`lib/zhiban/infrastructure/authoring/host.ts` |
| AI生成管线 | 原文字／Quiz 管线保留；新增原生 Agent 工具生成、多场景文档与资料引用 | 真实生成结果以本包模型证据为准；图像／视频／语音等缺服务项单列 | `lib/zhiban/infrastructure/authoring/`、`lib/server/agent-runtime/runner.ts` |
| 生成结果保真采用 | 本轮 LOCAL：完整 AppDocument、所有引用资产与讲解动作固定来源摘要，采用为独立课程草稿、显式发布 | 缺失资产、来源变化、远程执行场景拒绝；原文字投影仍供简便入口使用 | `lib/zhiban/infrastructure/authoring/snapshot.ts` |
| 原生课件编辑 | 本轮 LOCAL：直接复用原生 SDK 编辑器、各类课件元素、主题与动作的保存模型 | 操作与固定发布旅程见本包；不是对全部元素逐项穷举验收，服务生成另计 | `app/zhiban/local/native-workbench.tsx`、`components/edit/` |
| 普通PPT播放／教师共享页 | 原共享／跟随保留；新增完整文档固定版本 native standalone 播放、真实资产与旁白索引，四类场景混排 | 自测／项目简报不替代正式 Attempt、AI 讲授或自主 PBL；课程共享完整 Native 状态联动随课堂包 | `app/zhiban/local/native-published.tsx`、`lib/zhiban/infrastructure/authoring/http.ts` |
| 完整AI课堂 | 未整体复用 | 原生Stage／ClassroomSurface、讲解动作与时间线、TTS讲授、语音提问、打断／继续、AI问答、白板和多Agent圆桌尚未形成智伴课程内完整闭环；现有课程讨论是师生论坛，不能替代AI圆桌 | `components/classroom/ClassroomSurface.tsx`、`components/roundtable/index.tsx`、`components/whiteboard/`；新的固定版本播放器已支持课程授权媒体；原共享播放器的限制不能概括整个新宿主 |
| HTML互动／SVG／Canvas演示 | 自包含HTML发布、学生操作、课堂联合派发及Attempt绑定已有 | 外链／远程依赖、多媒体、完整原生互动编辑生成及可信自动完成未覆盖；宿主页自报不能当正式成绩 | `lib/zhiban/infrastructure/content/interactive.ts`、`app/zhiban/local/interactive-client.tsx` |
| 原生Quiz与智伴正式成绩 | 核心已复用且有智伴差额：原生单选／多选／简答生成与展示、正式Attempt／评分发布更正；另有判断、填空、匹配、排序 | 不重复移植既有题型与成绩闭环；完整原生课堂中的Quiz场景混排和结果桥接随课堂包完善 | `lib/zhiban/infrastructure/lesson/quiz-projection.ts`、`app/zhiban/local/quiz-client.tsx` |
| PBL小组协作 | 课程分组、共享修订、全员确认、共同提交和教师评价已交付 | 当前复用设计／任务模板，不等于原生自主PBL运行；AI Instructor、情景角色扮演、原生任务执行／评价、工具与外部工作区仍缺智伴课程治理接线 | `lib/zhiban/domain/pbl/model.ts`、`components/scene-renderers/pbl/v2/use-instructor-stream.ts`；默认metadata的nativeAutonomousRuntimeEnabled=false |
| Tutor／AI Peer | 课程文字Tutor、私人伙伴、私有历史、教师开关已交付 | 多模态输入、工具型辅导、课堂上下文联动未接。当前原生Agent调用明确`tools: []`，不是完整工具Agent | `lib/zhiban/infrastructure/tutor/native.ts:85` |
| 资料输入与多模态生成 | 既有课程资源保留；本轮原生资料上传／可信扫描、文本抽取、Agent 引用与持久原件已接 | Office／OCR／音视频真实服务及图像／视频／语音生成仍待相应输入，不冒称全部可用 | `lib/zhiban/infrastructure/authoring/http.ts`、`lib/server/materials/bytes.ts` |
| 原生导入 | 智伴有教学资源上传／解析，不等于原生课件导入 | 新工作台已复用上游导入入口，但完整课堂ZIP／媒体恢复尚未独立签收；PPTX原生导入为默认关闭的实验性入口，须按实际能力签收。PPTX保真导入与Office转文本解析是两件事，不必全部等待远程解析服务 | `lib/import/use-import-classroom.ts`、`lib/import/use-import-pptx.ts`、`lib/config/feature-flags.ts:145` |
| 原生导出 | 已发布内容的受限PPTX／离线HTML已交付，复用原生导出器 | 完整课堂ZIP、资源包、讲稿Markdown／DOCX、带讲解和媒体的离线课堂未接。视频导出上游自身为实验开关，并依赖真实渲染服务，不冒称成熟功能已可直接启用 | `app/zhiban/local/published-export.tsx`、`components/stage/header-controls.tsx:136`、`lib/config/feature-flags.ts:141`、`app/api/export-video/capability/route.ts` |
| 原生设置／技能／用量 | 本轮原生模型／供应商只读面板及课程私有技能接入；主机 GLM Agent 槽位使用受限配置 | 禁止普通教师写主机配置／密钥；上游全局用量会泄露部署数据，拒绝开放；课程分域统计另计 | `lib/zhiban/infrastructure/authoring/host.ts`、`lib/zhiban/infrastructure/authoring/routes.ts` |
| 可信运行与自动完成 | 服务端正式开始／提交事实、互动版本与Attempt绑定已有 | 完整Native运行CREATE／APPEND／COMPLETE与可信完成／事件桥接未启用；不能从iframe、语音或聊天推定正式完成。现有旧root仍DENIED | `lib/zhiban/infrastructure/openmaic/root.ts:153`、`lib/zhiban/infrastructure/openmaic/runtime/` |

以上“未接”依据当前生产代码／宿主路由和发布的数据模型，不因仓库存在相应源码就标完成。本次GET探测不携带凭据，仅证明当前3461的公开路由接线，不替代授权／业务验收。

## 2. 已完成，不能再排一遍的内容

课程／学期／行政班／教学班／任教／Enrollment、章节目录与发布、普通课堂派发／跟随、作答与附件、人工评分／成绩发布更正、成绩簿／总评／申诉／导出、师生讨论、头像／资料／账户与导入、进度／先修、教师统计／人工跟进／提醒／补救／风险审阅、概念证据／本人纠错、六维证据／教师审阅EMA、校内证书／跨班学分、受限服务正式AI评分等已有各自LOCAL证据。它们不因本次发现原生功能缺口而回到未开始。

PBL共同提交与原生AI自主PBL分别记状态；私人Peer不冒充原生多角色圆桌。服务端DC／RC模拟执行器和报告／评分已交付，来源为服务端模拟；真实仪器测量仍未交付。当前DSL只有slide／quiz／interactive／pbl，没有现成独立VirtualLab合同，不能把自研实测引擎写成“上游原有能力未复制”。

独立安装／原账号与三库恢复／受信HTTPS／普通重启已在真实GitHub Ubuntu VM run **40096542805**签收PASS，不继续写“跨机完全未验”。范围为同内部PG根、合成数据、临时VM；真实运营、长期主机与生产数据迁移另计。新响应式UI晚于该冻结包，需最终统一交付时纳入；历史pin和PASS不改写。

## 3. 集中剩余范围：六组教学差额，仍沿原三个大包

六组不是六轮“设计—评审—修复”，也不是总体完成百分比：

1. **完整备课与编辑**：本轮原生工作台／编辑／文档资产／采用固定发布已 LOCAL 接入；最终证据和默认升级状态见[本包](zhiban-v2-native-authoring-local.md)。服务依赖与全格式导入导出仍分别列项。
2. **完整AI课堂**：原生讲授动作、音视频、问答／打断／继续、白板、圆桌及课程课堂状态联动。
3. **原生自主PBL**：Instructor、角色场景、任务执行／评价和当前课程授权，保留已交付小组协作。
4. **完整导入导出**：原生课堂／资产归档、导入恢复、资源包、讲稿、完整离线课堂；实验性视频按真实上游开关与服务能力单列。
5. **资料／多模态与配置**：资料驱动备课、Office／OCR／音视频真实解析、图像／视频／语音等实际服务，受控设置与用量。
6. **可信运行／完成接线**：原生执行与正式Attempt／学习事件／结果之间的可信桥接及撤权、取消、恢复；不改既有成绩规则。

交付仍合并为原计划第6节三包：

| 原大包 | 本次核对后的整包内容 |
| --- | --- |
| 资源与附件／原P2、P3、P6内容复用 | 完整原生备课、编辑、文档／资产、导入导出及服务配置；先接可直接复用的组件，缺解析／生成服务只阻塞依赖项 |
| 完整课堂与实验／原P4、P6 | 完整原生课堂、语音／白板／圆桌、PBL自主模式、可信执行及结果；普通原生组件与旧真实Native维护目标分开，不把旧维护链作为所有课堂功能的先决条件 |
| 持久化交付／原P7 | 功能和新UI稳定后一次合并最终安装／配置／恢复／交接，不逐入口反复P7或重复CI；已有远端PASS保留原冻结包适用范围 |

## 4. 集中外部边界与原计划尾项

- Office／OCR／媒体真实provider及模型多模态／语音／渲染服务：按具体服务配置与实际调用结果签收，当前不能统称只差配置或已经全部可用。
- 旧真实Native维护control／独立pgpass／受信公钥pin及批准未齐，仍隔离；UNKNOWN／RESERVED不解除。新课程宿主对原生组件的复用应走自身合规授权适配，不能为赶进度给旧root放行。
- EMA预约当前需教师显式运行，默认metadata的`unattendedDispatch=false`；无人值守调度是旧计划扩展尾项，不能声称已完成，也不是所有原生教学的前置。
- 当前上游未提供的真实仪器测量、生产运营渠道／跨校资质、旧机电竞赛PLC专用站点，不假列为可以直接复制的通用原生功能。

## 5. 本次范围与下一步

初轮只读核查的源码 hash 与无凭据 GET 结果见 `evidence/native-reuse-audit/`，它们是接线前历史快照。本轮增量与 LOCAL 证据见[原生备课产品包](zhiban-v2-native-authoring-local.md)，不能将旧 GET 404 当作当前接线状态。

下一完整功能为 **完整原生 AI 课堂＋课程课堂接线**，复用讲授动作、问答／继续、白板与圆桌；服务及可信结果依赖集中列明。之后合并原生自主 PBL 与全格式交付，不再逐元素拆包。涉及课程授权和运行并发，建议 **GPT-6.1 Sol / high**。
