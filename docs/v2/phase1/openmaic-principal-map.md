# OpenMAIC Principal Map — 1B-0A

静态快照：700a7673becf0518bc6f8b2861229ee985c5d063 / OpenMAIC 4d2e2bab82374ed45b95964a1f2ed03362666e1c。
18类身份、资源状态和凭据来源。资源状态/URL/本地cache列入是为防止误当principal，不表示这些全部是身份。

严禁等同：OpenMAIC owner ≠ Zhiban UserId；learnerKey ≠ MembershipId；anonymous cookie ≠ Zhiban Session；access token ≠ Zhiban login token。
没有发现已接线的Zhiban User/Tenant/Role principal。authenticatedOwnerId只是未接线参数。公开package允许宿主定义principal，不是当前应用已具备该宿主。

## P01 anonymous owner cookie

| Field | Finding |
|---|---|
| SOURCE | P01 anonymous owner cookie |
| EVIDENCE | lib/server/agent-runtime/owner.ts:63 |
| CREATED BY | server随机UUID或接受已有合法UUID |
| TRUST LEVEL | 低：持有cookie的匿名partition |
| BROWSER CONTROLLED | YES，HTTP客户端可提供；HttpOnly仅防普通JS读取 |
| SERVER CONTROLLED | 仅缺失时mint；不是签名验证 |
| RESOURCE SCOPE | agent/session/stage write/material/skill |
| LIFETIME | cookie30天；存储owner行不随cookie自动过期 |
| FORGEABILITY | 知道其他合法UUID可重放；随机猜中不应假定容易 |
| PUBLIC CONTRACT | INTERNAL |
| ZHIBAN MAPPING POSSIBLE | opaque ownerHandle可映射，但不能作为UserId |
| SECURITY RISK | 无登录/tenant/撤销能力 |

## P02 authenticatedOwnerId

| Field | Finding |
|---|---|
| SOURCE | P02 authenticatedOwnerId |
| EVIDENCE | lib/server/agent-runtime/owner.ts:66；with-owner.ts:17 |
| CREATED BY | 仅helper参数；当前生产调用未传 |
| TRUST LEVEL | 取决于未来认证层；现在未建立 |
| BROWSER CONTROLLED | NO，未定义可信HTTP入口 |
| SERVER CONTROLLED | 潜在server参数，不代表已接线 |
| RESOURCE SCOPE | owner partition |
| LIFETIME | 由未来host决定，当前UNKNOWN |
| FORGEABILITY | helper直接返回，调用者必须认证 |
| PUBLIC CONTRACT | INTERNAL |
| ZHIBAN MAPPING POSSIBLE | 概念YES，支持契约缺失 |
| SECURITY RISK | 不能因为有参数就判SAFE |

## P03 stage/document owner

| Field | Finding |
|---|---|
| SOURCE | P03 stage/document owner |
| EVIDENCE | lib/persistence/owner-bound-document-store.ts:246 |
| CREATED BY | create事务claimStageMeta |
| TRUST LEVEL | 仅继承anonymous owner可信度 |
| BROWSER CONTROLLED | 间接cookie；不能通过普通body随意换owner |
| SERVER CONTROLLED | 事务写入/非read复核 |
| RESOURCE SCOPE | stage及场景写/删/列表；read不是owner-only |
| LIFETIME | 到tombstone/记录生命周期 |
| FORGEABILITY | 外来写被拒；盗用owner cookie另论 |
| PUBLIC CONTRACT | INTERNAL；底层DocumentStore公开 |
| ZHIBAN MAPPING POSSIBLE | ownerMembershipId→opaque handle；需转移生命周期 |
| SECURITY RISK | UUID possession不是教师；read跨owner |

## P04 learnerKey

| Field | Finding |
|---|---|
| SOURCE | P04 learnerKey |
| EVIDENCE | lib/runtime/learner-key.ts:1 |
| CREATED BY | browser KV device随机anon key或bootstrap resolver |
| TRUST LEVEL | 低：device key不是身份 |
| BROWSER CONTROLLED | YES，localStorage/header/请求body |
| SERVER CONTROLLED | embedded未重绑；package仅比较与principal |
| RESOURCE SCOPE | runtime stage/learner/session |
| LIFETIME | device KV持久；memo当前client会话 |
| FORGEABILITY | 可选择/复制；dev token也进public bundle |
| PUBLIC CONTRACT | RuntimeStore partition contract PUBLIC_STABLE；client resolver INTERNAL/B seam |
| ZHIBAN MAPPING POSSIBLE | server派生runtimeHandle，可映射Attempt/Membership，不能直接相等 |
| SECURITY RISK | 跨learner读写、会话切换memo遗留 |

## P05 access code

