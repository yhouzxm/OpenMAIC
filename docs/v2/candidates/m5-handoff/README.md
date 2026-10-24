# 普通 host 交付/清旗：未应用控制候选

**UNAPPLIED / UNISSUED / LOCAL_ISSUER_TLS_HTTPS_WIRED / KEEP_REAL_STARTUP_FENCE**。设计见 [R3设计](../../zhiban-v2-m5-handoff-clear-design.md)，[R2评审](../../zhiban-v2-m5-handoff-candidate-review.md) 与 [R3控制执行器复评](../../zhiban-v2-m5-handoff-executor-review.md)。本目录不是 active migration 目录；没有真实 target 执行命令或 package alias，原开发 host 入口继续保留阻断；新的 ordinary-launcher 是显式候选入口，真实环境尚未交付。

01..03 只在受审 signed INSTALL 批准、双库独立 expected/profile/来源/目标均匹配后，以一笔 Business owner 事务应用，并写入**独立 zhiban_handoff.schema_migrations 0001**；after profile 不匹配整事务回滚。Content 0001、terminal 0002 及原 terminal inventory/35 文件保持原字节。无 Native DDL、role edge 或客户端表级权限；不改 ready/service/window/claims/grants/proofs/租户业务。

HOST 初始只能 REGISTERED，精确 read token/deployment/release/generation/latest epoch/source/profile/config/artifact。收到独立受审 receipt/新 challenge ACK 后 owner 一次封存 ACTIVE，避免未来 receipt hash 环。REGISTERED/ACTIVE 只可撤销，不复活。CLEAR 初始只能 ISSUED，受审独立 clear/gate/pointer/fence/PID/start/postmaster/TTL；guard 与 consume/clear_commits 同一 transaction，deferred 一致性禁止 guard-only/半消费 COMMIT。自动 authorization_events 记录每次状态变化和绑定摘要，append-only/FORCE RLS。

候选实现：handoff-contracts.cjs（签名/私有路径/固定双库 metadata）、handoff-owner.cjs（installer/register/seal/revoke/nonrotating seed）、handoff-executor.cjs（耐久单次 permit、同 flock/CAS、release receipt/ACK、pointer、控制 COMMIT、gate publisher/只读 ACK/control loader）。控制执行器与子进程没有 issuer 私钥或签名 API；独立 receipt-issuer 的受限 API 见下文。没有任意 SQL/角色/DSN命令，没有 unlink flag/自动重试/自动恢复发布。

clear 先暂存并 fsync 精确 signed gate；commit_clear 返回 COMMIT_PENDING，真正 COMMIT 成功后再调用受限 verify_clear_publication 检查当前 ACTIVE/latest epoch/空 claims/单 controller backend/NOLOGIN/过期与已有控制提交。仍持 flock、CAS/source/TTL 有效才 rename/fsync 原 gate 字节。管理连接必须为同一已批准 cluster 的 postgres 管理库；owner/Native target bootstrap 会话已结束；fresh controller 只撤销自身 LOGIN/密码，普通凭据不轮换。部分失败清理保持同一 flock；错误 target 不 ALTER ROLE。未知 COMMIT 或文件 ACK 仅精确查询，COMMITTED 不授重新发布权。

普通控制 loader 同时检查签名 gate、最新 deployment commit（非 per-release 最大值）、ACTIVE/epoch/空 claims、全部 composition ledger、pointer/最高保留 fence、同代叶 hash/receipt/ACK、完整 schema/role/ACL/default/继承 metadata、固定普通端点与双库 OID/postmaster。这里只返回 CONTROL_GATE_VERIFIED，hostStarted/runtimeAccepted 均 false；持共享 flock 到观察结束即释放，ordinary-launcher 已在外层保留共享 fd 并传给真实 HTTPS child；下述 R5 替代本段旧的待接线状态。原 Content 0001 loader 不放宽，也未接此候选。

04 collector 覆盖全部非系统 namespace 和全部非 pg role；05/06 保留 observer/Native proof ACL 检查。signed ordinary expected 必须来自独立 shadow/review，本目录普通 profile 的 expectedReference 仍 UNISSUED/null。prepare、handoff、独立 clear、dormant gate、INSTALL、SCOPE_REVOKE、HOST_ACK 模板全部 UNISSUED。

