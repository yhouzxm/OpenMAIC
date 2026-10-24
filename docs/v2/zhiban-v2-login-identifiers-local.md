# 原 P3：受控登录标识与目录映射

2026-10-23，沿[原P1–P7](zhiban-v2-migration-completion-plan.md)及[账户集中设计](zhiban-v2-account-management-design.md)补差额。最终结果见文末。本包不修改冻结canonical UserId解析器、Credential、角色或Session语义，不将学号／工号／联系方式当登录账号。

## 产品范围

独立平台提名 → 本人使用现有UserId登录，核对精确`@标识`并用当前密码确认 → 通过同一密码／Session实现登录 → 管理员在原受限目录查看或精确搜索本空间映射。UserId始终可用；新标识不创建User、不复制密码、不赋权或加入课程。OpenMAIC的owner字段不作智伴身份依据。

标识是独立global namespace：`@`加5–48个ASCII字符，首字符字母，尾字符字母／数字，中间允许字母、数字、点、下划线、短横线。只去ASCII外围空白及折叠ASCII大小写；Unicode同形字、邮箱、手机号、业务编号、无`@`字符串不作为别名。显示名不具有身份含义。没有公开抢注、匿名存在性查询或租户管理员分配／转移入口。

每个User最多一个ACTIVE标识，可以有受限数量的平台提名；每个名称一经注册永久保留给原User，RETIRED后不能转给他人。新提名确认时在同一事务退役原ACTIVE标识再启用新标识；UserId和密码不变。本人可拒绝PENDING或停用ACTIVE，均需当前密码。停用标识只阻止以后用该名称登录，**不退出已经签发的会话**；需要退出全部会话可用原账户安全入口，需要全局停用走原独立平台流程。

PENDING提名最多30分钟，过期／User版本改变显示EXPIRED／STALE，需要独立平台重新提名。同一原User可对自己保留但未ACTIVE的名称重新提名；已ACTIVE不能被平台重写。平台操作人的User／SystemAdminGrant资格必须保持到本人接受时；已经完成的身份绑定不依赖后来某位操作人的任职有效期。global User停用阻断别名和UserId登录；恢复仍按原当前密码／新Session及权限验证，旧会话不复活。未消费提名不会因恢复自动重新有效。

## 来源、CLI与本人权限

复用当前LOCAL私有control根、原SystemAdminGrant和真实操作人密码／Session；不增global管理网页。新两签名envelope为`LOCAL_SYNTHETIC_LOGIN_IDENTIFIER`，purpose为独立`LOGIN_IDENTIFIER_NOMINATION`，不挪用USER_CREATE／MEMBER_ADMISSION／FIRST bootstrap或人工恢复来源。

签名覆盖环境、唯一sourceRef、alias→UserId、User／操作人／SystemAdminGrant版本、机构受控主体引用、签发及期限。两把不同Ed25519 key，来源目录0700／文件0400，拒绝symlink、宽权限、错误环境／shape／purpose／签名。数据库登记完整闭合manifest及domain-separated digest，和名称当前版本／追加事件关联。没有密码、bearer、CSRF或verifier进入来源、事件、日志／命令行。标识registry中保存名称是功能数据需求，不将请求identifier／IP写入运维日志或预算明文。

```sh
pnpm exec tsx scripts/zhiban-local/control-login-identifier.ts prepare USER_ID @ALIAS LOCAL_ROSTER_REF
pnpm exec tsx scripts/zhiban-local/control-login-identifier.ts execute SOURCE_REF
pnpm exec tsx scripts/zhiban-local/control-login-identifier.ts inspect SOURCE_REF
```

prepare只写签名文件；execute验证来源并经受限helper登记PENDING，不提前允许登录。网络／退出失败不能假设未提交；inspect返回NOT_REGISTERED、REGISTERED_CURRENT或REGISTERED_SUPERSEDED及当前安全状态。原source已经登记时只确认其当前结果，不产生第二次提名或重写后续变更。过期source不执行；不自动另造source重试。

LOCAL两个签名者为合成operator／approver，不代表两名真人审批、真实实名核验或生产启用。subjectReference是受控名册引用，不能提交身份证号或把未验证邮箱当实名证明。真实来源／人员职责／渠道及保留政策仍需独立运营输入。

本人页 `/zhiban/login-identifiers` 从工作台和个人资料进入，不需要已经加入空间。GET `/api/zhiban/login-identifiers/me`只读当前Session本人的提名／状态；POST闭合ACCEPT／RETIRE、alias、revision和当前password。当前Session＋Origin／CSRF与另一份通过原真实登录取得、至多60秒的新Session共同验证本人；新Session只作服务端本次密码确认，操作后退出，不替换浏览器原Session。不同User、旧版本、过期提名、失效来源或Session、wrong password拒绝。密码每次提交后清空，不存本地缓存／指纹；不确定结果先重新读取，不自动重放。

## 登录入口与交付屏障

原 `/api/zhiban/identity/login`仍只认UserId，原resolver源码未改。登录页输入`@`时选择独立 `/api/zhiban/login-identifiers/login`；格式之外不推断用户名或邮箱。

新入口在名称查询前执行独立PG共享预算，固定60秒窗、global100／真实peer40／规范化alias20、最多4096个HMAC键；不信任转发IP，不存明文alias／IP预算，不把预算hash当身份。随后只解析ACTIVE绑定，调用原真实／dummy密码验证及原LOGIN预算，最终使用同一Credential和Session Cookie。未找到／非法／密码错误／停用均统一未登录，不暴露存在性。网站边界严格同源／JSON／闭合DTO、8KiB body、最多4个并行请求。

