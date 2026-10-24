# M5 终态处置 SQL/helper/ACL/receipt 与恢复候选清单

日期：2026-10-12。状态：`UNAPPLIED / UNISSUED / NOT_WIRED / R3_CANDIDATE_REVIEWED / KEEP_ALL_FENCES`。

[SQL/profile、服务审计与接管屏障定向评审](zhiban-v2-m5-terminal-sql-review.md)初版发现 TSQL-01–03 三项 P2；现已完成 [R3 修复与本地定向验证](zhiban-v2-m5-terminal-sql-r3-fix-local.md)及[定向复评](zhiban-v2-m5-terminal-r3-review.md)：三项 P2 关闭，另有一项 P3 测试证据问题。下方初版 hash/静态证据保留历史范围，当前 hash 见末节。

依据 [R2 精确设计](zhiban-v2-m5-terminal-reconciliation-design.md)生成 [独立候选目录与安装边界](candidates/m5-terminal/README.md)。branch `refactor/zhiban-v2`、HEAD `daf63afa83470d24a9ed41d171c6a17f8a80adb6`；工作区仍包含此前未提交候选。本轮没有任何数据库操作或现有安装 receipt 重签发。

## 可评审产物

| 范围 | 候选文件 | 明确边界 |
| --- | --- | --- |
| 角色与实际 catalog 观察 | [role bootstrap](candidates/m5-terminal/00-role-bootstrap.sql)、[catalog observer](candidates/m5-terminal/00-catalog-observer.sql) | 新增五个 NOLOGIN 角色，只有 observer 有只读 stats role 边；无 owner 边/业务表权限 |
| 新 migration 与授权账本 | [schema](candidates/m5-terminal/01-schema.sql) | Content 后继版本拟定 0002；service/window/claims/grant/proof/resolution/lookup/审计/private write scope，全部不 seed 授权或安装 ready |
| 内容来源与永久历史检查 | [common/history](candidates/m5-terminal/02-common-and-history.sql) | 纯文本预期文档重建、精确 snapshot、当前 barrier 与历史一致性分开 |
| 单笔 helper | [operation helpers](candidates/m5-terminal/03-operation-helpers.sql) | proposal、一次性 grant、完整 proof、原子 prepare成功/generation orphan/content失败，保留原 actor/pointer |
| 接管、恢复与查证 | [control/lookup](candidates/m5-terminal/04-control-and-lookup.sql) | 正常 RESUMING/CLOSED 与 BLOCKED/SUPERSEDED 接管分开；ACK_UNKNOWN 只查结果 |
| 原约束差异 | [三函数精确 replacement](candidates/m5-terminal/05-existing-constraint-supplement.sql)、[guards](candidates/m5-terminal/06-guards.sql) | 四个既有函数更替，包括 business_resource_ready；原 applied 文件不修改，原 publication/activation/历史约束保留 |
| RLS/ACL | [Business ACL](candidates/m5-terminal/07-acl.sql)、[Native ACL](candidates/m5-terminal/08-native-proof-acl.sql)、[catalog inspect](candidates/m5-terminal/09-catalog-inspect.sql) | 客户端仅精确 helper EXECUTE；Native 五表 SELECT+stages.UPDATE(id)，实际写权必须由封闭 proof worker 隔离 |
| 来源与 receipt | [inventory](candidates/m5-terminal/inventory.json)、[安装模板](candidates/m5-terminal/receipt.template.json)、[终态结果模板](candidates/m5-terminal/resolution-receipt.template.json) | LOCAL、UNISSUED、runtimeAccepted=false；模板不是现有 host 凭据或完整 enabled gate |
| 恢复脚本候选 | [离线计划生成器](candidates/m5-terminal/recovery-plan.py)、[封闭请求模板](candidates/m5-terminal/recovery-request.template.json) | recover/resume 顺序、SQL/helper 参数及 GATE 可审阅；无 DB/网络/shell 执行、无密码读取、无执行开关 |
| 可重复静态工具 | [constraint generator](candidates/m5-terminal/generate-constraint-supplement.py)、[hash refresh](candidates/m5-terminal/refresh-inventory.py)、[verifier](candidates/m5-terminal/verify-candidate.py) | 固定来源 diff、字节/函数签名/权限边界/解析/离线负向请求校验，未运行 PG |

