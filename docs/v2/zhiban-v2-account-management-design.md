# 原 P3：账户开通、成员启停与角色管理集中设计

> 2026-10-23 后续实施：[受控登录标识／目录映射LOCAL包](zhiban-v2-login-identifiers-local.md)通过独立入口与新registry补齐；原UserId首版契约及历史设计正文保留，不将邮箱／学号自动升格为账号。真实审批／部署仍待。

> 2026-10-22 后续实施：[受控全局启停与目录联动](zhiban-v2-account-status-local.md)已沿原USER_DISABLE／USER_RESTORE接独立LOCAL CLI和最小租户只读状态。以下历史设计不覆盖该交付；真实运营审批／部署及登录别名仍待。

> 2026-10-22 实施更新：G4普通global开户／首密的[LOCAL完整产品包](zhiban-v2-account-onboarding-local.md)已落地。以下为原集中设计；新增独立 ORDINARY_FIRST_PASSWORD 合同详见产品包，未挪用原bootstrap／recovery。真实身份核验／交付输入、全局启停及登录标识仍未开放。

2026-10-18设计；随后用户授权整体实施首包，现已交付[LOCAL空间成员管理包](zhiban-v2-membership-local.md)，具体范围与证据以该文为准。随后G3已按[教师课程／教学班授权包](zhiban-v2-teacher-scope-local.md)完成LOCAL接线；下文缺口记录保留设计时点。下文的“未启用／只改文档”为设计时点记录，不表示后来实现仍关闭。

原设计时点状态：**DESIGN_CANDIDATE / 未启用新能力**。本轮用户要求集中明确差额；不是开户、凭据交付、授权规则变更或生产部署批准。基线 `refactor/zhiban-v2` / `daf63afa83470d24a9ed41d171c6a17f8a80adb6`，worktree 非 CLEAN，既有候选保留。本轮只改文档，无应用／SQL／migration／ACL／配置修改，不重启3461、不操作真实55432／55433、不 commit／push／CI。

权威为[原 P1–P7 计划](zhiban-v2-migration-completion-plan.md)、[冻结 1B-8 A/B/C](phase1/phase1b-8-identity-composition-design.md)、[8D HTTP](phase1/phase1b-8d-http-api-design.md)、[8E 受控人工恢复](phase1/phase1b-8e-recovery-design.md)及当前实际实现；历史文档中的 ABSENT／待BUILD不覆盖后来已有源码，但已有源码也不代表默认宿主已启用或真实交付输入已齐。

## 1. 结论与首包范围

沿用既有 Identity，而非移植旧账户数据库。首包建议为一个完整“空间成员管理”产品包：**管理员查看本空间成员→凭有效入驻引用邀请已有全局账户→本人同意→管理员重新核对后激活；管理员停用／恢复本空间成员、管理当前冻结合同允许的角色；成员即时失去或重新取得对应访问。** 本人资料和管理员正式档案继续使用现有页面，不重做。

“开通”在首包中只表示已有 global User 加入本空间。全新 global User 建立、首次密码设置／安全交付、人工密码恢复、全局停用、登录别名、新教师角色授予分别标注自己的缺口；不能在一个“新增账号”按钮下假装全部完成。未具备入驻来源时，停用与合法角色管理可独立交付；邀请／恢复显示明确未配置原因，不用 fixtures 证明真实开户。

## 2. 旧分支、新版与当前差额

固定旧分支 `origin/feature/zhiban-mechatronics` / `0fa0a15e8b12ae9e4f7a2d78e80338874599bbae`；新版沿此前已核对的固定官方1.2.0，不在本轮重新声称远端最新。

