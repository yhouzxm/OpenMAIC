# M5 只读报告与终态处置设计评审

日期：2026-10-12。基线：`refactor/zhiban-v2 @ daf63afa83470d24a9ed41d171c6a17f8a80adb6`。工作区保留已有 M1–M5 未提交增量。本轮只评审，未修改实现、SQL、receipt 或数据库状态；未 commit/push/dispatch。

## 结论

只读报告的授权与不解除隔离边界可以保留：入口为拥有私有环境的本地维护者，精确 scope，真实 READ ONLY 数据事务，公开 owner-scoped manifest，所有分类固定 KEEP / settlementAllowed=false / replayAllowed=false。没有发现把本报告转成写入权限、冒充原 actor 或自动发布的入口。

初次评审发现 R1（P2）和 R2（P3），现已按用户授权修复，定向 LOCAL 9/9 PASS，详见文末修复记录。终态处置只有待办描述，**没有可批准执行的精确授权/锁协议**；下面 T1–T3 是新增写路径前必须完成的设计门禁，不是现有只读功能正在执行的漏洞。整体状态：`READ_ONLY_BOUNDARY_ACCEPTABLE / R1_R2_FIXED_LOCAL_VERIFIED / TERMINAL_DESIGN_INCOMPLETE / KEEP_ALL_FENCES`。

## 只读报告发现

### R1 — P2：安装校验不受有界查询/退出约束

位置：[inspect-m5.ts](../../scripts/zhiban-local/inspect-m5.ts) 第 36–43、75–76 行；[content-receipt.ts](../../scripts/zhiban-local/content-receipt.ts) 第 136–177、180–251 行。

新 CLI 的两个 Pool 只设置 connectionTimeoutMillis；两次 validateContentInstallation 的 query、COMMIT、finally ROLLBACK 没有数据检查的 Deadline，也没有在入口配置 statement_timeout/lock_timeout。若已建立连接后的 ledger SELECT 等待锁，或服务端不响应，connectionTimeoutMillis 不控制该等待。inspect 的 10 秒 deadline 尚未创建或已结束；最后 pool.end 也不能取消仍在执行的 query。前置等待会使操作员无法取得报告，后置等待会让已完成的观察无法输出。

这不导致错误结算，但恢复诊断命令本身不应在故障期间无界等待。建议：给 CLI 整个校验/读取/签发阶段一个明确预算；每次校验连接设置数据库 statement/lock/idle 超时，并在网络超时后销毁连接、阻止继续执行/输出。只在 Promise.race 外层抛错或只配置连接超时不足以证明取消与退出。补前置校验阻塞、后置校验阻塞及坏连接清理的定向用例；不需要重跑全套业务/CI。

确认方式为源码路径审查。本次尝试读取 55433 的运行时默认 timeout 设置返回 ECONNREFUSED，因此未声称已在当前 PG 实例复现无界等待，也未假设其数据库级设置必为零。问题是在新命令自身没有保证界限。

### R2 — P3：文档将 revision 合法性写成与记录匹配

位置：[只读设计状态矩阵](zhiban-v2-m5-readonly-reconciliation.md) 第 42–43 行；[inspection.ts](../../lib/zhiban/infrastructure/content/inspection.ts) 第 284–295 行。

代码核验 scene IDs/order 与保存的 scene bindings 一致，而 manifest.rev / scene.rev 仅要求安全整数且 >=1；没有保存供比较的 Native revision 基线。因此“与记录 scene IDs/顺序/revision 匹配”扩大了证明范围。正常文本更新会改变 revision，但仍得到 CONTENT_UNPROVEN 的匹配分类，这正是已有测试验证的行为。

建议文案改为“scene IDs/顺序与记录匹配，revision 数值合法；未证明 revision 与历史值相同”。报告 meaning 已限定为 IDs/order，且保留 CONTENT_UNPROVEN，故本项不构成终态误判。

## 终态处置门禁

### T1 — 明确服务授权，并解决真实审计主体的 schema 冲突

