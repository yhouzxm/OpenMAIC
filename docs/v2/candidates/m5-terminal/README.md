# M5 terminal reconciliation 未应用候选

状态：`UNAPPLIED / UNISSUED / NOT_WIRED / PENDING_RE_REVIEW / KEEP_ALL_FENCES`。依据 [R2 精确设计](../../zhiban-v2-m5-terminal-reconciliation-design.md)及 [TR-01–03 修订](../../zhiban-v2-m5-terminal-reconciliation-review.md)。本目录不在任何 active migration、build、package command 或现有 installer/loader 清单中。

本批产出实际 SQL/helper/ACL 候选及可运行的**离线恢复计划生成器**。`recovery-plan.py` 只检查候选来源、验证封闭请求并生成顺序计划；没有数据库连接、shell、执行开关、凭据读取或自动恢复。计划中的 SQL/helper 调用可供未来持久连接执行器逐步实现与评审；GATE 步骤不是已实现的 pg_hba、凭据轮换、journal、backend broker 或启动阻断。实际执行器和公开 Native proof worker 仍未实现；不得把离线计划视为已通过恢复测试。

## 文件与未来安装顺序

| 文件 | 目标/身份/边界 |
| --- | --- |
| 00-role-bootstrap.sql | 管理库管理员，新增五个 NOLOGIN 角色；只有 observer 获 pg_read_all_stats 的 INHERIT TRUE / SET FALSE 边；原角色不改 |
| 00-catalog-observer.sql | Business 管理员独立事务，创建 observer-owned catalog seam；受限控制文件函数、subscription 元数据列权限；无业务表权限 |
| 01-schema.sql → 02-common-and-history.sql → 03-operation-helpers.sql → 04-control-and-lookup.sql → 05-existing-constraint-supplement.sql → 06-guards.sql → 07-acl.sql | 一个 Business owner 事务，追加 content 0002；事务后由未来 installer 写**本目录 computed aggregate**到 ledger，原 0001 行/文件不变 |
| 08-native-proof-acl.sql | 单独 Native owner 事务，五表 SELECT + stages.UPDATE(id)，不声称 PG 强制只读 |
| 09-catalog-inspect.sql / 10-native-catalog-inspect.sql / verify-profile.py | Business+Native 两个独立 READ ONLY collector；Business 内含 cluster/双库 ACL、observer catalog ACL 和有效权限矩阵；封闭组合及精确 expected/actual 比较，不签发 authority |
| inventory.json / receipt.template.json / resolution-receipt.template.json | 来源、函数/角色清单及两个 UNISSUED LOCAL 模板；runtimeAccepted=false，非签发凭据 |
| recovery-plan.py / recovery-request.template.json | 离线生成 recover/resume 两类计划，参数中只引用私有 capability slot，不输出 secret |
| generate-constraint-supplement.py / refresh-inventory.py / verify-candidate.py | 生成精确差异、刷新来源 hash、离线静态校验；无数据库调用 |

| verify-local-pg16.cjs | 独立临时 PG16 cluster 的定向验证；0700 私有 Unix socket、无 TCP、finally 停止并删除；不读取现有凭据或访问 55432/55433 |

role/catalog bootstrap、Business DDL、Native ACL 是三个不同边界，并非跨库事务。部分安装必须阻断原 host 的旧 profile，且不设置 installations.ready；不能在安装一半时恢复服务。完整 live manifest、角色/credential/admission 审核及本地定向验收完成后，未来 issuer 才能生成新的有效技术安装 receipt 并将 ready 置 true。本 SQL 不 seed installation/service/controller 权限或 role LOGIN/password，因此误加载候选也不会直接产生可用终态授权。

四个既有函数 replacement 使用原 `CREATE OR REPLACE` 保留 OID/proacl；其中 operation_guard、link_consistency、mapping_consistency 由脚本从已有源码做精确替换，business_resource_ready 新增受限服务分支并改为 SECURITY DEFINER。完整原 pointer/publication/actor/history 检查继续存在。额外 BEFORE guards 将 executor 写入限制为私有 transaction scope 的 prepare/generation/content operation 与两条 audit。普通 USER 路径及已有 Bridge SERVICE_RECONCILE+RECONCILE 的无新 reconciliation_id 审计保留原规则。

## 本地最小 ACL 与信任边界

