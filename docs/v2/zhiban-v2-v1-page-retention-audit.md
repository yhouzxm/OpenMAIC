# V1 页面与功能保留审计

> 2026-10-17 范围更新：用户已要求恢复旧版页面结构与视觉，本文件早期“不保证视觉一致”的口径不再用于后续 UI 交付。以[完整迁移计划](zhiban-v2-migration-completion-plan.md)与[逐页差距矩阵](zhiban-v2-ui-page-gap-matrix.md)为准；旧业务服务／权限不照搬，原 REVIEW／REMOVE 决定未被自动改为批准。下面保留原审计事实。

审计对象：只读 Git ref `refs/remotes/origin/feature/zhiban-mechatronics`，HEAD `0fa0a15e8b12ae9e4f7a2d78e80338874599bbae`。逐项核对 `app/zhiban/**/page.tsx` 的实际页面入口、页面引用的业务组件和可见流程，并与 `docs/v2/v1-capability-inventory.md` 及 M1–M7 计划对照。旧分支只作需求证据，不复制页面、数据库服务或组件。

## 保留决定

保留旧页面实际承载的业务需求，但不保证 V1 URL/视觉/内部实现兼容。所有 36 项能力沿用能力清单已定的 KEEP_CONCEPT / REWRITE / ADAPT / REVIEW / REMOVE 策略；尤其机电竞赛特定实现仍为 `REMOVE_FROM_CORE`，作为需求和验收证据归档，不迁入通用核心。M1 登录/工作台与 M2 管理员学期、课程、班级、教学班、教师分配及 Enrollment 已落地；M3 先补通用活动发布、个人 Attempt 和提交。需要真实 OpenMAIC Runtime 的交互活动、完整课堂、专用机电站点以及尚未通过产品/证据决策的 PBL/EMA/AI 等仍保留在后续里程碑，不以隐藏入口表示需求取消。

## 页面逐项映射

