# M5-A/B 本地安装与文本编辑发布闭环

本轮后续状态：用户选择的 [UNKNOWN/RESERVED 只读对账报告](zhiban-v2-m5-readonly-reconciliation.md)已 LOCAL 验证（20/20，host 冒烟 5/5）。全部既有隔离保持；Native 完整内容摘要证明、终态结算与解除隔离继续 deferred。下文原始证据保持其原来源/hash 适用范围。

2026-10-09（Asia/Shanghai）。STATUS: LOCAL_VERIFIED / UNCOMMITTED_CANDIDATE。

分支 `refactor/zhiban-v2`，基线 `daf63afa83470d24a9ed41d171c6a17f8a80adb6`；现有 M1–M4 未提交增量保留。用户授权实现本地 installer、receipt issuer/loader 与文本闭环。本轮无 commit、push、GitHub CI、生产数据或部署。

后续状态：installer/receipt/enabled composition 已完成[独立复评与修复](zhiban-v2-m5-installer-enabled-review.md)，最终产品 19/19、启用负向 25/25、撤权屏障 26/26、installer 5/5。下文首轮 17 场景与旧绑定保留历史范围；当前绑定见复评记录。UNKNOWN/RESERVED 授权对账仍未实现。

## 1. 可用功能与启动

管理员在 M2 管理课程、教学班、任教与 Enrollment；任教教师和已选课学生从教学班“教学内容”进入独立页面。教师创建内容、管理 slides 与文本框、编辑几何、undo/redo、保存、预览、显式发布与撤回。学生只能看到当前有资格读取的已发布 Native 版本；编辑草稿不会替换学生已发布内容。预览不生成 Attempt、成绩或完成事件。

```bash
pnpm build:zhiban:m5
pnpm setup:zhiban:m5
pnpm dev:zhiban
```

当前服务已运行于 `https://127.0.0.1:3443/zhiban`，沿用受信任开发证书与 M1 合成账号。命令依赖已经安装并核验的 M1–M4 私有本地配置；不是生产或任意 DSN 的通用部署器。源码或 artifact 变化后先 build、再 setup，最后重启 host；receipt 不匹配时启动拒绝，不自动降低校验或执行 DDL。

构建先从固定公开 package source 重新生成 DSL/storage/renderer/editor artifacts，再生成纯文本浏览器 host 与私有 ESM installer/server。只有已完成该轮 fresh package build 后，内部 `--bundle-only` 才用于本轮宿主修改的重打包。公开 DSL 文档协议为 `0.3.0`，不同于 DSL 包版本 `0.11.2`。公共包固定来源沿用官方 SHA `1f05a70ac93e09c67fb4d3aafb9c2b068d14fcce`；没有改 core/package source 或冻结 migrations。

## 2. 本地安装与 receipt 边界

| 项目 | 实际边界 |
| --- | --- |
| PG | 自有 PG16、端口 55433，固定 data directory / private socket |
| Business DB | `zhiban_m1_dev`，保留 M1–M4 数据，新增 Content 逻辑 migration `0001` |
| Native DB | 独立 `zhiban_m5_native`，使用原始 bootstrap 和公开 provisionNative/DocumentStore |
| 既有测试环境 | `55432/zhiban_pg16_test` 未使用、未修改 |
| 前置核验 | 原始 13 个 Identity 与 Academic/Learning/Assessment source/checksum/live ledger；精确 baseline catalog/ACL |
| 应用 | installer 显式事务、advisory lock、00 前置检查、owner role 按 01→02→03 应用并录 ledger、enabled profile 匹配后提交 |
| 重复运行 | schema 已存在时核验 source/ledger/profile，不重放 migration，不清空或覆盖数据库 |
| Native | 独立 runtime/migrator/owner、PG16 membership flags、runtime 最小 ACL、业务角色不得 CONNECT Native |
| 配置 | 固定 localhost/database/role，无 DSN query override；配置、凭据、证书 key、node artifacts 均私有且 owner-only |
| 启动 | 验证技术 receipt、文件与 artifact hash、完整 live profile、Content ledger、deployment/native fingerprint/ACL；M1–M4 loader 各自核验原 ledger；无启动 DDL |

