# P3 教师课程／教学班授权

状态：**LOCAL完整产品包已实现并通过定向旅程**（2026-10-18）。基线 `refactor/zhiban-v2` / `daf63afa83470d24a9ed41d171c6a17f8a80adb6`，保留既有dirty候选；不commit／push／CI，不操作真实55432／55433。

## 一个完整操作流程

管理员从“成员账户目录→管理空间成员”选择教师角色和任教教学班，先“登记任教待授权”，再输入本人当前密码“授予所选角色”。前一步只登记真实任教关系，不写Identity角色；没有匹配角色仍不能教学。后一步走原Identity命令，锁内核验关系与当前批准；失败时保留可见的待授权关系，可继续审批或从任教管理结束，不假装跨两个命令原子成功。

CLASS精确指教学班Offering.id，不是行政班。COURSE精确指Course.id；教师访问某教学班始终需要有效角色范围匹配且该班存在本人的当前ACTIVE任教关系。COURSE授权不自动为该课程全部教学班登记任教，也不授予其他课程。单条grant的期限与原管理员ceiling不变；不新增TEACHER/TENANT委派。

撤销角色或结束任教分别切断权限的必要条件，均不删除历史作答、成绩或任教审计。保留已有不同范围／学生角色；全量替换仍需显式确认，不把角色当成单一账户类型。

## 授权与并发接线

新增 `teaching/0001_teacher_relationships.sql` 候选，只安装在owned disposable PG16。既有Identity／Academic migration文件不改；冻结catalog、permissions、mayDelegate与角色上限不改。

新的固定SECURITY DEFINER helper只为zhiban_runtime提供精确关系定位和版本，不开放Academic表的直接读写。owner仍NOLOGIN／NOBYPASSRLS；新增三表owner策略只允许该session_user、同tenant下读取及取锁，WITH CHECK(false)禁止借此DML；PUBLIC及其他runtime没有helper EXECUTE。独立新PG16参考绑定SQL、函数定义／ACL与六条owner策略；正常加载拒绝参考、用途、来源hash、函数属性或ACL不匹配。配置仅在LOCAL统一host显式装配，无loader的其他组合继续拒绝教师授予。

MemberCommands在原client、原Tenant／sorted Users／Session／Membership锁和step-up下调用资源loader；新授予、preserve、current-version确认及提交前校验均加载真实关系。资源锁按course→offering→assignment；同一事务保持到Identity提交。Academic的加入类写统一先course再offering；其Bridge身份守卫保持至业务COMMIT，再释放。客户端不提交relationship布尔，也不能直接操作控制面。

新业务命令PREPARE_TEACHER只接受原管理员资格、当前ACTIVE目标、开放教学班、CAS／command key；审计独立记录“登记任教待授权”。普通ASSIGN_TEACHER及其选择器现在核验精确范围。有限期资格在业务提交前复核；STUDENT资格只接受SELF。

教学工作台先按scope＋assignment过滤后分页；学习／测验／评分／内容／资源／讨论／课堂／统计等沿已有的逐教学班访问规则消费，未引入第二套按角色字符串放行的授权。课程负责人仍是原合同的元数据，不授予教学权限；其候选列表按创建／编辑的资源范围限制。行政班没有对应的教师scope，本包不将教学班／课程grant提升为行政班班主任资格；该入口保留原TENANT范围历史教师的资格，不新发这种宽泛grant。

## 失败与交接边界

登记关系与角色批准是两个有明确状态的命令，未授予或已撤权时的ACTIVE任教记录不等于可教学。关系登记丢响应按原Academic的原正文／原key协议确认；Identity仍使用读取当前版本、重新输入本人密码、原安全意图／原key的确认协议。关系已结束／资源关闭等后续变更可能拒绝旧Identity确认，不能将其解释为原操作一定失败；需读取当前事实受控核对。

现有演示中的历史TEACHER/TENANT grant不作为本轮正式委派证明。新global开户、首密交付、真实运营审批、完整管理历史、生产安装与Runtime／AI仍按各自门禁，不阻塞本包LOCAL交付。

## 验证和开发流程

6组教师专项通过：真实UI登记／精确授权及期限输入、范围消费、课程多班授权及撤权、写入与撤权屏障、任教结束与授予竞争、helper ACL及原号确认。另有74项既有授权／教务／安全查询测试通过；定向类型与运行代码lint通过。参考构造器保留既有any类型，单独按原脚本规则检查，不宣称全仓lint通过。最终收据见[evidence/zhiban-teacher-scope-local.json](evidence/zhiban-teacher-scope-local.json)。只覆盖本包及受影响的授权／教务查询，不重跑完整课堂、扫描、导出或GitHub CI；参考builder只构造schema／Native参考，不运行旧PNG产品套件。旧收据保留原SHA／来源范围。

当前入口[3461](https://127.0.0.1:3461/zhiban)，管理员从成员账户目录进入管理详情。精确范围教师试用账号及链接在 `/tmp/zhiban-trial-content-AA7kru/teacher-inputs.json`，普通三角色在 `/tmp/zhiban-trial-content-AA7kru/accounts.json`；密码仅在0600私有文件。当前1541项来源匹配、drift=0。最终进程是显式教师专项 --serve 的受验实例，startup元数据不冒称36组旧旅程重验。切换前与最终交付均有私有双库／身份输入备份；见[切换备份](evidence/teacher-scope/before-backup.json)和[交付备份](evidence/teacher-scope/delivery-backup.json)，仅验证逻辑归档目录，未宣称实际恢复。

`pnpm trial:zhiban` 现在仅构造环境、校验必要来源／provider／ACL及准备合成示例，启动记录明确STARTUP_AND_SYNTHETIC_SEED_ONLY，不冒充完整验收。显式 `pnpm verify:zhiban:trial` 保留完整旅程；本包用 `pnpm verify:zhiban:teacher-scope`。验证进程使用同一固定LOCAL端点，须与默认实例错开运行；最终交付可在同一命令加 --serve 保留受验实例，不再每个功能建独立产品端口。

用户要求已写回原计划：完整功能包交付、默认启动与验证分离、只做受影响本地验证、不重复GitHub、不以测试数量当进度、缺外部输入仅阻塞依赖项。下一完整产品包为复用新版教师AI备课的生成→采用→发布；建议GPT-6.1 Sol / medium，跨权限复杂改动再用high。