controller/issuer/executor 仅明确签名的 helper EXECUTE，无原始表 DML/SELECT、SET ROLE owner、DDL、Native CONNECT；Native proof 仅独立角色，UPDATE(id) 是实际写权，封闭 proof worker 的语句/参数校验和凭据隔离仍待实现。observer 是 NOLOGIN/no client EXECUTE 的元数据角色，不接触 Native 文档。新增 RLS 全部 FORCE；owner 内部访问通过 explicit policies，客户端不可调用 private scope/history helper。历史校验不依赖当前 service/旧 grant TTL/window/postmaster；跨租户 joins 与资源关系必须完整。

控制器是受信本机维护权，不防御恶意 OS owner/superuser。catalog seam 每次清除统计快照后检查双库 admission、backend 身份、普通 writer NOLOGIN、PG16/system identifier/postmaster、prepared/subscription；Native 扩展/后台写入者、HBA 绕过、登录角色/凭据轮换、参数日志禁用、普通/旧维护凭据负向连接验证等仍由 bootstrap/recovery 执行器与受审 profile 提供，SQL 不自称能在 Business DB 查询另一个数据库的全部 catalog。未完成这些前置验证不能签发或恢复流量。

proof JSON 是受信私有 worker 的限定证明，不是 DB 自行重新读取 Native；grant 的源码/installation binding 必须精确匹配 worker build。两个公共方法各自完整 checkout/BEGIN READ COMMITTED READ WRITE/COMMIT或ROLLBACK/release，保持屏障；关库后不自动补连接。未来 receipt/profile 必须绑定 worker、维护执行器及新 build，并验证 secret 参数不会进入日志。语法解析只证明 SQL/PLpgSQL 的可解析部分，不证明 catalog 解析、RLS 或运行语义。

## installer、receipt 和旧证据的升级清单

- 保留 Identity/Academic/Learning/Assessment applied migrations 和 content 0001 bytes/aggregate；检查先决 ledger 后追加 0002，不能重用 0001 校验结果代替新安装。
- 现 content-receipt.ts 只接受一个 content ledger 0001；现 Native owner/schema ACL/role graph 拒绝 proof role。未来 loader 必须新增显式 terminal profile，保留旧 profile 的严格拒绝行为，不能无条件放宽旧 profile。
- 新 profile 绑定两库角色/ACL、catalog observer seam、四函数差异、RLS 和 deferred 双向约束、控制/证明来源、私有 build、安装配置以及受影响 M1–M4/文本发布回归。旧 receipt 原样保留其 hash 与证据范围，不能重签旧 profile 来承认新 ACL。
- LOCAL/UNISSUED 与 NOT_RUN 保持；完整 enabled gate、生产 signoff、在线 reconciliation、Native GC、缺失/不确定 Native 的结算继续 deferred。NO COMMIT / NO PUSH / NO CI DISPATCH。

## R3 定向修复与可重复验证

read_takeover_result 仅给 controller，需当前 deployment/backend capability。按 service→epoch counter→window→claims 锁序查精确 old/new/request，同时返回当前占用；COMMITTED 不表示 successor 仍可用。回执丢失后由全新 bootstrap 查证，失去控制器的 successor 必须作为新的 old window 在另一明确请求中接管；不重放相同 takeover 或 finalize。离线计划在 conditional 写入前后使用此 helper，未知/不匹配时 STOP BLOCKED。

RESULT_LOOKUP 签发与有效撤销同事务追加不可变 control_events。revoke_result_lookup 新签名 (uuid,uuid,text,text) 的第三参数为撤销 provenance，第四为 controller secret；重复撤销为 no-op，无重复事件。新 v7 domain 允许 NULL，必填列仍有 NOT NULL，以支持初始窗口的空 takeover_request_id。

profile 三部分为 Business catalog、Native catalog、Business collector 内的 cluster/database/observer 权限面。verify-profile.py 要求两个独立 collector 的封闭键集合、PG16/精确库名，检查有效跨库权限、observer 不能整表读取 subscription/subconninfo、Native 仅五表 SELECT 和 stages.id UPDATE；同时完整比较原始 ACL/owner/columns/defaults/roles 等。PG16 既有 PUBLIC 的 subscription 非敏感列读权与 pg_control_system() proacl 如实绑定，不改系统 catalog 默认权限。未来 installer 必须从单独评审、来源绑定的 expected profile 加载预期；禁止签发时把 actual 原样复制为 expected。当前工具仅离线比较，不提供 trusted expected profile 或 receipt issuer。

