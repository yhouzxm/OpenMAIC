# P3 空间成员加入、启停与允许角色管理

后续交付：[教师课程／教学班授权](zhiban-v2-teacher-scope-local.md)已接G3；本文保留首包时点范围，当前顺序只认原计划。

状态：**LOCAL 产品首包已实现并通过真实旅程**（2026-10-18）；真实运营与生产启用仍按下列独立门禁。沿[集中设计](zhiban-v2-account-management-design.md)，基线 `refactor/zhiban-v2` / `daf63afa83470d24a9ed41d171c6a17f8a80adb6`，dirty候选需与来源hash一同使用。

## 产品入口与范围

默认3461，管理员进入“成员账户目录”，点击成员卡片的“管理空间成员”。可以读取当前授权、邀请已有全局账户、激活PENDING成员、停用／恢复本空间成员、逐grant撤销、授予STUDENT/SELF或他人的TENANT_ADMIN/TENANT，以及显式替换全部授权。显示完整有效grant分页后才允许形成替换提案；超过页面上限拒绝，不截断后静默替换。截止时间留空长期，仍受操作人授权期限约束。

本人加入页 `/zhiban/join?tenant=...&admission=...` 在ACTIVE空间选择之外，可先登录再读本人context；不要求目标已经有本空间成员资格。同意只记录本人意愿，管理员须读最新状态并再次输入本人密码后激活。目标仍需单独Enrollment才能访问课程。学号／工号不成为登录名，邀请不代设密码，也不提供全局用户搜索。

空间成员停用不等于global User停用，不吊销其他空间Session、不删除Enrollment／任教关系或作答／成绩；新请求按当前资格拒绝。恢复必须有当前状态绑定的新admission、本人新consent及当前管理员审批，不复活旧撤销／过期授权，也不自动新增Enrollment。当前UI恢复采用REPLACE_GRANTS，只能重新批准本轮允许角色；包含教师授权的恢复保持关闭。

本人不提供普通单目标启停／角色修改按钮。本人当前仅有一条有效TENANT管理员grant时，可以输入其他ACTIVE接任成员ID，原子授予接任者管理员并撤销本人该grant。交接成功后，即使本人失去管理权限，也显示已提交结果与返回工作台入口，不把随后的无管理资格误报为提交失败。最后管理员约束仍由既有Identity事务执行，不以页面禁用代替。

角色可以多条并存，不保存旧版accountType。当前工作台仍沿用既有角色优先级，没有新增多角色视图切换。TEACHER/CLASS／COURSE关系加载与作用域消费者、普通global新开户／首密交付、登录别名、真实恢复渠道与完整管理历史查询仍未开放。本包不是全量账户管理或生产入驻交付。

## 本地受控入驻输入

网站没有签发admission或control批准的路由。仅默认 `--unified-trial` 组合显式启用membership及真实member／consent安全点读；其他host与正式Identity配置不变。普通platform bootstrap operator仍为null。现有Identity／控制面facade、step-up、CAS、audit与最后管理员屏障全部复用，不改冻结引擎或SQL。

`member-authority.ts` 是 owned disposable PG56517 的**LOCAL合成运营方**，不在生产root中提供默认store：启动生成两个不同Ed25519 key；记录的完整control manifest由两把key分别签名，读取store只接受固定LOCAL标记、同环境、MEMBER_ADMISSION用途、固定不同的合成操作／审批来源及两签名。私有目录0700、key/config0600、只写一次的来源文件0400；root、文件owner、权限、路径及签名检查失败均拒绝。两签名证明本地机制，不证明两名真人审批或真实身份核验。

独立synthetic SystemAdmin fixture不拥有tenant成员身份／教学权限；其凭据只在私有control配置中，不进入普通演示账号或页面。通过原ControlCommands.registerApproval／execute、本人当前密码及当前SystemAdminGrant登记并生成admission，不直接INSERT admission。测试中新User/Credential也是原有专用seed方式，明确是合成前置对象，**不是实现了普通User开户／初始密码交付**。

准备命令（当前项目目录运行；以下为参数名，不是实际ID）：

```bash
pnpm exec tsx scripts/zhiban-local/prepare-member-admission.ts TENANT_ID USER_ID INVITE
pnpm exec tsx scripts/zhiban-local/prepare-member-admission.ts TENANT_ID USER_ID REACTIVATE MEMBERSHIP_ID
pnpm exec tsx scripts/zhiban-local/prepare-member-admission.ts TENANT_ID USER_ID REJOIN MEMBERSHIP_ID
```

