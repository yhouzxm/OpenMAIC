# M5 terminal expected profile / installer / receipt loader 接线

日期：2026-10-12。branch `refactor/zhiban-v2`，HEAD `daf63afa83470d24a9ed41d171c6a17f8a80adb6`；工作区非 CLEAN，保留既有修改。本批状态：`BLOCKED_TECHNICAL_INSTALLER_IMPLEMENTED / NOT_APPLIED_TO_EXISTING_CLUSTER / KEEP_ALL_FENCES`。没有 commit/push/CI dispatch。

## 产物及行为

| 产物 | 行为 |
| --- | --- |
| [terminal-installation.cjs](candidates/m5-terminal/terminal-installation.cjs) | 来源/ledger 校验；独立签名 expected 与安装批准；完整前后 profile 比较；安装、签发及重读 blocked 技术回执的共享实现，供持久维护连接调用 |
| [terminal-installer.cjs](candidates/m5-terminal/terminal-installer.cjs) | 固定本地 PG16/55433/双库/pgdata，私有 postgres 配置；显式 --install-blocked 或 --inspect-blocked。安装预建目标连接，核验批准和排空，再仅关闭双库；检查入口没有开库权 |
| [terminal-sign-review.cjs](candidates/m5-terminal/terminal-sign-review.cjs) | 固定私有输入/输出的显式离线 expected/安装批准签名；不生成 trust pin，不采集目标 DB，不自动认可 actual |
| [11-complete-installation-catalog.sql](candidates/m5-terminal/11-complete-installation-catalog.sql) | 旧 Business 六 schema、新 schema 和 Native public 的全部函数、列默认值、domain、约束、策略、trigger、角色/边/default ACL；和 09/10 的有效权限组合 |
| [verify-local-pg16.cjs](candidates/m5-terminal/verify-local-pg16.cjs) | 独立参考 cluster、独立安装目标及部分失败目标；R3 故障注入、签名/来源/目标/权限/ledger/receipt/失败隔离验收 |

旧 Content loader、host build、package 命令、现有 installation receipt 和 implementation binding 未接入/放宽新模式。新模块仅接受 blocked 技术目的，不能被旧 host 当作启用凭据。

## 可信 expected 的来源及权限

固定 owner-only Ed25519 公钥 pin 来自另行预置的独立信任根；不会使用 envelope 中任意公钥，也不由签发目标、receipt 或私钥自动替换 pin。私有目录 0700、文件 0600、无 symlink；expected/批准/receipt 按不同 purpose 验签，绑定具体 source inventory/aggregate。签发私钥须匹配该 pin，安装前验证匹配，避免完成 DDL 后才发现无法签发。

expected 必须由另一 pristine shadow PG16 参考构建，包含 before 完整旧 profile、after 完整 profile 与 terminal 有效权限，并绑定独立参考证据 hash、review approval 和当前源码。签名者对“独立参考已评审”这个声明负责；程序能验证签名/来源，不能代替人工评审或防御恶意 OS owner/信任根持有者。目标 actual 只用于比较，不反写 expected。没有给当前开发库生成、预置信任根或签发真实 expected。

安装批准另行签名，精确绑定 expected 文件 hash、inventory、cluster identifier、双库 OID、PG16/port/data directory、5 分钟 TTL，以及停止 host/保持双库关闭的维护范围。目标 identity 在三个物理连接分别回读，必须同 cluster 且是真正 postgres superuser；普通 writer NOLOGIN、全部目标 backend 仅两条 installer 连接、prepared/subscription 为零等实际条件必须成立。

私有配置/签名文件名、封闭 payload 字段和命令详见 [候选 README](candidates/m5-terminal/README.md) 的接线小节。本轮不执行已有开发库 CLI，也不读取现有私有凭据。

## 安装与 loader 边界

安装前先验证 signed approval、完整旧 profile 和 applied ledger/source。安装本身不禁用普通角色或杀 backend；这些维护前提不满足即拒绝，不替代未来 HBA/凭据/启动阻断执行器。它可在目标连接预建后关闭双库，逐库/逐 DDL 阶段耐久记录 intent/confirmed，永远不在 finally 开库。

