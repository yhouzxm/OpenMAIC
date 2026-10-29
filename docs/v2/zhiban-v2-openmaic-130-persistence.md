> 2026-10-30 接续：[PG16→PG18 导入与云端范围](zhiban-v2-rds-pg18-import-cloud-20261030.md)已补独立 imported 参考和三库导入验证；本页“未签收”的历史状态以该接续说明区分，正式 RDS 宿主和导入后 receipt 启用仍待。

# v1.3.0 持久化副本迁移、恢复与 PG18／RDS 接续

2026-10-29。范围沿原 P7 持久化交付；用户选择先完成本地副本与部署工具。代码仍是 `refactor/zhiban-v2` / `038a28e8181e8fddcf69a386244da64044a3486b` 上的 dirty 候选，上游固定 `c0f296aa36096ec3d1e1e2b94a7a48e20075e0a1`。本轮没有提交、推送、CI、阿里云连接或生产部署。

## 实际交付与范围

| 内容 | 本轮范围 |
| --- | --- |
| 旧持久化库升级 | 从 10-28 的三库物理快照读取完整 hash 闭包，复制到隔离工作根后升级。原快照、默认 latest 指针和账号文件保留，不直接升级原实例。 |
| 精确版本／来源 | 校验旧 provider tuple、旧 Native 独立参考、已应用 ledger 和历史 profile；只执行新增 Identity 0015 和上游版本化迁移。新 deployment／receipt 独立生成，历史 deployment、generation、发布和授权记录不重标记。 |
| 资料池 | 调用原生 `migrateOwnerMaterialsToPool`。真实快照内没有待回填旧原件，报告 scanned=0；不声称在该快照上验证了非空旧原件迁移。原文件、实例密钥、用量及三个数据库进入完整新快照。 |
| 数据／恢复 | 迁移前后按旧列逐表核对数据与账号摘要；原件指针是唯一允许按原生合同调整的旧资料字段。真实管理员／教师／学生登录和 HTTPS 工作台、正常停止保存及再次恢复后三库稳定行摘要核对；不重复整堂课。 |
| 失败边界 | 错 pin、路径重叠、外部 DSN、已占用工作根、未知／改写的已应用迁移均拒绝。Native DDL 后、保存前、保存后故障保持源快照与旧指针；失败命名空间保留隔离标记，不可自动启动。 |
| PG18 | 在用户目录按 APT 元数据 SHA256 核验并解包 PG18.6，不安装系统服务，不替换 PG16。构建本版独立 PG18 参考并通过本地编辑／知识库／发布旅程；MAINTAIN、版本混用与旧 Native DENIED 负向检查包含在内。 |
| RDS 工具 | `plan`／`preflight`／`stage` 已接配置、源 pin、强制 CA＋主机名 TLS、显式管理库及未应用 SQL 交付。真实 loopback PG18＋SCRAM＋TLS 检查，包括 3D000、错误 CA、禁用 TLS 参数、旧应用库名和错 pin。不是生产 installer／运行宿主的签收。 |

非空旧原件在单独的合成 PG16 夹具中验证 owner/root、原始字节摘要、错误摘要拒绝、重试及幂等；不将该夹具记为实际快照回填。

本轮 PG18 复验曾复用旧目录，覆盖上一轮三张截图。旧 receipt 的原 hash 保留，这三项不能继续作为原 PG16 截图附件；日志和其余匹配附件保留原范围。详见[附件适用范围说明](evidence/openmaic-130/ARTIFACT-SCOPE-NOTE.json)，本轮 PG18 图片另存并已将后续验证改为每次独立目录。

最终结果、日志及交付 pin 见 [LOCAL receipt](evidence/persistence-130/closeout-local.json)。源码包与私有数据包分开，均只保存在本机私有目录；不包含依赖的来源包需要冻结安装，私有恢复包不得上传到普通 Git 仓库。历史 GitHub PG18 和旧 P7 证据仅保留其原来源范围。

## 本地升级与恢复操作

先正常停止旧实例。升级器不停止不属于自己的进程；只接受已停止、完整 hash 校验的 LOCAL PG16 快照。源物理快照包含全部三个数据库；不接受外部 DSN、任意 data directory 或已存在目标命名空间。

```bash
# SNAPSHOT、PIN、STATE 均使用本机受限路径／清单中的值；STATE 必须为新的独立绝对路径。
ZHIBAN_LOCAL_STATE="$STATE" pnpm upgrade:zhiban:snapshot inspect "$SNAPSHOT" "$PIN" "$STATE"
ZHIBAN_LOCAL_STATE="$STATE" pnpm upgrade:zhiban:snapshot upgrade "$SNAPSHOT" "$PIN" "$STATE"

# 只启动升级后的副本；默认旧命名空间没有被替换。
ZHIBAN_LOCAL_STATE="$STATE" pnpm trial:zhiban
# 当前同版源码后续调整时，显式刷新同版 host 绑定；该开关不能升级旧 1.2.x 快照。
ZHIBAN_LOCAL_STATE="$STATE" pnpm trial:zhiban --upgrade-local
ZHIBAN_LOCAL_STATE="$STATE" pnpm exec tsx scripts/zhiban-local/trial-control.ts stop --unified-trial
```

