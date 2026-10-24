# 原 P3 G4：普通账户开通与本人首密设置

2026-10-22，沿[原计划](zhiban-v2-migration-completion-plan.md)及[账户集中设计 G4](zhiban-v2-account-management-design.md)实施。最终结果见文末收口；未把既有成员管理、教师作用域或登录底座重写。

## 产品决定与复用

普通开户不是租户管理员直接创建 global User，也不是管理员代设／重置他人密码。完整流程为：

1. 当前机构管理员在“普通账户开通”填写姓名、机构受控名册引用、拟加入身份，提交本租户申请；可在平台受理前撤回。拟加入身份仅为申请说明，不能请求 TENANT_ADMIN／SystemAdmin。
2. 独立平台操作人通过受限 CLI 核对来源，用已有 ControlCommands 的 USER_CREATE、独立批准 store、当前 SystemAdmin、本人密码与 Session 创建普通 User。网站没有签发批准／global User 的端点。
3. 独立交付给目标本人的一次性首密设置凭证；平台和租户页面均不生成、读取或转交初始密码。本人通过独立设置页核验目标和期限，自选密码，随后使用原 UserId／密码登录入口。
4. 普通账户初始没有 Membership、角色、Enrollment 或任教关系。后续继续复用已有 MemberAdmission → 管理员邀请 → 本人同意 → 管理员重新 step-up 激活；课程权限仍依赖原关系。本包不把“能登录”冒充“已能访问课程”。

复用现有 Argon2PasswordHasher、受控 compromised-password corpus、永久 credential slot、aggregate 校验、CREDENTIAL_CREATED 审计和原登录／会话策略。普通首密 purpose 是独立 `ORDINARY_FIRST_PASSWORD`；不使用 `FIRST_PLATFORM_ADMIN`、`identity_credential_provisions/FIRST_PASSWORD` 或恢复 case，不调用管理员替换密码协议，不新建影子密码表。审计中的 `identity_provision` 表示执行初始凭据写入的服务，并不冒充本人已有登录 Session；新 claim/event 链记录具体普通首密目的与原 credential event ID。

## 授权与可信输入

| 参与者 | 允许 | 边界 |
| --- | --- | --- |
| 当前有效本租户 TENANT_ADMIN | 申请／安全列表／待受理撤回；查已批准的本租户申请状态和非秘密 UserId | 申请不产生 global 授权；不能查询全局用户、获取设置 token、批准／代设密码 |
| 独立平台操作人 | 经独立来源和原控制面创建普通 User，受控签发／撤销未使用票据、明确重新授权交付 | 不自动成为租户管理员，不自动授予申请角色；已设置密码不能通过本入口重置 |
| 持目标绑定票据的接收者 | 查看绑定姓名／UserId／期限、本人首次设密、确认已设置后登录 | 无用户存在性搜索；不能修改目标／来源／权限／期限；持有旧票据不能覆盖已有 slot |

LOCAL 的签名来源由现有私有 control 根内两把不同 Ed25519 key 构成：`LOCAL_SYNTHETIC_OPERATOR`、`LOCAL_SYNTHETIC_APPROVER`。新 envelope kind 为 `LOCAL_SYNTHETIC_ORDINARY_ACCOUNT`，签名覆盖普通首密 manifest 与原 USER_CREATE control manifest 的完整组合；环境、申请 digest、计划 UserId、原 control approval／command／digest、唯一 claim/source、操作人版本和 SystemAdminGrant 版本、原始主体引用、接收者交付引用、期限及被替代 claim 全部绑定。原成员 admission store 不放宽；普通 bootstrap operator 仍 null。

本地 subject/recipient 引用明确为 `LOCAL_SYNTHETIC_*:<requestId>`。两签名验证机制与来源完整性，不代表两名真人审批或真实实名核验。同名／名册引用不作为登录别名或全局实名去重依据。真实环境的原始身份唯一绑定、独立核验人员、交付渠道、运营职责及保留策略需要真实来源输入；本包不把 LOCAL store 当生产批准。

`account-approvals/` 为0700，签名文件0400；`account-delivery/` 为0700，交付文件0400，仅在该独占 owned root 内。数据库只存随机256位 ticket 的带域 SHA-256；明文 ticket 仅在接收者交付文件中，不进入网页URL、普通DTO、日志、命令账本、仓库或聊天。CLI只输出交付文件绝对路径、非secret定位信息与状态，不打印票据、密码、私钥。私有文件必须为当前owner的普通文件／目录，拒绝symlink、宽权限、错误来源／环境／签名。CLI只接受已固定LOCAL PG56517 Unix socket／3461及被receipt钉住的control配置，不读真实55432／55433。

