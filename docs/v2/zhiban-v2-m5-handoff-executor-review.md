# M5 handoff SQL/profile、owner 边界及控制交付执行器 R3

2026-10-13。branch `refactor/zhiban-v2`，HEAD `daf63afa83470d24a9ed41d171c6a17f8a80adb6`，保留既有 dirty worktree。**定向自复评 / UNAPPLIED_CONTROL_EXECUTOR_CANDIDATE / KEEP_REAL_STARTUP_FENCE**。无 commit/push/CI dispatch；真实 55432/55433 cluster、私有凭据、receipt、HBA、host 和启动标记均未操作。

本轮接续 [R2 未应用候选](zhiban-v2-m5-handoff-candidate-review.md)。本页明确区分“控制执行器已接线”与“真实普通产品 host 已交付”：本轮只完成前者。未知提交/文件恢复仍无自动重放权。

| 发现 | 修订与实际边界 |
| --- | --- |
| HC-06 / P2：owner 直接 INSERT ACTIVE 可以绕过登记及一次封存；种子/撤销缺少原子控制留证 | INSERT 只允许 HOST=REGISTERED、CLEAR=ISSUED；自动 authorization_events 在同一 DB 事务记录登记、封存、撤销、消费、绑定 digest、实际 session actor。审计 append-only / FORCE RLS，普通客户端无表权限。owner/postgres 仍是既定受信管理边界，不能宣称防管理员篡改。 |
| HC-07 / P2：profile roles 固定过滤清单看不到清单外角色 | 新 collector 比较全部非 pg 角色，保留完整 namespace/函数/ACL/默认权限/继承关系检查。正常 LOGIN 必须精确为六普通角色及 postgres；只在受审 seed 的短暂预开阶段允许一个 controller LOGIN，最终 guard 要求其 NOLOGIN。 |
| HC-08 / P2：按 release 取最大 clear commit，可让更早 release 在同 epoch 下显示 COMMITTED | helper 取 deployment 最新 fence commit；只有其 release 与请求一致才产生 COMMITTED。loader 再核对当前签名 gate、全部 composition ledger、pointer、最高保留 fence、ACTIVE token、双库 OID/admission/同 postmaster 与固定连接端点。 |
| HC-09 / P2：owner/物理 bootstrap 尚未接线；直接 pg_stat_activity 在 SET ROLE owner 后隐藏其他 backend 信息 | 固定 owner 模块只核验受审双库 target/profile/source/ledger/latest CLOSED 后 seed；物理会话使用既有受限 observer，不扩大 owner catalog/原生表权限。fresh controller 绑定 PID/start/postmaster、精确独立 clear 批准；只撤销 controller LOGIN/密码，不轮换普通凭据。 |
| HC-10 / P2：部分失败清理若在 flock 外或核验前执行，可干扰另一个操作或错误 cluster | 清理位于已获独占 flock、已核验签名 purpose 和同 cluster 管理连接的作用域内；目标不匹配不 ALTER ROLE。种子/guard/COMMIT/文件任一步失败关闭已转交会话并记录真实阶段。失败可能已部分提交，因此不回滚声称“未发生”。 |

HC-06–10 **ADDRESSED_IN_CANDIDATE**。未发现需改写已应用 migration 或冻结业务语义的理由。新增控制审计没有使用租户审计例外；不写 installation ready、service、window、claims、grants、proofs、资源或租户业务。

## 已接入的候选接口

- [handoff-contracts.cjs](candidates/m5-handoff/handoff-contracts.cjs)：独立 pin 的 Ed25519、闭合 purpose/字段/TTL/source、双库固定 catalog、独立 signed expected、私有叶文件及无额外产物检查。executor 不签名，不把当前实际 catalog 转为受信 expected。
- [handoff-owner.cjs](candidates/m5-handoff/handoff-owner.cjs)：新的 handoff schema 独立一事务 installer；REGISTERED、一次 ACTIVE 封存、精确签名撤销、非轮换 clear seed。controller 与 host 没有 seed/DML 权限。
- [handoff-executor.cjs](candidates/m5-handoff/handoff-executor.cjs)：同一 flock 下耐久单次 permit、精确 CAS、seal 后写入 release 内 receipt/ACK 并原子发布 pointer；begin/commit guard、真正控制 COMMIT、fresh publication 检查、原字节 gate rename/fsync；独立 ACK 查询无消费/发布/重放权。受限普通 loader 只作持共享锁的控制事实观察，不 spawn host，不交付运行租约。