| Field | Finding |
|---|---|
| SOURCE | P05 access code |
| EVIDENCE | middleware.ts；app/api/access-code/verify/route.ts:21 |
| CREATED BY | operator配置ACCESS_CODE |
| TRUST LEVEL | 部署准入，不是用户凭据 |
| BROWSER CONTROLLED | 请求提交code |
| SERVER CONTROLLED | server比较；限速依赖clientIdentity可信代理配置 |
| RESOURCE SCOPE | 整个deployment的多数API |
| LIFETIME | 配置有效期间 |
| FORGEABILITY | 弱code/泄露扩大部署访问；不输出实际值 |
| PUBLIC CONTRACT | PUBLIC_BUT_UNVERSIONED |
| ZHIBAN MAPPING POSSIBLE | 不可当User/Role/Membership；独立基础门 |
| SECURITY RISK | 学生知code也有原始生成等权限 |

## P06 openmaic_access token

| Field | Finding |
|---|---|
| SOURCE | P06 openmaic_access token |
| EVIDENCE | lib/server/access-token.ts:8；access-token-shared.ts |
| CREATED BY | HMAC(accessCode,timestamp) |
| TRUST LEVEL | 可信部署准入，不含用户/tenant |
| BROWSER CONTROLLED | browser携带bearer cookie |
| SERVER CONTROLLED | 签名/时效server验证 |
| RESOURCE SCOPE | 部署API；页面middleware放行 |
| LIFETIME | 7天，时钟未来偏移检查；code变更使旧签名失效 |
| FORGEABILITY | 无code难伪造；复制token能重放 |
| PUBLIC CONTRACT | INTERNAL token format |
| ZHIBAN MAPPING POSSIBLE | 不得映射为Zhiban login token |
| SECURITY RISK | 无法逐Membership撤销 |

## P07 shared asset principal

| Field | Finding |
|---|---|
| SOURCE | P07 shared asset principal |
| EVIDENCE | lib/persistence/server-auth.ts:32；app/api/persistence/[...path]/route.ts |
| CREATED BY | server常量shared |
| TRUST LEVEL | 不是隔离身份；deployment共享 |
| BROWSER CONTROLLED | 不必控制key，所有访问者同key |
| SERVER CONTROLLED | YES，固定key |
| RESOURCE SCOPE | 该实例全部registry assets |
| LIFETIME | 服务配置/entry生命周期 |
| FORGEABILITY | 无需伪造principal；获准访问者共享分区 |
| PUBLIC CONTRACT | AssetPrincipal PUBLIC_STABLE；shared选择INTERNAL |
| ZHIBAN MAPPING POSSIBLE | asset mapping可表达归属，但原始endpoint仍旁路 |
| SECURITY RISK | 已知id读共享素材；allocation共享配额 |

## P08 dev bearer / server auth

| Field | Finding |
|---|---|
| SOURCE | P08 dev bearer / server auth |
| EVIDENCE | lib/persistence/server-auth.ts:87；lib/persistence/bootstrap.ts:40 |
| CREATED BY | operator token；NEXT_PUBLIC副本由浏览器发送 |
| TRUST LEVEL | 仅可信单用户开发网络 |
| BROWSER CONTROLLED | YES，public token可见 |
| SERVER CONTROLLED | 验证bearer但信任x-learner-key；production默认deny |
| RESOURCE SCOPE | runtime、asset extraction兼容分支、Pi白板 |
| LIFETIME | token轮换/环境配置；无用户expiry |
| FORGEABILITY | 任意持token者选择learner |
| PUBLIC CONTRACT | INTERNAL app；package authenticate是PUBLIC_STABLE |
| ZHIBAN MAPPING POSSIBLE | 不能成为生产桥，MUST NOT enable insecure |
| SECURITY RISK | 生产绕过将造成横向访问 |

## P09 public/published state

| Field | Finding |
|---|---|
| SOURCE | P09 public/published state |
| EVIDENCE | lib/server/stage-access.ts；app/api/stages/[id]/status/route.ts |
| CREATED BY | owner publish/unpublish（现无auth owner接线） |
| TRUST LEVEL | 资源状态，不是principal |
| BROWSER CONTROLLED | 可读状态；不能任意publish |
| SERVER CONTROLLED | server状态写控制 |
| RESOURCE SCOPE | Stage metadata；不控制全部document读取 |
| LIFETIME | 到下一状态变更/tombstone |
| FORGEABILITY | 不是身份，不能伪造tenant权限 |
| PUBLIC CONTRACT | INTERNAL/HTTP PUBLIC_BUT_UNVERSIONED |
| ZHIBAN MAPPING POSSIBLE | Zhiban publication policy独立映射 |
| SECURITY RISK | private文档也capability read；public不等于Enrollment |

