# 原 P5 教师待跟进名单

本包补现有“单活动教学分析”与“待评分列表”之间的跨活动入口。沿原 P5 推进，不重做统计、成绩簿或原生测验，也不启用画像／风险计算器。

## 使用与判定

教师课程工作区 → 教学分析 → 教师待跟进名单。支持按学生姓名、完整 Membership ID、活动标题搜索，按跟进原因筛选，每页 20／50 条，前后翻页与刷新。汇总按“学生 × 活动”事项计数，同一学生可有多项，不称全班完成率。

仅取当前 ACTIVE Enrollment、当前 PUBLISHED 正式活动版本；排除自主练习、草稿及撤回活动。每名学生每个活动版本只取最新 Attempt 及其最新 Submission：

| 跟进依据 | 精确判定 |
| --- | --- |
| 逾期未交 | 最新尝试没有正式提交，发布版本截止时间非空且不晚于服务器统计时点 |
| 尚未开始 | 当前版本没有 Attempt；包含已经逾期的未开始事项 |
| 已开始未交 | 当前版本最新 Attempt 尚无提交；包含已经逾期的已开始事项 |
| 已提交待发布成绩 | 最新 Attempt 的最新 Submission 没有 Assessment publication；与评分草稿状态无关 |

“逾期”与“尚未开始／已开始未交”重叠，汇总明确提示不可相加。已发布成绩的最新提交退出名单，更正不会产生额外事项；重交未发布时重新出现。发布新活动版本后不沿用旧版本作答作为当前版本完成事实。这里不判断迟交合规、强制先修、学生风险或互动学习完成。

已有提交进入原评分页，预选活动及学生，再由原授权重新校验；提供“返回待跟进名单”。未提交事项可返回原活动。名单不接触作答正文、私有联系方式、密码、评分草稿／反馈或模型诊断。不自动发消息、催交或新增尝试。

## 数据与授权

`GET /api/zhiban/analytics/:tenant/offerings/:offering/followups`

闭合参数为 `q/state/limit/cursor`。活动 ID＋成员 ID 组成稳定排序及 keyset 游标，游标绑定租户、当前教师、教学班、搜索／状态／条数；不是访问凭据。每页及汇总使用同一条 PG 查询快照，不在浏览器拉取完整名册或全部活动矩阵。跨页不承诺冻结导出快照，刷新回第一页。

每次读取走原 AcademicStore／Identity 及当前教师授权、任教关系守卫；管理员和学生不获得本报告权限。退班、换任教关系后，后续读取立刻按当前事实重算或拒绝。UI 链接及游标都不授予权限。未新增表、migration、helper、ACL 或写命令；不改已应用迁移和冻结 Identity 语义。

## 本地验收范围

`pnpm verify:zhiban:followups` 仅跑本包必要 fixture、真实 PG16 命令和教师页面，复用既有原生包／receipt，不重跑无关课堂、扫描、导出或 CI。记录：

- [本包 receipt](evidence/zhiban-teacher-followups-local.json)、[旅程](evidence/teacher-followups/journey.json)、[日志](evidence/teacher-followups/directed.log)。
- [受影响页面](evidence/teacher-followups/teacher.png)、[类型检查](evidence/teacher-followups/typecheck.log)、[ESLint](evidence/teacher-followups/lint.log)。
- [替换前备份](evidence/teacher-followups/before-backup.json)：三库归档及 TOC 检查；未测试恢复，不能声称旧教学数据已恢复到新实例。

验证当前版本／名册口径、自然截止后逾期、草稿不暴露、发布／更正退出、重交返回、换版重算、练习／撤回排除、分页、筛选绑定游标、跨角色／租户拒绝、退班剔除、撤任教后拒绝及“名单 → 原评分 → 返回”。证据仅标 LOCAL，不能扩大旧 CI 或 Native Runtime 的证明范围。

剩余完整 P5 差额：人工跟进记录、处理结果与责任留痕、必要通知、概念诊断／画像、补救建议，以及仍待产品决定的维度规则。本包不把只读名单冒充人工干预闭环。下一完整功能建议为教师人工跟进记录及结案；常规产品接线建议 GPT-6.1 Sol / medium，若新增跨 Identity／并发写屏障则 high。

## 本轮交接与证据边界

最终定向旅程、项目类型检查、增量 ESLint、查询／游标网关检查均通过。页面截图检查发现并修正了视图按钮占用课程网格列的问题，增加桌面内容区宽度断言，同时复验原活动统计切换。冻结 Identity／migration／SQL 候选 154 个文件与上一包一致；最终 receipt 的持久源码漂移为 0，缺失的三个路径属于按流程清理的临时 bundle／控制输入。初轮 fixture、网关及页面发现仅作问题追溯，当前结果以最终 `directed.log`、receipt 和 `closeout.json` 为准。

默认 HTTPS 3461 使用新候选；进入教师课程“教学分析 → 教师待跟进名单”，搜索 `跟进演示：` 可看六项合成事项：两项自然越过已发布截止时间、一个已开始 Attempt、一个正式提交待发布，其余学生尚未开始。演示使用真实本地业务命令，不代表实际教学结果；保留上一包联合课堂与已结束课堂演示入口。旧实例已归档，本轮没有声称把旧课堂数据恢复到新实例。

[默认演示定位](evidence/teacher-followups/default-demo.json)、[默认入口核对](evidence/teacher-followups/default-info.log)、[内置浏览器概览](evidence/teacher-followups/default-browser.png)、[具体名单](evidence/teacher-followups/default-list.png)、[当前三库备份](evidence/teacher-followups/default-backup.json)、[收尾记录](evidence/teacher-followups/closeout.json)。备份检查归档和 TOC，未测试恢复。

未提交、推送、CI、模型生成或外部通知。Native Runtime／可信完成证据继续按原门禁保留，不借本报告扩大适用范围。
