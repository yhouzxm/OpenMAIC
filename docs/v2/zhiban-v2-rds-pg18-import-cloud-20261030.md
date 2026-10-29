# v1.3.0 PG16→PG18 导入、RDS 门禁与云端接续

本轮沿原 P3/P7 持久化交付包接续。**逻辑导入通过不等于正式宿主启用；GitHub runner 通过不等于阿里云 RDS 上线。**

## 本地已完成

- 新增独立 `PG16_IMPORTED_V1` 参考：仅从当前源码在全新私有 PG16 构造，再用 PG18 客户端逻辑导出／恢复到第二个全新 PG18；不读取目标数据库作为 expected。它与 fresh PG18 分开文件及 pin，替换成 fresh 参考即使重新计算 pin 也因 lineage 不符拒绝。
- `verify:zhiban:pg16-import` 对停止的 v1.3.0 快照制作只读源副本，导出三库、角色和私有宿主文件，恢复到新的 socket-only PG18。逐表数据、序列、角色／密码摘要、grantor、schema／ACL 比较；只有跨主版本 owner-only MAINTAIN 和保持 Boolean 结构的 CHECK 显示差异进入现有兼容分类，不能用于放松运行时精确 fingerprint。
- 现有持久化快照及 runner 同构的现场合成快照均完成三库导入，差异为零，真实 Identity composition／HTTP facade 下 ADMIN、TEACHER、STUDENT 登录、spaces、CSRF、退出及退出后拒绝通过。未启动应用页面或完整课堂，不冒充 HTTPS 页面旅程。
- PG16 源快照及默认指针不变；旧部署／generation／receipt 未重标。目标保留 `providerActivated=false`，复制的 PG16 receipt 不能被用来激活 PG18。
- runner 数据由现有受限产品命令现场创建；用真实实例密钥 provider 生成完整私有恢复材料，不使用本机账户、模型配置或私有备份。失败目标保留隔离标记，拒绝原地重试；云端清理先核对自有进程／二进制／数据目录再停止集群，之后才删除私有文件。
- RDS 只读预检现在单列“能创建数据库／角色”与“冻结角色图是否已预置”。真实 PG18 验证了普通 CREATEROLE 创建角色留下额外 ADMIN 关系，预检明确拒绝据此声称可完成规范 bootstrap。CA、TLS、管理库、来源 pin 与无写入边界保持。

```bash
# 前提：PG16、PG18 客户端与项目依赖已准备好；输入须是停止且已升级到1.3.0的快照。
ZHIBAN_LOCAL_PG_PROFILE=PG18_V1 ZHIBAN_PG18_LINEAGE=PG16_IMPORTED_V1 \
  pnpm build:zhiban:upstream-reference -- --verify
pnpm verify:zhiban:pg16-import /absolute/snapshot MANIFEST_SHA256 /absolute/new-private-output
```

脚本只作用于自己创建的私有副本，不能传入 RDS URL。`RESULT.json` 是允许公开的结论；`roles.sql`、dump、host-files、比较明细和原始日志均为私有材料，禁止提交／上传。原始快照缺少实例密钥等必需闭包时失败；合成数据准备工具通过真实实例密钥 provider 补齐自己的来源，不替真实备份编造缺失密钥。

本机证据见 [持久化副本导入](evidence/persistence-130/rds-import-cloud/import-existing-snapshot-local.json) 与 [现场合成数据导入](evidence/persistence-130/rds-import-cloud/import-synthetic-local.json)。早期失败副本仍在本机隔离；LOCAL 不伪造 GITHUB_ACTIONS。

## GitHub 具体范围

手动 workflow `zhiban-pg18-acceptance.yml` 绑定环境批准 SHA，拉取 v1.3.0 上游 c0f296a…，只在真实 GitHub 运行中记录 run／attempt／SHA。验证独立 fresh／imported 参考、RDS TLS 与权限拒绝、现场 PG16 三库逻辑导入、PG18 应用定向旅程、全新安装、三角色 HTTPS，以及在线备份／正常停止快照的同主版本恢复。上传仅允许公开摘要和经过既有 allowlist 的启动阶段；私有库、凭据、实例密钥、原始日志及本机材料不上传。

真实 GitHub [run 40942085416 / attempt 1](https://github.com/yhouzxm/OpenMAIC/actions/runs/40942085416) **SUCCESS**，代码 SHA `9072c48f62141b86ada18819667978c2609024a9`。上述九个阶段完成，清理步骤成功，artifact 仅有公开摘要。见 [原摘要](evidence/persistence-130/rds-import-cloud/github-summary.json) 与 [范围 closeout](evidence/persistence-130/rds-import-cloud/closeout.json)。后续文档 checkpoint 不改变被测代码 SHA；旧 1.2.x GitHub PASS 保留旧范围。

## 尚未完成，继续隔离

1. **正式 RDS installer／受限运行宿主仍未交付**。LOCAL authoring 角色拥有数据库并在启动时初始化 schema；必须拆分安装与运行角色、独立构造 RDS 对应 owner／grantor／ACL 参考，并将正式启动改为只验证已安装 schema。不能用普通 LOCAL launcher、增授运行 DDL 或放松冻结 Identity／Native 角色图替代。
2. **PG16 导入后的应用 receipt 重绑／启用未完成**。独立 imported 参考与数据导入已通过；不能把 copied PG16 receipt 改 major 后当签发证明。历史部署／generation 必须保留，需独立新部署及宿主启用验证。
3. **真实阿里云目标与生产身份交付仍待**：有效 SSH 共享连接、明确 RDS 管理库、能合规预置冻结角色图的特权路径、专用三库运行凭据、受信 CA、HTTPS IP:88 证书及续期、生产 Identity／首管理员批准输入。旧“SSL off、普通账号无 CREATEDB／CREATEROLE”的观察不会被本轮 loopback 结果改写。RDS SSL 开启或共享服务变更需具体目标授权。
4. 旧 Native 维护授权、仪器实测、真实外部服务调用不在本轮签收内。

下一完整包仍是正式安装／运行宿主及 PG18 receipt 启用，建议 GPT-6.1 Sol / high。整体任务未完成前，不按“完成后关机”提前关闭电脑。