运行 `node docs/v2/candidates/m5-terminal/verify-local-pg16.cjs --output docs/v2/evidence/m5-terminal-sql-r3-directed-local.json` 可重建独立临时 cluster。原 migration 与候选实际编译；Business scope 为 privileged replica fixture（绕过无关产品 FK/trigger 初始化），Native 为最小五表 ACL fixture。证据只覆盖 domain、权限实际采集/漂移、lookup 审计/回滚/锁、真实接管 helper/新 backend 查证；不覆盖完整产品 provenance、Native public worker、finalize、实际 HBA/凭据/journal 或 host。候选在现有开发库仍 UNAPPLIED、receipt UNISSUED、隔离保持。

## 可信 expected 与技术安装接线（当前 blocked 模式）

新增 terminal-installation.cjs 供持久连接维护 broker 调用，terminal-installer.cjs 提供显式本地安装入口；不进入旧 host loader、旧 build 或 package 命令。原 profile 的拒绝行为保留。11-complete-installation-catalog.sql 补齐旧 Business 六 schema 与 Native public 的全函数/默认值/domain/角色等，和 09/10 组合，安装前后都比对独立参考。

信任根为已有的 owner-only Ed25519 公钥 pin：`~/.local/share/zhiban-m1/terminal-authority-public.pem`；不会从 receipt、目标库或私钥自动替换 pin。私钥单独为 terminal-authority-private.pem，文件 0600、目录 0700、无 symlink。expected 是该根签名的 `REVIEWED_TERMINAL_EXPECTED_PROFILE` envelope，绑定当前 inventory/aggregate、LOCAL、独立 shadow PG16 参考证据 hash 和明确 review approval。参考必须在另一 pristine cluster 从受审源码和真实 Native schema 建成，不能在目标安装时把 actual 复制为 expected。当前本地验证参考为最小 Native fixture，不能直接成为已有开发库的受信 profile。

离线 `terminal-sign-review.cjs --expected` 只签固定私有目录内 terminal-expected-review-draft.json，输出新的 terminal-reviewed-expected.json；`--install-approval` 只签 terminal-install-approval-draft.json，输出 terminal-install-approval.json。已有输出不覆盖；不生成密钥、不查询数据库、不从签发目标采集预期。使用者必须先评审具体 shadow artifact/source/evidence 并预置独立公钥 pin；当前没有为现有开发库生成或签发这些文件。

expected payload 的封闭字段由 trustedExpected 定义：purpose、formatVersion、evidenceOrigin、githubActions、authorityKeySha256、profile、candidateInventorySha256、candidateMigrationSha256、review、before、after；before 为完整 Business/Native catalog，after 为 complete 加 terminal 两组；review 包含 approvalRef、sourceKind=INDEPENDENT_SHADOW_PG16、referenceEvidenceSha256。信任根签名承担参考来源的真实性，程序验证签名和绑定，不能自行证明签名者所做的人工评审。

安装批准另有目的 `INSTALL_LOCAL_TERMINAL_BLOCKED`，绑定 expected 文件 hash、inventory、真实 cluster/system identifier、双库 OID、PG16/port/data directory，TTL≤300秒，并声明 HOST_STOPPED_KEEP_BOTH_DATABASES_CLOSED。CLI 使用固定 terminal-installer-config.json 的 admin/business/native 三个 postgres DSN，只允许 127.0.0.1:55433、管理库和固定双库、专用 pgdata；不读取当前 runtime DSN。普通 writer 必须已 NOLOGIN、全部非 installer backend 已排空、无 prepared/subscription writer。安装入口先验证批准和完整旧 profile，预建其两个目标连接，再仅关闭双库；每库 intent/confirmed 与 DDL 阶段落盘至新 0600 journal。失败不恢复 admission。

Business components 与 computed 0002 ledger INSERT 在一个 owner 事务内；role bootstrap、observer、Business、Native 是分开的边界。Native ACL 失败后允许 Business ledger 已提交，但必须记录 BLOCKED、不签 receipt、不 seed ready/service/grant；本轮验证覆盖这个部分失败。不通过旧 Content installer 或重复迁移“修复”这种状态；实际 partial recovery/reissue 与维护恢复执行器仍待实现。

