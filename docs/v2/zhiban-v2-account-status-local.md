# 原 P3：受控全局账户启停与目录联动

2026-10-22，沿[原 P1–P7](zhiban-v2-migration-completion-plan.md)及[账户集中设计](zhiban-v2-account-management-design.md)接线。最终验证状态见文末，不改已应用 migrations 或冻结 Identity 语义。

## 产品范围与复用

直接复用已有 `ControlCommands.USER_DISABLE / USER_RESTORE`、独立来源批准、当前 SystemAdminGrant、真实 Session、当前操作人密码证明、target CAS、User 状态机、审计／命令／效果原子提交及原有会话撤销触发器。OpenMAIC 原生 owner 不具有智伴跨空间账户控制权，不复制旧租户管理员直接修改 global User 的实现。

一个完整本地功能包：独立平台准备目标及跨空间影响 → 核对已签名操作 → 明确执行 → 原命令效果查证；租户管理员在原分页成员目录看到本空间成员的全局状态，区分成员停用与全局停用；本人停用后在所有空间失去登录／新访问资格，恢复后通过原密码重新登录并按当前空间／课程权限访问。网页不提供全局启停写API，也不持有签名key或平台密码。

| 参与者 | 本包能力 | 边界 |
| --- | --- | --- |
| 独立平台操作人 | 精确UserId定位、准备／执行／查证／确认独立批准的全局停用或恢复 | 当前SystemAdmin与密码／Session缺一不可；不读教学内容，不代改密码；拒绝停用自身 |
| 当前本租户TENANT_ADMIN | 原受限目录分页、成员状态／角色／正式档案；额外只读global ACTIVE／DISABLED | 不能搜索全局用户、查看其他空间成员、获取全局停用原因或操作审计，不获得global写权限 |
| 目标本人 | 原登录、原空间发现及当前课程访问 | 停用不能靠旧cookie继续访问；恢复不复活旧会话、不新建Membership／角色／Enrollment |

全局停用影响该User的所有空间；本空间成员停用只影响该Membership。恢复global User不恢复已停用／LEFT成员、不复活已撤销／过期角色、不增加Enrollment／任教关系，不改变历史作答、评分、作者或已下载资料。普通首密票据／入驻批准与User版本绑定；全局状态变更不会续期或复活这些来源，未完成开户应优先使用原独立撤销／交付处置，不能把global restore当作首密或恢复case协议。

## 独立来源与控制入口

仅复用已钉住的私有 LOCAL owned PG16 control 根（56517 Unix socket／3461、当前info与control文件hash），不接受任意DSN、连接密码或目标集群。不操作55432／55433。

`account-status-approvals/`为当前owner独占0700，来源文件0400，拒绝symlink／宽权限。新envelope kind `LOCAL_SYNTHETIC_GLOBAL_ACCOUNT_STATUS`，两把不同Ed25519 key覆盖完整冻结control manifest：环境、操作purpose、目标、原User版本、平台User／SystemAdminGrant版本、catalog、命令／批准ID、closed reason和最长30分钟期限。source loader检查完整字段、签名、purpose隔离及所有不适用字段为null；不把开户／member admission批准当global状态批准。文件中无密码、bearer、凭据hash。

本地两个签名者仍明确为LOCAL_SYNTHETIC_OPERATOR／APPROVER；由一个受控本机流程使用两key验证接线，**不代表两名真人审批**。真实平台运营职责、真人批准和身份来源需要独立输入，不能把此CLI部署到生产。

CLI（UserId与operation ref均非秘密，密码从原受限control配置读取，不进argv／stdout）：

```sh
pnpm exec tsx scripts/zhiban-local/control-account-status.ts prepare USER_ID disable ACCESS_REVIEW
pnpm exec tsx scripts/zhiban-local/control-account-status.ts inspect OPERATION_REF
pnpm exec tsx scripts/zhiban-local/control-account-status.ts execute OPERATION_REF
# 恢复必须另行准备／批准，不能复用停用来源
pnpm exec tsx scripts/zhiban-local/control-account-status.ts prepare USER_ID restore ACCESS_REVIEW
pnpm exec tsx scripts/zhiban-local/control-account-status.ts execute NEW_OPERATION_REF
```

prepare仅写签名文件，返回目标、原状态／版本、预期结果、期限及ALL_SPACES影响；不注册数据库批准、不改账户。execute经原control.registerApproval与execute，两步各自新密码证明、当前Session／操作者资格及来源／target检查。注册成功而执行失败可保留未消费批准，原版本未变化时按原来源显式接续；没有自动重试或补偿性反向操作。两个相同target revision的批准不能各自改变一次状态。

闭合reason仅 ADMIN_REQUEST、ACCESS_REVIEW、SECURITY_POLICY、SYSTEM_MAINTENANCE、USER_REQUEST；不接受自由文本、ACCOUNT_RECOVERY或bootstrap用途。

## 未知结果与并发

每个CLI操作都通过原真实登录建立操作人Session，完成后退出；登录或退出／网络失败可以使结果不确定，不能据CLI错误断言数据库未提交。

- `inspect OPERATION_REF`：签名及当前独立操作人资格／Session检查后，按原command＋effect＋approval读取target及版本。返回NOT_APPLIED、APPLIED_CURRENT或APPLIED_SUPERSEDED，并给出非秘密auditEventId引用。control没有完整audit_events SELECT权限；保持该ACL，使用原提交一致性约束保证effect／audit关联，不另开审计读取权限。
- 执行结果丢失时先inspect；只有APPLIED_CURRENT才可显式`confirm OPERATION_REF`。confirm使用原key／来源与当前after revision，经原control安全确认协议及新的密码／Session验证；不重复状态／审计变更。
- 过期批准不能因inspect仍能读取而重新获得执行权；后续有人恢复／再停用后为APPLIED_SUPERSEDED，拒绝旧确认。普通execute不会自动重放已消费来源。

