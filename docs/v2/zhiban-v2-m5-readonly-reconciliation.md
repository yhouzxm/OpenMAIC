# M5 UNKNOWN / RESERVED 只读对账

状态：`LOCAL_VERIFIED / READ_ONLY_ONLY / UNCOMMITTED_CANDIDATE`。用户本轮选择“先实现只读对账报告，所有现有隔离保持”。基线 `refactor/zhiban-v2 @ daf63afa83470d24a9ed41d171c6a17f8a80adb6`；已有 M1–M5 未提交工作保留。

## 范围与授权

本轮交付本地维护命令及私有报告，不交付 terminal reconciliation。仅有拥有本地 Unix 私有环境目录的维护者可运行，必须通过现有安装 receipt、来源/构建 hash、精确 PG16/数据库/角色、catalog/ACL、ledger、Native provisioning/deployment 校验。使用既有 Bridge 与 Native runtime 角色，不用 postgres、migrator、Identity 管理员或浏览器身份读取业务数据；没有新增 HTTP route，也不接收外部 DSN、Native ref、SQL、actor 或授权参数。

报告 authority 为 `LOCAL_SERVICE_INSPECTION / CONTENT_PENDING_READ_ONLY`，绑定固定 serviceRef、进程 uid、implementationBindingHash、完整安装 receipt 的 canonical SHA256 与 deploymentId。这是本地进程授权说明，**不是冻结 Bridge ServiceActor 的变更授权或审计事件**。原发布者已撤权仍可由本地维护者观察其记录；不能冒充原发布者写入 content audit，也不能将管理员恢复、超时或报告当作重放许可。冻结 RECONCILE 的受限 ServiceActor、不得激活/发布及精确 recorded refs 约束继续保留；会写入 Bridge 的授权对账另行设计。

所有结论都保持 `fenceAction=KEEP`、`settlementAllowed=false`、`replayAllowed=false`、`publicationChanged=false`。后一个字段表示本命令不改变 publication，并不声称其他并发发布者没有改变它。现有 UNKNOWN/RESERVED 不批量处理，不自动清理或重新分配。

## 命令与输出

```sh
# tenant/offering 必须显式给出。seek pagination，默认 10、最多 20。
pnpm inspect:zhiban:m5 list --tenant <UUIDv7> --offering <UUIDv7> --limit 10
# 只检查一个精确的 content PUBLISH_CONTENT operation。
pnpm inspect:zhiban:m5 inspect --tenant <UUIDv7> --offering <UUIDv7> --resource <UUIDv7> --operation <UUIDv7>
```

`list` 可使用 `--after <operation UUIDv7>`；没有全库发现、通配范围、force/settle/replay 或任意路径导出。错误 scope 不回退到其他 tenant/resource。列表是时点观察，跨页不承诺稳定快照；报告关联同一个 operation 才有意义。

每次输出到现有 owner-only 环境目录的 `m5-inspection-<UUIDv7>.json`，0600、独占创建。标准输出仅给出 LOCAL、文件位置、canonical report SHA256 和 KEEP。文件包括 scope、来源授权绑定、观察时间、记录状态/sourceRevision/是否 dispatch、前后本地快照摘要、Native manifest 摘要及局限。不包含 Native owner/stage/scene/asset refs、文本内容、密码、DSN 或原始数据库错误。SHA256 用于完整性比对，**不是外部可信数字签名**；有权修改私有环境的本机维护者仍在信任边界内。失败不输出伪造成功报告，运行者自行管理这些私有报告的保留期。

## 算法与一致性

