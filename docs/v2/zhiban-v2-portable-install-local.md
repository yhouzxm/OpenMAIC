> 2026-10-26 当前统一版见[P7交接](zhiban-v2-p7-handoff.md)。新私有包包含数据库内已保存的加密提供者凭据（若有）及实例密钥，不能再笼统声称不含模型密钥；主机配置文件仍不自动复制。历史远端 run 40096542805 PASS 仅适用旧冻结包，本轮恢复范围认最新 closeout。

# 独立安装与换机恢复交付

2026-10-24，沿原 P3/P7 持久化交付包。用户选择先做本机隔离安装／恢复，真实第二台机器待验。本工具面向合成 LOCAL 教学实例；生产数据、生产部署和真实账户运营没有获得授权。

## 交付与使用

`node scripts/zhiban-portable.cjs doctor` 检查 Linux x64 LE、Node 22.19+（22 大版本）、pnpm 10.28.0、Ubuntu 路径的 PG16、Git／Python／tar／rg。安装包包括当前 dirty 源文件、逐文件 SHA256 和 baseline／官方 v1.2.1 两棵树的 shallow Git 对象，支持全新目录，无需源 checkout。HEAD 仍为原 baseline，候选没有被提交。无完整历史、node_modules、数据库、模型密钥或生产授权。

以下路径均须绝对路径，目标不存在、父目录已存在且不经过符号链接。命令返回的 manifestSha256 由操作者通过可信渠道单独保存；hash 表示完整性，不代替来源认证。安装 bootstrap 本身也属于必须可信交付的可执行代码。

```sh
node scripts/zhiban-portable.cjs pack /私有父目录/install-kit
# 交付 install-kit；新机用该目录中的 install.cjs，PIN 为上步返回的 manifestSha256
node /私有父目录/install-kit/install.cjs verify /私有父目录/install-kit PIN
node /私有父目录/install-kit/install.cjs install /私有父目录/install-kit /新父目录/zhiban PIN
# 已有完整 pnpm store 的隔离本机可以在 install 命令末尾追加 --offline
```

安装先独立验证源 tar 的精确文件集、hash、大小及路径，再按常规文件创建；拒绝链接／设备／路径穿越。不执行归档内 shell。Git pack 仅导入新 `.git`，不修改源仓库；安装依赖使用 frozen-lockfile 和本项目已声明的安装构建策略。部分失败保留 `.INSTALLING.json` 供排查，绝不写成功 receipt，也不覆盖目标重试。安装目录和交付包 0700；receipt 0600。

私有恢复包与源包分开，包含三库 PG16 快照、原合成账号、LOCAL 授权材料和 TLS 白名单文件。它不是公开下载物，也不是加密归档；存储与跨机传输须保持私有并使用受保护的渠道。命令只返回包路径与总 manifest pin，不打印账号、密码、模型密钥、私钥或快照 metadata。

```sh
pnpm trial:zhiban:backup
# 从 ~/.local/share/zhiban-persistent/latest.json 本机读取快照路径及 manifestHash（无需发到聊天）
node scripts/zhiban-portable.cjs export-private /快照绝对路径 /本机TLS配置目录 /私有父目录/restore-kit SNAPSHOT_PIN
# 本机验证须先正常停止源实例；跨机须确保目标不存在相同内部运行 root
pnpm trial:zhiban:stop
node /私有父目录/install-kit/install.cjs import-private /私有父目录/restore-kit /新父目录/instance PRIVATE_PIN
node /私有父目录/install-kit/install.cjs start-rebind /新父目录/zhiban /新父目录/instance
```

任教、开户、登录标识与教务导入参考凭证的来源名允许唯一、规范的历史绝对路径或仓库相对路径；仍逐字比较原 SHA256 和实时数据库 fingerprint，歧义／缺失／路径穿越拒绝，旧凭证不改写。独立实例缺少恢复指针时拒绝意外重新 seed。

首次换源码目录显式 `start-rebind`，复用已有 LOCAL 受控升级白名单，验证现有数据库 profile、ACL、source、TLS 后重建浏览器内容及 source 绑定；不改已应用 migration，不更换 Identity HMAC／成员审批公钥／用户ID。后续用 `start`，拒绝静默重签：

```sh
node /私有父目录/install-kit/install.cjs info /新父目录/zhiban /新父目录/instance
node /私有父目录/install-kit/install.cjs backup /新父目录/zhiban /新父目录/instance
node /私有父目录/install-kit/install.cjs stop /新父目录/zhiban /新父目录/instance
node /私有父目录/install-kit/install.cjs start /新父目录/zhiban /新父目录/instance
```

新状态目录独占自己的 snapshots/latest.json 和 TLS，正常退出保存到该目录。原用户默认持久化指针不被替换，不重定向 HOME，也不接触旧 55432／55433。关闭后保留独立 workspace／state，不自动清除已验证的备份。

## 精确边界

- 本版物理恢复保留快照记录的 `/tmp/zhiban-trial-content-*` 内部目录、socket 56517 和 HTTPS 3461，源实例与恢复实例不能在同一机器同时运行。支持源码安装位置／快照状态位置不同，**不宣称任意 PG 数据目录重定位**；这样保留签名和 DSN 的反向绑定。目标已存在即拒绝，不删除别人的 root。跨机要求同 Linux x64 LE、同 PG 版本字符串；不做跨 PG 大版本／架构转换。
- 完整文件集校验及 owner-only 容器检查先于复制、启动。目标 state 使用独占 mkdir，导入失败只清理本轮新建 state；原快照／包／默认指针保留。latest 和 INSTANCE 成功 receipt 最后写入。残留根／锁继续 fail closed，操作者不得以删锁绕过归属检查。
- TLS 仅复制 localhost.crt、localhost.key、development-ca.crt、receipt.json，不带旧 M1 的 runtime／PG目录，也不带 CA 私钥。真实新机需单独把 CA 公钥加入系统／浏览器信任；校验 HTTPS 使用该 CA，不使用 ignoreHTTPS errors。证书过期须重新走既有证书及来源绑定流程。
- 模型 `.env.local`、解析服务、扫描器选定 profile／程序及外部凭据均不自动交付或继承父进程。新目录可按原规则配置 0600 `.env.local`；扫描 profile 需在独立 state/services.env（0600）显式配置 ZHIBAN_SCANNER_PROFILE／ZHIBAN_SCANNER_PROFILE_SHA256；解析配置仅接受 ZHIBAN_MATERIAL_PARSER_CONFIG／ZHIBAN_MATERIAL_PARSER_SHA256，其余键拒绝。未配置只关闭对应依赖，不伪造模型／解析／扫描成功。
- 旧 Native 维护 control／公钥 pin／签名及 UNKNOWN／RESERVED 隔离没有解除。当前产品中的普通课堂、固定原生播放器、人工报告及服务端模拟不借此获得真实测量或完整 Bridge gate 权限。

## 本地验收

证据统一在 `evidence/p7-handoff/portable-install/`，其在源码归档排除目录内，避免源归档 hash 自引用。执行隔离源码目录＋独立 node_modules＋独立私有状态目录恢复，对三库所有非 Identity 表逐行规范 JSON 指纹、账号文件及三角色登录／工作台、受信 HTTPS 页面做比较；Identity 会话自然新增，不能要求会话表逐字不变。不重跑模型、扫描、整堂课或 CI。验收结果及实际路径以 closeout 为准；第二台机器、不同用户、证书信任安装、空依赖缓存网络安装和生产交付均不据同机结果签收。
