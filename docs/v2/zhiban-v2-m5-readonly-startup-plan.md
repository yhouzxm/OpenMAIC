# M5 真实PG16受控启动与只读采集方案

2026-10-13（Asia/Shanghai）。初版状态为**UNISSUED_PLAN / REAL_TARGET_UNEXECUTED**；后续用户已授权实现及disposable验证，[管理观察执行器](zhiban-v2-m5-management-observer-local.md)现为LOCAL_VERIFIED_CANDIDATE，真实批准仍UNISSUED。接续[R6定向复评](zhiban-v2-m5-r6-directed-review.md)。初版仅准备方案、模板、SQL及离线验证；接续也没有读取真实config/HBA/pgpass/receipt/密钥，没有启动或连接真实55433，无commit/push/CI dispatch。

2026-10-14复评：[OR-01–04四项P2已复现](zhiban-v2-m5-management-observer-review.md)，当前真实签发/启动BLOCKED，执行器尚未修复。用户选择“保留待补”，真实输入保持null；先明确释放终态与custody交接、修四项并更新局部证据，不能以本方案或旧33/33批准执行。

后续已按用户授权完成[精确终态及四项修复](zhiban-v2-m5-observer-or-fix-local.md)，新source447a2b38…c0869、本地51/51/静态12组。PG stop、guardian离开、全局release和结果ACK分别记录；原方案字段由新增auth staging与终态合同补充，旧批准失效。真实签发/启动仍UNISSUED，输入继续待补。

## 目标与观测基础

| 项目 | 已有依据 / 本方案目标 |
| --- | --- |
| 来源 | branch refactor/zhiban-v2，HEAD daf63afa83470d24a9ed41d171c6a17f8a80adb6；实际R6 inventory fa51a67d…3c13b，不能只用HEAD签收dirty代码 |
| cluster | 无凭据控制头system identifier 7694054813252049413；PGdata /home/zxm/.local/share/zhiban-m1/pgdata；owner zxm/uid1000；0700、canonical |
| 最近观测 | [R6元数据](evidence/m5-real-inputs-metadata-r6-local.json)于2026-10-13 22:34:13 +08:00记录shut down；55433/3443无监听。后续执行前必须重新核验，不能把旧快照当当前状态 |
| 管理观察 | 仅postgres管理库、postgres角色、port55433的Unix socket；不接Business/Native库，不提供TCP55433/HTTPS3443 |
| 产出 | cluster/PG16/data/socket/postmaster、Business/Native OID/admission、无密码角色属性、backend身份及prepared数量；OBSERVED_MANAGEMENT_ONLY，不产生expected/receipt/transport/shadow/运行许可 |