| 能力 | 实际资产 | 本轮决定／差额 |
| --- | --- | --- |
| 旧管理员新建学生／教师 | 旧 `admin/accounts` POST接受姓名、密码、学号／工号并将业务编号作为loginName | 保留“受控加入与可追溯管理”的需求；取消复制直接开户、默认学生grant、业务编号登录和代设密码的实现 |
| 本人资料、正式档案、分页目录 | 当前 profile 页面／API 已有，角色／成员状态只读 | 复用目录与页面壳，增加成员管理详情；私有联系方式仍只对本人 |
| 本人密码／会话 | 当前 `/identity/password`、`logout-all` 已接 | 保持；不扩展为管理员重置别人密码 |
| 邀请、同意、激活／恢复、角色操作 | MembershipCommands、MemberCommands、MemberAdmissions 与 8D路由均存在 | 补宿主组合、真实点读、管理UI、入驻引用交付和完整旅程；不是重写底座 |
| 默认宿主是否启用 | `verify-m6-catalog.mts` 配置 `operator:null / membership:null`，member与consentContext查询显式Closed | 当前网站没有可用管理写入口；不能只加按钮或将null换成无来源store |
| 全局创建／禁用／恢复 | ControlCommands 有 USER_CREATE／USER_DISABLE／USER_RESTORE；独立SystemAdmin＋可信approval | 不接租户管理页面，不因TENANT_ADMIN或业务管理员身份获得这些能力 |
| 初始凭据交付 | PlatformIdentityOperator 的provision引用限定 FIRST_PLATFORM_ADMIN／FIRST_PASSWORD 链 | 不能泛化为所有新用户开户。普通User的首次凭据核验／本人设置／交付渠道仍需单独补合同和配置 |
| 人工恢复 | 8E已有代码、独立私有HTTPS／证据／终端协议 | 保留既有设计；具名核验人员、原始身份绑定、可信证据、终端和通知输入未在默认host配置，不新增公共重置 |
| 新教师授权 | `mayDelegate` 仅允许关系已核验的CLASS／COURSE教师；MemberCommands固定传relationship=false | 明确为单独门禁，不能用TEACHER/TENANT、布尔relationship或演示seed绕过 |
| 多角色／登录标识 | UserId-first；学号／工号为租户业务编号；成员可多角色 | 不恢复旧单一accountType。STUDENT与TEACHER可并存的展示保留，但不因此开放新的教师grant写入 |

## 3. 谁能做什么

| 操作者 | 首包允许 | 明确排除 |
| --- | --- | --- |
| 当前有效TENANT_ADMIN，持同一有效TENANT grant的必要permission与scope | 本租户受限成员查询、允许的成员命令；敏感命令逐次输入本人当前密码，服务端fresh re-auth | 跨租户搜索global User、修改global状态／密码、替本人同意、无来源登记、超出自己有效期的授权 |
| 收到有效入驻引用的目标本人 | 登录后读取自己的consent context并明确同意；PENDING时也可进入专用加入页 | 同意即激活、自选管理员角色、看到别人的邀请／联系人 |
| 普通教师／学生 | 本人资料、账户安全、当前有效空间与业务访问 | 成员管理、他人角色或状态修改 |
| 独立平台操作人 | 经原control facade和可信store处理所批准的global/admission动作 | 自动成为tenant管理员或读取教学内容；在普通浏览器提交“approved:true” |

权限依据服务器当前事实，不信任页面角色、目录行、Session旧快照或按钮禁用状态。默认不提供本人单独停用／自改管理员角色；管理员交接单独走已有admin-transfer原子协议及其冻结约束，不以先撤后加的两个请求替代。第一位管理员bootstrap、无管理员恢复不属于本页面。

## 4. 状态、后果与页面文案

| 当前状态 | 可申请操作 | 必要条件与结果 |
| --- | --- | --- |
| 无本空间Membership | 邀请已有账户 | 目标绑定的有效admission、当前管理员step-up；服务端创建PENDING且空grants。无全局用户搜索／存在性探测 |
| PENDING | 本人同意→管理员激活 | 同意仅写consent；随后管理员重新读取revision/authVersion、重新审批允许的grants再激活；邀请发起人的旧权限不算当前批准 |
| ACTIVE | 停用本空间成员、允许的grant／revoke／replace | 锁内当前资格、CAS、last-admin和完整post-state；停用变DISABLED，阻断本空间业务访问 |
| DISABLED | 恢复本空间成员 | 新admission＋本人新consent＋当前管理员审批。默认界面建议显式REPLACE_GRANTS；可选preserve只列当前仍有效的既有grant，旧撤销／到期／未来grant不复活 |
| LEFT | 重新加入 | 新admission＋consent＋审批，新grant IDs，不恢复历史权限；不是Enrollment恢复 |
| Global User或Tenant不可用 | 无普通成员页面恢复 | 拒绝；转独立控制流程，不显示“启用成员即可恢复登录”的误导文案 |

首包不提供Membership管理离开按钮；保留已有LEFT记录及重新加入协议，不将其混同学生退班。停用Membership不吊销global Session、不改其他空间、Enrollment／任教关系、提交／成绩或历史作者；这些业务数据继续留存。恢复不续期过期任教／Enrollment，不恢复已撤销角色。每次业务请求仍按当前资格检查；已读出的文本、下载的文件及离线HTML不能远程收回。角色撤销不删除业务关系，但对应入口和新操作须失去资格；组合实现时必须实测，而非仅靠界面隐藏。

## 5. 角色管理与教师门禁