## P10 agent durable owner/session

| Field | Finding |
|---|---|
| SOURCE | P10 agent durable owner/session |
| EVIDENCE | lib/server/agent-runtime/runner.ts:1303 |
| CREATED BY | session POST捕获owner；store持久化 |
| TRUST LEVEL | 继承P01，session id不是授权 |
| BROWSER CONTROLLED | body可指定stage/skill/text；不能在tool参数直接改owner |
| SERVER CONTROLLED | runner从meta取owner/lease/ownerStage probe |
| RESOURCE SCOPE | session events/messages/tools/materials |
| LIFETIME | 长会话、可resume；owner cookie生命周期独立 |
| FORGEABILITY | 知道session id但owner不同会拒；owner凭据泄露仍危险 |
| PUBLIC CONTRACT | AgentSessionStore公开；runner/role policy INTERNAL |
| ZHIBAN MAPPING POSSIBLE | session↔activity↔ownerMembership mapping；不可等同用户Session |
| SECURITY RISK | role/tenant撤销不触发worker自动停机 |

## P11 library userKey / folder owner

| Field | Finding |
|---|---|
| SOURCE | P11 library userKey / folder owner |
| EVIDENCE | app/api/folders/route.ts:37；lib/server/folder-persistence.ts |
| CREATED BY | request anonymous owner |
| TRUST LEVEL | 同P01 |
| BROWSER CONTROLLED | cookie间接控制 |
| SERVER CONTROLLED | owner-bound操作 |
| RESOURCE SCOPE | 文件夹/课程归类 |
| LIFETIME | 存储行周期 |
| FORGEABILITY | 并非组织成员/班级 |
| PUBLIC CONTRACT | PUBLIC_BUT_UNVERSIONED route / INTERNAL binding |
| ZHIBAN MAPPING POSSIBLE | 单独opaque mapping |
| SECURITY RISK | 把folder membership误当Tenant Membership |

## P12 owner materials / user skills

| Field | Finding |
|---|---|
| SOURCE | P12 owner materials / user skills |
| EVIDENCE | app/api/materials/route.ts:137；app/api/agent/skills/[id]/route.ts:19 |
| CREATED BY | 上传者owner，绑定时验证session归属 |
| TRUST LEVEL | 同P01 |
| BROWSER CONTROLLED | id和file可提交，owner取cookie |
| SERVER CONTROLLED | owned session/material/skill查找 |
| RESOURCE SCOPE | 材料/技能；内置skills另行开放 |
| LIFETIME | 行生命周期及session绑定 |
| FORGEABILITY | 其他owner id查不到，但cookie仍为弱身份 |
| PUBLIC CONTRACT | storage exports存在；host helpers INTERNAL |
| ZHIBAN MAPPING POSSIBLE | 可映射素材归属和authoring授权 |
| SECURITY RISK | 用户skill/tool输入可影响生成；不得视为Teacher授权 |

## P13 runtime session/record identity

| Field | Finding |
|---|---|
| SOURCE | P13 runtime session/record identity |
| EVIDENCE | packages/@openmaic/storage/src/server/index.ts:241 |
| CREATED BY | principal.learnerKey与存储session比较 |
| TRUST LEVEL | package强度取决于authenticate |
| BROWSER CONTROLLED | body/path提供session/stage/scene |
| SERVER CONTROLLED | handler比对learner、record sessionId |
| RESOURCE SCOPE | session、record；无课程Enrollment验证 |
| LIFETIME | session/record生命周期 |
| FORGEABILITY | 开发principal可选则分区比较无身份保证 |
| PUBLIC CONTRACT | PUBLIC_STABLE C03/C05 |
| ZHIBAN MAPPING POSSIBLE | Attempt↔runtimeHandle，显式校验stageRef |
| SECURITY RISK | 结构绑定并非业务所属证明 |

## P14 iframe observation identity

| Field | Finding |
|---|---|
| SOURCE | P14 iframe observation identity |
| EVIDENCE | lib/interactive/observation-bridge.ts:10,188 |
| CREATED BY | parent/pool传documentId/sceneId/scopeId；iframe随机instanceId |
| TRUST LEVEL | browser-reported，仅关联与新鲜度 |
| BROWSER CONTROLLED | YES，同frame脚本可见且可自报 |
| SERVER CONTROLLED | NO服务器身份绑定 |
| RESOURCE SCOPE | 某个Window/document/scene |
| LIFETIME | load/navigation/dispose/request timeout |
| FORGEABILITY | 其他Window source受阻；当前恶意frame能自报 |
| PUBLIC CONTRACT | INTERNAL |
| ZHIBAN MAPPING POSSIBLE | 只能映射观察上下文，不授权限/不算可信成绩 |
| SECURITY RISK | 伪造学习证据；不能把requestId当秘密token |

