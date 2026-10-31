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

LOCAL：受影响四文件 29 项通过，1 项依赖独立 fresh provenance 的用例未在普通根测试启动；来源 pin 的篡改、缺失、额外文件及旧来源拒绝通过。实际云端状态以本次修复提交对应的 Actions run 为准，旧 run 的通过部分不扩展到本次源码。

不连接真实 ECS／RDS，不触发 PG18 受保护验收，不解除旧 Native 维护隔离。本轮只授权修复与定向复验，不能据此声明生产安装／恢复签收。历史 lint 债务及真实云部署继续单列。
