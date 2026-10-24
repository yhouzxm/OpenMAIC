# P1/P3 教师／学生全局成绩旧入口

2026-10-23，默认3461 LOCAL产品包。复用现有Workspace受限分页列表、课程授权壳、教师成绩簿／评分和学生本人结果；不新增业务API、ACL、表或migration。

## 原分支核对与范围

本地 `origin/feature/zhiban-mechatronics`／`0fa0a15e8b12ae9e4f7a2d78e80338874599bbae` 的两个实际page分别渲染TeacherGradebookConsole与StudentGradeConsole。旧教师组件支持课程选择／courseId，另含权重、总评、成绩项和申诉；旧学生组件还含跨课程结果和学生导出。这些规则不能借旧URL自动恢复。本包交付的是全局课程成绩入口，而非旧成绩算法、跨课程数据聚合或学生CSV。

| 入口 | 当前产品行为 |
| --- | --- |
| `/zhiban/teacher/grades` | 搜索／状态筛选／分页选择当前任教教学班，进入现有教师课程成绩簿、待评分和受限CSV |
| `/zhiban/student/grades` | 同样选择当前Enrollment可见教学班，进入本人已发布成绩、反馈及现有历史作答 |
| `?space=`／`?tenant=` | 同一空间上下文，两者不能同时出现；本人的会话spaces决定可用空间 |
| 无参数旧书签 | 原Identity spaces分页查询；单空间自动选择，多空间显示选择，零空间提供工作台恢复入口 |
| `?courseId=<当前课程UUIDv7>` | 复用旧教师链接参数为教学班列表的课程过滤；仍需选择可访问教学班，不把课程ID当成绩访问凭证 |

教师侧栏“学生成绩”、学生侧栏“测评与成绩”已启用。查询输入只在点击查询后生效；原API的10／20／50条、有界keyset分页及开放／关闭状态过滤复用。单次导航最多100页，可通过搜索或调整每页条数缩小范围。角色与courseId在已授权分页结果上再过滤；某页无匹配但仍有cursor时明确提示继续下一页，不把它当作全列表为空。页面无课程总评或跨课均分。

每条链接由服务器返回的course_id／offering生成，指向当前课程 `/grades?space=...&offering=...`。课程壳重新读取当前关系，教师成绩API／学生Progress API继续独立核验，列表行不是授权capability。用户改URL为另一角色不会获得对应数据；管理员也不借此变成任课教师。

## 返回与隔离

课程成绩页新增固定“返回全局成绩入口”，原“返回我的课程”及课程内导航保留。旧courseId限定通过只用于成绩页且必须等于当前课程ID的gradeCourse导航提示带回，不透传给业务API。全局页面的已查询搜索、状态、尺寸、当前游标页放入本标签sessionStorage，以Membership／角色／课程过滤分键，返回或刷新恢复。只存导航状态，不缓存成绩／名册；校验结构与长度，坏游标由原API拒绝，可重试重置。Session广播失效／离页时中止请求并清空当前视图。

未知参数、重复空间参数、tenant与space混用、畸形UUID和外部next地址拒绝；旧数字courseId不映射到当前课程，显示无效地址，不猜测对应关系。未登录或无权空间显示工作台恢复入口，不展示成绩。不同空间不自动合并；旧 `grade:read`／`grade:publish` 字符串不替代冻结V2授权。

## LOCAL验证与证据

`node scripts/zhiban-local/verify-global-grades.cjs` 只针对已运行owned3461：匿名两个入口、两角色实际侧栏→全局列表→原课程成绩→返回／刷新保留搜索与每页大小；中文搜索、空结果、CLOSED过滤、分页按钮、courseId／tenant、裸书签、错误角色／空间／参数及额外路径。教师确实看到原成绩簿和跨页CSV入口，学生看到本人88/100而没有成绩发布按钮。无业务写入或模拟provider。

[浏览器receipt](evidence/global-grades/browser-local.json)、[教师截图](evidence/global-grades/teacher.png)、[学生截图](evidence/global-grades/student.png)及[closeout](evidence/global-grades/final-closeout.json)记录本轮source/root。当前真实fixture只有一个空间、一个教学班，未用本包重新构造多空间／跨页大名单；分页授权及cursor合同沿用原Workspace实现，不能把本轮单页旅程冒充大名单或多空间复验。

新路由需默认实例受控刷新，旧root三库及control文件已[私有备份并核验TOC](evidence/global-grades/private-backup.json)，未恢复演练。当前是新合成课堂与新账号，以 `pnpm trial:zhiban:info` 为准。扫描／模型／完整课堂／PG16专项和GitHubCI均未重复执行；既有dirty候选保留，不改已应用migration，不触碰真实55432／55433。

前一P7包 `zhiban-local-20261023-7b5fc1a08e0d` 及个人设置包维持原hash／证据范围，不包含本次新全局入口。未提交、推送或CI派发。权重／总评／申诉、跨课程CSV和历史退班课程列表仍另定规则，不因为接通旧路径而宣称全量成绩模块完成。

下一完整功能建议沿P1/P3接管理员与登录旧入口兼容包（核对/admin、admin/users、login实际页面后复用当前账户／工作台），建议GPT-6.1 Sol / medium。
