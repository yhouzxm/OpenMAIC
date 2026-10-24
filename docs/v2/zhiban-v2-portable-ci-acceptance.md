# GitHub 托管机跨机安装／恢复验收候选

2026-10-24，原 P7 持久化交付的独立远端验收。用户要求先准备 workflow 和私有材料交付审核，再运行。本轮仅本地准备，未上传、写 GitHub secret、提交、推送或 dispatch；不能把本页当作跨机 PASS。

## 一次完整验收

`.github/workflows/zhiban-portable-acceptance.yml` 仅 `workflow_dispatch`，无 push／PR／schedule；一个 `ubuntu-24.04` job，90分钟超时、同类运行串行，contents:read。官方 actions 固定完整 commit SHA，checkout 不保留凭据；Git与密文下载使用HTTP/1.1；Node22（22.19+）、pnpm10.28.0、PG16.15 Debian包 `16.15-1.pgdg24.04+2`。PGDG公钥 fingerprint 固定，包版本缺失即拒绝，不用其他版本冒充原物理备份 profile。

流程为：审核的密文 asset → SHA256 → AES-256-GCM认证解密 → 精确文件集／hash／来源检查 → 全新目录安装、独立Git与空pnpm store网络安装 → 三库恢复 → 原账号及全部非Identity行指纹 → 三角色登录／工作台与用户NSS信任的真实HTTPS浏览器 → 停止保存 → 普通重启（无升级参数，receipt字节不变）→ 数据保持 → 最终停止／备份验证 → 清理。

没有回跑 Identity／Storage 全量套件、课堂、模型生成或解析。当前业务包仍为上轮已验本地版本：sourceDigest `a310b5758e14af73e614935f44dde97b933b4b2f9f15f6ddbd2a41548e47a18d`，5897源文件。CI控制代码的 workflow SHA 与 dirty 业务包 sourceDigest 分别记录，不把基线HEAD当作完整候选。

原 LOCAL 安装／恢复manifest、profile及receipt不重签为CI。远端报告另设 `executionOrigin=GITHUB_ACTIONS`、`inputEvidenceOrigin=LOCAL`；只在真实手动Actions上下文、审核过的workflow SHA且目标 `/etc/machine-id` 摘要不同于来源机器时执行。原内层验证器的LOCAL报告不改写；新wrapper记录实际远端执行。保留原 `/tmp/zhiban-trial-content-*`、56517私有socket、3461 HTTPS origin，未实现任意PG目录搬迁。

## 待审核的私有材料交付方式

采用**一份加密交付包＋独立Environment密钥**，而非把账号、PG数据或TLS私钥上传为普通artifact。

1. 本机只读使用上轮已验 `release-kit/`、`restore-kit/`、私有逐表指纹及LOCAL closeout，复制到0700 staging，生成精确文件清单后tar压缩。每份交付产生独立随机256位密钥和96位nonce，AES-256-GCM，格式magic／nonce也参与认证；清理明文临时tar与staging。
2. 仅将 `portable-delivery.enc` 上传为临时Release asset，dispatch传数字asset ID与审核的ciphertext SHA256。下载只允许本仓库GitHub API，没有任意URL输入。即使仓库公开，上传的也仅是密文；密钥不在asset、仓库、artifact、日志或命令参数中。
3. 密钥文件在本机独立0700 `keys/` 目录、文件0600。审核后通过stdin写入 `zhiban-portable-acceptance` Environment 的 `ZHIBAN_PORTABLE_TRANSPORT_KEY`。不降级为repository secret，不将密钥发聊天。
4. 密钥只出现在认证解密step的环境；Node读取后移除进程环境项，tag通过前不发布解密tar，安全提取及完整验证前不执行候选源码。安装与应用子进程不继承运输密钥、GitHub token、模型／扫描器配置。
5. Environment须设置required reviewers、允许的专用分支和 `ZHIBAN_PORTABLE_APPROVED_WORKFLOW_SHA` 变量。只有该完整SHA可运行。单人项目可由用户确认；团队如需双人审核再开启prevent self-review。环境名写进YAML不等于已经配置保护。
6. 成功、失败、取消均尝试清理独立进程组、精确PG数据目录、私有namespace和本次用户NSS信任。PID必须核对uid、启动时间／argv／目录；未验证PID不发送信号，cleanup记FAIL，由一次性VM回收结束遗留，不能伪造清理PASS。报告字段白名单，所有原始日志／源hash字典／数据库／账号和截图均不上传，只有一个小JSON报告保留7天。
7. 运行后由操作者删除运输Environment secret与临时密文asset；workflow只有read权限，不自行删除仓库资源。每份交付独立密钥，不长期复用。