技术 receipt 为 `LOCAL_M5_INSTALLATION / VERIFIED`，`evidenceOrigin=LOCAL`、`githubActions=false`。绑定配置 digest、候选 SQL/inventory、实际 deployment/provisioning、schema/ACL profile、源/构建 artifact、TLS/CSP；私有 issuer 在 live 校验完成后才写入，loader 每次启动重新验证。没有在仓库放密码或完整 DSN。可分享的去凭据记录见 [安装证据](evidence/m5-installation-local.json)。

它只证明技术安装与该宿主绑定，**不是完整 enabled Bridge gate 或生产 release 的签收 receipt**。历史 `receipt.template.json` 保持 `UNISSUED`；其中生成时 `UNAPPLIED` 表示模板历史，不覆盖本地开发库已经应用的事实。01/02/03 的 UNAPPLIED 注释保持原 bytes，不能为改状态重写已应用 SQL。

首次安装跨两个数据库不是 ACID。若 Native DB 创建后、私有配置落盘前发生崩溃，installer 对没有可核验配置的既有 Native DB 拒绝自动接管/重置；需要明确人工检查。不存在通用 destructive cleanup。独立 SQL verifier 仅清理自己精确创建的临时目录/cluster；开发 Native、教学内容和未知结果保留。

## 3. 内容、授权与跨库事务

闭合 `content-text-v1` DTO 双侧验证：1–32 slides、每页最多 32 文本框、全资源 UUIDv7 唯一、960×540 有界整数几何、正文最多 2000 UTF-16 units、请求最多 256 KiB；拒绝 HTML、外链、多余字段与 native refs。服务器分配 native Stage/Scene refs，owner-scoped public DocumentStore 保存及回读，校验完整 canonical document digest。

每次业务事务在同一 Bridge client 上调用原始 private Identity guard，验证 actor 与内容 owner 的 ACTIVE User/Membership，再由原始已审核 content helper 锁定当前 Course/Offering/任教或 Enrollment。单个当前 grant 必须独立满足 role 与 scope。教师/学生兼任读取在教师资格拒绝时仅对当前 STUDENT SELF 的 READ 用新事务重验，不在 aborted 事务内恢复、不放宽 Academic raw SELECT ACL。原始 foundation composition 的 disabled 语义保留。

请求使用 frozen admittedOperation 上限与同一 10 秒 Deadline，PG 锁/语句期限保持 frozen 合同；业务错误在 admission 包装中保留 400/403/409 状态。CAS/idempotency 与 publication/audit 是 durable PG 事实，生产文本和 learner text 不写操作日志。

发布经历本地 reservation → 新鲜 dispatch 检查 → fresh Native 事务公开保存/回读（每次 Native COMMIT 前复核授权/期限）→ 本地 Bridge activation/publication/resource/audit 原子结算。失败后不能把 native commit 假装回滚；UNKNOWN fence 保留，拒绝保存/重发/撤回直到授权 reconciliation。没有自动 retry、delete 或 owner 转移。

## 4. 实际验证与适用范围

