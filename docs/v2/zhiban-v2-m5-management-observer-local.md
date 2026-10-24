# M5 管理观察执行器与真实授权准备

2026-10-13（Asia/Shanghai）。branch refactor/zhiban-v2 / HEAD daf63afa83470d24a9ed41d171c6a17f8a80adb6；保留原dirty worktree。**LOCAL_VERIFIED_CANDIDATE / REAL_TARGET_NOT_EXECUTED / REAL_APPROVAL_UNISSUED**。本轮仅独立disposable PG16验证及离线授权包准备，没有读取真实config/HBA/pgpass/guard/receipt/密钥，没有启动或连接真实55433/HTTPS3443；NO COMMIT/PUSH/CI。

2026-10-14接续：[定向复评](zhiban-v2-m5-management-observer-review.md)复现OR-01–04四项P2，当前真实签发/执行为CHANGES_REQUIRED。本页33/33保留原范围，不覆盖新增切点；运行candidate/source未改。[输入更新](evidence/m5-management-observer-real-inputs-review-r1.json)按用户“保留待补”维持真实私有路径与authority为null，不授读取或启动。

同日后续：[四项修复及守锁终态](zhiban-v2-m5-observer-or-fix-local.md)已LOCAL51/51、静态12组，source更新447a2b38…c0869；原33/11与e776…记录保持历史范围。真实输入仍按用户选择待补，不自动签发/启动。

## 实现与故障边界

[执行器候选](candidates/m5-readonly-startup/README.md)要求受信Ed25519签名及外部pin，绑定当前observer/R6源码、PG16目标/系统ID/owner、完整配置闭包、独立私有pgpass摘要、现有lock dev/inode和BLOCKED门字节、固定二进制及启动argv。批准TTL不超过300秒，永久单次permit与新stage防重放；UNISSUED/缺项/错源/扩大写权限在任何启动前拒绝。当前源绑定见本页证据，不把HEAD单独当dirty源码签收。

执行器不复用会创建门的maintenance acquire helper。只打开同一现有锁；stage是该control根下唯一新子目录，原配置/HBA/凭据/guard不覆盖。精确管理socket只允许postgres库/postgres SCRAM，Business/Native直接连接拒绝、TCP关闭。固定SQL是READ ONLY pg_catalog观测，不产生CLOSED/profile/expected/shadow/transport或启用证据。

PG配置闭包可包含明确批准的include文件；拒绝include_dir/include_if_exists/转义歧义/额外文件/缺文件/循环。auto.conf当前必须无活动设置，否则停止并另审；此约束没有查看或改写真实auto.conf。原配置仅私有预审、不纳入最小stage config；所有关键设置明确覆盖，实际postmaster argv、SQL身份与隔离设置另核验。

启动或工具ACK未知只核验本attempt的实际PID/start ticks、data/socket/port、exe和完整argv；不可绑定则LIFECYCLE_UNKNOWN，不能停止陌生/已有postmaster或重放start。fast stop仅一次；即使工具ACK丢失，也须独立证明同一进程消失、control shut down、PID/socket/监听消失，且原guard/lock未漂移，才释放。启动批准同时覆盖该attempt的必要退出清理，即使采集失败或TTL到期也不能留下无处置记录的结果。

独立guardian持同一OFD锁，父SIGKILL/断IPC/审计写失败保持锁；记录和释放ACK未完成不签收释放。UNKNOWN记录可通过inspect读取；它不是历史耐久性证明或恢复/解锁权限。无真实恢复API。测试只在确认本fixture PG停机后清理自己的custodian，不能复制到真实运维。

