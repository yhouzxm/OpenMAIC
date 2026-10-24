# M1 本地登录与工作台

STATUS: LOCAL_VERIFIED / UNCOMMITTED_CANDIDATE

基线：`refactor/zhiban-v2` / `daf63afa83470d24a9ed41d171c6a17f8a80adb6`。用户于 2026-10-08 授权完成 M1。本轮包含受控本地 host、独立开发库准备、Identity 接线与实际登录/空间/退出/空工作台；不修改冻结生产语义或 migrations 0001–0013，不 commit/push/CI dispatch。

## 使用

在项目根目录，Node 22、pnpm 10.28.0、Ubuntu PostgreSQL 16 与 OpenSSL：

```sh
# 只在第一次准备新的开发环境时执行；已有目录会拒绝覆盖。
pnpm setup:zhiban
# 启动或复用此项目专用 PG16，然后启动 HTTPS。
pnpm dev:zhiban
```

打开 `https://127.0.0.1:3443/zhiban`。首次 `setup` 生成的临时自签名证书可能被 Codex 内置浏览器拒绝，不能依赖“手动接受”入口。本机已按用户授权改为 mkcert 开发 CA 签发的 IP 证书，并安装到当前用户 NSS 信任库；内置浏览器实际打开登录页成功，无需跳过证书错误或关闭 TLS 校验。不使用根 `pnpm dev` 证明智伴路由隔离。

本机 mkcert 1.4.4 和 certutil 从 Ubuntu 软件源下载并解包到私有 `tools/extracted/usr/bin`，不要求 sudo、不改变系统信任库。其他机器可以使用已安装的 mkcert/certutil。准备或续期命令：

```sh
pnpm cert:zhiban
# 停止旧的 dev:zhiban 后重新启动，使服务读取新证书。
pnpm dev:zhiban
```

该显式命令把开发 CA 安装到**当前用户 NSS**，签发只含 `127.0.0.1` 的证书，备份旧证书/私钥/receipt，更新 `certificateHash`、`caCertificateHash` 和到期信息。CA 私钥在 `~/.local/share/zhiban-m1/ca`，禁止提交或分享。当前证书到期为 2029-01-07；续期沿用该开发 CA。其他机器/现有浏览器进程可能需要完全重启 Codex 才会读取信任库，须实际核验，不宣称普遍支持。

账号与随机密码在 `~/.local/share/zhiban-m1/accounts.json`（0600，目录 0700），不会显示在网页或日志，也不进入 Git。M1 初始化时体验账号加入两个本地空间，第二账号无空间，均无角色授权或平台管理员授权。随后 M2 离线准备了普通教务管理员/教师/学生角色，当前账号范围见 [M2 记录](zhiban-v2-m2-academic.md)，仍无平台管理员。登录使用冻结合同中的 UUIDv7 UserId。

服务停用：运行 `dev:zhiban` 的终端按 Ctrl+C。开发 PG 保留数据；需要停止时执行：

```sh
/usr/lib/postgresql/16/bin/pg_ctl -D "$HOME/.local/share/zhiban-m1/pgdata" -m fast -w stop
```

没有自动 reset/delete 命令。初始化失败保留独立目录供诊断，不自动清空；恢复前先核对本项目专用路径和进程，不对系统库或测试 cluster 操作。证书备份在私有 `certificate-backup-*` 目录；回退须同时恢复证书、私钥和 receipt。独立开发 CA 信任不等于生产 TLS 验收，不把 HTTPS 降为 HTTP。

## Host、数据与配置边界

