# Ubuntu 正式宿主、停写备份与独立恢复

本手册接续全新三库安装包；目标为 Ubuntu ECS＋PG18，公开入口可显式配置 `http://47.120.42.25:88` 或 HTTPS。工具不会自动连接该地址、修改 `/etc`、创建用户或运行 systemctl。真实 RDS、受信任公网证书和实际开机启动须在目标机验收；本机隔离结果见文末。

## 1. 交付目录与启动产物

推荐目录：

| 路径 | 用途／权限 |
| --- | --- |
| `/var/www/zhiban/releases/版本/` | 完整源、SDK、依赖、浏览器资产与预构建产物；交付后 root 所有、服务用户只读 |
| `/etc/zhiban/` | runtime、profile、运行凭据、CA、内部 TLS、模型配置；root 所有，服务组可读，目录0750／文件0640 |
| `/var/lib/zhiban/instance/` | 服务用户所有0700；安装 receipt／journal、私有控制 socket，以及 data 下原件、用量、实例密钥 |
| `/root/zhiban-operations/` | 运维连接、签发私钥和计划；root 专用0700／0600，不交给常驻服务 |
| `/root/zhiban-backups/` | 私有备份及签名 manifest；0700／0600，不能放在站点可访问目录 |

在新的 release 目录安装依赖、构建浏览器资产，再构建正式程序，最后构造独立 source-profile：

```bash
pnpm install --frozen-lockfile
pnpm deploy:zhiban:production assets
pnpm build:zhiban:host
pnpm deploy:zhiban:production source-profile /私有路径/new-source-profile.json 批准的数据库owner 批准的grantor
```

构建产生 `.zhiban-host/host.mjs` 和 `.zhiban-host/ops.mjs`，同 artifact.json 纳入 profile。`host.mjs` 不包含安装器／fixture，不在启动时编译或建表；`ops.mjs` 由管理员显式运行。两个程序均从该 release 目录执行，依赖目录保留，不在旧的只读 release 上重新构建。

profile 独立构造、两人首管理员批准和新库 setup 继续见[安装手册](zhiban-v2-production-fresh-install.md)。已有全新安装候选若更换本包源码或构建资产，须构造并审核相应新 profile；不能修改旧 pin 或旧签名来绕过来源校验。

## 2. 运行配置与两段 TLS

配置模板位于 `docs/v2/examples/production-install/`：runtime、operations、restore、ubuntu-host。

`runtime.serviceEnvironment` 明确指定私有环境文件及 hash；`.files` 列出其引用的配置文件和 hash，例如 `OPENMAIC_CONFIG` 指向的 openmaic.yml。宿主不接受 DATABASE_URL、NODE／LD 注入、身份模式等受保护变量；不把旧 LOCAL `.env.local` 整套复制到 release。

最小 services.env：

```dotenv
OPENMAIC_CONFIG=/etc/zhiban/openmaic.yml
```

没有外部模型时仍给出显式空服务配置；登录、教务、文本发布和人工评分照常可用。内置 skills 同 release 一起只读交付，个人 skills 保留原生数据库存储；旧式课堂媒体写入自动定向到 state/data/native-classroom-media，避免写源码目录。实例密钥采用 `instance/data/native-secret/instance-secret.key`，不使用游离在环境中的 OPENMAIC_SECRET_KEY；该文件必须随恢复包交付。外部 S3 字节存储需要独立一致性协议，本包不会将只有数据库的包签成完整备份。

公开 TLS 证书与私钥提供给 Nginx，必须匹配实际公网 IP／域名，并由用户设备信任。Node 后端只监听 `127.0.0.1:3491`，使用独立内部 TLS 证书，SAN 为 `zhiban.internal`；runtime.tls.serverName 填此名字，Nginx 使用内部 CA 和该名字校验。内部 CA 不冒充公网受信证书。

内部证书可由部署管理员在私有 staging 生成，以下仅生成内部 CA：

```bash
umask 077
mkdir -p /私有路径/internal-tls
cd /私有路径/internal-tls
openssl req -x509 -newkey rsa:3072 -nodes -keyout ca.key -out ca.pem -days 365 -subj '/CN=Zhiban internal CA' -addext 'basicConstraints=critical,CA:TRUE'
openssl req -newkey rsa:3072 -nodes -keyout server.key -out server.csr -subj '/CN=zhiban.internal'
printf 'subjectAltName=DNS:zhiban.internal\nextendedKeyUsage=serverAuth\nbasicConstraints=critical,CA:FALSE\n' > server.ext
openssl x509 -req -in server.csr -CA ca.pem -CAkey ca.key -CAcreateserial -out server.pem -days 90 -extfile server.ext
openssl rand -hex 32 > proxy-token
```

