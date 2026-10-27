> 2026-10-27：[原生整课视频导出＋教师控制的课堂共享](zhiban-v2-course-video-sharing-local.md)已 LOCAL 接通并完成真实渲染／下载及双浏览器旅程。同步限定固定课件位置、播放状态和教师公开板书文字／小结，私人 AI 内部状态不广播；永久视频归档和大班／长课容量未据此签收。

> 旧 Office 整包已完成 LOCAL：DOC／PPT／XLS隔离转现代格式、双向扫描、AliDocMind真实解析、教师正文核对编辑／新建原生课件／采用发布及学生固定版本查看通过。原件保留，仍限1MiB，不承诺无损版式。见[旧 Office 收口](zhiban-v2-legacy-office-local.md)。

> 本轮服务收口：豆包TTS已通过真实生成／扫描／采用发布及学生播放；DOCX／PPTX／XLSX／PNG OCR已通过AliDocMind真实解析。用户开通模型后，Seedance真实生成／扫描／采用发布及学生播放已通过，视频已启用。见[最新服务收口与配置](zhiban-v2-service-provider-final-local.md)。旧证据和P7归档保持各自来源范围。

> 首轮历史记录（后续收口见上）：现有智谱凭据已接通图像生成及ASR，并完成教师扫描／采用发布与学生查看。TTS真实请求429保持关闭；音视频资料解析已在FFmpeg安装后通过真实分段转写、关键帧及正文验收；文档／OCR和视频生成仍待配置／适配。见[服务接入与验收](zhiban-v2-service-provider-acceptance-local.md)；P7旧归档保持原冻结范围，不重打交接。

> 2026-10-26 P7 当前收口：近期原生备课／课堂／自主PBL／归档、多模态、管理员服务中心及可信结果已一次纳入[统一持久化交付](zhiban-v2-p7-handoff.md)。源码、安装包与私有恢复分离，实际验证与版本认该页 closeout；历史模型／PG／远端证明保持原范围，不重复全课堂或CI。

> 2026-10-26 当前：完整课堂与可信结果已完成普通课程 LOCAL 整包，包含固定 Quiz／PBL 成果→原 Attempt／正式提交→原评分与完成规则、教师显式共享小结及受限 Tutor 来源工具。实际范围与集中边界见[产品包](zhiban-v2-classroom-trusted-results-local.md)；旧 Native 维护链、仪器实测及缺少服务的能力继续隔离。下一整包为统一持久化交付，历史“下一步”不再作为待办。

> 2026-10-26 原 P3／P6：[资料与多模态服务整包](zhiban-v2-materials-multimodal-local.md)已补课程服务状态、原生图像／视频／TTS／ASR接线、请求查证与已有素材采用发布；真实扫描、文本抽取和本地素材发布旅程已 LOCAL 通过。用户确认外部服务未配置，Office／OCR／音视频解析及各类生成／语音真实调用仍待服务，不能标为全部可用。

> 2026-10-26 原 P3／P6：[原生全格式课件归档与恢复](zhiban-v2-native-archive-local.md)已接稳定六格式导出、完整 MAIC 设计／资产及静态 PPTX 新副本恢复；实际 LOCAL 扫描、发布旅程与默认入口以本包 closeout 为准。学生历史不携带，实验视频服务与旧 Native 可信维护边界保留。下一整包为统一持久化交付，不逐格式重复 P7／CI。

> 2026-10-25 当前状态：[原生自主 PBL 产品包](zhiban-v2-native-autonomous-pbl-local.md)已完成 LOCAL 课程接线、真实模型／报告与持久重启验证。当前下一整包为原生全格式课件归档／恢复，历史自主 PBL 待办由本条及该包 closeout 覆盖。

# OpenMAIC 原生教学功能完整复用核查

2026-10-26 更新。基线为 OpenMAIC 1.2.1；已同步的 Git checkpoint 为 `093b4a69af96626010d9104c50d680d9b9dc1928`。本轮原生备课／AI 课堂／自主 PBL／稳定格式归档恢复为未提交的 LOCAL 候选，按本包 source/hash 与证据范围核对；沿原 P1–P7，不另建迁移主线。