1. 入口封闭参数 + UUIDv7 校验；加载私有配置与安装 receipt，核验当前来源/已安装 catalog。
2. 新 Business `REPEATABLE READ READ ONLY` 事务，设置 tenant GUC，按完整 scope 读取 resource、content operation、prepare、slot、generation、scene、asset presence、activation、deployment；无 Session touch、FOR UPDATE/SHARE 或 SECURITY DEFINER 写调用。
3. 仅 RESERVED/OUTCOME_UNKNOWN 候选进入 Native 检查。核验 sourceRevision/digest、原 actor、key/intent、prepare/slot/generation/deployment/owner/记录 stage、reserved slot revision、PENDING generation、scene 数量/顺序/摘要、无资产和无 activation。使用保存的 creation time 重建精确预期文档并核对 expected_native_digest。非当前文本发布形状失败关闭，不猜测迁移/激活结果。
4. 新 Native `REPEATABLE READ READ ONLY` 事务，只通过公开 `PgDocumentStore.readFreshnessManifest`、记录中的 owner/ref 做 scoped lookup，核验记录 scenes 的 ID/顺序/revision 并记录 manifest hash。**D08 实测确认公开 `loadDocument` 内部使用 `FOR SHARE`，与 PG READ ONLY 不兼容；因此本轮不调用它、不去除锁、不读取私有 Native 表、不修改冻结包。manifest 匹配不等于文本/文档摘要匹配**。即使文本已改变而 refs/order 未变，也仍报告 CONTENT_UNPROVEN。期望记录至多 32 scenes，超量 manifest 报 mismatch；公开 API 仍先物化返回列表，本轮不声称实现传输层字节限流，本地 Native DB/provisioning 在受控信任边界内。
5. 新 Business 快照重新读取完整绑定，比较前后 fingerprint；不同则覆盖结果为 `LOCAL_STATE_CHANGED`，读不到则 `LOCAL_RECHECK_UNAVAILABLE`。三个快照不是跨库 ACID；最终观察之后仍可能改变，报告不具备租约或 CAS settlement 能力。
6. 出报告前再次验证安装/来源绑定。Native 异常不泄露原因，不推断 FAILED。每次数据检查共享 10 秒 deadline，statement 最多 5 秒、lock 最多 1 秒、idle transaction 10 秒，连接超时 3 秒；过期/失败连接销毁，服务端回滚，不等待无界 rollback。CLI 前后安装 receipt 校验、数据检查及报告写入共用 30 秒总预算；校验连接从连接启动起设置 statement 5 秒、lock 1 秒、idle transaction 10 秒及客户端 query 5.5 秒超时。任何等待错误/总预算过期销毁所有活动连接，迟到连接也销毁；后续查询和报告输出关闭。数据检查仍保留自身 10 秒上限；末尾池清理最多等待 3 秒，空闲 socket 不阻止进程退出。

## 状态矩阵

| 条件 | 报告 classification | 允许动作 |
| --- | --- | --- |
| content operation 已 terminal | `NOT_PENDING`，不查 Native | 仅报告 |
| 本地来源/prepare/generation/scene 绑定不成立或不支持 | `LOCAL_BINDING_MISMATCH`，不查 Native | 保留隔离 |
| owner-scoped Native manifest 返回空 | `NATIVE_NOT_OBSERVED` | 缺失与 foreign owner 不可区分；保留隔离 |
| owner-scoped manifest 与记录 scene IDs/顺序匹配且 revision 数值合法（不证明与历史 revision 相同） | `NATIVE_MANIFEST_MATCHED_CONTENT_UNPROVEN` | 仅证明 scoped manifest 已观察；文档内容摘要与 terminal outcome 未证明 |
| manifest 数量/顺序/ref 不匹配或 revision 数值不合法 | `NATIVE_MANIFEST_MISMATCH` | 保留隔离 |
| manifest 查询/解析错误、deadline 等 | `NATIVE_UNPROVEN` | 不证明任何 terminal outcome |
| 第二个本地快照发生变化/目标消失 | `LOCAL_STATE_CHANGED` | 丢弃旧状态结论；保留所有现存隔离 |
| 第二个本地快照不可用 | `LOCAL_RECHECK_UNAVAILABLE` | 不建立稳定本地绑定 |

后两项优先于 Native 结论。检查前目标不存在或环境/来源无效则拒绝命令，不生成结果。`RESERVED` 同样可能已经 dispatch/Native commit，不用状态名推断“没有副作用”。

## 实现与验证边界

实现位于 `lib/zhiban/infrastructure/content/inspection.ts`、`scripts/zhiban-local/inspect-m5.ts`；build/issuer binding 新增 inspector 源码、入口和私有构建产物。没有 SQL、helper、GRANT、RLS、已应用 migration 或冻结生产合同变更。inventory 只把“未实现授权对账”细分为“只读检查已实现、终态结算/解除隔离待办”，并刷新 UNISSUED 模板的 inventory hash；没有把模板签发为 enabled gate。candidate migration aggregate 保持 `e335f83bb48cc6c4ec754f8e3270dc0e6941e14f38306bd67aa29844c3713324`；完整 enabled gate receipt 模板继续 UNISSUED。