冻结 [B9-S02/S05/S06](phase1/phase1b-9a-bridge-design.md) 要求 restricted ServiceActor、精确 intent/handles、当前资源状态，不允许 RECONCILE 激活/发布。LOCAL Unix uid、私有文件、技术安装 receipt、旧只读报告和旧 Session 均不能直接充当终态变更授权。

现状：

- [GuardedBridgeProtocol.reconcilePrepared](../../lib/zhiban/infrastructure/openmaic/protocol.ts) 要求原 USER/会员/authorizationVersion，只结算 PREPARE；不能直接当作受限 ServiceActor 的 content 终态接口。
- [BridgeRepository.audit](../../lib/zhiban/infrastructure/openmaic/repository.ts) 第 576–579 行从原 operation 复制 actor；改 serviceRef 字符串不能使它成为真实服务结算审计。
- [content link_consistency](candidates/m5-content/02-helpers-and-guards.sql) 第 338–345、361–369 行要求 audit.actor_id=co.actor_id，并要求 FAILED 对应 OPERATION_FAILED。原发布者不等于处置服务。不能通过复制原会员到新的审计、恢复其权限、修改原 operation actor 或禁用约束解决。

需在补充设计中列明：服务身份由谁签发/撤销；精确 tenant/offering/resource/content operation/prepare/可选 activation/deployment/intent 与期望版本；闭合 purpose/目标状态；有效期、撤销版本、请求幂等键和 proof digest。服务撤销/授权过期与结算必须有实际冲突锁及提交前时间检查。是否允许已停用 Tenant/owner 下做仅拒绝型维护应有显式规则，不从普通教师权限或 SYSTEM_ADMIN 推导。

原 operation 保留发起者；独立 resolution/audit 记录真实服务执行者并绑定原 operation、原/新状态、证明和授权。在新增 migration/helper/ACL 中精确表达原终态一致性检查如何接受该审计；单纯新增一张旁表、仍用原会员补假 audit 不成立。只允许列明结算能力，不能给服务通用 publication/pointer DML 或通用 tenant 管理权。已应用 SQL 字节保持不变，涉及冻结合同的修订先评审。

### T2 — 关闭迟到 dispatcher 与 Native 尾部事务窗口

现有 [ContentService](../../lib/zhiban/infrastructure/content/service.ts) 第 555–570 行将 dispatch、Native 存储、本地 publication 分成不同 Business 事务。Native 阶段只复核 actorVersion/当前授权；没有重新核验 content/prepare 状态，也没有持有与新 reconciler 约定的 durable claim。业务 lock helper 锁 Offering/Course/关系，但只检查 resource 存在，不提供资源写锁。

[markDispatch](../../lib/zhiban/infrastructure/openmaic/repository.ts) 第 315–333 行的 advisory xact lock 在 dispatch COMMIT 时释放，**不能排除后续 Native dispatcher**。旧 20/20 的 race 只证明“本地第二快照发现发布已变化”，不证明能够阻止它。

具体反例（尚未存在的错误终态方案）：

1. 发布者 dispatch COMMIT 后暂停。
2. reconciler 只锁 resource/prepare，读到 Native null，写 FAILED 并释放 pending fence。
3. 原发布者恢复；当前 Session/actorVersion 仍有效，现有 Native 阶段继续写入。
4. 即使后续 Bridge terminal CAS 拒绝激活，所谓“无副作用失败”也已经被迟到 Native 写入推翻。

待补协议必须使所有 dispatcher、settler、quarantine 路径参与同一排他机制，并在每次外部 dispatch 与本地结算前校验 exact operation、state、claim/epoch 及版本。所有参与者沿实际 Identity/business 锁顺序扩展，不另造与既有写路径不冲突的 mutex；旧 host/CLI 必须停止接入或被版本门禁拒绝。结算事务内同一客户端完成当前服务授权、状态 CAS、审计及 fence 释放；冲突不重试、不重新 dispatch。

仅有 Business 行锁、进程 mutex 或带过期时间的 lease 仍不足：Business 连接死亡可能释放锁，而 Native 后端尚在提交。必须证明 Native 写入目标能原子校验 fencing token，或明确采用受控停写模式，停止全部 writer admission 并确认相关 Native 事务已提交/回滚且没有迟到 writer 再进入。不能把 Node 进程退出、发送 cancel、超时、睡眠或 lease 到期当作 drain 完成。现有冻结公开 API 未提供跨库原子 fencing 证明；没有该证明时在线解除隔离继续关闭。

