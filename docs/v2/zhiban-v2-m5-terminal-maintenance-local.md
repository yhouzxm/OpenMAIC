# M5 维护控制执行器：增量复评与本地验证

2026-10-13。branch `refactor/zhiban-v2`，HEAD `daf63afa83470d24a9ed41d171c6a17f8a80adb6`；工作区非 CLEAN，保留原有候选。状态 **LOCAL_CONTROL_EXECUTOR_VERIFIED / UNCOMMITTED_CANDIDATE / EXISTING_CLUSTER_NOT_APPLIED / KEEP_ALL_FENCES**。没有 commit、push、CI dispatch，没有连接现有 55432/55433，没有更新真实凭据、HBA、receipt 或启动/停止真实 host。

## 定向复评

| 项目 | 结论及增量 |
| --- | --- |
| TI-01 索引/profile | 完整定义、谓词、unique/valid/ready/live 的采集与精确比较保留；真实 Native 负向复验通过 |
| TI-02 最后屏障 | 签名前/loader 返回前重新读取 source、ledger、target、authority、admission、实际物理身份；晚到 admission/LOGIN 负向仍拒绝 |
| TI-03 CONNECT | additive 管理员 SQL 保留批准普通 CONNECT、移除 PUBLIC 继承；已应用 bootstrap/0001 未改；恢复执行器不会恢复原 PUBLIC CONNECT |
| MR-01 journal 字节一致性 | 发现 `boundJournal` 解析一次受限读取、却另一次读文件计算 hash，可能将旧事件与新字节 hash 配对；已改成同一 raw buffer 解析及 hash。最终源 journal hash 复核保留，partial/ACK/broker 回归通过 |
| 技术 broker/ACK | 仍只有观测/持有能力，不能冒充 controller 或继续旧 epoch；新维护控制器独立持有限域角色连接 |

本次为同会话定向复评与实现自检；没有声称独立第二位评审或完整生产审计。

## 已实现

- [维护锁](candidates/m5-terminal/maintenance-lock.cjs)：Linux flock，launcher 共享、维护独占；耐久 0600 flag，进程死亡仍阻断启动；host 继承 fd，父 launcher 死亡不提前解锁。dev:zhiban 启动入口已接锁，锁实现也纳入产品 implementation bindings。
- [HBA/凭据](candidates/m5-terminal/maintenance-hba.cjs)：私有目录校验、原子写/rename/fsync、实际 HBA reload 与认证探测；只有所列角色的私有 Unix socket SCRAM 通道，TCP/replication/未列角色拒绝。轮换 8 个普通角色及 4 个维护角色，SQL 传 SCRAM verifier，密码只入私有凭据文件。PG 参数日志前置条件不满足则拒绝。
- [正常/接管执行器](candidates/m5-terminal/maintenance-executor.cjs)：现有 public pin + 当前 signed expected + 独立精确 maintenance approval；ready installation 五摘要及 ledger 核对；独占锁/日志、双库关闭、全部旧 backend 排空、新 controller 授权绑定、正常 open_window 或精确 ACK→takeover、新四会话预建、再关库、完整 profile/物理屏障、DRAINED/60 秒 lease/8 秒续租。
- 正常恢复先 COMMIT RESUMING，才恢复批准 LOGIN 子集、新密码、固定 SCRAM HBA 和双库 admission；旧凭据拒绝、新凭据连接及全量 profile 复核后才 COMMIT CLOSED/清 claims/清 flag。部分失败尝试进一步关库和所有 writer/维护角色 NOLOGIN，记录实际 admission 或 UNKNOWN，不自动恢复流量。
- [CLI](candidates/m5-terminal/maintenance-cli.cjs) 与[离线控制批准 signer](candidates/m5-terminal/maintenance-sign-approval.cjs)：固定真实目标约束、封闭命令和文件路径、O_EXCL 输出；本轮仅对非法模式作无配置读取的拒绝冒烟，**没有运行真实批准签发或真实维护 CLI**。

执行器不提供 issue_grant、register_proof、finalize、Native 写入、产品凭据文件替换或 host start。技术 blocked receipt 不能触发 ready/service 初始化。来源/锁/HBA/连接失效时 sticky BLOCKED；无自动重连、重放或旧 epoch 复活。

### 必须保留的边界

