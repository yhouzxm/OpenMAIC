# 智伴 V2 完整教学演示（LOCAL）

2026-10-16（Asia/Shanghai）。本记录接续统一本地试用实例，覆盖管理员教务入口、学生作答、教师人工评分发布、学生个人概览和教师统计。仅使用合成账户及 disposable PG16。分支 `refactor/zhiban-v2`，工作树基线 `daf63afa83470d24a9ed41d171c6a17f8a80adb6`；本记录不代表该 SHA 包含所有当前试用源码。

## 试用范围

三角色在同一个租户和教学班操作：管理员查看教学班、分页名单、学生目录、关系及只读历史；教师查看任教班名单、活动／提交、待评分队列、教师统计，执行人工评分、发布和更正；学生访问本人当前课程，开始尝试、保存草稿、提交，并查看自己的已发布成绩和反馈。教学数据为合成数据，提交和成绩不被解释成课程总评。

本轮完整主流程使用已有 TRY_01（4/20）及陈同学账号：学生提交“试用：安全巡检报告”第 1 次尝试的提交 v1；教师在“待评分与成绩”查看原文，保存评分草稿，再发布 92/100 与反馈；学生个人概览显示成绩、反馈及汇总变化；教师统计切换到该发布活动后显示 4 名在班学生、1 份已发布成绩、92% 平均得分率。管理员工作台和四人名册入口随后核对。页面截图及 SHA256 记录在[演示证据](evidence/zhiban-trial-full-demo-local.json)。

同一实例已有管理员 CSV／目录名册导入、移出／恢复、转班、满员拒绝，以及名单变更后教师／学生访问与历史作答的单独手工记录，见[名册试用](zhiban-v2-trial-roster-uat.md)和[访问／历史核对](zhiban-v2-trial-access-history-uat.md)。本轮没有重放这些管理写操作。

## 已知限制

- 运行实例仍是较早启动的 3459 服务；`pnpm trial:zhiban:info` 报告 `sourceMatches: false`、`sourceDriftCount: 3`。漂移文件为 `app/zhiban/local/management.js`、`scripts/zhiban-local/verify-m6-catalog.mts`、`scripts/zhiban-local/run-m6-catalog.ts`。管理静态文件按请求读取并有单独响应 hash 证明；不声称当前工作树已完整重建进运行 bundle。
- `pnpm trial:zhiban:stop` 会删除当前 disposable PG、随机账户及所有本轮和既有试用动作；重启是全新合成数据。当前实例不应与真实 PG 55432／55433 混淆。
- M5 编辑器／资源和 PNG／Runtime 未接入统一试用，相关入口/API 保持 CLOSED。真实 Native／维护输入、receipt／完整启用签收仍“保留待补”。AI、交互 Runtime、附件提交、通知、画像／风险、真实身份入驻及真实数据迁移不在试用范围。
- 本轮为同一空间、按角色顺序登录的手工演示，不覆盖全部 API 负向、并发竞争、打开标签内的即时撤权延迟、生产容量或真实教学运营。没有运行自动化套件、完整 PG 回归或 GitHub Actions；旧 CI 证据仅适用于各自记录的 SHA／门禁。

该实例本轮新产生 1 次学生尝试、1 个提交 v1、1 条评分草稿及 1 次正式评分发布；既有成绩和审核历史均未重置。本地证据标记 `LOCAL`，不伪造 `GITHUB_ACTIONS`。NO COMMIT / NO PUSH / NO CI DISPATCH。

下一步建议：由用户在当前浏览器继续实际课堂试讲，收集单点问题；若试用结束且无需保留数据，执行 `pnpm trial:zhiban:stop`。常规产品修复建议 GPT-6 Sol / medium；如只整理说明文档，GPT-6 Luna / medium。
