# Phase 1B-0B Minimal Isolated Diagnostic Plan

Status: NOT RUN / REQUIRES SEPARATE AUTHORIZATION。
Gate: CAPABILITY-SPECIFIC ISOLATED DIAGNOSTIC GATE；不再是Identity Track总前置。
本轮只写计划，不创建harness、测试、DB、API或Adapter。0A结果不因本计划存在而升级。
目标Model B；10个诊断surface family，不复扫全部133个关闭入口。D01–D05为基础候选验证；D06–D07先做fail-closed负例，正向部分等待启用；D08–D10仅在相应目标能力进入验证范围时执行。Agent不在范围。

## 环境与fixture

经单独批准建立临时隔离host，使用固定基线公开exports，不import src/private helpers。独立PostgreSQL测试库/字节存储，真实non-owner/non-BYPASSRLS角色仅用于拟议智伴数据隔离验证；本计划不先行规定或创建schema。
两个Tenant A/B、学生SA/SB（各属一Tenant）、教师TA、Tenant Admin AA；另建同Tenant第二learner fixture以测同Tenant横向访问。测试Session/Actor均虚构，不能连接真实Identity或V1。
每Tenant两份fake Stage/Scene、asset、Attempt/runtime；重复display names、不同opaque ids；另有失效/孤儿/转移中的mapping。凭据仅隔离环境生成，无生产provider key、V1密码/数据/写入；AI使用确定性fake AICallFn。

harness只证明候选契约/拓扑，不能成为生产Bridge。动态授权中须具体列出允许临时路径、资源、cleanup、网络范围；本任务不授权创建。记录artifact版本、配置摘要、预期/实际状态与字节结果、权限上下文（脱敏）、trace和失败原因。不得记录secret/token。完成后按独立批准方式清理隔离fixture，不删除共享资源。

## 最小矩阵

| ID / surface | 诊断与攻击输入 | 必须结果 | 依赖/退出 |
|---|---|---|---|
| D01 Gateway bypass | 从浏览器侧访问目标host保留原生路径、非允许method、编码路径、Host转发；直接连storage/object endpoint；内部凭据伪造 | 无原生入口或网络拒绝；只允许显式Zhiban用例，不是通用reverse proxy | 使用目标路由清单与拓扑做代表性负例，不重新渗透全部关闭API |
| D02 Asset access | TA建资源，SA授权读、SB/AA越权；猜id/复制URL、range、redirect、缓存切Tenant、删除/撤权后重取；HTML/SVG及远程URL | 每次字节取回复核mapping；授权前无字节，错误不泄露存在性；禁止公有缓存和原始signed redirect；隔离active内容 | AssetStore公开后端+gateway候选，验证principal分区与Activity关联 |
| D03 Runtime identity | 请求自报x-learner-key/body session/stage/learner；SA读取SB及同Tenant他人；status/append/merge/admin；并发重试、transfer/revoke | 服务端构造learner handle，session-stage-attempt匹配；广域接口不可达；CAS/幂等符合契约，dev auth关闭 | 公开PgRuntimeStore +包装harness；不调用原生bootstrap |
| D04 Stage/document isolation | 猜id、list、batch、修订/删除、跨部署同id、mapping pending/orphan/race | 先业务授权再访问；无全局列表泄漏；CAS/授权版本复核；非原子失败默认不可读 | DocumentStore+Zhiban mapping候选；不把store当Tenant安全层 |
| D05 Classroom/playback | 仅授权slide preview；背景/audio/poster/富文本/图片/video全部请求路径；点击未知Scene/action | 非支持类型fail closed，无原生classroom跳转；资源仅gateway；不把预览验收当全Playback验收 | 完整engine正向场景须U01，另加时序、暂停恢复、多Scene记录验证 |
| D06 iframe | 当前候选任意HTML/iframe启动应拒绝；U02候选后测试兄弟frame、伪造source/origin/channel、过期instance、跨Scene消息、外连及撤权 | 关闭状态不执行；启用后不能提升parent权限，消息与资源重新绑定；客户端观察不作为可信成绩 | 正向诊断等待U02/人工批准；不能为测试导入内部iframe实现 |
| D07 stream | 当前关闭入口应不可达；未来host进度流在logout/角色撤销/Membership或Tenant停用后、断连重连、取消任务 | 关闭状态拒绝；启用后有已批准最大撤权延迟，停止输出和副作用、重连重新授权；不能仅断UI | 不测试原生Agent；fake cancellable task先验证host边界，真实provider取消能力以后补验 |
| D08 teacher editor | 学生伪造transaction/save；TA角色撤销后保存；粘贴外部asset/HTML、并发revision | 每次保存服务端授权、内容校验，asset映射合法；UI控件可见性无安全含义 | 仅独立editor公开包；完整course authoring不在scope |
| D09 controlled generation | 学生发起、跨Tenant上下文、prompt注入请求工具/secret、超预算、cancel、失败重试资源孤儿 | 服务端teacher用例授权，fake AICallFn无通用tools；输出不可信、asset受控、重试幂等/孤儿不可访问 | 不接真实provider；真实provider与付费调用须另授 |
| D10 optional browser import | 畸形/巨大PPTX、压缩膨胀、嵌入外链、upload失败、伪造解析结果；尝试Node entry import | 客户端parser无权限意义，服务端验证Slide/asset及限额；失败不发布部分内容；Node支持不能假定 | parser浏览器候选独立验证；不接旧内部XHR/DOM shim |

## 验收层级与Gate

1. Contract feasibility：dist公开入口可消费、无内部模块；package tests只是上游能力证据，不证明智伴安全。
2. Isolated boundary diagnostic：假身份/假mapping足以反证旁路，不能替代真实Session/RLS/生产基础设施验收。
3. Production integration verification：未来1B9及部署前用真实Application认证/授权、撤权、network/cache配置重复关键负例。

每项capability准备实现/开放前，执行其对应0B及关联边界检查（例如Runtime需D01/D03/D04，Asset需D01/D02及相关媒体路径）。不为开始Identity要求全量10组完成。D06/7正向、D08–10仅在对应能力进入scope时执行；关闭能力保持关闭。U01/U02所需契约仍未解决，不能通过省略诊断启用。ADR-012需明确人工接受，1B-9仍BLOCKED。

Runtime实施前重新验证package export、contract stability、trusted server learner binding、cross learner/tenant denial、Stage/Attempt binding、tenant mapping、revoke、persistence isolation及transaction/security behavior。PACKAGE_HOST_CANDIDATE不是IMPLEMENTATION APPROVED。Asset启用前必须Asset Diagnostic，raw/media/signed/generated URL不得成为默认公开面。

失败时停止启用受影响能力，保留证据、不改core、不放宽auth。Identity Schema按人工批准的新Gate，仅在1B-1/2及独立schema review通过后允许；OpenMAIC mapping不在其范围；无生产数据、无V1操作。最小集减小的是无用原生route测试，不削弱必须能力的安全负例。
