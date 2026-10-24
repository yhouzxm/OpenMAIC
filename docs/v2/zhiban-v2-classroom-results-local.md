# P4 课堂结果汇总与学生历史入口

本轮沿原 P4 接续联合课堂；复用 Classroom 的不可变进入审计、原 Learning Attempt／Submission 与 Assessment 已发布成绩，不新增学习完成事实，不新增 migration、helper、ACL 或维护签发。

## 产品范围

- 教师课程工作区“课堂”下增加结果汇总，每页 20 次派发，包括已结束、已被后续派发替换的任务。按进入者统计人数；每人的该次 Attempt 只取最新提交，该提交只取最新成绩发布版本。更正不增加人数，重交后不会把上一提交的成绩冒充当前成绩。未进入者不纳入分母，因此不称全班完成率。
- 学生课程“课堂与作答”下增加“我的课堂历史”，只投影本人已进入的任务，含结束／改期后不可进入的任务。原版本、提交状态、已发布分数及原 Attempt 回看入口保留；历史回看不调用 ENTER_TASK，也不创建尝试。
- 讲义进入仅保留记录，不以进入推断完成。历史接口不返回讲义正文、互动 HTML、其他学生数据、作答内容或评分草稿；撤回／换版的播放权限不放宽。作答修改、重交、测验答案审阅继续服从原活动规则，课堂结束本身不新增作答截止规则。
- 当前任教／Enrollment、Identity 及租户授权继续走原守卫；不向管理员扩大教学数据权限。失去当前资格的旧成员不能通过本入口绕过限制。

## API 与边界

`GET /api/zhiban/learning/:tenant/offerings/:offering/classroom-results?page=0`

页码为 0–9999 的规范十进制，每页 20，返回 `mode/page/hasMore/rows`；未知、重复参数和 POST 均拒绝。分页按派发时间、ID 倒序，每次请求为一条 SQL 快照；不同翻页请求不是冻结导出快照，期间有新派发时可刷新回第一页。本接口不接受他人成员 ID。教师只得汇总，学生只得本人条目。

Attempt 从首次成功 `CLASSROOM_ENTER_TASK` 服务审计中的精确 ID 解析，再校验租户、课程班、活动版本及本人；不得按活动任意选择最近 Attempt。联合任务同样复用其原子进入时保存的原审计事实。

## 本地验证与证据

运行 `pnpm verify:zhiban:classroom-results`，仅执行本包定向旅程及必要 fixture，不重复原 Native 故障、完整课堂或 GitHub CI。证据：

- [旅程](evidence/classroom-results/journey.json)、[运行日志](evidence/classroom-results/directed.log)、[组合 receipt](evidence/zhiban-classroom-results-local.json)。
- [教师页面](evidence/classroom-results/teacher.png)、[学生回看](evidence/classroom-results/student.png)。
- [类型检查](evidence/classroom-results/typecheck.log)、[ESLint](evidence/classroom-results/lint.log)。
- [替换前本地备份](evidence/classroom-results/before-backup.json)：三库归档及 TOC 检查，未验证恢复；不能声称旧数据已恢复到新默认实例。

真实受限 PG16／HTTPS／Identity 命令覆盖：双学生进入、未提交、评分草稿不可见、发布、更正、重交后清除旧分数、结束后回看、22 次派发分页、角色／跨租户／闭合参数拒绝、浏览器回看不增加 Attempt。

所有新增证据标记 LOCAL，`githubActions=false`。完整 Native Runtime、可信完成率／互动得分、VirtualLab 仍按原门禁保留；本轮结果页只展示已有正式提交与已发布人工成绩，不扩大旧 CI 或 provider receipt 的适用范围。

## 默认入口交接

3461 已启动本轮候选，`sourceMatches=true`。教师课程 → 课堂与互动 → 课堂结果汇总；学生课程 → 课堂作答 → 我的课堂历史。新实例中的“已结束课堂：结果回看演示”通过真实本地命令形成一次提交和 92/100 发布成绩；另保留可进入的联合课堂。均为显式演示数据，不代表真实教学结果，未发起模型请求。

[默认演示定位](evidence/classroom-results/default-demo.json)、[实际入口核对](evidence/classroom-results/default-info.log)、[内置浏览器页面](evidence/classroom-results/default-browser.png)、[当前三库备份](evidence/classroom-results/default-backup.json)、[收尾](evidence/classroom-results/closeout.json)。两次备份均只检查归档及 TOC，未验证恢复。

本包定向 PG16／师生浏览器旅程、项目类型检查与增量 ESLint 均通过；最终 receipt 的持久源漂移为 0，三个缺失路径是按流程清理的临时 bundle／控制输入。154 个冻结 Identity／migration／SQL 候选源与上一包证据一致。没有提交、推送或 CI。

下一完整产品建议沿原 P5 接教师待跟进名单，以未交作业等现有事实为依据；概念诊断、风险画像及可信完成率不由本轮推导。常规接线建议 GPT-6.1 Sol / medium。
