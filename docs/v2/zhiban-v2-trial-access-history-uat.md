# 名单变更后的课程访问与历史作答核对

2026-10-16（Asia/Shanghai）。`refactor/zhiban-v2` / `daf63afa83470d24a9ed41d171c6a17f8a80adb6`。状态 **MANUAL_SCENARIOS_PASS**。本轮只在原有本地合成试用实例通过真实管理员／教师／学生界面核对，不改业务源码、不重启实例、不重置账号、不运行新的自动化套件或 CI。没有发现需要修复的问题。

## 预期与实际结果

现有合同要求当前教师角色与任教关系、当前学生角色与 Enrollment；历史保留本身不授予原班访问权限。参考原 [M3 学习合同](zhiban-v2-m3-learning.md)和[工作台关系过滤](zhiban-v2-m6-member-workspace.md)，本轮没有修改这些规则。

| 阶段 | 实际核对 | 结果 |
| --- | --- | --- |
| 初始学生 | 原班四个发布活动、三次已提交尝试、88/100 v1；设备交接尝试 1／提交 v1，原提交时间 07:01:29 | 与上轮保留数据一致 |
| 初始教师 | 原班当前名单陈同学、李明、批量学生甲乙，共 4 人；王悦不在原班 | 与上轮转班结果一致 |
| 未任教目标班 | 周老师没有目标班课程入口；直接访问目标班统计 | 显示“当前身份没有该教学班的任教权限”，不因同课程而自动取得目标班权限 |
| 管理员移出陈同学 | 原班 4 → 3；学生重新登录查看工作台，再直达旧概览 | 没有可访问课程；旧概览明确拒绝，未展示历史成绩 |
| 退班后的教师 | 原班当前名单只剩李明、甲乙；教师仍任教该班，展开设备交接尝试与提交 | 原提交正文、尝试 1／提交 v1 和原时间仍可读；当前名单与历史尝试范围不同，不将历史误算为当前在班 |
| 管理员显式恢复 | 通过“已退班”名单恢复陈同学，再以学生登录 | 原班入口和原三次历史尝试、88/100 v1重新可见，没有新开尝试 |
| 转班准备 | 用原“修改教学班”将目标容量 1 → 2，不改变任教关系 | 保留王悦，允许临时转入陈同学 |
| 陈同学转至目标班 | 学生只看到目标班 2/2；目标班概览当前活动与历史均为 0；旧源班概览拒绝 | 原班尝试、成绩不混入目标班，也没有被转班复制 |
| 转班后的教师 | 原班当前名单 3 人，仍没有目标班入口 | 学生关系变化不新增教师任教权限 |
| 交接还原 | 陈同学从目标转回原班，目标容量 2 → 1 | 原班入口恢复、人数 4/20；目标 1/1且仅王悦 |
| 最终学生 | 查看原设备交接作答与提交分页、个人概览 | 正文仍为“设备无异常，工具清点齐全，接班人员已确认。”，尝试 1／提交 v1及 07:01:29 原时间不变；三次已提交历史与原 88 分、反馈均保留 |

这里的“原班历史保留”不是退班后还能直接读旧班的产品承诺。学生失去原班资格期间，原班概览拒绝；恢复原班有效关系后才能重新读取。仍有原班任教资格的教师可以查询该班已有提交。目标班没有历史，是该班尚无活动／作答，不是原历史被清空。

## 数据还原与留痕

所有业务写入均来自管理员界面中的原受保护命令，没有直接 SQL 修改。共执行六个成功管理动作：移出、显式恢复、目标扩容、转入目标、转回原班、目标容量还原。没有新建或重交作答、评分、更正或授予教师／学生角色。

最终有效名单和容量恢复到本轮开始状态：源班 TRY_01 为陈同学、李明、甲乙共 4/20；目标 TRY_TRANSFER 为王悦 1/1。**正常审计、关系 revision，以及陈同学在目标班产生的已退班关系保留**，不是删除或回滚试用操作记录。既有活动和成绩不重置，账号未轮换，服务和自建数据库未重启。

## 证据边界

[机器记录及截图 hash](evidence/zhiban-trial-access-history-local.json)绑定原实例、原服务 bundle、现有静态补丁与本轮文档。启动 metadata 仍保留之前披露的三项源码漂移；与[名册静态补丁证明](evidence/zhiban-trial-roster-served-asset-local.json)是同一运行组合，本轮没有新增源码差异。不伪称新构建、源码零漂移或 GitHub Actions 证据。原 16 个 migration hash 不变，真实 55432/55433、Native／维护输入、M5 启用边界继续隔离。

主要截图：[学生初始历史](evidence/zhiban-trial-access-baseline-local.png)、[退班后无课程](evidence/zhiban-trial-access-withdrawn-workspace-local.png)、[旧概览拒绝](evidence/zhiban-trial-access-withdrawn-link-denied-local.png)、[教师保留原作答](evidence/zhiban-trial-access-teacher-historical-answer-local.png)、[显式恢复](evidence/zhiban-trial-access-restored-progress-local.png)、[转班后的课程](evidence/zhiban-trial-access-transferred-workspace-local.png)、[目标无原班历史](evidence/zhiban-trial-access-target-empty-history-local.png)、[目标班教师拒绝](evidence/zhiban-trial-access-teacher-target-denied-local.png)、[最终原作答](evidence/zhiban-trial-access-final-original-answer-local.png)、[最终概览](evidence/zhiban-trial-access-final-progress-local.png)、[目标容量还原](evidence/zhiban-trial-access-final-target-local.png)。

这是单一合成学生、同一空间两班、顺序切换角色并发起新读取的手工验证。没有验证已打开标签中的定时撤权传播延迟、所有 API 的直接写入负向、并发转班、跨租户攻击、历史大名单或全站安全性；没有把原自动化证据当作本轮重新执行。浏览器无证书绕过，最后查询该标签可见 console error 为空。

下一步建议：汇总当前试用交付范围和已知限制，进入完整教学演示，按实际反馈处理问题；文档整理建议 GPT-6 Luna / medium。NO COMMIT/PUSH/CI。
