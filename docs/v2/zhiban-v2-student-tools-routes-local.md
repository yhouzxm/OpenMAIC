# P1/P6 学生 AI 工具旧入口兼容（LOCAL）

2026-10-23，沿原P1–P7主线。旧工具页复用当前课程Tutor／原生聊天Agent接线；不另建聊天服务，不启用AI Peer、工具型Agent、画像维度或可信Runtime。

## 页面与旧功能边界

本地旧分支 `origin/feature/zhiban-mechatronics` @ `0fa0a15e8b12ae9e4f7a2d78e80338874599bbae` 的课程tools页实际组合StudentCourseTutor与StudentCoursePeer。本轮只替代Tutor入口；Peer仍按原REVIEW／启用门禁，不将旧工具页全部能力标为已移植。

| 路由 | 当前用途 |
| --- | --- |
| `/zhiban/student/courses/:course/tools` | 原课程壳＋原Tutor页面，展示旧入口用途说明；复用教师开关、当前课程资格、本人对话／固定讲义／历史／取消 |
| `/zhiban/student/tools` | 新增的导航选择页，供学生侧栏和缺上下文的旧课程链接选择当前有权限的教学班；不是新增AI业务 |
| `/zhiban/student/courses/:course/tutor` | 原生智伴Tutor接线路径保留；与tools使用同一服务、会话和本人权限，不复制历史 |

学生侧栏增加“AI 学习辅导”。学生课程概览及各功能页的同名课程内导航统一指向tools，原tutor路径仍将该导航标为当前页；教师Tutor入口不变。学生没有教师设置控件；管理员或教师不能借学生路径冒用学生权限。

## 导航上下文与治理

选择页支持单个space或tenant、可选courseId。当前会话一个空间自动选择，多空间明确选择（最多1000个空间）；原Workspace受限查询支持搜索、状态、10／20／50条分页，按STUDENT行与可选课程过滤。过滤后空页仍可继续原cursor，最多100页；未猜测旧数字ID。sessionStorage按Membership／课程分键，只记导航查询，不缓存对话。

课程路径严格接受space、offering及仅用于返回的toolsCourse（必须等于路径课程）；未知／重复／畸形参数与不匹配的返回课程拒绝。缺少空间或教学班的旧链接可返回带courseId的选择页。课程壳先精确核对原Workspace的course_id／offering／STUDENT模式，Tutor服务继续逐次核验原授权。toolsCourse从业务API查询中剥离，不是权限或任意return URL；返回固定同源选择页恢复课程过滤。

教师开关默认关闭；关闭不能新建或继续提问，本人历史按原合同保留。模型配置／讲义资格和生成交付屏障不变。旧入口不会启用开关、自动创建会话或发送问题，不将聊天当作成绩、通知、画像或完成证据。本人对话不向教师开放，AI Peer没有入口或调用。原未发送问题的离开保护继续有效。

## LOCAL验证与适用范围

命令：`node scripts/zhiban-local/verify-student-tools-routes.cjs`。受影响真实浏览器旅程包括匿名登录要求、学生侧栏与选择、筛选返回／courseId、旧深链接恢复、原课程目录导航、教师未启用拒绝新建、畸形／重复参数和错误教学班拒绝、教师／管理员不能冒用学生页、额外路径404。

正向使用原教师页面启用→学生tools创建真实本人空会话→未发送问题离开取消保留→结束会话→原tutor与tools／刷新读取同一已结束历史→教师列表无该会话且精确读取404→教师关闭恢复原状态→学生仍能看本人历史。只执行原SET_POLICY、CREATE_SESSION、CLOSE_SESSION；没有ASK、供应商请求、注入回答或伪造COMPLETED。首轮在独立API客户端的本机CA信任检查处停止，浏览器本身证书验证正常；最终改用已受信浏览器的同源请求核对404，没有关闭证书校验。该首轮测试实例未保留为最终证据。空会话不作为真实AI输出证明；此前[课程Tutor真实两轮旅程](zhiban-v2-course-tutor-local.md)仍只证明其原run／source范围，不重签。

[浏览器receipt](evidence/student-tools-routes/browser-local.json)、[学生旧工具页](evidence/student-tools-routes/student-tools.png)和[最终核对](evidence/student-tools-routes/final-closeout.json)标LOCAL／非GitHub。当前fixture一个空间／教学班，多空间或大名单跨页仍沿用原Workspace合同，未重造额外课堂；没有新授权或并发服务边界，不重复PG16专项、完整课堂、模型、扫描或CI。

默认3461重建前对旧三库及control作了[私有备份／TOC核验](evidence/student-tools-routes/private-backup.json)，不声称恢复演练；新实例生成新合成课堂和账号，查看 `pnpm trial:zhiban:info`。最终LOCAL浏览器结果PASS，运行源码hash核对无漂移；本轮合成测试留下一个已结束、无turn的本人空会话，并恢复教师开关关闭。截图记录恢复开关前的旧入口历史页，不冒充最终开关状态。未操作真实55432／55433、未改已应用migration、未提交／推送／调度CI。旧P7源码包未重打，不包含之后入口增量。

下一完整功能建议：教师课程设置／任教名单旧入口，按现有管理员管理职责与教师受限读取接线，不恢复越权配置。建议 GPT-6.1 Sol / medium；若新增跨Identity授权或并发合同再用high。