对当前单机开发场景，建议先设计“显式停写 + 确认 drain + 精确操作处置”的受限维护模式，避免为只读报告引入在线自动结算系统。此为设计建议，不是本轮停服/取消事务/写库授权，也不能推广成多实例生产方案。

### T3 — 分清 Native prepare 成功、业务发布成功与明确失败

只读 manifest 证明不到文档摘要；owner-scoped null 不区分缺失与 foreign owner。Business 双快照相同不能证明 Native 没有迟到写入。任何只读报告都不能直接作为可重放 settlement token。

| 新鲜、排他条件下取得的事实 | 未来可考虑的动作 | 仍禁止 |
| --- | --- | --- |
| 已 terminal 且结算审计完整 | 验证同一授权/幂等意图后返回既有结果 | 再次写 Native / 再发布 |
| 只有 manifest/null/超时/旧报告 | 保持 RESERVED/UNKNOWN | 直接 FAILED 或清 fence |
| 精确 Native document 与所有绑定已证明，且 writer 已被排除 | 独立结算 PREPARE；业务 PUBLISH 仍保持隔离，或按另行批准的“未发布取消”规则结算失败 | 把 PREPARE SUCCEEDED 等同于 PUBLISH SUCCEEDED |
| 证明从未 dispatch 或已确定无副作用，且迟到 writer 不可能再进入 | 按批准状态矩阵原子 FAILED + audit + fence resolution | 以 dispatch_started_at=null 单独作为全部证明 |
| activation 存在、绑定漂移、证明不完整或涉及 transfer/asset | 留待相应专用设计，继续隔离 | 按当前文本无 activation 路径强行结算 |

Content PUBLISH_CONTENT=SUCCEEDED 当前必须有 publication、成功 activation 和指针关系（02 SQL 第 334–337 行）；受限 RECONCILE 不能创造这些业务事实。若未来批准“Native prepare 成功但取消未发布业务操作”，必须明确 FAILED 指业务命令未发布，保留 Native candidate/orphan，不声称 Native 写入失败；需要对应原因词汇、服务审计、prepare/activation 终态条件和 generation 保留策略。原 active publication 保持原状，新的用户发布仍须新命令及当时授权。

公开 loadDocument 的 FOR SHARE 与 READ ONLY 不兼容；完整内容证明应单独评审支持的公开 API/受控锁定读取方案。不能直接 strip SQL 锁、读私有表或将 revision 合法性视为内容 hash。严格 READ ONLY 报告可以继续只提供 manifest；终态证明机制与报告能力分开定义。

## 最小后续验收

只读问题修复仅需 R1 超时/断连/退出用例和 R2 文案核对。终态实现之前先给出授权记录、状态矩阵、新 migration/helper/ACL、精确锁序与 writer/drain 协议；随后按实际能力补如下独立连接/进程测试：

- 服务授权错误 scope/purpose、撤销、过期、旧 proof、改 intent、重复处置及原发布者已撤权。
- 两个 reconciler 争用；dispatch 前、dispatch 已提交但 Native 未开始、Native COMMIT 前/已提交但 ACK 丢失、Business settlement COMMIT 前/ACK 丢失。
- Business 锁连接死亡而 Native 后端仍存活；旧 host/旧 claim 恢复；等待锁后授权过期；处置服务中途崩溃。
- 所有失败保持原 fence 或已原子提交的正确终态；无自动重试、无 pointer/publication 变化、无原 actor 冒名审计；Native candidate 不请求时物理删除。

## 证据适用范围

本轮静态读到了当前实现、封闭 CLI、loader、公开 Storage 源码、冻结 Bridge 设计、已应用候选约束和定向 verifier。离线重新计算确认 implementation/artifact binding 与既有 evidence 一致：`6d2fb7e24c300b4334b65052331c5eb2589732b573112dcedcfd285957ad2362`；migration aggregate 保持 `e335f83bb48cc6c4ec754f8e3270dc0e6941e14f38306bd67aa29844c3713324`；verifier SHA 与 [20/20 LOCAL 记录](evidence/m5-readonly-reconciliation-local.json)一致。

