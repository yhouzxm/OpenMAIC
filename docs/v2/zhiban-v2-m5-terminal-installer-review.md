# M5 terminal 签发权限 / 部分失败 / loader 评审与准备

2026-10-12；branch `refactor/zhiban-v2`，HEAD `daf63afa83470d24a9ed41d171c6a17f8a80adb6`。工作区非 CLEAN，保留既有增量。本轮未改被评审候选和已应用 migration，未连接 55432/55433，未 commit/push/CI dispatch。结论：**三个 P2 OPEN；真实技术安装与终态维护继续 BLOCKED**。

被评审 inventory：`38c415440ca07abb5565b96b1685376a85b5135dfcc4872baf5c2f1544860e98`；Business aggregate：`e1e7ea9517462edd855fb8715f49346db4c467c01aac43e8a370c39eebf7184a`。旧 42/42 与静态 13 组证据仍有效于其最小 Native fixture 范围；不能扩展为真实 Native schema/恢复验收。

## 可操作发现

### TI-01 / P2：完整 collector 漏掉同名索引定义漂移

[11-complete-installation-catalog.sql](candidates/m5-terminal/11-complete-installation-catalog.sql#L5) 的 relations/columns 能看到索引对象名与列，却没有 `pg_get_indexdef`、predicate、唯一性及 ready/valid 状态。Native 10 同样没有索引定义。将真实 Storage `asset_blobs_unreferenced_idx` 的谓词从 `IS NOT NULL` 改成 `IS NULL`，保留索引名、列、owner，`collectAfter` 结果完全相同；原 `catalogFingerprint` 则能检测差异。新的完整 profile 因而比原 Native provisioning fingerprint 少了一项实际 schema 检查，影响 signed expected 与 loader 的来源承诺。

建议：在新 collector 追加确定排序的索引定义/valid/ready 元数据，重新生成独立 expected；测试同名不同谓词和 unique/valid 漂移。不能调整已应用 Native DDL 来匹配错误 expected。

### TI-02 / P2：loader/签发前的最终停写屏障缺失

[loadBlockedReceipt](candidates/m5-terminal/terminal-installation.cjs#L634) 先检查 barrier，再跨库查询 ledger、authority、多个 catalog，随后返回。技术 installer 在 [最终验证](candidates/m5-terminal/terminal-installation.cjs#L540) 也采用同样顺序。catalog 不包含 admission 状态。在 Native 最后一次 collector 查询结束后、返回前打开 Native admission，原 loader 仍返回 `LOCAL_TERMINAL_TECHNICAL_INSTALLED_BLOCKED`。它不产生终态写权限，但错误确认了其要求的当前隔离条件。

建议：installer 签名前与 loader 返回前再次检查实际 admission、完整 backend identity/postmaster、writer/authority 条件及来源；维护执行器用唯一控制器和启动阻断保持整个操作期间的停写。返回时重查不能替代全窗口互斥。本轮 broker 准备包装已验证前后 admission/backend 检查能拒绝此例；原 installer/loader 尚未修改。

### TI-03 / P2：真实 bootstrap 的 PUBLIC CONNECT 使安装后 profile 必然拒绝

现有 [Identity bootstrap](../../lib/zhiban/infrastructure/identity/postgres/bootstrap-roles.pg16.sql#L139) 仅撤销 PUBLIC 的 CREATE/TEMPORARY，保留 CONNECT。候选 [00-role-bootstrap](candidates/m5-terminal/00-role-bootstrap.sql#L19) 对 Native proof 单独 REVOKE，不能撤销由 PUBLIC 获得的 Business CONNECT，observer 也会继承。实际源码 bootstrap + candidate DDL 构建的参考中，两者的 Business CONNECT 均为 true；`verify-profile.py` 正确拒绝，导致安装在 Business/Native 已提交后无法签 receipt。旧 fixture 预先 REVOKE ALL FROM PUBLIC，掩盖了此差异。

建议：首先在任何变更前检测这个有效权限前提；准备显式、来源绑定的 additive 维护 ACL 方案，保留所有经批准的普通 CONNECT，再撤销 Business PUBLIC CONNECT。必须确认对现有角色的影响并写入恢复配置。不要修改已应用 bootstrap 字节，也不要放宽 profile 接受跨库权限。此次只在 disposable 后续探针中调整；导出的原始参考保留失败状态。

## 签发权限结论

| 主体/材料 | 实际权限与评审结论 |
| --- | --- |
| 独立预置 public pin | 验签不接受 envelope 任意公钥；purpose/source/target 绑定正确；pin 文件不能从收到的 receipt 自动生成 |
| 同一 OS owner 持有的 authority private key | 当前可签 expected、install approval、blocked receipt 三种 purpose；这是同一受信任管理员，**没有密码学层面的双人分权**。文档已披露信任根持有人属于信任边界，因此不列为新增绕过 |
| installer 进程 | 实际读取上述同一私钥，具备该 key 的全部签名能力；受 reviewed 程序约束。未来 broker/proof/service 不能继承此 key；准备 broker 已只接收三个只读验签路径 |
| expected review 声明 | `INDEPENDENT_SHADOW_PG16` / evidence hash 是签名者的审查声明，程序不能证明参考真正独立。本轮导出的真实 schema 参考无签名且有阻断项 |
| 五分钟安装批准 | 精确绑定目标/expected/source；只授权 blocked 安装，不授权 service grant、window/proof、终态或开库。后续分阶段超时/批准到期控制要随恢复执行器补齐 |
| 技术 receipt | 三个能力位固定 false，旧 host 没有接入；不能作为启用或生产签收 |

因此没有发现当前声明的单管理员信任模型内的额外签发越权。若未来要求 review/installer 分权，应引入分用途 pins/keys 与独立签发进程，不能只给同一私钥换文件名。

## 部分安装失败与维护 broker 准备

Business 0002 与其 ledger 同事务，这是正确的。roles、observer、Business、Native 分段提交，发生失败时不能把整个安装声明为回滚。原 42/42 中的 Native 客户端异常证明了 Business 已提交、Native 回滚、无 receipt、保持关库；没有证明 PG 崩溃或 COMMIT 回执丢失。

| 中断位置 | 必须记录/查证 | 后续操作边界 |
| --- | --- | --- |
| 一库关闭、另一库关闭失败 | 两库实际 admission、仍存活的预持有连接；保留已生效限制 | BLOCKED；不能声称双库均关闭，不在 finally 恢复 |
| roles/observer 后、Business 前 | 所有 role/edge、observer schema/function/ACL 的实际存在和 hash | 不重跑非幂等 CREATE，不用 journal 阶段猜测数据库事实 |
| Business COMMIT 回执丢失 | 原事务结束后查 0002 ledger **及全 catalog**；无结果记 UNKNOWN | 不重放 migration，不把连接报错当作已回滚 |
| Business 已提交、Native 失败 | 两边独立 profile 与 Native 事务结果；Business ledger 保留 | 仅未来明确批准的阶段补全流程可继续；没有自动 retry |
| 两库完成、receipt 写入/日志确认失败 | 检查文件完整性/签名/目标、实际 catalog/ledger；日志与文件分别核对 | 不重新 DDL；未来受限 receipt 恢复/重签协议待实现 |
| broker/PG 重启或连接丢失 | 原三条连接失效，postmaster/backend_start 变化；目标保持关闭 | 不能新连接继续旧窗口；按已设计的 HBA/凭据隔离、bootstrap、epoch 接管流程另行实现 |

当前 journal 没有完整的操作系统锁、原 admission/角色/HBA/凭据恢复材料，CLI 成功后也会释放三条连接；这些是已声明的未接线范围。安装脚本没有完整客户端/SQL/锁 deadline。真实维护前需统一为耐久、精确目标绑定的 journal，并落实 3 秒连接、5 秒 SQL、1 秒锁、10 秒 idle、30 秒操作预算及超时销毁；不能仅在外面 Promise.race 后继续复用未取消的连接。

已准备 [technical-broker.cjs](candidates/m5-terminal-preparation/technical-broker.cjs)：同一进程接收已有的三条技术连接，提供 inspect/status/close，记录并复核物理身份，限定检查预算，拒绝重叠检查，失败进入不可重试 BLOCKED 并销毁连接。它不产生 window/lease/service authority；也不能修复 TI-01。此模块没有连接真实开发库，未挂到 CLI/host。

完整维护 broker 仍须另行落实：跨进程维护锁与启动阻断、普通/旧维护通道 HBA 拒绝及凭据轮换、受限 controller/issuer/executor/proof 的独立身份、实际排空、60 秒 window lease/10 秒 barrier 检查、持久 journal、ACK 查询和接管、先 RESUMING 再开库以及最后清 claims。受限 ServiceActor 不复用 postgres 技术安装连接。未完成正常和恢复两条路径前继续 KEEP_ALL_FENCES。

## 真实 Native 参考与本地证据

[准备工具](candidates/m5-terminal-preparation/README.md) 使用实际公开 provisioning 创建 **11 个 Native 表、23 个索引**；包括完整 document/asset schema，而不是先前五个 `(id,payload)` 表。实际 loaded dist 与 bundle 输入 hash 一并记录；tracked Storage/DSL 源码对照本地已有 official commit `1f05a70ac93e09c67fb4d3aafb9c2b068d14fcce` 一致。本轮没有重新构建全部 packages 或获取远端来源。

本轮定向 **11/11 PASS** 指三个问题成功复现、broker 的限定行为通过，不表示问题已经修复。新证据见 [LOCAL 评审证据](evidence/m5-terminal-installer-review-local.json)。原始参考保留 TI-03，标记 `BLOCKED_PROFILE_REVIEW_REQUIRED / UNSIGNED`。为隔离 TI-01/TI-02，后续 loader/broker 探针才在 disposable cluster 撤销 PUBLIC CONNECT；不把这个测试调整写进原始参考。

大型未签名参考和 source bindings 保存于单独 0700 本地目录，避免把 3 MB catalog 重复放入仓库；证据记录文件 hash 和路径。fixture keys/receipt 未导出，临时 cluster 已停止并删除。此参考尚不能成为真实目标的 reviewed expected，也没有真实安装批准/authority 签发。Native public proof worker、真实业务 provenance、终态 finalize、HBA/凭据轮换、PG/network crash recovery、host/enabled gate 均不在本轮 PASS 范围。

下一步：修复 TI-01–03，更新候选来源 hash；重建独立参考并定向验证后，再准备部分安装恢复和持久维护 broker 的正常/接管路径。建议实现使用 GPT-6.1 Sol / high；复杂恢复协议复评使用 GPT-6 Astra / high。

## 2026-10-12 三项修复状态

TI-01–03 已完成候选修复及本地验收，见[修复、参考和恢复接线](zhiban-v2-m5-terminal-ti-fix-local.md)。当前为 ADDRESSED_IN_CANDIDATE / LOCAL_VERIFIED，尚待增量复评。原本轮 11/11 问题复现证据与 hash 继续保持历史范围，不覆盖新来源。
