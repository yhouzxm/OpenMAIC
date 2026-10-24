# P1/P6 教师 AI 备课旧入口兼容（LOCAL）

2026-10-23，沿原 P1–P7 主线，默认3461。只接导航与课程上下文，复用已有原生生成任务→教师确认大纲→审核采用文字草稿→教师编辑保存→显式发布。没有新增生成流水线、业务API、数据表、ACL或migration；不改变采用／发布与课程授权合同。

## 两条旧 URL 与用途替代

本地 `origin/feature/zhiban-mechatronics` @ `0fa0a15e8b12ae9e4f7a2d78e80338874599bbae` 的 `/teacher/agents` 实际是 TeacherAgentConsole 干预控制台，课程内 agents 还组合 Tutor／Peer。**本轮按用户要求将这两个旧URL替代为现有教师备课入口，不声明旧干预 Agent 控制台已移植。** 页面文字明确说明用途，旧监控、干预任务、AI Peer及工具型Agent未启用；原课程Tutor仍由自身开关与授权控制。

| 路由 | 当前行为 |
| --- | --- |
| `/zhiban/teacher/agents` | 原Identity空间选择→原Workspace受限任教课程搜索／状态／10、20、50条分页→课程备课 |
| `/zhiban/teacher/courses/:course/agents` | 在既有课程壳中加载原教学内容页，直接展开教师AI备课面板，并保留手工讲义编辑器 |

教师侧栏以“AI 备课”替代旧“智能体中心”占位；教师课程概览和已有课程功能页的课程内导航均增加“AI 备课”。原 `resources` 手工编辑与原AI折叠面板继续可用，学生没有备课导航。初次读取任务后显示已读取数量或真实空状态，修正原面板读取成功仍停留“处理中”的提示。

## 上下文与授权

全局支持space或tenant及可选courseId；未知／重复／畸形参数拒绝。无参数旧书签复用当前会话spaces：单空间自动进入，多空间显式选择，最多1000个空间。只展示原Workspace返回的TEACHER行；管理员模式或学生不能借路径取得任教资格。课程过滤在原受限分页结果上执行；空匹配页如有cursor可继续下一页，最多100页。

课程内接受space、offering，以及仅用于列表返回的可选aiCourse（必须等于路径课程）；未知／重复参数或错误绑定拒绝。缺少空间／教学班的旧深链接提供同课程过滤的选择入口，不猜测旧数字ID。原课程壳精确检查course_id、offering、mode；每个内容／生成API继续独立核验原授权，URL和sessionStorage不是授权事实。

aiCourse从业务API查询中剥离，只让固定同源返回链接恢复全局courseId。全局按Membership／课程过滤分键保存查询、状态、页长及cursor，不缓存任务、讲义或凭据。采用后的自动打开仍走原事件；后备“打开已采用草稿”保留agents路径、aiCourse与draft hash，不误切为已发布预览。未保存备课要求及讲义仍使用原离开保护。发布保持原独立按钮，不由入口、生成完成或采用自动触发。

## 本地验证和证据边界

运行 `node scripts/zhiban-local/verify-authoring-routes.cjs`，仅验证受影响旅程：匿名入口要求登录；真实教师经侧栏、筛选和旧课程URL进入原模型能力与编辑器，面板自动展开，未保存离开取消保留要求，返回筛选／courseId、裸书签及深链接恢复；原resources和课程概览均能进入AI备课。错误上下文、教学班、学生／管理员冒用被拒绝，学生／管理员不发生成API请求，额外路径仍404。

本轮浏览器**不调用模型、不注入完成run、不执行采用或发布写入**。当前配置的真实模型就绪只证明原能力接线可读；此前真实“生成→采用→发布”证据保留在[AI备课真实旅程](zhiban-v2-ai-lesson-real-local.md)及[公式／采用入口产品包](zhiban-v2-lesson-product-p4-local.md)各自原source／run范围，不重签为本轮重新生成证明。首轮原resources页在默认5秒等待内未出现编辑器；无产品改动重跑即通过。本轮将相关浏览器等待对齐既有读取上限15秒，未放宽授权或成功判断。新入口没有改变原生成或发布服务；其接口与新授权／并发边界未扩展，不重复原专项或完整课堂。

本轮 [浏览器receipt](evidence/authoring-routes/browser-local.json)、[课程页](evidence/authoring-routes/teacher-course.png)、[课程选择](evidence/authoring-routes/teacher-selector.png)、[最终核对](evidence/authoring-routes/final-closeout.json)均标LOCAL。真实fixture只有一个空间／教学班，多空间及大名单分页沿用原Workspace合同，未重造额外课堂。缺少模型时仍由原capability禁用生成，手工备课保留，不使用mock冒充成功。

默认实例重启前已对三库及control做[私有备份／TOC核验](evidence/authoring-routes/private-backup.json)，未声称恢复演练。重启生成新合成课堂和账号，以 `pnpm trial:zhiban:info` 为准。未操作真实55432／55433，未改已应用migration，未提交／推送／CI；旧P7归档未包含本轮及此前入口增量，不自动重打包。扫描器和Runtime等deferred gates不随本轮启用。

下一完整功能建议：学生 AI 工具旧入口兼容，复用现有课程Tutor，Peer／工具型Agent继续原门禁。建议 GPT-6.1 Sol / medium。
