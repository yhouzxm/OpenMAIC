# 凭据、host build、receipt 交付及独立清旗协议

2026-10-13。branch `refactor/zhiban-v2`，HEAD `daf63afa83470d24a9ed41d171c6a17f8a80adb6`，工作区非 CLEAN，保留已有增量。状态 **EXACT_DESIGN_R4 / BUILDER_CHILD_AND_CONTROL_CANDIDATE / KEEP_STARTUP_FENCE**。初版只制定协议；R2生成未应用候选，R3接入局部控制installer/owner/executor/publisher/loader，在独立临时PG16验证。真实产品build/凭据/receipt/清旗/host仍未执行。未连接现有 PG、读取真实凭据、重建私有 host、签发真实 receipt 或修改启动标记；无 commit/push/CI dispatch。

本设计接续[维护边界复评及 CLOSED ACK](zhiban-v2-m5-terminal-closed-ack-review.md)，只允许交付已批准的 M1–M4 与 M5-A/B 普通产品 host。RECONCILE、Native proof、finalize、Runtime/AI/PNG 和完整 enabled/生产 gate 不随交付获得权限。`installations.ready`、service registry、grants/proofs 不由交付或清旗写入；当前真实终态 installation/authority 尚未签收，所以本文不构成真实执行许可。R2增加的clear_commits只记录清旗控制提交，不改变业务终态、window/claims或terminal能力。

## 1. 当前接口的具体缺口

| 已核对的接口 | 当前行为 | 本协议要求的增量 |
| --- | --- | --- |
| maintenance executor | 新密码 PREPARED_UNDELIVERED；CLOSED/清 DB claims 后保留启动 flag；CLOSED ACK 可以重新轮换并关闭 admission | 以**最后一次轮换**建立 credential generation；ACK/接管/后续轮换使旧交付失效，禁止直接用旧 window vault 重启 |
| [build-m5.ts](../../scripts/zhiban-local/build-m5.ts) | 覆盖固定 m5-server/installer/inspector、仓库 browser bundle；packages external、私有 node_modules 链接可变 | 新建私有不可变 release generation，不覆盖当前输出；绑定运行时完整依赖及静态资产，不从工作目录读动态内容 |
| config/server/academic/content endpoint | 普通连接固定 127.0.0.1:55433；维护恢复 HBA 只有私有 Unix socket | **保留普通 host 的 TCP 合同**；恢复精确 /32 SCRAM 普通通道，维护/管理员继续私有 socket，不改成任意 DSN/socket override |
| [content-receipt.ts](../../scripts/zhiban-local/content-receipt.ts) | 旧 loader 要求 Content ledger 仅 0001、旧 ACL/LOGIN、固定旧 approvalRef，config 与 implementation hash；Content config 含 nativeMigrator | 保留旧 loader 严格拒绝，另建明确版本的 ordinary-host-after-terminal profile；普通配置剔除迁移凭据，迁移角色 NOLOGIN |
| launcher | flag 文件存在即拒绝；使用 postgres target 库预检查；读固定文件、spawn 固定 bundle | 版本化签名门状态 + pinned generation；无 postgres target 连接；普通受限读接口检查当前事实。旧入口继续拒绝，不能把缺失 flag 当作授权 |
| 签名/receipt | terminal blocked receipt 不承载普通 host 接收，也不能触发 ready | 交付 receipt 与独立清旗批准分 purpose；不复用 install approval、CLOSED ACK 或 blocked receipt |

这些是待实现的接口变更，不修改既有 migration、生产授权规则或文本发布语义。旧 profile 对新增 terminal delta 的拒绝保持有效；新 profile 的 SQL/helper/ACL 和 Ordinary host 集成必须独立评审、验证。

## 2. 身份、信任和两个批准动作

继续使用已独立 pin 的 Ed25519 authority 和 0700/0600 私有目录。相同 OS owner/签名 authority 是受信边界，程序目的隔离不宣称密码学双人控制，也不防拥有本机管理员权限者直接改 PG/文件。host 配置不包含 issuer key、controller secret、管理员密码、维护密码或迁移 DSN；子进程不通过 argv/env 接收这些内容。

| 动作 | purpose / 唯一能力 | 不能由什么代替 |
| --- | --- | --- |
| 准备与交付 | `LOCAL_PRODUCT_HANDOFF_PREPARE`：精确 generation、credential generation、source/build/配置目标、角色及 HBA profile；最多 300 秒单次操作批准 | 维护控制批准、历史 CLOSED、旧产品 receipt |
| 发布普通启动许可 | `LOCAL_RESUME_FLAG_CLEAR`：精确 release、当前 fence、最新 CLOSED 和 live gate 条件，最多 300 秒；独立文件和 approvalId | HANDOFF_VERIFIED receipt、host 自报成功、CLOSED ACK、时间到期 |

两个批准都是具体 artifact 可评审后才签；本轮不签。prepare 批准过期或执行失败不能自动申请/延长；clear 批准只能在完整交付结果可审后签。批准验证使用当前源文件 hash，不因为 HEAD 未变而忽略未提交增量。

