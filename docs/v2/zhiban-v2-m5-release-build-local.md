# M5 不可变 builder 与只读 validation child 接线

2026-10-13。branch `refactor/zhiban-v2`，HEAD `daf63afa83470d24a9ed41d171c6a17f8a80adb6`；保留原 dirty worktree。状态 **ACTUAL_BUILDER_AND_CHILD_WIRED / REAL_TARGET_UNAPPLIED / KEEP_STARTUP_FENCE**。本轮未连接 55432/55433、读取真实私有凭据、写真实 HBA/receipt/host/启动门；无 commit/push/CI dispatch。接续 [R3 控制执行器](zhiban-v2-m5-handoff-executor-review.md)，不是普通 HTTPS host 已交付或完整 enabled gate 的签收。

## 实际实现

[release-builder.cjs](candidates/m5-handoff/release-builder.cjs) 离线创建全新 releaseId 目录，O_EXCL 写入私有叶，不覆盖当前 bundle、仓库资产、package dist 或已有 generation。只接受显式受审 staging 配置，拒绝直接读取真实私有根。输出真实 [release-product.ts](../../scripts/zhiban-local/release-product.ts) 的 M1–M5 composition 库、独立 child、guard、实际 renderer/editor 文本页面和其余 M1–M4 资产、CSP、固定 SELECT metadata、Argon2 原生文件及 build/closure/artifact manifests。product 库没有自动 listener、setup、installer、worker 或 migration 入口；正常 HTTPS supervisor/TLS 交付另接。

构建以 write:false 在新 release 输出，打包 JavaScript package 依赖，保留 Node builtin 及唯一固定 `argon2.node` 引用。绑定当前 HEAD、全部相关 dirty source、package source/dist、实际解析 dependency、lockfile、tsconfig、esbuild API/二进制、Node 可执行文件/ABI、pnpm 版本、compiler/metafiles、实际 package versions；构建前后漂移拒绝，部分 build 没有 artifact-manifest 即不能激活。AST 检查拒绝非字面量 require、dynamic import 和 ambient package fallback。Node 原生绑定只支持当前 Linux x64 glibc / Node22 / @node-rs/argon2 2.2.1；固定平台选择不修改既有 Argon2 密码算法/参数，不接受 WASI/环境选择或另一个平台的 fallback。pg-native/Cloudflare 不属于普通 Node TCP profile，构建明确禁用并留证。

[physical-closure.cjs](candidates/m5-handoff/physical-closure.cjs) 实际验证 release 字节、无额外叶/symlink/hardlink、Node ABI/可执行文件、原生 .node、ldd 闭包和当前系统库 hash。linker alias 由 parent 验证其 canonical 目标，child 只读已列出的 canonical ELF 文件，前后再核验 alias；无需放宽到整个 /lib。原结构 checker 的 STRUCTURAL_CLOSURE_ACCEPTED 不代替这些物理检查。

[validation-parent.cjs](candidates/m5-handoff/validation-parent.cjs) 已接 [handoff executor.validate](candidates/m5-handoff/handoff-executor.cjs)。它核验独立 PREPARE、signed expected、目标/config/artifact/source、现有 BLOCKED fence/pointer、同一独占 flock；不能在标记缺失时补建一个标记。每次保存新随机 challenge，将配置证据及旧凭据通过私有已打开 fd4 交给 child，fd3 接收回执；argv/env/stdout/stderr不携带密码/DSN/密钥。绑定实际 child PID 与 /proc start、challenge、release/generation/source/epoch，限制 30 秒工作预算及批准 TTL；EOF/超时/进程失败不产生可用 ACK，不自动重放。失败只记录固定阶段及安全错误码，不输出 raw SQL/provider error。

[validation-child.cjs](candidates/m5-handoff/validation-child.cjs) 只允许 `--validate-handoff`，必须经 pinned guard preload 和 Node22 permission 启动。全部非builtin加载路径与 process.dlopen 重新验字节；禁止 listener、文件写、child_process/worker、ambient module、外部 fetch 或非批准 TCP。Node permission 与 JS guard 是受审代码的执行护栏，固定原生库仍属于信任边界，不能称为对恶意 addon/本机管理员的系统沙箱。

child 实际连接六个普通角色，核验 SCRAM、角色/库/OID/PG16、完整 metadata/profile、受限 REGISTERED/latest epoch/空 claims/同代 token 和全部冻结 composition ledger。普通 composition pools 用 PG default_transaction_read_only=on；限域事实 helper 单独以 READ COMMITTED READ WRITE 取 FOR SHARE，只观察受审 helper。随后创建原 M1–M5 composition，内存内执行 unauthenticated me→401，运行真实原参数 Argon2 hash/verify 及负验证，观察实际 native/OS 加载。无真实登录/Session 创建、资源写、发布、finalize、RECONCILE/Runtime/AI 或 HTTP listener。

## 证据与签发边界