首版只呈现冻结委派规则可接受的提案：STUDENT/SELF，TENANT_ADMIN/TENANT（仅他人，且满足自提权／有效期／last-admin约束）。不能把一个role字符串解释为单一账户类型；显示有效授权的scope、有效期和grantId，逐条撤销；替换操作完整展示将移除／保留的集合，不从分页首16条猜完整授权。

**TEACHER缺口分为两部分，必须一起闭合：**

1. Identity 的CLASS／COURSE关系加载器：明确定义资源的canonical ID、租户归属、实际资源／任教事实及同事务锁／最终复核，接冻结same-grant／ceiling协议；当前固定false不能改成caller布尔。不得新增TEACHER/TENANT委派规则来绕行。
2. 教务／教学范围消费：当前 `academic/postgres/store.ts::eligible`按role_code查有效grant，未限定scope；赋予局部教师grant后，必须对任教设置、课程负责人／班主任等资格入口和教学读写逐项核对scope与实际assignment／offering映射。Course与Offering／行政班不是同一个ID，不能直接当等价scope。需统一关系语义后再实现，防止局部grant被当作全租户教师资格。

因此新增／替换／保留恢复中包含TEACHER授权时，在该门禁完成前拒绝并说明原因；不能将试用中由专用fixture构造的教师角色认作正式委派成功。已有演示教学不在本轮改写；该记录不是对既有试用数据授予生产合法性的证明。普通学生／管理员的首包不因此重回M5或等待Runtime维护输入。

## 6. 页面与API接线

管理员沿现有“成员账户目录”进入成员详情，分“正式档案／空间成员状态／角色授权”展示。按钮明确“停用本空间成员”“恢复本空间成员”，确认面板展示目标、当前状态、预期角色及影响，输入的是操作人本人的密码。禁用状态说明缺输入／权限／状态／版本原因，不伪装操作成功。

加入入口建议 `/zhiban/join?tenant=<id>&admission=<id>`，置于ACTIVE空间选择之前：新PENDING本人不可能靠spaces的ACTIVE-only列表找到邀请。链接仅含非secret定位引用，不能作为bearer approval；本人Session＋目标绑定仍必验。不提供公开用户探测／邀请扫描列表，不使用profile未验证邮箱自动发邀请。交付现有入驻引用的具体渠道按可信运营配置；本地仅合成对象、明确LOCAL标记。

直接复用以下8D端点，不新增业务写Identity代理：

| 端点 | 用途 |
| --- | --- |
| GET `/api/zhiban/identity/tenants/:tenant/memberships/:member` | 安全点读、actor／target／tenant版本；有效grants分页、适用consent |
| GET `.../consent-context?admissionId=...`，POST `.../consents` | 本人确认当前目的／期限并同意，不激活 |
| POST `.../invitations` | 已有有效admission的邀请；本人密码step-up |
| POST `.../memberships/:member/{activate,disable,reactivate,rejoin,grant,revoke-grant,replace-grants}` | 复用既有strict DTO、closed reason、版本和命令协议 |
| POST `.../admin-transfer` | 既有最多两个目标的原子管理员交接 |

目录复用profile分页，进入详情后重新点读Identity；profile revision不充当membership revision。grant有效列表默认每页16，完整变更不得静默漏页；无法建立完整安全提案时拒绝，而非拼装失真的replace。无admin教学代理、global User列表或普通control/recovery HTTP路由。网站请求不执行DDL／注册审批。

## 7. 并发、未知结果与审计

保持既有锁序、Session-at-write、目标／actor／Tenant CAS、逐grant权限上限、两个目标及256 guard users上限；所有变更、approval消费、领域audit、command/effect在原Identity同一事务。KDF／外部来源读取在关键锁外，锁内和提交前重新检查当前事实／期限。停止和撤权不等待客户端刷新才生效；锁顺序决定线性化点，不承诺取消已经完成的读。

**不能复用业务资料“原正文原号直接重放”的简化语义。** Identity为stale-before-no-op：写失败／超时后清空密码，进入结果待确认；不自动提交新命令，不把秘密写入localStorage／日志／命令账本，不保存密码hash或secret fingerprint。显式重读当前版本后，只有仍匹配原安全意图且当前状态符合既有terminal确认协议，才由操作人重新step-up、用原key及当前expected版本确认；有后续变更／新consent或admission要求时拒绝旧确认并回到重新审批。HTTP 409／401／403／404／429／503保持既有归类。

