# 课堂草稿编辑与开放时间调整

2026-10-17。接续基础共享课堂，仅增加元数据编辑；不修改完整 Runtime、评分／完成或已应用 migrations。

| 命令 | 当前资格与状态 | 修改 |
| --- | --- | --- |
| EDIT_CLASSROOM | 当前任教、教学班 OPEN、课堂 DRAFT、revision 匹配 | 标题、说明、开放／关闭时间；revision+1 |
| RESCHEDULE_CLASSROOM | 同上，课堂 PUBLISHED（包括窗口已过期但尚未结束） | 仅开放／关闭时间；revision+1 |

时间区间仍为 `[opensAt, closesAt)`，null 表示无该边界。允许将关闭时间调至过去以立即拒绝新的课堂进入，也允许延长未结束课堂的窗口、推迟开放或清空边界。ENDED 仍为终态，不能通过时间调整重开。已发布课堂不得借请求字段修改标题／说明。UI 显示并按北京时间解释编辑时间；未修改的时间保留原毫秒精度，不因仅编辑标题而向分钟取整。

两个命令复用严格 DTO 字段集合、当前 Identity／任教关系、会话行锁、revision CAS、tenant 命令 key／digest 和同事务审计。与发布、结束、派发、进入并发时按同一会话行锁排序；旧 revision 拒绝。同 key／相同 payload 只返回原结果，不再次覆盖；当前资格仍先校验。审计记录字段名称、旧／新窗口和结果 revision，不复制作答或课堂说明。

窗口收窄不撤销已开始的 Attempt、不改活动截止／次数／重交政策、不删除历史提交或成绩。原 Content、Enrollment、Native／Bridge 校验继续独立执行；修改课堂时间不是修改学习活动规则。学生同步在可见标签每 5 秒进行，后端下一请求即重新裁定，不能将屏幕滞后当授权。

新增 `0002_classroom_edit.sql` 只授予 sessions 的 title、description、opens_at、closes_at 四列 UPDATE；0001 不改，不增加 DELETE／表级 UPDATE 或 Identity 权限。启动核验两条 ledger hash 与精确列权限，无 DDL。新的显示能力从后端 editingEnabled 取得；旧运行构建不返回该能力，因此共享静态 JS 更新后不会向旧后端显示不可用编辑控件。

表单保存成功关闭；输入留在本地编辑状态，冲突后不丢输入或改为新 revision 强行覆盖。用户须取消后读取最新数据再重新编辑。编辑时其他课堂写入／刷新被提示先保存或取消；外部导航提供明确放弃对话框。网络不确定结果继续使用原 key 重试，不另发覆盖命令。

验证采用独立 owned HTTPS 3463／PG16 56519，新增数据，不重启或重置3461／3462。新模式绑定固定 root 前缀、数据库、TLS 和 LOCAL receipt；只在 disposable 安装新 ACL。真实 PG55432／55433、完整 OpenMAIC／AI／维护输入与隔离状态保持。验证覆盖非任教／跨租户／管理员／学生拒绝、版本和发布竞争、时间调整与进入竞争、窗口恢复、原 Attempt 保留、终态拒绝，以及实际表单保存／取消／学生可见性。
