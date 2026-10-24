# M5-A/B 文本内容编辑闭环精确设计与 D08 检查


后续实现状态（2026-10-09）：M5-A/B 本地 installer/技术 receipt 与文本编辑发布已 LOCAL_VERIFIED；[交付记录](zhiban-v2-m5-ab-local-closeout.md)给出当前应用/hash/实际产品证据与 deferred gates。本文其余“未执行/待实现”语句保留设计阶段时间范围，不能用来覆盖当前运行状态。
日期：2026-10-09（Asia/Shanghai）

STATUS: DESIGN_CANDIDATE / D08_INTEGRATED_ACCEPTANCE_PENDING

本轮授权为精确设计与 D08 检查。基线 `refactor/zhiban-v2` / `daf63afa83470d24a9ed41d171c6a17f8a80adb6`；M1–M4 未提交候选保留。下述 schema/API/业务权限为实现候选，不表示已建表、开放 Bridge 或修改冻结合同。首批范围见 [M5 范围](zhiban-v2-m5-scope.md)。

## 1. 设计决定

交付一个教学班内的文本教学内容：教师创建、编辑 slide 草稿、预览、保存、发布/撤回；学生按当前 Enrollment 查看该教学班已发布内容。保存与发布显式分开。新内容采用独立 `SLIDE_CONTENT` 资源，不修改 M3 `TEXT_RESPONSE` Activity/Attempt/Submission 与 M4 成绩来源。

实现采用公开 `@openmaic/editor/core` 的 transaction/history 和 `@openmaic/renderer` 的 SlideCanvas。宿主提供纯文本 textarea、slide 列表、文本框增删/排序与几何控件。首轮不直接装载默认 `/ui` 工具栏或 `/react` 富文本编辑面板：其文本含 HTML，`insertItems=['text']` 仅控制按钮可见性，也不能封禁粘贴/已有元素的其他类型。用户编辑结果先经本地受限验证，再采用到 controlled state；服务端再完整验证一次。

第一轮文本框采用固定字体/颜色、白色背景、16:9 画布，不支持富文本、链接、动画、shape/chart/table、音视频、资源引用、自动排版或导出。采用公开 core 的操作不会自动赋予保存权限，也不会由 transaction 的 origin 决定调用者身份。

## 2. 精确内容 DTO 与上限

草稿 DTO：`{title, slides:[{id, elements:[{id,text,x,y,width,height}]}]}`。所有层级只接受列明键；拒绝多余字段、原型污染键、错误类型及非有限数。`id` 为 UUIDv7 的本地结构标识，在本资源内唯一，不是 native Stage/Scene/Asset ref 或权限凭证；服务端另分配 Bridge refs，不使用客户端 ID 作为 native handle。

| 字段/限制 | 候选值与含义 |
| --- | --- |
| title | trim 后原样相等、1–120 UTF-16 code units，无控制字符 |
| slides | 1–32 张，按数组顺序排列，slide ID 全资源唯一 |
| elements | 每张 0–32 个纯文本框；发布至少有一个非空白文本框 |
| text | 最多 2000 UTF-16 code units，well-formed Unicode，允许换行/tab；拒绝 `<`、`>`、`&`、NUL 与其余控制字符，不做 HTML 解码或静默清洗 |
| 画布 | 固定 960×540；server projection 固定 `viewportSize=960`、`viewportRatio=0.5625` |
| 几何 | 有限整数；x/y≥0，width/height≥1，x+width≤960、y+height≤540；rotate 固定 0 |
| 样式 | server 固定 sans-serif、`#111111`、白色背景/theme；不接受任何调用者 CSS、font、theme 或 URL |
| 总体积 | UTF-8 JSON request ≤256 KiB；验证前有界读取/解码，拒绝压缩 Content-Encoding；完整 native document 与读取投影仍受 B9 4 MiB 上限 |
| revision | 内容 CAS 使用 canonical positive signed-int8 十进制字符串，BigInt 校验，最大值 fail-closed；Bridge RepositoryRevision 独立保存，不能用 M3 的字段格式代替 |

