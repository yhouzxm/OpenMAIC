# M4 人工评分、成绩发布与更正

STATUS: LOCAL_VERIFIED / UNCOMMITTED_CANDIDATE

2026-10-08；分支 `refactor/zhiban-v2`，基线 HEAD `daf63afa83470d24a9ed41d171c6a17f8a80adb6`。在现有 M1–M3 候选之上新增，未提交、推送或派发 CI。

## 可用旅程

在本地教学班打开“学习活动与提交”，任教教师对具体提交填写满分、得分和反馈，保存评分草稿后显式发布。发布后修改使用“发布更正”，必须填写学生可见的公开说明。学生只看到本人已发布成绩；每个成绩都显示活动、尝试、提交版本、成绩版本和时间，更正前成绩与该提交当前成绩分别标明。

分数以字符串接收，最多两位小数，按整数百分之一分存储；满分必须明确填写，范围 `0.01–1000.00`，得分范围 `0–满分`。该范围是本轮录入边界，不是课程权重、及格或通过规则。反馈最多 2000 字符，更正说明最多 1000 字符且不可空白。未决定课程总评、完成状态、学分、申诉流程或自动评分规则，均不启用。

评分绑定不可变 Submission；首次评分与发布须针对该 Attempt 的最新提交。学生重交不继承旧成绩，旧成绩继续显示历史提交标记；旧的未发布评分不能在重交后发布。已经发布的历史提交可以通过明确更正修复，不能冒充新提交成绩。已关闭教学班仍允许任教教师对既有提交评分；已归档课程拒绝访问。当前页面依据 M3 快照列出提交，其他客户端发生重交时服务端拒绝过期操作，教师刷新活动后重试。

## 数据与权限边界

新增 `zhiban_assessment`：`grades` 保存教师评分状态，`publications` 追加不可变发布快照。`0001_assessment.sql` 仅首次应用到独立 LOCAL 开发库；不修改已应用 Identity 0001–0013、Academic 0001 或 Learning 0001。已有生产冻结语义保持原合同。

两表 FORCE RLS，tenant policy 与复合外键绑定同租户、同提交。运行角色仅可更新 grade 的明确列，不能更新或删除 publication，不能 DDL。复用现有 Session、角色 scope、实时 TeachingAssignment/Enrollment、Origin/CSRF、Academic transaction guard 和同事务审计；管理员没有默认评分权。命令幂等重放仍先检查当前资格；CAS、源提交锁和唯一约束防止重复发布与过期修改。审计仅记录稳定来源 ID、命令类型和结果，不复制分数、反馈或更正正文。

API：`GET/POST /api/zhiban/assessment/:tenantId/offerings/:offeringId`，命令为 `SAVE_GRADE`、`PUBLISH_GRADE`、`CORRECT_GRADE`。学生 DTO 不包含评分草稿。新 LOCAL 配置与 receipt 明确标记 `LOCAL_SYNTHETIC_M4`，核对配置、policy、migration hash、ledger、角色权限和实时 RLS/ACL；缺失 receipt 时评分入口保持不可用。

## 本地验收

环境：Node 22、pnpm 10.28.0，独立 PG16 `55433/zhiban_m1_dev`，HTTPS `https://127.0.0.1:3443/zhiban`。没有向 disposable 测试 cluster `55432/zhiban_pg16_test` 增加业务数据或权限。

- `pnpm setup:zhiban:m4`：首次增量建表及再次初始化的不可变 ledger/ACL 检查通过。
- `pnpm verify:zhiban:m4`：21/21，覆盖真实课程/任教/Enrollment/Submission，越权、CSRF、分数校验、草稿隐私、幂等与 CAS、并发发布、留痕更正、重交、任教/选课撤销、其他教学班来源拒绝、RLS/ACL、关闭教学班后继续复核，以及教师/学生真实浏览器流程、刷新、移动布局和未保存输入。
- Assessment、Learning、Academic domain 与 Academic authentication 定向测试：44/44。
- 受影响 M3 回归：26/26。新增评分区显示提交正文，M3 浏览器断言改为定位提交历史区；保留原行为检查。
- 重启后的 M4、M3 精确来源持久化核验均通过；学生 DTO 仍不暴露评分草稿。
- TypeScript typecheck（8 GiB）、变更代码 ESLint、Prettier 和 `git diff --check` 均通过。

私有证据位于 `/home/zxm/.local/share/zhiban-m1/`：`assessment-receipt.json`、`m4-verification.json`、`m4-persistence.json` 和页面截图。验证 receipt 记录实际源码 hash、场景和合成 Offering/Submission/Publication 标识，不保存登录密码。HTTPS API 使用开发 CA；隔离 Playwright 使用本机叶证书 SPKI pin，浏览器证明限定于本地 standalone host。

上述证据仅证明 LOCAL 合成教学闭环及权限拒绝，不是生产部署、真实 V1 数据迁移、完整双租户各自正向业务验收、enabled Bridge/Runtime、AI 或 release signoff。原 C9 和 Storage 的 run/SHA 证据仍保留其历史适用范围；M1–M3 原有 source hash 在新增共享接线后属于历史证据，受影响 M3 回归单独记录。

## 下一工作包

M5 先确认本轮真正启用的内容编辑/资源/Runtime 子集，再按冻结 adapter 与 enabled Bridge security gate 接线并本地验证。真实 AI、付费调用、生产 OPS/DATA、最终 release manifest 与完整高级课堂仍按各自授权/门禁推进。建议普通实现继续使用 GPT-6.1 Sol、medium；涉及冻结合同或并发授权审查时单独提高推理强度。
