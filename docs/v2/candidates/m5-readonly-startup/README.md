# PG16 管理观察候选

**UNAPPLIED / NO_REAL_EXECUTION / REAL_APPROVAL_UNISSUED**。接续[本地验收](../../zhiban-v2-m5-management-observer-local.md)、[四项复评](../../zhiban-v2-m5-management-observer-review.md)与[守锁终态精确设计](../../zhiban-v2-m5-observer-custody-design.md)。真实输入保持“保留待补”。

- contract/preflight：封闭Ed25519批准、外部pin、source/target/TTL/单次permit，现有lock/guard，显式配置图及已批准认证字节。include必须先分类；不支持语法拒绝，auto.conf无活动项。
- 新批准必须包含authenticationStageDirectory和privateAuthenticationStaging=true。原pgpass单次读取/验hash/五字段；本attempt私有0400快照在data/control树外，dev/inode/hash绑定，psql只消费该副本。前后校验原输入和副本；漂移不fallback、不轮换DB密码。确认停机/未开始后仅清理自建快照；未知保留。
- executor/custody/guardian：PG_STOP_CONFIRMED、GUARDIAN_DEPARTED和全局RELEASE_CONFIRMED独立。guardian-release-authorized叶只授权离开；父必须核验同代binding及实际child exit，再fresh校验stop/guard/lock，写完整父授权并close自己的最后fd。released通知丢失不会把已确认PG stop倒退。
- 不确定收尾：可核验guardian持fd则持续custody；否则父持自己的fd、保持resident事件循环并拒绝SIGTERM/SIGINT退出，结果明确PARENT_CUSTODY_HELD。不自动重启guardian/PG、新attempt、清旗或解锁。SIGKILL/同时杀所有持锁者不能保证OS flock存在，持久BLOCKED始终保留。
- journal全UTF-8字节写完再fsync，独立flock串行整帧；0/错误/部分失败不签收事件，坏日志不截断。结果记录在已知全局release之后失败仅RELEASED_RESULT_UNKNOWN，不假称仍持锁。
- stop-proof/两个release-authorized叶都是私有LOCAL本地收尾事实，没有签名发行、clear、ordinary/Runtime启用权。文件存在本身不证明OS进程exit或全局锁释放。inspect如实报告损坏日志UNKNOWN，仅查证，无恢复/重放/解锁能力。
- 测试driver/guardian仅允许/tmp/zhiban-observer-pg16-*、56497；生产CLI没有故障环境开关。测试authority/密码/target不能填真实输入包。

```text
node observer-cli.cjs observe <private-issued-envelope> <approved-public-key-path> <externally-trusted-DER-SPKI-sha256>
node observer-cli.cjs inspect <private-attempt-stage>
```

prepare-observation-packet仅来源/公开二进制离线准备，真实control/auth/authority继续null；不读真实输入、不生成签名。旧schema/source批准失效，旧33/11及REPRODUCED保持各自来源。

离线检查用verify-plan.py（PG16.1 grammar）；生命周期用verify-observer-pg16.cjs，独立PG16无真实config/凭据。固定server argv、精确socket SCRAM/HBA及READ ONLY SQL；不读租户/Native文档，不调用应用helper或migrations。真实PG启动的PID/control/WAL/检查点及可能内部维护写入仍须具体批准；stop后audit stage保留，正常启动另给精确args，不盲用restart/postmaster.opts。

同OS owner/PG管理员、受信binary/系统依赖、硬件/内核可用性仍是既有边界。没有生产/enabled gate或完整OS掉电恢复签收。
