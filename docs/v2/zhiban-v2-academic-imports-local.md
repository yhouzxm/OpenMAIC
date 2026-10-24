# 原 P3：多类教务导入与批次结果

2026-10-23，沿原 P1–P7 主线复用现有 Academic、Profile 与 Identity 命令；本包的验收为 LOCAL，不新增开户、授予角色、课程自动发布或自动恢复关系能力。已有教学班单列名册导入保留原入口及证据。

## 完整产品范围

管理员导航“教务批量导入” → 选择类别／下载模板 → 上传 UTF-8 CSV 或粘贴 → 预览逐行问题 → 确认执行 → 读取原批次结果／下载结果 CSV。旧 classes、students、registrations 入口接到对应类别；users 类型继续由普通账户开通的独立审批处理，不把文件行变成 User 或身份来源。

| 类别 | 固定 CSV 列 | 处理方式 |
| --- | --- | --- |
| 学期 | code,name,startsOn,endsOn | 原 CREATE_TERM；ISO 日期范围 |
| 课程草稿 | code,name,description | 原 CREATE_COURSE，无负责人、不自动发布 |
| 行政班 | code,name | 原 CREATE_CLASS |
| 教学班 | courseId,termId,classId,code,name,capacity | 原 CREATE_OFFERING；课程须已发布，classId 可空 |
| 正式档案 | membershipId,formalName,studentNo,employeeNo | 原 SAVE_DIRECTORY；预览绑定当前 revision，两个业务编号留空表示清空 |
| 行政班成员 | classId,membershipId | 原 CLASS_MEMBER，只加入当前有效学生；不自动转班或恢复同班停用关系 |
| 教学班学生 | offeringId,membershipId | 原 ENROLL，只加入当前有效学生；不自动恢复 WITHDRAWN |

CSV 最多 50 行／64 KiB，固定列序，支持 UTF-8 BOM、CRLF、引号、逗号和双引号转义；不支持字段内换行。ID 必须是本空间已存在的精确 ID，不按姓名、学号、工号、邮箱或登录别名猜测身份。文件内重复对象阻止整批确认。对象引用由原受限目录／教务页面查找；外空间与不可用目标不给出其资料。

已有内容完全相同可跳过，不追加业务命令／审计；同码但内容不同的创建行阻止覆盖。正式档案是明确允许的更新，页面说明留空清空及影响字段；不更新本人联系方式、显示资料、密码或登录标识。关系导入不附带教师资格、角色或 Enrollment 以外的权限。

## 持久批次与部分结果

新增独立 zhiban_imports schema，只保存批次、规范化命令、预览前置条件摘要及逐行结果。预览会写批次收据，**不写教务业务或原命令审计**。批次输入不可经 runtime 改写；唯一行命令键为 import_<batchId>_<line>，每行结果和原业务命令／审计在同一业务事务提交。整批不是原子事务，首行失败后不开始后续行；已成功行保留。8 秒执行预算或请求中断后，不开始新行，允许在有效期内显式继续原批次。

确认有效期 30 分钟；到期停止新写入，结果仍可读取。每个租户最多 10000 批，每批 50 行，无 runtime DELETE 或自动过期删除；这是 bounded LOCAL 运行存储，不代表已批准生产保留／清理政策。结果页只按 20 条批次分页，不枚举全库。

批次绑定创建者 Membership 和租户；读列表、详情、提交均重新通过当前 Session／Membership／TENANT_ADMIN 授权，其他管理员不能代执行或读取此人的批次。业务目标沿原 Bridge related participant 锁与成员／角色期限屏障；每行重读前置条件并调用原命令，不借预览作长期授权。角色／成员／课程／教学班／revision／容量变化会拒绝新写入。数量预览仅供提示，实际席位仍由原 ENROLL 锁定及容量校验决定。

未知 COMMIT 结果不猜测成失败、不生成新键自动重试。页面禁用继续按钮，要求读取原批次；数据库事务已成功则读到 IMPORTED／SKIPPED，未成功则仍为 READY／SKIP。原批次可以显式继续，已完成行不会再写业务；失败行标为 FAILED，之后不继续，须处理现状并重新预览。进程重建不丢批次；停止 disposable cluster 并移除数据库仍会移除本轮批次，不能将“持久化”解释成跨 disposable 重建保留。

结果 CSV 从当前已读取的受限批次生成，只含行号、对象、状态及错误代码，完整引号转义，并对公式前缀作文本转义；不导出密码、审批来源、CSRF、联系方式或其他管理员批次。

## 数据、来源与默认接线

