# v1.3.0 CI 接续修复（2026-10-31）

父 checkpoint：`5a282652dfe0efb4fd94a71f42caf060a020999f`。原 CI run 41186575260、Storage run 41186578501 均未通过；不能作为本版本 signoff。

## 本次修复与复验范围

- E2E 配置独立 PG16 service、健康检查与仅限 job 的合成 DATABASE_URL；不加载本机或生产凭据。生产构建及页面测试分别保留。
- 测验、视频与名册查询测试夹具遵循 v1.3.0 类型，修正答案数组、autoplay 及查询字典。
- 根 TypeScript 不将归档证据和冻结维护候选作为应用入口；显式导入的依赖仍由 TypeScript 检查，其独立历史验证合同不变。
- CommonJS 工具允许标准 require；生成输出不重复按源码格式检查。业务与工具格式修复不改变冻结 SQL／migration。
- `pnpm lint` 保留严格结果。`pnpm lint:ci` 是显式历史债务增量门禁，并非严格 lint 全绿：逐文件、规则、错误消息、源码行指纹及出现次数绑定基线；新增、修改后的未批准错误、解析错误及安全边界规则仍失败。当前基线共252条（247条 explicit-any、4条 TS CommonJS适配、1条冻结候选 const）。基线只保留既有类型适配／CommonJS／冻结候选 const 债务，不能自动更新。后续逐包消除，不作为已修复统计。
- 旧隔离诊断升级到官方 v1.3.0 SHA `c0f296aa36096ec3d1e1e2b94a7a48e20075e0a1`，显式声明已存在的 13 文件 Quiz 子路径差额；来源名称不冒称 byte-identical upstream。文件集合、各文件 SHA256、工作区无改动／无额外包源文件均须匹配。仍从 checkpoint archive 独立安装、构建，并记录源 SHA／lock／平台与差额。
- 新增 `checks-recheck` 和 `diagnostics-recheck`，仅复验失败范围，不重跑已通过的 Storage 数据库合同或主镜像；不是 full signoff。PG16隔离数据库、ACL、撤权与清理边界继续由原诊断执行器检查。

## 验证与边界

LOCAL：4 GiB Node堆下根 TypeScript检查通过。受影响四文件 29 项通过，1 项依赖独立 fresh provenance 的用例未在普通根测试启动；来源 pin 的篡改、缺失、额外文件及旧来源拒绝通过。实际云端状态以本次修复提交对应的 Actions run 为准，旧 run 的通过部分不扩展到本次源码。

不连接真实 ECS／RDS，不触发 PG18 受保护验收，不解除旧 Native 维护隔离。本轮只授权修复与定向复验，不能据此声明生产安装／恢复签收。历史 lint 债务及真实云部署继续单列。

首轮修复复验 Storage run 41190062865 已通过来源 pin 与 DSL 构建，但 generation 因新依赖 geometry 尚未构建失败；补齐构建顺序后另行定向复验，不称该轮通过。

## 2026-11-05 接续

41190059679：lint增量门禁（252条历史债务）、TypeScript、i18n均通过，格式仅 editor Quiz 入口一处失败；E2E 真实PG启动与144项通过，2项Quiz编辑旅程因复用后缺少surface标识及添加菜单失败。41190297568：隔离新依赖构建通过，PG夹具初始化失败。上述失败均保留原结论。

修复：Quiz宿主恢复surface标识及原生校验提示；共用Quiz编辑器恢复国际化添加菜单，保持生成／编辑／播放复用。更新该文件来源hash。PG夹具按v1.3 runner自管事务调用，并创建独立host ownership关系（外键级联、原子claim），不关闭owner隔离。初始化失败只报告阶段与异常类别。

LOCAL独立PG16临时cluster验证25项全部通过并清理；Quiz提示及artifact定向测试15项通过（fresh provenance用例仅在隔离云诊断执行），来源／lint门禁反向检查通过。定向E2E复验仅Quiz编辑发布回放和课堂持久化，不重跑已通过的其他页面。所有结果限相应源码及环境。

42027541050／42027540439的浏览器准备被新的 ubuntu-latest（26.04）阻塞，锁定的Playwright 1.58.2不支持该OS；浏览器相关job改固定ubuntu-24.04，保持依赖锁不变。该轮浏览器／诊断不计通过。

42028078616已完成两轮B0各101项unit/PG＋1项browser，B9中12项通过，仅N02查询旧document_stages.owner_id（v1.3已移出）失败。权限断言改为宿主zhiban_document_ownership.owner_id仍不可UPDATE；无ACL放宽。后续只运行bridge-recheck验证Native及Runtime，B0／浏览器成功范围保留该轮原SHA。

42028076341代码检查全通过，定向E2E四项通过，Quiz回放一项因旧button定位与新版radio／checkbox语义不符失败；保留播放器无障碍语义，更新测试并验证aria选中状态。增加browser-recheck仅复验页面旅程，不重复代码门禁及Native诊断。

42029125831两轮B9 Native均11/11通过。C9首例旧式部分失败断言要求无schema，但v1.3独立迁移已提交账本及两张runtime表，阻断后续正常安装；改用独立job-owned partial数据库，断言残留三表、无运行权限、重试拒绝及finally清理，正常安装仍使用原全新空库。精确catalog增加原生migration ledger。后续runtime-recheck只补C9两轮。