签发的技术 receipt 使用独立目的 `TERMINAL_TECHNICAL_INSTALLATION_BLOCKED`，状态 INSTALLED_BLOCKED、installationReady=false、runtimeAccepted=false、terminalActionsAllowed=false。新 loader 每次验证签名、来源/目标、精确全 catalog、ledger、双库关闭、安装表没有 ready/authority；对签名正确但伪造 runtimeAccepted 的 receipt 也拒绝。它只可供维护检查，不允许 host 接受该回执或执行 finalize。关闭 admission 后 loader 需要 broker 已持有的连接；独立 --inspect-blocked CLI 无权重新开库，无法连接时拒绝。Native proof worker、持久 broker、HBA/凭据/launcher 和真实启用 profile 仍待完成。

验证器现在用独立参考 cluster 与安装目标 cluster 测试 Ed25519/来源、真实 installer/ledger、blocked receipt loader、SQL/profile 漂移和 Native 阶段失败。R3-01 已补合法 provenance + 审计 INSERT 前触发器的 ZX001 故障；许可与事件都无残留。所有故障触发器、测试 authority/receipt/journal 仅存在于临时目录，finally 停止并删除。

## TI-01–03 修复与恢复观测接线

11/10 collectors 追加确定排序的索引定义、谓词、unique/primary/valid/ready/live，11 另包含真实 DB owner/ACL。installer 在任何 DDL 前检查 Business admission ACL，拒绝未评审 grant；新增 `00-business-connect.sql` 作为独立管理员阶段，保留七个普通 Business CONNECT 后撤销 PUBLIC CONNECT，不修改应用过的 bootstrap/migrations。journal 的 preflight 耐久记录精确 target/source/expected、原 DB ACL/admission 与预持有物理身份。

installer 签名前及 loader 返回前重新核验 source、target、ledger、authority、两库关闭、writer 状态、backend_start 和 postmaster；审批在各 DDL 阶段及签发前检查期限。CLI 连接 3 秒、query/statement 5 秒、lock 1 秒、事务 idle 10 秒。原始维护全过程锁/HBA/恢复协议仍未实现。

新增 `terminal-recovery.cjs`：从绑定 target/source 的 journal 与实际 catalog/ledger 生成只读部分安装报告；`readTakeoverAck` 只接受受限 controller，精确请求、现有 DB controller 授权及每次新 journal；COMMITTED/NOT_OBSERVED 均不提供重放权。ACK helper 有行锁，需要 READ COMMITTED RW 事务。30 秒总体预算/5 秒 SQL，错误或 ACK 丢失销毁客户端，无自动重连/重试。它不执行 migration/receipt 重签、takeover、resume、finalize 或开库。

外部参考/broker 三文件通过 `recoveryWiringSha256` 同样进入 source binding。broker 可持有完整安装或显式 partial-recovery 的原三条连接，失败 sticky BLOCKED。真实 Native 参考使用实际公开 provisioning 和 additive ACL，仍 UNSIGNED_REVIEW_REQUIRED，不是现有开发库的已批准 expected。后续正常/接管执行器及 HBA/凭据/启动阻断必须独立完成，继续 KEEP_ALL_FENCES。

`terminal-installer.cjs --install-blocked-hold` 已提供同进程的 installer→broker 连接交接；成功后仅接收 stdin 的 `inspect / status / close`，不重连目标库。EOF、关闭或信号仅释放持有连接，目标 admission 继续关闭。此入口尚未在现有开发库执行；退出后需要尚未完成的独立维护恢复协议才能安全进入目标库。默认一次性 --install-blocked 仍关闭其连接，不是持续维护入口。

原 Business PUBLIC CONNECT / DB ACL 仅在 journal 留作审计和制定恢复方案。terminal 安装后的已批准 ACL 必须继续拒绝 proof/observer 的 Business CONNECT；不得自动恢复历史 PUBLIC CONNECT。部分安装报告只能给出实际观测和新批准前置条件，不能把 NOT_OBSERVED 当作 rollback 证明。

## 2026-10-13：维护控制执行候选

`maintenance-executor.cjs` 实现正常 PREPARING/DRAINED/renew/resume 和故障 takeover；`maintenance-lock.cjs` 为 Linux flock + 耐久启动标记，`maintenance-hba.cjs` 为原子 HBA/目录 fsync、SCRAM 凭据轮换及真实拒绝探测。`maintenance-cli.cjs --normal|--takeover` 固定使用本机 55433、私有 socket 和拥有的 pgdata；stdin 只接 status/renew/resume/block，EOF/信号保留隔离。本轮只在临时 cluster 调用模块，**未运行真实 CLI**。

