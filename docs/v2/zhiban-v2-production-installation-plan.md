# P3/P7 正式生产安装剩余交付计划

本计划接续原迁移计划第6节第三大包「持久化可交付版本」，不另起功能移植主线。目标是将当前普通智伴教学能力部署在 Ubuntu ECS＋RDS PostgreSQL18，形成可手动安装、启动、升级、备份和恢复的版本。

目标目录 `/var/www/zhiban`；外部入口沿用 `https://47.120.42.25:88`。真实 RDS 保持隔离；当前已实现并本地验证 A／B 全新路径及 C 运维恢复工具，未提交、推送、运行 CI 或连接生产。

## 基线与纠偏

- 现有源码 HEAD `3a15d89888187ab3fed768026fc744cf72dcc544`；被测代码 `9072c48f62141b86ada18819667978c2609024a9`，GitHub run 40942085416 SUCCESS。参考、PG18 普通应用与备份恢复、隔离 PG16→PG18 导入已通过，适用范围保持。
- 新增独立正式 installer／受限运行宿主，入口为 `pnpm deploy:zhiban:production`；`rds.cjs` 仍仅有 plan/preflight/stage。历史导入后的 receipt 激活仍待实现；生产界面文案开关本身不提供这些能力。
- 旧 authoring LOCAL 角色持有数据库所有权且启动执行 schema ensure 的路径保持原适用范围。新增正式 root 采用显式 installed-schema 策略、独立 migrator 与无 DDL runtime，不沿用 LOCAL owner 权限。
- **缺少真实 RDS 输入只阻塞目标预置和上线验收，不能继续阻塞通用安装器、正式宿主和恢复工具的开发。** 之前把整个后续工作等待 staging 的排期应纠正。
- 默认先交付「全新空库安装」；PG16 历史数据迁移为可选分支。新部署不必等待迁移功能才能上线，已有数据也不能通过清空重建来替代迁移。

## 一个完整交付包，四个连续阶段

以下阶段是包内实施顺序，不要求用户逐项续批，不拆成反复设计／评审小轮次。除生产目标操作需要具体输入和授权外，代码及本地验证连续推进。

| 顺序 | 工作和代码交付 | 完成标准 | 真实目标输入依赖 |
| --- | --- | --- | --- |
| A 安装／运行一体化 | 从 LOCAL harness 抽取真实服务组合、HTTP／页面／静态资产传输与必要生命周期；显式正式配置；分离安装角色与运行角色；覆盖业务、Content、authoring 三库 schema、ACL、严格 ledger／来源检查及独立 expected profile；安装计划、应用、查证、失败隔离与运行 loader 一起实现 | 从干净目录在独立 PG18 安装并以无 DDL、无 owner、无越权角色关系的运行凭据启动；重启不执行 schema DDL；账号→课程→发布／学习→提交→成绩可用；错来源／ACL／版本／部分安装状态拒绝启用 | 通用代码和本地 TLS PG18 验证不依赖 RDS。冻结角色图的真实预置及具体 owner／grantor 参考须结合真实目标审核 |
| B 账户与数据启用 | 全新安装交付真实首管理员的一次性受限初始化／首密流程，不带示例账号；可选 PG16→PG18 导入后新部署／receipt 签发与加载，保留旧部署、版本、generation 及历史内容；私有原件和实例密钥一起恢复 | 空库可成为真实管理员可登录的系统；导入分支原账号／课程／历史可回看，新发布采用新部署绑定；未完成／绑定不符状态不能激活；两条路径均可重新启动 | 代码及现场合成数据验证不依赖真实用户信息。生产首管理员的身份、交付人及批准配置在目标启用前提供 |
| C Ubuntu 运维交付 | 独立非 root 服务用户、正式宿主启动器、systemd、HTTPS 88 反向代理模板、配置／密钥私有目录、文件与数据库路径检查、日志脱敏、readiness、优雅停机、重启／升级、备份／恢复命令和中文手册；扫描／解析／媒体进程按现有适配器配置 | 新机器可按一份手册手动安装、开机启动和更新；停止时排空请求／worker，备份在一致写入边界覆盖三库＋原件＋实例密钥；另一隔离目录恢复后ID和数据不变；新版本切换失败保留可用版本及数据 | 工具／模板／本机隔离演练不依赖 ECS。实际 HTTPS 证书、RDS CA 和服务配置仅在目标配置时提供 |
| D 一次目标验收与P7交接 | 在 ECS 先预检并确认角色预置路径，审核具体安装计划后安装；核对运行账号权限、三角色主流程、真实服务状态、重启／恢复；记录源码SHA、配置／profile pin、receipt 和实际目标结果，最后更新一次交接 | 目标 HTTPS 入口可登录，核心教学主流程可用；系统重启后仍可用；恢复演练成功；初始凭据与私有材料已受控交付，未启用能力明确；用户签收范围准确 | 必须提供实际目标输入及具体安装／切换授权；不将 GitHub VM 当作真实 RDS |