dependency-closure.cjs 仍只做结构拒绝，physicalFilesVerified=false。真实 target 的 compatibility/transport/shadow 签发、独立真实 expected、实际凭据/TLS信任交付及明确文件恢复批准仍待完成；外部 signed ACK/expected 输入不能由局部测试自动签发。

离线绑定：python3 refresh-inventory.py。静态：PYTHONPATH=/tmp/zhiban-handoff-r3-parser python3 verify-static.py。局部回归：node verify-local-pg16.cjs；控制接线：node verify-executor-pg16.cjs。后两者各建唯一私有禁 TCP socket-only PG16（56494 / 56495），finally 停机删除；不连接 55432/55433，不读真实私有凭据。合成 CLOSED、最小 Native、临时签名/profile/ACK 和 control-fixture 叶不能代替真实产品、依赖/TCP 或完整崩溃验收。

实际 [builder/child接线](../../zhiban-v2-m5-release-build-local.md)：release-builder.cjs离线创建全新不可变叶，打包实际M1–M5 composition、renderer/editor assets、pinned argon2.node及ELF/Node/tool/source manifests；physical-closure.cjs做实际字节/ABI/OS库核验，原dependency-closure.cjs的结构结果不代替它。validation-parent.cjs已接executor.validate；独立签名prepare/profile、同flock/fence、private fd challenge、PID/start/TTL，validation-child.cjs不监听不写业务，guard与Node permission限制加载/FS/网络。旧host入口仍未切换。

新compatibility/transport/shadow模板UNISSUED；缺证返回VALIDATION_INCOMPLETE。实际独立临时PG通过九组只得VALIDATED_FOR_LAUNCH，仍launchAllowed/runtimeAccepted=false。真实target需要独立shadow code/source proof，不能把临时测试签名当实际authority。配置包含且只包含六普通凭据；保持Identity policy/catalog/HMAC/Session，迁移/管理员/issuer/controller不进入配置。构建输入只读明确staging，拒绝直接读真实私有根。

API：release-builder.build({parentDirectory,releaseId,credentialGenerationId,configurationPath})；handoff-executor.validate({controlDirectory,approvalPath,expectedPath,authorityPublicKeyPath,compatibilityReceiptPath,transportEvidencePath,previousCredentialsPath,shadowEvidencePath})，未具备证据传null并保持隔离。issuer/普通supervisor已接下述候选，不自动清旗。新定向验证：node verify-release-pg16.cjs（56496，仅127.0.0.1 TCP/SCRAM与私有socket，finally停机删除）；使用合成授权/CLOSED/最小Native，在真实bundle/native/六角色上实测，不连接55432/55433或重复CI。

## R5：同代签发、TLS 和普通 HTTPS（完成组/退出由R6接续）

见[定向复评与本地证据](../../zhiban-v2-m5-issuer-https-local.md)。receipt-issuer.proposeBundle 给出精确 compatibility/TLS 待审 payload；issueBundle 只接受独立 reviewer 签名批准，绑定 controlDirectory/source/issuer pin 与两份 payload hash。issueHandoff 另有批准并亲自运行新 validation child；没有接收外部 result JSON 的签发捷径。issuer 私钥必须是受限 staging 文件且位于交付/子进程树之外，不进入普通配置或 child fd。管理 transport/shadow attestation 和真实 ordinary expected 仍须独立提供，不能自行从当前库升级成批准。

所有批准在固定 controlDirectory 写 O_EXCL 单次 permit，不因换 outputDirectory 可重放。R6将canonical issuance-complete.json作为唯一提交点，严格绑定groupKind/同代ID/两份固定purpose叶；sidecar没有消费资格。leaf与staged master耐久后才原子rename并fsync目录；提交前失败保持INTENT且全部拒绝，提交后ACK未知返回ISSUANCE_COMMITTED_ACK_UNKNOWN，仅inspectIssuance只读查证，不重签/覆盖/补写。seal及启动/每请求检查整组签名和字节。child 的含旧凭据 request 临时文件结束即删除，保留无秘密的 challenge/result。

