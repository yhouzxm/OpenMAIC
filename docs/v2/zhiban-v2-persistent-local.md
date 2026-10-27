# 本地持久化运行与恢复

2026-10-24。默认 `pnpm trial:zhiban` 已改为持久化入口，仍是本机受限 LOCAL 教学环境。既有 3461 三库、课程／作答、账号和 Native 文档通过 PG16 物理备份恢复，不重新 seed。没有修改已应用迁移；升级追加资源 material/0002、learning-files/0004、Tutor/0002，以及后续课堂编排、PBL、六维／EMA、校内成果及服务评分的追加迁移（具体仅认受控升级代码白名单），原来源校验和 ACL loader 保留。

## 使用

```sh
pnpm trial:zhiban          # 有快照则恢复；首次没有快照才初始化
pnpm trial:zhiban:info
pnpm trial:zhiban:backup   # 运行时一致物理备份，pg_verifybackup 校验
pnpm trial:zhiban:backup:verify
pnpm trial:zhiban:stop     # 停止PG，保存新一代快照，成功后清理临时运行root
```

正常停止后，下次启动保持同一批用户ID、密码、课程和历史。地址仍为 https://127.0.0.1:3461/zhiban 。账号仅在 info 返回的私有 accounts.json。停止后位于快照 root/accounts.json，不复制到源码包或聊天。

保存位置 `~/.local/share/zhiban-persistent/`（0700）。每代包含三库集群、私有运行文件及0600 manifest；latest.json 含 manifest hash。恢复核对完整文件集／hash、所有者、非链接目录、目标不存在；不会覆盖已存在root，不连接55432／55433。PG只使用私有Unix socket、固定56517、关闭TCP。快照操作使用排他目录锁，失败保留上代及运行root，不自动删旧代。

原生产语义保持：受限DB角色、Identity、Native／Content来源与profile、TLS绑定重新验证；普通启动不重新签发receipt、不自动升级。已审核的LOCAL升级显式运行：

```sh
pnpm exec tsx scripts/zhiban-local/start-persistent.ts --upgrade-local
```

只接受代码内列出的新增migration，已存在的checksum必须一致。迁移、旧receipt及新source绑定均留存；部分失败不启动HTTPS，保留root。正常模型配置仅从本机0600 `.env.local` 读取GLM_API_KEY、GLM_BASE_URL、GLM_MODELS、DEFAULT_MODEL，不把数据库凭据或其他环境项批量注入。扫描profile仍独立pin；过期／缺解析服务只关闭对应上传或解析。

## 异常恢复

本轮实际验证：HTTPS进程被强制终止，PG仍在；`pnpm trial:zhiban:recover` 拒绝正在运行的HTTPS实例，对记录绑定的私有PG核对目标、停库、生成并独立检查快照，再移除临时root。随后普通启动恢复。成功返回前不移除原数据。

需要选择历史快照时，在没有运行root时使用：

```sh
pnpm exec tsx scripts/zhiban-local/persistent-snapshot.ts select /绝对路径/某代快照
pnpm trial:zhiban
```

源／profile不匹配仍拒绝启动，历史快照并不授权改写已应用migration。残留 `.operation-lock`、断电遗留的stale postmaster.pid、跨主机或不同PG大版本恢复仍须操作者核验，本轮未签收自动处置。不要直接删除运行root或锁来绕过检查。

## 证据和边界

- `evidence/zhiban-persistent-first-local.json`：原三角色账号／工作台及受信HTTPS，快照hash篡改和外部路径拒绝。
- `evidence/zhiban-persistent-second-local.json`：正常停止保存后再启动，账号文件hash与所有非Identity业务／Native表记录数一致（登录自然新增会话记录）。
- `evidence/zhiban-persistent-recovered-local.json`：强制HTTPS退出后恢复，原课堂数据、账号及真实AI伙伴回答保持。
- 每代包含敏感账号／授权材料，只能私有保管；源码归档独立，不包含数据库、私钥或密码。

本机持久化不是生产部署、真实账户运营、换机安装、物理断电恢复或完整Native Runtime门禁签收。旧 disposable 入口保留为 `pnpm trial:zhiban:disposable`，只用于显式临时验证，不与默认入口同时运行。

2026-10-24后续：固定课堂教案及人工实验报告已追加到原持久实例，独立新增演示课程；原教学数据和账号保持核对及新增物理备份见[课堂包](zhiban-v2-classroom-flow-lab-local.md)及其closeout。旧持久化／Peer证据不被改写成新功能证明。

2026-10-24模拟实验接续：显式本地升级白名单追加flow/0002_simulation.sql，保存不可改写的计算运行与提交绑定；原0001及手填报告保持。默认运行／快照与证据范围见[服务端模拟实验包](zhiban-v2-simulation-local.md)。

2026-10-24独立交付接续：[安装／恢复包](zhiban-v2-portable-install-local.md)补充全新源码目录、shallow来源对象和独立状态交付，保留原内部PG根路径；旧持久化证据继续只适用于其原范围，跨机验收仍待。

2026-10-26 P7：原生课堂／自主PBL状态、归档资产、多模态资料／用量、服务中心配置／审计和课堂成果锚点／不可变凭据均随三库及owned私有文件恢复。`native-secret/instance-secret.key`须同数据库保存（外部OPENMAIC_SECRET_KEY另行保管）。新源码安装包、私有恢复pin、隔离读回及原默认实例恢复认[统一交接](zhiban-v2-p7-handoff.md)及其closeout；历史快照证据不扩大。