## 关键实现约束

### 安装与运行

安装负责显式 schema 与必要升级，运行只校验安装来源和完整状态。保留原生 OpenMAIC stores、工作台、worker 和服务适配器，抽取宿主组合；生产执行图不得导入 fixture、示例账号创建器或本地初始化入口。不通过更改 public provider、已应用 migration 或给运行用户增加 DDL 解决启动问题。

安装参考从审核过的源和部署策略独立构造，明确记录 owner、grantor、ACL、角色图、PG 主版本和 provider 版本；真实目标只作为被核验对象。普通 CREATEROLE 不等于能够安装冻结角色图。若 RDS 无法合规预置，应保留明确阻塞并提出具体可审核方案，不能自动允许额外 ADMIN 边。

三库安装不是一个数据库事务。必须有安装ID、逐阶段查证和未完成标记；失败后 runtime 拒绝启动。恢复／重试只依据已核实的安装阶段；不自动删除已有数据库、他人角色或清理共享 OpenMAIC 对象。

现已实现 `plan/install/inspect/verify/start` 及独立来源构造、离线提案／签名命令，见[全新安装手册](zhiban-v2-production-fresh-install.md)。C 已新增独立预构建非 root 宿主、systemd／HTTPS88 模板、正式一致备份／独立恢复及激活命令，见[Ubuntu 运维手册](zhiban-v2-ubuntu-operations.md)。不将旧 LOCAL 工具改名冒充，也不将模板语法验证当作真实开机验收。

### 账户、receipt 与配置

全新安装不创建教学演示数据。首管理员初始化要有明确批准、受限有效期、单次消费、并发与审计，避免暴露已知默认密码或开放公共 bootstrap。普通账户开通仍复用现有 Identity 流程，缺少运营审批的入口继续关闭。

receipt 必须绑定独立批准参考、目标三库、当前部署、provider、实现／资产来源和 HTTPS 配置。运行 loader 使用受信预期输入验证，不自行将观察到的现状签为可信结果。PG16 导入保留旧绑定；新 receipt 是独立启用步骤，不能改旧 receipt 的 major／指纹冒充新签发。

管理凭据不交给常驻运行进程；实例密钥随私有恢复包交付；生产 `.env` 不复制 LOCAL 成套设置。`ZHIBAN_UI_ENVIRONMENT=production` 是界面配置之一，不能作为生产安全开关。RDS CA 与对浏览器提供的 HTTPS 证书分别管理。

### 备份与升级

应用停写／排空后取得三库和文件的一致恢复切点，或者使用经证明的等价一致性协议；不能将独立取得的三个 dump 直接当成同一业务时点。恢复到新目标先验证闭包、权限和 receipt，再显式启用。

源码回退与数据库回退分开：新 schema／数据已经写入时，旧源码不一定能读取新状态。只给出经过验证的兼容回退，其他情形通过完整备份恢复。恢复原件、实例密钥、配置与数据库，不能只恢复数据库后丢失加密服务配置。

## 输入一次收集，开发不等待