所有 UUID 用 UUIDv7，digest 为小写 SHA256，int8 用正十进制字符串；固定 formatVersion=1、LOCAL、githubActions=false，封闭字段/枚举，拒绝额外字段。approved target 固定单机 PG16/55433、cluster system identifier、dataDirectory、双 DB 名/OID、HTTPS origin；postmaster/start/backend 身份是本次 live 检查绑定，不能被当成跨重启永久写能力。

## 3. 三个 generation 与私有存放

1. `credentialGenerationId`：最后一份已明确逐角色应用并实测的数据库凭据集；关联来源 vault 的原始字节 hash、轮换 journal、当前 fence。PREPARED_UNDELIVERED 只表示值已存盘；逐角色 CONFIRMED、当前正向认证及旧凭据负向探测才证明应用。
2. `releaseId`：唯一、不可复写的 build+普通配置+兼容 receipt 集合；绑定上述 credential generation。
3. `fenceId/fenceSequence`：控制启动许可的单调门状态代次。新维护、接管、轮换或失败恢复使 fenceSequence 增长，并使前一启动许可失效；不同于 DB window epoch，也不能替代其 claims。

拟定私有结构（尚未创建）：

```text
~/.local/share/zhiban-m1/
  maintenance.json                    # 版本化签名门状态，常驻；不是可随意删的开关
  handoff-current.json                # 原子 pointer：releaseId + manifest/receipt digests
  handoff-fences.jsonl                # 单调 fence 保留记录；不覆盖/截断
  handoff-journals/<handoffId>.jsonl   # O_EXCL、append/fsync，永不覆盖
  handoff-approvals/<approvalId>.json  # 独立 purpose，O_EXCL
  handoff-permits/<approvalId>.jsonl   # INTENT/CONSUMED/ACK_UNKNOWN，防重放
  releases/<releaseId>/               # 0700；构建前必须不存在
    runtime.json / academic.json / learning.json / assessment.json / content.json
    compatibility-receipts/           # 新 profile，原文件留作历史
    host/ / assets/ / dependencies/   # 精确依赖闭包，无可变仓库 symlink
    build-manifest.json
    artifact-manifest.json
    handoff-receipt.json
    host-validation-ack.json
```

所有路径通过固定根、realpath、lstat/owner/mode/nlink 校验；禁止 symlink、越界/相对路径、硬链接多引用、目录替换。内部 generation 文件只能 O_EXCL 生成；发布后程序不再写。OS owner 仍可改文件，因此 launcher/loader 每次读取必须重新验 hash，不把 chmod 当密码学不可变性。旧版本不删除、不作为自动回退目标；需要回退也用新 release、新凭据及新的批准。

跨文件不用连续覆盖 runtime/content/receipt。完整 staging 验证后才原子 rename/fsync `handoff-current.json`；launcher 一次 pin 一个 generation 的 pointer/manifest/所有文件，在受限环境下把同一 root 或已打开 fd 交给 child，child 不重新读取当前 pointer。混合代次、残缺 generation、pointer 漂移一律拒绝。

## 4. 凭据交付的精确范围

正常启动 LOGIN 仅六个既有角色：

| 角色 | 库 / host 消费处 |
| --- | --- |
| zhiban_auth_runtime | Business / Identity auth secret |
| zhiban_runtime | Business / Identity tenant secret；Learning/Assessment 现有 store |
| zhiban_control_runtime | Business / 现有 Identity control secret；受限启动事实查询 |
| zhiban_academic_runtime | Business / Academic config |
| zhiban_bridge_runtime | Business / Academic bridge 与 Content bridge 使用同一凭据 |
| zhiban_openmaic_runtime | Native / Content public Storage |

普通角色集合必须完整匹配获批 M1–M5 功能，缺一不降级启动；不因只测过两角色的维护 fixture 推断完整产品交付。两 migrator、四 reconcile client、observer/owner 都 NOLOGIN；维护/迁移 secret 留在维护专用文件且不进入 release。新普通 Content config 不含 nativeMigrator，不能保留一个 host 可取出的迁移密码再声称已隔离。

runtime/academic/content 中同角色连接必须映射同一 credential generation；逻辑 refs、deploymentId、用户/tenant/课程/owner handle、policy、Session HMAC、应用用户密码不为数据库密码轮换而改变。TLS cert/key/CA 按现有批准内容复制与绑定；过期或信任失效拒绝，证书换发另有范围，不在交付时静默变更系统信任。

PG listen_addresses/port 也须属于批准的单机127.0.0.1/55433配置；真实TCP探测失败即不能交付。新 HBA 普通 profile 只增加六角色、各自精确 DB 的 `host ... 127.0.0.1/32 scram-sha-256`；Native 不给其他普通角色 CONNECT。所有其他 TCP/IPv6/replication/未列角色拒绝；postgres 仅 postgres 管理库私有 socket SCRAM，目标库不存在 postgres 通道；reconcile/迁移 NOLOGIN 且目标库 HBA 无入口。双库 PUBLIC CONNECT 仍撤销。HBA hash、parse/reload、实际 /32 正向与旧密码/错角色/错库负向都必须通过，不能拿 socket 成功代替 TCP 成功。

如果 CLOSED ACK 或恢复引导再次轮换，任何已有 release/config/正向认证结果立即失效。重新准备必须引用最后轮换 journal 的真实进度；禁止重用旧已分发凭据，禁止回写旧密码。部分轮换只补实际事实后生成新的 credential generation，不靠 journal 阶段跳过 PG 检查。