## 数据、状态与并发

新独立 `zhiban_onboarding` schema：

- `requests`：租户、申请人、最小申请说明和digest、计划User／control来源、当前交付定位与版本。REQUESTED → WITHDRAWN，或平台APPROVED → READY → CLAIMED；未使用票据可REVOKED，READY超过期限对外显示EXPIRED。
- `claims`：受限普通首密来源／随机票据hash、目标与原User版本、租户版本、平台操作人／SystemAdmin版本、有效期、supersedes、最终credential／audit引用。READY → CLAIMED或REVOKED。重发新claim，原claim先原子撤销，不复活原票据。
- `events`、`commands`：追加的无秘密业务审计、管理员申请规范化幂等结果。密码及密码hash/fingerprint不进入这些记录。

FORCE tenant RLS；网页运行角色仅可读本租户申请、创建REQUESTED、撤回REQUESTED；不能写global指针／claims或执行签发／设密helper。control角色只获得新模块需要的状态、来源与受限helper。auth角色无claims表SELECT，只能凭claimId＋高熵ticket digest调用受限点读／消费helper。PUBLIC与各角色的schema/function/column权限由独立expected profile验证。

新迁移0001增加独立对象；0002仅把本模块UUIDv7 CHECK改为相同格式的本地表达式，避免扩展业务角色对冻结Identity函数的EXECUTE权限。0001曾在本包独立reference构造中应用，因此保留原文件，后续修正使用successor。没有修改原Identity表／函数／ACL／policy／已应用migration；loader核验两个ledger/source hash及catalog／ACL，不在网站运行安装或自签expected profile。

锁序为涉及User按ID排序 → Tenant／当前SystemAdminGrant → Session／epoch guard → claim／request → permanent credential slot；同一事务内重新检查当前事实和时间。目标User使用强锁，阻断同时新增SystemAdminGrant／改变global状态的FK与更新竞争。签发和撤销由私有broker进行，签发时还核验独立平台操作人的当前原Session；普通请求页不持有control连接或operator密码。

首次设密先点读并确认READY，再在锁外进行原参数的screening/KDF；锁内再次核验票据、expected revision、目标User ACTIVE／原revision、租户原revision、平台User／SystemAdminGrant当前资格及有效期。任何SystemAdminGrant历史或任何永久credential slot都排除普通首次设密。然后在同一原PG事务写原slot／credential、原CREDENTIAL_CREATED审计、新claim消费和新事件；aggregate校验及提交前时间屏障必须通过，失败整体回滚。两个并发设密只能有一个成功；消费后的凭证不能再次写密码，即使原密码后来被撤销也不能回到首密。

## HTTP、页面和不确定结果

- 管理员页 `/zhiban/admin/onboarding?tenant=...`，API `/api/zhiban/onboarding/:tenant/requests`：已有Identity Session、Origin、CSRF和当前tenant管理员守锁；20条签名cursor分页绑定tenant／actor，闭合REQUEST_ACCOUNT／WITHDRAW_REQUEST DTO。
- 本人页 `/zhiban/activate-account`，POST `/api/zhiban/onboarding/claim`：闭合INSPECT与SET_PASSWORD，不使用URL／query传秘密；严格同源／JSON／标志头、受限请求体及并发／真实peer限流。INSPECT返回HttpOnly Secure SameSite=Strict setup nonce cookie及绑定ticket digest／revision／origin的HMAC proof；SET_PASSWORD同时核验，不能换目标或拼接票据。它不是普通登录Session，不自动登录或授予角色。
- 已登录浏览器须先退出当前账户，避免本人设密后仍误以为登录的是新账户。密码字段在每次提交／失败后清空，不进入localStorage/sessionStorage；凭证只在当前DOM/内存中由接收者使用。
- 设置成功后明确显示非secret UserId及原登录入口。丢失响应时不保存／比较密码fingerprint、不自动重写，明确重新INSPECT：CLAIMED即转原登录验证；READY才由本人重新输入并明确提交。过期／撤销／来源变化均拒绝。

User创建、受控交付文件、claim注册不是跨文件／数据库的原子动作，故状态显式分期。创建User成功但文件／claim注册失败，保留APPROVED且没有密码／权限；原Control receipt和计划UserId不变，受控点读后接续，不另建User。先写受限交付文件、后注册claim，文件失败不能产生可用票据。注册COMMIT响应不确定时只确认原claim／原文件，不偷偷生成第二张票据。已存在可用票据的更新需要显式 `--reissue`，重新签署来源并原子使旧票据失效；CLAIMED拒绝。过期批准未创建User的接续要求新独立批准，不能把expired source当成仍有效的初始批准。

