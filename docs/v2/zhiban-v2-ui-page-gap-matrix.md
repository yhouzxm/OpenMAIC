> 2026-10-24 原 P3/P6：[原生备课工作台、完整课件与采用发布](zhiban-v2-native-authoring-local.md)已接课程授权、原生编辑／资料／Agent、不可变文档资产和固定版本学生播放。实际模型、默认持久入口及证据范围以该包 closeout 为准；完整 AI 课堂、自主 PBL、全格式交付与多模态服务仍待，不重复移植已完成业务。原生差额总表见[复用核查](zhiban-v2-native-teaching-reuse-audit.md)。旧远端 run 40096542805 PASS 保留原冻结包范围。

> 2026-10-24 P7一次合并：[当前交接](zhiban-v2-p7-handoff.md)已收口资源／附件、课堂编排／人工实验、PBL／私人伙伴、六维／EMA、校内证书／跨班学分／受限服务正式AI评分及同机持久化。原证据范围保留，不增加旧路由／能力计数；下方历史待办以该页及主计划第6节的集中剩余边界为准。

> 2026-10-24 原P3：[新授权的校内成果与服务评分](zhiban-v2-attainment-autograde-local.md)新增教师／学生课程内 `attainment`、`auto-grading` 和全局本人／管理员成果页，复用现有课程壳和管理员入口。原生Quiz显示实际人类／服务归属；不借新增页虚增旧55路由迁移数量。

> 2026-10-23 批量收尾：三条普通旧入口已按[完整包](zhiban-v2-ordinary-entry-batch-local.md)接入当前业务；默认3461的55模板中48有页面接线、7未启用／排除。HTTP接受不等于Native功能或旧ID迁移完成。

# 旧版页面与当前实现差距矩阵

