# M5 管理观察：签名、custody 与配置闭包定向复评

2026-10-14（Asia/Shanghai）。branch refactor/zhiban-v2；HEAD daf63afa83470d24a9ed41d171c6a17f8a80adb6；原dirty worktree保留。结论：**CHANGES_REQUIRED / OR-01–04 OPEN / REAL_AUTHORIZATION_BLOCKED**。本轮仅复评、独立disposable故障复现及未签真实输入包整理，未修改observer/R6运行候选或inventory，未读真实config/HBA/pgpass/guard/密钥，未连接或启动真实55433/HTTPS；NO COMMIT/PUSH/CI。

后续同日用户已授权并完成[OR-01–04修复与终态验收](zhiban-v2-m5-observer-or-fix-local.md)：新source447a2b38…c0869、LOCAL51/51及静态12组；四项为ADDRESSED_LOCAL，待独立复评。下文是原e776…评审/复现，不能作为新source的运行结论；真实批准及输入仍UNISSUED/PENDING。

## 四项发现

| ID / 优先级 | 触发、实际结果与影响 | 代码位置 |
| --- | --- | --- |
| OR-01 / P2 | 实际PG已确认停止后，guardian先关闭fd3再发送released；丢失这条ACK会使父执行器进入LIFECYCLE_UNKNOWN，返回lockRetained=true、lockRetainedByCustodian=false。CLI退出后父fd也关闭，独立flock观察锁实际可取得。UNKNOWN“保留锁”不是退出后的事实；stop已确认也被同一confirmed变量改回未知 | [guardian](candidates/m5-readonly-startup/observer-guardian.cjs#L27)第27–35行；[收尾](candidates/m5-readonly-startup/observer-executor.cjs#L197)第197–207、500–548行 |
| OR-02 / P2 | journal对fs.writeSync的正返回字节数不检查。release intent注入实际仅写7字节、fsync成功，record仍返回true，guardian释放且父返回OBSERVED_STOP_CONFIRMED；完整journal随后不能解析。短写未异常不代表完整耐久事件，违反“记录未完成不签收释放” | [journal](candidates/m5-readonly-startup/observer-contract.cjs#L274)第274–284行；[record/release](candidates/m5-readonly-startup/observer-guardian.cjs#L19)第19–35行 |
| OR-03 / P2 | pgpass hash/精确五字段只在启动前校验；START_BOUND之后路径字节漂移，psql仍按该路径消费。探针仅追加comment、不改真实fixture密码，即可得到OBSERVED_STOP_CONFIRMED，而实际文件hash与签名批准不同。现有批准不能证明消费的是批准字节，外部认证staging替换/维护期间不拒绝 | [前置校验](candidates/m5-readonly-startup/observer-preflight.cjs#L49)第49–77行；[连接](candidates/m5-readonly-startup/observer-executor.cjs#L384)第384–427行 |
| OR-04 / P2 | `include = 'unlisted config.conf'`不匹配窄include路径正则，却匹配随后普通GUC赋值正则；configurationClosure只有原conf/auto.conf两叶仍被接受。一个未列出的有效include不被递归核验，闭包摘要不完整。当前observer用独立最小config，没有执行该原include；问题是错误接受预审闭包，而非已证明隐藏hook执行 | [配置解析](candidates/m5-readonly-startup/observer-preflight.cjs#L19)第19–38行 |

没有新P1或真实越权执行证据。四项均是本候选明确承诺的审计/收尾/输入绑定缺口，须在真实批准前关闭。不得因PG确已停止或guard仍BLOCKED而将UNKNOWN锁持有/完整审计/闭包签收标为成功。

## 签名权限与通过的边界

封闭purpose/status/LOCAL、外部DER-SPKI pin、Ed25519签名、source/target/UID、<=300秒TTL、精确拒绝写scope、O_EXCL单次permit与fresh stage本轮未发现独立绕过。humanAuthorizationRef由受信签名承载，字符串自身不能证明人类已批准；真实publicKey/pin必须由可信外部审核提供，不能从payload、生成器、fixture或同一待审包自选为信任根。

批准将真实control根绑定在payload内，但具体根是否与ordinary/维护共用仍须真实输入证明。当前不能通过新建根/flag/复制fixture补齐。批准只授权管理观察及必要生命周期写入，不产生terminal/clear/receipt/expected或ordinary启动权限。OR-03表示签名证明了声明，未闭合实际消费输入。

配置的显式include图、cycle/缺叶/额外叶、auto.conf仅空行/注释、固定stage HBA/ident/config、空preload、显式pg_ctl start args与采集前后精确进程tuple保持原范围；include keyword落入普通赋值的OR-04须先修。OS owner/PG管理员/受信二进制及系统依赖仍是原信任边界，本复评不宣称系统沙箱或完整OS恢复验收。

## 独立复现与证据边界

[LOCAL复现原件](evidence/m5-management-observer-directed-review-local.json)：**四项REPRODUCED + 哨兵数据不变，共5个断言检查通过**；这不是修复PASS。使用原未改fixture的初始化/收尾代码、实际observer、PG16.15/SCRAM/psql、Node进程与flock；仅ACK丢失/短写/输入漂移在[独立worker](evidence/probe-observer-review-worker.cjs)和[短写guardian适配器](evidence/probe-observer-review-guardian.cjs)注入。[入口](evidence/probe-observer-review.cjs)仅替换原harness的测试正文；所有适配器先拒绝非/tmp/zhiban-observer-pg16-*、56497。进程退出后再观察lock，避免把父仍活着时的fd误作耐久custody。

每项中实际PG均停止；原BLOCKED门未清，原配置/双库哨兵保持。finally确认测试root停机/移除后才保存复现证据。无真实凭据、HBA修改或迁移应用。observer inventory仍 `e776806ccc2465de7d845a8525416c0f80ab49d39c9cd0d8cdf3b168cae66030`；R6仍 `fa51a67d9733fc6b436e89ec339306472ceb8566368cc3f9ce3c3122d873c13b`，handoff0001 aggregate仍 `bbede0be2e773562730bb2b1c756d4aceba853143b298b768de7c0d70d624a8e`。

原observer33/33、静态11组、R6及原CI保留其来源和覆盖范围。本轮不机械重跑它们，也不以原PASS覆盖新切点。新增探针/报告不进运行candidate inventory，不重绑定历史证据。

## 修复方向与验收范围

1. OR-01先明确独立的STOP_CONFIRMED、release intent/completion与custody状态。用耐久、attempt/approval/source/guard/lock绑定的实际释放结果查证或可靠custody交接关闭不确定性；没有可核验持锁者/完成事实时CLI不能退出并宣称持续保锁。不能简单追加一轮ACK重试来消除最后一条ACK丢失；不得自动清旗/重启/新attempt绕过。
2. OR-02 journal需写全全部UTF-8字节再fsync；0返回/错误/部分写后fsync失败都不得签收完整记录或释放。损坏既有journal只读标UNKNOWN，不删除/截断来修复。补release短写正返回、0返回、fsync失败，及父/guardian各切点。
3. OR-03消费前固定批准的pgpass快照，放在本attempt独立私有认证staging（仍在data/control树之外）；记录/校验实际供libpq消费的摘要，原staging变化必须拒绝或保持明确未知。补原路径替换/追加、前后漂移与认证失败；不改变postgres密码、不读取旧私有源做fallback。
4. OR-04在普通GUC路径前先分类所有include关键字。不能解析的include语法明确拒绝，不把它当普通设置；保留只读预审和显式路径图。补带空格/#/转义等不支持的include拒绝，并保留现有合法include/循环/缺叶检查。

这四项方向尚未实现，不是新冻结合同或当前运行授权；只改未应用候选，已应用migrations及业务语义保持。

## 真实输入继续待补

用户于2026-10-14回复**“保留待补”**。见[本轮未签输入包](evidence/m5-management-observer-real-inputs-review-r1.json)：已补复评gate、当前来源及公开二进制hash核验；actual control根、pgpass staging、受信Ed25519公钥/pin、真实config/guard摘要、lock dev/inode、attempt/精确argv、human ref/TTL/signature继续null。没有扫描原私有根或默认读取~/.pgpass/runtime.json，不从历史产品receipt取真实authority。

状态为REVIEW_BLOCKED_INPUTS_PENDING、executionAllowed=false。四项关闭且真实输入经明确授权预审后才能形成可签发的具体一次观察包；本轮不创建真实根、authority、凭据或permit。UNKNOWN/RESERVED、完整enabled gate、Native实际proof/physical closure、普通HTTPS启用保持既有隔离/deferred。

下一步先明确OR-01释放终态与custody交接，再修复OR-01–04、更新observer hash及本地故障验证。建议GPT-6 Astra / high处理该收尾协议和四项修复，真实输入按用户选择继续待补；不新增CI。