**包内确实包含：** 三个合成测试数据库；现有合成账号及LOCAL成员operator／approver私钥；现有localhost开发TLS私钥、公有CA及receipt；固定源码和Git anchors；私有数据指纹。审核对象包括这三份私钥（两份合成审批钥＋一份开发TLS钥），不能把“加密了”当成已经获准外传。

**不包含：** CA签发私钥、模型API密钥、外部扫描／解析凭据、旧55433真实Native维护control／独立pgpass／签名授权、生产凭据。不会连接本机55432／55433，不停止默认3461。本地加密包只读使用固定备份，不是重新导出正在变化的活库。

GitHub保护规则支持受仓库可见性和套餐限制；如当前仓库不能启用所需保护，先调整交付环境，**不静默取消审核或使用仓库级密钥替代**。[GitHub环境说明](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)、[部署审核](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/review-deployments)。PG来源按[官方Ubuntu安装说明](https://www.postgresql.org/download/linux/ubuntu/)。

## 审核后才做的 GitHub 操作

当前分支HEAD没有这些未提交工具，不能直接dispatch旧HEAD。最小bootstrap依赖闭包：

- 本workflow；`scripts/zhiban-ci/portable-delivery.cjs`、`portable-acceptance.cjs`、`install-portable-prerequisites.sh`。
- 上轮未提交的 `scripts/zhiban-portable.cjs`（CI helper直接依赖，不能漏提交）。
- 对应测试与本指南；业务源码由固定密文包交付，无需为了该job把全部dirty候选重新当作HEAD发布。

提交／推送仍待授权。`workflow_dispatch` 需先让GitHub识别该workflow；若尚未在默认分支注册，须先单独处理workflow注册。现有main push会触发其他CI，因此默认分支合入及其影响也须明确授权，不能借“准备workflow”偷偷推main。当前本地扫描未发现release事件触发自动发布，但实际发布密文asset前须核对远端相应workflow，避免发布事件附带其他自动化。

审核通过后，操作者使用密文、密钥文件路径和REVIEW.json中的pin；以下仅为待执行命令示意，没有在本轮执行：

```sh
# 创建受保护Environment及允许分支／reviewer／approved workflow SHA后：
gh secret set ZHIBAN_PORTABLE_TRANSPORT_KEY --repo yhouzxm/OpenMAIC --env zhiban-portable-acceptance < /本机私有keys/本次交付.hex
# 仅上传密文到审核过的临时Release；不上传REVIEW中的密钥文件
# 取得数字asset ID后，核对pin再手动dispatch：
gh workflow run zhiban-portable-acceptance.yml --repo yhouzxm/OpenMAIC --ref 审核分支 -f encrypted_asset_id=数字ID -f ciphertext_sha256=审核的64位hash
```

本地工具 `node scripts/zhiban-ci/portable-delivery.cjs prepare KIT RESTORE BASELINE LOCAL_CLOSEOUT OUTPUT KEY_FILE` 和 `open CIPHER DEST SHA256`。open仅从该step环境读取密钥；CLI不支持把密钥作为参数。准备记录及本地加解密复验见 `evidence/p7-handoff/portable-ci/`，实际密文／REVIEW留在本机私有目录。解密诊断不打印秘密值；原始失败日志不发GitHub。

当前只签收“workflow及安全交付候选准备、本地加密与定向负向验证”，真实PG版本安装、空缓存网络安装、跨UID／跨机恢复、GitHub浏览器信任及取消清理均须真正远端运行后才能签收。既有LOCAL业务证明、生产部署和完整Native门禁范围不扩大。

下一步：审核本包私有材料、密文pin、Environment保护和最小checkpoint闭包；用户授权后再提交／推送、配置交付并单次运行。常规交付接线建议GPT-6.1 Sol / medium；不改变冻结Identity授权。