## 5. host build 和验证进程

R2：构建和依赖扫描是无PG/无授权动作的离线阶段，可能长于300秒；完成并固定artifact后才签有界prepare批准。真实PG/凭据交付控制命令仍采用30秒工作预算/最多300秒批准，不能让一次全package构建耗尽live授权TTL。

新 builder 只在 release staging 工作，不能调用旧 build-m5 覆盖固定私有文件或仓库 browser bundle。构建输入固定 Git baseline + 每个相关 dirty source、lockfile、Node/pnpm、esbuild、官方 Storage/DSL/renderer/editor source/dist、compiler options/metafile。dirty 源码不必先 commit，但必须逐字节绑定；构建前后 inputs 不同即拒绝。

输出包括 server、独立普通启动 verifier、assets/CSP/TLS、所有 runtime dependency 与 manifest。`packages: external` 只有在解析目标为 release 内已校验的依赖闭包时可用；不通过指向工作区的 node_modules symlink或全局 NODE_PATH 找可变包。源码内 `resolve(app/...)`、workspace root 读取必须改为 pinned release asset root；真实启动时不执行构建、DDL、installer 或 migrations。@node-rs/argon2 2.2.1 使用native addon；闭包必须列出实际动态require/import、平台选定.node、Node ABI/arch/libc、ELF/OS shared library路径/hash与review，不能只hash顶层package.json/metafile。未解析的非字面量加载、任意runtime选择路径、ambient fallback均拒绝；物理扫描、instrumentation与fresh shadow加载是独立验收，结构manifest通过不能代替它们。installer/维护可执行文件不打入普通产品 release。

新 host 增加 `--validate-handoff` 封闭模式：不监听 HTTP、不创建业务数据、不启动 dispatcher/worker、不调用 provider 写入或 finalize，仅核对 artifact/配置、实际受限角色/精确 endpoint、来源 ledger/ACL与已批准 composition。live 校验只执行明确的 catalog/受限 facts SELECT 与必要 READ COMMITTED 锁；不能为了检查修改用户 Session、资源或 operation。功能回归使用独立 disposable PG 的受审 release，不在真实库种教师/学生或执行测试发布。

controller 在持有独占 flock、BLOCKED fence 时 spawn 绑定 build 的验证 child；精简环境排除 NODE_OPTIONS/NODE_PATH/PG* 等注入通道，秘密经私有文件/受限 fd 输入，不经 stdout/env/argv。child 回执通过私有 pipe 绑定随机 challenge、releaseId/build digest、PID/start、credential generation、cluster/双 OID、检查序号及逐组结果；controller 重新读 artifact/live facts 后接收，保存 0600 ACK。旧 challenge、旧 build、超时/EOF/非预期字段拒绝，不接受任意文件里一条 ready=true。

原 host 与验证 child 全部结束，所有临时连接真实消失后才允许准备清旗。不同进程丢 ACK 不重做业务动作；只读验证可在新的 challenge 下重新执行，但重新执行是新验证记录，不能冒充旧 ACK。host 未进入普通服务时得到的是 **VALIDATED_FOR_LAUNCH**，不能写成“已监听/已交付成功”。

## 6. 新 receipt、profile 与依赖图

拟定新普通 profile：`ordinary-host-after-terminal-local-v1`。它精确接受 reviewed Content 0001+terminal 0002、先前替换的 guard/历史服务审计、terminal Native proof ACL 的**已安装状态**，但 host 只拿六个普通角色及既有普通 M1–M5能力；不把任何 terminal receipt 暴露为 HTTP 写能力。新 profile 与旧 Content profile 各自 closed validator，未知版本/额外 schema/ACL/role/default/ledger/来源均拒绝，不放宽旧 loader。

R2使用 `inspect_host_installation(deployment,release,read_secret)`：仅zhiban_control_runtime私有包装，必须有owner核验独立prepare批准后先登记的REGISTERED host_read_authorizations，绑定deployment/release/credential generation/latest epoch/256-bit read token digest与artifact/receipt/profile摘要。REGISTERED绑定artifact/config/profile/source，但receiptDigest为空，验证child仅能读取、不能清旗。验证ACK并签handoff receipt后，owner依据精确review一次将REGISTERED封存为ACTIVE及固定receiptDigest；clear helper只接受ACTIVE。其它绑定不可变，ACTIVE不可回REGISTERED。这避免read scope→未来receipt→验证ACK的hash环。host无seed/封存/DML权限，不能靠传一个deployment UUID枚举事实。该helper只观察；FOR SHARE需要READ COMMITTED READ WRITE事务，不宣称PG强制READ ONLY。固定Business/Native元数据和精确deployment；返回 cluster/OID/PG、批准 Business ledger checksum、当前 epoch/claimsEmpty、受审Business catalog/profile绑定摘要、ledger及ready事实，不返回窗口/grant/租户数据，不授普通 role 维护表 SELECT。实际Business catalog由control role的04/05固定metadata SELECT比对，Native catalog/ACL由独立zhiban_openmaic_runtime的04/06 metadata SELECT比对；helper返回的profile_digest只是受审登记摘要，不当作当前live指纹。Business helper 不能跨库读取 Native 表，也不能声称一个 Business snapshot 同时证明 Native 状态。未来 SECURITY DEFINER/helper/observer 最小 ACL 必须单独产出未应用 SQL、expected/profile、负向验证。若 live facts 不能以该权限取得，就拒绝启动，不能退回 postgres/owner 连接或 seed ready。

