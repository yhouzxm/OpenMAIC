# M5 R6 修复定向复评

2026-10-13（Asia/Shanghai）。branch refactor/zhiban-v2，HEAD daf63afa83470d24a9ed41d171c6a17f8a80adb6，保留原dirty worktree。结论：**ACCEPTED_FOR_BOUNDED_LOCAL_FIX / REAL_STARTUP_NOT_AUTHORIZED**。本轮未发现新的启动授权绕过或阻断缺陷；没有修改运行代码、52文件候选或inventory，没有启动真实PG/HTTPS、连接真实库或读取认证配置。无commit/push/CI dispatch。

## 完成组、查证与退出

| 边界 | 复评结论与依据 |
| --- | --- |
| 唯一完成点 | receipt-completion只认canonical master，严格groupKind/同代ID/source/两leaf hash及purpose/signature；sidecar没有fallback资格。普通消费者还执行完整payload/profile/gate/DB commit约束 |
| 提交前部分失败 | leaf与staged master不具备消费资格；原13个切点验证提交前双拒绝、提交后统一观察。永久permit不授自动重签/补发布权 |
| 提交后ACK未知 | issuer返回inspectionRequired；只读inspect核对intent/精确approval/master与leaf，SIGNED_COMMIT_OBSERVED只表示当前字节有效，不证明历史fsync或生成发布/启动权。任一错源/签名/同代/兄弟字节拒绝 |
| 启动及运行 | 组只证明文件完成；仍需signed gate与匹配DB COMMITTED/ACTIVE/最高epoch/空claims/profile/ledger。运行中复查组；master或兄弟丢失即停机 |
| 退出 | child确认exit/close；idle PG不再只等待end Promise，而在750ms后destroy并观察socket close；只有child与全部本地连接确认关闭才释放fd。5000ms是响应正常时的工作预算，不能当OS绝对时限 |
| 不确定退出 | SHUTDOWN_INCOMPLETE保留fd，不把后来的进程退出自动提升成成功，不把本地关闭当远端backend排空；下游维护仍需物理观测与既有guard |
| 信任范围 | 同OS owner、DB superuser、已批准native/PG二进制属于信任边界；Node/JS guard不是对恶意管理员或addon的系统沙箱。完整OS掉电/恢复、已入场事务的原子撤销和真实enabled gate仍deferred |

此前R6故障22/PG16-HTTPS29/控制23/静态17仅保留其原范围。本轮没有机械重跑这些套件；核对四份原件均为inventory `fa51a67d9733fc6b436e89ec339306472ceb8566368cc3f9ce3c3122d873c13b`、handoff0001 aggregate `bbede0be2e773562730bb2b1c756d4aceba853143b298b768de7c0d70d624a8e`。

## 新增独立补证

[探针](evidence/probe-m5-r6-incomplete-exit.cjs)使用原R6 harness及实际ordinary-launcher/pg socket/Node child/flock，注入“无法证明child退出”的观测结果；auth/profile/TLS明确stub。父进程实际返回SHUTDOWN_INCOMPLETE，本地PG已关闭、child仍活着时锁仍被持有；child随后实际退出，父fd仍保留，不静默转成功。测试仅在确认child死亡后手动清理自己的临时fd，不能当真实恢复API。

[LOCAL补证](evidence/m5-r6-incomplete-exit-review-local.json)：**1/1 PASS**，绑定实际launcher/shutdown字节和原R6 inventory。没有真实PG或HTTPS，不签收真实授权/profile；临时协议对端、child、私有文件及fd均清理。此前纯helper的unknown观测用例之外，补上了实际supervisor保留锁分支的行为证据。

## 下一包

[受控启动与只读采集方案](zhiban-v2-m5-readonly-startup-plan.md)和[未执行附件](candidates/m5-readonly-startup/README.md)已准备。第一次仅管理postgres库、独立私有socket、TCP关闭和SCRAM/HBA隔离；不会恢复普通业务流量或为Bridge/Runtime签发证据。配置预审、实际guard/lock状态、私有staging/认证路径尚未具备，本页不授权这些读取或启动。

[方案离线补证](evidence/m5-readonly-startup-plan-static-local.json)为9组PASS/11条SQL，独立方案inventory `5ae0c9ccde876f713f8c02c04567bc2a4273255a2600e615ec5516986b53a310`；不改原R6 hash，也不签收真实认证或生命周期。

下一步实现并复评这个管理观察执行器的配置依赖闭包、生命周期绑定和错误清理，然后形成具体人类授权包。建议GPT-6.1 Sol / medium承担已明确的实现；若scope扩大到角色/HBA持久变更或恢复协议，再独立安全复评。