**结论：常规教学业务已交付；本轮已接原生工作台、完整编辑／文档与资产采用发布，不能签收“全部原生教学功能已复用”。本轮又接入固定发布版本的原生 AI 课堂、真实问答／白板／多角色圆桌及本人历史；自主 PBL 与稳定格式交付已 LOCAL 接入；普通课程可信成果已接原正式提交／评分／完成规则；语音／媒体服务、实验视频、真实仪器与旧Native维护仍有差额。** 原36项是旧分支能力分类，55条是旧入口统计，均不足以覆盖新版原生工作台的功能。页面布局统一也不改变此结论。

## 1. 原生能力与当前接线

| 能力面 | 当前实际状态 | 仍缺什么／如何复用 | 关键源码依据 |
| --- | --- | --- | --- |
| 原生 Workspace／Workbench | 本轮 LOCAL：课程内直接复用 WorkspaceShell、会话、资料、技能、原生编辑及 Agent | 完整证据与默认入口见[原生备课包](zhiban-v2-native-authoring-local.md)；owner 由当前任教推导，不开放原生匿名身份 | `app/zhiban/local/native-workbench.tsx`、`lib/zhiban/infrastructure/authoring/host.ts` |
| AI生成管线 | 原文字／Quiz 管线保留；新增原生 Agent 工具生成、多场景文档与资料引用 | 真实生成结果以本包模型证据为准；图像／视频／语音等缺服务项单列 | `lib/zhiban/infrastructure/authoring/`、`lib/server/agent-runtime/runner.ts` |
| 生成结果保真采用 | 本轮 LOCAL：完整 AppDocument、所有引用资产与讲解动作固定来源摘要，采用为独立课程草稿、显式发布 | 缺失资产、来源变化、远程执行场景拒绝；原文字投影仍供简便入口使用 | `lib/zhiban/infrastructure/authoring/snapshot.ts` |
| 原生课件编辑 | 本轮 LOCAL：直接复用原生 SDK 编辑器、各类课件元素、主题与动作的保存模型 | 操作与固定发布旅程见本包；不是对全部元素逐项穷举验收，服务生成另计 | `app/zhiban/local/native-workbench.tsx`、`components/edit/` |
| 普通PPT播放／教师共享页 | 原共享／跟随保留；新增完整文档固定版本 native standalone 播放、真实资产与旁白索引，四类场景混排 | 自测／项目简报不替代正式 Attempt、AI 讲授或自主 PBL；已接教师控制的公开课件位置／播放／文字联动；私人 Native 状态继续独立 | `app/zhiban/local/native-published.tsx`、`lib/zhiban/infrastructure/authoring/http.ts` |
| 完整AI课堂 | 固定发布版本的普通原生课堂已 LOCAL 复用 | 直接使用 ClassroomSurface／Stage、原生动作／播放、Pi 问答／多角色圆桌、白板及自测／本人历史；教师按版本启停，当前任教／Enrollment 和撤权屏障已接。TTS／ASR 未配置；新增教师显式共享小结／本人板书及原正式成果桥接，仍不全班同步私人AI内部状态 | [本包及真实模型证据](zhiban-v2-native-ai-classroom-local.md)；`lib/zhiban/infrastructure/classroom-ai/` |
| HTML互动／SVG／Canvas演示 | 自包含HTML发布、学生操作、课堂联合派发及Attempt绑定已有 | 外链／远程依赖、多媒体、完整原生互动编辑生成及可信自动完成未覆盖；宿主页自报不能当正式成绩 | `lib/zhiban/infrastructure/content/interactive.ts`、`app/zhiban/local/interactive-client.tsx` |
| 原生Quiz与智伴正式成绩 | 核心已复用且有智伴差额：原生单选／多选／简答生成与展示、正式Attempt／评分发布更正；另有判断、填空、匹配、排序 | 不重复移植既有题型与成绩闭环；原生课堂Quiz成果已服务端重算并接原正式提交／评分，见可信结果包 | `lib/zhiban/infrastructure/lesson/quiz-projection.ts`、`app/zhiban/local/quiz-client.tsx` |
| PBL小组协作／原生自主模式 | 小组共同提交和教师评价保留；固定发布版本的原生 Instructor／Simulator／Evaluator、本人状态／报告已 LOCAL 接入 | AI 练习不替代正式小组评价；外部工具服务、旧 Native 可信完成独立保留 | [自主 PBL](zhiban-v2-native-autonomous-pbl-local.md)、`lib/zhiban/infrastructure/classroom-ai/pbl.ts` |
| Tutor／AI Peer | 课程文字Tutor、私人伙伴、私有历史、教师开关已交付 | 已补固定课件／教师共享小结的只读读取和检索工具；图片工具按模型vision能力开放，当前模型vision=false未实调；无任意工具写入／跨课程操作 | `lib/zhiban/infrastructure/tutor/course-tools.ts` |
| 资料输入与多模态生成 | 原生资料上传／抽取／引用保留；已补统一状态、四类服务入口、请求查证、本地媒体到新课件及采用发布 | 图像生成与ASR已完成真实智谱调用及本地应用旅程；豆包TTS、现代Office／OCR和Seedance已通过[真实服务收口](zhiban-v2-service-provider-final-local.md)，音视频资料解析已完成FFmpeg真实抽取与关键帧验收；不扩大旧证据范围 | [整包及证据边界](zhiban-v2-materials-multimodal-local.md)、`lib/zhiban/infrastructure/authoring/media/` |
| 原生导入恢复 | MAIC 完整设计／资产、原生隔离 PPTX 静态转换已接课程授权和可信扫描；新副本另行采用发布 | PPTX 公式／媒体转换有已知降级；完整保真恢复用 MAIC。Office 转文本服务仍独立 | [归档恢复包](zhiban-v2-native-archive-local.md)、`lib/zhiban/infrastructure/authoring/archive/` |
| 原生导出 | MAIC、PPTX、互动资源 ZIP、离线 HTML、Markdown／DOCX 讲稿六格式已 LOCAL 接入 | 已接原生视频工程／MP4 渲染、本人课程任务和实际下载，见[视频与共享包](zhiban-v2-course-video-sharing-local.md)；成品临时保留，已下载文件无法撤回，不携带学生历史 | [归档恢复包](zhiban-v2-native-archive-local.md)、`app/zhiban/local/native-archive.tsx` |
| 原生设置／技能／用量 | 本轮原生模型／供应商只读面板及课程私有技能接入；主机 GLM Agent 槽位使用受限配置 | 禁止普通教师写主机配置／密钥；上游全局用量会泄露部署数据，拒绝开放；课程分域统计另计 | `lib/zhiban/infrastructure/authoring/host.ts`、`lib/zhiban/infrastructure/authoring/routes.ts` |
| 可信运行与自动完成 | 服务端正式开始／提交事实、互动版本与Attempt绑定已有 | 普通课程固定成果已绑定原Attempt／正式提交，完成由原发布规则判定；旧Native CREATE／APPEND／COMPLETE仍未启用，旧root仍DENIED。不能从iframe、语音或聊天推定完成 | `lib/zhiban/infrastructure/openmaic/root.ts:153`、`lib/zhiban/infrastructure/openmaic/runtime/` |

