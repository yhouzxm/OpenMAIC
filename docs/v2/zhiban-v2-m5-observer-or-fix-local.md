# M5 observer OR-01–04 修复与守锁终态本地验收

2026-10-14（Asia/Shanghai）。branch refactor/zhiban-v2 / HEAD daf63afa83470d24a9ed41d171c6a17f8a80adb6，保留原dirty worktree。**ADDRESSED_LOCAL / UNCOMMITTED_CANDIDATE / REAL_APPROVAL_UNISSUED**。用户授权明确终态并修复四项；未读真实config/HBA/pgpass/guard/密钥，未启动/连接真实55433/HTTPS，未改已应用migration或冻结业务语义，NO COMMIT/PUSH/CI。

## 终态与四项修复

[精确终态设计](zhiban-v2-m5-observer-custody-design.md)已绑定新inventory，源码见[候选](candidates/m5-readonly-startup/README.md)。PG_STOP_CONFIRMED、GUARDIAN_DEPARTED、全局RELEASE_CONFIRMED分别核验；本地authorization叶只授权离开，不单独证明fd释放，更没有签发/清旗/启动权。

| Finding | 实现 | 定向证据 |
| --- | --- | --- |
| OR-01 | guardian完整审计后生成绑定stop-proof/source/attempt/approval/guard/lock/身份的离开授权；父核对实际child exit和同代叶，再fresh检查stop/guard/lock并关闭自己的最后fd。丢通知仅releaseAckUnknown，PG stop不倒退。失败guardian永久HOLDING；未知release进行中由resident父保持fd，不把“当前仍有guardian fd”误作稳定交接 | 丢release通知仍准确RELEASE_CONFIRMED；缺/错binding叶父实际持锁；guardian授权后暂停不释放，晚退出后父锁仍在；丢永久hold通知仍由父持锁；SIGTERM拒绝与测试专属SIGKILL清理 |
| OR-02 | UTF-8 Buffer写全、0/错误拒绝、再fsync；独立journal flock串行完整写帧。部分坏journal保留并inspect标UNKNOWN；guardian不离开。已知全局release后的结果记录失败单独RELEASED_RESULT_UNKNOWN，不谎称持锁 | 实际7字节正短写循环拼全含中文审计；0/部分ENOSPC/fsync失败均不生成离开授权，保留PG_STOP_CONFIRMED与实际guardian锁；结果记录失败后锁实际可取得但release事实不倒退 |
| OR-03 | 批准增加authenticationStageDirectory及privateAuthenticationStaging=true；原pgpass只读一次、hash/五字段验证，新私有0400快照在data/control树外，绑定dev/inode/hash。psql只消费副本，前后检查原输入和副本。已停/未开始才仅清理自建快照，未知保留；原文件/DB密码不写不轮换 | 原输入在连接前/期间/之后漂移均拒绝；期间实际SCRAM用批准快照成功后仍拒绝漂移原来源；快照漂移不连接且保留实际guardian custody；正常原凭据字节保持、副本已清理；旧scope拒绝 |
| OR-04 | include关键字在普通GUC前分类；不支持的空格/#/转义路径明确拒绝。显式合法include图、缺叶/循环/extra叶与auto.conf无活动项规则保留 | 三种不支持include均在stage/start前拒绝，已批准合法include仍正常采集；原config不改写、不实际加载 |

PG停机已确认但release/审计失败时stopConfirmed仍true，releaseState分别CUSTODY_HELD或PARENT_CUSTODY_HELD。只有已证明永久拒绝departure的guardian及实际fd，或从未发出release请求，父才可交其custody并退出。resident父拥有真实fd、保持有引用的事件循环、拒绝SIGTERM/SIGINT；未提供真实恢复/解锁API。

NOT_STARTED与停止过本attempt PG不同；已有陌生postmaster永不被停止。源码没有自动restart、immediate stop、PID删除、fallback、清旗或新attempt绕过。实际guardian和父均被强杀/主机掉电不能承诺OS flock仍存在，持久BLOCKED/permit/intent保持。授权叶存在本身也不能恢复服务。

## 最终来源与 LOCAL 证据

observer inventory：`447a2b38dfc4692fea08fe75c3bc191234dbfecce8771fa8c82c8285a4ec0869`；16个文件绑定（含inventory共17文件），另1个精确设计source binding。旧e776…批准/schema不能消费新代码；新增auth staging字段/范围必须明确签入未来真实批准。

[PG16生命周期原件](evidence/m5-management-observer-or-fix-pg16-local.json)：**51/51 PASS**，实际PostgreSQL16.15、Node22.23.3、独立56497；涵盖受影响原33场景及18个新增检查。本轮不重跑R6/Identity/Storage全套或CI。实际PG/SCRAM/READ ONLY/client/postmaster/Node进程/OFD flock；仅ACK/文件I/O/字节漂移/信号切点由明确disposable-only adapter注入，不等同真实authority/硬盘掉电签收。证据在finally确认PG停止、测试root移除后保存，业务/Native哨兵及原PG配置不变。

[静态原件](evidence/m5-management-observer-or-fix-static-local.json)：**12组PASS / 11条SQL / PG16.1 grammar（pglast6.16）**；模板UNISSUED/null、source/固定HBA/读白名单及负向语法、设计绑定。解析器恢复到独立/tmp测试目录，无系统包或项目依赖改动。

R6 inventory仍 `fa51a67d9733fc6b436e89ec339306472ceb8566368cc3f9ce3c3122d873c13b`，handoff0001 aggregate仍 `bbede0be2e773562730bb2b1c756d4aceba853143b298b768de7c0d70d624a8e`；terminal/已应用migrations不变。旧observer33/11、四项REPRODUCED及[原manifest](evidence/m5-management-observer-inventory-r1.json)按e776…保留，不重绑定为新修复证据；R6、原CI各自旧范围保持。

## 真实输入与下一包

[本轮未签输入包](evidence/m5-management-observer-real-inputs-or-fixed.json)已更新source/schema及auth staging/收尾范围；仍**INCOMPLETE_UNSIGNED_PACKET / executionAllowed=false**。用户“保留待补”继续有效：actual control/auth/publicKey pin/config/guard/lock/attempt/argv/human授权/TTL/signature保持未知/null，未自动造根、造flag、生成authority或读取旧秘密。四项为ADDRESSED_LOCAL，未宣称独立复评或真实运行通过。

下一步定向复评guardian永久hold/迟退出、两个本地离开授权与resident退出边界、认证快照清理及源绑定，再按用户提供的实际输入准备私有只读预审。建议GPT-6 Astra / high承担该复评；不新增CI或真实启动。
