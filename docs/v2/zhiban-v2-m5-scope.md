# M5 内容与 Runtime 启用范围


当前产品接续（2026-10-14）：[M5-C PNG 本地闭环](zhiban-v2-m5-c-png.md)已在独立 disposable PG16/真实公开 provider/HTTPS UI 完成 LOCAL 验收。A/B历史成果保留；真实55433升级和完整启用签收未执行，D Runtime/E AI继续关闭。本次之后产品主线转向M6，维护输入/恢复候选保持独立待办。

后续实现状态（2026-10-09）：M5-A/B 本地 installer/技术 receipt 与文本编辑发布已 LOCAL_VERIFIED；[交付记录](zhiban-v2-m5-ab-local-closeout.md)给出当前应用/hash/实际产品证据与 deferred gates。本文其余“未执行/待实现”语句保留设计阶段时间范围，不能用来覆盖当前运行状态。
日期：2026-10-09（Asia/Shanghai）

STATUS: SCOPE_DEFINED / A_B_C_LOCAL_FUNCTIONS / DEPLOYMENT_AND_RUNTIME_AI_DEFERRED

基线：`refactor/zhiban-v2`，HEAD `daf63afa83470d24a9ed41d171c6a17f8a80adb6`；工作树保留 M1–M4 未提交候选。本轮只明确范围，不启用 capability、不更改冻结生产语义或已应用 migration、不提交/推送/派发 CI。

## 1. 首批交付边界

M5 首批交付 **教师手工编辑受控 slide 内容 → 保存草稿 → 预览 → 发布不可变版本 → 已选课学生查看 → 教师撤回**。复用真实 Course、Offering、任教关系与 Enrollment，接入已有 OpenMAIC Document/Scene/Asset Bridge。当前文字作答与人工评分保持自己的版本与来源关系。

首批可见页面包含教学班中的“教学内容”，教师编辑/预览/发布入口、学生内容列表与只读 slide 预览；旧分支课程介绍、资源列表、学习中心与内容设计器的通用需求纳入此范围。页面位置可沿现有工作台扩展，不承诺旧 URL 或组件实现兼容。原机电专用学习站点不复制进通用核心。

只启用 slide 类型。首个垂直切片使用有界纯文本；随后支持已登记 PNG 资源的上传、选择和受控显示。限制遵守既有 B9 关闭投影：纯文本、受限字段/几何、每 slide 最多 32 元素，不接受 HTML/脚本/任意 CSS 或 URL。不默认启用 editor 面板中所有工具；公开 editor 导出提供交互能力，保存权仍由服务端重新验证。

首批不引入新 Attempt 类型。预览不自动产生 Submission、评分、完成事件或学分；已有 TEXT_RESPONSE 的截止时间、重交和次数规则不改变。内容与作答之间如果需要强绑定新的活动类型，须先给出新的内容版本/Attempt 精确设计，不把 slide 浏览状态塞入 M3 提交模型。

## 2. 交付顺序与验收

| 工作包 | 具体交付 | 完成条件 |
| --- | --- | --- |
| M5-A 文本内容与业务接线 | 内容草稿、不可变发布版本、教学班目录、纯文本 slide 预览；真实 Activity/content facts 与权限动作设计 | 教师建内容、发布、学生查看、撤回在 LOCAL UI→API→PG/公开 provider 可用；草稿、其他租户/教学班和失效资格均不可读 |
| M5-B 受控 editor | 仅公开 `@openmaic/editor` 与 renderer exports；新增/删除/排序 slide、编辑纯文本及受限布局；草稿保存、版本冲突、发布前预览 | D08 定向诊断与接受完成，保存时重新授权及验证内容；未保存输入保留；并发修改 CAS；已发布内容不可原地覆盖 |
| M5-C PNG 资源与资源 security gate | 有界 PNG 上传、服务端 MIME/结构/尺寸/字节验证、已登记资源选择器、按发布版本引用、每次访问经资源 gateway | 私有字节与 native store 不可直达；跨主体/租户、过期版本和无引用资源拒绝；下载/缓存/中断与撤权边界通过；实际浏览器显示有 provider/source hash 证据 |
| M5-D Runtime 业务绑定与可行性门禁 | 精确绑定真实 Attempt、发布 generation、learner 与当前资格；逐操作确认公开 Runtime 契约、持久 fence 和恢复能力 | 先产出支持/阻塞表；只有有完整证明的操作才开放。若所需接口不足，记录具体支持契约需求并保留关闭，不提供假的成功状态 |
| M5-E 受控 authoring AI（后续条件交付） | 仅教师起草文本，人工采用到草稿；不自动发布/评分 | 单独完成 D09、真实 provider、预算/凭据/取消/结果采用时授权设计与明确启用授权；不属于首批必交能力 |