以上“未接”依据当前生产代码／宿主路由和发布的数据模型，不因仓库存在相应源码就标完成。本次GET探测不携带凭据，仅证明当前3461的公开路由接线，不替代授权／业务验收。

## 2. 已完成，不能再排一遍的内容

课程／学期／行政班／教学班／任教／Enrollment、章节目录与发布、普通课堂派发／跟随、作答与附件、人工评分／成绩发布更正、成绩簿／总评／申诉／导出、师生讨论、头像／资料／账户与导入、进度／先修、教师统计／人工跟进／提醒／补救／风险审阅、概念证据／本人纠错、六维证据／教师审阅EMA、校内证书／跨班学分、受限服务正式AI评分等已有各自LOCAL证据。它们不因本次发现原生功能缺口而回到未开始。

PBL共同提交与原生AI自主PBL分别记状态；私人Peer不冒充原生多角色圆桌。服务端DC／RC模拟执行器和报告／评分已交付，来源为服务端模拟；真实仪器测量仍未交付。当前DSL只有slide／quiz／interactive／pbl，没有现成独立VirtualLab合同，不能把自研实测引擎写成“上游原有能力未复制”。

独立安装／原账号与三库恢复／受信HTTPS／普通重启已在真实GitHub Ubuntu VM run **40096542805**签收PASS，不继续写“跨机完全未验”。范围为同内部PG根、合成数据、临时VM；真实运营、长期主机与生产数据迁移另计。新响应式UI晚于该冻结包，需最终统一交付时纳入；历史pin和PASS不改写。

## 3. 集中剩余范围：六组教学差额，仍沿原三个大包

六组不是六轮“设计—评审—修复”，也不是总体完成百分比：