M1/Academic/Learning/Assessment 的 receipt 也必须由新 profile 明确接收：保留各自 policy/migration/业务来源绑定，重新绑定同代原始配置字节。旧固定文件 receipt 不覆盖；新增 compatibility receipt 引用旧 receipt 只作迁移来源留证，不能沿用旧 configHash 冒称新密码已交付。新 Identity runtimeHash、Academic configHash、Content configHash 与统一 credential generation 的映射逐项一致。只验 Content receipt 而遗漏其余 composition 的交付不得清旗。

拟定 artifact 图必须无环：

```text
reviewed source/profile + existing install receipt
          ↓
credential/config leaves + build/dependency/asset leaves
          ↓
build-manifest → artifact-manifest
          ↓
compatibility-receipts → host-validation-ack
          ↓
handoff-receipt (HANDOFF_VERIFIED; launchAllowed=false)
          ↓
signed LOCAL_STARTUP_RELEASE_GATE bytes (dormant; requires DB commit)
          ↓
independent clear approval (binds exact gate SHA256)
          ↓
clear_commits COMMIT → publish exact gate bytes → launcher checks both
```

manifest 不把自身或输出 receipt 的 hash 纳入自己的输入。待激活gate预分配approvalId，但不包含clear批准文件hash；clear批准引用精确gate字节hash，避免二者签名/hash环。gate签名本身不证明实际COMMIT或已清旗。现有 installation.receipt_digest 是已有安装绑定，handoff 只引用它；不把包含该行的 handoff hash 反写同一列。配置含密码的 digest/receipt 只放私有文件，日志只留高熵 generation/批准 ID 与 artifact hash，不输出 DSN、密码、密钥、raw SQL error 或 Native 文本。

`LOCAL_PRODUCT_HANDOFF_VERIFIED` receipt 封闭 payload 包括 formatVersion/purpose/authority/LOCAL，handoffId、releaseId、credentialGenerationId、prepareApprovalId、source inventory 与所有 build/config/profile/evidence 叶摘要、固定 target、current fence、windowId/epoch/closedEventSequence、验证 child ACK、只允许的普通能力列表；固定 launchAllowed=false、terminalActionsAllowed=false、productionSignoff=false。新普通profile还必须比对全部非pg/information_schema namespace inventory，不能只过滤已知schema后声称拒绝额外schema。内容与 profile 合法后由既有离线 authority 签，不由 host 自签、不现场复制 actual 为 expected。不能给全部模板虚填 PASS；实际缺失 gate 保持 UNISSUED。

`LOCAL_RESUME_FLAG_CLEAR` 批准额外绑定 handoff receipt/artifact-manifest、精确 current pointer、current BLOCKED fence 原始 bytes/hash/fenceId/sequence、最新 CLOSED event、PG postmaster、本次 role/HBA/admission/logging 状态、批准的六 LOGIN，expiry/独立 approvalId；不是只签一个 windowId。authorityKeySha256、formatVersion、LOCAL/githubActions、approvalId/handoffId/releaseId/credentialGenerationId、deploymentId/cluster/OIDs、windowId/epoch/closedEventSequence、fenceId/sequence/expectedBlockedGateSha256/fenceHistorySha256、pointerSha256、artifactManifestSha256、handoffReceiptSha256、hostAckSha256、source/profile/HBA/logging hashes、postmasterStart、approvedLoginRoles、issuedAt/expiresAt 均必填且无可扩展 extra map。新模板生成时逐字段确认，任一绑定缺失不签。

## 7. 状态机和固定执行顺序

| 文件交付阶段 | 必须已成立的事实 | 是否能启动 |
| --- | --- | --- |
| STAGING | 独占 flock + BLOCKED fence；新 release/credentials O_EXCL | 否 |
| ARTIFACTS_READY | build/配置/依赖叶文件完整，source 前后稳定 | 否 |
| HOST_VALIDATED | live target、六角色/HBA与验证 challenge ACK通过；临时连接已排空 | 否 |
| HANDOFF_VERIFIED | 新兼容 receipt 与 handoff receipt 通过签名/profile，指针已发布但 fence BLOCKED | 否 |
| CLEAR_PENDING | 独立短期清旗批准通过，耐久单次 permit INTENT；gate仅暂存 | 否 |
| CLEAR_DB_COMMITTED | 清旗账本精确COMMIT，文件发布未确认 | 否 |
| CLEARED | 所有最终 live/fence/epoch/claim/文件检查通过，原子发布签名 CLEARED 门状态 | 可启动精确 release |
| RUNNING_OBSERVED | 普通 launcher 的新进程通过实际 composition/readiness并监听固定origin，记录真实ACK | 已观察实际启动 |
| BLOCKED / ACK_UNKNOWN | 任一步失败/未知；记录真实状态，保留或重新发布 BLOCKED fence | 否；不回退旧 release |