末轮诊断并修复了PID-file时间与SQL postmasterStart的错误同值假设：实际观察合法差值1.016秒；PG16分别用MyStartTime填PID文件、在稍后阶段设置PgStartTime，SQL函数返回后者。最终用实际SIGSTOP延迟初始化复现更大合法差值，分别保留PID秒数和SQL时间事实，以采集前后精确PID/start ticks/exe/完整argv证明同一进程；tuple漂移仍拒绝观测并保留custody，而非放宽时间容差。[PG16 PID文件实现](https://raw.githubusercontent.com/postgres/postgres/REL_16_STABLE/src/backend/utils/init/miscinit.c)、[PgStartTime初始化](https://raw.githubusercontent.com/postgres/postgres/REL_16_STABLE/src/backend/postmaster/postmaster.c)、[SQL时间函数](https://raw.githubusercontent.com/postgres/postgres/REL_16_STABLE/src/backend/utils/adt/timestamp.c)

## LOCAL 证据

[生命周期证据](evidence/m5-management-observer-pg16-local.json)与[离线静态证据](evidence/m5-management-observer-static-local.json)绑定本轮最终observer inventory；测试密钥/密码/guard/authority只属于fixture。实际PG16、SCRAM、socket、READ ONLY事务、postmaster、Node guardian和flock经过验证；ACK丢失/拒绝工具/进程切点由仅限disposable的test adapter注入。没有模拟签收真实authority。

最终**生命周期33/33 PASS、静态11组PASS/11条SQL（PG16.1语法解析）**；实际运行PostgreSQL16.15、Node22.23.3，独立56497。observer inventory为 `e776806ccc2465de7d845a8525416c0f80ab49d39c9cd0d8cdf3b168cae66030`，14文件绑定，含inventory共15文件。证据仅在finally确认PG停机和测试root移除后保存PASS；本轮故障诊断的中间hash不冒充最终来源。

覆盖正常采集、错误密码无fallback、签名/TTL/来源/写scope/目标/UNISSUED拒绝、既有锁与缺锁、auto.conf活动项/二进制漂移/pgpass wildcard/控制身份拒绝、已有postmaster保持、实际HBA双库拒绝、start/stop ACK丢失、stop拒绝与无绑定startup UNKNOWN、tuple漂移不stop、SIGTERM清理、SIGKILL前后custody、custodian审计写失败保持、单次重放拒绝，以及Business/Native哨兵数据与原配置字节不变。临时root在finally停机/移除，真实55432/55433未使用。

R6 handoff inventory仍 `fa51a67d9733fc6b436e89ec339306472ceb8566368cc3f9ce3c3122d873c13b`，0001 aggregate仍 `bbede0be2e773562730bb2b1c756d4aceba853143b298b768de7c0d70d624a8e`；原22/29/23/17和复评1/1保留原范围。上一方案5ae0c9cc…a310/静态9组是历史未执行方案，不适用于本轮新增执行器；[原观测manifest存档](evidence/m5-readonly-startup-plan-inventory-r0.json)与原静态输出保持该来源，本轮新hash不会重绑定历史证据。

## 具体真实授权包

[离线真实输入包](evidence/m5-management-observer-real-authorization-packet.json)固定data/system id/55433/postgres管理范围，记录当前source及本机公开PG16/Node二进制hash；**INCOMPLETE_UNSIGNED_PACKET / executionAllowed=false**。当前尚不具备实际control/auth路径和原配置/guard/锁/authority输入，未知值为null；不能凭fixture补齐，不能当启动批准。

两阶段顺序：

1. 先提供实际现有control根、独立staged pgpass路径和受信authority公钥/pin；单独批准读取包列出的真实postgresql.conf/auto.conf及明确include闭包、固定目标元数据和已提供control/auth元数据。不可凭根配置自动遍历未批准include目录或发现旧秘密。
2. 私有预审通过后填实际guard/CAS、lock dev/inode、pgpass和config闭包摘要、新attempt/stage、精确argv hash；独立审核人员核对后确认一次管理观察及PG内部生命周期写入范围，再由既有可信authority签发fresh封闭envelope。无fixture signer、无泛化长期批准。

本次不请求“现在启动”的泛化批准。未来具体批准只覆盖一次start→固定READ ONLY→ROLLBACK/关闭→精确fast stop和独立查证；不覆盖重启、immediate、PID删除、fallback、凭据轮换、持久HBA/config改写、安装/签发/clear/ordinary启动。主机掉电、杀死guardian、同owner/DB管理员攻击、Native物理闭包和完整enabled gate仍未签收，UNKNOWN/RESERVED保持。

下一步定向复评签名权限、guardian释放/部分审计失败、配置闭包与真实授权输入边界。建议GPT-6 Astra / high承担这次生命周期及权限复评；已明确的普通后续接线可用GPT-6.1 Sol / medium。
