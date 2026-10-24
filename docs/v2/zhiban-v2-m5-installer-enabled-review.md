# M5 installer / receipt / enabled composition 独立复评

2026-10-09（Asia/Shanghai）。分支 `refactor/zhiban-v2`，HEAD `daf63afa83470d24a9ed41d171c6a17f8a80adb6`。工作区包含既有 M1–M5 未提交候选，本轮在其上定向复评、修复与本地验证。没有 commit、push、CI dispatch、生产部署或修改已应用 SQL。

本轮重新读取 installer、receipt、host composition、ContentService、Native adapter、原始 Identity guard/事务与已审核 ACL；逐项检查真实调用与证据，不把此前 19/17 PASS 当成复评结论。这里的独立复评是一次重新按代码和实际 PG 行为进行的评审，不代表外部人员或生产签收。

## 1. 发现与处理

| 编号 | 级别 | 具体问题与影响 | 已完成修复 |
| --- | --- | --- | --- |
| IR-01 | P2 | loader 忽略 formatVersion、target、approvalRef、issuedAt。实际把它们换成版本 999、错误库/端口、空批准引用和非法日期，仍被接受。实际 DSN 仍被独立限制，因此这是 receipt 证据完整性缺口 | 校验固定格式、批准引用、有效签发日期与完整本地 target；config mode/deployment UUID 也校验。负向测试拒绝这些变体 |
| IR-02 | P2 | 实现 hash 漏掉 config/launch/install 入口以及复用的 Identity/Bridge/其他业务源；issuer 只在开头核验 build，结束时可能给本轮未构建的变更签发新绑定 | 纳入整个 lib/zhiban（含 SQL）、所有实际本地 host 入口及配置、package.json/tsconfig；签发前与开始的 build binding 再次精确比较。入口和原 guard 源字节漂移、过期 build 均拒绝 |
| IR-03 | P2 | advisory 锁在业务 migration COMMIT 时释放，Native provisioning 和 receipt 写入未互斥；原地写 receipt 可能被并发读到半份 JSON，且已有文件权限不被 mode 参数纠正 | 固定 admin client 上持有覆盖整次安装的 session lock；receipt 用 owner-only 0600 临时文件写完后原子 rename。两个真实 installer 同时等待并串行完成；现有 0644 文件被替换为完整 0600 JSON |
| IR-04 | P2 | Content 诊断日志 appendFile 的拒绝未捕获，文件不可写时可能形成 unhandled rejection 并退出 host | 诊断 I/O 拒绝被吸收，PG 中的业务审计/事务不变。实际将私有日志设为不可写，连续拒绝业务写入后 host 仍响应；恢复原权限 |

SQL 的 deployment registry 本来就以 CHECK 固定 package 版本，原 profile 会核验约束，未发现包版本可任意替换；loader 增加显式 storage/dsl/renderer 比较，方便直接审阅这个绑定。未修改 schema、ACL、冻结 Identity helper、原始 Native bootstrap 或公开 package source。

## 2. 启用组合评审结论

- 私有配置经过 loader 后才构造真实 Bridge/Native pools；没有 browser 传入的 store、facts、owner、enabled 或权限布尔值。维护凭据不用于 HTTP 的数据读写。
- 原始 Identity guard 与 Academic lock helper 在同一 Bridge client 上执行；ACTIVE actor/related owner、单条 grant 的 role/scope、任教/Enrollment、业务状态与时钟均重新验证。冻结 foundation disabled composition 保留。
- 每个 Native 操作仍用独立事务与公开 owner-scoped DocumentStore。Native COMMIT 前的 fresh guard 与本地事务所持锁共同序列化撤权；本地发布结算再次验证。没有把跨库执行宣称为 ACID。
- Source revision、publication/Bridge generation 绑定、activation 反向约束、CAS、命令幂等与 audit 继续由原 SQL/仓储约束。撤权后旧 handle、幂等路径和下一次读取不会跳过授权。
- 原生提交后如果撤权阻止本地结算，保留 DRAFT 与 durable pending fence。此时 guard 也可能阻止 quarantine 更新，所以合法保留状态是 RESERVED 或 OUTCOME_UNKNOWN；不能只查字面 UNKNOWN 来找到待对账操作。
- LOCAL 技术 receipt 的信任边界是固定本机 owner-only 配置/源码/构建与显式 installer；完整 enabled gate、第三方签收、生产授权不由它产生。启动无 DDL，source/profile 漂移失败关闭。

在本轮范围内没有未处理的 P1/P2 发现。UNKNOWN 的授权对账明确不属于本次实现，仍是完整内容 gate 的未完成项。

## 3. 撤权屏障矩阵

使用新建合成 actor/owner、真实密码登录和 authentic handle、实际 ContentService/公开 DocumentStore 与 PG16。夹具仅代理 Pool.query，在真实 COMMIT 前或两个真实事务之间暂停；不替换 guard、返回值、provider，不向生产代码加开关。revoker 使用原始受限 runtime 角色；Session/Credential 使用原始 repository，角色/Membership/User/Academic 关系使用实际受限 writer DML 与原触发器。后者证明存储锁/授权效果，不代替管理员 HTTP 撤权 UI 的验收。