准备入口固定 `--prepare-handoff`，只接受受审固定私有批准及 generation，不能传任意 SQL/DSN/role。清旗入口独立 `--clear-startup-fence`，不构建、不旋转普通密码、不重签交付receipt、不改变ready/service/grants，缺失结果一律拒绝。新owner bootstrap可登记fresh受限controller和exact clear_authorization，但不得调用会轮换全部普通密码的既有--closed-ack入口；若普通密码再变则返回新credential generation重新交付。结果查证入口 `--inspect-handoff` 只核对当前 pointer/fence/receipt/permit/PG事实，返回已发布、未发布或不确定；无隐含写重放。

执行顺序：

1. 获取 cluster 同一独占 flock，停止旧启动源/进程，建立并 fsync 版本化 BLOCKED fence，绑定 deployment/cluster/window/epoch 与新的 fenceSequence。现有 legacy flag 没有这些字段，不能自动解释为“可清”；仅在新明确批准下完成绑定升级，升级过程中仍阻断。
2. 以受审维护/recovery 通道查最新 CLOSED；要求 read_closed_result=COMMITTED_CLOSED，**current epoch counter 恰等于目标 epoch、两个 claims 均 NULL、无任何当前维护窗口**。历史 CLOSED 但后继窗口存在/epoch已变，即使后继也 CLOSED，都不能清旧 fence。若 NOT_CLOSED，回到维护协议而非继续交付。
3. 核对最终 credential generation、逐角色实际应用、原进程排空；必要的新恢复轮换属于新的批准和新 generation。生成配置/build/依赖集合，新 receipt 对接新 profile；旧 Content setup/install 不能用来重签/重跑 migration。
4. 实测生产普通 TCP HBA/凭据/live ACL及全量来源；验证 child 完成后销毁连接并再次排空。首次交付 HBA/admission 的管理更改必须带 INTENT/CONFIRMED及实际回读；失败只尝试 NOLOGIN/关闭双库，保留真实 UNKNOWN。
5. 签 HANDOFF_VERIFIED，由owner一次封存ACTIVE read scope，再原子发布 pointer；fence 仍 BLOCKED。pointer 发布丢 ACK时查询实际 pointer 及全文件 hash，不能再生成另一份“同 ID 新内容”。
6. 独立清旗批准到达后，在独占 flock 下核验签名/TTL/source/expected/全部 artifact、pointer、fence CAS、数据库状态和没有存活旧/验证 backend。六角色精确 LOGIN，新普通密码正向及旧密码负向；维护/迁移 NOLOGIN、密码撤销，目标库没有管理员 HBA，双库 ordinary admission 与本次批准均一致，prepared/background/subscription 边界沿用维护协议。
7. 当前已完成host验证且没有临时backend时，新受限controller调用begin_clear，沿用service→counter→window→claims→host read authorization→clear authorization锁序。独立clear_authorizations绑定批准、gate/pointer/fence/history摘要、release/epoch、256-bit secret、实际PID/start/postmaster及TTL；guard_scopes只在同PID/txid事务内有效。controller LOGIN已撤销，HBA无维护入口，只有预开的物理会话；目标库除此之外零backend。任何旧/额外backend、prepared/subscription、错epoch或claim均拒绝。
8. 耐久permit INTENT后，仅将受审签名gate字节写入私有staging并fsync，不发布到启动门。调用commit_clear在同事务重新检查实际scope/TTL/barrier，再插入append-only clear_commits并消费clear_authorization、移除guard。只begin后COMMIT、半消费或缺记录在deferred约束拒绝。此写入仅新handoff控制账本，不更新window/claims或租户业务。服务器事务因idle timeout/断连/PG重启失效，commit_clear不能取得旧guard；先前SELECT结果不能激活gate。
9. 显式COMMIT成功后才在持有OS flock下再核对fence/history/pointer/source CAS及最新PG事实，然后原子发布**原签名gate字节**并fsync。COMMIT回执未知只使用fresh限域controller精确read_clear_result；NOT_OBSERVED无写重放权，COMMITTED也无直接publishGate权。补发文件仍需单独受审恢复批准和fresh全部检查，不重新消费同approval。ACTIVATION记录与gate文件分离，所以不宣称跨PG/FS ACID。
10. 普通launcher必须同时验证签名LOCAL_STARTUP_RELEASE_GATE、精确targetGateSha256的COMMITTED clear_commits、最新epoch/空claims、当前最高fence/history以及同代pointer/release。仅一端存在或任何未知均拒绝。controller/检查会话结束并释放独占锁后才能获共享flock；child继承fd，实际composition/监听成功才记录RUNNING_OBSERVED。DB账本已提交但gate尚未发布/文件ACK未知都只查证，禁止盲目重新commit/spawn。

commit_clear返回COMMIT_PENDING且launchAllowed=false，只有外部COMMIT的实际成功/精确查证才是持久记录。事务失败回滚到ISSUED也不能自动重试：permit进入ACK_UNKNOWN，需新approvalId/fenceSequence的明确批准；旧许可不能清新门。同release失败重试也不能改变旧授权不可变绑定或把CONSUMED复活。

## 8. 常驻门状态、并发与独立清旗边界