核心锁序与事务仍由冻结control执行。查证使用相同排序User SHARE锁、当前操作人SystemAdminGrant锁和原Session guard，并在返回前复核时间资格；锁外密码计算和锁内／提交前检查不改变。独立操作人并不因具有tenant角色而取得global权限。

## 目录差额

原 `/api/zhiban/profile/:tenant/members` 和 `/zhiban/admin/accounts`，保留原租户／actor绑定分页与鉴权。服务器在原AcademicStore守锁回调中取得已授权的当前页精确UserIds，再通过已有auth角色只读UserId／status；每次最多50个，无任意UserId参数／全局搜索／新SQL helper／ACL。

响应新增每行 `globalStatus` 与页级 `globalStatusAsOf`，保留原 `status` 为Membership状态，不把它覆盖为global状态；不展示全局原因、其他空间、凭据、SystemAdmin或平台审计。缺少reader为UNKNOWN，数据库失败拒绝，不假装ACTIVE。状态只是独立读取时点的显示，不是权限凭证；页面显示查证时间，操作后点“读取最新资料”，实际读写继续服务端当前授权。

目录仍能显示global停用但本空间ACTIVE的成员和历史信息；“管理空间成员”不会被误解为恢复全局账户。原目录历史提示“开户／教师授权未开放”改为实际已交付范围。本包不新增全局目录或平台浏览器管理页。


## 最终交付与证据边界（2026-10-23）

**本地产品包完成。** [最终收口](evidence/account-status/final-closeout.json)区分来源与范围：

- [2026-10-22定向PG16收据](evidence/zhiban-account-status-local.json)、[授权／并发旅程](evidence/account-status/directed-journey.json)：两空间旧会话阻断、恢复后旧cookie仍失效且新登录成功，目录只读状态、原成员／角色／Enrollment／提交保留；错误密码、tenant-only actor、自身目标、签名篡改／过期、旧版本／被后续操作覆盖的确认拒绝；原审计失败时User和Session撤销整体回滚，并发同版本仅一次；独立连接撤销当前Session及平台grant后拒绝。故障只在新owned fixture中注入。该fixture已停止／删除。
- 定向类型与ESLint通过；[续作源码差额](evidence/account-status/continuation-source-delta.json)只有普通启动的scanner隔离与可选selection处理，账户／授权实现未变。PG16 receipt不重签成新日期或新全仓证明。显式专项验证仍要求真实scanner，不降为模拟扫描。
- [2026-10-23当前默认旅程](evidence/account-status/default-browser-journey.json)：独立CLI准备／停用，IAB目录显示global DISABLED而Membership ACTIVE；独立CLI另批恢复，IAB刷新为global ACTIVE，学生通过原入口重新登录并看到原课程。旧cookie始终401；恢复后新登录200；1份成员、1条原角色、1份Enrollment、2份历史提交的行hash均未改变。这里的global状态操作来自CLI，浏览器只做目录／原登录核验。
- [当前info](evidence/account-status/default-info.log)为RUNNING_LOCAL_DISPOSABLE、sourceMatches=true、sourceDriftCount=0。默认[3461](https://127.0.0.1:3461/zhiban)保持运行，合成三角色账号从`pnpm trial:zhiban:info`指向的私有0600 accounts.json读取。当前root和此前实例不同；续作时此前进程和临时目录已不存在，不声称恢复了旧课堂或续用了旧会话。

[停用目录](evidence/account-status/default-disabled-directory.png)、[恢复目录](evidence/account-status/default-restored-directory.png)、[恢复后学生原课程](evidence/account-status/default-restored-student.png)为当前IAB实际截图。[切换前归档](evidence/account-status/before-backup.json)与[当前三库归档](evidence/account-status/default-backup.json)保存各自实例和私有来源，当前包含新account-status-approvals；校验dump目录及hash，未做恢复演练。

[39份既有migration核对](evidence/account-status/migrations-check.json)无漂移，本包没有新SQL／helper／ACL或migration。原control不具备完整audit SELECT，查证已改用原命令效果与审计引用；未扩权。修复一个实际HTTP体验缺口：authenticate对已持久化revoked的Session先返回SESSION_REJECTED，避免global disable后的旧cookie误报503；不根据42501／任意驱动错误猜测失效，真正数据库／ACL故障仍503。该修正包含在上述定向及当前原登录验证中。receipt的历史通用排除项`raw User status/credentials`指任意原始行／凭据管理，不排除本包受控全局状态命令及最小状态展示。

当前scanner出现原文件pin漂移，**未更新pin／未重签未知库，也未启用模拟scanner**。普通`--unified-trial --serve`只将该依赖标为UNAVAILABLE，账户与普通教学继续；[实际隔离核验](evidence/account-status/scanner-isolation.json)确认活动查询200、附件scanner mode=null、新教学资源上传503。新附件／资源扫描上传保持关闭，真实scanner修复为独立服务配置待办；不把此前扫描成功证据冒充当前可用。本包未重复完整课堂、模型、扫描／导出套件或GitHub CI。

真实运营审批／人员职责与生产部署、登录别名／标识、多类导入等仍保留。普通首密／入驻来源不会因global restore复活；本包不提供密码恢复或重新实名绑定。无commit／push／CI、真实55432／55433或生产变更，既有dirty候选保留。下一完整功能建议沿原P3接**受控登录标识与目录映射**；建议 **GPT-6.1 Sol / high**，集中处理唯一性、本人绑定和登录拒绝边界。
