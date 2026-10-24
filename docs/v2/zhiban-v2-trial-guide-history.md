# 智伴 V2 当前统一试用指南

> 原 P5 人工处理：教师课程 → 教学分析 → 待跟进名单 → 记录跟进；“跟进记录与结案”可查历史、追加、结案及重开。结案不消除未交事实，说明仅任教教师可见。详见[本地包](zhiban-v2-followup-cases-local.md)。

> 原 P5：教师课程 → 教学分析 → 教师待跟进名单；可跨活动查逾期／未开始／未交及待发布，提交事项接原评分与返回。判定仅基于当前在班及当前发布版本事实；详见[本地包](zhiban-v2-teacher-followups-local.md)。

> P4 结果入口：教师课程 → 课堂 → 课堂结果汇总；学生课程 → 课堂与作答 → 我的课堂历史 → 回看本次作答与成绩。每页 20 次派发，结束后可查；只显示原 Attempt 的最新提交及其已发布分数。详情与证据见[本地包](zhiban-v2-classroom-results-local.md)。账号及运行状态以 `pnpm trial:zhiban:info` 为准。

2026-10-21 P4：[联合课堂派发](zhiban-v2-joint-classroom-local.md)。教师“课堂与互动”→已发布课堂→“联合派发：互动＋作答”；学生从“学习活动”中的课堂任务进入，自动关联本次 Attempt，再点击“前往本次课堂作答”。默认已准备欧姆定律配对，当前地址见 `evidence/joint-classroom/default-demo.json`。

2026-10-21 P4：[作答关联与可信记录](zhiban-v2-attempt-runtime-local.md)。学生打开互动后，可在右下角选择活动并开始／续接；到活动页提交，再读取服务端记录。教师在同一互动中选择活动和学生尝试查证；课程资源的“查看作答关联记录”支持撤回后只读历史。

2026-10-20 P4：[离线 HTML 互动](zhiban-v2-interactive-local.md)已在默认 3461 的课程资源提供教师新建／保存／显式发布入口，学生从目录或课堂进入原生宿主操作。只用自包含 HTML，不支持外链与媒体，不计完成或成绩；当前账号与路径读取 `pnpm trial:zhiban:info`。

2026-10-20 P4：[固定发布版本的原生 PPT 播放](zhiban-v2-native-player-local.md)在课程资源已发布预览和学习中心讲义单元提供入口；播放器直接复用 OpenMAIC App，自主浏览，不计完成或成绩。当前账号及地址始终读取 `pnpm trial:zhiban:info`。

2026-10-20：公式保留、采用后自动打开草稿及 P4 讲义同步／重连见[本轮完整包](zhiban-v2-lesson-product-p4-local.md)。旧真实 AI 三页课堂在停止前已另做三库备份；新启动为新的合成课堂，不是恢复旧 run。下方历史 ID／账号均以 `pnpm trial:zhiban:info` 的实时结果为准。

2026-10-17 TJ-01／02／03 页面修订已在原3461课堂完成定向浏览器复验：学生文案、课程直接退出、取消保留文字及教师评分标题通过；作答及92分保留。旧启动receipt不改写，info报告3个预期UI源漂移，见[体验修订记录](zhiban-v2-p1-teaching-ux-local.md)。

2026-10-17 连贯教学试用已在原 3461 实例走通：学生“连贯备课：检查记录”首次正式提交，教师发布 92/100 和反馈，原 88 分及历史数据保留。本轮未重建实例，三处非阻断体验项详见 [试用记录](zhiban-v2-p1-teaching-journey-local.md)。账号及实时状态仍以 `pnpm trial:zhiban:info` 为准。

> 2026-10-17 P1 更新：已新建 3461 disposable 试用实例，三角色导航与课程列表已接线；新租户／教学班及账号以 `pnpm trial:zhiban:info` 为准。本页下方旧 PID、路径和 ID 只属历史记录。详见 [P1 本地记录](zhiban-v2-p1-portal-local.md)。