- [产品 HTTPS/API/PG 旅程](evidence/m5-ab-local.json)：19/19 PASS，真实 Native 文本保存、多行文本、版本切换、草稿/发布隔离、教师/学生浏览器、undo/redo、保存/发布/撤回与 Enrollment 撤销。
- [启用相关负向与故障验证](evidence/m5-enablement-gates-local.json)：17/17 PASS，receipt/hash/config 伪替换、真实 Native TEMP ACL 漂移、实际 RLS 漂移、两 Session 受控 resource/Identity 锁链中的 CAS 单成功、任教撤销、登出后拒绝写入，以及真实 Native COMMIT 后本地结算失败的 UNKNOWN fence。
- [独立临时 PG16 状态矩阵](evidence/m5-sm01-fix-local.json)：相同 SQL 53/53 PASS，增加真实 baseline/enabled profile 采集；不是开发库运行、不是 Native provider 功能证明。
- [离线安装候选检查](evidence/m5-ab-installation-static.json)：42/42 PASS。该脚本不连接数据库，`migrationApplied=false` 表示该检查没有应用，不覆盖本轮 installer 实际应用事实；pglast parser 未运行，真实 PG16 DDL 已执行。
- M1 18/18、M2 20/20 回归通过；M3 26/26 通过（修复新增教学内容链接遮挡活动入口）。M4 21/21 通过。M3/M4 已在最终 artifact 上复跑；M1/M2 沿用本轮较早启用 artifact 的通过结果，之后仅内容授权/错误映射与链接 CSS 有界修复，适用范围记录于安装证据 regression 字段。
- `pnpm exec tsc --noEmit --pretty false` 通过；最终 `git diff --check` 与来源/hash 复核见安装证据。

editor/preview 专属 CSP 为 connect-self、两个实际 renderer style hash、style-src-attr none；没有 unsafe-inline 或外部 requests，非内容 HTML 保留原策略。实际产品 stylesheet 证据见 [样式测量](evidence/m5-content-csp-styles.json)；[profile](evidence/m5-content-csp-profile.json) 的 PRODUCT_JOURNEY_PENDING 是构建前声明，验收结果由上述实际 19 场景 evidence 覆盖，避免事后修改已经绑定的 artifact。Node HTTPS 使用开发 CA 校验，Chromium 使用当前 leaf SPKI pin；没有全局 ignoreHTTPS 错误。此浏览器验证不声称测试了所有浏览器引擎。

原有 C9/Storage CI 与先前 review/fix 的旧 hash 证据保留其原范围。本轮全部 LOCAL；没有第二次机械跑 GitHub，也没有冒充 GITHUB_ACTIONS。

## 5. 剩余门禁与下一步

本轮完成可用文本闭环与技术安装；D08 的公开 core/renderer 受限纯文本 host 集成已得到真实产品证据，**不等于默认富文本 editor/UI、U01 完整课堂或所有 enabled security gate 已签收**。

独立权限/事务复评及上述撤权屏障已完成，见复评记录；仍需受授权的 exact unknown-outcome reconciliation operator。故障测试留下的 orphan Native 文档/UNKNOWN 内容资源，以及此前诊断失败资源，均为合成开发数据并保留 fence，不能盲删或自动重放。

M5-C PNG、M5-D Runtime、M5-E AI、生产网络/密钥/备份/真实数据迁移和 release/UAT 继续 deferred。内容 gate 的局部 PASS 不标 `1B-10` / `PHASE_1B_COMPLETE`。

下一步形成 UNKNOWN/RESERVED 授权对账的精确设计与实现，随后按产品优先级推进 PNG 或最小 Runtime 受支持契约。建议权限/事务评审用 GPT-6 Astra / high，常规页面功能实现用 GPT-6.1 Sol / medium；这是任务匹配建议，不是本轮启用或 checkpoint 授权。

## 6. 首轮交付精确绑定（当前绑定见复评记录）

- migration aggregate：`e335f83bb48cc6c4ec754f8e3270dc0e6941e14f38306bd67aa29844c3713324`
- inventory：`022ccfb894f2b7dbfdf1a830d45a09be2f75ade094ad3df8db6d087299edf865`
- implementation binding：`99630d007e33b68276cc5592ab311bde9a7301f63d9b9586a17bc01b9b7a3814`
- enabled catalog/ACL profile：`59d93dd5ba57e387a7032a1cd7f92ecf1d70b82a1546bf16fd1b9cdc6a402ae4`
- Native public catalog：`50841b3ad3830ea74dd48247939be9108aa0b9aad5c1e4f84dc5489b12e39036`