A 与 B 在实现中允许合并成一个真实页面交付，先完成首个文本旅程，再扩展 PNG，避免将每一步拆成反复 checkpoint。D 的可行性核验可先做，但其阻塞不妨碍独立内容功能交付。M5 首批 A–C 完成可标 `CONTENT_LOCAL_VERIFIED`；D/E 未完成时不能把整个 M5 或其 Runtime/AI 宣称完成。

2026-10-09：[M5-A/B 精确设计与 D08 检查](zhiban-v2-m5-ab-design.md)已产出，公开包/受限文本 host 的 LOCAL 7/7 通过，完整 D08 仍待真实保存/撤权/CAS 接线。

下一实际动作：**M5-A/B 未应用 SQL/helper/receipt inventory 后实现文本闭环**（[gate/ACL/CSP 评审](zhiban-v2-m5-enablement-review.md)已收敛，隔离 CSP 9/9），定向核对公开包 exports/artifact、文本编辑输出、业务 schema/权限目录、Bridge ready 条件和 localhost 客户端宿主方式，随后在已授权功能范围内实现首个文本内容旅程。不可用冻结合同之外的新权限或 gate 替换，先列出具体增量供审核；不以本范围文档声称 D08 或 persistence/ACL 已接受。

## 3. 内容发布与资源规则

- 课程元数据由 M2 管理员管理；内容编写/发布必须有当前任教关系与明确业务动作权限。管理员身份、隐藏按钮或 `MEMBERSHIP_READ` 不替代内容授权。内容权限目录、教师可编辑的资源范围须在 A/B 精确设计中落实。
- 草稿仅有权作者可见；学生只见本教学班当前可用的已发布版本。内容服务端版本与 OpenMAIC generation、RepositoryRevision 各自保存，不能混为一个 revision。
- 发布采用新 candidate/generation 和本地原子指针切换；失败保留旧版本，不暴露 pending/orphan 内容。发布后编辑形成新草稿，禁止修改已发布原生 document/asset bytes。
- 内容撤回、任教/Enrollment 撤销，以及 Session/User/Tenant/Membership/grant 变化作用于后续请求；有流式字节输出时落实冻结有界撤权检查。已下载到浏览器的字节不能声称远程收回。
- 首批资源仅 PNG；不允许学生作业附件、批量导入、外链抓取、SVG/XML/HTML、PDF/PPTX 导入、任意 MIME。WAV/WebM 虽有历史路由诊断，但实际解码/播放未由该证据认证，另做 capability 验收后扩展。
- resource refs 由服务端分配并绑定 exact tenant/generation/scene/purpose；浏览器不获 native credentials/store/byte origin。既有上限（单项 4 MiB、candidate 聚合 32 MiB、10 秒昂贵操作期限等）继续适用；PNG 像素/解码内存界限在 C 的精确设计中明确，不由压缩字节大小替代。
- 未批准物理清理前保留历史/tombstone；撤回不是删除字节。不得增加 request-time collector、自动 owner 修复或失败后盲目重放。

## 4. Runtime 具体边界

当前 [Runtime root](../../lib/zhiban/infrastructure/openmaic/runtime/root.ts) 仍固定 DENIED；[Bridge facts](../../lib/zhiban/application/openmaic/bridge.ts) 仍 UNAVAILABLE。M1–M4 已有真实业务表，不代表这两处已经接线，也不代表可把冻结 FALSE gate 改成常量 TRUE。

M5-D 按 [C9 冻结设计](phase1/phase1b-9c-runtime-ai-design.md) 与[精确 schema/ACL 补充](phase1/phase1b-9c-schema-acl-design.md) 逐项处理：

