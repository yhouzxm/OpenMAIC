# 管理观察：停止终态与守锁交接精确设计

2026-10-14（Asia/Shanghai）。本轮用户授权明确终态并修OR-01–04；仅未应用observer候选与disposable验证。真实输入继续“保留待补”；不读真实私有输入、不操作55433，不改R6/已应用migration/业务语义，不commit/push/CI。

## 三个独立事实

| 事实 | 确认条件 | 不能推出 |
| --- | --- | --- |
| PG_STOP_CONFIRMED | 原attempt进程tuple已消失、PG16 control/系统ID/状态正确，PID/socket/监听消失；持同根lock，guard仍匹配 | guardian/父fd已释放、结果文件已耐久 |
| GUARDIAN_DEPARTED | 本guardian的已绑定本地release authorization叶耐久、完整journal接受，且实际child已退出 | 父fd或全局flock已释放；叶本身只授权离开，不能单独证明退出 |
| RELEASE_CONFIRMED | 前两事实和fresh守卫/锁检查通过，父release authorization记录耐久，父最后fd实际close成功 | gate已CLEARED、普通host可启动或结果ACK已送达 |

NOT_STARTED独立于PG_STOP_CONFIRMED：没有提出本attempt start时不声称停止过任何PG；收尾仍重新确认目标stopped及guard/lock以允许清理本attempt。部分安装/已有陌生postmaster不被本观察执行器停止。

## 正常与丢ACK交接

1. 父一直持同一OFD，先证明PG stop（或本attempt NOT_STARTED），生成闭合的stop-proof。绑定attempt/approval/source/target/guard/lock/guardian身份与实际tuple；技术LOCAL事实，不是issuer签名receipt或启动能力。
2. guardian收到唯一release请求，核对stop-proof/intent/自身fd和身份、现有guard与lock；完整审计后O_EXCL写guardian-release-authorized。此叶是耐久离开授权，写入发生在关闭其fd之前，不能将文件存在当“已释放”。
3. guardian关闭自身fd，发送通知并退出。父等待实际child exit，按精确身份校验同代authorization及stop-proof。通知丢失仅releaseAckUnknown=true；文件和exit已查证则GUARDIAN_DEPARTED成立，不重发release、不重置已确认的PG stop。
4. 父再次检查stopped/guard/lock，完整审计并写parent-release-authorized后，实际close最后fd，记录RELEASE_CONFIRMED。结果写入/审计ACK再失败只标RELEASED_RESULT_UNKNOWN；不谎称UNKNOWN仍持锁，不自动重写/重放。
5. 授权叶都是本地私有、O_EXCL、带source/attempt/approval的收尾事实。它们没有签发/清旗/启动权；inspect只读，不单凭文件推断当前OS持锁或历史fsync。

## 未知与持锁者

| 场景 | 行为 / 对外状态 |
| --- | --- |
| PG stop未证实 | stopConfirmed=false，LIFECYCLE_UNKNOWN；有可核验guardian fd则交其持续custody，父可退出 |
| PG已停但guardian audit/authorization失败 | stopConfirmed保持true；releaseState=CUSTODY_HELD，LIFECYCLE_UNKNOWN；guardian继续持锁 |
| release请求进行中，guardian仍活着但未证明离开或永久拒绝 | 即使当前fd仍存在也不能将其当稳定接管者；父保持resident custody，防guardian延迟离开后丢掉最后fd |
| guardian已退出但authorization缺失/损坏 | stopConfirmed保持；父是唯一持锁者，保持有引用的resident事件循环，拒绝SIGTERM/SIGINT自动退出；输出PARENT_CUSTODY_HELD，不能退出并宣称持锁已交接 |
| 任何同代字段/guard/lock漂移 | 不释放、不清旗；核验实际fd持有者，保存明确未知，不自动新attempt或重启guardian/PG |
| 完整授权与child退出已查证，released通知丢失 | 明确RELEASE_CONFIRMED/releaseAckUnknown，不能倒退成“PG未知且仍持锁” |
| 父SIGKILL在guardian离开前 | 独立guardian持锁；BLOCKED/permit/intent保留 |
| 父SIGKILL在已批准guardian离开后 | PG已确认停机、两个本地收尾授权/guard保留；全局fd可能随父死亡关闭。inspect如实UNKNOWN，不发启动能力；不承诺SIGKILL后父唯一fd仍存活 |

resident parent不是新恢复API；正常/未知路径都不自动接管、重放、清旗、安装或签发。SIGKILL/主机掉电/同owner管理员属于既有边界；将父与guardian均强杀不能维持OS flock，持久BLOCKED仍拒绝ordinary入口。冻结的UNKNOWN/RESERVED业务状态完全不动。

失败的guardian departure只尝试一次；拒绝后永久进入HOLDING，并通过绑定guardian身份/stop-proof摘要的custody-held通知确认不会继续或重试离开。父只有核验该通知和实际fd，或从未发送release请求时，才能将未知custody交给guardian并退出。单纯读取“当前仍有fd”不足以证明未来持续持锁。

## 审计与认证输入

journal使用UTF-8 Buffer写全，0/错误拒绝，再fsync；独立journal flock串行整个写全过程，防短写重试与另一writer拼接。部分失败已有字节不截断、不删除；inspect将坏journal标UNKNOWN，guardian不以坏审计批准离开。

批准增加明确authenticationStageDirectory与privateAuthenticationStaging范围。新auth stage在原pgpass父目录下、位于data/control树之外、private/canonical/本attempt唯一。读取批准pgpass一次并核对完整hash/五字段，O_EXCL写0400快照并绑定dev/inode/hash。psql只消费该快照；消费前后同时核对原输入及快照，原路径漂移不能改成隐式fallback。PG停止/未开始且收尾可证时只删除自己绑定的快照及空auth stage；未知时保留。原pgpass和DB密码不写、不轮换。

include关键字在普通GUC前分类；不支持空格/#/转义路径则明确拒绝。合法显式图/cycle/缺叶/额外叶与auto.conf空活动项保持原规则，原config不会被observer实际加载。

## 定向验收

保留同工作包原生命周期场景，新增release通知丢失、授权缺失/损坏且guardian退出、resident parent真实持锁与signal边界、guardian/父审计短写/0/ENOSPC/fsync失败、结果记录ACK失败、原认证路径和快照前后漂移、原secret不变与正常快照清理、include特殊语法拒绝。证据绑定最终新observer inventory；旧e776…/33/11及四项REPRODUCED保持历史范围。真实授权包仍UNISSUED，不给真实运行签收。