“清旗”定义为版本化门状态转 CLEARED，并不物理删除 maintenance.json。BLOCKED 是拒绝状态，可由持锁控制器发布，无需让维护 broker/host持有签名私钥；只有受信issuer签名的LOCAL_STARTUP_RELEASE_GATE且存在匹配COMMITTED控制账本时才派生CLEARED；离线签名待激活文件本身不会清旗。坏签名、未签名或无法解析的门状态均拒绝启动。它与clear_commits共同形成清旗结果：文件缺失永远拒绝启动；旧 launcher只看文件存在，因此继续安全拒绝。新 gate reader 对 CLEARED 验签并以release/fence tuple核对pointer，不接受裸status字符串。`clearAfterClosed()` 的 unlink 接口从生产调用面移除，只保留历史测试fixture用途或直接废弃；任何真实执行路径不得调用它。

新维护流程在拿到独占flock后，先在 handoff-fences.jsonl append/fsync 更高sequence的 fence INTENT，再发布对应BLOCKED门状态并记录CONFIRMED，之后才能改变PG；旧 CLEARED receipt不能复活。reader以最高已保留sequence为准，不只看最后CONFIRMED：INTENT后发布失败/进程死亡仍阻断旧CLEARED，不能把sequence退回或截断日志。清旗批准与activation receipt另绑定当前fenceHistorySha256；下一次维护增加历史记录即令旧许可失效。历史记录损坏/无法确定最高sequence则拒绝，不重建为0。所有普通launcher、build、installer、handoff/clear入口须使用同一个 lock/gate reader；不得保留绕过它的package alias或自动启动源。数据库密码/HBA还独立拒绝旧二进制/旧过程的迟到连接；同OS owner直接篡改或手工启动未批准程序仍属既定受信边界，不能称为系统级沙箱。

最终DB读锁防止事务内并发接管/新window占用，commit_clear在staging I/O后重新检查并记录控制COMMIT，launcher再核对当前epoch/claims；不能假定文件I/O期间数据库连接必然存活。flock使gate发布与launcher/其他维护串行。并发两个清旗进程只能有一个获锁；第二个只报告同一已发布事实或拒绝，新pointer/fence/epoch/claim一律使旧批准失效。时间过期不会自动清旗、开库或释放claim。受信issuer在HANDOFF受审后只签固定purpose的待激活gate叶文件；该叶文件先于clear批准，不能声称已经清旗。真正发布只可在持锁、未过期独立clear批准、控制COMMIT和全部fresh检查成功后执行；签名gate需与独立批准和DB提交匹配，不给普通 child、broker 或HTTP提供签名API。签名gate记录待激活的精确字节/范围，clear_commits记录已发生的控制提交；clear批准TTL用于控制COMMIT和首次发布，后续普通同代重启不能把历史批准重新当作清旗授权。

新launcher在每次启动仍验当前source/artifact/target/role/HBA/ledger/profile、最高epoch/claims为空及generation；PG重启需要fresh普通只读preflight，不能复用旧backend/postmaster证明。清旗检查期间PG重启使本次批准失效；完成激活后的普通重启是否允许由此profile的fresh检查决定，不产生terminal lease/proof。host运行期间source/profile/drift失败必须停止或进入拒绝服务路径，不能静默换generation或继续用stale receipt。

清旗后spawn失败、child早退或readiness丢ACK，supervisor禁止自动重试旧命令：取得/等待独占flock，确认精确child PID/start已死或终止、断开目标backend，再发布新BLOCKED fence。若原child仍持共享fd，不能强夺锁冒称无人运行；先停止精确进程。恢复是新handoff/clear批准，不复用旧clear许可。新代码需在普通启动入口早期hold共享锁并validate gate，host不能先监听再做receipt检查。

## 9. 部分失败与结果查证矩阵

| 故障边界 | 实际判据与处置 |
| --- | --- |
| 凭据文件已写，部分ALTER失败/丢ACK | 文件只说明计划；按各role实际认证与安全catalog核对，保留进度及BLOCKED，不恢复旧密码；重新轮换需新generation |
| Build完成一半/依赖漂移/source变更 | staging不发布；旧generation仍历史，flag BLOCKED，不调用当前build覆盖旧文件 |
| Runtime/Content新配置或receipt缺一/混代 | manifest精确比较拒绝，pointer不发布；无逐文件回滚/迁移重跑 |
| HBA写成但reload/probe失败；双库只恢复一个 | 记录真实parse/role/admission状态；关闭/NOLOGIN为best effort，未知仍BLOCKED，不称全部恢复 |
| 验证child成功但ACK丢失 | 不算HOST_VALIDATED；停止/查证精确child，无业务写入可在新challenge下重做只读验证 |
| HANDOFF receipt签成功但写盘失败 | 未发布就是未交付；O_EXCL保留或核验完整同一artifact，不能给同ID签不同内容 |
| Pointer rename后进程死 | 以真实pointer/manifest判已发布；BLOCKED fence仍阻断，清旗需要新的独立批准 |
| 新CLOSED ACK轮换/后继epoch出现 | 旧credential/release/receipt/clear许可失效；不得清后继claims或旧flag |
| permit INTENT后、CLEARED发布前死 | 不推断成功，不重放；signed gate仍BLOCKED则新批准重新检查 |
| CLEARED rename成功但fsync/调用者ACK不确定 | 实际durable gate/pointer/permit/DB提交事实查证；不重复publish或spawn；不确定继续拒绝，进程恢复先取flock |
| DB COMMIT ACK丢失/账本已提交但gate未发布 | fresh受限精确查询；COMMITTED不重做消费，文件补发需独立恢复批准/fresh CAS；NOT_OBSERVED也不自动重放 |
| CLEARED已耐久但本地CONSUMED/返回ACK丢失 | 精确signed gate+DB COMMITTED+INTENT证明同一发布；只归档ACK，不新消费、不启动第二个host |
| 清旗后新维护或artifact被改 | 更高BLOCKED fence或hash/profile不匹配拒绝；旧clear receipt不可覆盖回去 |
| child已监听但supervisor ACK丢失 | 查当前PID/start/fd锁/origin/nonce；不得盲目重启形成双host，未知先停旧再BLOCKED |

