# OpenMAIC Network Boundary — 1B-0A

Status: PROPOSED CANDIDATES ONLY。没有 ACCEPTED DEPLOYMENT，没有执行部署或网络探测。
源码/文档冻结：700a7673becf0518bc6f8b2861229ee985c5d063；OpenMAIC基线4d2e2bab82374ed45b95964a1f2ed03362666e1c。
UPSTREAM FIRST / ADAPTER BASED / DOMAIN DRIVEN / MIGRATION SAFE保持不变。

## 三种拓扑

| 维度 | A 同一Next应用且浏览器可达原始routes | B 公开Zhiban Gateway，原始OpenMAIC只私网 | C 独立OpenMAIC服务，只server-to-server |
|---|---|---|---|
| Stage read/write | mapping检查可被原始capability read绕过；write虽有owner也无Zhiban Policy | 原始页面/API/Server Action都须deny，不只是/api/stages；gateway逐资源授权 | 服务监听/防火墙/服务身份可集中控制；同样需逐资源policy |
| Asset | shared读取绕过tenant；public文件缓存 | 所有bytes经受控代理；阻断原始asset、classroom-media、对象桶公开入口 | 宿主可选公开AssetStore contract；不能改OpenMAIC表tenant_id |
| Runtime identity | public dev token+x-learner-key不可信 | 私网不解决生产dev auth门；禁止启用insecure | 可评审独立可信package handler，但应用bootstrap接入尚待证明；不等于已实现 |
| Agent | 匿名用户能开authoring session | 只许获权authoring用例调用；映射私有owner handle；禁止学生借用教师cookie | 服务边界更清晰，但当前无稳定authenticated owner/tool policy injection |
| Stream | 建立时没有Zhiban角色；页面隐藏无效 | 每次建立/reconnect授权，撤权时终止转发；worker取消另需证明 | 可独立管理连接，后台lease不是Membership授权 |
| iframe | same app页面会发原始资源请求 | 宿主页、src/srcDoc、外链资源、redirect、popup必须纳入边界；sandbox不是网络防火墙 | 独立origin有助隔离，但frame resource重写/受控出口兼容性需0B |
| Download/render | jobId读取/取消；render若公开也能直达 | render只私网；download代理不透传未经批准的Location | 单独服务网络策略与quota身份；不得以x-openmaic-client当认证 |
| signed URL | URL转发绕开实时policy | 推荐不将私有内容signed URL交给browser，gateway取bytes；direct egress候选 | 私有对象端点/独立broker；签名expiry不能证明Membership当前有效 |
| cache | source public immutable、device cache可能跨身份继续读 | gateway对私有数据no-store/专属cache key，撤权后停止新读取；不能追回已下载bytes | 独立origin可减小共享，但必须明确缓存清理和主体切换 |
| server components/job | 内部helper不经过Zhiban API | 网络只能围住外部流量，内部job必须受use case与绑定约束 | 内部任务仍需授权票据/版本/取消策略，尚无稳定完整接线 |
| 部署复杂度 | 低，但不满足统一授权前提 | 中高：路由allowlist、cookie/header隔离、响应URL代理、SSE和Range支持 | 高：服务身份、版本编排、worker与存储/网络隔离 |
| upstream兼容 | 容易诱发core patch；禁止 | 不改core可拦入口，但unversioned routes需compatibility tests | package exports优先；应用内runner/editor桥仍有上游扩展缺口 |
| 本阶段判断 | 不能作为安全生产Bridge | preferred candidate，NOT ACCEPTED | preferred candidate，NOT ACCEPTED |

B不等于把/api/zhiban加到同一个公开监听器上：必须在唯一public front door显式拒绝原始业务路径及Next Action POST；私网监听不能有旁路公网port。
C也不能简单把同一应用反向代理所有路径到公网：那会退化成A。
源码证据：middleware.ts（无ACCESS_CODE全放行，API code门，页面放行）；docker-compose.yml:24发布3000:3000、:85 render expose；next.config.ts frame-ancestors不是认证；没有读取现场网络状态。

## Private必要但不充分

在保留固定底座行为、Zhiban课程非公开的前提下，**PRIVATE OPENMAIC REQUIRED: YES**。包括Next原始业务routes、Server Actions、render、对象bytes旁路；不要求将无敏感数据的公共静态JS字体当成用户授权接口。
静态检查能证明应用内没有Tenant policy，不能证明生产已经存在可绕过公网；“DIRECT BROWSER BYPASS FOUND: YES”是可调用源码路径相对未来gateway的旁路。
private-only仍不能把dev auth变成可接受生产认证。B/C只有网络前提，不自动解决可信principal、native publish、工具后台撤权。当前完整桥接不能判SAFE_ADAPTER。

