# P1/P3 教师课程设置与任教名单旧入口（LOCAL）

2026-10-23，默认3461。复用原课程工作区、Workspace查询及Academic授权；完成两个旧URL、只读设置页、任教关系最小查询与页面、课程内往返。无migration／ACL／管理写权限变更，不修改冻结Identity或已应用迁移。

## 旧功能与职责映射

旧本地分支 `origin/feature/zhiban-mechatronics` @ `0fa0a15e8b12ae9e4f7a2d78e80338874599bbae`：settings通过旧course:manage加载TeacherCourseConsole，包含课程配置操作；teachers由getTeacherCourseRoster加载教师列表。本轮按当前V2管理员教务职责替代，**不恢复旧权限字符串及教师修改基础课程／教学班配置的能力**。

| 路径 | 当前交付 |
| --- | --- |
| `/zhiban/teacher/courses/:course/settings?space=…&offering=…` | 只读展示本教学班引用的课程版本名称／说明／版本、教学班名称／代码、学期、容量、状态及配置revision；提供原目录编排、讲义、AI备课、Tutor设置和任教名单链接 |
| `/zhiban/teacher/courses/:course/teachers?space=…&offering=…` | 仅本教学班当前任教关系的姓名、起始时间；姓名搜索、10／20／50条keyset分页、刷新及设置返回 |

原课程概览和教师课程功能页增加“任教名单／课程设置”导航。缺少space或offering的旧书签提示从“我的课程”选择教学班；返回工作台后显式选择空间，不猜旧数字ID、租户或教学班。未知／重复参数、错误路径课程／教学班按原课程壳拒绝。没有另建全局教师目录或管理入口。

配置是原Workspace已授权课程行的只读展示，课程名称／说明来自教学班引用的已发布course_version，不冒充管理员当前草稿。每次重新进入／刷新重新核对授权；已读快照不保证在他处撤权瞬间主动消失。课程负责人、容量／状态和任教变更继续由管理员入口按原合同处理；教师Tutor开关仍只在原Tutor页面中操作。

## 新增最小只读投影

`GET /api/zhiban/workspace/:tenant/teachers?offering=…&q=…&limit=…&cursor=…` 复用原Identity会话／空间解析、AcademicStore事务和LearningPgTransaction.access(...,'TEACHER')。读前按原锁序核对当前有效教师角色、本人ACTIVE任教关系、未归档课程及精确教学班；复用原关系／课程FOR SHARE屏障，不新增角色或后台ServiceActor。单纯管理员、学生、无关系者、错误租户／教学班不能借接口读取。

SQL只选择当前tenant／offering下`ACTIVE && valid_from<=now && valid_until IS NULL`关系，经学籍people取得登记姓名；按关系id排序，以limit+1判下一页。行只返回`id/name/valid_from`，不返回Membership／User ID、联系方式、登录标识、角色、私有档案或Identity目录。姓名用strpos字面匹配，百分号／下划线不是通配符。无新表权限或Identity目标成员扫描。

**这是任教关系事实，不是同事实时有效Identity授权名单。** PREPARE关系、身份停用或角色变化不能从这三列推断出已获得有效教学权限，页面明确说明“关系记录不代表实时有效授权”；实际访问仍由各服务检查。只投影当前教学班，不聚合本课程其他教学班或历史任教。

复用原cursor绑定：tenant／调用者Membership／列表kind／offering／搜索／页长全部绑定，cursor不是能力。未知参数、超限页长、缺目标、坏cursor拒绝。HTTP仅GET；网关只为该明确只读查询允许编码搜索，路径编码／旧网关限制不放宽。当前页最多50条，UI最多100页。服务拒绝后清除已展示名单；Session广播及离页中止请求。没有新增命令、并发协议或配置写入。

## 本地验证与真实边界

`node scripts/zhiban-local/verify-course-administration.cjs` 使用当前owned disposable PG16的真实三角色、HTTPS和原API：教师概览→设置→原讲义／AI／Tutor→设置→任教名单；真实姓名中文搜索及字面`%_`空结果；精确字段白名单；学生／无任教管理员／错误租户和教学班拒绝；教师不能读取管理员assignments API；缺／坏查询、旧链接缺上下文和重复／未知参数拒绝。

新增读授权以真实PG16反向场景验证：管理员通过原END_TEACHER提交→教师新读取403→原名单刷新清空→设置重新进入被拒绝→原ASSIGN_TEACHER按revision恢复ACTIVE→教师可再读。恢复不是历史回滚，原命令会推进该合成关系的revision并更新valid_from；不改Enrollment、Identity角色或正式作答。未直接用owner SQL更改业务数据，未调用模型或新权限。只覆盖一条关系的当前页／空搜索，不宣称真实大名单跨页或多空间旅程；原SQL锁语义复用，未新增独立并发协议证明。

证据：[LOCAL浏览器与PG16场景](evidence/course-administration/browser-local.json)、[设置页](evidence/course-administration/settings.png)、[任教名单](evidence/course-administration/teachers.png)、[最终核对](evidence/course-administration/final-closeout.json)。首轮已走过页面及撤权恢复，最后因脚本把无space工作台误当成已选空间而停止；最终按真实“显式选择空间”行为验证，没有改产品去猜租户。

受影响查询／cursor定向单元通过，受影响TypeScript依赖闭包类型检查、JS语法、ESLint及代码格式检查通过。更宽检查**没有全绿**：原workspace测试文件8通过／1失败，失败是既有admin/import/registrations路由期待`/roster`但当前未映射；全量build类型检查在原开户专项verifyOnboarding调用的多余store参数报TS2353。本轮未修改该断言或开户参数，也不声称完整类型／全测试通过，留为独立技术待办。

默认3461重建前做[旧三库及control私有备份／TOC核验](evidence/course-administration/private-backup.json)，未做恢复演练；新合成课堂和凭据以 `pnpm trial:zhiban:info` 为准。最终运行源码hash无漂移；此前P7归档未重打，其他receipt保持原source范围。未访问真实55432／55433，未提交／推送／CI，未重跑无关扫描、导出、模型或完整课堂；Peer／画像维度／Runtime门禁未改变。

下一完整交付建议：P7更新统一交接版本，纳入已完成的旧入口增量，并单列上述既有检查待办及未启用门禁。建议 GPT-6.1 Sol / medium。