这些是本轮待落实的产品/资源预算，不覆盖 frozen B9 上限，不提高现有限额；未来扩展通过新 policy version。A/B 不接受 PNG/任意 AssetRef，M5-C 另给资源 DTO/验证设计。

客户端生成的新结构 ID 在服务端仅被当作当前完整 DTO 的局部标识。不存在跨资源“按元素 ID 更新”权限；整个保存都绑定 path 中的 resource 与当前教师范围。若 id 复用导致本资源内重复，保存拒绝，不尝试跨资源查找/合并。

## 3. 持久化候选与职责

新增 `zhiban_content` schema，logical migration `0001_content`（[未应用候选](zhiban-v2-m5-sql-inventory.md)按 01/02/03 分组件，仅位于 docs 候选目录），与 Academic/Identity 位于相同业务数据库。native Document 数据位于单独私有 OpenMAIC 数据库。Zhiban 只保存草稿 authoring DTO、发布指针/元数据及关系；学生正文经受控 Document/Scene Bridge 读取，不绕过 Bridge 从草稿投影给学生。

| 表 | 精确候选列/约束 |
| --- | --- |
| resources | `tenant_id uuid, id uuid, offering_id uuid, kind='SLIDE_CONTENT', policy_version='content-text-v1', title text, draft jsonb, state DRAFT/PUBLISHED/WITHDRAWN, revision bigint, active_publication_id uuid NULL, last_publication_no integer≥0, created_by uuid, updated_by uuid, created_at bigint, updated_at bigint`；PK `(tenant_id,id)`，UNIQUE `(tenant_id,id,offering_id)`，同租户 Offering/Membership FK；draft 的受限结构/长度及 revision/timestamp 有 SQL 防线 |
| publications | `tenant_id,id,resource_id,offering_id,publication_no,source_revision,bridge_slot_id,bridge_generation_id,prepare_operation_id,activation_operation_id,title,content_digest,policy_version,published_by,published_at`；PK `(tenant_id,id)`，UNIQUE `(tenant_id,resource_id,publication_no)`、`(tenant_id,id,resource_id)`；资源/Offering 复合 FK、同租户 Bridge generation/slot 的现有键及发布者 FK；immutable，不保存一份可直接对学生返回的全文 |
| operations | `tenant_id,id,resource_id,actor_id,action,key_digest,intent_digest,state,source_revision,source_digest,expected_native_digest NULL,prepare_operation_id NULL,bridge_operation_id NULL,result_publication_id NULL,result_revision NULL,created_at,completed_at NULL`；命令键空间按 tenant+actor+resource，唯一；closed state RESERVED/SUCCEEDED/FAILED/OUTCOME_UNKNOWN，result/terminal timestamp 条件约束；无 DELETE/物理清理 |
| audit_events | `tenant_id,id,resource_id,operation_id,actor_id,event_type,revision_before,revision_after,occurred_at`；不可变闭合枚举，不记录正文、原生 credentials、Session digest 或任意 JSON |

resource.active_publication 与 state、publication 源 resource 的一致性使用 tenant-composite FK 和 deferred consistency guard。首次创建 revision=1；每次真实本地状态修改 CAS +1，真正 no-op 不增加，但先拒绝 stale。编辑已发布资源更新 draft/title/revision，保持原 active_publication 指针；学生使用 publication.title 与 native generation，直到显式新发布。撤回保留 active_publication 历史指针并禁止学生读取，不能删除 native bytes。

2026-10-09 SQL 候选补充：prepare 与 activation 分别绑定，SQL jsonb 源摘要与 Native digest 分开，未结算 publish fence、单调 Bridge 引用登记、COMMAND_NOOP 和 CREATE-only NULL resource 入口见 [SQL 清单第 2 节](zhiban-v2-m5-sql-inventory.md)。这是待评审的候选细化，未应用、不改冻结生产 migration。