role bootstrap、observer、Business、Native 分别提交；Business 0002 全部 components 与 computed ledger INSERT 在同一事务。跨库无法 ACID：Native 阶段失败允许 Business 已有 0002，但保留 BLOCKED journal，不签 receipt、不 seed ready/service/grant，双库仍关闭。实际 partial recovery/reissue 协议和维护 broker 仍需后续实现，不能靠重新应用原 migrations 恢复。

成功的 signed 技术 receipt 为 `TERMINAL_TECHNICAL_INSTALLATION_BLOCKED / INSTALLED_BLOCKED`，固定 `installationReady=false / runtimeAccepted=false / terminalActionsAllowed=false`。loader 重新校验签名、来源、目标、全 catalog、ledger、关闭 admission 及未 seed authority；签名正确但声称 runtimeAccepted=true 同样拒绝。现有开发库的两份候选 receipt 模板继续 UNISSUED；fixture 回执仅在临时目录内签发并清理。

关闭 admission 后 loader 使用 broker 预持有的连接；独立 --inspect-blocked CLI 无法在关闭的 DB 中新建连接，会安全拒绝，不临时开库。这是当前接线限制，后续 broker 需调用共享 loader，才能实现持续维护检查。

## 本地验证

[运行证据](evidence/m5-terminal-installer-wiring-local.json)：**42/42 PASS**，包括：

- R3 原定向场景、无效签发参数拒绝；新增合法 provenance 在审计 INSERT 前注入 ZX001，精确断言该失败、许可与事件均无残留。R3-01/P3 的缺失用例已补。
- 独立 shadow fixture 的 signed expected 与安装目标比较；拒绝 unsigned/篡改/错 pin/非私有文件/错误 source/LIVE_TARGET 来源；错误 cluster/过期批准/旧 profile 漂移在 DDL 前拒绝。
- 真实技术 installer、Business ledger 原子提交、blocked receipt 重读；拒绝重复安装、receipt 篡改或伪造启用状态、Native PUBLIC 函数/default ACL/表 ACL、角色 LOGIN、ledger 及 admission 漂移。
- Native 查询 seam 注入安装失败：Business 0002 已提交、Native ACL 事务回滚、BLOCKED journal、无 receipt/ready/开库。该用例是客户端异常注入，不冒充 PG/网络崩溃恢复 driver。

[静态证据](evidence/m5-terminal-installer-wiring-static-local.json)：**13 组 PASS**，PG16 grammar 117 SQL / 34 PLpgSQL 可解析；来源、prerequisite 字节、receipt 模板、helper/ACL、签名 blocked 边界、离线计划通过。JS 格式/语法与文档链接检查通过。

全部为独立临时 0700 Unix socket cluster，禁 TCP；参考/安装/失败目标均 finally 停止并删除。Business 基础 migration/source 实际编译，R3 scope fixture 仍有 replica 初始化，Native 为最小五表。expected 信任根和 signed 回执均为 disposable fixture，不可拿来批准真实 Native schema。没有连接/调整 55432/55433、启动 host、改变旧 migrations/receipt 或解除业务隔离。

## 当前 hash 与下一步

Business aggregate 保持 `e1e7ea9517462edd855fb8715f49346db4c467c01aac43e8a370c39eebf7184a`；当前 inventory `38c415440ca07abb5565b96b1685376a85b5135dfcc4872baf5c2f1544860e98`。新 generic collector、三个 JS 接线文件和测试来源均进入 inventory；两份 UNISSUED 模板已派生更新。候选共 27 文件。历史 R3 证据继续绑定旧 inventory，其范围不改写。

下一步评审 expected 的信任根/签发权限、blocked installer 的部分失败与 ledger、loader 的隔离条件；然后准备真实 Native 独立参考与 broker/维护恢复接线。完整 proof worker、finalize、HBA/凭据/journal 恢复、host 启用及 production/enabled signoff 均 deferred。建议本轮增量复评使用 GPT-6 Astra / high；后续实现使用 GPT-6.1 Sol / high。

## 2026-10-12 接线复评状态

[本轮复评与准备](zhiban-v2-m5-terminal-installer-review.md)发现三个 P2：索引定义漏采、loader 返回前缺少最终 barrier，以及实际 bootstrap 的 PUBLIC CONNECT 与 terminal profile 不相容。原候选 hash 和 42/42 证据保留原范围；真实 Native 参考为未签名 BLOCKED，独立 broker 准备候选尚未接入。下一步先修复三项并重新生成参考。
