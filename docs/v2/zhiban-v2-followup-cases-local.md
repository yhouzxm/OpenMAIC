# 原 P5 人工跟进记录与结案

接续教师待跟进名单，交付教师记录、追加说明、结案、重新打开及分页历史。人工状态独立于学习事实：结案不修改 Attempt／Submission／成绩，也不让尚未解决的学习事项自动退出事实名单。

## 产品合同

- 从“教学分析 → 教师待跟进名单 → 记录跟进”创建，服务端重新确认当前在班 Enrollment、当前发布正式活动版本、最新 Attempt／Submission 尚无已发布成绩。客户端不能提供操作者、状态、事实快照。
- 首条说明必填；活动标题、版本、Enrollment、学生及当时依据固定。每个 Enrollment＋活动版本只保留一份跟进记录。发布新版本或不同 Enrollment 不自动继承旧记录。
- OPEN 可追加说明或结案，CLOSED 只可明确说明后重新打开；每次操作要求预期记录版本。说明最多 2000 字，旧说明／事件不可修改或删除，纠正采用追加说明。
- 当前具有有效教师角色及本教学班任教关系的教师可协作处理，原创建者、每次实际操作者、时间、动作、前后状态、版本留痕。撤销任教立即失去后续读写能力；接任教师依同一任教守卫访问。学生与管理员不获得此报告权限。
- “跟进记录与结案”提供全部／进行中／已结案、姓名／成员 ID／标题搜索，以及每页 20 条的记录与事件历史。旧活动版本、退班后的记录保留；当前教师可追加、结案历史记录。课程归档等原授权限制不放宽。
- 表单对未保存内容提供离开保护；结果不确定时冻结本次输入并按原命令号重试；冲突保留输入，可明确读取新版本后重新处理。只读分页不会创建记录或尝试。

不发送通知，不自动诊断风险，不把教师说明写入学生成绩或对学生公开。人工结案表示本次人工处理结束，不证明作业完成或沟通送达。

## 数据、授权与并发

新增独立 `zhiban_followup`：

| 表 | 作用与权限 |
| --- | --- |
| cases | 固定 Enrollment／活动版本外键与创建快照；仅允许更新状态、版本、最近操作者及时间 |
| events | 不可变说明和状态审计，每份记录每个版本唯一；无 UPDATE／DELETE |
| commands | 操作者、教学班、规范载荷摘要及结果的不可变回执；同租户命令号唯一 |
| schema_migrations | 新增独立 migration 的来源校验 |

全业务表 FORCE RLS、租户策略；PUBLIC 无权限。沿用 `zhiban_academic_runtime`，不增加 Identity 权限、角色继承、helper／SECURITY DEFINER 或 Native 写权限。

只新增 `lib/zhiban/infrastructure/followup/postgres/migrations/0001_followup.sql`；不改任何旧 migration。仅在新建 disposable PG16 安装。独立 builder 先按固定源码在独立 owned PG16 构建目录／ACL 指纹，主机 loader 仅读取并校验 reference、SQL SHA、ledger、live fingerprint；未验证或缺少安装时写入能力关闭。参考构建本身不是产品签收。

每个读写均经过原 AcademicStore／Identity、课程及任教锁与过期重检。创建依次锁活动、Enrollment、自然锚点及选定 Attempt，防止换版、退班、新尝试／重交／成绩发布与依据采样交错；不读作答或评分草稿。更新锁 case 行并比较 revision。命令回执检查操作者、教学班和载荷摘要，不能借相同 key 替换内容。case 更新、事件、回执在同一业务事务提交；审计写失败全部回滚。相同版本的并发追加／结案只允许一方成功。

## API

- `GET /api/zhiban/analytics/:tenant/offerings/:offering/followup-cases?q=&state=ALL|OPEN|CLOSED&cursor=`
- `GET .../followup-cases/:id?cursor=`：记录及每页 20 条事件。
- `POST .../followup-cases`：CREATE_CASE／ADD_NOTE／CLOSE_CASE／REOPEN_CASE；闭合 DTO、可信 Origin、CSRF 和命令号。详情地址不接受 POST。

列表／事件游标绑定当前教师、租户、教学班、记录及筛选，主机重启后失效；不是访问凭据。跨页不承诺冻结快照。事实名单另附同一 Enrollment／版本的 case 状态；已结案且仍未交时仍显示学习事实与已结案入口。

## 本地验证与证据边界

`pnpm verify:zhiban:followup-cases` 执行本包独立 PG16 fixture 与教师页面。复用既有原生包，不重复扫描、导出、完整课堂或 GitHub CI。

[LOCAL receipt](evidence/zhiban-followup-cases-local.json)、[旅程](evidence/followup-cases/journey.json)、[运行日志](evidence/followup-cases/directed.log)、[结案页面](evidence/followup-cases/closed.png)、[历史列表](evidence/followup-cases/history.png)、[类型检查](evidence/followup-cases/typecheck.log)、[ESLint](evidence/followup-cases/lint.log)、[DTO／网关检查](evidence/followup-cases/unit.log)、[独立参考构建](evidence/followup-cases/reference-build.log)。

对应验收：同 key 并发重放只写一次；变更载荷／同锚点重复／过期版本拒绝；同 revision 追加与结案竞态；审计 INSERT 失败回滚主记录；事件／回执不可更新、跨租户 RLS；学生／管理员／非任教／跨租户读写拒绝；CSRF；结案不消除未交事实；重开；事件分页及跨记录游标拒绝；换版不继承；退班后历史结案；撤任教后拒绝；桌面课程布局及真实按钮返回。

证据仅适用 LOCAL disposable，`githubActions=false`。不扩大旧 CI、Native Runtime、真实通知或生产启用范围。下一完整功能建议为教师站内提醒与学生待办回执，外部通信与通知策略另行明确；该包涉及接收者授权和投递并发时建议 GPT-6.1 Sol / high。

## 本轮交接补充

详情读取在查询事件期间对可变记录头持 SHARE 锁，保证状态／版本与事件不跨越一次并发更新；受控持锁检查验证读取确实等待后再返回。Esc 遇到未保存说明会保留输入，只有明确的放弃按钮才丢弃；浏览器旅程验证保留说明后继续结案成功。

最终验收状态认 [收尾记录](evidence/followup-cases/closeout.json)，初轮导航脚本及补充检查前日志仅留作过程追溯。默认3461入口的[样例定位](evidence/followup-cases/default-demo.json)、[实际入口核对](evidence/followup-cases/default-info.log)、[内置浏览器](evidence/followup-cases/default-browser.png)、[UI创建／结案读回](evidence/followup-cases/default-browser-journey.json)保留独立 LOCAL 证据。

[替换前备份](evidence/followup-cases/before-backup.json)与[当前三库归档](evidence/followup-cases/default-backup.json)均检查归档及 TOC，未验证恢复。重建后的默认实例为明确标注的合成演示，不声称旧课堂数据已迁回。独立新增 migration 仅应用于 owned disposable，本轮没有修改任何既有 migration、提交、推送或 CI。