> 上游优先（用户2026-10-17新规则）：需求保留不等于旧实现必须移植。新版OpenMAIC已覆盖／更好时标“复用／薄适配／替代旧实现”，仅未覆盖部分移植；当前旧页面及能力状态只描述智伴接线缺口，不表示上游没有实现。具体版本与分流见[原计划第0节](zhiban-v2-migration-completion-plan.md#0-上游优先与去重2026-10-17-用户要求生效)。新原生界面可替代旧视觉；不再全量强制像素还原。

2026-10-23 P7按现有产品包补记功能去向；旧URL未实现仍单列。原2026-10-17定向对账，固定旧源SHA `0fa0a15e8b12ae9e4f7a2d78e80338874599bbae`：55 page／6 layout。原保留范围不变，当前唯一顺序见[移植计划](zhiban-v2-migration-completion-plan.md)。对照 `request-target.ts`、`workspace.js`、`course-page.js`、课程业务页面和既有LOCAL记录；未取得旧应用同尺寸运行截图，仅确认保留的旧布局需视觉对照；被新版替代的旧视觉不再列验收缺口。路径兼容只说明入口映射，绝不把所有旧入口指向同一工作台冒充完成。

| 旧版路由 | 页面族 | 当前业务范围 | 还缺什么 | 当前状态／交付批次 |
| --- | --- | --- | --- | --- |
| `/zhiban/admin/academic` | 教务管理 | 统一后台教务分区、分页表格与返回 | 优先采用新版界面，确认保留旧布局时再做视觉对照；不扩张到完整账户或多类导入 | 已接实际页面；P1视觉签收待验 |
| `/zhiban/admin/import/classes` | 批量导入 | 行政班 CSV 默认类别，接统一批量导入与批次结果 | 外部目录同步、更多未批准格式与生产保留策略另计 | LOCAL 完整包已接；见[产品包](zhiban-v2-academic-imports-local.md) |
| `/zhiban/admin/import` | 批量导入 | 七类 CSV 预览、逐行提交、本人持久批次分页／详情与结果下载 | 外部目录同步、更多未批准格式与生产保留策略另计 | LOCAL 完整包已接；见[产品包](zhiban-v2-academic-imports-local.md) |
| `/zhiban/admin/import/registrations` | 批量导入 | Enrollment CSV 默认类别；原单教学班名册专页保留 | 外部目录同步、更多未批准格式与生产保留策略另计 | LOCAL 完整包已接；见[产品包](zhiban-v2-academic-imports-local.md) |
| `/zhiban/admin/import/students` | 批量导入 | 正式档案 CSV 默认类别，原成员／角色／账户权限保持 | 外部目录同步、更多未批准格式与生产保留策略另计 | LOCAL 完整包已接；见[产品包](zhiban-v2-academic-imports-local.md) |
| `/zhiban/admin/import/users` | 批量导入 | 链接原普通账户开通；不以 CSV 自动创建全局 User或角色 | 批量全局账户及真实审批来源另需明确 | 受控账户开通入口已接；不宣称批量开户完成 |
| `/zhiban/admin` | 管理与目录 | 当前会话选择空间，经Workspace ADMIN核验进入管理员工作台 | [LOCAL旧入口包](zhiban-v2-admin-login-routes-local.md)已接；真实全局运营输入仍待 | 本包入口已LOCAL交付；P1/P3 |
| `/zhiban/admin/students` | 管理与目录 | 管理员学生目录搜索分页 | 优先采用新版界面，确认保留旧布局时再做视觉对照；不扩张到完整账户或多类导入 | 已接实际页面；P1视觉签收待验 |
| `/zhiban/admin/users` | 管理与目录 | 经原ADMIN模式核验进入受限成员账户目录，复用现有账户管理入口 | [LOCAL旧入口包](zhiban-v2-admin-login-routes-local.md)已接；不恢复旧删除／重置密码，真实全局运营输入仍待 | 本包入口已LOCAL交付；P1/P3 |
| `/zhiban/classroom` | 课堂／互动 | 教学班选择后进入现有基础课堂／学习活动 | 完整旧课堂播放器与Runtime证据仍缺 | 基础入口已接；完整P4未完成 |
| `/zhiban/login` | 登录与入口 | 复用原UserId／已确认@标识登录及空间上下文；固定管理员目标可登录后返回 | [LOCAL旧入口包](zhiban-v2-admin-login-routes-local.md)已接；手机／学号／工号不自动作为凭据 | 本包入口已LOCAL交付；P1/P3 |
| `/zhiban/mech-iframe-validation` | 技术验证 | 非通用产品页 | 旧路由尚未接完整页面；保留验证需求，不迁机电专用页 | 旧页未完成；排除／复核；范围决定 |
| `/zhiban` | 登录与入口 | 登录、三角色导航与课程列表 | 优先采用新版界面，确认保留旧布局时再做视觉对照；不扩张到完整账户或多类导入 | 已接实际页面；P1视觉签收待验 |
| `/zhiban/student/classroom/[bindingId]` | 课堂／互动 | 精确当前Classroom session进入原课堂卡片，缺上下文受限选班 | [普通入口批量包](zhiban-v2-ordinary-entry-batch-local.md)已接；旧Native binding未自动转换，完整播放器／Runtime仍待 | 普通入口LOCAL已接；Native能力P4另计 |
| `/zhiban/student/classrooms` | 角色课程首页 | 教学班选择后进入现有基础课堂／学习活动 | 完整旧课堂播放器与Runtime证据仍缺 | 基础入口已接；完整P4未完成 |
| `/zhiban/student/courses/[courseId]/activities/[activityId]` | 课堂／互动 | 精确当前Academic活动进入原作答／历史页，缺上下文受限选班 | [普通入口批量包](zhiban-v2-ordinary-entry-batch-local.md)已接；旧Native／机电ID、scene／实验门禁不迁入 | 普通入口LOCAL已接；完整Native活动P4另计 |
| `/zhiban/student/courses/[courseId]/analysis` | 画像与分析 | 本人证据画像／公开纠错／正式成绩聚合 | [LOCAL旧聚合入口包](zhiban-v2-support-routes-local.md)已接；维度REVIEW，无能力分／排名／AI诊断 | 本包入口已LOCAL交付；P1/P5高级规则另计 |
| `/zhiban/student/courses/[courseId]/coursework` | 作业与讨论 | 文字作答、真实扫描附件、版本／历史及成绩关联 | 优先采用新版界面，确认保留旧布局时再做视觉对照；课程讨论及三题型测验已LOCAL接入；更多附件格式及高级课堂另计 | 已有真实页面；剩余按P1/P2/P3/P4/P5对应范围 |
| `/zhiban/student/courses/[courseId]/grades` | 成绩 | 教师课程成绩簿／当前页及受限跨页CSV／评分；学生本人公开成绩 | 优先采用新版界面，确认保留旧布局时再做视觉对照；[受限跨页导出已LOCAL交付](zhiban-v2-gradebook-export-local.md)，[教学班权重总评／申诉](zhiban-v2-final-grades-local.md)已LOCAL接入，跨班学分／二审另计 | 已有真实页面；剩余按P1/P2/P3/P4/P5对应范围 |
| `/zhiban/student/courses/[courseId]/introduction` | 课程简介 | 课程简介与课程／教学班上下文 | 优先采用新版界面，确认保留旧布局时再做视觉对照；更完整产品属性另按P3/P5交付 | 已有真实页面；剩余按P1/P2/P3/P4/P5对应范围 |
| `/zhiban/student/courses/[courseId]/learning-center/[stationId]` | 学习中心／站点 | 已接发布目录、文本／PNG公开渲染及原作答；精确单元URL、前后导航与返回 | 当前精确目标为目录unitUUID；不隐式复用机电stationId。三题型Quiz及离线HTML互动已LOCAL接入；[正式证据进度／先修规则](zhiban-v2-learning-rules-local.md)已补齐；PBL、完整Runtime与互动完成另计 | P2基础学习入口已接；完整P4仍待接入 |
| `/zhiban/student/courses/[courseId]/learning-center` | 学习中心／站点 | 已接发布目录、文本／PNG公开渲染及原作答；精确单元URL、前后导航与返回 | 当前精确目标为目录unitUUID；不隐式复用机电stationId。三题型Quiz及离线HTML互动已LOCAL接入；[正式证据进度／先修规则](zhiban-v2-learning-rules-local.md)已补齐；PBL、完整Runtime与互动完成另计 | P2基础学习入口已接；完整P4仍待接入 |
| `/zhiban/student/courses/[courseId]` | 课程详情／结构 | 独立师生课程工作区、章节／单元目录与发布 | 优先采用新版界面，确认保留旧布局时再做视觉对照；通用学习中心已有；[教学班进度、先修与正式完成条件](zhiban-v2-learning-rules-local.md)已补LOCAL，Native互动完成另计 | 已有真实页面；剩余按P1/P2/P3/P4/P5对应范围 |
| `/zhiban/student/courses/[courseId]/resources` | 课程资源 | 课程壳内文本／PNG编辑发布与学生查看 | 优先采用新版界面，确认保留旧布局时再做视觉对照；更多格式及资源管理到P3 | 已有真实页面；剩余按P1/P2/P3/P4/P5对应范围 |
| `/zhiban/student/courses/[courseId]/support` | 风险与支持 | 本人提醒／补救任务／公开纠错／观察聚合 | [LOCAL旧聚合入口包](zhiban-v2-support-routes-local.md)已接；维度REVIEW，无能力分／排名／AI诊断 | 本包入口已LOCAL交付；P1/P5高级规则另计 |
| `/zhiban/student/courses/[courseId]/tools` | AI | 复用现有课程Tutor；受限课程选择与本人会话／历史 | [LOCAL旧工具入口包](zhiban-v2-student-tools-routes-local.md)已接；教师开关、本人私有与原模型交付屏障保留 | Tutor入口LOCAL可用；Peer／工具型Agent未启用 |
| `/zhiban/student/grades` | 成绩 | 全局受限课程搜索／状态／分页→本人课程成绩与历史结果 | [LOCAL旧入口包](zhiban-v2-global-grades-routes-local.md)已接；后续[教学班总评／申诉](zhiban-v2-final-grades-local.md)已接入原课程成绩页；跨课程汇总／学生CSV未包含 | 本包入口已LOCAL交付；P1/P3剩余规则另计 |
| `/zhiban/student/pbl/[instanceId]` | PBL | 旧实例解释页复用受限课程选择→当前PBL项目 | [PBL完整LOCAL包](zhiban-v2-pbl-collaboration-local.md)提供入口；旧Native实例ID不自动映射新小组，旧实例历史未导入 | 导航兼容已接；原生实例／历史迁移仍按真实合同与授权 |
| `/zhiban/student/pbl` | PBL | 复用原受限Workspace课程选择，进入当前角色PBL课程工作区 | [PBL完整LOCAL包](zhiban-v2-pbl-collaboration-local.md)一次接入；当前任教／在班和组授权仍由原API校验 | P6旧入口导航兼容；不是原生历史数据迁移 |
| `/zhiban/student/profile` | 画像与分析 | 受限课程选择→本人课程证据与观察 | [LOCAL旧聚合入口包](zhiban-v2-support-routes-local.md)已接；维度REVIEW，无能力分／排名／AI诊断 | 本包入口已LOCAL交付；P1/P5高级规则另计 |
| `/zhiban/student/risks` | 风险与支持 | 受限课程选择→本人公开学习支持，不展示教师私有风险 | [LOCAL旧聚合入口包](zhiban-v2-support-routes-local.md)已接；维度REVIEW，无能力分／排名／AI诊断 | 本包入口已LOCAL交付；P1/P5高级规则另计 |
| `/zhiban/student/settings` | 个人设置 | 本人资料、PNG头像、安全及@标识已有 `/zhiban/profile`／`/zhiban/login-identifiers` | [旧settings URL已LOCAL兼容](zhiban-v2-personal-settings-routes-local.md)；PNG头像已有 | 本包个人设置功能与旧URL均LOCAL已接；P1/P3 |
| `/zhiban/teacher/agents` | AI | 受限任教课程选择→现有教师AI备课 | [LOCAL旧入口替代包](zhiban-v2-authoring-routes-local.md)已接；复用原生生成／采用／发布，不恢复干预控制台 | 备课入口LOCAL可用；工具型Agent／监控／Peer仍按原门禁 |
| `/zhiban/teacher/classrooms` | 课堂／互动 | 教学班选择后进入现有基础课堂／学习活动 | 完整旧课堂播放器与Runtime证据仍缺 | 基础入口已接；完整P4未完成 |
| `/zhiban/teacher/courses/[courseId]/agents` | AI | 原课程内容页直接展开备课，保留手工编辑和返回 | [LOCAL旧入口替代包](zhiban-v2-authoring-routes-local.md)已接；原Tutor独立入口保留，旧Peer不启用 | 备课入口LOCAL可用；非旧Agent功能全量迁移 |
| `/zhiban/teacher/courses/[courseId]/analytics` | 教师统计 | 课程壳内教师统计 | 优先采用新版界面，确认保留旧布局时再做视觉对照；更完整产品属性另按P3/P5交付 | 已有真实页面；剩余按P1/P2/P3/P4/P5对应范围 |
| `/zhiban/teacher/courses/[courseId]/classrooms` | 课堂／互动 | 基础共享课堂、草稿／改期／派发／结束／历史 | 优先采用新版界面，确认保留旧布局时再做视觉对照；完整Scene／Runtime／实验另到P4 | 已有真实页面；剩余按P1/P2/P3/P4/P5对应范围 |
| `/zhiban/teacher/courses/[courseId]/grades` | 成绩 | 教师课程成绩簿／当前页及受限跨页CSV／评分；学生本人公开成绩 | 优先采用新版界面，确认保留旧布局时再做视觉对照；[受限跨页导出已LOCAL交付](zhiban-v2-gradebook-export-local.md)，[教学班权重总评／申诉](zhiban-v2-final-grades-local.md)已LOCAL接入，跨班学分／二审另计 | 已有真实页面；剩余按P1/P2/P3/P4/P5对应范围 |
| `/zhiban/teacher/courses/[courseId]/learning-center/[stationId]` | 学习中心／站点 | 已接发布目录、文本／PNG公开渲染及原作答；精确单元URL、前后导航与返回 | 当前精确目标为目录unitUUID；不隐式复用机电stationId。三题型Quiz及离线HTML互动已LOCAL接入；[正式证据进度／先修规则](zhiban-v2-learning-rules-local.md)已补齐；PBL、完整Runtime与互动完成另计 | P2基础学习入口已接；完整P4仍待接入 |
| `/zhiban/teacher/courses/[courseId]/learning-center/analytics` | 虚拟实验 | 未交付 | 旧路由尚未接完整页面；执行、证据、实验评价和分析页 | 旧页未完成；待实现；P4 |
| `/zhiban/teacher/courses/[courseId]/learning-center` | 学习中心／站点 | 已接发布目录、文本／PNG公开渲染及原作答；精确单元URL、前后导航与返回 | 当前精确目标为目录unitUUID；不隐式复用机电stationId。三题型Quiz及离线HTML互动已LOCAL接入；[正式证据进度／先修规则](zhiban-v2-learning-rules-local.md)已补齐；PBL、完整Runtime与互动完成另计 | P2基础学习入口已接；完整P4仍待接入 |
| `/zhiban/teacher/courses/[courseId]` | 课程详情／结构 | 独立师生课程工作区、章节／单元目录与发布 | 优先采用新版界面，确认保留旧布局时再做视觉对照；通用学习中心已有；[教学班进度、先修与正式完成条件](zhiban-v2-learning-rules-local.md)已补LOCAL，Native互动完成另计 | 已有真实页面；剩余按P1/P2/P3/P4/P5对应范围 |
| `/zhiban/teacher/courses/[courseId]/pbl` | PBL | 课程项目编写／原生模板采用、发布、分组、共享成果与公开评价 | [PBL完整LOCAL包](zhiban-v2-pbl-collaboration-local.md)已接；原生自主Agent／完整Runtime另守门禁 | P6课程差额可用，非旧视觉像素复刻 |
| `/zhiban/teacher/courses/[courseId]/profiles` | 画像与分析 | 课程证据画像／概念纠错／原成绩簿聚合 | [LOCAL旧聚合入口包](zhiban-v2-support-routes-local.md)已接；维度REVIEW，无能力分／排名／AI诊断 | 本包入口已LOCAL交付；P1/P5高级规则另计 |
| `/zhiban/teacher/courses/[courseId]/risks` | 风险与支持 | 课程私有规则审阅／人工跟进／补救及纠错聚合 | [LOCAL旧聚合入口包](zhiban-v2-support-routes-local.md)已接；维度REVIEW，无能力分／排名／AI诊断 | 本包入口已LOCAL交付；P1/P5高级规则另计 |
| `/zhiban/teacher/courses/[courseId]/settings` | 课程设置 | 本教学班引用课程版本及配置只读，连接原教师教学设置 | [LOCAL设置／任教包](zhiban-v2-course-administration-local.md)已接；基础课程／教学班写操作仍由管理员管理 | 本包旧入口LOCAL可用；不恢复旧教师管理权限 |
| `/zhiban/teacher/courses/[courseId]/students` | 课程学生名单 | 课程内任教范围学生名单分页 | 优先采用新版界面，确认保留旧布局时再做视觉对照；更完整产品属性另按P3/P5交付 | 已有真实页面；剩余按P1/P2/P3/P4/P5对应范围 |
| `/zhiban/teacher/courses/[courseId]/teachers` | 任教关系 | 当前教学班关系／姓名投影、受限搜索分页及返回 | [LOCAL设置／任教包](zhiban-v2-course-administration-local.md)已接；非全校教师目录，非实时有效Identity授权名单 | 本包旧入口LOCAL可用；仅当前教学班关系 |
| `/zhiban/teacher/courses` | 角色课程首页 | 复用当前任教课程搜索／状态／分页与课程工作区返回 | [普通入口批量包](zhiban-v2-ordinary-entry-batch-local.md)已接；不恢复机电课程自动跳转或旧权限 | 当前普通入口LOCAL完成；非像素复刻 |
| `/zhiban/teacher/grades` | 成绩 | 全局任教课程搜索／状态／分页→课程成绩簿／评分／受限CSV | [LOCAL旧入口包](zhiban-v2-global-grades-routes-local.md)已接；后续[教学班总评／权重／申诉](zhiban-v2-final-grades-local.md)已接入原课程成绩页 | 本包入口已LOCAL交付；P1/P3剩余规则另计 |
| `/zhiban/teacher/pbl` | PBL | 复用原受限Workspace课程选择，进入当前角色PBL课程工作区 | [PBL完整LOCAL包](zhiban-v2-pbl-collaboration-local.md)一次接入；当前任教／在班和组授权仍由原API校验 | P6旧入口导航兼容；不是原生历史数据迁移 |
| `/zhiban/teacher/profile` | 个人设置 | 本人资料、PNG头像、安全及@标识已有 `/zhiban/profile`／`/zhiban/login-identifiers` | [旧profile URL已LOCAL兼容](zhiban-v2-personal-settings-routes-local.md)；PNG头像已有 | 本包个人设置功能与旧URL均LOCAL已接；P1/P3 |
| `/zhiban/teacher/profiles` | 画像与分析 | 任教课程选择→证据画像聚合 | [LOCAL旧聚合入口包](zhiban-v2-support-routes-local.md)已接；维度REVIEW，无能力分／排名／AI诊断 | 本包入口已LOCAL交付；P1/P5高级规则另计 |
| `/zhiban/teacher/risks` | 风险与支持 | 任教课程选择→私有规则审阅与支持聚合 | [LOCAL旧聚合入口包](zhiban-v2-support-routes-local.md)已接；维度REVIEW，无能力分／排名／AI诊断 | 本包入口已LOCAL交付；P1/P5高级规则另计 |
| `/zhiban/teacher/virtual-lab` | 虚拟实验 | 未交付 | 旧路由尚未接完整页面；执行、证据、实验评价和分析页 | 旧页未完成；待实现；P4 |

当前学习中心和个人资料等功能已有，旧入口未映射不再写成功能未交付；任教关系最小投影已按本轮LOCAL包交付；真实运营账户、外部目录同步和高级页面的实际缺口继续保留。无业务支撑的菜单或占位页不计完成；机电专用页不迁通用核心，REVIEW项未自动批准。历史逐页blob／hash继续见 `evidence/zhiban-migration-replan-local.json`；本次更新不改写其当时判断。

2026-10-22 P3差额：新增 `/zhiban/admin/onboarding` 租户申请／状态分页与 `/zhiban/activate-account` 本人首次设密／终态查证；原登录与管理导航接续。见[LOCAL开户产品包](zhiban-v2-account-onboarding-local.md)。不恢复旧管理员代设密码语义，不扩大P1整体视觉签收。

2026-10-22 原P3：[账户启停／目录联动LOCAL包](zhiban-v2-account-status-local.md)在原 `/zhiban/admin/accounts` 追加最小global状态与查证时间，保留Membership状态，纠正开户／教师授权历史提示；独立平台CLI操作，不增租户全局管理按钮。

2026-10-23 原P3：[受控登录标识LOCAL包](zhiban-v2-login-identifiers-local.md)新增 `/zhiban/login-identifiers` 本人提名确认／停用，工作台与资料页接入；登录页支持独立@入口，管理员原成员目录展示及精确查询本空间映射。原UserId端点不扩展，不复制旧业务编号登录。

2026-10-23 P3补充：现有本人资料页及管理员成员目录已接[PNG头像完整LOCAL包](zhiban-v2-avatar-local.md)，不扩大旧路由／公共目录范围。

2026-10-23 P2/P4：课程首页及学习中心补[本人必修进度／先修原因、教师显式配置发布](zhiban-v2-learning-rules-local.md)；限定正式提交／已发布成绩，新进入服务端拦截。旧Native场景与25站点未因本包自动恢复。

2026-10-24原P5／P6：[六维证据与EMA教师审阅](zhiban-v2-six-dimension-ema-local.md)已作为独立课程工作区面板 `/teacher|student/courses/[course]/evidence-profile` 接入，既有学习观察及聚合旧入口可从同一课程导航进入。教师有学生选择／来源选择／分析／逐维审阅，学生只有本人已发布画像、来源差异与原纠错入口；不把旧六维数值仪表或情绪问卷复刻为当前能力。
