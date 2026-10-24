# 基础课堂共享任务 LOCAL 交付

最新接续：[草稿编辑与开放时间调整](zhiban-v2-classroom-edit-local.md)已在独立3463完成；本页3462运行及旧数据描述为历史记录，当前初查其已停止、目录缺失。

2026-10-17。工作树候选已实现，未提交／推送／CI。分支 `refactor/zhiban-v2`，HEAD `daf63afa83470d24a9ed41d171c6a17f8a80adb6`；既有未提交候选保留。[状态／授权设计](zhiban-v2-basic-classroom-design.md)、[完整来源与证据](evidence/zhiban-basic-classroom-local.json)。

## 已完成

- 新增独立 Classroom／Dispatch／参与观察模型与追加 migration，tenant FORCE RLS、列级 UPDATE、ledger／ACL 只读启动核验。沿用真实 Identity、任教和 Enrollment 屏障。
- 教师全局“课堂教学”及课程内入口；创建草稿、发布、可选开放／关闭时间、派发已发布目录中的文本／PNG 或 TEXT_RESPONSE、结束任务／课堂。
- 学生仅见开放课堂，进入／继续、5 秒可见标签同步、正确内容版本与返回上下文；任务面板不会重画作答框。
- 首次进入与 Attempt 同事务绑定，重复 key／新 key 继续均保留同一 Attempt；页面精确查询并自动打开该尝试。新建其他尝试须回普通活动入口，不隐式消耗次数。
- 教师只统计该派发绑定尝试的真实提交／已发布成绩，不混入同活动另一课堂历史。进入、提交和成绩分别显示，不推导完成。
- 严格版本、旧 revision、同 key 异 payload、并发派发、结束／进入、退班／撤任教、时间窗口均有后端屏障。讲义展示继续走原 Content／Bridge／Native 授权和 PNG gateway。

活动入口新增 `classroomTask`／`classroomAttempt` 两个严格验证的导航参数，仅限学生 coursework 与对应 hash；它们不提供权限。Attempts API 的可选精确 ID 过滤仍受原租户、教学班、学生归属约束，并参与 cursor 绑定。讲义页原 query 边界不扩大；可选 publication-version 只增加预览版本前置检查。

## 验证与证据适用范围

35／35 单测通过；`tsconfig.classroom.json` 定向依赖闭包类型检查通过。真实 PG16 `160015` 的定向组覆盖状态、授权、幂等、并发、时间、版本、跨学生精确查询，以及“继续不加次数／跨课堂不串提交”。整仓 tsc 曾触及默认 Node heap 上限，不列为通过；本片不签整仓类型／全量回归或 CI。

自动本地旅程已走通教师创建／发布／派发、学生文本／PNG 预览与返回、活动绑定、原提交服务、教师查看、结束拒绝再次进入。内置浏览器在最终相同构建再次真实完成：

1. 学生进入“第二课堂尝试绑定”，自动定位尝试 **2**，活动版本 **1**，页面只有该尝试。
2. 学生保存并最终提交版本 **1**：“本地课堂最终复验：断电检查，核对人员和防护装置，记录问题并请教师复核。”
3. 教师看到已进入 **1** 人、已提交 **1** 份、已发布成绩 **0** 份；此前另一课堂的提交未计入。
4. 教师结束课堂至 **ENDED／revision 4**，两次尝试及各自 1 份提交仍在，未创建尝试 3。

[学生截图](evidence/zhiban-shared-classroom-student-browser.png)、[教师截图](evidence/zhiban-shared-classroom-teacher-browser.png)、[收尾只读事实](evidence/zhiban-shared-classroom-candidate3462-facts.json)。完整源码、SQL hash 和当前构建绑定见证据 JSON。最终 `sourceMatches=true`、漂移 **0**；原启动 receipt 未通过手工改 hash 伪造签收。

过程中发现并修正同页 hash 导航未完成、严格 query 拒绝新参数、继续进入误开下一尝试和统计混入历史。最终自动化增加“页面实际就绪＋精确活动／尝试”断言，避免仅等 URL 或旧页面标题就误判。

## 当前入口与生命周期

- 当前运行：[3462 基础课堂候选](https://127.0.0.1:3462/zhiban)。内置浏览器保留教师课堂结果页。
- 账号只在本机 `/tmp/zhiban-shared-classroom-nmKtSq/accounts.json`（0600）；不复制密码到文档／聊天。
- 状态：`pnpm trial:zhiban:classroom:info`；停止此候选：`pnpm trial:zhiban:classroom:stop`。
- 重建：`pnpm trial:zhiban:classroom`。停止会删除该 owned PG16／Native 数据库，重建生成新合成数据与密码；无 serve 的 `pnpm verify:zhiban:classroom` 同样使用独立端口，需无运行中的同端口实例。
- 专用 PG **56518**，数据库 `zhiban_shared_classroom_disposable`，临时根 `/tmp/zhiban-shared-classroom-nmKtSq`。只绑定本机 HTTPS 和 owned Unix socket，证据明确 LOCAL／githubActions=false。

原 **3461／56517** 根 `/tmp/zhiban-trial-content-z7jorO` 仍运行；88／100 和 92／100 成绩只读核对仍存在，未重建、重签或清数据。其来源相对旧启动已为 **23 项漂移**，不能据此验收本片；新候选漂移 0。两个 127.0.0.1 端口共用浏览器 Host cookie，切回另一个环境可能需重新登录，数据库分别隔离。默认试用仍指 3461，本片没有替换默认入口。

## 仍保留的边界

首片不提供课堂草稿编辑、重开、删除；教学班最多 100 课堂、每课堂 100 次派发、参与明细最多读取 1000 人（超限拒绝返回），未实现课堂列表分页。未支持旧 student/classroom/[bindingId] 原生播放器地址、完整多场景 OpenMAIC／Quiz／HTML／3D／VirtualLab／AI。它们仍按 U01／U02 等各自 Gate；维护输入、UNKNOWN／RESERVED 和真实启用继续隔离。原生刷新／关闭保护的历史延期也不被本片自动签收。

下一步：继续产品试用，优先补课堂草稿编辑和开放时间调整；GPT-6 Sol / medium。