FORCE RLS 与 `current_tenant_id()` 同租户策略；PUBLIC 撤权。2026-10-09 [启用增量评审](zhiban-v2-m5-enablement-review.md)收敛为同一本地 `zhiban_bridge_runtime` 客户端，取消新 content LOGIN role 的候选；新 content 表仅授明确 DML 列，Academic 父关系由 owner 的闭合 lock helper 与只锁不写 RLS 取得。Identity helper 的 session_user 限定和投影不变。内容/Bridge 发布指针及审计在同客户端结算，不复用 Academic 多连接组合。具体 gate/ACL、owner 与新 receipt profile 以该评审为准，未应用 SQL，不标已实现。

## 4. 权限目录与实时关系

独立版本 `content-v1`：动作 `CONTENT_CREATE`、`CONTENT_EDIT`、`CONTENT_PREVIEW_DRAFT`、`CONTENT_PUBLISH`、`CONTENT_WITHDRAW`、`CONTENT_READ_PUBLISHED`。由服务器闭合映射到资源动作，不接受浏览器 action/granted/scope/owner 声明。不得把这些动作插入或改写 frozen `identity-v1` 的 Membership/Credential 权限语义。

- 教师编辑/预览/发布/撤回：一个有效 TEACHER grant 同时覆盖该 Course/Offering；scope 解释复用已冻结的 Academic 规则，再要求当前有效 TeachingAssignment。不能把两条 grant 的 permission/scope 拼接。共任教教师可编辑同教学班内容，created_by 是审计字段，不是隐式永久所有权。
- 学生读取：当前有效 STUDENT SELF grant、当前 Enrollment、资源属于本 Offering、可用发布版本。教师读取已发布内容同样要求当前任教关系。管理员身份不自动提供编辑或读取正文权。
- Course ARCHIVED 拒绝业务访问；Offering CLOSED 允许现有资格读取已发布历史，拒绝新建/编辑/发布；withdraw 在有效任教授权下可关闭旧资源。资源转班/跨租户/所有权转移本轮不开放。
- Session/User/Tenant/Membership/有效 grant 由现有私有 guard 在同一客户端事务内核验/锁定。锁参加者必须与真实撤权写入路径冲突；不能以异步角色快照、浏览器状态或新互斥量替代。

## 5. API 与错误契约

路径候选：

| method/path | 返回/输入 |
| --- | --- |
| GET `/api/zhiban/content/:tenant/offerings/:offering` | 教师本班资源摘要含 draft 标识/CAS revision；学生仅已发布摘要，无 draft/title 泄露；列表有界分页，不静默截断 |
| GET `…/resources/:resource` | 教师经授权草稿 DTO + 独立 publication 元数据；学生仅当前已发布元数据，不返回 native refs |
| GET `…/resources/:resource/preview?source=draft` | 仅教师，受限投影，纯本地 authoring preview；不会获得 native published 权限 |
| GET `…/resources/:resource/preview?source=published` | 当前授权、准确 publication/generation，经 Bridge 重建受限 slide 投影；拒绝 pending、withdrawn、orphan、foreign refs |
| POST `…/commands` | 严格命令字段，Origin/CSRF、Session、`x-zhiban-command`；仅服务端执行 use case |

命令：

- `CREATE_CONTENT {title}`：服务器分配 resource ID 与初始单张空 slide，返回 id/revision/DTO。
- `SAVE_CONTENT {id,revision,title,slides}`：整份闭合草稿 snapshot；客户端 public core transaction 不直接传到服务端。
- `PUBLISH_CONTENT {id,revision}`：发布保存过的精确 source_revision；不存在“顺便保存并发布”。
- `WITHDRAW_CONTENT {id,revision}`：关闭后续学生读取，保留历史与 native 数据。