定向本地验证入口：`pnpm verify:zhiban:m5:inspection`。只在拥有的 55433 开发 cluster 使用新建合成 actor/resource；构造真实 reservation/dispatch/Native COMMIT 后丢失响应、foreign-owner 内容、文本变更仍 CONTENT_UNPROVEN、scene 顺序不匹配和 Native/publish 并发屏障；维护检查使用 runtime 角色，测试准备/前后证据读取单独使用本地 postgres。不将故障注入接口加入产品。绑定不一致与二次读失败是显式查询返回/异常注入；锁超时使用真实 Native 表锁；这三类证据不宣称已制造真实 catalog 漂移。

实际结果：**20/20 PASS**，`tsc --noEmit` 通过；重建本地 host 的受信任 HTTPS、匿名拒绝、登录/me/logout **5/5 PASS**，见 [对账证据](evidence/m5-readonly-reconciliation-local.json)与 [host 冒烟证据](evidence/m5-readonly-host-smoke-local.json)。2026-10-09 首轮验证的 implementation binding：`6d2fb7e24c300b4334b65052331c5eb2589732b573112dcedcfd285957ad2362`；installation receipt SHA256：`4a64eb5561572c06a87f49a91e4af2a33346e4739083bd2bf82e9ceac3f5ae3e`。本轮最终验证前已存在的 **76 个 pending resource** 对应 content resource/operation/publication/audit、Bridge slot/generation/operation/audit 前后摘要均为 `924187289efd8ceb1e2b1a2d75d28c39a643efa5447316b9bc47355fba8ad9ea`。新增 6 个合成 resource，隔离 fixture 原样保留；Native 文本/scene mismatch 仅施加于这些新 fixture。测试保留新建隔离 fixture，不删或完成现有待办；记录既有 pending resource cohort 及其 content/Bridge operation/publication/audit 前后 hash。不把这些结果推广为对全库历史 Native 内容的完整审计。

先前产品 19/19、安全负向 25/25、撤权 26/26、installer 5/5 保留在 [上一轮独立复评](zhiban-v2-m5-installer-enabled-review.md) 的来源/hash 范围。本轮报告明确绑定当前新增只读代码；没有机械重跑 GitHub 或原 55432 测试 cluster。新来源 hash 不自动回填旧证据。

## 后续待办

终态处置仍 `DEFERRED / NOT_AUTHORIZED`：设计受限 ServiceActor 的精确授权、当前与历史 actor 的审计归属、跨进程排除迟到发布者、可用于只读快照的公开内容摘要证明（当前 loadDocument 锁冲突不能绕开）、确定性 absence/结果证明、原子 terminal 结算与保持不发布的约束，再评审实现范围。没有服务端 fencing/cancellation 证明前，timeout/Native null/report 都不能释放 RESERVED/UNKNOWN。完整 enabled gate、M5-C PNG / D Runtime / E AI、生产 OPS/DATA 仍 deferred。NO COMMIT / NO PUSH / NO CI DISPATCH。

2026-10-12 R1/R2 修复：CLI 前后校验等待与连接生命周期已补上界，revision 文案已收窄；[定向修复验证](evidence/m5-inspection-budget-fix-local.json) **9/9 PASS**、类型/格式检查通过，新 implementation binding 为 `fd4920297e1abeb499fd7690a9182127871e6a430b8a24795da092a1eaaf84f4`。原 20/20 / host 5/5 仍保留在原 hash 范围，详见 [修复记录](zhiban-v2-m5-reconciliation-review.md)。无新增业务 fixture，现有隔离及终态待办保持。

2026-10-12 已补 [终态处置精确设计候选](zhiban-v2-m5-terminal-reconciliation-design.md)：离线停写/排空、单笔服务授权、真实审计与仅正向证明的取消。`DESIGNED_PENDING_REVIEW / NOT_IMPLEMENTED`；第 6 节终态待办已有具体方案，执行仍未授权，当前只读 CLI 不获得处置能力。
