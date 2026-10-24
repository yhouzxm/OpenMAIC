# OpenMAIC v1.2.1 本地升级

2026-10-20，按用户要求先更新上游，再继续原 P1–P7 差额。官方来源为 [v1.2.1 release](https://github.com/THU-MAIC/OpenMAIC/releases/tag/v1.2.1)，固定 SHA `e19d0d4f45d81b8f7ab599b33ab03b0b8b68d5c0`，前版为 `a9da60b3b4adb429369c0da13d5637a904ead2b0`。当前工作分支与 HEAD 保持不变，没有提交、推送或 CI 调度。

## 代码变化与保全

合入官方两版本之间的 249 个路径变化（按不折叠重命名统计），包含网页读取／搜索、模型配置与目录、课堂 Pi 聊天、语言初始化、生成器修复和依赖 lock。根版本 1.2.1；Generation 0.3.21。现有智伴业务、Session／任教授权、课程发布与测验扩展保留。六处已有定制经三方合并保留：CI workflow、两份 README、根 package／lock、模型设置路由测试。未修改上游主程序以绕过权限。整站类型检查另发现既有 SVG 导出解析器的循环推断问题；仅为上一锚点和圆弧转换结果补显式类型标注，计算逻辑不变，并单独运行其原有用例。

升级前文件快照为 `/home/zxm/.local/state/zhiban-upgrades/openmaic-121-20261020-201101/workspace.tar.gz`；该私有目录还包含原状态与逐路径合并清单。备份覆盖 Git 跟踪及未忽略文件，不是数据库、忽略文件或生产恢复备份。

Storage 0.37.3、DSL 0.11.3、Renderer 0.1.14、Editor 和 Importer 本次未变；相关 Provider tuple、测验算法 source pin 与旧 receipt 保留原来源，不把旧证据重签为 1.2.1。本次完整上游文件核对改用 1.2.1 固定 SHA，测验扩展仍逐项校验独立 hash。已应用 migrations 与冻结 Identity 策略不改，真实 55432／55433 未访问，Runtime 与维护 deferred gates 未解除。

## `.env.example` 在哪里

文件已存在于仓库根目录：`/home/zxm/openmaic/zhiban/.env.example`，本次已同步官方 1.2.1 模板。它是点号开头的隐藏文件；Ubuntu 文件管理器可用 Ctrl+H 显示，终端用 `ls -la .env.example` 查看。编辑器是否隐藏取决于其文件过滤设置。

原生 Next 开发入口可以复制 `.env.example` 为 `.env.local`，再按实际需要填配置；已有文件请编辑，不覆盖。模板不是实际密钥文件，不应直接把密码填进 `.env.example`。新版主要模型配置推荐复制 `openmaic.example.yml` 为私有 `openmaic.yml`，通过 `${变量名}` 引用环境密钥，必要时用 `OPENMAIC_CONFIG` 指向其绝对路径。

智伴 `pnpm trial:zhiban` 是专用 LOCAL disposable launcher，数据库由它安装和分配，**不会自动加载 `.env.local`**；模型配置和密钥应由启动进程显式注入。不要将生产 `DATABASE_URL` 注入该试用入口。用户此前确认尚未配置模型；本轮执行中检测到本机 `.env.local` 已存在，未读取或改写其中的值，未检查真实凭据，也未发起模型调用。真实生成依然未执行／未验收。

## 升级兼容边界

- 旧 director-graph 聊天已移除，原生课堂统一使用 Pi。清除旧 `NEXT_PUBLIC_PI_CHAT_ENABLED`；原生课堂模型需支持工具调用。这个更新不等于智伴完整 Runtime／Pi 课程授权已经启用。
- 新增 webFetch 与 Kimi／DeepSeek／Firecrawl 搜索支持；需显式配置供应商和能力槽位，不自动使用密钥或产生模型费用。内置网页读取仍是默认项，原 SSRF 边界保留。
- 上游移除了已退役模型的内置目录条目；未来真实配置应使用供应商实际可用模型，保存的用户自定义 ID 不自动替换。

## 本地验证

本地结果：frozen-lock 安装、Generation 构建、五包固定来源核对、生产 `pnpm build`（含应用 TypeScript）、宿主增量 lint 均通过；配置／搜索／网页读取定向用例与设置 API 复验通过，Generation 场景 16 项和 SVG 解析器 8 项通过。生产构建仍有上游 Edge／动态导入等静态警告（60 项），未声称零警告。全仓含测试／eval 的 TypeScript 未签收，仅应用构建类型检查通过。

最终结果及日志 hash 见 [LOCAL receipt](evidence/zhiban-openmaic-121-upgrade-local.json)。安装使用 frozen lock，构建使用无法连接的测试数据库地址；不会访问真实数据库。检查仅覆盖本次升级和已有智伴接线，不重跑完整课堂、扫描、导出或 GitHub CI。

验证诊断保留：初次全仓 TypeScript 在默认约 2 GiB 堆上耗尽内存；生产构建使用 `tsconfig.build.json`，后续验证进程上限设为 4 GiB，不修改应用内存／超时策略。设置 API 初轮在并行负载下遇到 PGlite 初始化 10 秒 hook 超时，原文件／原超时单独复验 11 项通过；没有据此宣称业务根因修复。未配置的 SearxNG 真实 smoke 按上游条件跳过。首轮通过文件与失败文件复验分别留证，不能冒称完整重跑。

运行状态以 `pnpm trial:zhiban:info` 为准。本轮检测到此前试用进程已停止；旧 receipt 只保留当时范围，不能当成当前 1.2.1 在线证明。下一步仍是配置真实模型并仅验一次“生成→确认→采用→发布→学生查看”，然后继续原 P4 差额；建议 GPT-6.1 Sol / medium。