请求不包含 tenant/actor/owner/native endpoint/StageRef/AssetRef、provider 配置或任意 editor transaction。idempotency key 16–80 `[A-Za-z0-9_-]`，服务端存 key digest 与 canonical 意图 digest。replay 先重新检查当前身份/关系，不复用旧 ALLOW。失败不返回外部句柄/部分内容。400 INVALID_INPUT，401 UNAUTHENTICATED，403 FORBIDDEN，409 CONFLICT/INVALID_STATE/OUTCOME_UNKNOWN，413 TOO_LARGE，503 UNAVAILABLE；不把未知外部结果写成重试成功。

保存锁顺序与 Academic/M3 一致：guard → Offering → Course → assignment/enrollment → resource → operation；所有读到的源版本及 publication pointer 均在服务端解析。publication 等不可变表不加需要 UPDATE 权限的 row lock。

## 6. 发布事务与 Bridge 接线

1. 本地事务：当前 teacher authority、Offering OPEN、草稿发布有效性、content CAS；按 frozen Bridge 协议预留具体 generation/operation，与 source_revision/content digest 关联，提交保留事实。没有可靠 facts/ready/native receipt 即拒绝，不能降级本地假发布。
2. 重新锁定相同身份/业务资源/operation，读到最新草稿 revision；发生编辑/撤权或过期则拒绝 dispatch。本地 guard 只跨有界 native 存储调用持有，不涉及网络 AI。
3. 原生写用独立新连接/事务与正式公开 DocumentStore API。写入未发布候选，回读校验公有返回与 closed content、服务器分配 refs、policy/source/package stamps，原生 COMMIT 前再检查授权/期限。失败回滚；native 未知结果不盲目重放。
4. 本地事务原子结算 Bridge generation/pointer、content publication/pointer、operation 与 audit；保证学生只能读到 complete active generation。source_revision 在发布窗口变化时不激活旧草稿。新增 deferred link guard 确保业务指针与 Bridge 指针一致。
5. 跨库不是 ACID。原生提交后本地失败保留 pending/orphan/unknown operation；只有支持的 exact read-only outcome 检查后才能授权结算，不自动删除、修复 owner 或宣称失败即无副作用。

现有 `business_resource_ready(tenant,activity)` 是 FALSE，现有生产 root 必须验证 FALSE，facts loader 固定 UNAVAILABLE。这是 A/B 接线的真实缺口，不能只补页面或替换一个 injected boolean。

**启用增量候选（未执行）：**独立新 migration 定义 `SLIDE_CONTENT` 的同租户真实资源判定并有明确 catalog/ACL；若需替换现有 ready 函数体，属于受审核的 gate 启用变更，必须提交具体 SQL 与影响，不编辑已应用 0012/0013 文件。旧 foundation root 的关闭语义保留，另有 server-owned enabled content composition 消费真实 facts/receipt，不接受 caller 提供的 store/facts/权限布尔值或环境开关。旧 TEXT_RESPONSE、Runtime、AI 与无业务事实仍 FALSE/DENIED。这一精确 gate/ACL 增量尚未审核接受，因此本轮不生成或应用 SQL、不开启 provider。

## 7. 页面与 localhost host

教学班内新增“教学内容”区：资源列表与发布状态；教师编辑区提供 slide 增删/上下移动、文本框增删/层级、文本 textarea 与有界 x/y/width/height 输入；公开 core history 负责本地 undo/redo。明确显示“未保存”“评分/完成不由预览产生”；保存成功才更新服务器 revision，冲突保留用户输入并提示重新读取/比较，不静默覆盖。

已发布内容与草稿预览入口分开；学生页面无编辑表单，页面刷新再次授权。撤回/资格失效时当前请求拒绝并停止后续读取。单张 slide 采用公开 renderer；多张由宿主列表/翻页选择，不能称为 U01 完整课堂播放器。