## 绑定与验证

Business 0002 候选聚合 SHA256：`28085117a89097f7aa7b9da58b9f2f79ef088adc1c77212744548cbea1238b26`。inventory SHA256：`8c070395d2bd3af35354480f64a4d7150b82f088cd4a1e487f8297f9c8f88733`。另行绑定 role/catalog bootstrap 与 Native ACL，不能只比较 Business aggregate。

[静态 LOCAL 证据](evidence/m5-terminal-candidate-static-local.json) **9 组检查 PASS**：使用临时工具目录的 pglast v6.16 / PostgreSQL 16.1 grammar，114 条 SQL、33 个 PL/pgSQL 函数可解析；来源及所有 prerequisite 字节、聚合、UNISSUED 模板、helper签名、客户端 ACL、历史/终态范围、两种离线计划、跨库/额外字段/窗口重放负向请求和文档链接检查通过。未增加项目依赖、package script 或 CI 配置。

这些结果仅证明候选字节和离线语法/约束意图可复核，不证明 live catalog 类型/列绑定、数据库编译、PG16 RLS/ACL、跨进程排空、Native proof、回执丢失/崩溃恢复或业务回归。以上均 NOT_RUN。恢复计划中的 HBA/凭据/journal/启动阻断 GATE 是后续执行器要求，不冒充已实现自动恢复。

## 后续必须评审与实现的范围

1. 定向评审新增 SQL 的当前能力与永久历史读取、精确服务 audit 例外、observer stats 边、Native UPDATE(id)、controller原子接管、deferred双向约束及部分安装阻断。新增合同补充仍需评审，不因静态 PASS 自动获准。
2. 产出 live installer/issuer/loader 的 terminal profile 分支。现 loader 只接受 content 0001，Native receipt 拒绝新增 proof ACL，二者需要显式新 profile；旧 profile 保持严格，原证据仍适用于原 hash。
3. 实现持久 maintenance backend broker、Native 公共读取 worker、凭据/HBA/耐久 journal/启动阻断执行器，再仅在授权的专用本地环境运行受影响的 PG16 与 host 验收矩阵。未经完成这些步骤，不置 ready、不签发有效安装/处置 receipt、不运行结算。

原 content 0001 聚合 `e335f83bb48cc6c4ec754f8e3270dc0e6941e14f38306bd67aa29844c3713324` 与当前 implementation binding `fd4920297e1abeb499fd7690a9182127871e6a430b8a24795da092a1eaaf84f4` 保留。此前 LOCAL/CI 证据不扩大为本候选运行证明。完整 enabled gate、在线 reconciliation、Native GC、缺失 Native 的结算及生产门禁继续 deferred。NO COMMIT / NO PUSH / NO CI DISPATCH。

## 2026-10-12 R3 当前候选

已新增 [Native collector](candidates/m5-terminal/10-native-catalog-inspect.sql)、[封闭 profile 比较器](candidates/m5-terminal/verify-profile.py)、[独立 PG16 验证器](candidates/m5-terminal/verify-local-pg16.cjs)，候选共 23 文件。TSQL-01–03 及新 nullable v7 domain 已修正，详见 [R3 记录](zhiban-v2-m5-terminal-sql-r3-fix-local.md)。