## 本地运用

普通启动仍是 `pnpm trial:zhiban`；有原私有模型配置的本机可以继续原私有启动器，其模型与本功能无依赖。新接口只在验证通过的新LOCAL统一host中启用，不增生产env开关或公共批准入口。

管理员提交后，独立运营终端执行（不传密码／ticket）：

```sh
pnpm exec tsx scripts/zhiban-local/approve-account-request.ts REQUEST_ID
pnpm exec tsx scripts/zhiban-local/approve-account-request.ts REQUEST_ID --reissue
pnpm exec tsx scripts/zhiban-local/approve-account-request.ts REQUEST_ID --revoke
```

交付文件由独立平台经受控本地渠道给目标本人。真实渠道尚未配置时不得发送给未核验的邮箱／电话，不能把租户管理员页面当作凭证领取端。网站不提供邮件／短信或任意用户搜索。


## 最终本地交付（2026-10-22）

**LOCAL 产品包已完成。** [最终收口](evidence/onboarding/final-closeout.json)、[定向PG16／HTTPS收据](evidence/zhiban-onboarding-local.json)、[授权／故障旅程](evidence/onboarding/directed-journey.json)记录范围；定向fixture及临时构建目录已停止／删除。独立expected profile构造、2项领域边界用例、定向类型检查与ESLint通过。只运行开户相关验证，没有重跑完整课堂、模型、导出或GitHub CI。receipt中的`raw User status/credentials`排除项指任意全局状态／原始凭据管理，不排除本包经受限auth helper写入的首个credential。

本包PG16验证包括：租户／角色／CSRF及闭合DTO、规范化重放与冲突、独立来源签名／purpose拒绝、原USER_CREATE开户、无自动Membership／角色／Enrollment、原邀请／本人同意／管理员激活；真实KDF并发只有一份凭据、审计写失败整体回滚；User创建成功但交付文件失败可按原proof接续且不重复创建；丢ACK经CLAIMED及原登录确认；撤销／换票拒绝旧票；KDF期间过期、目标停用、平台授权撤销均拒绝；永久slot、RLS／ACL与expected profile漂移拒绝。属于新owned fixture中的受控故障注入，不是操作真实用户。

当前默认[3461入口](https://127.0.0.1:3461/zhiban)保留运行；[info](evidence/onboarding/default-info.log)为RUNNING_LOCAL_DISPOSABLE、sourceMatches=true、drift=0。[实际默认入口旅程](evidence/onboarding/default-browser-journey.json)：IAB管理员填写申请，独立CLI批准，合成接收者通过真实受信HTTPS自选首密，IAB核验CLAIMED／不可再设密并使用新凭据从原入口登录，工作台显示“你还没有加入空间”。新密码没有通过浏览器代填，本人设密表单的提交使用同一真实HTTPS端点；不将其描述为全程人工浏览器设密。

- [管理员最终状态](evidence/onboarding/default-admin-claimed.png)
- [本人首密终态](evidence/onboarding/default-setup-confirmed.png)
- [新账户原入口登录](evidence/onboarding/default-first-login.png)

当前三角色合成账号仍从`pnpm trial:zhiban:info`输出的本机0600 accounts.json读取。新演示接收者的合成凭据仅保存在owned root内0600 `onboarding-recipient.json`；交付票据仅在私有0400交付文件，不进入仓库。停止会删除owned root；[切换前归档](evidence/onboarding/before-backup.json)与[当前归档](evidence/onboarding/default-backup.json)均包含三库dump、私有控制／交付输入，并校验hash及目录；未做恢复演练，不宣称已把旧课堂恢复到新实例。

[冻结迁移核对](evidence/onboarding/frozen-sql-check.json)：37份本轮前已有migration hash无漂移；新建本模块0001／0002仅应用于LOCAL disposable。基线仍为refactor/zhiban-v2 / daf63afa83470d24a9ed41d171c6a17f8a80adb6，原有dirty候选保留；无提交、推送、CI、真实55432／55433或生产变更。

未完成的边界仍是：真实原始身份／唯一绑定与独立核验人员、接收者交付渠道及运营保留策略、全局启停管理、登录标识／别名。开户不自动激活成员或开放课程；P3／P7不能据此宣布全量完成。下一完整功能建议沿原P3接**受控全局账户启停与受限目录联动**，保持平台／租户职责和跨租户失效边界；建议 **GPT-6.1 Sol / high**。