只将 ca.pem、server.pem、server.key 和 proxy-token 放到对应部署路径；CA 签发私钥单独保管。runtime.trustedProxy 明确限定 loopback 地址和 proxy-token 文件。Nginx 使用原始 TCP 对端 `$realip_remote_addr` 覆盖客户端地址与 token（见[官方 realip 模块](https://nginx.org/en/docs/http/ngx_http_realip_module.html)），后端拒绝无 token／错误 token 的直连，不信任浏览器传入的 X-Forwarded-For。上游 TLS 校验按 [Nginx 官方 proxy 模块](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_ssl_verify) 配置，不关闭 verify。

### 数据库连接模式

RDS 连接可逐项显式配置 `"transport": "plain"` 并移除 `caFile`，使用与 OpenMAIC 默认方式一致的未加密 PostgreSQL 连接。runtime 的八个连接、install 的三个迁移连接、setup 管理连接及 operations 的备份／恢复连接都要按实际情况填写；安装、运行、pg_dump 和 pg_restore 均使用对应模式。未设置 `transport` 时维持原先 `caFile` 的证书及主机名校验；也可显式使用 `"transport": "verify-full"` 和 `caFile`。不允许 `plain` 同时填写 CA，避免配置含糊。

单个连接的配置示例（其他字段按目标实际值填写）：

```json
{
  "host": "RDS内网地址",
  "port": 5432,
  "database": "zhiban_business",
  "role": "实际连接角色",
  "credentialFile": "/etc/zhiban/runtime/role.env",
  "transport": "plain"
}
```

连接模式属于安装绑定，切换模式需重新生成并审核安装计划及对应 receipt，不直接改已签发配置。未加密模式不验证数据库身份，实际网络隔离由部署环境提供；公网 HTTPS 与内部代理 TLS 不受此设置影响。

### HTTP 浏览器入口

若选择 HTTP，在 Identity 提案和 runtime 配置中统一使用 `http://47.120.42.25:88`；Identity 提案生成 `SINGLE_PROCESS_HTTP` 部署类型。必须配置 loopback `trustedProxy` 与内部 TLS `serverName`，Nginx 监听 HTTP 88，Nginx 到宿主仍验证内部 TLS。HTTP 模式无需配置 `ubuntu-host` 的公网证书及私钥；HTTPS 保持原验证。

HTTP 模式使用仅限当前主机的 `zhiban_session_http` Cookie，保留 HttpOnly、SameSite、精确 Origin 与 CSRF 检查；HTTPS 使用原 `__Host-` Secure Cookie，两种会话不可混用。HTTP 会明文传输密码和会话，公网使用时需接受这一实际风险。旧的账户恢复私有通道继续要求 HTTPS。

## 3. 生成并审核 Ubuntu 接线

先完成 setup，确认三库安装 READY。填写 ubuntu-host.example.json，serviceUid／Gid 必须与 operations 配置一致，选择目标机空闲的系统 UID／GID；不要覆盖既有用户。

```bash
cd /var/www/zhiban/releases/实际版本
node .zhiban-host/ops.mjs render-ubuntu /root/zhiban-operations/ubuntu-host.json /root/zhiban-operations/reviewed-host
```

输出 `zhiban.service`、`systemd-binding.json`、Nginx server／私有 proxy include 和 `install-reviewed.sh`；**生成不应用**。审核文件及端口88是否空闲、证书／路径／账号后，在目标机执行：

```bash
sudo bash /root/zhiban-operations/reviewed-host/install-reviewed.sh
sudo systemctl status zhiban.service --no-pager
sudo journalctl -u zhiban.service -n 60 --no-pager
curl --fail http://你的实际入口:88/zhiban/health  # HTTP 模式；HTTPS 模式使用 https://
```

脚本创建或核对专用非 root 用户，验证签名安装后交接状态与运行配置权限，将 release 置为服务用户只读；安装独立 `zhiban.service` 和88端口 server 配置，不停止已有 OpenMAIC／PM2／80端口服务。首次安装拒绝覆盖不相同的已有文件；升级时须将审核过的旧文件 SHA256 写入 ubuntu-host 的 `expectedExistingFiles`。安装器先核对这些 pin，再替换对应文件，不覆盖未审核的共享配置。它将实际 unit 路径及 hash 绑定到 root 私有 operations 配置；`handoff`／`bind-systemd` 本身不需要管理数据库密码或 receipt 签发私钥。

Node 可执行文件和 release 必须位于服务可读的系统目录，不用 `/root/.nvm` 或用户 home 下的 Node；模板的 ProtectHome 会隔离这些路径。可将经过核验的 Node 安装到 `/usr/bin` 或 `/usr/local/bin`。

服务使用 `ProtectSystem=strict`、私有临时目录、0700状态目录和控制组停机。ExecStartPost 最多等待120秒让宿主建立私有 socket 并通过真实宿主／数据库 readiness；维护标记或实例不符立即拒绝，不以固定 sleep 猜测启动完成。公开 `/zhiban/health` 只返回 READY 或 UNAVAILABLE，不暴露配置。静态登录页200本身不代表数据库可用。

常用命令：

```bash
sudo systemctl restart zhiban.service
sudo systemctl stop zhiban.service
sudo systemctl start zhiban.service
```

停机先排空 HTTP、worker 和池，再释放生命周期锁；私有停止入口还等待原进程退出。生命周期锁意外丢失会停止宿主并留下维护状态，避免自动重启绕过问题。不要通过删除 marker 或重设 journal 的方式启动。

## 4. 备份权限与停写协议

operations JSON 包含三个专用数据库的**安装外运维连接**和 receipt 签发私钥。连接必须与目标端点／数据库／批准的 grantor 一致，并经现场检查具备绕过强制 RLS 的全量读取能力和必要维护权限。普通 runtime／migrator 均不因此增加权限；不使用 `--enable-row-security` 生成过滤后的假全量备份。

RDS 管理账号不一定有上述能力；缺少时先停留在运维预检，不修改 RLS、角色图或签发完整备份。真实 RDS 的合规路径仍须在 D 验收明确。本机证明使用隔离 PG18 的管理员，不代表云数据库已通过。

`additionalPrivateFiles` 明确列出附加私有文件及 SHA256，例如 Nginx 的公网 TLS 证书／私钥、独立服务配置。备份会自动包含 runtime、profile、运行凭据、配置使用的数据库 CA、内部 TLS、proxy token、services.env 及其声明依赖、已交付控制批准，以及整个 state/data；不会打包运维管理密码或签发私钥。

```bash
cd /var/www/zhiban/releases/实际版本
node .zhiban-host/ops.mjs backup /root/zhiban-operations/operations.json /root/zhiban-backups/全新备份目录
```

备份顺序：

1. 先验证源安装签名及实例绑定，再写持久维护标记，阻止任何新宿主启动。已接入 systemd 时校验绑定的 unit 后执行 stop，排空整个控制组；本机隔离模式通过私有控制 socket 停止并等待原进程退出。
2. 取得实例生命周期锁，核验原 receipt／来源／ACL／ledger。
3. 对三库所有用户表同时持有 SHARE 锁，允许 dump 读取而阻止 DML／DDL；全程保有三库屏障，不把各自独立的 dump 当成一致切点。
4. 对全表数据生成流式 inventory，执行真实 pg_dump，复制原件／实例密钥／私有配置，并复核数据和文件闭包。
5. 签发 COMPLETE manifest，输出 `backupPin`、`operationId`。任何失败不发布完整 manifest，源实例继续保持停止状态；部分目录保留诊断，不自动删除。

完整备份目录含敏感账户与密钥，保存在受限或加密存储上；通过受控加密通道交付，并单独记录 manifest pin 与签发公钥 pin。禁止放到 Web 根目录或提交 Git。

成功备份**不会自动重新开放源实例**。核对结果后：

```bash
node .zhiban-host/ops.mjs resume /root/zhiban-operations/operations.json 备份返回的operationId
sudo systemctl start zhiban.service
```

resume 在锁内重验安装，按准确 operationId 清除维护状态，不启动进程。失败同样要保留诊断、查证后显式恢复；不自动清理未知数据库、角色或他人进程。若运维进程被强杀导致 `.operation-lock` 残留，先查证该操作已退出、数据库锁已释放及维护 journal，再由部署负责人定向处理，工具不会猜测接管。

## 5. 独立目标恢复与启用

恢复使用三个**独立空目标库**及一个新 state 目录、新 instanceId；保留原数据和旧部署。先按批准角色图预置空目标，准备目标 runtime 和 operations。目标账户、目录、admission、会话等 Identity 策略继承备份；外部 HTTPS origin 可显式改为新入口。目标凭据、CA、TLS 和环境文件使用新机真实路径，不自动沿用旧机器路径。目标 operations.migrations 另给出三个受限 migrator 连接，用审核过的原始来源 SQL 重建 schema；全量数据运维连接还必须具备控制新目标表触发器的恢复权限。普通备份不需要该 migrations 字段。恢复目标尚未安装 unit 时不要复制源 operations 的 `systemd` 字段；目标安装脚本会重新绑定实际 unit。

恢复 signer 可以是另一个受信 issuer：目标 runtime 固定其公钥，operations 提供对应私钥。restore 输入另行固定**原备份签发公钥与 pin**，不能从备份自行认领可信身份。

```bash
node .zhiban-host/ops.mjs restore-plan /root/zhiban-operations/restore.json
node .zhiban-host/ops.mjs restore /root/zhiban-operations/restore.json 审核所得planSha256
node .zhiban-host/ops.mjs activate-restored /root/zhiban-operations/target-operations.json 原backupPin
```

restore 先验证签名／完整文件闭包和独立目标参考，先用独立审核的原始 SQL 重建三个空目标的 schema，再执行 pg_restore 的 data-only 路径，比较每张表的全部数据 inventory，恢复原件与实例密钥。直接重放 dump 的 DDL 会改变部分 CHECK 表达式呈现和默认 ACL，不用于绕过原有精确指纹。仅在已证明为空的新目标清除 schema 初始化种子行并受控暂停装载触发器，使原 migration ledger／单例原样恢复；随后重新启用并严格复核。已有库不会进入此流程。保留原账号、审计、generation、旧 publication／deployment；仅追加新部署绑定和签发目标 receipt。原 receipt 不改成新端点。

恢复完成先保持 `RESTORED_AWAITING_ACTIVATION`；激活时再次核对签名、ACL、ledger、数据和原件的签名证明。数据或文件在等待期间变化就拒绝激活。失败保持隔离，不自动重试、清库或合并旧目标。

激活后按第3节交付目标非 root 权限和 systemd／Nginx，再启动并检查原账号、课程、历史成绩和已发布讲义。原密钥恢复后，已加密模型配置可以解密；只恢复数据库而丢失密钥不能作为成功。

## 6. 更新、证书轮换与回退

在**新 release** 构建和审核新 source profile，保留旧 release 和已签备份。恢复工具允许 JS／资产等变更而独立 schema、provider、owner／ACL、ledger 和 receipts 完全兼容的新 profile；若 schema 或 provider 不兼容则拒绝，须走单独 migration 交付，不以新 pin 跳过。

按“旧宿主停写备份 → 新空目标恢复 → 显式激活 → 切换 systemd／Nginx”更新；target runtime 可配置新证书／凭据，重签新绑定。不直接修改原 runtime 的证书、数据库地址或密码后继续使用旧 receipt。此流程有停机窗口，当前不提供原库上的无停机升级或任意 schema 自动迁移。

新目标尚未投入写入前，可保持其隔离并核验后恢复旧宿主。新目标已有新数据后，单纯切回旧源码／旧三库会丢失该段写入；应停止目标并用完整备份恢复到明确切点。旧的迁移前 LOCAL／PG16 快照不能直接当作本格式正式备份，仍需原可选历史迁移的启用适配；不清空旧库替代。

## 7. 本地验收与真实目标边界

复现（需项目依赖、PG18 二进制、Chromium 和 Nginx；只创建自有临时环境）：

```bash
ZHIBAN_PG18_BIN=/usr/lib/postgresql/18/bin ZHIBAN_NGINX_BIN=/usr/sbin/nginx pnpm verify:zhiban:production
```

[本地运维结果](evidence/persistence-130/production-operations-runs/latest-local.json) 记录错误实例在停机前拒绝、非 root／只读 release 启动、真实进程退出、三库并持写屏障、真实 dump／restore、完整数据 inventory、原件与实例密钥／加密配置、待激活拒绝与文件篡改拒绝、Nginx TLS／可信代理、错误上游 CA 拒绝、生命周期锁丢失停机屏障和恢复后历史页面。

本次验收机为 Ubuntu 24.04.5，Node 22、独立 PG18 TLS 与 Ubuntu Nginx 1.24；不是阿里云 Ubuntu 22.04.5／RDS 环境。只读 release 演练使用本机非 root UID 1000 和只读文件权限，实际 root 所有权交接仍需目标机验收。systemd 在本机只做生成与语法检查；没有在当前桌面安装系统服务或模拟机器重启。真实 ECS／RDS、公开证书信任、开机启动及独立远端机器恢复均保留 D 验收范围。没有运行新的 GitHub CI，也没有改已应用 migrations。
