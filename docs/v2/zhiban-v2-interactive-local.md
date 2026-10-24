# P4 离线 HTML 互动宿主与发布（LOCAL）

2026-10-20，`refactor/zhiban-v2`，HEAD `daf63afa83470d24a9ed41d171c6a17f8a80adb6`。本包交付教师编辑／保存／显式发布、课程编排、课堂派发／进入及学生真实操作；仅用于本地 owned disposable PG16 候选，不代表生产部署、完整 Runtime 或可信学习完成签收。未提交、推送或运行 CI。

## 可见功能

课程资源新增“离线 HTML 互动”：教师可从内置欧姆定律示例创建草稿、编辑标题与源码、保存、发布和撤回。未保存内容使用现有课程离开保护，取消离开保留输入。学生只见已发布入口；学习中心不把互动错误导出为空白 PPTX／HTML。教师可把内容加入现有章节和课堂派发，学生“进入课堂任务”直接打开该固定 publicationId 的原生播放器。旧文本／PNG 编辑与播放继续使用旧策略。

运行复用 OpenMAIC 的 `App`、`InteractiveScene`、逻辑视口和 iframe/widget 宿主。只增加可选的受限 `sourceUrl`／`sandbox` 配置，原生离线导出默认 srcdoc 路径与默认 sandbox 不变。智伴不另造互动引擎，也没有开放原生 routes、agent 或模型入口。

首个启用类型是**单场景、自包含 HTML，最多 64 KiB**：内联样式、正常 `addEventListener` 脚本、DOM／SVG／canvas 和本地参数探索。拒绝外链属性、属性事件、图片／媒体、嵌套 frame、base、form、object、embed、link 和 meta refresh。动态请求同样由 CSP 阻断；不支持 CDN、npm、外部模型、任意 3D 依赖或多媒体。这些限制在编辑页明确显示；示例是真实运行的手写教学内容，不是模型成功夹具。互动状态仅保留于当前 iframe，重入／刷新重置，不作保存或作答承诺。

## 发布策略与数据链

新增独立策略 `content-interactive-offline-v1` 与[新增 migration](candidates/p4-interactive/0003-interactive.sql)，没有把 HTML 塞进旧 text／PNG 策略。资源表沿用历史 `SLIDE_CONTENT` 类别，具体内容合同由不可变 policy_version 区分；HTML 草稿具有封闭的额外 html 字段及一个空占位页，旧草稿解析器拒绝该结构。Native 文档实际为 `interactive` scene，不把 HTML 冒充 slide。独立 validator 校验精确 envelope、HTML 策略、scene 归属和摘要，公开 `PgDocumentStore` 完成不可变 Native 存取与读回证明。

继续使用原 Content 的 Identity 当前授权／关联成员检查、正常任教或 Enrollment、业务上下文锁、CAS、幂等 key、审计、Bridge PREPARE／dispatch／ACTIVATE、generation/scene digest 和 Native final check。新建／保存命令显式区分互动；现有 CREATE/SAVE/PUBLISH 审计与状态屏障保持，禁止旧 SAVE_CONTENT 修改互动。新策略不增加 Identity permission／角色或 Runtime 权限。

新增 SQL 仅用于新建 owned PG16：新 ledger、封闭 draft validator、policy CHECK 扩展；只给既有 Bridge 角色新增 validator EXECUTE 和 ledger SELECT；保留原 RLS 和表权限。三份旧 helper 的新增定义仅允许这个明确 policy，旧策略分支保持原逻辑。旧 migration 文件和冻结 Identity 文件未改。独立 PG16 参考见[expected profile](evidence/p4-interactive-profile-reference-local.json)，默认本地 issuer/loader 绑定 migration hash、ledger、精确 profile、源码、bundle 和真实 Native fingerprint。

普通 Content factory 的互动能力默认关闭；仅已核验这份独立 LOCAL receipt 的 owned 组合启用。原生产／维护 installer、Runtime foundation、终态处置／清旗等 deferred gates 不因本包而启用。

## 宿主与隔离

父播放器只携带受限 iframe URL，不把 HTML 注入父 DOM；子页 `frame?publication=UUID` 每次通过正常身份／课程授权、精确 ACTIVE 发布、Bridge generation 和 Native 摘要读取。父页也按原固定版本轮询授权：撤回、换版或撤权后卸载整个播放器及 iframe。保存新草稿不改变旧发布。课堂进入只记录进入；结束课堂任务不等于撤回仍可在课程中学习的发布内容。

