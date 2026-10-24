# M6 学习活动与提交记录分页

2026-10-15。基线 `refactor/zhiban-v2` / `daf63afa83470d24a9ed41d171c6a17f8a80adb6`；保留既有未提交候选，`LOCAL_VERIFIED / UNCOMMITTED_CANDIDATE`。NO COMMIT/PUSH/CI。

## 可用行为

教师／学生工作台展开“学习活动与提交”后，活动、单活动尝试、单尝试的提交版本分别按需加载、搜索／筛选和 10/20/50 条翻页。活动支持可见标题／完整活动 ID 搜索及状态筛选；教师尝试支持完整学生成员 ID 和状态筛选。各层独立游标，查询重置到第一页，页码仅表示当前浏览位置，不宣称总页数或跨页冻结快照。

教师继续创建／编辑活动草稿、发布新版本与撤回；学生继续开始／恢复、保存作答和追加不可变提交版本。只有当前完整历史中的最新尝试可写；活动卡片的次数限制使用服务器全量计数事实，不使用当前页长度。教师尝试不返回学生未提交草稿；学生仅能查看自己的尝试和正式提交。发布版本、截止、重交和次数规则均沿用原命令处理。

每份提交展开“人工评分与成绩”后，按精确 submission 读取当前评分与分页更正历史；保留评分草稿、发布、更正和学生公开反馈。历史提交／当前成绩标记由完整数据库记录决定，翻到旧页不会被误标为最新。单提交评分表单直接展开，避免额外折叠层；不再为了给本页补评分而读取整个教学班成绩。

提交响应丢失时保留原命令号并暂停该学习视图的其他操作，可按原键重试；确认提交后重新读取分页数据。课程列表刷新／筛选导致组件移除、切换空间、退出或页面离开时，学习组件终止请求并销毁子列表；旧响应不得回填。后台会话与空间检查在账号／空间列表未变时保留已展开的学习视图及游标；会话失效或空间变化仍清空重载。关系权限由每次业务查询／写入重新核验，已有页面不是持续授权凭据。翻页／刷新是显式操作，未保存的作答应先保存草稿。

## 接口与边界

新增只读 GET：

| 完整路径 | 查询 |
| --- | --- |
| `/api/zhiban/learning/:tenant/offerings/:offering/activities` | `q,state,limit,cursor` |
| `/api/zhiban/learning/:tenant/offerings/:offering/attempts` | 必填 `activity`，可选 `member,state,limit,cursor` |
| `/api/zhiban/learning/:tenant/offerings/:offering/submissions` | 必填 `attempt`，可选 `limit,cursor` |
| `/api/zhiban/assessment/:tenant/offerings/:offering/publications` | 必填 `submission`，可选 `limit,cursor` |

查询采用 UUID 倒序 keyset，最多读取 limit+1 行；仅接受 10/20/50。游标绑定 tenant、当前成员、offering、列表种类、目标、筛选和条数。未知／重复参数、伪造模式、错误目标、旧筛选游标和向只读路径 POST 均拒绝；游标仅为位置，不授予权限。

每次读取继续通过真实 Identity／Bridge／业务事务及 `Learning.access`，核验当前角色范围、任教或 Enrollment、课程未归档；租户管理员没有隐式作答或评分权限。精确目标受 offering／tenant／owner 检查，不通过客户端提供的 mode 或 membership 事实授权。活动只向学生投影当前已发布版本；尝试固定其原 activity_version。评分当前值与本页公开历史在同一 SQL statement 投影，学生不返回评分草稿。

原聚合 GET 和原 POST 命令合同保留，写入／CAS／锁序／容量与审计不改；新页面不发 Learning／Assessment 聚合 GET。网关仅为新增只读分页路径允许编码后的查询，不放开编码路径或旧写入 query。未新增或修改 migration、helper、ACL、receipt profile，冻结生产语义不变。

## LOCAL 验证与运行

`pnpm verify:zhiban:m6:records` 复用 workspace disposable 生命周期，以 `--learning-records` 进入定向旅程；专用 PG16 **56510**，数据库 `zhiban_m6_records_disposable`，仅私有 Unix socket，受信 HTTPS **3454**。追加 `--serve` 保留演示；账号只写入该自建根目录的 0600 `accounts.json`，正常退出后才停止／删除自己的 cluster。

[清理完成的验收](evidence/m6-learning-records-local.json) **12/12 PASS**：初始 621 个已发布活动及 1 个草稿、620 次本人尝试及另一学生的尝试、620 个提交版本和 620 条成绩发布／更正记录。覆盖四类 >500 记录完整遍历、学生隔离和草稿隐藏、游标／参数／目标拒绝、固定发布版本、页外最新状态、第三页成绩历史及返回、提交响应丢失后原键重试不重复审计／版本、621 次尝试上限、延迟响应时移除课程、后台会话检查保留页位置、教师评分发布更正、390px、退班／归档／退出拒绝。

相关 Learning／Assessment／Academic／Workspace／Management／Progress／Analytics 单元及依赖回归 **68/68 PASS**；定向 TypeScript、ESLint、Prettier 通过。源码、相关测试、package／lock 和实际 runner bundle 均记录 hash；已清理记录不等同仍运行演示。[演示记录](evidence/m6-learning-records-demo-local.json) 单列 `RUNNING_DISPOSABLE`；入口为 [本地工作台](https://127.0.0.1:3454/zhiban)。同一浏览器只保留本次隔离演示标签；不同端口的 `127.0.0.1` 页面共享主机 Cookie，不应并行登录不同测试数据库。

旧 M1–M6／CI 证据继续绑定原来源和范围，不回填为本轮候选。本轮未执行全仓 build、压力基准、生产部署或 CI signoff。旧聚合接口仍有原上限；学生个人概览／教师统计自身的活动选择与历史读取不因本轮自动扩展，后续有实际大数据需求时独立接续。本 fixture 不启用 M5 内容 provider，不证明 Native／维护或完整内容发布签收。真实 55432/55433、HBA／凭据 staging 和“保留待补”隔离保持。

[内置浏览器实际页面](evidence/m6-learning-records-iab-local.png)确认当前候选的活动搜索、十条尝试页和精确提交页；[最终核对](evidence/m6-learning-records-checkpoint-local.json)记录来源一致性、12／68 和 16 份既有 migration hash 未变。前一演示进程中断后的自建 PG 根清理单独记录为[受控回收](evidence/m6-learning-records-demo-pre-passive-close-local.json)，不伪称走完正常退出协议。

下一建议：教师待评分列表与筛选，减少逐层寻找待评分提交；课程负责人选择器与操作历史仍单列。建议模型 GPT-6.1 Sol / medium。