真实安装前统一收集：

1. ECS 的受控连接方式、Ubuntu／架构、目录和服务端口；既有 OpenMAIC 保留边界。
2. RDS endpoint／端口、实际存在的管理库、专用管理配置文件和 CA 路径、白名单／TLS状态，以及合规预置冻结角色图的管理路径。
3. HTTPS IP:88 的可信证书／私钥文件路径及续期责任；若该入口方案不能落实，先确认可实施的域名／证书方案。
4. 首管理员身份及批准／首密交付配置；选择空库新装还是迁移指定快照。
5. 生产所需的扫描、解析、模型及媒体服务配置文件路径，以及备份位置、保存期限和运维联系人。

只收路径和非敏感元数据，密码／私钥不进入聊天或 Git。缺模型／解析服务只使相应能力保持不可用；不影响普通登录、教务、文本教学和人工评分的交付。真实 RDS 目前继续隔离。

## 验证与证据策略

- A–C 以本机独立 PG18＋TLS、受限角色和合成账户验证正式安装／运行路径，不用 LOCAL harness 启动成功替代正式宿主测试。
- 仅验证新增角色／ACL、首管理员、receipt、部分安装、并发启用、停写和恢复边界；页面覆盖受影响的三角色关键旅程。PG16 只在导入来源和必要兼容边界使用。
- 已有 run 40942085416 和数据导入证明保留各自范围，不因计划更新重跑。新边界先本地检查，只有新跨机问题或明确授权才安排新的远端验收；正式目标验收直接在 ECS／RDS 执行。
- P7 在整个包可交付时集中更新一次，交付源码版本、安装手册、运维模板、私有材料清单及准确证据。进度按「可安装／可登录／可重启／可恢复」报告，不按测试数量或文档数量报告。

## 当前实施记录：A／B 与 C 工具已本地贯通，真实 RDS 未验收

候选基于 `3a15d89888187ab3fed768026fc744cf72dcc544` 的未提交工作树。新增统一 `setup-plan/setup` 入口：安装时自动导入所有 schema 和系统初始化数据，可在批准的 PG18 superuser 管理路径上创建三个专用空库／受限角色；已预置模式复用同一 installer。READY 复跑仅核验，不重置密码或数据；非空目标与部分失败保留并拒绝启用。RDS 不具备该自动预置权限时仍须独立合规预置，不降低角色图要求。新增正式 source-profile 构造器、三库安装总控、逐阶段 durable journal、Ed25519 receipt 签发／loader，以及无 fixture／示例账号／启动 DDL 的真实应用、HTTP／页面宿主。安装阶段才加载 migration；常驻 root 只得到八个受限运行连接。来源闭包涵盖源码、SDK、实际浏览器资产与安装 SQL；完整 schema／ACL／角色图、业务 migration ledger、Native ledger 与 authoring ledger／receipts 分别核验。Identity ledger 的查证使用新增安装 overlay，只向 control runtime 暴露版本与 checksum，保留冻结业务授权。

运行前核验独立 source profile、签名 receipt、三库绑定与 READY journal；取得与 installer 共用的生命周期锁后再次查证，然后确认首管理员初始化／首密消费及新 Content deployment。CA 与 hostname 验证同时用于所有 PG 连接及原生 LISTEN 连接。进程退出释放 HTTP／worker／连接及锁；运行进程没有 migrator 或签发私钥。原 LOCAL 未配置策略时保留原路径。既有 migration／SDK SQL 模板未修改。

全新首管理员使用原双人 FIRST_PLATFORM_ADMIN／FIRST_PASSWORD；安装不创建示例账号，重复 provision 按原合同幂等，不能覆盖密码。正式平台页通过实时 session 和当前系统管理员 grant 判断访问；可选双签控制 authority 接入原有 register／execute，仍验证密码重认证、CSRF、目录／版本、命令及 CAS，不开放 bootstrap。离线 identity／首管理员提案、签名和 envelope 命令不等于授权。