PG的空listen_addresses会关闭TCP，仅保留Unix socket；使用新的受审stage socket目录而非原普通socket，目录0700、socket0700。[PG16连接配置](https://www.postgresql.org/docs/16/runtime-config-connection.html)

“只读”指本次客户端事务和SQL清单。PG启动/停止仍会写PID、control、postmaster.opts、WAL/检查点等正常内部文件；autovacuum=off也不能承诺消除防wraparound维护。此正常生命周期写入必须包含在以后启动批准内，本方案不做业务DML或修改已应用migration。[PG16 autovacuum](https://www.postgresql.org/docs/16/runtime-config-autovacuum.html)

## A：配置与认证来源预审（也尚未授权执行）

1. 明确一个新的canonical stageDirectory/attemptId、0700目录及同owner0600文件；位于原数据/认证根之外。提供单一pgpassFilePath，不把密码发到聊天、argv或普通环境变量；不默认读取原私有配置来拼装认证。
2. 仅在未来明确读取授权下审计原postgresql.conf、postgresql.auto.conf及全部includes/引用路径，保留原文件字节和私有hash；配置可能含primary_conninfo等秘密，结果不贴原文。选定PG16 postgres/pg_ctl/psql二进制的canonical路径、字节hash与版本。预审不是启动，不执行配置命令、LOAD或连接。
3. 验证PG_VERSION/控制头、真实clean shut down、无standby.signal/recovery.signal及未绑定既有postmaster；不能删除PID/socket文件来“解决”状态不明。读取postmaster.opts仅限私有保管/摘要，不把pg_ctl status可能输出的参数原样展示。
4. 确认旧host/supervisor已停、3443与真实TCP55433均无监听。核验同一现有maintenance.lock的private/canonical/dev+inode和原启动门hash；要求门保持BLOCKED/现有隔离。缺失门/锁或guard状态未知则停止，不在此阶段自动创建/清旗或覆盖。
5. 独立读取批准覆盖实际存在的fence/pointer等守卫元数据；若handoff尚未安装、文件不存在，如实记录，不伪造阶段完成。读取范围不包含普通readSecret、issuer key、业务数据或Native文档。
6. 形成私有配置闭包预审报告、固定启动参数与HBA/config/SQL hash，再提出一次性启动/关闭/管理SQL采集的具体人类授权。模板的null字段和executionAllowed=false不能被当运行批准。

## B：一次隔离管理观察（以后单独批准）

| 顺序 | 行为 | 拒绝/完成条件 |
| --- | --- | --- |
| 1 | 刷新A的来源、目标、stopped与守卫CAS；O_NOFOLLOW打开同一个现有lock并非阻塞取独占flock | 不创建lock或flag；被普通host持锁、inode/门漂移立即拒绝 |
| 2 | 在批准stage中生成新的最小config、management HBA、socket、0600日志和输出文件 | 原持久配置/HBA不覆盖；所有文件有明确hash，禁止任意path/DSN/参数fallback |
| 3 | 用固定PG16二进制和明确start args启动一次，等待最多30秒；持锁覆盖整个观察生命周期 | 不restart/promote；工具超时不等于未启动，不自动重放 |
| 4 | 核验新PID/start/exe/data及socket；无TCP监听；用显式stage pgpass非交互连接postgres | 目标与实际system id不符、身份/端点/设置不符或异常backend，停止采集并进入精确处置 |
| 5 | 运行固定management-observe.sql，BEGIN READ ONLY、超时、catalog白名单，最后ROLLBACK | 当前SQL只能pg_catalog；不读密码/DSN/HBA options，不执行自定义helper或DDL/DML |
| 6 | 核对两目标DB存在、实际OID、PG16/primary、无普通client backend/prepared txn，以及空preload/worker配置；保存私有OBSERVED元数据与source/attempt绑定 | 无法证明的项为UNKNOWN，不修改datallowconn、角色、ready/service/window/claims/grants或prepared状态 |
| 7 | 关闭客户端；仅对本attempt已证明的postmaster做fast stop，最多30秒；检查PID/start/控制头/socket/监听和连接排空 | 不停止陌生/既有cluster，不自动immediate stop或kill无绑定PID；ACK未知只查证并保持隔离 |
| 8 | 确认本attempt postmaster/连接已结束、原guard字节未变后才释放现有独占锁；保留审计/stage文件 | 不启动普通host、不恢复原入口、不签发/清旗；未确认时标LIFECYCLE_UNKNOWN，记录保持的锁/阶段并等待明确处置 |

future执行器必须持久记录INTENT→实际PID/start→观察结果→STOP_REQUESTED→STOP_CONFIRMED；记录内容不含密码/参数日志原文。阶段结果未知不创建新attempt绕过原状态。SIGTERM/SIGKILL、工具ACK丢失、认证失败和停止失败要先在disposable cluster验收，再请求真实执行。

### 固定启动参数

[request.template](candidates/m5-readonly-startup/request.template.json)列所有固定server overrides。关键项：listen_addresses空、port55433、stage unix_socket_directories/hba_file/config_file、data_directory固定真实路径；preload为空，logical/parallel/background worker额度0，archive/restore/primary连接空，SSL与外部PID关闭，default_transaction_read_only=on，参数/语句日志禁用、仅private stderr，jit关闭。原auto.conf/includes即使仍被PG读取，也不得改变已批准关键覆盖值；未知启动hook或无法审清的依赖则停止。

命令形状只供审查，尚无可执行参数包：

```text
/usr/lib/postgresql/16/bin/pg_ctl start
  -D /home/zxm/.local/share/zhiban-m1/pgdata
  -p /usr/lib/postgresql/16/bin/postgres
  -l <approved-stage/private-startup.log> -w -t 30
  -o <exact reviewed postgres argument vector encoded for pg_ctl>
```

所有参数须由封闭契约构造，不能拼接任意shell片段；只用start且显式-p/-D/-o。pg_ctl超时后后台动作可能继续；restart会复用postmaster.opts，因此观察停止后仍保留stage审计，未来正常启动必须另外批准完整args，不能盲用restart或恢复旧options文件。[PG16 pg_ctl](https://www.postgresql.org/docs/16/app-pg-ctl.html)

### 认证与客户端

[management-only HBA](candidates/m5-readonly-startup/management-only-hba.conf)仅local postgres/postgres SCRAM，其余local/all/replication及IPv4/IPv6拒绝。普通角色没有此次入口。不得改为trust/peer、重设postgres密码、创建角色或自动授权限来使采集成功。

客户端固定psql -X -w、显式host=<新私有socket>、port55433、database/role均postgres、ON_ERROR_STOP=1；清理继承的PGSERVICE/PGDATA/PGHOST/PGPASSWORD/PGOPTIONS与动态库环境。仅显式PGPASSFILE路径和固定非秘密startup options：default_transaction_read_only=on、session_preload_libraries空、local_preload_libraries空，防止角色/库默认启动设置重新引入preload。认证失败就结束，不交互询密码、不换来源重试。

pgpass须0600/同owner无link，匹配**新socket目录路径**、55433、postgres、postgres五字段。自定义socket目录不应误用127.0.0.1条目；localhost回退仅在文档指定默认socket条件下适用。本机审核格式不展示密码值。[PG16密码文件](https://www.postgresql.org/docs/16/libpq-pgpass.html)

### 采集SQL与秘密边界

[SQL候选](candidates/m5-readonly-startup/management-observe.sql)输出5类JSON：管理身份/实际设置、两库OID/admission、非pg角色属性、backend PID/start/role/dbOid/type、目标库prepared数量。无pg_authid、rolpassword、stat_activity.query、application_name、subconninfo或业务表；错误原文/原日志仅留私有stage，用户报告仅固定阶段/安全错误码。

此第一包不读Business/Native profile、账本、CLOSED/epoch/claims、read token或技术receipt；也不能调用要求READ WRITE/FOR SHARE的handoff facts helper来绕过只读契约。第二包若需要跨库metadata/profile，须有独立双库socket HBA和只读SQL/认证批准，采到的actual也不能自动成为独立expected/shadow。所有已有UNKNOWN/RESERVED保持。

## 验证、缺项与下一步

[静态方案证据](evidence/m5-readonly-startup-plan-static-local.json)：**9组PASS、11条SQL、PG16.1语法解析**，绑定本方案附件inventory `5ae0c9ccde876f713f8c02c04567bc2a4273255a2600e615ec5516986b53a310`。仅证明模板关闭执行权限、R6源绑定、管理HBA精确顺序、SQL的读白名单及负向写/越界调用拒绝；没有启动/连接、认证或真实生命周期验收。该独立方案hash不替代R6运行候选inventory。

接续已完成生命周期执行器、公开二进制hash、精确argv构造及disposable33/33/静态11组验证，见[本地验收](zhiban-v2-m5-management-observer-local.md)。当前仍缺：实际control/认证staging/attempt路径、配置闭包预审、guard/lock真实状态与读取批准、独立authority及具体目标argv hash；[未签实际输入包](evidence/m5-management-observer-real-authorization-packet.json)明确保留null。全部按[输入清单](zhiban-v2-m5-real-delivery-inputs.md)逐项保留PENDING；未来只批准具体文件摘要和一次观察范围。

下一步定向复评签名权限、guardian释放/审计部分失败、配置闭包及实际授权输入边界，再补齐具体路径与真实预审授权。建议GPT-6 Astra / high承担此复评。UNKNOWN恢复仍需独立设计/批准，不借用fixture清理逻辑。