入口需要独立 public pin、当前签名 expected、签名 `LOCAL_MAINTENANCE_CONTROL` 精确请求、完整旧凭据清单和管理员私有配置。签名绑定 cluster/postmaster/OID/路径/HBA 原字节、当前 inventory、expected artifact、ready installation 五个摘要、旧凭据文件 hash、mode/deployment/service/window/old/request、批准恢复 LOGIN 子集和最多 300 秒有效期。不能从 INSTALLED_BLOCKED receipt 自动生成 ready/service；执行器也不 seed installation/service、签发 grant、注册 proof 或 finalize。`maintenance-sign-approval.cjs --sign-reviewed-control` 仅离线签受审 draft，不生成 key、参考或 authority。新文件一律 O_EXCL，不覆盖旧 journal/批准。

CLI 固定文件：terminal-maintenance-config.json（只有 adminPassword）、terminal-maintenance-old-credentials.json（8 个普通 writer 和 4 个维护角色的旧密码）、terminal-maintenance-approval.json、terminal-reviewed-expected.json 和既有 public pin。输出 terminal-maintenance-<windowId>.jsonl、旁置 original-hba、terminal-maintenance-<windowId>-credentials.json，均 0600；目录 0700。原 HBA 仅留证，**不自动恢复 trust/peer/cert/PUBLIC CONNECT 或旧密码**。完整请求字段以 executor 的封闭 validator 为准，未提供带真实 ID/凭据的可误用模板。

维护采用独占 flock；dev:zhiban launcher 在任何配置/PG 访问前获取共享锁，传给 host 的 fd 3 防止 launcher 父进程死亡提前释放锁。未适配的旧 host/其他进程仍要停止；数据库级 HBA、NOLOGIN、精确排空独立阻止其旧凭据访问。本轮没有接管系统服务管理器或取消实际外部自动启动任务。维护 flag 不由 finally/TTL 清除，仅在 complete_resume COMMIT 确认后清除。

HBA 只允许所列角色通过唯一私有 Unix socket + SCRAM，所有 TCP、replication、未列角色均 reject；postgres 管理库保留受限 SCRAM 管理通道。普通和全部旧维护密码逐个轮换（SQL 只传 SCRAM verifier），旧值仅用于拒绝探测，不写 journal。要求 PG log_statement=none、log_min_duration_statement/sample=-1、log_parameter_max_length/on_error=0，拒绝相关 pg_db_role_setting 覆盖。真实开发 cluster 尚未配置这些前置条件。

**引导边界补充**：controller_authorizations 的新 PID/start 不能由未授权 controller 自行登记。正常/接管前有短暂 owner bootstrap 子阶段：Native 关闭，普通和其他维护角色 NOLOGIN，Business HBA 仅 postgres + 新 controller 的私有 SCRAM；管理连接仅核对 ready/ledger 并登记新 controller，随后关闭、排空并移除其目标库 HBA 通道。接管 helper 调用时双库中严格只剩新 controller，Native 仍关闭。此子阶段不授业务终态能力，需随本候选复评，不声称原设计已明确覆盖这条管理连接。

正常/接管后预建四条受限物理连接，双库再次关闭；核对完整 signed catalog/ACL（只允许明确列出的 LOGIN 阶段差异）、固定 PID/start/role/OID、system identifier/postmaster、prepared/subscription，renew helper 产生 60 秒租约，8 秒定时核对/续租。单次工作预算 30 秒，连接/SQL/锁/idle 为 3/5/1/10 秒；故障清理只尝试进一步关库/NOLOGIN，记录实际 admission 或 UNKNOWN，不宣称跨库原子性。失败、来源/HBA 漂移、断连均 sticky BLOCKED，无重连。

resume 先 COMMIT RESUMING/撤销未用 grant，再按批准子集恢复新密码 LOGIN 和固定 SCRAM HBA、双库 admission；实测旧凭据拒绝、新凭据可连接，复核完整 profile 后才 COMMIT CLOSED/清 claims、释放启动标记。不修改 runtime.json/content.json，不启动 host；新凭据交付、host 重建/receipt 更新和完整 enabled loader 仍是独立待办。launcher 和新增锁模块已纳入来源绑定，因此旧产品 receipt 不能签收本轮新代码；没有重签已有 receipt。

