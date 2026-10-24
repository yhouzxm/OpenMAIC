# GitHub 托管机跨机安装／恢复验收候选

2026-10-24，原 P7 持久化交付的独立远端验收。最新状态：目录闭包修复经审核并checkpoint为db5cf3c1，最终授权run 40090990321仍在RESTORE_START退出1（UNCLASSIFIED），cleanup PASS，远端未签收。下文旧阶段记录保留其当时范围，当前结果以末节和final-execution.json为准。

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

## 2026-10-24 授权执行记录

用户已明确授权上述私有材料范围、最小 checkpoint、workflow 注册、受保护交付及单次远端验收。此前 PREPARATION／REVIEW 的未授权状态是历史记录，不代表本次授权无效。

- 验收控制代码 checkpoint：`6a7b30f8c6c0e614fb43d15828c75ca0e329c4c5`，12个 bootstrap／定向测试／准备证据文件；其余 dirty 业务候选未纳入。
- 默认 main 注册：`e1b16e0c4d1b81953b23cc0f3da20e1d1ccd04aa`，只增加 workflow 文件；两个提交均使用 `[skip ci]`，未触发无关 CI。未切换本地分支／覆盖候选。
- Environment 已建立：审核人 yhouzxm、禁止管理员绕过、只允许 `refactor/zhiban-v2`，approved SHA 与 checkpoint 一致。独立密钥以 stdin 写入 Environment secret，未使用 repository secret。
- 仅上传临时 AES-GCM 密文，GitHub 返回的 digest／字节数与本地审核值相同。
- **实际远端验收尚未执行。** GitHub dispatch 返回 HTTP422 `Actions has been disabled for this repository.`；常规仓库权限 API 为 enabled=true、workflow 为 active，Actions 页面另明确提示 fork 因平台用量策略暂停，需维护者重新启用。当前内置浏览器未登录，普通启用 API 未解除此限制。被拒的 dispatch 请求没有创建 run，不计作验收运行。

阶段性执行与临时交付清理状态见 `evidence/p7-handoff/portable-ci/execution.json`。解除 fork 暂停后，仍仅允许运行一次；不得把已上传、已注册或 LOCAL 证据记为跨机 PASS。

临时运输 Environment secret、密文 Release及其临时 tag 已删除；本机密文与独立0600密钥仍在，待解除平台暂停后按既有授权重新交付。Environment保护、approved SHA与已注册workflow保留。实际运行数核验为0；默认3461仍为原PID87878，sourceMatches=true、drift=0，受信HTTPS返回200。解除后继续单次验收，建议GPT-6.1 Sol / medium。

## 重新启用后的单次验收结果（当前状态）

用户确认已重新启用 fork。重新交付相同密文，GitHub服务端digest及字节数匹配原pin；仍为Environment受保护的独立secret，无repository secret。GitHub在创建run前指出job级env不能使用runner.temp；已将路径初始化移至首step的RUNNER_TEMP并写入GITHUB_ENV，补上下文约束测试，官方actionlint发行包checksum及检查PASS，18项定向检查PASS。

