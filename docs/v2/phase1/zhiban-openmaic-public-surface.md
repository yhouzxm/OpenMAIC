# Zhiban / OpenMAIC Public Surface

Status: PUBLIC BOUNDARY ACCEPTED FOR ARCHITECTURE；具体Port/launch实现仍待review与capability-specific 0B。当前仓库原生route并未被关闭或改造。Gate以phase1b-gate-map.md为准；ADR-012仍PROPOSED。
固定基线与证据编号见openmaic-integration-architecture-review.md。

## 唯一公开边界

Browser → Zhiban page/API → Authentication → Tenant/Membership/Policy → Application → mapping → package Adapter → private storage/provider。

公开面只允许智伴页面、明确用例API、每次重新授权的resource proxy，以及将来经批准的短时launch handle。不是把原生URL简单改前缀；不提供任意upstream path、HTTP method、owner、learnerKey或URL的透传代理。

默认无例外：浏览器不可访问原生persistence、runtime、agent、raw asset、editor mutation、dev auth、server actions、原生classroom页面；也不可访问对象存储endpoint。Renderer/editor的客户端JS是智伴UI依赖，不是向浏览器开放OpenMAIC服务。可选fonts.css含外部字体URL，默认不引入；使用系统字体或经许可的自托管字体，不为它修改上游core。

MODEL B不要求另起OpenMAIC Web进程。REQUIRED的是私有能力与字节边界，不是某个服务器数量。如果未来另起原生进程或render服务，必须无浏览器可达入口且具备内部调用认证；不可因“内网”取消Application授权。当前仓库未实施路由隔离，因此不能宣布当前部署已满足目标。

## 信任与资源协议

- 客户端只能给业务Activity/Attempt/resource选择参数；即便提交TenantId也只作选择提示，服务端重新验证Membership。
- 每次操作从可信Session取Actor，校验User/Tenant/Membership/权限状态，再解析Zhiban-owned mapping。禁止直接把UserId当OpenMAIC owner、MembershipId当learnerKey。
- mapping保存deploymentRef + opaque StageRef/ownerHandle/runtimeHandle/asset handle及状态；生命周期是Zhiban-owned，不给OpenMAIC表加tenant_id或role。
- Asset principal选用服务端mapping定位的资源分区handle，不能直接采用“请求者UserId”。学生获准读取教师活动时，以被授权活动资产分区读取；同一分区不代表所有asset都可读，仍逐项校验Activity关联与动作。禁止全站shared principal。
- Runtime服务端绑定Attempt、Stage、learner handle；客户端不能指定其他session/learner。PgRuntimeStore本身是存储，不是RBAC；getSession等id操作必须在包装用例中复核mapping，mergeLearner/deleteAllRuntime等广域操作不公开。
- DocumentStore没有Tenant策略；list先查询智伴可访问资源清单，不从全部OpenMAIC文档再让客户端过滤。write/delete/revision冲突也在服务端控制。
- create采用pending mapping→资源创建→激活；失败留下不可读pending，幂等重试与后台reconcile；禁止用跨库事务幻想掩盖失败。TRANSFER/REVOKE/DISABLE先关闭mapping能力，校验版本，后续补偿；DELETE拒绝新访问但不承诺即时抹除已有下载；ORPHAN不可访问。未设计schema。
- publication仅Zhiban publication + enrollment/access policy决定；上游public/published不能赋予任何业务权限。

## Asset方案比较

| 方案 | 评价 |
|---|---|
| A 私有原生asset endpoint + authenticated proxy | 网络能挡直接入口，但原生shared principal、内部URL语义、缓存与删除联动仍由proxy补齐；可做迁移候选，不优先。 |
| B Zhiban resource gateway + exported AssetStore | 推荐候选。公开PgAssetStore/AssetPrincipal可由服务端可信构造，不需要原生shared principal。使用字节读取而非公开signed redirect；Application承担Tenant/Activity策略。 |
| C signed short-lived URL | 当前签名URL是持有者能力，生成后不再检查Membership/Tenant撤权，不能当完整授权。拒绝作为私有教学资源默认交付。 |

gateway须控制content-type、nosniff、下载名、大小与range、缓存策略和错误统一；默认私有/no-store，禁止继承原生public immutable缓存。若优化缓存，键含tenant/resource/version/权限相关维度并测试撤权；不得共享授权响应。重定向及外部生成URL禁止直接透出，受控抓取需防SSRF、限流、大小限制、内容验证；无安全抓取即拒绝。

Renderer媒体slots不覆盖所有URL位置；DSL媒体槽、背景、audio、poster、富文本链接及CSS要完整清点。只处理renderImage/renderVideo不足。任意HTML不得同源inline；不将SVG/HTML放宽成普通inline asset。已交付字节无法通过logout远程收回，应明确威胁边界。

## Ports职责（仅设计，ADR-002不改）

| Port | Application所需能力 | 基础设施实现候选 | 不负责什么 |
|---|---|---|---|
| ClassroomPort | 活动启动/结束与课堂能力编排 | slide基础路径用Document/Runtime ports组合；完整执行等待U01 | 不认证、不实现RBAC、不返回内部store |
| ScenePort | 授权后内容读取/受控修订 | DSL + DocumentStore | 不自行信任StageId、不做Tenant成员管理 |
| ActivityRuntimePort | Attempt范围运行记录与状态 | RuntimeStore + PgRuntimeStore | 不公开原生learner身份、全局merge/admin |
| InteractiveRuntimePort | 受限互动启动与可验证事件桥接 | U02解决前关闭；只能声明Port | 不运行无隔离HTML、不把客户端事件当成绩 |
| AssetPort | 按授权资源能力读写/解析字节 | AssetStore公开接口 | 不决定课程Enrollment，不发长期bearer |
| AIServicePort | 教师受控内容生成等明确用例 | generation +服务端AICallFn/provider | 不暴露通用agent工具和任意provider配置 |
| OpenMAICResourceAccessPort | 授权结果到mapping/launch上下文的协调、能力限制与失效 | 智伴侧mapping与短时上下文 | 不兼任文档CRUD、字节仓库、AI运行、Session登录或最终Policy |

Policy由Domain表达，由Application执行；coordination port只能消费已验证上下文并核对mapping，不把授权职责藏在万能Adapter中。Host上下文与OpenMAIC DTO仅在Infrastructure/UI适配边界；Domain无React/Next/Zustand/OpenMAIC类型。新Port职责细化须review，不修改历史ADR。

## UI与后台

教师authoring提交内容必须再次授权与校验；隐藏editor工具栏不构成安全边界。学生只读预览也须资源mapping授权。后台任务不可绕过策略：以固定受限服务身份执行明确租户作业，重新验证任务授权版本；不调用原生internal server fetch。stream如启用，需每次连接与重连检查、定期/事件驱动撤权、停止副作用，不能只关闭前端显示。
