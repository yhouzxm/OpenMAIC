# OpenMAIC 1.2.0 全量升级

2026-10-17，LOCAL 升级候选已完成，默认 3461 已启动并通过统一教学旅程。用户要求先完成全量升级，再按新版实际能力调整智伴功能设计。沿用原 P1–P7 主线，暂停新增产品功能；不把全量源码同步等同于新版功能已获智伴授权或真实 AI 已接入。

固定官方 `THU-MAIC/OpenMAIC` tag `v1.2.0`，SHA `a9da60b3b4adb429369c0da13d5637a904ead2b0`。分支 `refactor/zhiban-v2`、HEAD `daf63afa83470d24a9ed41d171c6a17f8a80adb6` 保持；升级前 176 项 dirty 状态全部保全，工作区快照位于 `/home/zxm/.local/state/zhiban-upgrades/openmaic-120-20261017-215211/workspace.tar.gz`，该目录权限 0700，包含恢复 patch／状态／同步清单，不提交到仓库。

已从官方固定 Git 对象同步 1,335 个变化路径，涵盖原生页面、服务端生成／身份／配置／持久化以及六个公共包。官方源文件逐字节核对；保留的智伴定制为两份 CI workflow、docs ignore、README 入口、Identity middleware gate、业务脚本和依赖增量。另对三份上游测试做宿主兼容：Authorization 扫描仅放行智伴原有的精确拒绝语句并验证实际拒绝行为；模型配置的两份测试固定公共 DNS fixture，并保留 fake-IP 私网拒绝用例。六个 SDK 源码均与官方 pin 完全相同。两份 workflow 保留现有本地项目配置，本轮不调度 CI。pnpm lock 保留官方解析，仅追加智伴使用的 Argon2 2.2.1 与 UUID 14.0.2 包记录；没有整体漂移到新的依赖解析。

六包目标：DSL 0.11.3、Storage 0.37.3、Generation 0.3.20、Renderer 0.1.14、Editor 0.0.11、Importer 0.3.1；根版本 1.2.0，Node 22.23.3 / pnpm 10.28.0。DSL 序列化协议仍是 0.3.0，不能把 npm 包版本当成文档协议版本。

兼容改动集中在基础适配：

- 追加 `0014_openmaic_120_versions.sql`，原 0001–0013 不改。保留旧 provider tuple，新 tuple 精确绑定官方 SHA；generation 的 DSL 包版本通过外键绑定其 deployment，拒绝混用。
- Native 文档使用明确的 `public.zhiban_document_ownership`，Opaque owner 不与 UserId 混用；新增文档同事务 claim，旧数据可从旧 `owner_id` 回填，缺失／冲突归属拒绝。保留旧列，不能据此承诺原地回滚新产生的数据。
- Runtime 仅有归属表 SELECT／INSERT 与惰性锁字段 UPDATE；owner／stage 键、删除和 schema ledger 写权限不开放。业务 Session／Tenant／Membership／Enrollment 和提交前撤权屏障继续执行。
- 公开版本化 migration runner 由一条独立 session 运行，避免嵌套事务。新安装失败不签 receipt，连接始终销毁以释放守锁和提权状态；部分 DDL 可能留下，必须由受控维护处置，不能自动签收或覆盖非空库。
- 新版 profile／receipt 单独命名并绑定来源、源码／构建、版本、实际 catalog／ACL；旧 receipt、Storage／Identity 历史 CI 只保留原范围，不能重标为 1.2.0。

验证出口：`pnpm verify:zhiban:upgrade` 创建自己的 socket-only PG16，演练精确旧 DDL 与留存文档，并在独立数据库运行官方 Storage PG 合同；`pnpm verify:zhiban:trial` 验证统一三角色流程。暂未完成的验证不计 PASS；运行记录绑定源码 hash。

真实数据库／真实 Native 维护交付不在本地升级验收范围；没有读取或提交其凭据，没有应用新迁移到 55432／55433。UNKNOWN／RESERVED 终态处置、维护 broker／独立 ACK、可信 Runtime／AI、原生刷新／关闭人工验收等既有 deferred gates 不因代码升级解除。后续真实数据升级需要停写、备份、受控归属回填与新 receipt；不自动运行 fresh-only installer。

完成后的下一步是依据 1.2.0 真实能力一次性调整保留范围与 P1–P7 交付顺序：复用已存在或更好的上游能力，只补业务差额。当前不新增第二套播放器、生成引擎或功能分支。

