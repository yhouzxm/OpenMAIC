# P4 教师配置“互动＋作答”联合课堂派发（LOCAL）

2026-10-21，沿原 P4，复用离线 HTML 发布、真实 Learning Attempt、原文字／Quiz 作答及评分发布。教师在已发布课堂中选择已发布目录里的互动与活动，一次显式派发；没有新增 Runtime 完成或评分定义。

## 可见流程

1. 教师发布互动、文字活动或测验，将两者加入已发布课程目录。在“课堂与互动”创建并发布课堂后，通过“联合派发：互动＋作答”选择两端，点击“派发互动＋作答”。
2. 联合任务固定互动的 publication UUID／Bridge generation 与活动版本，替换上一当前任务。学生在“学习活动”里的课堂任务区看到同一个联合任务，点击进入，服务端原子建立进入记录、真实 Attempt、运行绑定及关联外键。
3. 学生进入原 OpenMAIC 互动播放器，父宿主自动显示“本次课堂：互动＋作答”，无需再次挑选活动或 Attempt。点击“前往本次课堂作答”打开原文字／Quiz 页面，固定于该派发首次进入的 Attempt。
4. 保存、提交／重交、次数限制、截止时间、教师评分／成绩发布均走原 API。作答页可“返回本次课堂互动”；宿主读取原服务端开始／提交事实。重复进入或换命令号沿用同一尝试，不隐式重考。
5. 教师看到进入人数、真实提交与已发布成绩数量，并可进入原评分入口和可信记录查证页。进入、互动操作与提交都不直接代表课程完成。已结束课堂禁止新进入，已有作答／成绩依原课程规则保留。

新任务不是把两个单独任务连点两次，也不依赖浏览器报告分数；旧讲义／单活动派发继续保留。

## 数据、授权与提交边界

[0005 候选 SQL](candidates/p4-joint-classroom/0005-joint-classroom.sql)仅安装于新 owned disposable PG16，未修改已应用迁移，也不替换冻结 helper。

- `joint_tasks` 固定派发／教学班／活动版本／互动发布。组合 FK 同时锚定真实 dispatch、activity_versions 和 publications；不能把其他课程的合法 ID 拼入本次派发。
- `joint_entries` 固定 dispatch／Membership／Attempt／runtime binding／互动发布，组合 FK 指向原课堂进入事实及原运行绑定。无 UPDATE/DELETE 权限。
- 新 helper 只为 Academic 提供固定发布的受限锁定及精确作答绑定；Bridge 只获自己的联合进入记录投影。Academic 不获原始 Content／Bridge 表读写或绑定表 INSERT 权限，Bridge 不获新的绑定 helper 执行权。

教师派发和学生进入外层均通过 ContentService 保留原私有 Identity 守卫（包括资源创建者）、课程关系与发布／Bridge slot SHARE 锁，并用真实 public provider 校验固定 Native 文档。该只读 lease 覆盖内层 Academic 事务提交；内层重新验证真实身份、任教／Enrollment、课堂窗口、任务、目录和活动版本。

内容锁先于学习活动 UPDATE／Attempt 锁，避免与既有手动关联形成相反锁序。学生进入的 Attempt、Quiz 答案初始行、课堂 entry、runtime binding、joint entry 和原操作／审计记录在同一业务数据库事务提交；任一失败全部回滚。外层只读事务不写 Native 或 Bridge operation，不构造跨库写事务。

相同命令号先校验原意图；不同命令号重复进入也读取首次进入的同一 Attempt。已提交尝试可以续看；新派发不自动突破原 maxAttempts。换版、撤回、未知／隔离 generation、错误主体、未开放／已结束课堂均不允许借旧派发开始新作答。原有运行绑定不能被联合任务改绑到新互动版本。

播放器 URL 只携带 publication 与 dispatch；Attempt 由当前会话主体和持久 `joint_entries` 在服务端解析，不接受 URL 自报 Attempt。原生 iframe CSP、opaque sandbox 及结果不可信边界不变。已有课堂的文字／Quiz 入口均固定首次 Attempt，避免从课堂入口隐式创建下一次测验。

## 本地验收

定向命令：`pnpm verify:zhiban:joint-classroom`。独立 reference：`pnpm exec tsx scripts/zhiban-local/run-m5-png.ts --joint-classroom-reference-only`，只建新集群并核对 schema／ACL；旧 0004 reference 保留。

证据使用独立路径：[主 receipt](evidence/zhiban-joint-classroom-local.json)、[产品旅程](evidence/joint-classroom/journey.json)、[日志](evidence/joint-classroom/directed.log)、[独立 profile](evidence/p4-joint-classroom-profile-reference-local.json)。新增 Content／Learning／Bridge owner policy 与 Classroom 表／FK／ACL 都纳入固定 profile；课堂基础账本仍精确核对原三条迁移。

受影响旅程覆盖：教师真实配对页面、文字提交与原成绩发布、Quiz 固定 Attempt 提交、同／不同 key 重复进入、开始后撤销 helper 权限故障回滚、持有课堂锁时并发进入与互动换版的锁屏障、错误角色／发布／闭合 DTO、次数上限、结束课堂与授权历史。本轮定向旅程 PASS，120 份冻结 Identity／Bridge／已应用迁移及旧候选源均无漂移；Node 4 GiB heap 类型检查、定向 lint 与 6 项受影响单元验证 PASS。验证还使用真实 Native INSERT 撤权制造 OUTCOME_UNKNOWN，恢复 ACL 后隔离仍保持，且新联合进入没有新增 Attempt／entry／binding。交付核对见 [closeout](evidence/joint-classroom/closeout.json)。

普通启动不自动运行专项验证。不触碰 55432/55433，不运行 CI，不调用模型，不改变维护 UNKNOWN/RESERVED 隔离或生产 Runtime gate。

## 后续范围

完整 Native Runtime、可信互动完成／自动评分及外部 VirtualLab 仍单独待补。本轮交付后，下一完整功能按原 P4 推进课堂任务结果汇总与学生历史入口，直接复用这里的受限来源绑定，避免重复创建成绩事实。常规结果页复用建议 GPT-6.1 Sol / medium；涉及新 Identity／并发边界再用 high。

默认 3461 已重建为新合成实例，另有教师配对入口与学生进入地址见 [演示](evidence/joint-classroom/default-demo.json)。此前试用三库先备份到 `joint-before-20261021-201339`；未自动恢复旧合成数据，也未声称已做备份恢复演练。

本轮新默认三库另备份于 `joint-current-20261021-204456`，TOC 已核对，未做恢复演练。源码与运行候选 0 漂移，教师内置浏览器实见配对表单及固定联合任务；旧代码的 any 存量规则在单独 lint 中排除，无额外 lint 错误。