## P15 signed URL bearer

| Field | Finding |
|---|---|
| SOURCE | P15 signed URL bearer |
| EVIDENCE | packages/@openmaic/storage/src/server/asset.ts:638；asset/s3-bytes.ts:367 |
| CREATED BY | server签发object URL |
| TRUST LEVEL | 短期bearer |
| BROWSER CONTROLLED | 可复制URL |
| SERVER CONTROLLED | 签发前授权；对象层签名验证 |
| RESOURCE SCOPE | bytes/hash对象，不是当前Membership |
| LIFETIME | 默认60s/上限900s（asset handler）；其他provider UNKNOWN |
| FORGEABILITY | 不可随意伪造签名但可转发重放 |
| PUBLIC CONTRACT | PUBLIC_STABLE byte-egress；provider UNKNOWN |
| ZHIBAN MAPPING POSSIBLE | asset mapping不控制签出后GET |
| SECURITY RISK | 撤权后expiry前仍能读；跨principal共享hash曝光 |

## P16 render client identity

| Field | Finding |
|---|---|
| SOURCE | P16 render client identity |
| EVIDENCE | lib/server/client-identity.ts；render-service/src/main.ts:276 |
| CREATED BY | Next derive clientIdentity；preview owner header |
| TRUST LEVEL | 配额/限流身份，不是用户授权 |
| BROWSER CONTROLLED | 直连服务可伪造header；代理header信任依部署 |
| SERVER CONTROLLED | Next可覆盖；服务读取header |
| RESOURCE SCOPE | render/preview额度；jobGET不验证此identity |
| LIFETIME | 请求/额度窗口 |
| FORGEABILITY | 可转发/伪造；job id读删无owner |
| PUBLIC CONTRACT | INTERNAL/PUBLIC_BUT_UNVERSIONED |
| ZHIBAN MAPPING POSSIBLE | job↔Tenant/Activity/owner mapping需新gate |
| SECURITY RISK | 私网必要；不对服务公开该header |

## P17 provider credentials

| Field | Finding |
|---|---|
| SOURCE | P17 provider credentials |
| EVIDENCE | lib/server/resolve-model.ts；app/api/generate/image/route.ts:111 |
| CREATED BY | 服务端env或用户BYOK |
| TRUST LEVEL | 供应商账户身份，不是Zhiban业务身份 |
| BROWSER CONTROLLED | BYOK和部分模型选项可提交 |
| SERVER CONTROLLED | managed provider配置由server选择 |
| RESOURCE SCOPE | AI消费/供应商资源 |
| LIFETIME | 供应商策略UNKNOWN |
| FORGEABILITY | 泄露可耗费额度；不能授权课程编辑 |
| PUBLIC CONTRACT | INTERNAL host policy |
| ZHIBAN MAPPING POSSIBLE | AIServicePort外围policy，不拷贝凭据到mapping |
| SECURITY RISK | 学生直接生成/配置探测/usage跨用户 |

## P18 local browser stores/cache

| Field | Finding |
|---|---|
| SOURCE | P18 local browser stores/cache |
| EVIDENCE | lib/media/asset-pool.ts:1；lib/runtime/store.ts；lib/store/stage.ts |
| CREATED BY | IndexedDB/localStorage/Zustand client |
| TRUST LEVEL | 设备状态，不是安全principal |
| BROWSER CONTROLLED | YES |
| SERVER CONTROLLED | NO，HTTP模式另有server控制 |
| RESOURCE SCOPE | 本设备Stage/runtime/blob缓存 |
| LIFETIME | 设备持久/内存memo/object URL lease |
| FORGEABILITY | 本地用户可修改/保存；注销不天然擦除 |
| PUBLIC CONTRACT | storage公开primitive；singleton INTERNAL |
| ZHIBAN MAPPING POSSIBLE | 切tenant需销毁/隔离缓存；key包含deployment+tenant+subject+resource |
| SECURITY RISK | cache串Tenant、旧内容继续播放，已下载bytes不可召回 |

## 信任转换要求（设计约束，不实现）

Zhiban可信Session → 当前Tenant解析 → Membership/Permission/Scope复核 → Zhiban-owned mapping → adapter opaque owner/runtime/resource handle。
不得透传客户端ownerId、x-learner-key、role、tenantId、内部cookie作为权威。网关必须清除再构造身份相关headers/cookies；内部响应Set-Cookie不得泄漏私网owner handle。
System/Tenant Admin不能凭管理角色获得学习证据；SELF/CLASS/COURSE/TENANT仍按冻结Policy执行。OpenMAIC public状态和服务端provider key不能覆盖拒绝决定。
