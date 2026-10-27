# 本机隔离交付收口 · 2026-10-27

[closeout.json](closeout.json) 是本轮结论，[artifacts.json](artifacts.json) 是实际路径和运输 pin。全部证据均为 LOCAL；源码含原有未提交候选，未提交／推送／运行 CI。此目录按既有打包规则独立于源码归档交付，避免证据引用自己的 hash。

通过：当前源码独立离线安装；三库 PG16→PG18；PG18 新备份→全新 PG18 恢复→重启；数据／角色／授予者／ACL／RLS／序列及私有宿主文件比较；真实恢复失败切点；原 Identity 的 PG18 定向验证。另以 PG16 完成独立安装目录的三角色页面和已有成绩／完成证据／图片回看。两类证据不得混用。

**未通过：PG18 完整应用启动。** 冻结 PG16 provider/profile/catalog 合同仍拒绝 PG18。下一包需新增版本化 PG18 参考、installer／receipt／loader 和 host 生命周期，保留冻结 PG16 路径。不得只放宽版本比较或复用旧 receipt。阿里云目标机、生产数据、域名 TLS、systemd 切换与容量未验收。

## 制品与回退

源码 kit：`/home/zxm/.local/share/zhiban-pg18-delivery-A4kkJa/install-kit`。

Manifest SHA256：`68555c247ff183257c6ea456f8743b77a89e11e6f83b6d1c9c6d52427182f97d`。

sourceDigest：`a4231ad1eb1d30a40a2532e172b127e2c469f7cda24fc9884496dc7268ff5cab`。

数据库恢复包、开发 TLS 与实例密钥保留在 artifacts 指定的 0700 私有目录，未复制到仓库。模型／扫描配置独立保管，不假定换机后仍有服务权限。PG18 的 host-files 仅隔离保存，未修改原签名、origin 或 DSN。

当前所有本轮 cluster 和 HTTPS 均已停止。PG16 fallback 在停止时写入自己的快照并验证；原默认快照指针不变。若只需回看已验收的 PG16 独立安装，可执行下列命令；它不是 PG18 启动命令，仍受同一内部路径只能运行一个实例的限制。

```sh
node scripts/zhiban-portable.cjs start \
  /home/zxm/.local/share/zhiban-pg18-delivery-A4kkJa/installed-source \
  /home/zxm/.local/share/zhiban-pg18-delivery-A4kkJa/fallback-state
# 在另一个终端正常停止并保存该实例：
node scripts/zhiban-portable.cjs stop \
  /home/zxm/.local/share/zhiban-pg18-delivery-A4kkJa/installed-source \
  /home/zxm/.local/share/zhiban-pg18-delivery-A4kkJa/fallback-state
```

## PG18 定向检查入口

迁移命令见[主说明](../../../zhiban-v2-ubuntu-pg18-local.md)。使用本轮私有展开的 PG18 二进制时，先设置其 libpq／liburing 搜索路径；系统正式安装的 PG18 无需此路径。

```sh
export LD_LIBRARY_PATH=/home/zxm/.local/share/zhiban-pg18-delivery-A4kkJa/pg18/usr/lib/x86_64-linux-gnu
```

Identity 检查需恢复后的可写目标，且目标必须由本工具建立、RESTORED pin 与传入 bundle 对应。它会产生／退出合成账号会话，不是纯只读检查。以下参数为占位名称；必须替换成 artifacts 中对应目标与 bundle 的绝对路径／pin，输出放私有目录。直接 tsx 会遇到 SDK 条件导出差异，采用独立 ESM bundle：

```sh
mkdir -m 700 .zhiban-pg18-probe-operator
pnpm exec esbuild scripts/zhiban-deploy/verify-pg18.ts \
  --bundle --platform=node --format=esm --packages=external \
  --outfile=.zhiban-pg18-probe-operator/probe.mjs
node .zhiban-pg18-probe-operator/probe.mjs TARGET18 BUNDLE PIN PRIVATE_OUTPUT
```

原生运行／维护授权仍保持隔离；本工具不会签发生产／Native 授权。失败目标留存诊断并拒绝原地重放，不能删掉 RESTORING 标记继续恢复。