接管先查精确 ACK；已提交的同一 pair/request 拒绝重放或复活，必须以失联 successor 为 oldWindowId、新的 window/request 接管到更高 epoch。失去 CLOSED ACK 时保留 flag/隔离，当前不会自动清旗或声称已经恢复；需要另行受审的精确 CLOSED 查证/恢复入口。

本地命令：`node docs/v2/candidates/m5-terminal/verify-maintenance-pg16.cjs --output /absolute/new-evidence.json`。只创建唯一 0700 临时 PG16、禁 TCP、socket 56493，finally 停机删除。fixture ready/signature/最小 Native 是模拟授权，不是独立签收；真实 SIGKILL、COMMIT 回执丢失 seam、部分恢复故障分开披露。历史证据仍只适用于原 hash。

## 2026-10-13 R2：bootstrap / 凭据交付 / CLOSED ACK

本节覆盖前文旧行为：**正常 CLOSED 后也保留 maintenance flag**。完成 DB 关闭窗口并不表示产品凭据、build、receipt 已交付；返回 credentialDeliveryReady=false / maintenanceFlagRetained=true，不能启动旧 host。候选执行器和 CLOSED ACK 入口都不再调用 clearAfterClosed；仅测试 harness 在独立场景间显式模拟人工 reset，不能把这种 reset 计作产品交付验证。

owner bootstrap 现在在写入 controller_authorizations 前，对固定范围的完整 Business catalog + terminal Business profile 作 signed expected 比对，并核验 takeover/ACK 的 window/deployment/service 一致。只允许当前 controller 的预期 LOGIN 差异；不调用未比对的 controller helper。Native 的完整 profile 仍在后续四会话形成后、DRAINED 前比对，CLOSED ACK 不开放 Native。

12 个新密码先生成并 O_EXCL/fsync 保存为 PREPARED_UNDELIVERED，然后才逐角色 ALTER；每个角色记录 INTENT/CONFIRMED，故障时文件仍保存完整预定值，不能推断全部已生效。运行期间持续核对凭据文件 hash，改动即 BLOCKED。journal 只记录 hash/阶段，密码只在私有文件；该文件不是 runtime.json/content.json，也不构成产品接收确认。

新增未应用 `read_closed_result(uuid,uuid,bigint,text)`，只授 controller EXECUTE；锁序 controller authorization → service → epoch counter → window → 双 claims。精确绑定 deployment/window/epoch，检查 CLOSED 与 RESUMING 的唯一真实 controller audit、顺序/provenance、旧窗口不占 claims 且无 ISSUED grant。返回 COMMITTED_CLOSED 或 NOT_CLOSED，附当前 claims（可以已属于后继窗口），并固定 replayAllowed/restoreAllowed/clearMaintenanceFlagAllowed=false。它不写 DB，不删除历史，不把后继 claim 视为旧 CLOSED 失败。这个新 helper/ACL 会改变**未应用** Business 0002 aggregate，既有已应用 migration 不变。

`maintenance-cli.cjs --closed-ack` 是显式查证入口，使用新的精确签名 approval：mode=closed-ack、oldWindowId/takeoverRequestId=null、restoreLoginRoles=[]，另有 ackRequestId（UUIDv7）、expectedWindowEpoch（十进制正 int8 字符串）、resumeJournalSha256。它读取固定 terminal-maintenance-<windowId>.jsonl，要求同 deployment/window/cluster/OIDs 的 preflight 和 complete-resume-commit INTENT；为每个 ackRequestId 生成独立 journal/凭据暂存文件，原 journal 不修改。签发仍使用独立 review authority，不从 journal 自动生成批准。

**只有 SQL ACK helper 是只读观察。** CLI 为了安全进入关闭的库，仍需执行批准的维护隔离：flock、预存/轮换凭据、关闭双库、排空、短暂 Business owner bootstrap/受限 controller 通道；核对 ACK 后再关闭 Business、禁用普通及维护 LOGIN、释放连接，保留启动标记。不会创建新窗口、调用 complete_resume、重放 takeover、恢复流量或开启 Native。即使 NOT_CLOSED 也不推断可重试写入；失败/超时只保留隔离和实际状态日志。COMMITTED_CLOSED 仅证明历史提交，不能解除当前隔离或后继窗口占用。

完整凭据交付、host/build/receipt 接收确认以及清 flag 的独立授权协议仍待实现；真实开发库继续未应用、enabled gate UNISSUED。