1. **完整备课与编辑**：本轮原生工作台／编辑／文档资产／采用固定发布已 LOCAL 接入；最终证据和默认升级状态见[本包](zhiban-v2-native-authoring-local.md)。服务依赖与全格式导入导出仍分别列项。
2. **原生AI课堂（本轮 LOCAL）**：已接固定发布、播放、真实问答／白板／圆桌及本人历史；语音须实际服务，全班共享 AI 内部状态和正式可信结果仍独立列项。
3. **原生自主PBL（LOCAL 已交付）**：Instructor、角色场景、任务执行／评价和当前课程授权，保留已交付小组协作；正式可信完成与外部工具仍独立。
4. **稳定格式导入导出（LOCAL 已交付）**：原生课堂／资产归档、MAIC／静态 PPTX 新副本恢复、资源包、讲稿和离线课堂；实验性视频按真实上游开关与服务能力单列。
5. **资料／多模态与配置**：服务接线与本地可用旅程已整包交付；现有外部配置已接入，现代Office／OCR、音视频解析与图像／视频／TTS／ASR均已在其支持范围通过LOCAL真实调用，不重复移植已完成入口。
6. **可信运行／完成接线（普通课程 LOCAL 已交付）**：固定Quiz／PBL成果、原Attempt／正式提交、原成绩和完成规则、教师共享与受限Tutor工具已接；真实模型及重启证据认可信结果包。旧Native维护与真实仪器继续隔离。

交付仍合并为原计划第6节三包：

| 原大包 | 本次核对后的整包内容 |
| --- | --- |
| 资源与附件／原P2、P3、P6内容复用 | 完整原生备课、编辑、文档／资产、导入导出及服务配置；先接可直接复用的组件，缺解析／生成服务只阻塞依赖项 |
| 完整课堂与实验／原P4、P6 | 完整原生课堂、语音／白板／圆桌、PBL自主模式、可信执行及结果；普通原生组件与旧真实Native维护目标分开，不把旧维护链作为所有课堂功能的先决条件 |
| 持久化交付／原P7 | 功能和新UI稳定后一次合并最终安装／配置／恢复／交接，不逐入口反复P7或重复CI；已有远端PASS保留原冻结包适用范围 |

## 4. 集中外部边界与原计划尾项

- 服务验收已覆盖现有AliDocMind、豆包TTS、Seedance、GLM图像／ASR及FFmpeg；未列入的提供者、旧二进制Office、超限文件与任意版式保真不在本轮签收范围。
- 旧真实Native维护control／独立pgpass／受信公钥pin及批准未齐，仍隔离；UNKNOWN／RESERVED不解除。新课程宿主对原生组件的复用应走自身合规授权适配，不能为赶进度给旧root放行。
- EMA预约当前需教师显式运行，默认metadata的`unattendedDispatch=false`；无人值守调度是旧计划扩展尾项，不能声称已完成，也不是所有原生教学的前置。
- 当前上游未提供的真实仪器测量、生产运营渠道／跨校资质、旧机电竞赛PLC专用站点，不假列为可以直接复制的通用原生功能。

## 5. 本次范围与下一步

初轮只读核查的源码 hash 与无凭据 GET 结果见 `evidence/native-reuse-audit/`，它们是接线前历史快照。本轮增量与 LOCAL 证据见[原生备课产品包](zhiban-v2-native-authoring-local.md)，不能将旧 GET 404 当作当前接线状态。

本轮[原生 AI 课堂](zhiban-v2-native-ai-classroom-local.md)已补普通课程宿主；真实模型与个人练习证据不替代旧冻结 Native 正式事实。下一完整功能建议 **原生自主 PBL 的 Instructor／角色场景／任务运行与课程治理**，继续保留既有小组共同提交和教师评价；之后合并全格式交付。复杂课程授权与运行并发建议 **GPT-6.1 Sol / high**。

2026-10-25 原 P6 更新：[原生自主 PBL](zhiban-v2-native-autonomous-pbl-local.md)已补普通课程发布宿主，原生 Hero／Workspace／Submission／Completion、Instructor／Simulator／Evaluator 直接复用。教师设计与个人练习拆分保存，服务端执行结果和客户端输入分权。既有小组提交独立保留；旧 Native 正式完成／维护链不因此启用。当前结果及 hash 认该包 closeout，先前“自主 PBL 待补”不再代表当前代码状态。原生稳定六格式归档／恢复已在2026-10-26 LOCAL完成；下一完整包为统一持久化交付，集中纳入新原生能力和UI；建议 GPT-6.1 Sol / medium。