- 最终验收代码SHA：`0f6903b2eeb39ccf8e27762705ac3a86d60f7911`；main仅workflow注册修正SHA：`d280110a63736679be380e58691595640041f0b0`。修正提交仍使用`[skip ci]`，无无关CI。固定业务sourceDigest与密文pin保持原值。
- 唯一实际run：[40087593933](https://github.com/yhouzxm/OpenMAIC/actions/runs/40087593933)，attempt 1，Environment由已授权用户yhouzxm批准，未绕过reviewer。
- **结论FAIL，failureStage=RESTORE_START。** 固定PG安装、密文核验与解密步骤PASS；按helper顺序，独立空store安装、浏览器依赖、私有import和NSS CA导入已完成。未到三角色／浏览器访问、数据比较、普通重启和最终快照验收，不能扩大为恢复成功。
- 合并步骤10:53:03–10:55:59 UTC，共176秒，短于ready等待180秒，不能以延长就绪超时作为已定位修复。当前脱敏报告只有phase，具体启动错误未确认；原始私有日志依约清理，不推测为PG、证书或权限错误。
- runner cleanup PASS，privateNamespacePurged=true。临时运输secret已删且secret列表为空；密文asset、Release、临时tag均404核验。仅保留7天的白名单FAIL汇总，无明文／账号／数据库artifact。
- 本地默认3461保持原实例，不为远端验收停服或重建。本地记录见`execution.json`、`run-40087593933/`、metadata与timings。

下一完整工作：对RESTORE_START增加白名单错误类别／退出状态／子阶段耗时，完成恢复启动失败的定向定位与修复，再准备单独授权的复验；本轮不自动执行第二次远端运行。建议GPT-6.1 Sol / medium。

## RESTORE_START 安全诊断增量（本地候选）

原run保持FAIL。新监督器等待child spawn后再保存身份，记录exit／signal；区分spawn失败、提前退出、身份不匹配、元数据异常、超时和命令失败，按固定阶段记录毫秒耗时。仅从owner-only且拒绝符号链接的启动日志尾部（最多1 MiB）识别固定错误类别；未知错误仍为UNCLASSIFIED，不上传原始错误、stderr、堆栈或路径。清理步骤保留经白名单二次过滤的诊断。

本地用同一冻结install／restore包真实离线安装，在隔离PID／网络和tmpfs /tmp内验证恢复启动与普通重启，均受信HTTPS成功；宿主默认3461从未停止。候选监督器同UID成功，原监督器映射UID1001也成功；原启动进程身份核对的30次受控实验未失败。因此**本轮修复的是诊断缺口及spawn握手稳健性，尚不能声称修复历史远端根因**。本地命名空间仍是同机，不是GITHUB_ACTIONS证据。

23项定向检查、lint与格式通过；没有重跑课堂、模型、解析或远端CI。汇总见`evidence/p7-handoff/portable-ci/startup-diagnosis-local/summary.json`。用户已收到仅该增量checkpoint／推送与一次诊断复验的授权问题；批准前不执行，冻结业务包与密文pin不变。

## 诊断复验与目录闭包修复（当前状态）

用户授权的一次诊断复验已执行：[40089510426](https://github.com/yhouzxm/OpenMAIC/actions/runs/40089510426)，SHA `2da64bd644968561aaa7e0480166f9a19e827c98`，只提交监督器和测试两文件；批准SHA同步，main未改。run仍FAIL，诊断为HOST_EXITED／exitCode 1／PG_START_FAILED，RESTORE_START 40058ms。独立安装121181ms，浏览器依赖15811ms；runner清理PASS、私有namespace已清。运输secret、临时密文asset／Release／tag均删除核验。未追加第三次运行。

**根因已在本地真实复现：**旧加密传输V1只列普通文件，不含空目录。原密文认证解密及文件hash仍PASS，但PG要求的pg_notify等14个空目录丢失；隔离UID1001的实际PG16启动报缺pg_notify失败。之前本地复验直接从restore-kit复制，保留了目录，因此没有复现。

**修复候选：**运输manifest升级V2，认证精确目录清单及文件hash清单；tar显式保留空目录，安全提取核对目录／文件／父目录闭包，目录0700、文件0600，旧V1包前置拒绝。校验逻辑不再把缺目录包当完整交付。旧密文已标记RETIRED，不能再交付。业务sourceDigest、install／restore manifest及3128个文件hash全部不变，不改已应用migration、数据或冻结授权。

新V2密文pin：`c3bf2f5c1e05e1148029345c314099a204381a350fd7ca9516cd4b15a610d07b`，267166613字节，3128文件＋35目录，新独立0600密钥，仅本地。真实新密文加解密→import→恢复启动→普通重启在隔离PID／网络／tmpfs /tmp及UID1001通过，两次受信HTTPS成功。28项定向检查／lint／格式通过。此为LOCAL同机namespace证明，不能改写为远端PASS。

修复及证据见`directory-closure-fix-local/summary.json`。修复两文件为`portable-delivery.cjs`和`portable-ci.test.cjs`，当前未提交／推送；新密文未上传，未触发更多CI。下一步只需审核该具体修复及新pin，另行授权最小checkpoint与最终一次远端验收；不重复课堂、模型、解析或Identity／Storage套件。建议GPT-6.1 Sol / medium。

## 最终授权验收结果（当前状态）

用户已审核并授权目录修复、新密文pin、最小checkpoint和最终一次远端验收。源／pin／key模式核验通过后，仅提交`portable-delivery.cjs`和`portable-ci.test.cjs`：`db5cf3c19f5a04c09f769864e6b91323c4b54504`，`[skip ci]`，远端HEAD已核验，main未更新。Environment批准SHA同步，仍由指定审核人按授权放行，无管理员绕过。

实际run：[40090990321](https://github.com/yhouzxm/OpenMAIC/actions/runs/40090990321)，attempt 1。GitHub返回V2密文SHA256与已审核`c3bf2f5c1e05e1148029345c314099a204381a350fd7ca9516cd4b15a610d07b`一致，267166613字节。固定PG16、下载核验、V2认证解密步骤成功，独立安装78940ms、浏览器依赖11034ms、private import885ms、NSS导入19ms。

**最终结果仍为FAIL，不能签收远端恢复。** RESTORE_START在25030ms失败，子进程exitCode1，reason=UNCLASSIFIED。目录闭包缺陷已修复并真实交付，但不能据此声称它是唯一启动阻碍，也不能凭现有摘要推定PG、身份、证书或模型错误。未到DATA_ROLES_HTTPS／NORMAL_RESTART／FINAL_SNAPSHOT验收。原LOCAL闭包与隔离启动证明保留，但不能改为GITHUB_ACTIONS PASS。

runner cleanup PASS、privateNamespacePurged=true。运输Environment secret删除且列表为空；密文asset／Release／临时tag删除并404核验。只保留白名单FAIL摘要，没有上传原始私有日志、账号或数据库。用户“最终一次”额度已使用，本轮不自动追加CI。原3461保持原实例，sourceMatches=true、drift=0、受信HTTPS200。

当前证据：`evidence/p7-handoff/portable-ci/final-execution.json`及`run-40090990321/`。下一完整工作是为剩余未知启动失败补结构化子阶段／固定错误来源，再定向定位修复；远端再次运行须另获具体授权，不能再泛称“最终一次”已通过。建议GPT-6.1 Sol / medium。

## 结构化启动阶段与剩余失败定位（LOCAL候选）

本轮未提交／推送／CI。真正的隔离复现补上了此前盲点：只隔离网络、PID及/tmp仍会读到来源机器的旧checkout。本轮隐藏整个来源HOME，只显式提供Node／pnpm／Chromium工具链和交付副本；UID1001下旧代码退出1，新增结构化事件精确记录HOST／CONTENT_REBIND／FAIL／ENOENT。缺失的是旧checkout中的`lib/zhiban/infrastructure/identity/postgres/bootstrap-roles.pg16.sql`。

`expectedAutoContent()`直接遍历base.sourceHashes的历史绝对键并readFile，因旧机器路径不存在而失败。现改为通过唯一bootstrap anchor调用既有referenceSourceEntries，解析为当前交付目录相对源名，再核验原hash；不回退到旧路径、不修改参考文件／profile、不放宽Identity／ACL。混合checkout、歧义、遍历及hash不符继续拒绝。仅替换该来源解析逻辑，就使隐藏来源HOME的恢复及普通重启通过；当前副本源码篡改仍被拒绝，恢复后profile不变。

新增共享startup-diagnostics.cjs，由persistent launcher／catalog builder／host发出分层阶段事件，涵盖PLAYER_BUILD、SDK_VERIFY／BUILD、快照恢复、PG_START、数据库检查、CONTENT_REBIND、内容加载、服务组合及HTTPS_LISTEN／HOST_READY。记录单层单调耗时、固定错误码及错误类型，不记录message、stderr、路径、stack、SQL或账号。sink仅位于owner-only LOCAL state下的固定文件，拒绝符号链接／硬链接／过宽权限／超大文件；失败报告和cleanup再次白名单过滤。未启用sink时不写文件，也不改变启动授权或异常处理。

31项Node边界检查＋3项来源解析检查通过，受影响文件lint／格式通过。实际instrumented before-fix为CONTENT_REBIND／ENOENT；修复后restore及normal两个模式都到HOST_READY，受信HTTPS均成功。只做启动相关验证，无课堂／模型／解析／全量PG回归。原远端40090990321仍保持FAIL／UNCLASSIFIED；上述具体ENOENT来自LOCAL因果复现，不能事后改写成远端采集结果。

证据：`evidence/p7-handoff/portable-ci/structured-startup-local/`。本轮启动源码已经变化，旧5897文件sourceDigest及c3bf2f…密文不包含本修复，不能直接再用旧包证明新源码。下一完整步骤是重建源码安装包／sourceDigest与运输审查输入，再按具体授权做checkpoint及必要远端复验；保持旧LOCAL与失败run的证据范围。建议GPT-6.1 Sol / medium。

默认3461本轮始终为原PID87878、受信HTTPS200。因编辑4份既有启动／校验源码，trial info如实显示sourceMatches=false、sourceDriftCount=4；这是新源码候选未装载到原实例的状态，不覆写旧metadata，不冒充新实例证明。

## 修复后安装包与运输重建（LOCAL候选）

将历史绝对来源路径修复与结构化启动诊断一起冻结进新的独立源码安装包；旧5897文件包及c3bf2f…运输pin保留历史适用范围，不用于本次源码。安装及恢复仍使用同一PG16物理备份与基线，只在隐藏来源HOME的UID1001隔离空间核验恢复、普通重启、受信HTTPS与数据保持；不重跑无关课堂或伪造GitHub环境。新sourceDigest、安装manifest pin、独立密钥V2运输pin与实际结果写入排除自引用的`evidence/p7-handoff/portable-ci/source-rebuild/`。本次不提交、推送或dispatch。