## 本地验收结果与证据边界

- `pnpm install --frozen-lockfile --ignore-scripts` 和完整 `pnpm build:packages` 成功；默认 `pnpm build`（Turbopack）编译、TypeScript、页面输出成功。构建显式使用不可连接的测试 DATABASE_URL，未访问真实数据库；它是整站构建证明，实际 PG 启动由 owned 环境另外证明。
- 全仓 `tsc --noEmit` 成功；随后三份宿主兼容测试的类型复验和 ESLint 成功。新增 installer／ledger／来源核验文件的严格 ESLint 成功。较早遗留文件仍有显式 `any` lint 债务，未声明全仓 ESLint 零错误；诊断脚本 `verify-unified-trial.ts` 另有一处 Prettier 链式换行警告，保留已验证源文件及运行候选，不冒称全仓格式零警告。
- DSL 275、Generation 226、Renderer 138、Editor 607、Importer 275 项包测试通过，共 1,521 项。Storage 独立 PG16 合同 7 文件／226 项通过；此数字不代替旧版完整 Identity PG16 或旧 CI 的统计口径。
- 旧版精确 Document DDL／数据保留、归属回填与 ACL、账本 ahead／checksum 拒绝、新版 Runtime fresh installer／只读 receipt／非空拒绝共 5 组 owned PG16 检查通过；cluster 已清理。来源见 `evidence/zhiban-openmaic-120-upgrade-pg16-local.json`。
- 业务 SQL 55 项通过，含旧迁移保持、1.2.0 package tuple 和 generation/deployment DSL 绑定反例；见 `evidence/m5-sm01-fix-openmaic-120-local.json`。新版 text／PNG profile 与历史文件分开，PNG 23 组 PG16／HTTPS／浏览器检查通过并清理 cluster，见 `evidence/m5-c-png-openmaic-120-local.json`。
- 智伴定向回归 214 项通过，33 项对应未启用的 provider fixture 跳过。原生身份／配置／生成入口首轮 104 文件通过、3 文件失败、2 文件跳过；三项失败已通过上述宿主测试兼容修订，独立复验 3 文件／55 项通过。合并范围为 107 个通过文件、2 个跳过文件／1,283 个通过用例、85 个跳过用例，不冒充另一次全套重跑。
- 3461 统一旅程 11 组通过：三角色登录与教务、文本／PNG 编排发布、学习中心、课堂 Attempt、真实 ClamAV TXT 提交及精确下载、人工 92/100 发布／学生回看、CSV 与权限拒绝、单元导航、390px 布局。当前 `trial:zhiban:info` 为 RUNNING_LOCAL_DISPOSABLE、sourceMatches=true、漂移 0。账号只在 `pnpm trial:zhiban:info` 指向的私有文件内，聊天与公共证据不包含密码。

已知边界保持可见：默认构建有 44 项上游静态警告；额外 `--webpack` 构建在 Edge instrumentation 的 Node 依赖解析失败，未作为本轮支持模式签收。未修改上游主程序来压掉警告。模型配置测试曾受本机 DNS fake-IP 影响，`api.openai.com` 实测解析为 `198.18.0.9`，生产 SSRF 拒绝是正确行为；真实模型配置／调用仍未验收，未打开 ALLOW_LOCAL_NETWORKS。

观察项 UPG-OBS-01：一次与 SDK 回归并行的统一旅程中，评分已保存，发布前页面进入“结果待确认”，未观察到发布 POST；只读查证没有新的发布记录。隔离复验全部通过，新加网络轨迹记录了保存／发布均完成且无失败请求。未确定偶发根因、未声明根因修复，也未加大生产超时或改动 Assessment 规则；后续若复现，应沿原命令号重试并保存 CSRF／请求轨迹，不以新命令号掩盖未知结果。

结论仅是 **1.2.0 源码／依赖／适配与本地候选通过**。CI 未触发，两份既有 CI 配置／历史 diagnostic pin 保留原范围；若未来主动恢复 CI signoff，先单独对齐新版本契约，不将旧 run 当成当前升级证明。真实库迁移、真实 Native 维护输入、Runtime／AI 启用及其他 deferred gates 没有解除。

最终快照与证据索引见 `evidence/zhiban-openmaic-120-closeout-local.json`。下一阶段功能调整已回填原 `zhiban-v2-migration-completion-plan.md`，继续 P1–P7，不另起移植计划。
