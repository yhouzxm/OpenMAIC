# M5 完成组与退出修复、本地切点验证及无凭据输入收集

2026-10-13；branch refactor/zhiban-v2；HEAD daf63afa83470d24a9ed41d171c6a17f8a80adb6。接续[两项复评](zhiban-v2-m5-completion-exit-review.md)，状态LOCAL_FIX_VERIFIED / REAL_AUTHORITY_PENDING。本轮用户明确“先收集无凭据元数据”；不读真实凭据/pgpass/HMAC/私钥/HBA/receipt，不连接真实PG，不安装/签发/清旗/启动真实host。无commit/push/CI dispatch。既有dirty worktree保留；SQL/helper/ACL与已应用migration未改。

## 修复结果

R1：新增[ordinary-shutdown](candidates/m5-handoff/ordinary-shutdown.cjs)。5000ms本地退出预算；child确认exit/close，1500ms无退出则SIGKILL；PG允许750ms graceful，之后destroy并观察真实socket close。supervisor只有child和全部本地PG socket确认关闭才释放共享fd、完成STOPPED。未确认返回SHUTDOWN_INCOMPLETE、保留fd，不宣称结束；重复stop共用同一过程。IPC disconnect/exit主动触发关闭，覆盖原依赖close事件的等待空隙。PG远端backend drain始终另验，字段remoteBackendDrainConfirmed=false；共享fd仍存活时不得解除维护屏障。

R2：[canonical完成组](candidates/m5-handoff/receipt-completion.cjs)仅接受issuance-complete.json，绑定groupKind、release/credential/deployment/source、固定两叶purpose/hash/signature。sidecar无权限、不再生成。publisher先耐久写叶和staged master，再原子rename canonical master并fsync目录。提交前失败ISSUANCE_NOT_COMMITTED且双叶均拒绝；提交后rename/fsync ACK未知返回ISSUANCE_COMMITTED_ACK_UNKNOWN，两叶由同一master统一观察。只读inspectIssuance验证原intent/approval hash与组，返回NOT_COMMITTED_OBSERVED/SIGNED_COMMIT_OBSERVED/UNKNOWN_OR_INVALID，不改变字节、不重签/补写、无重放/启动权。SIGNED_COMMIT_OBSERVED表示当前文件有效，不伪造历史fsync或崩溃耐久证明。seal、loader及每次普通请求还复核完整组，master/成员丢失或漂移会拒绝/停机。

## 定向验证与适用范围

[verify-completion-exit-local](candidates/m5-handoff/verify-completion-exit-local.cjs)使用临时签名key、实际publisher/completion/inspection以及真实pg.Client 8.22.0 socket、Node child和flock。关闭用例的auth/profile/TLS明确stub；不以它签收实际授权。切点涵盖leaf写入/文件fsync、stage、rename前后、目录fsync、返回ACK丢失；提交前全拒绝、提交后统一分类/只读查证。另验证sidecar无替代资格、兄弟字节变化使整组失效、健康/idle peer stall/active query/拒绝SIGTERM/spawn失败/IPC断开/重复stop/未确认退出。

真实PG16/HTTPS回归另建唯一临时56496 cluster，临时CA、reviewer/issuer、合成CLOSED/profile、最小Native；实际builder、验证child、seal/clear与普通HTTPS。新增master/成员漂移停止、实际supervisor SIGTERM/SIGKILL后的child退出与锁释放。原维护控制23项继续复跑，旧R5/R3证据不换绑新source。

最终候选共 **52 文件**（含inventory）；inventory `fa51a67d9733fc6b436e89ec339306472ceb8566368cc3f9ce3c3122d873c13b`。handoff0001 aggregate仍 `bbede0be2e773562730bb2b1c756d4aceba853143b298b768de7c0d70d624a8e`，terminal prerequisite inventory仍 `4e5585a55aae259a39ac5c0aa01f40e66c4dbb138d99b2d093c626565c9d662a`。四份新证据绑定同一来源和SQL aggregate，SQL/helper/ACL未改。

- [完成组/退出切点](evidence/m5-completion-exit-fixed-local.json)：**22/22 PASS**，13个publisher/ACK切点、sidecar/兄弟漂移、7种实际本地关闭故障和未确认退出的合成观测。idle peer stall 764ms；拒绝SIGTERM 2269ms。这些计时是本机故障注入事实，不是OS无条件时限保证。
- [实际PG16/HTTPS](evidence/m5-completion-exit-fixed-pg16-local.json)：**29/29 PASS**，真实builder/validator/普通child/CA握手与完成组/成员漂移、supervisor实际SIGTERM/SIGKILL、原六角色/旧凭据等定向场景。
- [受影响控制回归](evidence/m5-completion-exit-fixed-executor-local.json)：**23/23 PASS**，fixture明确使用新canonical组，未知COMMIT/部分发布/并发撤权/owner控制边界保持。
- [静态](evidence/m5-completion-exit-fixed-static-local.json)：**17组 PASS**，36 SQL / 10 PLpgSQL，PG16.1 grammar。

临时PG、证书/签名key/发行目录与子进程均清理；端口56495/56496/3443无测试监听。旧复评REPRODUCED及R5证据仍绑定其原source，未改写历史或重复GitHub。

## 无凭据真实输入收集

仅[固定collector](candidates/m5-handoff/collect-delivery-metadata.py)读取工具版本、两个PG目录stat、pg_controldata控制头与指定端口监听；不扫描原私有目录、不读取认证/config/HBA/receipt或访问PG。元数据只用于I01初步准备，不是运行中SQL观测、profile、CLOSED/claim/OID、transport/shadow证明或真实签发授权。结果及缺项见[交付输入清单](zhiban-v2-m5-real-delivery-inputs.md)。

[无凭据元数据](evidence/m5-real-inputs-metadata-r6-local.json)状态METADATA_ONLY_COLLECTED，观察时间 `2026-10-13T14:34:13.045239+00:00`。Node v22.23.3、pnpm10.28.0、pg_controldata工具16.15；两个固定PG目录均canonical、zxm/uid1000、0700。控制头system identifier `7694054813252049413`，状态 **shut down**；指定端口只有127.0.0.1:55432监听，55433/3443无监听。没有启动或连接真实55433；控制头不等于运行中SQL事实，也不是维护窗口CLOSED或启用批准。

真实Business/Native OID、最新postmaster/epoch/claims/完整profile/ledger、门/fence/pointer/技术receipt、staging凭据/authority/TLS及transport/shadow仍未收集。下一采集阶段需具体的55433受控启动、管理库只读观测与认证来源方案；“无凭据元数据”范围不包含这些动作。

下一步：定向复评新canonical提交点/只读查证和有界退出；随后准备独立expected/shadow及明确staging输入路径，凭据/签发/安装/清旗仍需具体授权。建议GPT-6.1 Sol / medium推进已明确的输入整理；如授权/恢复协议发生新变化，再用GPT-6 Astra / high复评。

测试worker额外验证target必须是LOCAL_DISPOSABLE、56496、同一临时fixture的data/socket路径；明确拒绝真实target配置。初次无凭据观察原件亦保留其原source，最终R6元数据与四份验证证据绑定当前inventory。
