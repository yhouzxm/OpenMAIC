# M6 教师统计：首个可用页面

2026-10-15。完成本轮教师统计页面、只读 API 与本地可用演示；M6 的学生分析、目录导入、风险与干预尚未交付。所有证据为 **LOCAL**。分支 `refactor/zhiban-v2`，HEAD `daf63afa83470d24a9ed41d171c6a17f8a80adb6`；已有 M1–M5 未提交候选保留。本轮无提交、推送或 CI dispatch。

## 入口与范围

工作台 → 教学班 → **教师统计**。页面可选择当前发布的文字活动，显示在班名单、开始/提交/未提交人数、已发布成绩人数、待发布成绩人数、平均得分率，以及学生最新尝试、提交时间和已发布成绩。支持姓名/ID 查找、学习状态筛选、刷新和小屏阅读。空教学班、无活动、无成绩均有明确空态。

本轮统计来自实际 M2 Enrollment、M3 Attempt/Submission 和 M4 不可变人工评分发布，不使用模拟统计接口。当前演示的账户与课程为合成数据；业务读写经过正常 Identity/M3/M4 API。

| 口径 | 定义 |
| --- | --- |
| 在班名单 | 本教学班 ACTIVE、valid_from 已生效、valid_until 为空的 Enrollment。此数不证明每个学生 User/Membership/Grant 仍可登录或学习 |
| 可选活动 | 本教学班当前 PUBLISHED 的活动及精确 published_version；草稿/撤课不可选 |
| 最新尝试 | 每名在班学生在所选活动、精确发布版本下 attempt_no 最大的一条 |
| 最新提交 | 最新尝试下 submission version 最大的一条；新尝试或重交不继承旧成绩 |
| 已发布成绩 | 该精确最新 Submission 的最新不可变 publication；更正只贡献一次；评分草稿不计入 |
| 平均得分率 | 各已发布成绩 `score_points / max_points` 的未加权平均百分比，四舍五入到一位小数；无成绩为 null |
| 无所选活动 | 人数和活动数仍有意义；活动相关指标为 null，页面显示 — |

人工成绩整数存储单位沿用 M4 **百分之一分**，页面除以 100 显示。平均得分率不定义总评、权重、及格、学分、完成或风险。查看内容/PNG 不计学习完成。

## 权限、实现与边界

新增 GET `/api/zhiban/analytics/:tenant/offerings/:offering`；可带且必须同时带 `activityId`、规范正整数 `version`。缺省选择最近一次发布的当前活动。重复/未知参数拒绝；不再当前发布、外班或旧版本选择统一 409。非 GET 拒绝。

复用 AcademicStore 的当前 Session、Membership/Grant 锁和 Learning 的教师 + 当前任教关系屏障。学生、仅管理员、非任教教师、跨租户拒绝。业务读取保持 FORCE RLS，不新增 Identity 原始数据权限，也不增加 migration/SQL helper/ACL/receipt。读取不写审计或业务事件。

授权关系锁定后，活动、Enrollment、最新尝试/提交和成绩在**一条 SQL**的同一 MVCC snapshot 中查询。DTO 不包含答案、草稿、反馈、Native 引用或凭据；`asOf` 是本次授权核验时点，并非历史查询 API。名单最多 1000、当前发布活动最多 500；超限返回 UNAVAILABLE，不悄悄截断分母。现有连接/SQL/请求并发预算保持。

常规 launcher 已接静态页面和 API，但仅在既有 Learning 与 Assessment receipt 均通过时启用统计 handler。**未运行现有 55433 launcher**；本轮演示是独立配置、独立数据库的 disposable HTTPS host。现有维护输入“保留待补”与隔离状态不变；无 Native/Runtime/AI 启用。

## 本地验证与复现

```bash
pnpm verify:zhiban:m6
pnpm verify:zhiban:m6 --serve
```

独立 PG16 port 56501，owner-only mkdtemp/Unix socket，TCP 无监听且 host auth reject；独立数据库 `zhiban_m6_disposable`。HTTPS `https://127.0.0.1:3445/zhiban` 使用现有受信开发证书，并核验 receipt/CA hash，浏览器不绕过证书检查。不会操作 55432/55433。账户密码仅写到本次私有 accounts.json；路径由启动输出与演示 metadata 提供。

首轮停机验证 [LOCAL 记录](evidence/m6-teacher-analytics-local.json) **18/18**：真实登录、空态、草稿排除、不同满分平均、更正、重交、新尝试、历史/未来名单排除、活动切换、角色/租户拒绝、非法输入、无新增 Identity 权限、受信 HTTPS 浏览器旅程、小屏、再发布/撤课、任教并发撤权、logout。该次 PG 已停止并移除；其 hash 保留该次来源，随后页面文案/返回缓存恢复与验证器类型整理不回填旧证据。

当前候选的演示验证及来源 hash 见 [演示记录](evidence/m6-teacher-analytics-demo-local.json) 的 `validation` 和 `sourceHashes`；仅在实际验证通过并发布演示后生成。演示生命周期 RUNNING_DISPOSABLE 不冒充已清理：Ctrl-C/SIGTERM 在待机阶段结束演示，停止本次 PG 后删除本次临时根；停止后的最终生命周期另记 `m6-teacher-analytics-demo-close-local.json`，不以先前 RUNNING metadata 断言进程仍活跃；异常失败根保留查证。执行产物目录 `.zhiban-analytics-run-*` 仅为在运行 child 的构建产物，不属于 checkpoint 候选。

[教师页面截图](evidence/m6-teacher-analytics-local.png) 来自真实浏览器；[内置浏览器截图](evidence/m6-teacher-analytics-iab-local.png) 已在当前演示上完成正常教师登录 → 工作台 → 统计入口验证，无证书绕过。相关单元回归 **46/46**；新增与受影响 TypeScript 入口的定向 tsc、定向 ESLint 通过，不宣称全仓 build/typecheck 或 CI signoff。

本地证据不替代生产 release 门禁、旧 M5 证据的原来源绑定或真实维护接线。新增 store/server 工作不回填旧 PNG source hash。

## 下一步

产品主线建议接 **M6 学生个人概览**：只显示本人提交和已发布成绩，复用本轮明确统计口径。建议 GPT-6.1 Sol / medium；维度画像、风险推断和自动干预仍待业务规则与实际需求明确，不成为本页面的前置条件。