仅新增本模块 migration；不修改已应用 SQL、冻结 UserId 解析器、原 Identity ACL 或角色语义。schema 无 PUBLIC 权限、无 SECURITY DEFINER helper；academic runtime 仅 SELECT／INSERT 两表和 UPDATE 行 state/code，RLS 强制 tenant_id，禁止输入／command key 改写和 DELETE。身份与业务授权仍由原 AcademicStore 执行。

独立 owned PG16 reference 构建校验本模块 catalog／ACL／RLS、参与角色／membership edges、schema ledger 与依赖 SQL hash；loader 只验证，不在网站启动时安装或自签 expected profile。默认 LOCAL launcher 将新模块安装到 owned disposable cluster；常规启动不执行导入回归。定向入口：`pnpm verify:zhiban:imports`。真实数据、55432／55433、生产及 CI 不在本包操作范围。

## 最终结果

`pnpm verify:zhiban:imports` 已通过，[定向收据](evidence/zhiban-imports-local.json)及[边界明细](evidence/academic-imports/directed-journey.json)覆盖七类真实命令、预览不写业务、相同记录跳过、禁止覆盖创建对象／自动发布／转班／恢复、当前管理员与学生资格撤权、外租户及创建者隔离、档案 CAS、并发最后席位、批次分页、部分成功停止、过期只读及 ACL 漂移拒绝。业务写入与批次收据故障一起回滚；真实业务 COMMIT 后注入丢 ACK，重建 service/handler 后读取 IMPORTED，再用原批次显式重试只保留一条业务审计。此项是同库 service/handler 重建，不宣称执行了整个操作系统进程的恢复演练。

独立 owned PG16 reference 构建、三项 CSV 定向单测及定向 TypeScript／ESLint 通过。原 41 份已应用 migration 无漂移，仅新增 imports/0001；不扩张原 Identity/Academic ACL，也不修改冻结解析器。批次使用事务级 advisory lock；不可变批次／学期表没有为了行锁获得 UPDATE 权限。测试夹具对独立合成角色执行单向撤权，不把恢复不可变旧 RoleGrant 当成可用操作。

默认 3461 的实际 IAB 已通过管理员导航、粘贴 CSV、预览／确认、刷新原批次、文件选择及“相同跳过＋新行导入”。[结果 CSV](evidence/academic-imports/default-result.csv)已下载读回，公式前缀被转义；[较大 CSV 真实 HTTPS](evidence/academic-imports/default-large-preview.json)已验证 57811 字节／30 行预览可穿过新的外层请求上限，没有创建课程。旧 classes、students、registrations 类别和 users 受控开户入口均通过[实测映射](evidence/academic-imports/default-route-checks.json)。这些收据保留各自精确 root/source 范围。

定向整包之后仅改 imports.js 的表单布局、初始化输入屏障及持久化提示。快速操作发现的初始化清空 CSV 已修正为配置加载后才启用控件；最终只复验受影响前端，不重跑无关后台／课堂。最终 IAB 已以快速输入路径通过预览、确认、下载、公式转义与刷新原批次；[最终页面截图](evidence/academic-imports/default-final-browser.png)及[实际记录](evidence/academic-imports/default-final-browser-journey.json)绑定当前默认实例。具体 hash 与当前默认 IAB 补充见[前端增量](evidence/academic-imports/frontend-delta.json)及[最终收据](evidence/academic-imports/final-closeout.json)，不改写原定向收据。

接续时前一轮 disposable root／PID 已不存在；[原备份仍在的核对](evidence/academic-imports/previous-instance.json)保留，不向 stale PID 发信号或声称恢复旧数据。本轮布局切换前的三库／control 输入已有[私有归档](evidence/academic-imports/default-backup.json)，只核验归档目录及 hash，未做恢复演练。当前为新合成课堂，账号密码只从当前运行元数据指向的私有 accounts.json 读取。已停止／重建的临时环境 URL、批次和登录标识不保证在新数据库存在。

未操作真实 55432／55433、生产或真实人员数据，无 commit／push／CI dispatch。原 scanner pin 漂移保持 UNAVAILABLE，新扫描附件／材料上传关闭；CSV 是受限文本输入解析，不借此绕过附件扫描。模型配置沿用已有私有配置，本轮没有额外真实模型调用。

本包完成七类本地教务导入与批次闭环，不宣称整个 P3／P7 完成。外部目录同步、生产批量账户来源、真实身份核验／交付、头像，以及未决定的总评／申诉或解析服务仍按主矩阵保留；更多格式不默认转成新承诺。下一完整包建议 **P7 统一试用版本与交接包**，集中列可用入口、当前版本、已批准范围与外部输入门禁；建议 **GPT-6.1 Sol / medium**。