20/20 与 host 5/5 是 2026-10-09 的既有运行结果，本轮未重跑、未新增 fixture。当前 `127.0.0.1:55433` 拒绝连接，本轮未启动 cluster 或 host，未取得新的 live catalog/ACL/状态确认；这不推翻已绑定的历史证据，也不能表述为今天重新通过。76 个 pending resource 是该历史验证的保护 cohort，不是今天的实时数量。未扩大为 production signoff、完整 enabled gate 或终态结算验证。

## R1 / R2 修复记录（2026-10-12）

用户授权修复上述两项。本次新增本地 inspection-budget 生命周期控制，不修改冻结事务 helper 或生产合同。CLI 配置从连接启动起生效的 statement 5 秒、lock 1 秒、idle transaction 10 秒、驱动 query 5.5 秒超时；私有环境加载、前后校验、数据检查与报告写入共用 30 秒预算。查询错误/过期会销毁所有活动连接；迟到连接销毁；旧连接再次调用和预算失败后的新连接获取均拒绝；最后清理最多等待 3 秒，空闲 socket 使用 allowExitOnIdle 避免阻止进程退出；尚在连接中的尝试另受 3 秒连接超时约束。idle pool error 也会中止预算，不传播原始错误。报告写入过期/失败会清理文件（包括迟到完成），不会打印成功。

R2 文案现明确：仅 scene IDs/顺序与记录匹配、revision 数值合法；未证明与历史 Native revision 相等，也未证明内容摘要。分类、manifest API、权限与隔离语义不变。

通过 `pnpm verify:zhiban:m5:inspection-budget` 的 **9/9** 定向检查：四项合成 deadline/driver 错误生命周期用例；实际 PG16 startup 超时设置与 live receipt 校验；编译 CLI 的前置 ledger 锁等待退出且无报告；按同一 CLI 生命周期分段执行的后置 ledger 锁等待失败、销毁且无后续签发；锁释放后真实 CLI 私有 KEEP 报告成功；业务/Bridge resource、operation、publication、audit 全量前后 hash 一致。后置阶段是实际 loader/PG 锁与同一 budget facade 的分段测试，未宣称已用故障 hook 改写产品 CLI。无新增业务 fixture，没有重跑原 20-case 或 host 5-case。证据见 [修复验证](evidence/m5-inspection-budget-fix-local.json)。

本次启动原有、owner-only 的 55433 开发 cluster 用于验证；只做短时表锁、READ ONLY 校验及技术安装 receipt 重签发。installer 明确 `without reapplying`，已应用 migration aggregate 不变，原 55432 测试 cluster 未使用。上文 ECONNREFUSED 及未启动环境描述仅对应修复前的评审。类型检查与格式检查通过；未 commit/push/dispatch，终态门禁 T1–T3 保持待办。

修复后 implementation binding：`fd4920297e1abeb499fd7690a9182127871e6a430b8a24795da092a1eaaf84f4`；定向 verifier SHA256：`9e6cda2e2672743b6489a37abd597f755e4846dd9562c3527774e1aca6471390`。旧 20/20 与 host 5/5 继续只适用于它们的原 hash，不回填为新来源验收。

## 2026-10-12 终态精确设计补充

已补 [终态授权、审计与并发屏障设计](zhiban-v2-m5-terminal-reconciliation-design.md)，T1–T3 从未形成方案推进为 `DESIGNED_PENDING_REVIEW`。首版只考虑双库离线排空、单笔服务 grant、完整公开文档匹配后的取消未发布命令；原用户身份不冒用、Native candidate 保留、slot/publication 不变。精确列明 Content 与 Bridge 两处服务审计例外、session_user/RLS/ledger 升级、Native FOR SHARE 的实际权限及崩溃恢复边界。上文 TERMINAL_DESIGN_INCOMPLETE 描述的是补充前评审状态；本补充不是设计批准、运行验证或执行授权。实现、SQL/ACL 及实际处置均未执行，所有现有隔离保持。