命令只读取当前LOCAL metadata绑定的根及hash匹配的私有config，固定Unix socket／56517／`zhiban_trial_content_disposable`，不读取真实55432／55433或任意DSN。非邀请模式经受限tenant repository读目标版本作为hint；控制面在同一原事务重新验证，不将这次跨连接读当授权或原子证明。最终stdout仅输出LOCAL定位引用、加入URL及期限，不输出密码／签名私钥。

来源有效期30分钟、tenant/control容量各10000，显式配置且在既有校验上限内；不自动续期。无membership的INVITE、DISABLED的REACTIVATE、LEFT的REJOIN按各自状态准备；过期PENDING不能靠重新发行INVITE绕过历史／唯一约束，应按受控流程处理或重建disposable，不伪装无限可续期。容量／限流不足拒绝，CLI不自动重放审批。

当前私有输入文件为 `/tmp/zhiban-trial-content-faL99P/member-inputs.json`，包含合成账号、30分钟来源及加入URL。额外手工交接验证已经由管理员创建邀请，目标保持PENDING／尚未同意；可用该账号打开joinUrl，明确同意后由管理员重新读取并激活。主旅程的另一个成员已完成激活、Enrollment与课程访问。普通三角色账号见 `/tmp/zhiban-trial-content-faL99P/accounts.json`；合成密码不写本文或Git证据，实时状态以 `pnpm trial:zhiban:info` 为准。

## 未知结果、并发与权限

每次敏感命令输入操作人当前密码，提交前即清空输入框；密码只作为临时请求材料，不放command对象的持久待办、日志或localStorage。结果未知暂停其他写，保存安全意图／原key，重新读取actor/target/tenant版本，再输入当前密码确认。旧正文stale时拒绝，不能用业务profile的简化重试协议替代Identity。明确冲突后可结束旧确认并读当前事实重新审批，页面说明这不证明旧操作失败。

原子交接丢响应且原操作者已失权时，本页不自动重放／恢复本人权限，需现任管理员受控核对；没有新增跨actor终态查询或全局恢复权限。页面变更身份会清空／重新核对，其他用户或tenant的ID不是授权。授予期限、same-grant权限＋scope、last-admin两计数、Session-at-write和提交前fresh验证均仍由原引擎完成。

## 本地验证与证据边界

**58项定向测试通过**（含4项新增来源边界测试及既有54项Identity组合／安全查询测试）；定向旅程12组、默认统一旅程36组均通过，其中新增成员5组在两次旅程中重叠，不相加计算。额外独立CLI签发、管理员真实登录邀请及无ACTIVE空间目标的加入页登录验证通过。定向类型检查及ESLint通过；运行来源1536项匹配、drift=0。见[最终收据](evidence/zhiban-membership-local.json)与[5组旅程](evidence/zhiban-membership-journey-local.json)。新增验证覆盖两方签名／篡改用途／伪造GitHub标记和路径拒绝、真实邀请与本人consent、独立Enrollment、禁用竞争CAS、停用本空间但其他空间／global Session仍有效、恢复新来源链、角色UI、真实提交后模拟丢ACK的current-version确认、effect故障整笔回滚及原子交接。

管理员新页初始化曾由导航壳与成员点读同时认证，在8次进入中3次返回503。成员页现等待DOMContentLoaded后的管理员壳ready再读取；修复后8/8进入成功，网络顺序为壳核验→spaces→member。该补验修复不改认证CAS规则；见 `evidence/member-management/initial-read-before.json` 与 `initial-read-after.json`。

117项Identity来源和28个migration与上一交付hash一致。部分冻结拒绝路径公开为503；验证同时检查无状态／grant／ledger越权变化，不把503误记为授权成功，也不宣称全部拒绝均为403。既有评分旅程曾在名单异步刷新时遇到CSRF503，页面保留待确认；脚本现等待名单刷新结束再发布，未改Identity或宣称全部503根因已消除。辅助管理员按既有资料测试退出全部会话后，交接测试现重新登录，不放宽会话规则。

没有扩展历史Identity／Storage CI或旧31组课堂证据的适用范围；新增证据标记LOCAL／githubActions:false。本轮无commit／push／CI dispatch，不运行真实数据库。切换前双库、账号与scope备份见[备份收据](evidence/member-management/backup.json)，新启动仍是新合成课堂，不冒称继承旧实例。最终双库、账号、control私有配置／两把合成key及签名来源备份见[交付备份收据](evidence/member-management/delivery-backup.json)；逻辑归档目录验证通过，未宣称实际恢复测试。

下一步：集中补G3教师CLASS／COURSE关系加载与所有相关作用域消费，再决定普通global开户的首密交付；不重复实现已有成员生命周期。建议GPT-6.1 Sol / high用于跨Identity／教务授权设计；页面视觉收敛可用medium。