| 项目 | 本轮范围决定 |
| --- | --- |
| 内容入口 dispatch | 可在 A–C 开放已接受 slide 预览；标明预览能力，不暴露原生课堂 URL |
| Runtime binding、真实 facts、独立 ACL/host | D 的必需设计与接线；不能复用 M3 文本 Attempt 冒充已经运行的课堂 |
| create/getSession | 候选最小操作，需 exact binding、返回校验、原生提交前授权/期限、跨库 outcome/fence 和隔离证明；本轮范围定义不等于启用许可 |
| append、terminal status | 依赖 scalar/JSON 一致性的路径仍 `BLOCKED_PENDING_SUPPORTED_INTEGRITY_PROOF`；不得写私有 SQL、回写修复或 patch 包来绕过 |
| listRecords / append reconciliation | 必须有受支持的有界读取、完整 writer 约束和 exact outcome 证明；没有即保持关闭，不全量读取后切片、不超时后自动重试 |
| 成绩、进度、完成 | Runtime chat/日志不是可信作答、成绩或完成事件；M4 人工成绩不从其推断，completion 仍待教学规则与可信证据合同 |
| 完整课堂/多 scene 播放、Quiz/PBL/whiteboard | U01 公开 host 契约待完成，属于 M7 与相应门禁；不从 native 内部复制 |
| iframe/Interactive/VirtualLab | U02 正向执行待公开 host/资源/消息隔离契约，继续关闭；机电实现不进入通用核心 |

若 D 的最小生命周期仍被支持契约阻塞，交付支持缺口和精确 upstream/公开 API 需求；此时 Runtime 正向执行仍未完成。不会因此取消旧分支的完整课堂/互动需求，也不会为做出界面将其提前移入已验收范围。

## 5. Integrated Identity / enabled Bridge security gate

门禁随能力分两次实际签收，明确结束条件：

1. **内容/Asset gate：A–C 完成时**，以真实 Course/Offering/内容发布版本、任教/Enrollment、公开 Document/Asset provider 与 UI 验证 Session/角色/关系撤销、跨租户/同租户横向访问、版本切换、并发发布、幂等/unknown outcome，以及私有 native/字节入口隔离。M1–M4 和历史 B9 PASS 只是依赖证据，不能替代此次 enabled 业务证明。
2. **Runtime gate：D 的操作实际开放前**，增加真实 Attempt/generation/learner 绑定、操作 reservation/fence、原生提交前检查、崩溃恢复/不可证明 outcome 保持隔离、过期资格与流式撤权；必要支持契约没有接受之前保持未完成。

通过内容 gate 不能标全量 `1B-10` 或 `PHASE_1B_COMPLETE`。生产网络/密钥/备份与 OPS、实际 release manifest、真实数据迁移仍分别验收。若 release 明确要求 U01/U02 或真实 AI，不能以首批 slide 内容交付替代。

## 6. 本地验证与证据策略

只跑本次能力的真实 UI/API/PG/provider 正向旅程和必要失败/竞态；并发锁用独立连接与可确认 barrier。改共享身份/安全组合时补相关回归，普通内容改动不重复跑全套基础测试。OpenMAIC artifact 首次消费须确认固定 source、lock、版本、exports 和 hash；不以现有忽略 dist 的存在当来源证明。

独立开发 PG16 `55433/zhiban_m1_dev` 保留 M1–M4 数据；涉及 native Document/Asset/Runtime 的验证另有独立 disposable 资源及清理 receipt，现有 native harness 的 GitHub 限定需补最小明确 LOCAL 模式，不能伪造 GITHUB_ACTIONS、借用开发库或扩大 55432 fixture 生命周期。开发 native 持久存储也须独立于 disposable 资源，并在接线前定义具体拓扑。

LOCAL 证据记录实际启用能力、源/hash、角色 ACL、数据库/host、结果及未覆盖范围；已有 C9 run/SHA 和 Storage 证据保留历史适用范围。文档范围定义不运行 PG、package build 或 GitHub CI。本轮不调用真实 AI、不部署生产、不迁移 V1 数据。

建议下一实现阶段使用 GPT-6.1 Sol、medium；精确权限/事务门禁评审提高到 high。模型建议不改变实现授权、冻结合同或验收条件。

## 7. 依据

- [功能交付计划](zhiban-v2-delivery-plan.md)、[旧分支逐页保留审计](zhiban-v2-v1-page-retention-audit.md)、[M4 交付](zhiban-v2-m4-assessment.md)。
- [公开包 capability review](phase1/phase1b-0b-a-capability-review.md)、[ADR-013 私有运行边界](adr/ADR-013-openmaic-private-runtime-boundary.md)、[ADR-014 Package Host](adr/ADR-014-openmaic-package-host-strategy.md)。
- [B9 Bridge 冻结设计](phase1/phase1b-9a-bridge-design.md)、[B9 foundation 验收](phase1/phase1b-9b-review.md)、[C9 Runtime 冻结设计](phase1/phase1b-9c-runtime-ai-design.md)、[C9 精确补充](phase1/phase1b-9c-schema-acl-design.md)。