## 10. 完整产品必须验收的范围（尚未完整签收）

| ID | 本地独立进程/PG16验收 |
| --- | --- |
| HD-01 | staging O_EXCL、0700/0600、symlink/hardlink/目录替换拒绝；磁盘错误在credential ALTER前；部分轮换仍可查全部计划 |
| HD-02 | 六角色正确TCP/SCRAM/库/权限，旧密码、peer/trust/cert、错库、迁移/维护角色拒绝；新HBA不是socket-only假产品通过 |
| HD-03 | host配置无admin/issuer/controller/proof/migrator凭据；同角色跨config同代；未修改应用账号/Session语义 |
| HD-04 | build不覆盖当前bundle/仓库资产；packages external目标全部在pinned依赖闭包；工作区dist/NODE_OPTIONS/NODE_PATH/CWD漂移拒绝 |
| HD-05 | 新0001+0002 profile真实接线，旧0001 loader仍拒绝；未知ledger/额外ACL/observer/role/default/schema漂移拒绝；无自动DDL/ready seed |
| HD-06 | 配置/receipt/manifest无hash环、精确字节/closed字段；mixed generation、伪签名/旧challenge/错build拒绝 |
| HD-07 | 验证child不监听、不写业务、不调用provider写路径；新独立disposable PG运行受影响M1–M5文本回归并绑定该release |
| HD-08 | HOST_VALIDATED不能冒充RUNNING_OBSERVED；deadline/child EOF/迟到ACK均保持BLOCKED，敏感值不进日志/env/argv |
| HD-09 | CLOSED旧窗口但新claim或更高counter拒绝清旗，即使后继也CLOSED；NOT_CLOSED/错epoch/错audit/过期controller拒绝 |
| HD-10 | HANDOFF receipt/CLOSED ACK/旧clear批准无清旗权；wrong purpose/fence/pointer/generation/expiry/extra fields拒绝 |
| HD-11 | 准备、pointer发布、clear三个并发路径串行；只有一个控制COMMIT；claim锁与takeover/open_window两种竞争顺序、staging期间idle timeout/断连/PG重启失去guard均测试 |
| HD-12 | 原子gate切换/parent fsync各边界SIGKILL和磁盘失败；flag缺失不能启动，legacy入口仍拒绝；无unlink空档 |
| HD-13 | CLEARED ACK/CONSUMED记录丢失只查证，不重新消费；新fence/接管/PG重启不复用本次clear检查 |
| HD-14 | launcher pin同一generation，host继承共享fd；父launcher死仍阻止维护；child spawn/监听/ACK失败不双启动 |
| HD-15 | release前移后旧build/旧配置/旧进程不能新连接写入；普通host中无terminal授予、proof/finalize/Runtime/AI能力 |
| HD-16 | 真实HTTPS本地登录/工作台/M2–M4及文本内容闭环正常；Native UNKNOWN/RESERVED及原隔离cohort除另行批准目标保持；不重复同内容GitHub CI |

以上是待验收矩阵，不是测试结果。真实target、完整交付receipt、独立clear审批、清旗和普通host启动均未执行。完整terminal/enabled/生产OPS/DATA signoff仍deferred。

## 11. 下一步与本轮来源边界

下一步定向评审：原子generation/依赖闭包、TCP/HBA与新profile/helper ACL、常驻签名gate与clear permit的ACK/并发语义。R2已生成独立m5-handoff schema/helper/ACL、receipt/profile/clear批准及执行合同候选，全部UNAPPLIED/UNISSUED；builder/issuer/owner seeders/host loader/gate publisher仍未接线。下一步先复评新SQL/profile/控制COMMIT一致性和scope，并补独立PG并发/崩溃矩阵；随后用disposable PG验证，不直接对真实开发库执行。

现候选inventory `4e5585a55aae259a39ac5c0aa01f40e66c4dbb138d99b2d093c626565c9d662a`，未应用0002 aggregate `ec2aa8066aae0455127522df40a32b86249a98417391dc714d243f366e592548`，本轮均未变；已应用0001 aggregate仍 `e335f83bb48cc6c4ec754f8e3270dc0e6941e14f38306bd67aa29844c3713324`。原30/50/13和14组本地证据只支持原维护/ACK实现，不能签收本文新handoff/gate/profile。本文只完成设计、源码接口对照与文档一致性检查。

建议下一轮安全/并发协议复评使用 **GPT-6 Astra / high**；本轮不据设计文档产生运行授权。

