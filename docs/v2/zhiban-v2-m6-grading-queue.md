# M6 教师待评分列表与筛选

2026-10-15。基线 `refactor/zhiban-v2` / `daf63afa83470d24a9ed41d171c6a17f8a80adb6`；保留既有未提交候选，状态 `LOCAL_VERIFIED / UNCOMMITTED_CANDIDATE`。NO COMMIT/PUSH/CI。

## 使用与口径

教师工作台的每个任教教学班新增“待评分与成绩”，直接进入 `/zhiban/grading?tenant=…&offering=…`。默认显示待处理，即未评分或评分草稿待发布；可单独选择未评分、待发布、已发布和全部。支持学生姓名／完整成员 ID／活动标题搜索，活动选择器独立按十条查询／翻页并精确选定，评分名单支持 10/20/50 条及前后翻页。切换筛选重置页位置，不读取全班 Learning／Assessment 快照。

名单每次尝试仅收录其最新正式 Submission；未提交尝试及已被同一次尝试新版本取代的提交不进入名单。不同尝试各自保留最新正式提交，不擅自改为“每个学生只评分最后一次尝试”。已发布历史提交的更正仍可从学习记录进入。列表不是课程完成率、成绩总评或催交通知。

活动名称使用该尝试固定的 activity_version，教师编辑未发布草稿不会改变队列展示或让草稿标题进入搜索。学生名称来自同租户 Academic people；列表不带作答、未提交草稿或评分反馈，只在点开具体提交时读取正式答卷及其评分历史。

“打开评分”直接显示精确答卷、分数和反馈表单。保存后名单变为待发布；发布后从默认待处理名单移出，编辑区保留已发布结果。已发布筛选可查看／更正，沿用原公开说明和不可变发布历史。命令 ACK 已确认后才刷新列表；响应丢失保留原命令号、暂停当前评分表单其他操作并支持原键重试，不重复追加更正或审计。

## 授权、并发与接线

新增只读 GET `/api/zhiban/assessment/:tenant/offerings/:offering/queue`，允许 `q,activity,member,state,limit,cursor`；活动／成员可不限定，状态默认为 TODO，条数仅 10/20/50。UUID 倒序 keyset 读取 limit+1；游标绑定当前成员、租户、教学班、种类、筛选和条数，是实时位置，不提供总页数或跨页冻结快照。

查询复用原 Identity／Bridge／Academic 事务及 `Learning.access(...,'TEACHER')`，要求当前有效教师 scope 和该班任教关系；学生、租户管理员、跨租户或未任教者拒绝，客户端参数不能赋予教师权限。结束任教、课程归档或退出后重新读取均拒绝。学生历史 Enrollment 的处理沿用原教师评分合同，没有新增“仍在班才能评分”的条件。

既有 `publications` 精确提交 GET 增加仅教师可见的 `review` DTO，包含固定标题、尝试引用、正式作答和服务器完整历史计算的 latest_submission；该 DTO 与当前评分／分页公开历史在同一 SQL statement 投影。学生不返回 review，也不返回评分草稿。详情重新读取后更新最新标记；如果名单展示后学生重交，旧未发布提交不能绕过原 SAVE／PUBLISH 的最新版本屏障。CORRECT 的原历史成绩语义不变。

工作台链接按每个教学班的服务器 TEACHER 模式显示，隐藏入口不作为授权。共享评分组件补齐请求终止、会话广播和根节点移除清理；关闭或切换选中答卷时，延迟详情不得回填其他编辑区。名单读取失败清除列表／编辑区并提供重试，不降级到旧聚合接口。原评分 POST、CAS、锁序、审计、不可变发布、授权 related 数量及冻结生产语义不变；无 migration／helper／ACL／receipt profile 变更。网关只为明确的 queue 只读路径允许编码 query，旧写入 query 仍拒绝。

## LOCAL 验证与运行

`pnpm verify:zhiban:m6:grading` 复用已有 disposable bootstrap／历史记录 seed，以 `--grading-queue` 运行定向旅程；自建 PG16 **56511**，数据库 `zhiban_m6_grading_disposable`，私有 Unix socket；受信 HTTPS **3455**。追加 `--serve` 保留演示，账号位于其自建根目录 0600 `accounts.json`。同一浏览器只保留本次隔离演示标签，避免不同端口的 `127.0.0.1` 共享 Cookie 干扰不同数据库的会话。

[清理完成的验收](evidence/m6-grading-queue-local.json) **12/12 PASS**，其 PG 已停止、自建根已删除。初始 622 份最新正式提交、616 份待处理（611 未评分／5 待发布）和 6 份已发布，另有大于 500 的活动／尝试／提交版本／成绩历史；完整遍历、状态分区、中文／活动／成员筛选、权限／参数／游标负向、页面直接进入与名单失败重试、活动选项翻页、评分发布、更正响应丢失的原键重试、重交竞态、关闭延迟详情、学生历史分页回归与无入口／无直接访问权限、390px、结束任教／归档／跨标签退出清理均通过。

相关单元／依赖回归 **72/72 PASS**；定向 TypeScript、ESLint、Prettier 通过。既有 16 份 migration hash 与前次证据一致，未执行全仓 build、压力基准或 CI signoff。[持续演示](evidence/m6-grading-queue-demo-local.json) 单列 `RUNNING_DISPOSABLE`，入口为 [本地工作台](https://127.0.0.1:3455/zhiban)；正常退出才生成本模式 close 记录，不声称持续演示已清理。

旧 M1–M6／CI 各保留原 hash 与范围，不自动视为新候选验收。真实 55432/55433、Native／维护 control、HBA／凭据 staging 和“保留待补”隔离保持；本轮不证明 M5 provider／完整发布 gate 已启用，不触发外部通知。

[内置浏览器截图](evidence/m6-grading-queue-iab-local.png)确认真实教师从课程入口进入，按学生／已发布筛选，并直接打开答卷、评分／更正和版本历史；未绕过证书。[最终核对](evidence/m6-grading-queue-checkpoint-local.json)记录 12／72、源码一致性及既有 migration hash。

下一建议：课程负责人受限选择器；操作历史仍单列。建议模型 GPT-6.1 Sol / medium。