2026-10-16，`refactor/zhiban-v2`，HEAD `daf63afa83470d24a9ed41d171c6a17f8a80adb6`。当前为未提交的 LOCAL disposable 候选，不是生产发布或全量移植签收。当前入口为 **[3461 工作台](https://127.0.0.1:3461/zhiban)**；默认启动／状态／停止／验证命令已统一到 3461。

## 先接续当前实例

```sh
pnpm trial:zhiban:info
```

2026-10-17 只读核对原实例已停止，原 PID／临时根均不存在，3461 未监听。本轮未重建。先读 info；以下账号／数据状态属于上次实例，不能当作当前运行。info 提供三角色完整 UserId、私有账号路径、工作台／评分／教师统计／学生概览／名册 URL。密码只从它给出的本机 owner-only `accounts.json` 读取，不提交或分享文件，不在聊天发送密码；登录填 UserId 和 password，不是姓名或 Membership ID。

上次实例根 `/tmp/zhiban-trial-content-CkNgQo` 现已缺失，其账号文件不能继续使用；重建后必须重新查询 info 获取新路径和 ID。只用合成数据。

| 角色 | 名称 | 试用范围 |
| --- | --- | --- |
| 管理员 | 王管理员 | 课程／学期／行政班／教学班、负责人、任教、成员、学生目录、Enrollment／转班、批量名册、操作历史 |
| 教师 | 周老师 | 当前任教班、文本／PNG 草稿与发布、学习活动、截止／重交／次数规则、评分／发布／更正、统计 |
| 学生 | 陈同学 | 当前课程、已发布文本／PNG、本人尝试／草稿／提交／重交、公开成绩及反馈 |

账号沿用正常空间及课程授权，不授予平台或维护权限；管理员不能替代教师评分。切换角色先退出；同一浏览器标签共享会话，127.0.0.1 不同端口也共享 Cookie，避免其他试用标签自动刷新。沿用受信开发 CA，不绕过证书警告。

## 上次实例的历史课堂与新建初始数据

上次合成租户“智伴本地试用”，教学班 TRY_01 为 2/20（陈同学、李明），周老师任教。文本／PNG 讲义“课堂讲义：急停与安全复位”已发布。

| 活动 | 上次运行实例状态（历史） |
| --- | --- |
| 试用：安全巡检报告 | 尝试 #1、提交 v2，96/100 和反馈已发布；历史提交 v1／94 分保留 |
| 试用：待评分作业 | 陈同学提交 v1，尚未评分，可用于下一次评分演示 |
| 试用：已发布成绩 | 88/100 和反馈保持，可用于查看成绩／公开更正历史 |
| 试用：未发布草稿 | 仅教师可见，可继续编辑发布 |

当时学生概览 3 项已提交、2 项成绩已发布、1 项待发布，平均得分率 92%，不是课程总评。教师选择安全巡检活动时按最新提交统计，当前已发布成绩平均 96%。这些是上次运行实例的课堂结果，非新建环境初始 fixture。

新建后可用新数据体验：教师展示讲义 → 学生查看反馈并保存作答 → 教师处理剩余待评分作业 → 学生查看公开反馈 → 教师查看对应活动统计。无需重新执行已完成的重交课堂。具体[本轮课堂结果](zhiban-v2-classroom-revision-local.md)保留各自来源。

新建实例的初始 fixture 与上表不同：安全巡检尚未开始，待评分作业已提交但未评分，88 分活动已发布，另有教师草稿；启动过程另准备讲义示例。重建不迁移当前课堂记录。

## 新建和停止

前提沿用 Node 22、pnpm 10.28.0、Ubuntu PG16 与已信任开发证书。在项目根目录，仅在无运行候选且需要新数据时执行：

```sh
pnpm trial:zhiban
```

启动会构建现有公开包／宿主／私有内容 bundle，自建并核验双库及 receipt，并执行已有本地启动检查；这不是只打开网页，也不派发 GitHub CI。固定 HTTPS 3461，PG16 56517 仅监听私有 Unix socket，业务库 `zhiban_trial_content_disposable`、Native 库 `zhiban_trial_content_native`。不连接真实 55432/55433，不自动换端口或接管其他进程。已有实例运行时不要重复启动；不要用 `setup:zhiban*`／`dev:zhiban` 替代当前试用命令。

停止并删除本候选数据（只在不再需要数据时执行）：

```sh
pnpm trial:zhiban:stop
```

也可在原启动终端按 Ctrl+C。控制器校验固定端点、metadata、PID／启动时间、准确 argv、bundle hash 和 owner-only 根／账户文件，再向记录进程发 SIGTERM；宿主 finally 停止 owned PG 并清理根。以匹配的 close receipt 确认清理；只返回 STOPPED 不等于已证明目录清理成功。失败保留诊断，不手动删除未知根或扩大清理范围。

**停止删除双库、账号、讲义、作答及成绩；重新启动生成全新数据和密码。** 源码漂移不要求立即停掉仍在使用的课堂实例；若需要验证全新组合，应先明确接受当前数据丢弃并保留必要记录，再计划重建，不能修改旧 receipt 掩盖差异。

## 当前限制与证据

- 上次运行宿主／私有 editor bundle 沿用原构建，静态文件按请求读取。当时 info 为 `sourceMatches=false`、`sourceDriftCount=5`：content.html、learning.js、workspace.js，以及本轮接线的 package.json、trial-control.ts。前三项的讲义返回／作答离开保护已定向核对，后两项仅完成本地命令参数／目标核对；不是当前工作树全新构建或零漂移签收。
- 原生刷新／关闭提示与取消按用户要求延期，仍未签收；编辑后先显式保存。页面内离开确认及上下文返回见[修复记录](zhiban-v2-content-classroom-fixes-local.md)。跨页课程自动定位未实现。
- M5-A/B/C 文本＋PNG 已在本 disposable 候选接入。Runtime、AI、真实 Native／维护恢复、UNKNOWN／RESERVED 终态处置及完整 enabled gate 仍隔离；PDF／PPT／附件／音视频不在当前试用范围。浏览讲义不会自动生成 Attempt、提交、成绩或完成事件。
- 旧 3459 进程／根在此前最后核对已不存在，原因未建立；旧名册／课堂证据仅为历史，不声称旧数据可恢复或已迁入 3461。
- 原 12/12 安装及内容旅程检查绑定原构建；后续课堂与三项补丁只按各自 LOCAL 记录适用。不外推为并发课堂、生产容量、全部负向或真实身份入驻签收，不重复 GitHub CI。

[原内容候选交付](zhiban-v2-unified-content-local.md) · [默认入口替换范围](zhiban-v2-trial-entry-handoff.md)。本轮已实施默认／legacy 命令接线，但没有重启、重签 receipt 或提交／推送／派发 CI。显式 content 命令保持兼容；旧 3459 使用 `trial:zhiban:legacy` 及其 `:info`／`:stop`，验证为 `verify:zhiban:trial:legacy`。默认 `verify:zhiban:trial` 指向 content 验证，新建实例会占用同一端口，当前运行时不要执行。见[接线核对记录](zhiban-v2-trial-entry-wiring-local.md)。

2026-10-17 后续主线见[完整迁移与界面恢复计划](zhiban-v2-migration-completion-plan.md)。本轮只整理计划与状态，没有重启、恢复数据或改变默认命令。