不新增任意中文原因写入冻结audit payload；采用现有closed reason选项，显示本地化说明。如需额外管理说明，另议tenant业务审计，不能声称其与Identity跨库原子。本轮也不开放任意Identity audit表给业务runtime；管理页面先显示当前安全结果及commandId，完整历史查询是独立受限投影差额，不冒称已有。

## 8. 一次性实施包与交付输入

下一实现包应同时完成宿主组合、受控LOCAL配置、详情／加入页、状态与允许角色写入、结果确认和一条完整旅程，不按单按钮拆成多轮复评。

| 差额 | 实施要求／输入 | 未满足时 |
| --- | --- | --- |
| G1 宿主与安全点读 | 独立选用membership policy，恢复真实member／consent queries；保持普通operator独立关闭 | 不提供可点击的写入入口 |
| G2 入驻来源／运营交付 | MemberAdmission与独立control approval可信store、具名责任／环境、不可变目标绑定及引用交付；本地可有明确合成测试store，不能写HUMAN_APPROVED冒充真实批准 | 无来源时关闭邀请／恢复；不得直接INSERT admissions或global User |
| G3 新教师授权与作用域消费 | 第5节关系与所有相关消费者的集中精确补充 | 教师授权／含教师grant的恢复保持不可用，明确标注首包不全量覆盖教师开户 |
| G4 新global账户与首密交付 | 原始身份绑定、普通User首次凭据purpose／独立交付协议、操作者与本人权限、部分失败与撤销；复用现有User create和密码计算，不挪用FIRST bootstrap或恢复case | 全新开户不开放，不建议在租户表另建影子密码 |
| G5 生产输入／管理历史／别名 | 真实policy容量与TTL、trusted store、运营责任；历史查询精确安全投影；登录别名唯一映射／验证另定 | 不阻塞无依赖首包；逐项保留，不借配置默认开启 |

LOCAL profile建议容量为tenant/control各10000、source TTL 30分钟，均在现有校验上限内；这是本方案的合成试用配置建议，不是冻结合同默认值或生产批准。须显式环境绑定、source/hash、catalog/ACL核验及有限生命周期；可信store缺失／校验失败则关闭依赖动作，不降级为HTTP布尔批准。复用既有migrations；如未来G3/G4确需新数据库能力，另增successor并明确审阅，已应用文件不改。

## 9. 本地验收矩阵与完成口径

| 旅程／负向 | 必须看到的结果 |
| --- | --- |
| 已注册学生受邀→本人同意→管理员fresh激活→加入Enrollment→学习访问 | 同意不提前赋权；需单独Enrollment；真实当前授权可读／可作答 |
| 停用成员→学生再请求→恢复 | 本空间拒绝，其他空间Session仍可用；历史作答／成绩保留；有效新入驻链恢复允许grants，不自动新增Enrollment |
| 多角色grant／revoke／replace、有限期和分页 | 角色不是accountType；完整提案、过期／future／revoked不复活，授权不得超过操作人期限；第17条grant不丢失 |
| 自提权／最后管理员／交接竞争 | 单独撤销最后有效管理员失败；原子交接满足既有两个计数，不接受future replacement冒数；无FIRST旁路 |
| 提交前Session撤销／操作者失权、CAS与期限变化 | 独立PG连接＋确认屏障证明先后；失败不产生半变更，audit/source/ledger故障全回滚 |
| 丢响应／重复key／后续他人修改 | 只允许冻结的当前版本安全确认，不复用旧正文、secret或消费旧审批；不同意图拒绝 |
| 未配置／错误store／错误hash、非本人consent、外租户／全局探测 | fail closed且无存在性泄漏；没有fallback SQL／API；LOCAL合成证据不充当生产输入 |
| 教师门禁 | 教师候选选项不可误导为可提交；G3完成前正式授予失败，演示seed不能作为正向验收 |

验收只做本地受影响授权／并发检查和完整管理员→本人加入→学生访问旅程；保留已有教师演示回归。无需重复GitHub CI／所有旧安全套件。每个完成标签必须区分“核心用例已存在／宿主已接／合成LOCAL旅程通过／真实运营输入已具备／生产已启用”；不能合并成“账户管理全部完成”。本轮仅设计核对，未运行这些新增测试，也未扩展现有31组课堂或历史CI收据的范围。

实施回填：G1＋G2的LOCAL空间成员管理、允许角色与安全确认已按[产品包](zhiban-v2-membership-local.md)完成。G3已完成LOCAL关系／作用域接线；G4后续已完成顶部LOCAL独立包，真实运营输入继续待补。建议GPT-6.1 Sol / high用于Identity接线与并发审阅；纯页面视觉整理再用medium。不启动新的长期维护／复评主线。
