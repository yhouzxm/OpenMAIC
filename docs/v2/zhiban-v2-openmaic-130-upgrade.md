# OpenMAIC v1.3.0 智伴升级候选

2026-10-29。官方来源：[v1.3.0](https://github.com/THU-MAIC/OpenMAIC/releases/tag/v1.3.0)，固定 SHA `c0f296aa36096ec3d1e1e2b94a7a48e20075e0a1`；前版为 v1.2.1 / `e19d0d4f45d81b8f7ab599b33ab03b0b8b68d5c0`。智伴工作分支保持 `refactor/zhiban-v2`，基线 `038a28e8181e8fddcf69a386244da64044a3486b`。本轮为工作区候选，没有提交、推送、CI 或生产部署。

## 更新范围

对两个官方固定版本的 697 个路径变化逐文件三方合并，保留项目 AGENTS 和现有 CI suite 调度策略；未自动合并 upstream/main。原有 dirty 文档、证据与素材保留。升级前源码快照在私有目录 `/home/zxm/.local/state/zhiban-upgrades/openmaic-130-20261029-203623/workspace.tar.gz`，不含忽略的私有配置和数据库，不替代数据备份。

| 能力 | 智伴接线 |
| --- | --- |
| 知识库 | 原生文件夹、列表、改名、移动、删除及原件读取；仍按教学班＋教师分区，不自动跨课程共享。所有请求复用当前课程教师授权、扫描与配额；页面按宿主实际单文件 1 MiB 上限展示。新增 owner extraction runner 接原生成执行授权上下文，停止时按原生 lease 排空。 |
| Pro 工作台 | 复用请求预览、课程 Learn/Edit 切换和编辑器预热，保留“核对→采用独立草稿→显式发布”。原件菜单在智伴 bundle 中转为受限 fetch，不直接跳到未授权的原生根 API。 |
| 解析与语音 | 合入 MinerU 图片持久化、错误分类、语言／语音及 TTS 连接级排队；保留旧 Office 可信转换和 GLM 录音长度／WAV 校验。没有改写私有配置或自动产生服务费用。 |
| 播放／编辑／导出 | 新增 geometry 包，复用无效几何降级、图表／公式及互动音视频协调；PPTX 修复同步到既有共享 builder，保留服务端受限导出。互动库由安装产物提供，限定公开版本路径及 CORS。 |
| 配置 | 同步 `.env.example`、`openmaic.example.yml` 与依赖 lock。内置 Veo 移除沿用上游行为；不自动替换用户已选服务。 |

包版本：DSL 0.12.0、Geometry 0.1.0、Generation 0.3.28、Storage 0.38.1、Renderer 0.2.0、Editor 0.0.12、Importer 0.3.1。测验定制独立重绑定到 `docs/v2/candidates/openmaic-130/quiz-extension-source.json`，旧扩展证据不覆盖。

## 数据、授权与证据边界

- 新增 `0015_openmaic_130_versions.sql`，只增加精确 provider tuple／DSL 允许值；既有 deployment 和 generation 不重标记，原复合 FK 继续禁止混搭。之前的 57 个智伴 migration 字节保持不变。
- 独立临时 PG16 中从源码构建新版参考：`docs/v2/candidates/openmaic-130/reference-pg16.json` 和 `pin-pg16.json`。这是 construction-only 参考，不是产品签收。新 Native ACL 仅增加读取资产引用根及更新引用规则版本的必要权限，不授予 runtime 删除引用根或 DDL。
- 旧 PG16／PG18、维护 Native、P7 及真实服务证据只保留其原 SHA／source 范围。新 profile loader 不接受旧参考冒充 v1.3.0；PG18 新参考和验收另待具备该版本二进制的环境。本机只安装 PG16。
- 当前不自动迁移既有持久化试用库或阿里云 RDS。冻结 Native 维护链继续隔离。生产部署本身仍按既有 RDS 交付待办，不以原生 `next start` 代替智伴完整宿主。

## 切换要求

按官方 v1.3.0 release conditions，旧实例必须全部停止写入后才允许新版写入，不做跨版本滚动混跑；升级写入资产池后不得将同一数据库降回 1.2.x。`MATERIALS_POOL_BACKFILL=1` 只可在全部旧进程停止后显式设置，不是默认启动选项。没有 S3／受信 byte store 时，知识库原件进入 PostgreSQL，备份应包含全部库、资产和实例密钥。

已有试用快照保留原格式；当前 `--upgrade-local` 的旧接续流程不能当作 v1.3.0 离线数据迁移器。应先在副本完成版本化迁移、独立 profile 与 receipt 校验及恢复演练，再切换实例。失败前的快照可用于独立旧版环境恢复，不能作为新版已写入库的原地降级办法。

## 本地检查与入口

- `pnpm build:zhiban:upstream-reference`：新建私有 socket-only PG16，从已审 SQL 构建参考并销毁临时 cluster；`-- --verify` 只核对重建结果。
- `pnpm verify:zhiban:upstream130`：隔离 PG16 与真实 Identity／HTTPS／浏览器，定向覆盖新版备课与知识库，不重复完整课堂回归。真实模型调用不在该命令默认范围。
- 私有检查日志：`/home/zxm/.local/state/zhiban-upgrades/openmaic-130-20261029-203623/checks/`。中断前丢失的临时日志不计通过。PGlite 知识库套件因本机内存占用停止，不作为产品失败或通过；对应功能改用真实 PG16 验证。

### 本轮签收结果（LOCAL 工作区候选）

[LOCAL receipt](evidence/openmaic-130/upgrade-local.json)记录最终通过项、日志 hash、截图及代码／配置／SQL候选摘要；[源码绑定清单](evidence/openmaic-130/candidate-source.json)明确排除私有设置、数据库、生成产物及二进制素材，不能代替 portable 安装包的 sourceDigest。

- 官方七个 SDK 来源及独立 quiz 扩展 hash 核对通过；新 PG16 参考从独立 cluster 重建后与 pin 一致。原有 57 个已应用 migration 文件保持不变。
- `pnpm build --webpack` **完整构建通过**，包括生产 TypeScript、静态页面和 standalone 依赖收集；这是代码构建，不是生产宿主／RDS 启动验收。保留 upstream `unpdf` 动态依赖及 middleware 弃用提示，不把中止的 Turbopack 算通过。
- 最终代码的 `pnpm verify:zhiban:upstream130` **通过**：真实受限 PG16、Identity、可信本地 HTTPS、教师原生编辑与固定发布／学生查看，以及旧会话资料和新知识库资产池的上传／抽取、目录改名／移动／删除保留文件、原件字节下载、桌面／手机页面。实际核对跨教学班、学生、撤权教师、CSRF、混合版本 tuple 拒绝、CAS／幂等采用和发布版本不可变。
- 受影响的解析配置、知识库 UI、语音、PPTX 公式／形状、题型和启动／路由用例通过；选定的真实 PG16 资料生命周期／删除并发用例通过。未选择的上游用例、完整课堂、真实模型／媒体再调用、PG18 和 CI 均不在本次通过范围。

所有临时验证 cluster 已清理；已有持久化实例没有迁移或启用。本轮未提交、推送、dispatch 或部署。

### 打包兼容修复

原生 Node 启动／停机逻辑移到 `lib/server/instrumentation-node.ts`；根 `instrumentation.ts` 只在 `NEXT_RUNTIME === 'nodejs'` 时动态加载，避免 Edge 编译解析数据库、文件系统与服务 SDK。原有启动、backfill 显式开关及排空行为由原生启动用例核对。

Webpack 对 `@openmaic/storage` 启用具名导出优化，浏览器使用的错误类型／KV Store 直达叶子模块，避免解析总入口附带的 Node-only material ID 模块。不关闭加密、不替换服务器加密实现，也不修改 SDK 源码。当前本机正式打包使用 `pnpm build --webpack`；Turbopack 因实际内存／交换空间压力中止，不能记作通过。

新增真实 PG16 定向用例复用上游 material-library 的数据库场景，覆盖课程副本独立、完整资料链删除与配额释放、拒绝不可访问／退休 owner、撤销 root 失败回滚、解析 tombstone 及删除／发布并发。只运行选中的六个场景，其余上游场景没有重复执行。

Next 路由入口只导出 HTTP 方法和静态配置；八处原生实现移至同目录 `handler.ts`，测试辅助常量和可注入 persistence handler 从实现模块引用，不改变 URL、授权或轮询周期。正式 TypeScript 检查排除独立 `docs/` 证据程序与 `scripts/` 操作工具，仍检查全部被应用导入的代码；工具用自身定向执行验证。保留填空／匹配／排序题插回原生题目序列的类型，旧 Office 转换的来源审计也保留显式类型。

## 剩余交付顺序

1. **v1.3.0 持久化升级与恢复整包**：停写后复制旧实例数据，在独立副本实施 Native 资产池及新增 provider tuple 的版本化迁移；保留旧 deployment/generation 版本与来源，按新 schema 生成独立 profile/receipt，再完成备份恢复和可核对的切换。现有 `--upgrade-local` 不承诺此升级能力。
2. **PG18／阿里云 RDS 正式交付**：构建本版 PG18 独立参考；核对 RDS 权限、TLS、独立数据库／运行角色及完整宿主生命周期，在明确授权后安装／迁移／启动。旧 PG18 GitHub run 不作为本版验收；不自动 dispatch。
3. **受外部输入限制的能力**：旧可信 Native 维护链仍等待受审路径／公钥 pin／签名；本轮不重发真实模型、解析和媒体生成请求，历史服务成功只保留原来源范围。上述缺输入不阻塞普通知识库与备课发布功能。

下一包建议 GPT-6.1 Sol / high，原因是跨版本持久化、Identity 绑定与恢复边界；本轮常规上游复用部分按 medium 即可。

2026-10-29 后续：[持久化副本与 PG18／RDS 接续](zhiban-v2-openmaic-130-persistence.md)记录已完成的本地副本迁移／恢复及本版 PG18 新参考和旅程；上文“本机只有 PG16／PG18 待构建”保留首轮时点含义，RDS 正式安装／加载和真实切换仍未签收。