`UPGRADE.json` 记录源快照 pin、旧 receipt hash、新 deployment、数据保持及新快照位置。`UPGRADING.json`／`FAILED.json` 出现时启动与恢复均拒绝；升级失败会移除仅属于新命名空间的 latest 指针，不修改旧指针。快照保存成功不等于启用。硬杀／断电若留下工作根或 operation lock，不自动清除或接管：先确认没有活跃写入与所属进程，再按受控恢复流程处理；禁止删除旧快照或随意绕过标记。

旧源码／旧快照可以在独立旧环境恢复；新版资产池写入后的数据库不能原地降回 1.2.x。没有执行默认 namespace 切换；新副本的具体路径和包 pin 认本轮 LOCAL receipt。

## PG18 本地入口

本机独立二进制目录为 `/home/zxm/.local/share/zhiban-pg18-runtime/root/usr/lib/postgresql/18/bin`，所需 liburing 在同一私有解包根；包来源／hash 在其 `runtime.json`。它只用于本地验证，不是 RDS 服务端安装。

```bash
export ZHIBAN_PG18_BIN=/home/zxm/.local/share/zhiban-pg18-runtime/root/usr/lib/postgresql/18/bin
export LD_LIBRARY_PATH=/home/zxm/.local/share/zhiban-pg18-runtime/root/usr/lib/x86_64-linux-gnu
ZHIBAN_LOCAL_PG_PROFILE=PG18_V1 pnpm build:zhiban:upstream-reference -- --verify
ZHIBAN_LOCAL_PG_PROFILE=PG18_V1 pnpm verify:zhiban:upstream130
```

本版 `pg18.cjs` 绑定 `candidates/openmaic-130` 新参考与 applicationVersion，旧 PG18 状态不会被当作新版本自动接续。新 `PG18_FRESH_V1` 证明不覆盖 `PG16_IMPORTED_V1`；PG16 数据逻辑导入 PG18 的独立 profile／receipt 仍未签收。当前副本是 PG16，不得将其物理 data 目录交给 PG18 启动。

## RDS 配置、预检与未应用交付

以 [配置示例](candidates/openmaic-130/rds-input.example.json) 为起点，在服务器私有目录写入 0600 配置。只引用独立部署管理员的受限 `DATABASE_URL` 文件和受信 CA，不复制原 OpenMAIC 的全部配置。必须填准确 RDS endpoint、端口、三个独立 `zhiban_` 数据库名和现存管理库；URL 不得携带 `sslmode=disable` 等 query 参数。

```bash
pnpm deploy:zhiban:rds plan /var/lib/zhiban/config/rds-input.json
pnpm deploy:zhiban:rds preflight /var/lib/zhiban/config/rds-input.json
# 审核上一步 planSha256 后，生成没有凭据的未应用材料。
pnpm deploy:zhiban:rds stage /var/lib/zhiban/config/rds-input.json /var/lib/zhiban/rds-stage REVIEWED_PLAN_SHA256
```

预检只在管理库内运行 `BEGIN READ ONLY`，采集 PG 版本、TLS、创建对象能力、指定库是否存在及智伴角色属性，不读取业务数据。`maintenanceDatabase` 显式决定连接哪个现存管理库；`3D000` 必须修正该配置，不探测或改连其他应用库。返回 `READ_ONLY_PREFLIGHT_PASS` 只说明读取成功；`canCreateDedicatedObjects=false` 或 `productionReady=false` 不能解释为可以安装。

本工具不执行 DDL、不发放角色凭据、不修改共享 RDS SSL、不停止 OpenMAIC、不签发公网证书、不绑定 88、不启动 PM2／systemd。stage 保持 SQL 原字节并列明源 hash；不能把目录内的 LOCAL bootstrap 随意拼成 RDS 安装脚本。

## 集中保留的上线 gates

1. **RDS 正式 installer／loader 与最小权限宿主仍须完成**。当前普通课堂 authoring LOCAL 数据库由本地专用角色持有且有启动 schema 初始化；不能将其直接当作 RDS 生产运行角色，或给登录／API 角色增授 DDL 来绕过接线。应明确区分安装和运行角色，独立构建 RDS 对应的 owner／grantor／ACL 参考，再接本版完整服务与页面。
2. **真实目标尚未连接**。上次 RDS 只读观察为 PG18.4、SSL off、原普通账号无 CREATEDB／CREATEROLE；本轮 PG18.6 LOCAL 不更新这些事实。后续需有效共享 SSH、专用管理员配置及受信 CA；共享 RDS 开 SSL 可能重启旧服务，须独立安排。
3. **数据导入与正式切换**。PG16→PG18 的逻辑导入、应用 receipt 重新绑定、完整私有状态／实例密钥交付、HTTPS IP:88 证书及续期、守护／重启／备份恢复必须在新目标验收；不以 `pnpm build && pm2 next` 替代智伴完整宿主。
4. **旧可信 Native 维护链**继续隔离，不借本次普通课堂／资料池升级清旗。真实模型、解析、媒体服务本轮未重发，原服务证据不跨来源延伸。

下一完整包为「RDS 正式安装／运行宿主、独立授权 profile 与导入恢复」，建议 GPT-6.1 Sol / high。缺少远端输入仅阻塞实际目标操作，不阻塞本轮 LOCAL 副本和工具交付。