建议未来隔离诊断验证（本次未执行）：严格allowlist；IPv4/IPv6/备用host/直连IP无旁路；同名header去重与可信代理；Set-Cookie剥离；redirect Location重写与不泄漏private host；Range/HEAD/cache/SSE重连；禁用Tenant后现有连接/worker停止；null-origin iframe资源和外链策略；对象存储签名链接的复制/过期/撤权语义。

## Zhiban-owned mapping可行性

只分析字段语义，不创建schema。OpenMAIC拥有Stage/Scene/Asset/Runtime/Agent Session；Zhiban拥有业务身份/活动/尝试/授权mapping。
Domain不导入OpenMAIC内部DTO、Next/React/Zustand；Application定义Port，Infrastructure实现，跨系统仅opaque ids。

| 字段概念 | 可表达的关系 | 不可隐含的保证 |
|---|---|---|
| TenantId + ActivityId | Zhiban活动所属Tenant | Stage本身不会因mapping变tenant-aware |
| StageRef + deploymentRef | 固定底座部署内opaque Stage/document id；复合定位避免跨实例同id | 不能只用StageId作全局cache键 |
| ownerMembershipId + opaque ownerHandle | 教师所属活动与内部owner凭据的映射 | ownerHandle不等于UserId；不能返回browser；当前authenticated接线缺失 |
| AttemptId + learnerMembershipId | 学习证据归属和授权范围 | Admin没有自动读证据权限 |
| runtimeHandle | server派生opaque learner/session分区，绑定Attempt和Stage | 客户端learnerKey不能成为权威；package结构校验不验证Enrollment |
| asset mapping | Activity/Stage与asset ref集合、deployment、状态/版本 | shared原始读和已签出URL不受mapping约束；meta.stageId不是授权 |
| job/session handle（补充） | generation/render/agent的异步任务归属 | 关闭stream不保证工具/任务停止；不做跨OpenMAIC库FK |

**ZHIBAN MAPPING ALONE SUFFICIENT: NO**。存在映射不改变任何原始route、对象URL、worker或cache行为。必须有network isolation，缺失可信扩展点时还需upstream extension/人工评审的替代宿主。

## 生命周期与并发

| 事件 | 必须满足的控制 | 当前底座缺口 / 后续验证 |
|---|---|---|
| CREATE | 先验证tenant/membership/scope；server产生关联；pending到active两步可恢复；只暴露已完成映射 | OpenMAIC写和Zhiban写非同事务；asset POST非幂等；禁止失败后盲目再分配 |
| PUBLISH | Zhiban课程发布仍tenant/course scoped；每次消费复核Enrollment | native publish要求非anon，但当前无auth接线；不偷用public=true等同全租户可见 |
| TRANSFER | ownerMembership变更先冻结写，版本比较，确认内部owner变更成功再开放；审计旧/新归属 | 没有已证实的稳定原生owner transfer契约；不直接UPDATE stage_meta |
| DISABLE | tenant/user/membership/Activity禁用立即deny新请求；停发新句柄 | 已加载内容无法收回；stream/job/缓存需要独立处理 |
| REVOKE | grant/version变更使后续请求/reconnect失败；停止相关任务的安全写入 | 现有runner lease只防worker竞争，不是撤权；后台media与run lease分离 |
| DELETE | 业务软状态/保留规则与OpenMAIC tombstone/asset引用撤销分开；显式审批物理删除 | GC有宽限，多文档共享和signed URL寿命不能忽略；legacy files另生命周期 |
| ORPHAN | mapping未知/丢失一律deny；资源孤儿隔离保留并告警 | 不自动删除所有未知OpenMAIC资源，可能是上游/其他用途 |
| RECONCILE | 按deploymentRef+opaque id核对，最小权限只读，记录差异 | 不把原始全库扫描或内部SQL作为Domain Repository |
| RETRY | 幂等业务operation id、版本/CAS、失败分类；过期授权重验 | mapping race/asset重复分配需补偿；不能重放已经撤销的授权快照 |

Ownership transfer race和mapping race不能仅靠“表里有tenant_id”解决；不持有跨系统原子事务假设。本阶段不指定新数据库表、migration或运行流程。