R2定向复评记录与新增候选索引见 [handoff评审](zhiban-v2-m5-handoff-candidate-review.md)。本页初版“读锁→直接发布文件”已被控制账本协议替代；旧维护30/50/13证据不覆盖该新增账本。

## R3 控制执行器接线及证据边界

详见[R3复评及接线](zhiban-v2-m5-handoff-executor-review.md)。新增owner register/seal/revoke及独立INSTALL/REVOKE/HOST_ACK闭合合同、单次permit和同flock执行器；HOST/CLEAR禁止直接ACTIVE/CONSUMED插入，自动控制审计在同事务保留状态/绑定。新profile比较全部非pg角色；启动事实只承认deployment最高clear commit对应release。fresh publication helper保持受限controller ACL，未知ACK查询没有发布/消费权。owner物理bootstrap用现有observer，并核验Business/Native及postgres管理连接属于精确同cluster；部分失败清理在获锁且目标核验后的范围内，无普通密码再轮换。

seal后O_EXCL写release内signed receipt/ACK并原子发布pointer，仍BLOCKED；clear在真正控制COMMIT后fresh检查再发布原signed gate字节。没有实际host spawn或运行租约；control loader共享flock仅持到观察结束，真实supervisor必须另接持续fd继承。未应用候选有实现不代表真实普通host交付已完成。完整builder/physical closure/实际validation child/兼容receipt/TCP-HBA及普通supervisor仍deferred，所有真实模板UNISSUED。局部23项与既有12项fixture只覆盖控制接线和SQL边界，不把第10节完整HD矩阵全标PASS。此前章节R2的“seeders/publisher未实现”是其历史阶段描述，本节替代其当前候选状态；完整产品验收门不降低。

## R4 实际 builder / validation child

已接[真实代码构建与只读child](zhiban-v2-m5-release-build-local.md)，原第5节离线build/依赖、private fd challenge、实际六角色TCP/PG composition读取有候选实现；既有服务/Domain/SQL规则不变。builder只写新generation，不覆盖工作区/current输出；固定原生Argon2与Node/ELF/tool/source字节，实际物理验证与结构checker分开。child生产代码实际加载、readonly普通pools/限定facts读锁、无HTTP监听或业务写；独立compatibility/transport/shadow签名缺失就INCOMPLETE。HOST_ACK另绑定兼容receipt digest。真实target的freshShadowLoad必须另有同code/native/OS closure受审证明，不能复用临时fixture签名。

源/TTL/配置/半build/guard/private result拒绝和本地PG验证见R4报告。模板仍UNISSUED；真实expected/issuer、TLS和普通supervisor/fd继承/持续撤权/已启用gate仍未完成。第10节HD矩阵没有整表签收；本轮startup验证不构成用户业务旅程或终态/生产验收。


## R5 同代签发与普通 HTTPS 接续

当前状态由[R5复评与接线](zhiban-v2-m5-issuer-https-local.md)替代R4关于issuer/TLS/supervisor未实现的候选描述，真实target仍未应用。独立reviewer的签发批准绑定固定controlDirectory、source、issuer pin、精确payload或validation输入摘要；O_EXCL permit在control根保留，换输出目录不重放。签发器亲自执行实际validation child，缺证不给ACK；compatibility/TLS与HOST_ACK/handoff分别在全部输出耐久后签完成组凭据。seal/launcher只消费具有受信完成组的叶，部分结果仅供查证，不自动修复。

TLS原字节绑定同代artifact和TLS receipt，有效期/IP SAN/serverAuth/私钥匹配/CA验证。普通HTTPS子进程只拿固定普通配置，继承共享maintenance fd；supervisor启动、每请求与周期检查signed gate/DB commit/ACTIVE/epoch/claims/profile/ledger/source/物理字节，漂移/失联即停机。管理端必须先停止普通host再取得独占锁；不会自动清旗、启动terminal执行或绕过原Content入口。

停机是有界观测后的失败关闭，不宣称带外撤权瞬间回滚已获准请求。真实CA信任安装、transport/独立shadow及expected签发、真实凭据/HBA交付、完整业务旅程/OS崩溃恢复和完整enabled gate继续deferred。本地临时审核人、CA、最小Native和合成CLOSED均不得成为真实授权。


## R6 完成组/退出边界修复

[R6修复证据](zhiban-v2-m5-completion-exit-fix-local.md)接续R5的后段sidecar失败和idle PG end等待。canonical signed master为唯一完成组提交点；提交前部分叶一律不可消费，提交后返回ACK未知时只读inspect，无重签/补发布权。组种类、同代ID、精确两purpose叶/hash与当前source均绑定。seal、普通loader及运行中检查全组，master或任一成员变化即阻断。

普通supervisor关闭预算5000ms；child先终止/必要时SIGKILL并确认OS exit，PG graceful750ms后destroy并观察local socket close；仅全部确认后释放共享fd，未确认保留SHUTDOWN_INCOMPLETE。IPC断开与exit主动触发stop，重复stop不重复关闭。远端backend排空仍由既有管理观测/SQL guard确认，不能由本地socket标志推断。

本轮真实输入只允许无凭据元数据收集，不读取原私有凭据/receipt/HBA，不连接真实PG、不签发或清旗。真实独立expected/shadow/transport与本机CA信任/账户旅程、故障恢复批准仍deferred。