| V1 页面 | 实际页面职责（按页面组件/服务入口） | V2 保留位置 |
| --- | --- | --- |
| `/zhiban/login` | `ZhibanLoginPage`：账号登录 | M1 已交付；Identity 重写 |
| `/zhiban` | `ZhibanEntry`：按教师/管理员/学生身份与选课进入对应工作台 | M1/M2 已交付并接真实资格 |
| `/zhiban/classroom` | 课堂旧入口重定向 | M5 业务 dispatch；M7 完整 Classroom |
| `/zhiban/mech-iframe-validation` | `MechIframeValidation`：机电 iframe/sandbox 验证页，不是通用课程页面 | 仅保留安全需求/验证用途；通用互动到 M7，机电竞赛实现不入核心 |
| `/zhiban/admin` | `AdminConsole`：管理员工作台 | M1 控制面分离；M6 治理增量 |
| `/zhiban/admin/academic` | `AcademicConsole`：课程/学期/行政班/教学班/教师/学生管理 | M2 已交付，管理员管理模式 |
| `/zhiban/admin/users` | `DirectoryConsole`：用户目录 | M6 受控目录治理 |
| `/zhiban/admin/students` | `StudentRegistryConsole`：学生登记/目录 | M6；M2 仅受控添加已有成员 |
| `/zhiban/admin/import` | 导入控制台入口与权限检查 | M6 staging/preview/approve/apply |
| `/zhiban/admin/import/users` | `OucImportConsole` 用户导入视图 | M6 外部目录导入适配；OUC 专属字段不成为通用模型 |
| `/zhiban/admin/import/students` | `OucImportConsole` 学生导入视图 | 同上 |
| `/zhiban/admin/import/classes` | `OucImportConsole` 行政班导入视图 | 同上；与教学班区分 |
| `/zhiban/admin/import/registrations` | `OucImportConsole` 注册/选课导入视图 | M6 导入；M2 当前为管理员逐项管理 |
| `/zhiban/teacher/courses` | `TeacherPortal`：任教课程列表及机电课程特例路由 | M2 任教范围列表；M3 活动入口；机电旧特例不复制 |
| `/zhiban/teacher/courses/[courseId]` | `TeacherCourseOverview`：课程结构/发布版本；机电课程跳转学习中心 | M2 课程/版本与任教范围；M3 作者活动；内容编辑 M5 |
| `/zhiban/teacher/courses/[courseId]/settings` | `TeacherCourseConsole`：课程设置 | M5 内容配置；M2 管理员持有 Course/Offering 管理职责 |
| `/zhiban/teacher/courses/[courseId]/classrooms` | `TeacherClassroomConsole`、`CourseStructureDesigner`、`CourseContentConsole`、`TeacherCourseworkConsole`：课堂、结构、内容、作业组合入口 | M3 通用活动/作业；内容编辑 M5；课堂 M5/M7 |
| `/zhiban/teacher/courses/[courseId]/students` | `TeacherCourseStudents`：课程学生名册 | M2 任教资格内名单 |
| `/zhiban/teacher/courses/[courseId]/teachers` | `TeacherCourseTeachers`：任教教师名单 | M2 任教分配与范围 |
| `/zhiban/teacher/courses/[courseId]/grades`、`/zhiban/teacher/grades` | `TeacherGradebookConsole`：课程/全局成绩簿 | M4 评分、发布、更正 |
| `/zhiban/teacher/courses/[courseId]/analytics` | `TeacherTeachingAnalytics`：课程教学分析 | M4 基础提交查询；正式指标 M6 |
| `/zhiban/teacher/courses/[courseId]/learning-center` | `LearningCenter` 教师预览，含课程学习单元入口 | M5 supported content；M7 完整课堂/运行器 |
| `/zhiban/teacher/courses/[courseId]/learning-center/[stationId]` | `LearningStation` 教师预览单个学习站点 | M5/M7；具体机电竞赛站点不进入核心 |
| `/zhiban/teacher/courses/[courseId]/learning-center/analytics` | `TeacherVirtualLabAnalytics` 虚拟实验分析 | M7 VirtualLab（REQUIRED_LATER） |
| `/zhiban/teacher/courses/[courseId]/profiles`、`/zhiban/teacher/profiles` | `TeacherProfileConsole` 学生画像 | M6；先定维度、证据和隐私 |
| `/zhiban/teacher/courses/[courseId]/risks`、`/zhiban/teacher/risks` | `TeacherRiskConsole` 风险审阅 | M6 风险治理与人工处置 |
| `/zhiban/teacher/courses/[courseId]/pbl`、`/zhiban/teacher/pbl` | `PblProjectConsole` 项目/问题式学习管理 | M7；PBL v2 对比和 REVIEW 决策后 |
| `/zhiban/teacher/courses/[courseId]/agents`、`/zhiban/teacher/agents` | `TeacherAgentConsole`、`TeacherCourseTutor`、`TeacherCoursePeer`：课程/教师 AI 支持 | 受控 authoring M5；Tutor/Peer M7 与单独治理 |
| `/zhiban/teacher/classrooms` | `TeacherClassroomConsole`：教师课堂管理/启动入口 | M5 dispatch；M7 U01 完整课堂 |
| `/zhiban/teacher/profile` | `TeacherPersonalSettings`：教师个人资料/设置 | M6/个人资料阶段；Identity 安全边界仍由 M1 |
| `/zhiban/teacher/virtual-lab` | `TeacherVirtualLabAnalytics`：虚拟实验分析入口 | M7，能力契约/真实 host gate |
| `/zhiban/student/classrooms` | `StudentCourseCatalog`：学生可访问课程/课堂列表 | M2 Enrollment 投影；M3 学习任务入口 |
| `/zhiban/student/courses/[courseId]` | `StudentCourseStructure`：课程结构与学习工作区 | M2 已有课程可见性；M3 学习活动列表 |
| `/zhiban/student/courses/[courseId]/introduction` | `StudentCourseIntroduction`：课程介绍 | M5 支持内容 |
| `/zhiban/student/courses/[courseId]/coursework` | `StudentCoursework` 加讨论区内容：作业/提交与讨论 | M3 文字提交；讨论功能另行纳入内容阶段 |
| `/zhiban/student/courses/[courseId]/activities/[activityId]` | 按活动分派机电 `VirtualLabRunner` 或 gated `OpenMaicClassroomPlayer`，并有活动跟踪/Agent bridge/先修站点守卫 | M3 只开放核准的通用文字活动；OpenMAIC Runtime/互动/实验依 M5/M7 gate；保留资格与证据语义 |
| `/zhiban/student/courses/[courseId]/resources` | `StudentCourseContent` 资源列表 | M5 资源映射/受支持资源；不复制 blob |
| `/zhiban/student/courses/[courseId]/learning-center` | `LearningCenter` 学习中心及访问状态 | M5 内容；M7 完整 25-scene/课堂播放；机电专用站点不入核心 |
| `/zhiban/student/courses/[courseId]/learning-center/[stationId]` | `LearningStation` 单站点及先修/访问守卫 | M5/M7 分类型迁移；保留先修概念 |
| `/zhiban/student/courses/[courseId]/analysis`、`/zhiban/student/profile` | `StudentProfileConsole` 学习画像/分析 | M6，需定义有效证据及维度 |
| `/zhiban/student/courses/[courseId]/grades`、`/zhiban/student/grades` | `StudentGradeConsole` 成绩查看 | M4 只读本人已发布结果 |
| `/zhiban/student/courses/[courseId]/support`、`/zhiban/student/risks` | `StudentRiskConsole` 风险/支持视图 | M6 隐私与支持策略 |
| `/zhiban/student/courses/[courseId]/tools` | `StudentCourseTutor`、`StudentCoursePeer`：Tutor/Peer | M7；AI Peer 有独立 REVIEW/安全审查 |
| `/zhiban/student/settings` | `StudentPersonalSettings`：学生个人设置 | 个人资料阶段；认证/Session 继续用 M1 Identity |
| `/zhiban/student/classroom/[bindingId]` | `OpenMaicClassroomPlayer`、进度跟踪、EMA 提示、Agent bridge、scene dispatch | M5 只做经 gate 的业务 dispatch；M7 U01 完整播放；EMA/AI 决定另列 |
| `/zhiban/student/pbl`、`/zhiban/student/pbl/[instanceId]` | `StudentPblConsole`、`PblInstanceRunner`：项目列表和实例执行 | M7，PBL REVIEW 后按新的 OpenMAIC/V2 合同重做 |

旧 route tree 还包含多处共享布局/跳转，不视为额外业务能力。按组件检查，学生 activity URL 实际承载多种执行器；因此 M3 的文字提交不能替代旧交互活动的保留需求，也不能复用旧播放器冒充已完成 Runtime。

## M3 已确认产品范围

用户在本次逐页对照后选择自定义规则：可设置截止时间、重交和尝试次数限制，并明确要求落实数据模型、API、页面及本地验证。M3 据此实现通用 `TEXT_RESPONSE` 路径；具体生命周期、权限、版本、UTC 边界与证据见 [M3 交付记录](zhiban-v2-m3-learning.md)。该开发范围不代表 R1 release manifest 批准，也不改变 V1 全量保留矩阵。
