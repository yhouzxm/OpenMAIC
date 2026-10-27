# PG18 版本化适配与远端验收准备

本包沿原 P7 持久化交付推进。[本轮 LOCAL closeout](evidence/p7-handoff/pg18-application-20261027/closeout.json)及其来源清单记录实际验收；GitHub 未运行。当前候选在 `refactor/zhiban-v2`，基线 HEAD 为 `093b4a69af96626010d9104c50d680d9b9dc1928`；dirty 实现须以本轮 source closure 为准，不能把该历史 HEAD 单独称为本轮交付版本。原 [PG18 逻辑迁移隔离收口](evidence/p7-handoff/pg18-20261027/closeout.json)保持原证明范围；新应用验收以本包 closeout 为准。

## 版本与权限边界

- 默认仍是冻结 PG16。新增显式 `PG18_V1` 入口，真实 PG18.6；四份内容 SQL 与三份 bootstrap 使用独立 PG18 候选，只改变版本前置条件。原已应用 migrations、旧 SQL／参考 JSON 与冻结 `openmaic/root.ts` 不改。
- PG18 独立预期值分别由空 PG18、空 PG16→逻辑恢复 PG18 构建。使用精确 catalog／ACL／角色／来源 hash，不将跨版本兼容归一结果当 provider 指纹。CI 只能重建比较，不能签发新参考。
- PG18 自身 owner 的 MAINTAIN 纳入精确预期；受限 runtime 增加 MAINTAIN 拒绝。receipt 绑定主版本、源 lineage、参考 pin、SQL ledger、代码、TLS 与专用目标；禁止跨主版本物理恢复和旧 receipt 混用。
- 新建应用只允许 `PG18_FRESH_V1`；已恢复 PG16 数据的 `PG16_IMPORTED_V1` 预期已准备，但没有自动重签旧 receipt、更新旧部署注册或激活导入数据的入口。旧 Native 维护授权、UNKNOWN／RESERVED 继续隔离。
- PG18 独立使用 `https://127.0.0.1:3478`、自己的 STATE／snapshots／TLS 和 socket-only cluster。普通 PG16 默认 3461、55432／55433、原快照指针不重定向。

## 本地入口

从项目根目录运行，专用非 root 用户、Node 22、pnpm 10.28.0。安装 `/usr/lib/postgresql/18/bin` 与 PG16.15（只用于独立导入参考构建）；私有展开的 PG18 可用 `ZHIBAN_PG18_BIN` 指定绝对 bin 路径，必要时提供其 `LD_LIBRARY_PATH`。不接受生产 DSN，也不连接既有全局 cluster。

```sh
# 新建私有目录的父目录也须由本人持有、限制权限；STATE 不可复用失败代次
mkdir -m 700 /absolute/private/pg18-instance
node scripts/zhiban-deploy/pg18.cjs reference --verify
node scripts/zhiban-deploy/pg18.cjs install /absolute/private/pg18-instance
# 另一终端：查看／备份／正常停止；install/start 为前台监督进程
node scripts/zhiban-deploy/pg18.cjs info /absolute/private/pg18-instance
node scripts/zhiban-deploy/pg18.cjs backup /absolute/private/pg18-instance
node scripts/zhiban-deploy/pg18.cjs stop /absolute/private/pg18-instance
node scripts/zhiban-deploy/pg18.cjs verify /absolute/private/pg18-instance
node scripts/zhiban-deploy/pg18.cjs start /absolute/private/pg18-instance
```

首次安装在新的 disposable 数据库中生成合成三角色和教学数据。正常停止生成同主版本快照并清理运行根；start 校验闭包后恢复同批账号／数据。失败保留私有材料，不覆盖 prior generation；已有 RUNTIME marker 的失败代次拒绝重新 install/accept，应选择新的 STATE。initdb 未完成或 postmaster 身份异常时，cleanup 拒绝猜测清理并保留本机诊断；GitHub 临时 VM 的终止销毁也属于最终清理边界。`recover STATE` 只处理已绑定且 HTTPS 已退出的实例，不用于覆盖活跃服务。

