# 阿里云独立部署接续

2026-10-28。**状态：服务器准备中，应用尚未部署上线。** 本文不替代此前 PG18 LOCAL／GitHub 验收，也不将公网正式部署标为通过。

## 用户指定目标

- ECS：`47.120.42.25`，Ubuntu 22.04.5，x86_64。
- 独立源码目录：`/var/www/zhiban`。
- 经用户选择，访问入口改为 `https://47.120.42.25:88`，需要受信任 IP 证书。
- 源提交：`038a28e8181e8fddcf69a386244da64044a3486b`，分支 `refactor/zhiban-v2`。
- 现有 OpenMAIC：`/var/www/OpenMAIC`，PM2 应用 `openmaic`，Node 24.20.0。保留原服务及其配置。

## 已完成的真实只读核对

- 通过用户建立的临时 SSH 共享连接接入；密码／私钥不进入聊天或仓库。
- 实际连接配置路径为 `/var/www/OpenMAIC/.env.local`；用户初始写出的 `.env.loacl` 不存在。仅读取连接并输出非密码元数据，没有复制原配置到智伴。
- RDS 服务端 `server_version_num=180004`，即 PG18.4；服务器 `psql 18.6` 是客户端版本。此前 PG18.6 的隔离验收不能直接称为该 RDS 的兼容签收。
- 原数据库及连接角色均为 `openmaic`；角色不是超级用户，也没有 `CREATEDB`／`CREATEROLE`。实例尚无 `zhiban*` 数据库或角色。
- 当前 RDS `ssl=off`，原连接未启用 TLS。未修改共享 RDS 的设置。
- 80、3000、8080 已占用；88 未监听。未修改现有 Nginx 配置，未停止原 OpenMAIC。
- 现有服务器没有 Certbot 或 `/etc/letsencrypt/live` 证书。

## 已执行的准备

- 已通过 HTTP/1.1 克隆源码到 `/var/www/zhiban`，核对 HEAD 与指定 SHA 相等，初始工作区干净。
- 已安装独立 Node 22.23.3 到 `/opt/zhiban/node-v22.23.3-linux-x64`，官方 Linux x64 包 SHA256：`df450af89261115ef9f9e3830c3eeb2cc9213b63c720b1af623cb5dcbe2e02de`。首次下载超时后续传，完整哈希核验通过；系统 Node 24 保留。
- 已创建专用非 root OS 用户 `zhiban`（禁止交互登录）、0700 的 `/var/lib/zhiban` 与私有 config／state 目录；源码由该用户持有。0600 的 `/var/lib/zhiban/config/presentation.env` 已写入 `ZHIBAN_UI_ENVIRONMENT=production`，尚未被运行服务加载。
- 已在项目目录通过该用户验证 Node 22.23.3／pnpm 10.28.0。首次 pnpm 探测因继承 root 工作目录而拒绝读取 `/root/package.json`，改用项目目录与独立 Corepack 后通过，没有放宽 `/root` 权限。
- 固定上游对象 `e19d0d4f45d81b8f7ab599b33ab03b0b8b68d5c0` 已获取。首次冻结锁文件依赖安装因 npm 官方仓库下载超时失败；低并发、IPv4 优先的重试未签收成功，下载缓存保留，尚不能认为依赖安装／构建通过。
- 用户随后提供 `/var/www/zhiban/.env.local` 作为管理连接配置。其只读权限／连接核验没有返回成功结果；不能把已验证的原 OpenMAIC 普通账号结果当作这个新文件的结果。
- 临时共享 SSH 控制连接随后断开，原 PID 及控制 socket 均已消失。需要用户恢复密码认证共享连接后继续。未执行智伴数据库初始化、证书签发、88 端口绑定或应用启动。
- 用户重建的 PID 12676 控制连接曾通过 `-O check`，新配置的首次文件检查因与预设 root 所有者不符而拒绝，尚未读取／核验新管理连接。后续改按实际部署用户核对的请求超时，服务器随后返回 `Connection closed by 47.120.42.25 port 22`，该 PID／socket 再次消失。原网站公网 HTTP 80 实测仍为 200；没有证据据此认定旧应用发生故障。下一次使用保持终端开启的前台会话和周期性输出，优先恢复可靠执行通道，不反复修改应用或数据库。

## 上线前剩余工作

1. 重新连接并只读核验用户已提供的 `/var/www/zhiban/.env.local`：0600、管理连接目标及创建独立数据库／受限角色所需能力。原 `openmaic` 账号不提升权限、原库不运行智伴 bootstrap；管理连接不用于长期运行应用。
2. 实现并验证版本化 RDS 正式安装／加载入口：独立目标、最小权限、来源／预期 profile、公共 HTTPS origin、持久状态与恢复；保留冻结生产语义及已应用 migrations，不把当前本地安装器直接改成接任意外部 DSN。
3. 完成受信任 IP 证书签发和自动续期，再增加独立 88 HTTPS 入口及专用应用守护；当前尚未签发证书、未绑定 88、未启动智伴 PM2／systemd 服务。
4. 只对新实例完成首次管理员交付、登录、受影响页面与重启读回；外部模型／解析配置独立处理，不复制原应用全部秘密。

RDS SSL 云端证书启用可能重启共享实例，须另行安排，不能因部署智伴而擅自中断原服务。依据：[阿里云 SSL 说明](https://help.aliyun.com/zh/rds/apsaradb-rds-for-postgresql/configure-ssl-encryption-for-an-apsaradb-rds-for-postgresql-instance)。IP 证书可以使用 Certbot 5.4+ 的 webroot／shortlived 流程，需维护自动续期，依据：[Let's Encrypt 官方说明](https://letsencrypt.org/2026/03/11/shorter-certs-certbot)。