| 撤权对象 | dispatch 已提交、Native 尚未开始时撤权先提交 | Native COMMIT 前开始撤权 | 本地 publication COMMIT 前开始撤权 |
| --- | --- | --- | --- |
| Actor TEACHER role | PASS | PASS | PASS |
| Actor Membership | PASS | PASS | PASS |
| Actor User | PASS | PASS | PASS |
| Related owner Membership | PASS | PASS | PASS |
| Related owner User | PASS | PASS | PASS |
| Actor Session/logout-all | PASS | PASS | PASS |
| Actor Credential/security epoch | PASS | PASS | PASS |
| TeachingAssignment | PASS | PASS | PASS |

每一项都检查实际 `pg_blocking_pids`、精确 Native stage 行数、资源/publication/operation 状态，以及撤权提交后旧 handle 的下一次 SAVE/preview 被拒绝。预期分别是：

1. 撤权先提交：没有 Native write/commit、没有 publication。
2. Native COMMIT 已持授权锁：revoker 确实阻塞；Native 可先提交，随后 revoker 在本地结算前提交，publication 不激活，保留 fence。
3. publication COMMIT 已持锁：revoker 确实阻塞；publication 可先提交，随后撤权提交；下一次访问立即拒绝。不能把这个线性化顺序误判为撤权绕过。

另有 **Enrollment 2 项**：先撤销再读，无 Native query；学生 Native read COMMIT 期间撤销被业务关系锁阻塞，原读取完成后撤销生效，下一次 preview 不进入 Native。已经返回给浏览器的文本不能由 CSP 或数据库撤权收回。

合计 **26/26 PASS**，见 [撤权屏障证据](evidence/m5-revocation-barriers-local.json)。真实每 IP 每分钟 30 次登录限制保持原值；夹具触发后等待正常窗口到期，没有重置 admission 数据或换 IP 绕过。

## 4. 本地验证与证据适用范围

- [installer 复评证据](evidence/m5-installer-review-local.json)：两个进程互斥、重复安装不重放、旧 build 拒绝、原子 receipt 权限、ledger/Native/profile 保持，5/5 PASS。已有开发库上复核；没有为复评再建/重放首次安装。
- [启用负向证据](evidence/m5-enablement-gates-local.json)：25/25 PASS，receipt 元数据/hash/config、实际源字节、RLS/Native TEMP ACL 漂移、诊断日志 I/O、CAS、撤权与真实 Native commit/local failure。
- [产品旅程](evidence/m5-ab-local.json)：实际 HTTPS 教师/学生编辑、保存、发布/撤回、core history、CSP 与 Native 读写，19/19。最新检查数与绑定见本节所链接 JSON。
- 类型检查及 git diff/新增文件 whitespace 检查；应用前后 migration aggregate 始终为 `e335f83bb48cc6c4ec754f8e3270dc0e6941e14f38306bd67aa29844c3713324`。原 SQL 53/53 与原 M1–M4 回归继续限于其已验证行为；本轮改动没有业务 schema/共享 guard 语义变化，不重新机械跑全套或 GitHub。

运行命令：

```bash
pnpm build:zhiban:m5
pnpm setup:zhiban:m5
pnpm dev:zhiban
pnpm verify:zhiban:m5
pnpm verify:zhiban:m5:gates
pnpm verify:zhiban:m5:installer
pnpm verify:zhiban:m5:revocation
pnpm exec tsc --noEmit --pretty false
```

PG16 仅自有 `55433/zhiban_m1_dev` 与独立 `zhiban_m5_native`；没有触及 `55432/zhiban_pg16_test`。26 场景生成的账号只用于本次合成夹具，结束/失败时停用自己新建的用户，尽可能注销 Session；未改 M1–M4 既有账号。Native 文档、审计和 RESERVED/UNKNOWN fence 持续保留，没有自动删除、重放或将未知结果改写为失败。

## 5. 仍待完成

下一任务为 **UNKNOWN/RESERVED 授权对账的精确设计与实现**：授权主体、待处理枚举、exact outcome 证据、新鲜权限/版本检查、结算动作、不可证明结果与重入边界都要明确。不能以本轮屏障 PASS 自动解除 pending fence。

M5-C PNG、D Runtime、E AI、生产 release/OPS/DATA 仍按原计划推进；本轮不标 `ENABLED_BRIDGE_SIGNED_OFF`、`1B-10` 或整期完成。建议下一对账设计/事务评审使用 GPT-6 Astra / high；普通页面接线可用 GPT-6.1 Sol / medium。

## 6. 最终绑定

- migration：`e335f83bb48cc6c4ec754f8e3270dc0e6941e14f38306bd67aa29844c3713324`
- inventory：`c02250c7a6eca4941aff02fa4d2e8e502065c8a2b51fb866fc27047b76dd3a57`
- implementation：`a0946edb9a5cede3353794eff6da6d85049f4ccfb65985027ef235c9188e85a3`
- enabled profile：`59d93dd5ba57e387a7032a1cd7f92ecf1d70b82a1546bf16fd1b9cdc6a402ae4`
- Native profile：`50841b3ad3830ea74dd48247939be9108aa0b9aad5c1e4f84dc5489b12e39036`

26/25/19/5 四份最终运行证据与上述 implementation binding 一致。诊断中触发登录限流的一次中止夹具留下 1 个新用户，已按专属 seed audit 精确定位并停用；未影响已有账号、未删除历史。