名称解析和KDF不能当长期许可：取得原真实Session后，在交付cookie前重新守锁校验名称state／UserId／revision与当前User／Session。KDF期间退休／换版必须拒绝交付，并撤销该未交付Session。Session生命周期仍由原Identity负责；不宣称把已经成功交付的会话随标识退役撤回。

## 新数据与ACL

独立`zhiban_login_identifiers` schema：immutable-by-runtime approvals、永久names、append-only events、bounded HMAC buckets、source/hash ledger。names为PENDING／ACTIVE／RETIRED，alias唯一且一个User仅一个ACTIVE索引；最多10000个名称、每User10个，20000份批准和40000条事件，满额拒绝。

网站auth角色仅SELECT名称最小绑定列及调用本模块本人／交付／预算helper；不能读来源manifest、写名称表或执行平台nominate。平台control仅调用独立登记／查证helper，不能绕过自己的Session及当前SystemAdmin资格。tenant／academic角色无新schema访问，PUBLIC无权限；不扩展原Identity表／函数／ACL。独立expected profile核验本模块catalog／ACL、参与角色及membership edges、ledger与source/hash依赖闭包，网站不安装或自签expected profile。

所有变更排序锁定涉及的User，再检查来源grant、Session／epoch／credential、名称expected revision；密码计算在关键锁外。写名称、退休旧ACTIVE和追加事件在同一事务；事件失败回滚整个切换，两个同一名称版本的确认只能一个成功。独立登记用全局registry锁串行同名竞争；名称永不换User。本人retire不使用旧平台来源继续授权，只验证本人当前身份／密码。

0001已先用于独立reference，之后发现nomination_status输出字段歧义，使用0002资格／列限定successor；未重写0001。新模块的guard复用冻结User／slot／Session约束，在独立函数内实现auth/control精确caller检查；没有给auth授予原control helper或User UPDATE权限。

## 受限目录映射

原 `/api/zhiban/profile/:tenant/members`、`/zhiban/admin/accounts`保留当前租户／actor授权、分页和签名cursor。只有当前租户管理员才解析精确`@标识`，再以已解析UserId在原tenant RLS Membership窗口中查询；未知或外空间名称都是空结果。普通查询只对已经授权的当前页至多50个UserId取ACTIVE最小名称映射，不提供global名称／用户搜索。

显示当前alias、UserId、global状态及独立Membership状态；不返回提名来源、操作人、其他空间、私有联系方式、密码或凭据。正式姓名／学号／工号仍是租户业务资料，不随标识更换而改写，也不自动成为登录名。停用global账户的名称仍可在本租户目录展示映射，实际登录继续由原当前User状态拦截。

## 最终 LOCAL 交付（2026-10-23）

默认入口仍为 [3461](https://127.0.0.1:3461/zhiban)，工作台“本人登录标识”进入本人页；管理员“成员账户目录”支持精确 `@` 查询。当前合成学生已确认 `@trial.chen01`，使用其原密码登录；私有账号读取当前运行元数据所指的 accounts.json，不在文档打印密码。默认实例是 disposable，新启动不承诺保留旧实例数据。

独立 PG16 reference 构建、两项模型单测、定向 TypeScript／ESLint、受限 PG16／真实 HTTPS 旅程均通过。[定向收据](evidence/zhiban-login-identifiers-local.json)及[具体边界](evidence/login-identifiers/directed-journey.json)覆盖签名篡改、错主体／密码／CSRF、过期／撤权、审计失败整体回滚、同版本竞争、退役名称禁止转给别人、KDF 完成后退役阻断 Session 交付及 ACL/profile 漂移拒绝。reference 只证明独立构建，不单独代表产品授权签收；未放宽原密码验证预算。

定向旅程后仅修正 profile/service.ts 的空目录响应：未知名称与已知但不在本空间的名称统一空结果结构。保留原定向收据 hash，不把它追认为新源码证明；当前默认真实 HTTPS 已补验两个空结果及正常映射，见[增量边界](evidence/login-identifiers/projection-delta.json)。当前默认实例全部 2713 项 source hash 匹配，drift=0。

[默认真实旅程](evidence/login-identifiers/default-browser-journey.json)通过独立 CLI 提名及合成接收者真实 HTTPS 确认；原 UserId 登录及 Credential slot 保持。未加入空间的 User 也可本人确认。IAB 实际验证已绑定标识登录、本人 ACTIVE 页面和管理员大小写规范化精确查询，见[本人页截图](evidence/login-identifiers/default-self.png)与[目录截图](evidence/login-identifiers/default-directory.png)。确认绑定经真实 HTTPS 执行，浏览器未代填新凭据；不声称真人实名核验或生产审批。

本轮只增加独立模块 0001／0002；[39 份既有 migration 无漂移](evidence/login-identifiers/migrations-check.json)，冻结 UserId resolver／原 Identity ACL 未改。原 dirty 候选保留；无 commit、push、CI dispatch，未操作真实 55432／55433 或生产。分支与 HEAD 见[最终收据](evidence/login-identifiers/final-closeout.json)。

切换前后各有独立私有归档；[当前三库及 control／两签名来源备份](evidence/login-identifiers/default-backup.json)已核验归档目录和 hash，**未做恢复演练**。扫描器原 pin 漂移仍为 UNAVAILABLE，新扫描上传关闭；本轮不更新 pin，也不扩张既有扫描证据。

真实主体核验、独立审批人员及安全交付渠道仍需运营输入；本包不宣称整个 P3／P7 完成。下一完整功能建议沿原 P3 补**多类教务导入与批次结果**，复用现有名册导入、目录与分页能力；建议 **GPT-6.1 Sol / medium**，涉及新增 Identity 授权时再使用 high。
