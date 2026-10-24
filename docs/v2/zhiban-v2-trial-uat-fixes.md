# 三角色试用问题修复：UAT-01 / UAT-02

2026-10-16。`refactor/zhiban-v2`，基线 `daf63afa83470d24a9ed41d171c6a17f8a80adb6`。两项 P2 已在本地候选关闭；未提交、未推送、未派发 CI。[原试用报告](zhiban-v2-trial-uat.md)保留当时的 OPEN 状态及原证据，本记录是后续修复，不回写历史结论。

## 尝试入口

学生“继续未完成作答”和“查看已提交尝试与重交”只打开原有尝试分页，不发送 START_ATTEMPT。即使另一会话已经提交，旧的“继续”入口也不会消耗新次数。

首次／下一次尝试需先展开说明，显示已用次数、上限、当前发布版本和截止时间，再点击“确认开始新尝试”。取消只收起说明。原尝试重交仍产生提交新版本，不新增尝试。当前存在未完成尝试时不提供新建入口；截止或上限时确认禁用，服务器仍执行原授权、并发及规则判定。未知结果沿用原命令号重试，不重新生成命令。

不改变原 START_ATTEMPT、尝试／提交版本、统计取最新尝试等业务合同。没有将旧尝试的成绩挪到新尝试。

## 历史涉及成员

历史响应在原八字段上增加 `member_id,member_name`，共十字段，页面展示“涉及成员：姓名”和完整 ID；支持该姓名字面子串和完整 ID 搜索。

按现有审计事件白名单投影：班级成员、指定任教、Enrollment 取 command.membershipId；结束任教、移出和转班取 before.membership_id；班主任取 command.membershipId，清除时回退 before.head_teacher_id；课程负责人取 command.ownerMembershipId，清除时回退 before.owner_membership_id。只读取已经保存的必要引用，不回填旧 facts。

姓名是**当前同空间目录标签，不是历史姓名快照**。目录缺失保留有效 ID并显示“未记录姓名”；旧引用缺失或格式不合法时为 NULL，不阻断整页。查询只按审计租户关联姓名，不借用外空间目录；如果本空间已有损坏审计保存了外空间 UUID，仍可显示该已保存引用，但姓名保持 NULL，不声称校验了该历史引用的空间归属。原始 facts、before、command、命令号和凭据均不返回。当前管理员检查、RLS、游标和原写入审计不变。

## LOCAL 验证及边界

`pnpm verify:zhiban:uat-fixes`：独立 disposable PG16 **56516**、数据库 `zhiban_uat_fixes_disposable`、受信 HTTPS **3460**，**11/11 PASS**，自建 PG已停、根目录已删除。[定向证据](evidence/zhiban-uat-fixes-local.json)绑定源码和 bundle hash。

- 五项统一试用短冒烟，以及六组两项修复的定向检查。
- 浏览器真实首次确认／取消、草稿继续、原尝试重交、下一次尝试、跨会话提前提交、次数上限、到期、响应丢失原键重试。到期活动先通过原命令合法发布，再等实际截止时间；不改数据库规则或服务器时钟。
- 两条真实 Enrollment 和任教／课程负责人、结束关系的成员识别；当前目录删除、坏 UUID 和外空间姓名使用明确的自建合成负向夹具，不是实际历史修复证据。
- 教师、学生、跨空间访问拒绝；十字段和原始事实不泄露；管理员页面及 390px 无横向溢出。

相关 learning／management／academic／workspace／directory 单元回归 **58/58 PASS**；定向 TypeScript、ESLint、Prettier 通过。16 个既有 migration 与此前 hash 一致；没有 migration／helper／ACL／receipt profile 或冻结生产语义改动。未运行全仓 build、大规模性能基准或 CI；真实 55432/55433、Native／维护输入和“保留待补”隔离保持。

统一试用 **3459 / PG16 56515** 已受限停止旧实例并重启，五项短冒烟通过，`trial:zhiban:info` 源码零漂移。新实例重置合成数据和三角色账号；本次内置浏览器只读取历史并展开首次尝试说明，没有确认新建，初始安全巡检仍未开始。账号仅在 `pnpm trial:zhiban:info` 指向的 0600 本机文件，不写入证据。该运行实例单列 RUNNING_DISPOSABLE，不冒充已清理；旧统一试用 checkpoint 保留旧实例适用范围，新的[最终核对](evidence/zhiban-uat-fixes-checkpoint-local.json)绑定本轮和刷新后的实例。

[尝试入口截图](evidence/zhiban-uat-fixes-attempt-iab-local.png)；[两名学生历史截图](evidence/zhiban-uat-fixes-history-iab-local.png)。内置浏览器使用已信任证书，无安全警告绕过。

下一步：继续三角色试用并按实际阻碍排序，不扩展新功能或重复远端 CI。建议模型 GPT-6 Sol / medium。
