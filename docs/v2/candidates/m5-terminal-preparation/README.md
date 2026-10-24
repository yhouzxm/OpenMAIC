# Terminal 真实 Native 参考 / broker 准备候选

本目录三个文件现由 terminal inventory 的 `recoveryWiringSha256` 绑定。**NOT_WIRED_TO_EXISTING_CLUSTER / KEEP_ALL_FENCES**。已应用 migrations、旧 host 和真实 receipt 不变。

## 可运行的独立参考

从仓库根目录执行：

```sh
pnpm exec tsx docs/v2/candidates/m5-terminal-preparation/prepare-reference.ts --output-dir /absolute/new/private-directory
```

输出目录必须不存在；创建为 0700，文件 0600，不覆盖旧产物。仅创建唯一临时 Unix socket PG16 cluster，禁 TCP，socket port 56492；不存在 DSN/现有 cluster 参数，不读取本地开发配置或真实签发私钥。

实际执行 Identity/Bridge/Native bootstrap、空 Business migrations、Content 0001/terminal 0002，Native 调用现有 `provisionNative`，使用公开 Storage `ensureAssetSchema` / `ensureDocumentSchema`。不是五表模拟。源码、实际使用的 dist、bundle inputs、bundle、候选 inventory 分别 hash；tracked Storage/DSL source 与本地已有 official commit 对照。没有从网络下载，也不声称 dist 经本轮完整重建。

输出：

- `native-reference-draft.json`：完整 before/after 与额外 Native 索引定义。**未签名，UNSIGNED_REVIEW_REQUIRED**。包含显式 additive Business CONNECT ACL，不能直接改名为 signed expected。
- `source-bindings.json`：本次参考构建的精确来源。
- `evidence.json`：三项修复的负向验收、broker 定向验收与证据限制。

参考实际执行来源绑定的 `00-business-connect.sql`，保留七个普通角色 CONNECT 后撤销 PUBLIC CONNECT；不再用隐含的测试调整。临时自签 expected/receipt 仅为 loader fixture，既不是独立 reviewed expected，也不用于验证 signer 的独立性；不导出这些 key/回执，finally 停 cluster 并删除。没有现有 cluster 比对，没有真实 authority/receipt 签发。

## broker 接线准备

`technical-broker.cjs` 导出 `adoptTechnicalBroker(ctx)`，只接受已有的 admin/Business/Native 三条物理连接及 public pin/expected/receipt 路径。由 `terminal-installer.cjs --install-blocked-hold` 在成功返回后同进程交接；不能在关库后重新 connect。

只提供 `inspect / status / close`：默认复用修复后的 loader；显式 `partial-recovery` 模式调用 `terminal-recovery.cjs`，核对来源/目标绑定的 install journal、实际 ledger 和 catalog。前后核对双库关闭、cluster、postmaster、PID/backend_start/role/database；单次检查 30 秒，SQL 5 秒、锁 1 秒、事务 idle 10 秒。拒绝重叠检查。失败/断连进入 sticky BLOCKED 并销毁连接；不重连、重放、开库、签发、注册 proof、finalize 或产生 window lease。status 是上次观察，不能当作当前授权或新鲜的停写证明。没有自动 heartbeat。

这是 **blocked 技术会话持有器**，还不是终态维护执行器。TI-01–03 已在候选修复。恢复模块另提供受限 controller 的精确 ACK 查询入口，使用 READ COMMITTED 事务（helper 需要行锁，不能用 PG READ ONLY），只观测 COMMITTED/NOT_OBSERVED；丢失回执保持 BLOCKED，无重放权。安装成功后的 hold CLI 已接入；真实开发库执行、操作系统锁、启动阻断、HBA/凭据轮换、独立 service connections、DB window/epoch/lease、takeover/resume 执行均未接入。不要把 postgres 技术安装连接登记为受限 ServiceActor。

部分安装失败的人工/后续执行器核对顺序、签发权限和真实接线前置条件见 [本轮评审与准备](../../zhiban-v2-m5-terminal-installer-review.md)。

2026-10-13 接续：独立维护控制执行候选已在 terminal/maintenance-*.cjs 实现，详见该目录 README。技术 broker 自身仍仅持有/观测；真实开发库、公共 Native proof 和完整 enabled gate 未接线。新 inventory 另绑定 launcher/content-receipt，历史参考 hash 不自动升级。