frame 使用 `sandbox allow-scripts`，不允许 same-origin、表单、弹窗、下载、模态窗口或顶层导航。响应 CSP 再施加相同 sandbox，禁止 connect、图片、媒体、字体、子 frame、worker、object、表单和 base；只允许子页必要的 inline script/style，属性事件仍禁用。父页仅对互动版本允许本源 frame，旧 PPT／编辑页 CSP 不放宽。HTML 只存在于 opaque iframe，不能读取父 DOM、cookie／storage 或获取带凭据的宿主 fetch 能力。页面／frame 均 no-store，原生私有数据与凭据不交给 HTML。

这不是进程级资源沙箱，不宣称解决恶意死循环、生产 D01 或可信成绩来源。iframe 消息和本地数值不是学习完成证明；不创建 RuntimeSession、Attempt、成绩或完成事件。已经交付浏览器的内容无法离线撤回；可见页轮询及每次新请求重新检查，不能声称瞬时远程擦除。

## 本地验证与证据

`pnpm verify:zhiban:interactive` 只跑本包受影响旅程及授权／并发／故障边界。[LOCAL receipt](evidence/zhiban-interactive-local.json)、[journey](evidence/interactive/journey.json)记录真实 PG16、真实公开 Native provider 与受信 HTTPS 浏览器操作，没有模型调用或生成完成夹具。覆盖教师编辑／保存／发布及离开取消、目录与课堂直接进入、学生真实滑块变化、策略混用拒绝、CAS 并发、固定版本、撤回／换版／撤权停用、opaque DOM/cookie/storage 和 fetch 拒绝、伪完成消息不落库。

通过真实 Native INSERT 权限故障切点验证：dispatch 后写入失败仍为 OUTCOME_UNKNOWN；恢复 Native 权限不清除隔离，保存／重发发布保持拒绝，未通过 mock 假定提交回滚。现有只读对账／终态维护范围未扩展到新策略，互动 UNKNOWN 不自动解锁。新增闭合结构／HTML 输入单元检查、定向类型／lint 独立保存。不重复 AI、附件扫描、导出、基础全套或 GitHub 回归。

旧默认实例停止前另做[三库备份](evidence/interactive/before-backup.json)，只验证 dump TOC，未执行恢复演练。新默认实例为新合成课堂，不冒称恢复旧 run 或原教学数据。原模型／CI／Native PPT 证据仍只代表各自当时的策略、源码与范围。

## 默认 3461 与内置浏览器

默认 3461 已保持运行，`trial:zhiban:info` 显示源码匹配、漂移 0。已在内置浏览器用合成教师账号实际新建“欧姆定律互动：调节电压”、保存并显式发布，随后通过正常教师命令加入课程目录与共享课堂。切换正常学生账号，从“进入课堂任务”直达固定发布的原生宿主，将滑块从 12 调至 18，页面实际显示 `电流 I = 3.00 A`；标签页保留在可操作场景。

[演示引用](evidence/interactive/default-demo.json)、[教师发布截图](evidence/interactive/default-teacher.png)、[学生操作截图](evidence/interactive/default-student.png)和[当前三库备份](evidence/interactive/default-backup.json)单独记录本轮默认实例。备份只核验 TOC，未承诺恢复成功；用户密钥／密码不进入公共证据。[冻结源核对](evidence/interactive/frozen-source-check.json)证明旧 migration、Identity 文件及原闭合 Runtime／Bridge 核心未变。原生 App 的可选 URL／sandbox 宿主扩展另属本轮源码，不能把上一轮“原生文件未改”的证据扩大到本轮。

## 历史构建 receipt 事故

参考构建首次执行时，一处旧脚本输出分流遗漏，覆盖了未跟踪的 `zhiban-teacher-profile-build-local.json`。未找到原始 bytes，不能重造历史成功记录；该路径已改为明确失效说明。新输出独立保存在 [interactive profile build](evidence/p4-interactive-profile-build-local.json)，脚本已修正输出路径。[原固定教师参考](evidence/m5-png-profile-reference-teacher-local.json)和[原教师产品旅程](evidence/zhiban-teacher-scope-local.json)未改动，继续按自身范围使用；本轮不再把那份已失效的历史构建 receipt 当证据。

下一完整 P4 包是实际 Attempt 与可信 Runtime 事件／结果接线，先核对 frozen provider／数据完整性门禁及完成规则，不能直接信任 iframe 分数。复杂跨 Identity、并发与可信事件接线建议 GPT-6.1 Sol / high。