当前 Business 0002 aggregate：`e1e7ea9517462edd855fb8715f49346db4c467c01aac43e8a370c39eebf7184a`；inventory：`855ac6019326fdd4a56c4a231fa64364dff3f0b5cee85748a2b9952cb6ac8e5d`。两份 receipt 模板已更新，仍 UNISSUED。静态 12 组 PASS（116 SQL/34 PLpgSQL），独立临时 PG16 26/26 PASS；仅 scoped fixture 验证，真实 Native worker、终态 finalize/崩溃执行器与新 live loader 仍待验收。原 applied bytes/当前配置和 receipt 不变。下一步定向复评 R3；建议 GPT-6 Astra / high。

当前后续以 [R3 复评](zhiban-v2-m5-terminal-r3-review.md)为准：补签发审计失败注入用例，并进入可信 expected profile 与 terminal installer/loader 接线；候选源码、上述 hash/receipt 状态未因文档复评改变。

## 2026-10-12 技术 installer 接线

已补 R3-01，并完成[签名 expected / blocked installer / receipt loader 接线](zhiban-v2-m5-terminal-installer-wiring.md)，独立临时 PG16 42/42、静态 13 组 PASS。新增 generic 全 catalog collector、共享安装/loader、显式 CLI 与离线 review signer；候选共 27 文件。当前 inventory `38c415440ca07abb5565b96b1685376a85b5135dfcc4872baf5c2f1544860e98`，Business aggregate 不变。现有开发库未应用，新接口不进入旧 host，receipt 模板 UNISSUED；只有 disposable fixture 签发 blocked 技术回执。接线增量待复评，真实 expected/信任根、broker、partial recovery 与完整终态仍 deferred。

## 2026-10-12 TI 修复与恢复观测候选

[本轮记录](zhiban-v2-m5-terminal-ti-fix-local.md)：新增 00-business-connect.sql、terminal-recovery.cjs，terminal 共 29 文件，外部参考/broker 三文件由 recoveryWiringSha256 绑定。inventory 4ab88165a1f6382f6540ac2cbbb9899203ba0648d11a2e70be909def377337ce；Business aggregate 不变。候选 50/50、真实 Native 13/13、静态 13 组 PASS；UNAPPLIED/UNISSUED，完整维护执行继续 deferred。

## 2026-10-13 维护控制执行器接续

当前 terminal 35 文件、外部5个来源绑定，inventory `0774292a6013eee00e80da90b5c90e294d596c053bbb5f39101dcc537877c046`；Business aggregate 未变。新增 maintenance-lock/hba/executor/cli/sign-approval 与 verify-maintenance-pg16 六文件；恢复 journal 使用同一读取字节计算 hash，launcher/source-binding接线。详情及证据边界见[维护本地记录](zhiban-v2-m5-terminal-maintenance-local.md)。18/18维护、50/50回归、13/13真实Native、13组静态PASS；现有cluster未应用，完整enabled/production模板仍UNISSUED。

## 2026-10-13 CLOSED ACK 接续

当前 inventory `4e5585a55aae259a39ac5c0aa01f40e66c4dbb138d99b2d093c626565c9d662a`；未应用 Business 0002 aggregate `ec2aa8066aae0455127522df40a32b86249a98417391dc714d243f366e592548`。新增 controller-only read_closed_result/ACL，bootstrap 前置 Business profile、凭据先落盘后轮换，CLOSED 保留启动 flag；35 个候选文件/5 个外部绑定数量不变。详见[边界复评与查证记录](zhiban-v2-m5-terminal-closed-ack-review.md)，历史18/50/13证据仍限原hash，真实库未应用/receipt仍UNISSUED。

## 2026-10-13 Handoff 独立扩展

新增[m5-handoff候选复评](zhiban-v2-m5-handoff-candidate-review.md)及20文件独立候选，自己的zhiban_handoff ledger 0001；terminal35文件/4e5585a5… inventory与0002 aggregate原样保留。新的控制COMMIT/读取授权不修改业务终态/window/claims，也不赋terminal写能力；旧证据不升级为handoff signoff。真实应用/签发/清旗保持deferred。
