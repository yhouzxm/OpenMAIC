# P1/P5 画像与风险支持旧聚合入口

2026-10-23，默认3461 LOCAL包，画像维度继续 **REVIEW**。只补导航、受限课程选择和返回上下文，复用已有证据观察／概念纠错／规则审阅／人工跟进／提醒／补救。不新增数据API、ACL、表、migration或画像算法，不计算能力分、排名或自动诊断。

## 旧分支与8条接线

本地 `origin/feature/zhiban-mechatronics`／`0fa0a15e8b12ae9e4f7a2d78e80338874599bbae` 的page实际分别渲染Teacher／Student ProfileConsole、RiskConsole；课程内版本接受courseId。保留“查看课程证据与支持”的概念，不恢复旧维度计算、未经批准的AI预测或旧权限字符串。

| 旧入口 | 当前行为 |
| --- | --- |
| `/zhiban/teacher/profiles` | 当前任教课程搜索／状态筛选／分页，进入课程画像聚合页 |
| `/zhiban/student/profile` | 当前Enrollment可见课程选择，进入本人课程证据与观察 |
| `/zhiban/teacher/risks` | 当前任教课程选择，进入教师私有规则审阅与支持导航 |
| `/zhiban/student/risks` | 当前在读课程选择，进入本人公开提醒／任务／观察；不读教师风险队列 |
| `/zhiban/teacher/courses/:course/profiles` | 课程聚合：证据画像、概念纠错、原成绩簿 |
| `/zhiban/student/courses/:course/analysis` | 课程聚合：本人已发布学习观察、公开纠错、本人正式成绩 |
| `/zhiban/teacher/courses/:course/risks` | 课程聚合：私有风险事实／规则审阅、待跟进／人工记录、补救计划及概念纠错 |
| `/zhiban/student/courses/:course/support` | 课程聚合：本人站内提醒、补救任务、公开概念纠错和明确发布的学习观察 |

教师侧栏“学习分析／风险预警”、学生侧栏“学习档案／学习支持”已接入。教师单数 `/teacher/profile` 继续是个人设置；学生 `/student/settings` 也保持原设置功能，不与学习画像混用。

## 上下文、授权和隐私

全局入口支持单个space或tenant，以及当前UUIDv7格式的courseId课程过滤。无参数旧书签经原Identity spaces分页取当前会话空间：单空间自动选择，多空间显式选择，不推断租户。复用原Workspace受限10／20／50条分页和状态／搜索合同；角色／courseId过滤后当前页无匹配但仍有cursor会提示继续下一页。单次最多100页，可缩小搜索或增加每页数量。

课程聚合页接受space、offering和可选hubCourse（必须等于路径课程）。缺少空间／教学班的旧深链接提供带courseId的受限选择列表；不猜测旧数字ID对应关系。进入聚合页前精确核对Workspace返回的course_id／offering／mode；关闭课程也按原服务资格检查。未知／重复／畸形参数、错误角色／教学班不展示功能卡片。

聚合页不获取或复制P5记录，只提供固定同源已交付功能链接。每个功能页经原课程壳及对应服务再次核验。supportFrom只允许profile／support；hubCourse仅保留同课程过滤，二者从业务API查询中剥离，不作为授权事实。返回链接固定到当前角色／课程的旧聚合页，不接受任意return URL。成绩旧入口的gradeCourse不能与supportFrom混用。

课程功能→聚合页→全局列表保留空间、教学班、courseId及本标签已查询筛选／分页。sessionStorage只存导航状态，按Membership／角色／类别／课程过滤分键，不缓存名册、成绩或画像记录。Session广播或离页时中止请求并清空当前视图。

学生聚合页**没有教师risk／analytics链接或请求**；学生只经原本人API读取已公开内容。教师风险事实、阈值、审阅和跟进说明继续私有；提醒需原显式发送／确认，不由页面读取自动确认。未提交、草稿、私有规则命中及空记录不生成“掌握”或风险标签。

## LOCAL验证与适用范围

`node scripts/zhiban-local/verify-support-routes.cjs` 验证四个匿名全局入口和师生两个类别的实际侧栏、搜索、课程聚合页、全部既有功能链接及返回；逐个打开原画像／概念／成绩／教师risk与跟进／补救／学生提醒页，核对原页面与无错误状态。验证courseId经多级返回保留、裸课程深链接恢复选择、错误角色／教学班／全局参数拒绝。监测学生旅程的risk／analytics API请求为零，浏览器业务POST为零。

证据：[浏览器receipt](evidence/support-routes/browser-local.json)、[教师画像](evidence/support-routes/teacher-profile.png)／[教师支持](evidence/support-routes/teacher-support.png)、[学生画像](evidence/support-routes/student-profile.png)／[学生支持](evidence/support-routes/student-support.png)、[closeout](evidence/support-routes/final-closeout.json)。默认课堂未人工发布观察、提醒或补救计划，原API的真实空状态不冒充正向发布证明；原P5写入／授权／并发证明保留其独立范围。

当前真实fixture只有一个空间、一个教学班，本轮未重造多空间／大名单跨页旅程，沿用原Workspace合同。旧个人设置浏览器脚本已将原“画像入口404”断言改成“额外路径段404”，避免新入口被旧测试误报；不重签其历史receipt。

默认实例需刷新加载新路由，旧root三库及control文件已[私有备份并核验TOC](evidence/support-routes/private-backup.json)，未恢复演练。当前新合成账号与课堂只认 `pnpm trial:zhiban:info`。未操作真实55432／55433，未改已应用migration，未重跑PG16专项／完整课堂／模型／扫描／GitHubCI。此前P7源码包和各轮receipt保留原hash，不包含本轮入口增量。

下一完整功能建议沿P1/P6核对并接教师AI备课旧入口，优先复用已有原生生成→采用→发布；工具型Agent仍按原门禁，建议GPT-6.1 Sol / medium。
