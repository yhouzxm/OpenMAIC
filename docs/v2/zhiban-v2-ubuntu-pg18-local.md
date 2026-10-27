# Ubuntu／PG18 持久化交付与隔离恢复验收

> 2026-10-27 后续更新：独立 PG18 全量 host 首装、原生课堂、三角色、停机及在线备份恢复已 LOCAL 通过，见[版本化适配与远端准备](zhiban-v2-pg18-readiness.md)。本页以下保留首轮逻辑恢复的历史边界；原 PG16 导入实例仍未重新签发应用 receipt，不将新建 PG18 的证明扩展到导入激活或生产部署。

本轮按用户“先本机隔离验收”执行。环境为 Ubuntu 24.04、Node 22、pnpm 10.28.0；PG18 使用 PGDG 包在私有目录展开，没有执行系统安装、开启公网数据库或修改原 PG16 集群。实际制品、pin、验证与未通过项统一见 [本轮收口](evidence/p7-handoff/pg18-20261027/closeout.json)。

## 首轮隔离验收结论和历史边界

三库的 **PG16→PG18 逻辑迁移、PG18→全新 PG18 恢复与重启**使用真实数据库验证；数据、序列、角色密码材料的摘要、角色授予者、ACL、RLS、函数、约束、域／枚举与私有文件有独立比较。SQL 角色密码、合成账号、实例密钥和宿主文件仅在 0700／0600 私有材料内。原 PG16 快照／指针、生产端口与冻结 migrations 保留。

**首轮未签收 PG18 全量应用部署。** 原统一 host、内容 loader 与冻结 Bridge provider 明确绑定 PG16，并绑定 PG16 catalog 指纹。PG18 的 NOT NULL 目录项、owner MAINTAIN 权限和 CHECK 显示方式使原指纹不同。新工具的兼容比较只用于隔离数据恢复，不代替冻结 provider 检查、不重签旧 receipt，也没有开启旧 Native／UNKNOWN／RESERVED。

三角色真实 PG18 Identity 组合与 HTTP facade 的登录、本人空间、CSRF 和退出已定向验证；它不等于完整页面／课程／评分 host 在 PG18 启动。公网域名、目标 TLS、systemd 应用守护、跨机与生产切换均未据此签收。未接目标机，没有 SSH、真实数据迁移、Git 提交／推送或新 CI。

## 可复用工具

`scripts/zhiban-deploy/pg-transfer.cjs` 是 Node 标准库 bootstrap，不要求先运行整套教学测试。只接受自己的私有目录、空的新目标、无 TCP 的专用 socket 及 56540–56559 端口。`clone16` 先验证原物理快照完整 hash 闭包；使用 PG16 启动只读副本，PG18 客户端做逻辑导出。三库切点要求没有应用连接并以只读方式启动，不能把线上三次独立 dump 当作原子业务快照。

```sh
# 使用专用非 root OS 用户；所有路径须绝对、父目录 0700；BINARY18 指向 /usr/lib/postgresql/18/bin
node scripts/zhiban-deploy/pg-transfer.cjs clone16 SOURCE16 56540 SNAPSHOT SNAPSHOT_PIN
node scripts/zhiban-deploy/pg-transfer.cjs start SOURCE16
node scripts/zhiban-deploy/pg-transfer.cjs export SOURCE16 BINARY18 NEW_PRIVATE_BUNDLE SNAPSHOT/root
node scripts/zhiban-deploy/pg-transfer.cjs init18 NEW_TARGET18 BINARY18 56541
node scripts/zhiban-deploy/pg-transfer.cjs start NEW_TARGET18
node scripts/zhiban-deploy/pg-transfer.cjs restore NEW_TARGET18 NEW_PRIVATE_BUNDLE BUNDLE_PIN

# 验证后的 PG18 数据再次备份；宿主私有文件随包携带
node scripts/zhiban-deploy/pg-transfer.cjs stop NEW_TARGET18
node scripts/zhiban-deploy/pg-transfer.cjs start-readonly NEW_TARGET18
node scripts/zhiban-deploy/pg-transfer.cjs export NEW_TARGET18 BINARY18 NEW_PG18_BACKUP
# 在另一个全新 init18 目标恢复此包，然后正常 stop/start 并核对
```

备份包含三份 custom-format dump、角色 SQL、私有 inventory、原宿主文件、MANIFEST SHA256。恢复仅删去全新目标已由 initdb 创建的 `CREATE ROLE postgres;`，保留其 ALTER、密码和 GRANTED BY；bootstrap 名称保持 `postgres`，避免 PG18 的 grantor ADMIN 检查改变原授权。失败的目标保留 `RESTORING.json`，不签 `RESTORED.json`，不能原地重放。宿主文件只复制到 `host-files` 隔离命名空间，不重绑定旧签名／DSN。

兼容比较使用 SHA256 行指纹；只分类 owner 自身新增的 MAINTAIN，并按保留原子／字符串的布尔结构比较 CHECK 的 AND／OR 结合差异。新增 runtime 权限、RLS 变化、数据／角色／文件差异均拒绝。PG18 的 NOT NULL 另由列／域的 required 属性核对，不将跨版本比较冒充原冻结 catalog 相等。

## Ubuntu 主机准备和切换顺序

1. 保留原实例与离机备份；先检查目标 Ubuntu 架构、Node 22.19+（22 大版本）、pnpm 10.28.0。按 [PostgreSQL 官方 Ubuntu 安装说明](https://www.postgresql.org/download/linux/ubuntu/)配置 PGDG；已有目标 PG18 不重复建立全局 cluster。当前源码安装 bootstrap 的 PG16 fallback 仍需要 PG16。
2. 用本轮 source kit 的 manifest pin 校验源码／独立安装；运行 `install.cjs install KIT NEW_WORKSPACE KIT_PIN`。安装目录必须新建，不覆盖现有服务。源码不含 `.env.local`／`openmaic.yml`、数据库或私钥。
3. 私有恢复包和模型／扫描／解析配置走独立受保护交付；源端与目标端分别验证 pin、权限与外部依赖。数据库内加密凭据及 `native-secret/instance-secret.key`须成套保存；外部 `OPENMAIC_SECRET_KEY`不能由数据库备份替代。
4. 先在目标新的私有隔离 cluster 恢复并核对。PG16 数据目录绝不能直接交给 PG18，依据 [官方跨版本升级说明](https://www.postgresql.org/docs/18/upgrading.html)。逻辑备份格式与读取范围见 [pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html)。
5. **首轮停止在隔离验收。** 后续版本化应用适配包当时需独立 PG18 catalog／ACL 参考、版本化 installer／receipt／loader、host 配置／origin 与生命周期接线；保留 PG16 冻结入口。通过 PG18 全应用启停、三角色、撤权与恢复后，才准备域名 TLS／受限 systemd／原子 release 切换与回退。现在不提供一个实际仍运行 PG16 的 service 文件冒充 PG18 部署。

用户只选择本机验收，真实阿里云主机、域名、证书和运维交付仍待输入。下一包建议 GPT-6.1 Sol / high；不再重复多模态服务调用、无关课堂回归或旧 CI。
