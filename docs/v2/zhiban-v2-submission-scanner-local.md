# 作业附件：ClamAV 本地真实扫描接线

2026-10-17，LOCAL、dirty working tree candidate；基线 `daf63afa83470d24a9ed41d171c6a17f8a80adb6`。不代表生产部署、GitHub CI 或整项目签收。

## 启用与路径

Ubuntu 24.04 用户目录安装（Ubuntu apt 已验证的软件包下载后解包，无 sudo、系统服务、系统数据库修改）。ClamAV 1.5.4，官方 main/daily/bytecode 病毒库由 FreshClam 下载并加载验证，更新方式遵循[官方文档](https://docs.clamav.net/manual/Usage/SignatureManagement.html)。不是合成 digest 白名单，也不是仅检测 EICAR 的替身。

- 程序：`/home/zxm/.local/share/zhiban-scanner/runtime/usr/bin/clamscan`
- 更新配置：`/home/zxm/.local/share/zhiban-scanner/freshclam.conf`
- 启动选择：`/home/zxm/.local/share/zhiban-scanner/active.json`，0600；包含绝对 profile 路径及独立 SHA256 pin。
- 本轮 profile：`/home/zxm/.local/share/zhiban-scanner/snapshots/2026-10-17T12-57-59.708Z/profile.json`
- profile pin：`8c93c544e24bc800f9d19832712c2009ab1dfed3c237026cdac94bd96ad3563d`
- 同字节审阅副本：`docs/v2/evidence/zhiban-clamav-profile-local.json`；无密码、无私钥。

启动／查看账号位置／停止：

```sh
pnpm trial:zhiban:trusted-files
pnpm trial:zhiban:trusted-files:info
pnpm trial:zhiban:trusted-files:stop
```

新入口 `https://127.0.0.1:3467/zhiban`，owned PG16 56523／`zhiban_trusted_files_disposable`，停止删除该 owned cluster。3466 原样例进程与历史证据不升级为真实扫描证据；本轮共享源码改动后其旧来源 receipt 会报告漂移。3467 不接真实 55432／55433、Native、维护凭据或 Bridge／Runtime。

普通 standalone host 只有在文件 schema loader 通过且明确提供以下两项时启用附件；配置缺一拒绝启动，未配置保持关闭。本轮没有在 standalone 真实库应用 migration。

```sh
export ZHIBAN_SCANNER_PROFILE=/absolute/path/profile.json
export ZHIBAN_SCANNER_PROFILE_SHA256=<64位SHA256>
```

## 实际扫描命令

应用使用 `spawn(binary, args, {shell:false})`，只通过 stdin 传入内存中已校验的附件字节；文件名与上传内容不会拼成 shell 命令。等价本机命令如下（`DB` 指 profile 的不可变 snapshot/db）：

```sh
SCAN_ROOT=/home/zxm/.local/share/zhiban-scanner
SCAN_DB="$SCAN_ROOT/snapshots/2026-10-17T12-57-59.708Z/db"
LD_LIBRARY_PATH="$SCAN_ROOT/runtime/usr/lib/x86_64-linux-gnu" \
CVD_CERTS_DIR="$SCAN_ROOT/runtime/etc/clamav/certs" \
"$SCAN_ROOT/runtime/usr/bin/clamscan" \
  --database="$SCAN_DB" --cvdcertsdir="$SCAN_ROOT/runtime/etc/clamav/certs" \
  --official-db-only=yes --fail-if-cvd-older-than=7 \
  --alert-encrypted=yes --alert-exceeds-max=yes \
  --max-filesize=2M --max-scansize=16M --max-recursion=8 --max-files=100 - < /absolute/path/report.txt
```

更新工作库（不修改进程正在使用的 snapshot）：

```sh
SCAN_ROOT=/home/zxm/.local/share/zhiban-scanner
LD_LIBRARY_PATH="$SCAN_ROOT/runtime/usr/lib/x86_64-linux-gnu" \
CVD_CERTS_DIR="$SCAN_ROOT/runtime/etc/clamav/certs" \
"$SCAN_ROOT/runtime/usr/bin/freshclam" --config-file="$SCAN_ROOT/freshclam.conf" --stdout
pnpm scanner:zhiban:profile
```

最后一条生成新的 snapshot/profile 并输出 pin，须在停机后更新私有 active.json 或显式启动参数，再重启。没有静默热更新、自动改 pin 或定时任务。日库超过7天停止放行；不能靠改 mtime 延期。

## 数据、授权与失败边界

- 保持单个 PDF/TXT≤1MiB、必填文字、仅正式 SUBMIT 上传；不增加 Office、压缩包、可执行文件、外链或内联预览。
- 在扫描前校验真实会话、当前学生 Enrollment、课程和本人 Attempt；持久化仍复核版本、deadline、撤权、配额和幂等。
- 新增 `0003_trusted_scanner.sql`，只在新 owned cluster 应用。原 0001/0002 不改；原 UNVERIFIED 和 LOCAL_SYNTHETIC_PINNED 不自动提升。
- 服务端 evidence 作为独立可信参数传到 AssetPort，不接受客户端 clearance 字段。文件 digest 必须匹配，reference 格式 `clamav-sha256:<profile hash>:<file hash>:<实际扫描毫秒时间>`，数据库 CHECK 再绑定摘要；附件和 Submission 同事务成功或回滚。
- 下载继续实时验证本人／任教权限，校验字节摘要与放行 reference；强制 attachment、octet-stream、no-store、nosniff、sandbox。metadata 不返回字节。
- profile、程序、动态库实际目标、证书及 CVD 文件 hash 在启用和扫描前后核对。病毒库目录只允许固定官方 CVD/sign 文件；启用必须真实加载病毒库并完成启动探针。
- 只接受进程退出0、无stderr且有完整扫描摘要的结果。发现风险／加密／扫描限额、不可用、异常退出、60秒超时、库过期／改动均拒绝；未放行字节不落库、不生成 Submission。无持久化风险文件仓库，用户可另存本机后重试。
- 单扫描并发，忙时拒绝本次提交，可稍后重试。最多64项、5分钟仅内存 clean digest 缓存；复用前重新核验环境与日库新鲜度，保留原扫描时间。改变 profile／重启即失效，不缓存风险或失败结果。

## 证据范围与限制

定向结果见 `docs/v2/evidence/zhiban-trusted-files-demo-local.json` 及安装／验证记录；只认对应运行 sourceHashes 和 scanner pin。单测只覆盖信任边界的拒绝分支，真实引擎结论来自 PG16／HTTPS 的实际 ClamAV 旅程。原合成附件、Storage／Identity 历史 CI 证据各保留原适用范围。

`clamscan` 冷加载官方库在本机约25秒，界面附件提交等待上限75秒；这是真实首版的已知响应时间。检测通过不保证文件永远安全；本轮不提供后台持续重扫或生产并发容量承诺。Content／Runtime、UNKNOWN／RESERVED、维护交付、原生关闭保护等 deferred gates 不因本轮放开。

最终签收：31/31 定向单测、类型／ESLint、10组 owned PG16／HTTPS／普通浏览器检查通过；最终进程 `sourceMatches=true`、漂移0。独立原生引擎 EICAR 退出1／Eicar-Test-Signature FOUND 已存档。Codex 内置浏览器直接打开3467登录页通过证书验证；不将此声明为内置浏览器下载文件落盘已验证。详细结果见 `docs/v2/evidence/zhiban-trusted-files-validation-local.json`。
