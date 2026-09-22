# Target-only Upstream Extension Backlog

Status: TARGET ARCHITECTURE ACCEPTED / CAPABILITY EXTENSIONS PENDING。不是上游issue、不是已承诺实现。
P0 IDENTITY BLOCKERS: 0。
Bridge仍BLOCKED；本报告不声称P0 BRIDGE BLOCKERS为0。保留0A的9项UPSTREAM_EXTENSION_REQUIRED原始分类；本表按MODEL B必要能力重新计算。
当前真正剩余2项，均P1、面向后续学习产品完整能力；当前Identity基础阶段P0 upstream blockers为0。这不表示Bridge实施已过Gate，也不表示完整V2无阻塞。若完整课堂/Interactive成为首发硬要求，对应项升级为该发布P0，须人工重新确定范围。

## U01 — Supported multi-scene classroom/playback execution host

CAPABILITY: 不依赖原生页面、Stage Zustand store的完整课堂/Playback/Quiz/PBL执行宿主。

CURRENT LIMITATION: DSL公开Stage/Scene/Action/runtime数据；renderer只有SlideCanvas及元素/效果；generation公开PBL纯kernel和planner，不提供完整课堂调度、音频时序、Quiz/PBL UI与执行生命周期。0A S01/S03/S11和I04说明组合执行仍在内部。

WHY PACKAGE HOST CANNOT SOLVE: 当前公开包可以做单slide显示与Runtime持久化，不能据此保真运行完整OpenMAIC课堂；复制内部engine会违反升级边界。智伴自行实现有限活动引擎是另外的产品架构决策，不能暗中当现有上游能力。

REQUESTED STABLE CONTRACT: 版本化的headless execution host（或独立受支持组件契约），显式注入document/scene读取、asset resolver、runtime sink、受控AI调用、取消信号；明确Action支持集、能力协商、错误、暂停/恢复/结束事件；不依赖宿主cookies/全局store，不处理Zhiban身份。

SECURITY BENEFIT: 所有副作用可交由已授权Port；学习记录上下文由host绑定，禁用的动作能fail closed。

UPSTREAM LOCATION: 候选提取来源components/stage*、lib/runtime/**、lib/store/**；不是现有export。公开目标位置须上游决定，不由本轮创建。

CORE BOUNDARY CATEGORY: 现有C stage编排、D store/internal runtime不可本地改；请求新增B EXTENSION_POINT公开package契约。

BLOCKS WHICH V2 PHASE: 完整Classroom/Playback/Quiz/PBL能力启用；若1B9要求完整覆盖则该范围仍阻塞。不阻塞纯Identity Domain。

WORKAROUND: 单slide预览 +公开Document/Runtime存储能力受限验证；不冒充完整课堂。完整能力保持关闭，或将来自愿选择并评审独立智伴引擎。

PRIORITY: P1（后续必要能力）。

## U02 — Supported isolated interactive host and runtime bridge

CAPABILITY: Interactive/VirtualLab的受限iframe执行、上下文绑定与观测通道。

CURRENT LIMITATION: DSL/generation支持互动内容与生成，不包含受支持的InteractiveIframeHost协议。0A S12/I05记录内部patch/pool/postMessage/observation实现；message source校验不等同可信学习证据，任意HTML资源还可能外连。

WHY PACKAGE HOST CANNOT SOLVE: 存储/renderer/editor导出不能提供完整互动隔离协议；直接拷贝或导入iframe内部helper违反边界。通用浏览器sandbox本身不是OpenMAIC互动协议兼容保证。

REQUESTED STABLE CONTRACT: 独立、版本化interactive host/bridge，明确sandbox与origin策略、source + channel/nonce + instance + document/scene绑定、销毁与撤权、资源解析/运行态写入注入、事件schema及不可信标记；禁止自动赋予parent权限。其资源与事件接口可接入U01但验收独立。

SECURITY BENEFIT: 阻止兄弟iframe/过期实例复用消息，限制资源旁路，分离观察事件与服务端评估事实。

UPSTREAM LOCATION: 当前components中的InteractiveIframeHost及lib/utils/iframe*、iframe pool/observation相关模块；0A S12源引用为准。新export设计交上游。

CORE BOUNDARY CATEGORY: D DO_NOT_CUSTOMIZE iframe内部实现；目标为新增B公开扩展点。

BLOCKS WHICH V2 PHASE: Interactive/VirtualLab执行启用及相关Bridge验收；不阻塞Identity/Course元数据。

WORKAROUND: Interactive/VirtualLab不执行，只保留opaque内容引用；iframe诊断先检查不可启动，正向协议诊断等待受支持候选。不要用放宽sandbox或同源HTML替代。

PRIORITY: P1（后续必要能力）。

## 为什么不是9项，且没有“修原生auth”条目

| 0A原U surface（9项） | 目标处理 |
|---|---|
| S05 Editor | slide editor PACKAGE_HOST_CANDIDATE；完整课程authoring未声称支持，非slide部分延期/依赖U01 |
| S06 Import/Materials | browser parser OPTIONAL；服务端Node parser DEFERRED，当前需求可不用，不申报必需扩展 |
| S11 Quiz/PBL runtime | storage与纯kernel可host；完整执行仍归U01 |
| S12 Interactive/iframe | 仍归U02 |
| S13 Agent/tools | native API DISABLED；AIServicePort受控生成有generation契约 |
| S14 Agent/Stage streaming | native streams DISABLED；未来智伴进度流由host控制，不强求上游agent撤权 |
| S15 Server Actions | NOT_EXPOSED；无已发现必需动作只能通过action调用 |
| S17 Public/published | 禁止作为业务授权；用智伴publication，无需改上游状态语义 |
| S19 Internal server/components/fetch | 不接入内部jobs/bootstrap；公开包执行所需能力 |

S10原BLOCKED不计入原9项：禁用原生HTTP Runtime，采用公开RuntimeStore候选，解决路径见architecture-review，不把原实现改判安全。

未列为必需backlog：Node PPTX解析、通用agent SDK、signed URL实时撤权、导出render正式service API。这些当前可关闭/延期；新增产品需求后重新立项，不以“未来可能”扩充上游阻塞数。不能通过删需求掩盖U01/U02，两者后续需求和恢复Gate仍明确保留。