新的 compatibility / transport / shadow 模板 **UNISSUED**。child 只验证独立签名，不持 issuer key、不签 HOST_ACK。compatibility 明确绑定同代 build/config 与 Identity/Academic/Learning/Assessment/Content policy、全部 ledger 和历史 receipt 引用。HOST_ACK 新增 compatibilityReceiptsSha256，owner seal 必须与 handoff receipt 相等，不能在验证之后替换兼容 receipt。

transport 必须是当前 source/generation/target/postmaster、有界时效的独立管理观测，包含完整固定 HBA 顺序、options/error、字节 hash及已知旧凭据 lineage/digests。child 六角色正向 SCRAM 和实际旧密码负探测不能用“随便生成一个错误密码”替代；全部证据为空、认证错误不可判定、错代/未知签名都不得把结果全标 true。真实管理观测和凭据交付没有在本轮执行。

freshShadowLoad 在实际独立 disposable PG 验证时成立；真实 target 必须另有独立 signed shadow evidence，绑定相同 executable/native/OS code closure、source 和完整 shadow 验证 evidence。不同 config/cluster 的 shadow 不复用 credential leaf/hash；签名只是受信review的输入，不由 actual catalog 自动升级为 expected。LOCAL_DEV 缺少该证明仍 INCOMPLETE。

缺失 compatibility/transport/shadow 组时返回 **VALIDATION_INCOMPLETE**，不能进入 owner ACTIVE 封存。九组完整且实际通过只返回 **VALIDATED_FOR_LAUNCH**；launchAllowed/runtimeAccepted/productionSignoff=false，httpListening=false。它不是已监听/已启用，不消费 clear 批准、不写 window/claims/业务、不移除启动门。真实 issuer、独立 ordinary expected、TLS/generation交付、普通 supervisor 持续共享fd/撤权、明确 file-publication recovery仍待接线。

## 本地验证

[verify-release-pg16.cjs](candidates/m5-handoff/verify-release-pg16.cjs) 新建唯一 0700 的 `/tmp/zhiban-release-pg16-*` PG16，端口 **56496**，只监听 127.0.0.1，专用 Unix socket，固定六角色 /32 SCRAM 和其余拒绝，finally stop/remove。测试先真正认证六份旧凭据，再在该 fixture 轮换；旧密码负探测使用这六份已知旧值。

定向检查包括：实际 bundle/browser/native/ELF；O_EXCL generation；构建期间 staging config 漂移；guard clone 的 listen/write/ambient import/child_process/错端口拒绝；真实只读 composition/native 冷加载；缺证 INCOMPLETE；九组正向；signed shadow 错 code closure；兼容 receipt 错代；config/额外叶/Node ABI/OS库/非字面量 import 漂移；过期/fence drift；秘密不进回执；退出后无 target backend，所有既有 zhiban 业务/terminal 表计数及 row digest、ready/claims不变。guard clone 是故障注入产物，未签作普通 release。

CLOSED/profile/authority/compatibility/transport/shadow 使用明确 synthetic 测试数据，Native为最小 fixture、本地 corpus；实际构建和真实原生/角色认证是本机代码事实，但不能据这些临时签名签收真实 Native 全量结构、账户业务旅程、HTTPS listener、issuer或完整 enabled/生产 gate。本轮仅复跑受影响 handoff executor 和静态，不重复 GitHub或原402套件。R3 原证据仍保留其原 inventory/范围；hand0001 SQL aggregate及旧 terminal/已应用 migrations均不变。

最终来源与结果：候选共 **40 文件**（另有source-bound release-product.ts），inventory `877f2f66146fd628ffd056a70df68a2632478a7b035277fcec7d6a76dd0f1f86`；handoff0001 SQL aggregate仍 `bbede0be2e773562730bb2b1c756d4aceba853143b298b768de7c0d70d624a8e`，未新增SQL/ACL或修改已应用migration。

- [实际builder/child PG16证据](evidence/m5-release-build-child-pg16-local.json)：**13/13 PASS**，含5项guard故障子场景；实际bundle/native/六角色正负认证，已停止并删除独立cluster。
- [受影响handoff executor回归](evidence/m5-handoff-build-child-executor-local.json)：**23/23 PASS**；新增兼容receipt ACK绑定保持一次封存/撤销/未知COMMIT隔离。
- [静态与来源核验](evidence/m5-handoff-build-child-static-local.json)：**14组 PASS**，36 SQL / 10 PLpgSQL，PG16.1 grammar。

三份证据核对同inventory/aggregate。R3的12项SQL/结构fixture及原terminal历史证据继续只支持其原来源范围；本轮没有改写历史证据或重跑GitHub。

下一步：定向复评新 builder/child 的源与证据绑定、独立签发和部分失败边界，再接同代 compatibility/HOST_ACK issuer、实际 ordinary expected 与普通 HTTPS supervisor/TLS/shared-fd。建议 **GPT-6 Astra / high** 复评这些授权/加载/并发边界。