沿用独立 localhost HTTPS host，浏览器 bundle 仅消费固定公开 exports，不挂原生 routes/server actions。[CSP 增量评审](zhiban-v2-m5-enablement-review.md)已修正原先广泛放宽 inline style 的候选：renderer 固定 style element 与空 style 初始化使用两项 verified hash，`style-src-attr 'none'` 仍禁止原始 style 属性；CSSOM 几何在隔离 Chromium 中可工作。专属 editor/preview HTML 的 connect-self 仅供实际 API，登录/工作台/错误页保持原策略。原源码不能直接证明“必须 unsafe-inline”；产品 HTTPS、receipt/profile 与真实 API 仍待集成验证。

## 8. D08 检查与证据边界

本轮执行脚本：[diagnose-d08.mts](../../scripts/zhiban-local/diagnose-d08.mts)，浏览器入口：[d08-browser-entry.tsx](../../scripts/zhiban-local/d08-browser-entry.tsx)。脚本仅在 exact mkdtemp 目录复制与 HEAD 字节相等的 DSL/renderer/editor 源码，隔离构建 fresh dist，通过真实公开 export 导入；复用当前已安装依赖并记录 lock hash，不声称重新 frozen install。循环仅构建这三个包，不运行全仓库/CI，不接 PG 或账号。

检查项目：新鲜 artifact、公有 core 的受控事务与输入不变、undo/redo、foreign element 拒绝、HTML 被 core 接受的缺口、浏览器 core+renderer 文本显示、宿主在采用状态前拒绝 HTML/外链元素/超限文本并无外部请求。入口 uses pure textarea，不声称默认完整 `/react` 或 `/ui` 富文本面板安全。

**本轮 7/7 包与隔离浏览器检查通过。**结果以 [LOCAL 证据](evidence/m5-d08-local.json) 的实际通过数、source/artifact hash、Node/pnpm/lock 与未覆盖项为准。fixture 仅证明包/纯文本 host 可行性；核心允许 HTML 的探针是限制事实，不能标“安全净化通过”。

| D08 要求 | 当前事实 / 后续必验 |
| --- | --- |
| 独立 editor 公开包可消费、文本操作 | 7/7 LOCAL 包/浏览器检查通过，具体 source/artifact 指纹见 receipt |
| 粘贴外部 asset/HTML | 首轮不使用包富文本/clipboard，宿主拒绝非法文本；不宣称整个上游 editor 已禁用粘贴面 |
| 学生伪造保存/事务 | 内容 API 尚未实现，NOT_RUN；实现后必须用真实学生 Session POST 证明 403，无落库/provider 调用 |
| 任教/role/Session 撤销后保存 | NOT_RUN；真实 Identity/Academic guard 与独立连接 barrier 测试，覆盖等锁后重新检查 |
| 并发 revision | 上游 undo/history 不是服务端 CAS；NOT_RUN，需真实 PG 两连接保存/发布竞态与无部分审计证明 |
| 跨租户/教学班、unknown refs | NOT_RUN；真实 schema/RLS、closed DTO 与 provider boundary 必验 |
| 当前 localhost React/CSP/build | NOT_RUN；隔离 HTTP host 不当作 HTTPS 产品交付 |

**D08 verdict：PACKAGE_AND_PLAINTEXT_HOST_PASS / INTEGRATED_ACCEPTANCE_PENDING。**不能因纯函数或隔离浏览器 PASS 宣称教师保存授权、Bridge 发布或生产隔离已验收；也不为了本次设计任务提前实现一套模拟认证/PG persistence 冒充真实接线。

## 9. 下一步与交付门槛

Bridge gate/发布协调 ACL/局部 CSP 已完成[设计增量评审](zhiban-v2-m5-enablement-review.md)，下一步形成未应用的 SQL/helper/receipt inventory；随后实现 M5-A/B 一条文本闭环并补齐真实 D08 保存/撤权/CAS 验证。M5-C PNG 与 M5-D Runtime 不搭车启用。保留 NO COMMIT / NO PUSH / NO CI DISPATCH；本地证据足够时不重复 GitHub 验证。

建议实现使用 GPT-6.1 Sol、medium；本次 gate/ACL/并发设计评审建议 high。