新 INSTALL / SCOPE_REVOKE / HOST_ACK 模板及先前所有模板 **UNISSUED**。prepare 与 clear 仍分 purpose；gate 的签名不代替 DB COMMITTED。host ACK 必须由独立受信输入绑定新 challenge、实际验证 evidence digest 与所有组结果；执行器自己不生成或伪造这些产品验证结果。REGISTERED/ACTIVE 撤销不等同撤销数据库普通 LOGIN，也不证明已运行进程全部停止；真实 supervisor 的 fd 继承和持续撤权检查尚未接线。

## 本地验证及适用范围

最终来源与结果见本页末尾及 [执行器证据](evidence/m5-handoff-executor-pg16-local.json)、[受影响候选回归](evidence/m5-handoff-r3-candidate-pg16-local.json)、[静态证据](evidence/m5-handoff-r3-static-local.json)。不改写 R2 的 cfcdca… 历史证据；原 terminal 30/50/13 和 Storage/Identity CI 证据仍只适用于其原来源/范围。

新的临时 socket-only PG16（56495，私有唯一 0700 目录、禁 TCP、finally 停机删除）执行实际 SQL 和 PG transaction/锁。覆盖：安装后 profile 不匹配整事务回滚、直接 ACTIVE/CONSUMED 插入拒绝、闭合签名/目的/来源/过期、一次登记/封存、错误 challenge、审计 ACL/append-only、symlink/hardlink/额外叶/字节漂移、flock 竞争、当前普通受限读取、role/schema 漂移、较早 release 失效、读取/guard 与撤销两种先后顺序、撤销后 token/clear seed 拒绝、已知提交后文件失败、实际 COMMIT 已成功但回执丢失、fresh exact ACK 不发布不重放。

**证据只支持局部控制候选。** CLOSED history 使用特权 replica 合成 fixture，Native 最小表集合，authority/profile/receipt/ACK 是临时测试值，artifact 只有明确 `NOT_A_PRODUCT_HOST` 的控制 fixture 叶。测试 ACK 各组 true 是 fixture 输入，不是六角色产品验证事实。不能据此签收真实 expected、原生 ABI/OS 库/loader instrumentation、TCP/SCRAM 与旧密码负探测、兼容 M1–M5 receipt、真实产品页面、完整 OS 崩溃/重启或生产 enabled gate。本轮未运行原 402 或 GitHub 重复回归。

## 下一步

先定向复评本轮控制执行器的签名输入、部分封存/发布故障及 loader 边界；随后实现真实不可变 release builder、物理依赖闭包/argon2 原生 ABI 证明、实际只读 validation child 和同代兼容 receipt，准备独立普通 shadow expected。之后再接六角色 TCP/HBA 凭据交付与真实普通 supervisor。真实 installer/receipt/清旗执行需要上述具体产物的独立批准，不因候选通过而自动执行。

建议模型：**GPT-6 Astra / high** 用于本轮授权/并发边界复评；后续 builder/验证进程实现可用 **GPT-6 Sol / high**。

最终来源与计数：候选共 **27 文件**，inventory `a31d8cf76ff35ae38635f94fb644168334d3e20292a43d9f7438c6e978292027`；新 handoff 0001 aggregate `bbede0be2e773562730bb2b1c756d4aceba853143b298b768de7c0d70d624a8e`。LOCAL 执行器 **23/23**、受影响候选回归 **12/12**、静态 **10组**（36 SQL statements / 10 PLpgSQL functions，PG16.1 grammar）均 PASS；三份证据逐一核验同 inventory/aggregate。原 terminal inventory 仍 `4e5585a55aae259a39ac5c0aa01f40e66c4dbb138d99b2d093c626565c9d662a`，Content 0001/terminal 0002 checksum 不变。