未显式传入 `OPENMAIC_CONFIG` 时使用私有空服务配置，服务显示未配置，不冒充真实调用。TLS 是本包私有 CA，不写全局信任。Node HTTPS 使用该 CA 验证链与主机名；定向 Chromium 只对本次 leaf 的 SPKI 放行，不设置通用忽略证书错误。此证书不代表真实域名 TLS 已交付。

完整本地定向验收：

```sh
mkdir -m 700 /absolute/private/pg18-acceptance
node scripts/zhiban-deploy/pg18-acceptance.cjs run /absolute/private/pg18-acceptance /absolute/private/pg18-summary.json
# 仅清理本次 marker／PID start／build hash／PG data 绑定的临时进程与根
node scripts/zhiban-deploy/pg18-acceptance.cjs cleanup /absolute/private/pg18-acceptance
```

验收集中覆盖独立预期重建、真实全量 host 启动、发布→学生互动／自测→原人工成绩、三角色 HTTPS、撤权／并发屏障，以及同主版本三库与账号恢复。身份 session／刷新 token／审计等易变记录不做字节相等比较；通过恢复后的原账号登录、空间权限和所有应用 loader 重新校验补足，不宣称 Identity 数据完全逐字节相等。外部模型、扫描和多模态服务不重复调用。

## GitHub 受保护验收方案

候选 workflow：`.github/workflows/zhiban-pg18-acceptance.yml`，仅 `workflow_dispatch`，无 push／PR／schedule 触发；只读 contents 权限、同名串行、Ubuntu 24.04、Node 22、pnpm 10.28.0。PG16.15 只构建独立导入参考；PG18.6 执行应用及恢复。精确包版本不可用时直接失败，不自动换主／次版本或修改 pin。

**私有材料交付方式：零本机材料上传。** runner 现场创建随机合成账号、实例密钥、私有 TLS、临时数据库与快照；没有运输 key、数据库 bundle、`.env.local`、模型凭据、公网数据库或旧维护输入。步骤不打印账号文件／dump／角色 SQL／私钥；原始日志、基线与截图不上传。结束时按 marker 清理，再移除 runner 私有目录。仅保留固定字段的 summary，7 天过期。

实际运行前一次性完成以下 checkpoint 范围，当前不执行：

1. 审核本轮 PG18 候选及其完整依赖闭包，形成一个实际包含 dirty 功能依赖的源码 SHA；旧 P7 source kit 不含本修复，不能直接替用。
2. 按用户授权提交／推送；workflow 文件须先按 GitHub 要求在默认分支注册，再对获批 ref 运行。禁止把这一步省略后冒称 workflow 已可 dispatch。
3. 创建／核对环境 `zhiban-pg18-acceptance` 的审批人、目标分支限制，在该环境设 `ZHIBAN_PG18_APPROVED_SHA` 为审核后的完整 40 位 SHA。workflow 与监督器双检该值等于真实 `GITHUB_SHA`。复用检查使用固定官方 commit `e19d0d4f45d81b8f7ab599b33ab03b0b8b68d5c0`；workflow 单独以 HTTP/1.1 获取该对象，不依赖本机未推送的 upstream ref，也不跟随移动分支。GitHub 环境保护见[官方文档](https://docs.github.com/en/actions/concepts/workflows-and-actions/deployment-environments)。本方案不需要任何服务 secret。
4. 获得本次运行授权后仅 dispatch 一次，记录真实 run ID／attempt／SHA；失败不自动重复派发。只下载 summary 复核，保留实际失败阶段。LOCAL 验收不伪造 `GITHUB_ACTIONS` 或 run 身份。

GitHub VM 通过只证明该 SHA 的合成隔离安装／恢复，不等于阿里云域名、PG18 托管服务权限、生产数据迁移、systemd、长期运维或生产切换通过。PG16 物理备份不能交给 PG18；跨大版本必须逻辑迁移／升级，依据 [PostgreSQL 18 升级说明](https://www.postgresql.org/docs/18/release-18.html)与 [pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html)。

下一完整交付为审核该源码 checkpoint 后的单次 GitHub PG18 验收；真实阿里云部署仍待主机／域名／受限连接配置。建议 GPT-6.1 Sol / high。