- 智伴拥有 Node HTTPS 入口，仅监听 `127.0.0.1:3443`；M1 的三份页面资源与五个 Identity 入口已在 M2 增加 academic.js 和受控 Academic API。原生 Next/OpenMAIC Web、agent、actions、资源字节、控制面、恢复入口均不加载/不公开。
- M1 原通过 `installApprovedIdentityHttp` 接正式 root；M2 为共用 private Session root 改为直接调用同一正式 `createIdentityComposition` 与 `createIdentityHttp`，默认全局 CLOSED 不变。没有 test factory、浏览器 bootstrap 或环境变量默认启用。不声称启用了任何 OpenMAIC capability，也不改变 ADR-012/0B 的批准要求。
- 开发库是独立 OS 用户所有的 cluster：`55433/zhiban_m1_dev`，data directory 为 `~/.local/share/zhiban-m1/pgdata`。`5432` 系统库和 `55432/zhiban_pg16_test` 均不被初始化或清理。
- `setup` 是明确的离线维护命令：既有 role bootstrap、原 migrations、四份 admission policy、随机本地密钥、固定 catalog/corpus hash、普通合成身份与零授权 Membership。seed 是本地合成数据准备，不是生产成员入驻/同意流程或其验收证据；不伪造 FIRST_PLATFORM_ADMIN、独立审批或人工恢复证据。
- `launch` 检查 owner-only 目录、PG16/数据库/data directory 和 ledger/source/receipt hash；只读维护连接在启动 HTTPS 子进程前关闭。M1 三个受限角色在 M2 增加 academic 业务角色与只持身份锁的既有 bridge 角色连接；均无 DDL/维护权限，启动不迁移或 seed。
- `runtime.json`、证书/密钥与 receipt 在私有目录；所有配置引用标记 `LOCAL_M1_*`。最小本地密码 corpus 不声称满足生产 screening 维护与验收。缺失、错误权限、hash 漂移或未准备 schema 时拒绝启动。
- Session 只用 Secure/HttpOnly/`__Host-` Cookie；复用 Origin/CSRF、真实密码 Argon2 与 PG Session/空间发现。代理 IP 由 TLS socket 覆写；重复安全头与不匹配 Host 拒绝。浏览器不存密码或 Session，不把 URL space 当授权；刷新/切换/标签页恢复都重新查询本人和可见空间。
- M1 初始为空工作台；M2 已接真实合成课程/班级/选课数据。进入空间壳只证明 Membership 可见性，业务 API 另验角色及关系，不自动授予课程、管理或资源访问权限。活动和成绩尚未交付。

## 本地验收与后续

`pnpm verify:zhiban` 使用真实 HTTPS/PG16 和独立 Chromium；原生 HTTPS 严格信任 receipt hash 固定的开发 CA 并检查 IP，测试浏览器仅配置该服务证书公钥 pin，不全局关闭 TLS 校验。后者不能单独证明内置浏览器信任；本轮另用真实 Codex 内置浏览器直接访问并保存截图。需要测试浏览器时执行 `pnpm exec playwright install chromium`。

本轮 18 个实际场景 PASS：本人/空间、错误密码、选择后刷新、切换空间、未授权空间 URL、无空间、CSRF 退出、跨标签页退出、旧 Cookie 重放、跨源登录、Host/重复安全头、代理覆写、原生/控制/恢复路由关闭、移动端、无浏览器凭据存储/JS 错误、无平台管理员授权。停止开发 PG 后重新 `dev:zhiban`，启动并复用原有数据成功，最终候选重新跑实际场景 PASS。受影响既有 HTTP 四个文件共 95 tests PASS。新代码 ESLint/Prettier PASS；全项目 TypeScript 检查以 8 GiB heap PASS（默认 Node heap 不足，不作为功能失败）。

证据在私有目录 `verification.json`：真实 `LOCAL` 标签、基线 HEAD、`UNCOMMITTED_CANDIDATE`、本轮代码逐文件 SHA256、开发端点、证书 hash 和通过场景；截图 `login.png` / `workspace.png`。该证据不能覆盖生产 TLS/OPS、业务权限/资源 gate、enabled Bridge、Runtime/AI，不能标 `PHASE_1B_COMPLETE`。历史 CI 证据维持原 SHA 和原范围，不外推到本轮未提交代码。

证书修复的独立证据为 `certificate-access.json` 和 `iab-certificate-verified.png`：包含证书/CA 指纹与 hash、候选代码 hash、用户 NSS 安装范围及真实内置浏览器登录页访问结果。新证书下 18 个 M1 场景、TypeScript 与受影响 ESLint 通过。本轮不 commit/push/CI dispatch，不改数据库、migrations 或冻结 Identity 语义。

M2 已完成本地交付，下一步为 M3 学习活动与提交；不重新测试已经完成的 C9 foundation。常规实现建议 GPT-6.1 Sol / medium，涉及新业务授权或 DDL 的集中评审再使用 high。