1. 新 controller 的 PID/start 登记需要短暂 Business 管理会话。已明确为 owner bootstrap 子阶段：Native 关闭，普通与其余维护角色禁用；Business 私有 SCRAM 仅 postgres 和新 controller。登记后关闭管理会话、移除其目标库 HBA、排空，然后调用接管 helper；接管时仍要求双库仅一条新 controller。这是本轮具体化的管理权限边界，后续复评必须覆盖。
2. 签名 expected 的完整目录/ACL 在 DRAINED 前、resume 前及恢复角色后比对；只有清单内 LOGIN 的阶段差异可变。恢复保持 terminal ACL，不恢复历史 PUBLIC CONNECT。签名者依然是受信本地 OS/Ed25519 authority，不宣称密码学双人控制。
3. 旧 host/外部自动启动源需要操作者停止；本轮没有接入真实服务管理器。新 launcher 与数据库 HBA/NOLOGIN/排空共同阻断旧实例；不能把锁本身当作停写证明。
4. 维护命令工作预算 30 秒，连接/SQL/锁/idle 3/5/1/10 秒；故障后的进一步隔离是 best effort，不把跨库 DDL+journal 称为 ACID。停写/角色状态不确定即留 flag，不签恢复成功。
5. `launch.ts` 和锁模块进入 implementation binding，`content-receipt.ts` 增加锁源码。旧真实产品 receipt **不能签收这份新源码**，本轮未重建真实 host 或重签 receipt。下次开发服务启用需先完成新凭据交付、构建与 receipt 核验，不能直接沿用旧 receipt。
6. 丢失 takeover COMMIT ACK 只查询，同 pair 不重放；失联 successor 由新 request 接管到更高 epoch。丢失 CLOSED ACK 仍保持 flag/隔离；精确 CLOSED 查证与安全释放入口尚待实现，不自动清旗。

## 最终来源与证据

当前 inventory SHA256：`0774292a6013eee00e80da90b5c90e294d596c053bbb5f39101dcc537877c046`。terminal 35 文件；外部 source bindings 5 文件（原参考/broker 三文件 + launcher/content-receipt）。Business 0002 aggregate 仍为 `e1e7ea9517462edd855fb8715f49346db4c467c01aac43e8a370c39eebf7184a`，Content 0001 aggregate 仍为 `e335f83bb48cc6c4ec754f8e3270dc0e6941e14f38306bd67aa29844c3713324`。既有 migrations 和 SQL/helper/ACL 语义没有变更，两份 receipt 模板仍 UNISSUED。

| 证据 | 结果 | 适用范围 |
| --- | --- | --- |
| [维护 PG16](evidence/m5-terminal-maintenance-local.json) | **18/18 PASS** | 真 flock/继承描述符/残留 flag；不安全参数日志/篡改签名拒绝；SCRAM/HBA、迟到 idle Native backend 排空、四会话/renew、RESUMING→CLOSED、接管、真实进程 SIGKILL、COMMIT 回执丢失 seam、同 pair 不重放、更高 epoch、ACL/HBA 漂移、部分开库失败、私有日志无密码 |
| [既有定向回归](evidence/m5-terminal-maintenance-regression-local.json) | **50/50 PASS** | R3/helper/ACL/签名 expected/installer/blocked loader/partial recovery/ACK/broker，Native 仍最小 fixture |
| [真实 Native 参考](evidence/m5-terminal-maintenance-native-reference-local.json) | **13/13 PASS** | 实际 provisionNative + public Storage ensure 的 11 表/23 索引；TI 修复及 broker；不覆盖 Native public proof worker |
| [静态 PG16](evidence/m5-terminal-maintenance-static-local.json) | **13 组 PASS** | hash/template/ACL/helper/offline plan；pglast 6.16、PG16.1 grammar，122 SQL / 34 PLpgSQL |
| 定向 TS / CJS / 格式 | **PASS** | launcher 导入依赖闭包的 tsc，候选 CJS 解析、改动文件 prettier；全项目 tsc 未重新运行，历史 OOM 仍不计 PASS |

真实参考重新生成于 `/home/zxm/.local/share/zhiban-terminal-references/maintenance-20261013-1/`，0700/0600，**UNSIGNED_REVIEW_REQUIRED**。新签名 expected 的真实 review/签发仍未完成。未将旧 `/fix-ti-20261012-3/` 参考或旧 50/13 证据替换为新 hash；所有历史 CI/本地记录继续只适用于自己的 SHA/hash/scope。

所有 PG 执行只用新建、禁 TCP、0700 临时 socket cluster，结束已停机删除；维护 harness 为 56493，既有为 56491，真实参考为 56492。维护 harness 中 ready/service/产品 FK 初始化为合成 fixture，自签 authority 仅用于测试，不能证明独立人工批准；真实 SIGKILL 与 driver seam 明确分开，尚未覆盖完整 PG 重启/网络断线/每一崩溃边界矩阵。没有实际业务终态处置、隔离解除、完整 host 回归或 enabled/生产签收。

下一步：定向复评 owner bootstrap、凭据交付/launcher 绑定、部分恢复及 CLOSED ACK 边界；随后补精确 CLOSED 恢复入口与公共 Native proof worker 接线。建议 **GPT-6 Astra / high** 复评；完整 enabled gate、真实维护执行、新 host/receipt、逐笔处置授权仍未开放。

后续状态：本页是初版维护候选的历史快照；其清flag行为、凭据落盘顺序和bootstrap比对时机已由[边界复评与CLOSED ACK接续](zhiban-v2-m5-terminal-closed-ack-review.md)修订，勿将本页旧hash或旧清旗步骤当成当前执行合同。
