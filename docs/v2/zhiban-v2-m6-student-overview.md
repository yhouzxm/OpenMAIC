# M6 学生个人概览

2026-10-15，分支 `refactor/zhiban-v2`，HEAD `daf63afa83470d24a9ed41d171c6a17f8a80adb6`。本轮是 M6 的学生个人查询页面；已有 M1–M6 候选保留，无 commit/push/CI dispatch。

## 产品入口与口径

学生工作台 → 教学班 → **我的学习概览**。按教学班展示本人当前发布活动、开始/提交/未提交、已发布成绩、待发布成绩、平均得分率，并支持按活动状态筛选、查看公开教师反馈/更正说明、展开本人尝试记录，以及返回工作台继续学习。

当前汇总沿用[教师统计](zhiban-v2-m6-teacher-analytics.md)的精确版本口径：每项当前 PUBLISHED 活动仅计算匹配其 published_version 的本人最新 attempt_no 和该尝试的最新 Submission。仅最新不可变评分 publication 计入成绩，更正只贡献一次；重交和新尝试不借用旧提交/尝试的成绩。平均值是当前已评分活动得分率的未加权平均，空值为 null；人工成绩整数沿用 M4 的百分之一分，显示时除以 100。

历史区显示本教学班本人全部尝试（含当前、旧发布版本和已撤下活动），每次尝试仅展示其最新提交及其最新已发布评分。旧提交及旧更正版本的完整归档仍由既有 M3/M4 查询承担。本页不定义课程总评、及格、完成、学分、风险或画像。

当前无活动、尚未尝试、无已发布成绩和筛选无匹配均有真实空态。`asOf` 为授权核验时间，不是历史时点查询 API。当前活动与本人历史尝试各最多 500，超限整体 UNAVAILABLE，不截断后计算错误汇总。

## 数据与权限

- GET `/api/zhiban/progress/:tenant/offerings/:offering`，无 query 参数、无写入方法、无可供请求指定的 learner/member ID。
- AcademicStore 复用当前 Session/Membership/Grant；显式 `LearningPgTransaction.access(..., 'STUDENT')` 要求当前 STUDENT grant 与本教学班已生效 ACTIVE Enrollment，并锁定关系。教师/仅管理员身份不会因此获得学生个人数据；合法兼任学生仍须本人 Enrollment。
- 一条 SQL 的同一 MVCC snapshot 读取当前活动、本人尝试、最新提交和不可变评分发布。每个尝试始终受 server-derived tenant/offering/membership 三元组约束。
- 无答案、学习草稿、评分草稿、同学名单/分数、Native 私有引用或凭据。已发布 feedback/reason 是该学生本来可查看的 M4 公开字段；页面使用 textContent，并保留文本换行。
- 无新 migration/helper/ACL/receipt，无新增 Identity 原始表权限，无审计或业务事件写入。常规 launcher 仅在既有 Learning 与 Assessment receipt 均通过后接通 handler。
- 退班或 Enrollment 未生效拒绝读取；授权期间持共享关系锁，撤权等待本次读取结束，后续请求拒绝。刷新失败、会话广播、离开页面均清除旧数据；浏览器返回缓存通过重新加载核验身份。

## 本地体验与验证范围

```bash
pnpm verify:zhiban:m6:student
pnpm verify:zhiban:m6:student --serve
```

独立 PG16 56502 / `zhiban_m6_student_disposable`，owner-only mkdtemp/Unix socket、无 TCP 监听且 host auth reject；HTTPS `https://127.0.0.1:3446/zhiban`。使用现有受信任开发证书并核验其 receipt/CA hash，浏览器不绕过证书校验。独立创建的合成身份、课程、提交与成绩，经过真实 Identity/M3/M4 API，非模拟统计接口。

不启动、连接或修改 55432/55433，不操作 Native/维护 control/HBA/认证 staging，也不解开用户“保留待补”的隔离。普通 launcher 的接线通过定向类型检查/代码核验，本轮实际运行的是独立 disposable HTTPS host，不宣称既有开发库已经启用新页面。

验证包含空态、未发布活动/评分排除、公开更正反馈、同班两学生互不可见、重交/新尝试、不同满分平均、教师统计回归、角色/跨租户/外班/请求伪造拒绝、真实浏览器入口/筛选/历史/小屏、活动撤下/再发布、退班并发屏障及页面清空、未来 Enrollment 与 logout。

运行证据与精确来源见 [演示验证 metadata](evidence/m6-student-overview-demo-local.json) 的 validation/sourceHashes。独立停机验证使用 `m6-student-overview-local.json`，只有实际执行非 serve 验证后才生成；没有该文件不等于已验证过停机路径。演示为 RUNNING_DISPOSABLE，待机阶段 Ctrl-C/SIGTERM 后停止本次 PG 再清理本次根；最终生命周期记入 `m6-student-overview-demo-close-local.json`。失败根保留查证。运行产物 `.zhiban-personal-run-*` 不属于 checkpoint 候选。

当前候选真实 PG16/HTTPS 验证 **16/16 PASS**。[内置浏览器截图](evidence/m6-student-overview-iab-local.png) 已核验正常学生登录 → 教学班 → 我的学习概览，无证书警告；[浏览器流程截图](evidence/m6-student-overview-local.png) 覆盖筛选与历史成绩。

相关本地单元回归 48/48，定向 tsc 与 ESLint 通过，不宣称全仓 build 或生产/CI signoff。旧教师/PNG 证据保留各自来源；本轮共享 store/launcher 增量不回填旧 hash。

## 后续产品包

建议下一步先做 **M6 管理员受控名册批量导入的最小闭环**：预览、逐行校验与明确提交结果。账户开通与 Enrollment 写入继续复用已有授权规则，不从 CSV 接受角色/权限指令。建议模型 GPT-6.1 Sol / medium；本轮不自动推进该工作包。