最新 [LOCAL 结果](evidence/persistence-130/production-install-runs/latest-local.json) 与同目录独立 source-profile 记录了实际候选闭包，覆盖：

- 在单独 source cluster 构造参考后，另起目标 PG18，通过真实 SCRAM／TLS 完成三库安装；浏览器经精确 leaf SPKI pin、HTTPS 客户端经受信 CA 验证。
- 首管理员真实登录平台管理页；双签受控开通空间；普通用户平台越权拒绝；正式宿主下三角色登录、课程／教学班、活动发布、学生作答提交、人工评分发布和学生反馈回看；真实文本 Bridge 发布／学生查看。
- 重启保留管理员和学生认证与数据；实际 CONTENT_SCHEMA 连接失败保留已完成 BUSINESS_SCHEMA，写 FAILED 且没有 receipt；签名替换、ACL MAINTAIN 扩权、Identity ledger 篡改拒绝启用。

教学合成账户只在验证脚本中经真实 domain repository 准备，不进入正式 root。没有把 mock 模型当真实成功；本轮不重复外部服务或完整课堂套件。历史 GitHub run 的适用范围保持；新 LOCAL 证据不扩展为真实 RDS、生产证书或跨机恢复证明。

可复现入口（仅创建自有 disposable PG18／临时材料，依赖已构建浏览器资产及 Playwright Chromium）：

```bash
pnpm verify:zhiban:production
```

具体生产配置、角色预置来源、私有材料、提案／批准、plan／install／start 和失败处理见[全新三库安装手册](zhiban-v2-production-fresh-install.md)，填写模板在 `docs/v2/examples/production-install/`。源码／资产变化后须独立重建及审核 profile；本机测试 profile 不是 RDS 批准。

C 的[LOCAL 运维结果](evidence/persistence-130/production-operations-runs/latest-local.json)已覆盖预构建非 root／只读宿主、真实 Nginx TLS／可信代理、三库同时停写屏障、真实 dump／data-only restore、全部表数据及原件／实例密钥／加密服务配置、保留旧发布绑定的新 receipt、显式激活、历史页面和生命周期锁丢失停机。systemd 仅生成及语法检查，未在桌面安装服务。兼容源码／资产更新及凭据／证书换绑走新空目标恢复，不提供任意 schema 原库升级或无停机切换。

**尚余范围**：B 的可选旧 LOCAL／PG16 历史导入后正式 receipt 启用（本次正式 PG18 备份格式的恢复激活已实现）；不兼容 schema 的专用 migration；D 的真实 ECS／RDS 权限预置、受信任公网证书、systemd 开机／重启与独立目标恢复验收。任意失败阶段自动接续仍未开放；不修改 journal 伪造 READY，不自动删除部分目标。实际 RDS 输入不足继续只阻塞真实预置／上线，不阻塞上述通用工具开发。

## 开工顺序与最终退出标准

A 与 B 的全新首管理员路径已接入同一安装流程，C 运维／一致恢复已完成本机隔离交付。下一完整包为 D 真实 ECS／RDS 预检、部署与恢复签收；可选旧 LOCAL／PG16 激活单列，不阻塞全新安装。无需等待真实 RDS 才开始 A–C，也不再为每条命令或每项检查要求用户续批。

最终完成条件：用户可按单一手册在 Ubuntu＋RDS18 手动部署，使用真实首管理员登录，完成普通教学主流程，重启后数据保留，能在独立目标恢复；安装角色和运行角色分离，来源／ACL／receipt 检查有效，真实外部服务状态如实显示。旧 Native 维护链、UNKNOWN／RESERVED 和仪器实测继续保留既定隔离，不作为普通生产宿主交付的前置条件。

建议模型：A／B 涉及跨 Identity、权限和并发，GPT-6.1 Sol / high；C 的常规脚本、模板和手册用 GPT-6.1 Sol / medium；D 有授权或切换边界时使用 high。本轮未操作生产、未提交／推送／CI，也未安排关机；不把 A／B 本地通过等同于全部生产交付完成。
