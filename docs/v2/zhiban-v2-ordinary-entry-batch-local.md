# P1 普通旧入口批量收尾与两项检查修正（LOCAL）

2026-10-23，一包完成剩余三条普通入口及两项既有检查问题。不逐页重打P7，不运行完整课堂、模型、扫描或GitHub回归。复用当前Workspace、Learning和Classroom受限查询；无新业务API、权限、表、ACL或migration。

## 三条入口的实际语义

| 旧入口 | 当前处理 |
| --- | --- |
| `/zhiban/teacher/courses` | 复用现有任教课程选择组件与原Workspace受限查询；搜索／状态／10、20、50条分页、进入课程及返回保留本标签查询。教师“我的课程”及课程返回已统一；不恢复旧机电课程自动跳转 |
| `/zhiban/student/courses/:course/activities/:activity` | 当前Academic活动UUID经精确课程／教学班／STUDENT资格和原activities查询确认后，进入原coursework并按活动hash定位；缺上下文先选教学班，不自动开始Attempt |
| `/zhiban/student/classroom/:binding` | 只将经原classrooms受限查询确认的**当前Classroom session UUID**定位到原coursework课堂卡片；缺上下文先选教学班，不自动ENTER_TASK |

旧源码的student/classroom实际是Native binding＋场景播放器，旧activities也是Native／机电／实验宿主。本包是当前普通教学入口的明确替代，**没有旧数据库ID转换表，不声称恢复这些Native功能**。旧Native binding、活动slug、机电站点／scene参数不能直接转换为当前Academic活动或课堂；不猜测、不授予权限。找不到当前目标时显示未迁移／不可访问提示；课堂结束或不在开放窗口时提供本教学班活动／历史入口。Native Runtime、实验、PBL及其可信完成门禁保留。

深链接提供space或tenant、offering及可选courseId（活动路径必须等于路径课程）。未知／重复参数、错误角色／课程／教学班、畸形ID拒绝。无空间经原Identity spaces单空间自动／多空间选择；无offering按原受限分页选择，学生只见STUDENT行。当前目标核对后同源固定跳转，不接受return URL；实际页面再次独立检查原授权。导航／sessionStorage不作为权限事实。未发布教师草稿不能因已知ID进入，且不泄露标题。

复用既有全局教师备课／学生Tutor选择组件，按明确路径区分列表与深链接模式；原AI入口仍保留自身标题、链接和门禁。只存导航条件，按Membership／目标区分，不缓存活动、课堂或会话数据。课堂最多沿原API的100条当前可见会话边界，课程选择最多100页；不新增全库扫描或跨租户ID检索。

## 两项检查问题一次修正

1. 原workspace测试期待registrations经旧`/roster`映射，但实际默认服务已提供七类导入HTML且按路径默认ENROLLMENTS。本轮将公共别名明确归一到现有`/admin/import`资源，保留地址路径供默认类别识别；断言同步当前合同，并在真实管理员浏览器核对`导入类别=ENROLLMENTS`，不删除或跳过断言。
2. verifyOnboarding的调用传入其Input未声明、实现也未使用的store、security、operator、compositionConfig。本轮移除这些多余实参，不修改开户产品、权限或verifyOnboarding实现，不通过加any或放宽类型规避问题。

## 定向验证及证据

原workspace查询／cursor／路由测试文件全部通过，包含本包额外路径、编码路径及错误角色的路由拒绝检查。全量`tsconfig.build.json`类型检查通过；受影响代码ESLint、格式和JS语法通过。这里类型检查全量通过不等于全仓测试或开户专项运行通过；本轮未重跑开户生命周期。

`node scripts/zhiban-local/verify-ordinary-entry-batch.cjs` 验证教师旧课程列表／查询／返回、学生当前活动与当前课堂精确定位、无上下文选班、匿名／其他角色／错误课程或教学班拒绝、草稿不可见、结束课堂回退、重复／未知／旧scene参数拒绝，以及真实Enrollment导入默认类别。只经原教师API创建／发布／结束一个**无派发任务**的合成课堂；没有进入任务、开始Attempt、提交、评分或模型调用，并比较学生Attempt数量未增长。它不是完整课堂回归。

[浏览器receipt](evidence/ordinary-entry-batch/browser-local.json)、[教师课程列表](evidence/ordinary-entry-batch/teacher-courses.png)、[最终核对](evidence/ordinary-entry-batch/final-closeout.json)均LOCAL／非GitHub。当前fixture只有一个空间／教学班；选择器多空间或大名单跨页复用原合同，本轮不冒充已执行相应旅程。

实际路由矩阵按默认3461重新核对55个模板：**48个由当前页面接线接受，7个仍404**（4个PBL、2个实验、1个明确排除的机电验证页）。这只是路由接线核对，绝非48项完整产品签收；两个学生别名也不表示Native ID已迁移。相关P2、P4能力差额仍保留。

默认实例重建前已[私有备份三库／control并核验TOC](evidence/ordinary-entry-batch/private-backup.json)，未做恢复演练；当前账号与动态ID以`pnpm trial:zhiban:info`为准。新实例生成新合成课堂及账号；专项课堂最后保持ENDED，无任务。未操作真实55432／55433、未改已应用迁移、未提交／推送／CI。

P7包`zhiban-local-20261023-a6ef3a535563`与全部既有receipt保留原hash，本包是其后续源码增量，**没有重打P7或重签历史失败为通过**。两项检查在本包当前source下通过，历史记录保留当时失败。常规旧入口兼容到此成包收尾；下一完整产品差额应回到原P2/P4的学习进度／先修／完成规则，复用现有正式证据，阅读、聊天和HTML事件不冒充完成。建议GPT-6.1 Sol / medium；若引入新的跨Identity并发授权合同则用high。