release-builder.build 原参数可增加 tlsPaths:{certificatePath,privateKeyPath,caPath}，只读显式 staging。证书要求有效期、127.0.0.1 IP SAN、serverAuth EKU、匹配 RSA 私钥和 pinned CA；把三份原字节纳入不可变 artifact，普通发行必须有 TLS。未给 tlsPaths 的 build 仍只用于验证，不能普通启动。不会生成或安装真实 CA，也不会关闭证书验证。

ordinary-launcher.launch({directory,expectedPath,authorityPublicKeyPath,receiptPath,compatibilityReceiptPath,tlsReceiptPath}) 要求已完成独立 clear、同代 signed gate/DB COMMITTED/ACTIVE/最新 epoch/空 claims/完整 profile/ledger，并核验 completion、TLS、源与物理依赖。它持共享维护锁直到实际 child 结束，fd4 继承该锁，IPC仅传检查消息；child 没有签发/owner/controller配置。实际入口绑定 127.0.0.1:3443，复用冻结 M1–M5 页面/API 适配器及原入口的路径、header/body 限制和局部 CSP。

每个请求在入口及正文读取后再经 supervisor 核验；每秒补做检查。门/来源/receipt/物理产物漂移、撤权、断连、过期或检查失败会停止接收并结束 child/池，超时强制结束；启动端口冲突同样释放锁，无自动重启。维护写方仍须先停 host 再取得独占锁；不为获得独占锁反过来自动删除门。带外 DB 撤权到停止存在检测延迟，已经获准的业务事务不能承诺在撤权瞬间回滚；原业务授权/并发屏障仍有效，完整故障/已入场事务取消不在本次签收内。

R5 验证只用独立56496 cluster、临时CA/密钥/审核人和最小Native；测试本身经真实seal/clear控制路径，再启动真实HTTPS，finally停机删除。没有操作真实55433或本机/浏览器信任库。历史13/23/14证据仍只适用其原inventory；新报告列本次精确来源和结果。

## R6：完成组与有界退出修复

见[修复与真实元数据收集](../../zhiban-v2-m5-completion-exit-fix-local.md)。receipt-completion只认固定canonical master，字段包含groupKind、release/credential/deployment、source和精确两叶hash；验证各叶purpose/signature/同代。inspectIssuance({directory,authorityPublicKeyPath,expectedApprovalSha256})只核验intent及当前文件，返回NOT_COMMITTED_OBSERVED/SIGNED_COMMIT_OBSERVED/UNKNOWN_OR_INVALID，writeReplayAllowed与launchAllowed均false；它不证明曾经fsync成功，不签发、不发布staged master、不删除permit。

ordinary-shutdown限定5000ms本地关闭预算：child先STOP/SIGTERM，1500ms后SIGKILL，确认exit/close；PG750ms graceful后强制destroy，并观察socket close。只有child与所有本地连接均确认关闭，supervisor才释放fd并返回STOPPED；未确认则SHUTDOWN_INCOMPLETE且保留共享fd。IPC disconnect/exit也主动触发关闭；重复stop共用同一关闭过程。本地close不等于PG远端backend排空，维护guard仍须重新物理观测。

verify-completion-exit-local.cjs覆盖publisher/fsync/stage/rename/返回ACK各切点，以及真实pg socket/Node child/flock退出故障；其中auth/profile/TLS显式stub，仅支持关闭边界。verify-release-pg16.cjs另在实际临时PG16/HTTPS验证同代整组、master/成员漂移和真实supervisor SIGTERM/SIGKILL。真实OS掉电、恶意native/管理员、带外撤权已入场事务仍未签收。

collect-delivery-metadata.py是固定无凭据collector：仅工具版本、stat两个PG目录、固定pg_controldata控制元数据和指定端口监听；无数据库连接、pgpass/DSN/SQL、目录扫描、HBA/密钥/config/receipt读取。输出METADATA_ONLY_COLLECTED，不产生expected/批准或收集敏感输入。
